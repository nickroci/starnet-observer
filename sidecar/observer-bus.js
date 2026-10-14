'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { redactText } = require('./observer-inspector.js');
const { note: failNote } = require('./failopen.js');

/* Read-only view of local llm-bus delivery metadata. Bodies are read only for explicit inspection; folders and wake reasons are never selected;
   raw addresses stay in this process and only exact pane joins or 'external'/'ambiguous' reach the browser. */
const WINDOW = 100, MAX_TEXT_CHARS = 32768, MAX_RAW_CHARS = 65536;
const QUERY = 'SELECT id, sender, recipient, sent_at, acknowledged_at, wake_status FROM messages ORDER BY id DESC LIMIT ' + WINDOW;
const WAKES = new Set(['requested', 'failed', 'unsupported']);
const MESSAGE_IDENTITY = /^mail_[a-f0-9]{64}$/;
const ADDRESS = /^(claude|codex):[A-Za-z0-9._-]{1,200}$/;

// Mirrors llm-bus default_path(): LLM_BUS_DB (with ~), else the per-user data folder.
function defaultBusPath(env = process.env, platform = process.platform, home = os.homedir()) {
  const configured = env.LLM_BUS_DB;
  if (configured) return configured === '~' ? home : /^~[\\/]/.test(configured) ? path.join(home, configured.slice(2)) : configured;
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'llm-bus', 'bus.sqlite3');
  return path.join(home, '.local', 'share', 'llm-bus', 'bus.sqlite3');
}
// node:sqlite is loaded on first read, so a Node without it only loses this optional feature.
const loadNodeSqlite = () => require('node:sqlite');
const instant = value => {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
};

/* SQLite never opens the live bus: even a readOnly connection to a WAL database creates -wal/-shm beside it.
   Each read copies the database and any journal into a private 0700 folder, opens that copy (SQLite replays
   the committed WAL frames there), and removes the folder. A copy is only trusted when size, times and inode
   of every file are unchanged across it, so a writer mid-commit or mid-checkpoint is retried, then reported. */
const PARTS = ['', '-wal', '-journal'], ATTEMPTS = 3, MAX_COPY_BYTES = 64n * 1024n * 1024n;
function fingerprint(file) {
  let bytes = 0n;
  return PARTS.map(suffix => {
    try {
      const stat = fs.statSync(file + suffix, { bigint: true });
      bytes += stat.size;
      if (!stat.isFile() || bytes > MAX_COPY_BYTES) throw new Error('Bus snapshot exceeds its bounded read size');
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(':');
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  });
}
function stableCopy(file, copy, copyFile) {
  for (const suffix of [...PARTS, '-shm']) fs.rmSync(copy + suffix, { force: true });
  const before = fingerprint(file);
  PARTS.forEach((suffix, index) => {
    if (before[index] === null) return;
    // A journal vanishing mid-copy (checkpoint) changes the fingerprint and is retried by query.
    try { copyFile(file + suffix, copy + suffix); fs.chmodSync(copy + suffix, 0o600); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  });
  return fingerprint(file).join('|') === before.join('|') ? before : null;
}

function makePrivateSnapshotQuery({ file, loadSqlite = loadNodeSqlite, tempRoot = os.tmpdir(), copyFile = fs.copyFileSync }) {
  return function query(select) {
    if (!fs.existsSync(file)) return { reason: 'missing' };
    let DatabaseSync;
    try { ({ DatabaseSync } = loadSqlite()); } catch (_) { return { reason: 'unsupported' }; }
    if (typeof DatabaseSync !== 'function') return { reason: 'unsupported' };
    let folder = null, database = null;
    try {
      folder = fs.mkdtempSync(path.join(tempRoot, 'starnet-observer-bus-'));
      fs.chmodSync(folder, 0o700);
      const copy = path.join(folder, 'bus.sqlite3');
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const copiedFingerprint = stableCopy(file, copy, copyFile);
        if (!copiedFingerprint) continue;
        database = new DatabaseSync(copy);
        const result = select(database, copiedFingerprint);
        database.close(); database = null;
        // Bind the queried rows to the source that produced the copy, never a later fingerprint.
        if (fingerprint(file).join('|') === copiedFingerprint.join('|')) {
          return { ...result, fingerprint: copiedFingerprint };
        }
      }
      return { reason: 'unstable' };
    } catch (_) {
      return { reason: 'unreadable' };
    } finally {
      if (database) try { database.close(); } catch (_) { failNote('observer.bus.close', new Error('Bus snapshot handle cleanup failed')); }
      // The private copy never outlives the read, including after a failed copy or open.
      if (folder) try { fs.rmSync(folder, { recursive: true, force: true }); } catch (_) { failNote('observer.bus.remove', new Error('Bus snapshot folder cleanup failed')); }
    }
  };
}

// Installed llm-bus inserts immutable id/sender/recipient/sent_at; later writes only delivery/routing fields.
// Source incarnation uses device/inode/birth time from the verified copy proof, not changing file times or WAL.
// Hash a versioned tuple to keep file identity and raw addresses private; never read bodies for metadata identity.
function messageIdentity(sourceFingerprint, row) {
  const [device, inode, , , , birth] = sourceFingerprint[0].split(':');
  if (!birth || birth === '0') throw new Error('Bus source incarnation unavailable');
  return 'mail_' + crypto.createHash('sha256').update(JSON.stringify([
    'starnet-mail-v1', device, inode, birth, row.id, row.sender, row.recipient, row.sent_at
  ])).digest('hex');
}

function makeBusReader({ file = defaultBusPath(), loadSqlite = loadNodeSqlite, now, tempRoot = os.tmpdir(), copyFile = fs.copyFileSync } = {}) {
  if (typeof now !== 'function') throw new TypeError('Bus reader requires an injected now clock');
  let rows = [], observedAt = null, health = 'unknown', reason = null, reusableFingerprint = null;
  const query = makePrivateSnapshotQuery({ file, loadSqlite, tempRoot, copyFile });
  const selectRows = (database, sourceFingerprint) => {
    const result = [];
    for (const row of database.prepare(QUERY).all()) {
      if (!Number.isSafeInteger(row.id) || row.id < 1 || typeof row.sender !== 'string' || typeof row.recipient !== 'string' || typeof row.sent_at !== 'string') continue;
      result.push({ id: row.id, identity: messageIdentity(sourceFingerprint, row), sender: row.sender, recipient: row.recipient, sentAt: instant(row.sent_at),
        acknowledgedAt: instant(row.acknowledged_at), wake: row.wake_status == null ? 'none' : WAKES.has(row.wake_status) ? row.wake_status : 'unknown' });
    }
    return { rows: result };
  };
  // A failed read keeps the last good rows and their observedAt, so the browser sees them as stale.
  function read() {
    let result;
    try {
      const current = fingerprint(file);
      if (current[0] === null) result = { reason: 'missing' };
      else if (reusableFingerprint && current.join('|') === reusableFingerprint.join('|')) {
        return { rows, observedAt, health: 'available', reason: null };
      }
    } catch (_) { result = { reason: 'unreadable' }; }
    result = result || query(selectRows);
    if (result.rows) {
      rows = result.rows; observedAt = now(); health = 'available'; reason = null;
      reusableFingerprint = result.fingerprint;
    } else {
      health = 'unavailable'; reason = result.reason; reusableFingerprint = null;
    }
    return { rows, observedAt, health, reason };
  }

  function inspect(id, expectedIdentity) {
    const base = { id, identity: null, health: 'unavailable', reason: null, asOf: new Date(now()).toISOString(),
      text: null, truncated: false, window: { maxTextChars: MAX_TEXT_CHARS } };
    if (!Number.isSafeInteger(id) || id < 1) return { ...base, reason: 'invalid-message' };
    if (expectedIdentity !== undefined && (typeof expectedIdentity !== 'string' || !MESSAGE_IDENTITY.test(expectedIdentity))) return { ...base, reason: 'invalid-identity' };
    const result = query((database, sourceFingerprint) => {
      // Bound transfer into JavaScript; scrub before the smaller display cap. A cut quoted value stays redacted.
      const row = database.prepare('SELECT id, sender, recipient, sent_at, substr(body, 1, ?) AS body FROM messages WHERE id = ?').get(MAX_RAW_CHARS + 1, id);
      if (!row) return { reason: 'missing-message' };
      if (typeof row.sender !== 'string' || typeof row.recipient !== 'string' || typeof row.sent_at !== 'string') return { reason: 'unreadable' };
      const identity = messageIdentity(sourceFingerprint, row);
      if (expectedIdentity !== undefined && identity !== expectedIdentity) return { reason: 'identity-mismatch' };
      if (typeof row.body !== 'string') return { reason: 'unreadable' };
      const safe = redactText(row.body);
      return { identity, text: safe.slice(0, MAX_TEXT_CHARS), truncated: row.body.length > MAX_RAW_CHARS || safe.length > MAX_TEXT_CHARS };
    });
    if (result.reason) { reusableFingerprint = null; return { ...base, reason: result.reason }; }
    return { ...base, health: 'available', identity: result.identity, text: result.text, truncated: result.truncated };
  }
  return { read, inspect };
}

// Exact identity join: one pane with this provider:session gets its observer id; two or more stay ambiguous.
function publicBus(state, sessions) {
  const panes = new Map();
  for (const row of sessions) {
    if (!row.sessionId) continue;
    const address = row.provider + ':' + row.sessionId;
    panes.set(address, panes.has(address) ? 'ambiguous' : row.id);
  }
  const endpoint = address => ADDRESS.test(address) && panes.get(address) || 'external';
  return { health: state.health, reason: state.reason, observedAt: state.observedAt, window: WINDOW,
    messages: state.rows.map(row => ({ id: row.id, ...(row.identity === undefined ? {} : { identity: row.identity }), from: endpoint(row.sender), to: endpoint(row.recipient),
      sentAt: row.sentAt, acknowledgedAt: row.acknowledgedAt, wake: row.wake })) };
}
module.exports = { makeBusReader, publicBus, defaultBusPath, WINDOW, makePrivateSnapshotQuery };
