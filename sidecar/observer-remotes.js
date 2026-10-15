/* sidecar/observer-remotes.js — remote observers federated over SSH.

   Each configured remote runs its own read-only observer; the hub keeps one long-lived `ssh … bun scripts/stream.js`
   per remote and reads one NDJSON snapshot per line. No port, token or HTTP surface exists on the remote: the trust
   boundary is the operator's SSH key. A remote is still another machine, so every row it sends is treated as
   untrusted input: only known fields survive, text is bounded and stripped of control characters, enums are checked,
   and ids are re-derived under the host so a remote can never collide with (or impersonate) a local row. */
'use strict';
const crypto = require('node:crypto');
const childProcess = require('./child-env.js').guardChildProcess(require('node:child_process'));
const { aggregateRows } = require('./observer.js');
const { unavailable } = require('./observer-inspector.js');

const MAX_LINE = 4 * 1024 * 1024, MAX_ROWS = 512, FRESH_MS = 10000, BACKOFF = [2000, 5000, 10000, 30000, 60000];
const ID = /^obs_[a-f0-9]{24}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATUSES = new Set(['working', 'blocked', 'idle', 'done', 'unknown']), PROVIDERS = new Set(['claude', 'codex']);
const SOURCES = new Set(['herdr', 'helper']), HEALTH = new Set(['available', 'unavailable']);
const COUNTERS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
const hash = (...parts) => crypto.createHash('sha256').update(parts.join('\0')).digest('hex');
const text = (value, length) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, length) : null;
const word = (value, length = 40) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,40}$/.test(value) ? value.slice(0, length) : null;
const time = value => Number.isFinite(value) && value >= 0 ? value : typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? text(value, 40) : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const oneOf = (value, set, fallback = null) => set.has(value) ? value : fallback;

function counters(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const result = {};
  for (const key of COUNTERS) {
    const value = usage[key];
    result[key] = value && typeof value === 'object' ? { value: count(value.value), state: word(value.state, 20) } : null;
  }
  result.coverage = word(usage.coverage, 40); result.observedAt = time(usage.observedAt);
  return result;
}
function tool(value) {
  if (!value || typeof value !== 'object') return { available: false };
  const result = { available: value.available === true };
  if (value.last && typeof value.last === 'object') result.last = { name: text(value.last.name, 80), phase: word(value.last.phase, 20),
    outcome: word(value.last.outcome, 20), at: time(value.last.at) };
  if (value.usage) result.usage = counters(value.usage);
  return result;
}
const opaque = (prefix, host, value) => typeof value === 'string' && value ? prefix + hash(host, value).slice(0, 20) : null;
const prefixOf = (value, fallback) => typeof value === 'string' && /^(prj|repo|dir)_/.test(value) ? value.slice(0, value.indexOf('_') + 1) : fallback;
const remap = (host, id) => 'obs_' + hash(host, id).slice(0, 24);

/* One remote row → a hub row. Unknown fields are dropped; ids are host-scoped; observedAt is the hub's receipt time. */
function sanitizeRow(host, row, receivedAt) {
  if (!row || typeof row !== 'object' || !ID.test(row.id) || !PROVIDERS.has(row.provider) || !SOURCES.has(row.source)) return null;
  const helper = row.source === 'helper' || Object.hasOwn(row, 'parentId');
  const sessionId = typeof row.sessionId === 'string' && (UUID.test(row.sessionId) || helper && /^[A-Za-z0-9-]{1,64}$/.test(row.sessionId)) ? row.sessionId : null;
  const id = remap(host, row.id);
  let inspectionIdentity = null;
  if (typeof row.inspectionIdentity === 'string') {
    if (/^helper:obs_[a-f0-9]{24}$/.test(row.inspectionIdentity)) inspectionIdentity = 'helper:' + id;
    else if (sessionId && row.inspectionIdentity === row.provider + ':' + sessionId) inspectionIdentity = row.inspectionIdentity;
  }
  const safe = {
    id, host, provider: row.provider, source: row.source, role: row.role === 'overseer' ? 'overseer' : null,
    // A remote pane id is namespaced so it can never match a local Herdr pane: control actions reject it outright.
    paneId: word(row.paneId, 100) ? host + '/' + row.paneId : null,
    title: text(row.title, 160) || row.provider,
    projectId: opaque(prefixOf(row.projectId, 'prj_'), host, row.projectId), project: text(row.project, 120) || 'Unassigned', projectKind: word(row.projectKind, 20),
    repoId: opaque(prefixOf(row.repoId, 'dir_'), host, row.repoId), repo: text(row.repo, 120) || 'Unassigned', repoKind: word(row.repoKind, 20),
    worktree: text(row.worktree, 120), folder: text(row.folder, 160) || '',
    status: oneOf(row.status, STATUSES, 'unknown'), sessionId,
    identitySource: word(row.identitySource, 20), identityHealth: oneOf(row.identityHealth, HEALTH, 'unavailable'),
    tool: tool(row.tool), usage: counters(row.usage),
    observedAt: receivedAt, inventoryHealth: oneOf(row.inventoryHealth, HEALTH, 'unavailable'),
    inspectionIdentity, presence: word(row.presence, 30), helperOverflow: count(row.helperOverflow) || 0
  };
  if (Number.isFinite(row.lastActivityAt)) safe.lastActivityAt = row.lastActivityAt;
  if (row.projectHome === true) safe.projectHome = true;
  if (helper) {
    safe.parentId = ID.test(row.parentId) ? remap(host, row.parentId) : null;
    safe.lineageState = word(row.lineageState, 30);
    const task = row.taskEvidence || {};
    safe.taskEvidence = { state: word(task.state, 20) || 'unavailable', summary: text(task.summary, 240), source: word(task.source, 30), observedAt: time(task.observedAt) };
    const status = row.taskStatusEvidence || {};
    safe.taskStatusEvidence = { status: word(status.status, 20), source: word(status.source, 30), observedAt: time(status.observedAt) };
    const life = row.lifecycleEvidence || {};
    safe.lifecycleEvidence = { state: word(life.state, 30), reason: text(life.reason, 160) };
    safe.task = text(row.task, 240) || 'Task unavailable.';
  }
  return safe;
}
function sanitizeSnapshot(host, value, receivedAt) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.sessions)) throw new Error('invalid snapshot');
  const rows = [];
  for (const row of value.sessions.slice(0, MAX_ROWS)) { const safe = sanitizeRow(host, row, receivedAt); if (safe) rows.push(safe); }
  // A helper whose parent did not survive sanitising would be an orphan: drop it rather than guess a parent.
  const ids = new Set(rows.map(row => row.id));
  const kept = rows.filter(row => !Object.hasOwn(row, 'parentId') || row.parentId && ids.has(row.parentId));
  return { rows: kept, bus: sanitizeBus(host, value.bus, new Set(kept.map(row => row.id)), receivedAt) };
}

/* A remote host's own llm-bus, as its observer published it (publicBus shape). Each host's bus stands alone: message
   ids stay that host's integers, and every message also carries its hub-wide key "id@host" and its host. Endpoints are
   re-derived exactly like the rows (remap), and anything that does not name a surviving row of that host becomes
   'external'. Message identities are dropped: a remote body is never inspectable from the hub. */
// Same vocabulary as the local reader (observer-bus.js): anything else from a remote reads as 'unknown'.
const WAKES = new Set(['requested', 'failed', 'unsupported', 'none', 'unknown']);
const MAX_MESSAGES = 200;
function sanitizeBus(host, bus, rowIds, receivedAt) {
  if (!bus || typeof bus !== 'object' || !Array.isArray(bus.messages)) return null;
  const endpoint = value => value === 'external' || value === 'ambiguous' ? value : ID.test(value) && rowIds.has(remap(host, value)) ? remap(host, value) : 'external';
  const messages = [];
  for (const message of bus.messages.slice(0, MAX_MESSAGES)) {
    if (!message || !Number.isSafeInteger(message.id) || message.id < 1) continue;
    messages.push({ id: message.id, key: message.id + '@' + host, host, from: endpoint(message.from), to: endpoint(message.to),
      sentAt: time(message.sentAt), acknowledgedAt: time(message.acknowledgedAt), wake: WAKES.has(message.wake) ? message.wake : 'unknown' });
  }
  const health = bus.health === 'available' ? 'available' : 'unavailable';
  return { health, reason: health === 'available' ? null : text(bus.reason, 120) || 'unreadable', observedAt: health === 'available' ? receivedAt : null,
    window: Number.isSafeInteger(bus.window) && bus.window > 0 && bus.window <= 1000 ? bus.window : 100, messages };
}
/* Relay detection hook. With mail "relay" configured the page may only draw a working mail link once relayed traffic
   is actually seen; config alone never makes it active. Nothing relays today, so this always reports 'none'.
   TODO(relay): when llm-bus gains host-qualified addresses (claude:<uuid>@host, docs/multi-host.md Decision 2), the
   remote observer must publish them (publicBus currently folds unknown senders into 'external'); detect them here,
   set observed: 'active' and lastRelayedAt to the newest relayed message's sentAt. */
function relayObserved(host, bus) {
  void host; void bus;
  return { observed: 'none', lastRelayedAt: null };
}

// The remote command is fixed; only `dir` varies, and it is validated by config and single-quoted for the remote shell.
const quote = value => "'" + String(value).replace(/'/g, "'\\''") + "'";
function remoteCommand(dir) {
  const cd = dir.startsWith('~/') ? 'cd "$HOME"/' + quote(dir.slice(2)) : dir === '~' ? 'cd "$HOME"' : 'cd ' + quote(dir);
  return cd + ' && PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" exec bun --no-env-file scripts/stream.js';
}
function sshArgs(remote) {
  if (typeof remote.ssh !== 'string' || remote.ssh.startsWith('-') || !/^[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$/.test(remote.ssh)) throw new Error('Invalid ssh target');
  return ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
    '--', remote.ssh, remoteCommand(remote.dir || '~/starnet-observer')];
}
// ssh's own diagnostics can name hosts, users and paths; the page gets one short, known category instead.
function reasonFrom(stderr, code) {
  const value = String(stderr || '');
  if (/Permission denied/i.test(value)) return 'SSH authentication failed';
  if (/Could not resolve hostname/i.test(value)) return 'Host name did not resolve';
  if (/Connection refused/i.test(value)) return 'SSH connection refused';
  if (/timed out/i.test(value)) return 'SSH connection timed out';
  if (/Host key verification failed/i.test(value)) return 'SSH host key not trusted';
  if (/command not found|No such file or directory/i.test(value)) return 'Remote observer not installed';
  return code === null ? 'SSH stream ended' : 'SSH stream exited (' + code + ')';
}

function makeRemoteHosts({ remotes = [], spawn = childProcess.spawn, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const hosts = remotes.map(remote => ({ remote, child: null, rows: [], bus: null, receivedAt: null, reason: 'Connecting', failures: 0, timer: null, connected: false }));
  let closed = false;
  function connect(host) {
    if (closed) return;
    host.timer = null;
    let child;
    try { child = spawn('ssh', sshArgs(host.remote), { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (_) { host.reason = 'SSH unavailable'; return schedule(host); }
    host.child = child;
    let buffer = '', stderr = '', overflow = false;
    child.stdout.setEncoding?.('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        if (overflow) { overflow = false; continue; }   // the tail of an oversized line
        if (!line.trim()) continue;
        try {
          const receivedAt = now();
          const snap = sanitizeSnapshot(host.remote.id, JSON.parse(line), receivedAt);
          host.rows = snap.rows; host.bus = snap.bus;
          host.receivedAt = receivedAt; host.reason = null; host.failures = 0; host.connected = true;
        } catch (_) { host.reason = 'Remote sent an unreadable snapshot'; }
      }
      if (buffer.length > MAX_LINE) { buffer = ''; overflow = true; host.reason = 'Remote snapshot too large'; }
    });
    child.stderr?.on('data', chunk => { if (stderr.length < 8192) stderr += chunk; });
    child.on('error', () => { host.reason = 'SSH unavailable'; });
    child.on('close', code => {
      if (host.child !== child) return;
      host.child = null;
      host.reason = reasonFrom(stderr, code);
      schedule(host);
    });
  }
  function schedule(host) {
    if (closed || host.timer) return;
    const delay = BACKOFF[Math.min(host.failures, BACKOFF.length - 1)];
    host.failures++;
    host.timer = setTimer(() => connect(host), delay);
  }
  for (const host of hosts) connect(host);

  function snapshot() {
    const at = now(), rows = [], sources = {}, buses = {};
    for (const host of hosts) {
      const fresh = host.receivedAt !== null && at - host.receivedAt < FRESH_MS;
      const health = fresh ? 'available' : host.receivedAt !== null ? 'stale' : 'unavailable';
      // Stale rows stay on screen (the last truthful observation) but are never presented as live.
      for (const row of host.rows) rows.push(fresh ? row : { ...row, inventoryHealth: 'unavailable' });
      // A quiet host's mail is its last observation: kept for the ledger, never presented as a live bus.
      const bus = host.bus && (fresh ? host.bus : { ...host.bus, health: 'unavailable', reason: 'Host not currently observed', observedAt: host.bus.observedAt });
      if (bus) buses[host.remote.id] = bus;
      sources[host.remote.id] = { health, observedAt: host.receivedAt, reason: fresh ? null : host.reason || 'No recent snapshot',
        agents: host.rows.filter(row => row.source !== 'helper').length,
        // Mail topology: the configured mode, and what is actually observed (config alone never makes a link active).
        mail: { mode: host.remote.mail === 'relay' ? 'relay' : 'separate', ...relayObserved(host.remote.id, host.bus) } };
    }
    return { rows, sources, buses };
  }
  function close() {
    closed = true;
    for (const host of hosts) {
      if (host.timer) clearTimer(host.timer);
      host.timer = null;
      if (host.child) { const child = host.child; host.child = null; try { child.stdin?.end(); child.kill('SIGTERM'); } catch (_) {} }
    }
  }
  return { snapshot, close, ids: () => hosts.map(host => host.remote.id) };
}

/* The hub's observer: the local snapshot plus every remote's rows. Local rows carry host: null. Aggregates are
   recomputed over the merged roster. `bus` keeps its local shape; each remote's own bus is under `hostBus[id]`
   (there is no cross-host mail: llm-bus is per host). */
function makeFederatedObserver(local, remoteHosts, now = Date.now) {
  async function get() {
    const inventory = await local.get(), remote = remoteHosts.snapshot();
    const sessions = [...inventory.sessions.map(row => ({ ...row, host: null })), ...remote.rows];
    const herdr = inventory.sources?.herdr;
    return { ...inventory, sessions, aggregate: aggregateRows(sessions, now()),
      health: inventory.health === 'available' || Object.values(remote.sources).some(host => host.health === 'available') ? 'available' : inventory.health,
      sources: { ...inventory.sources, hosts: { local: { health: herdr?.health || 'unavailable', observedAt: herdr?.observedAt ?? null, reason: herdr?.reason || null,
        agents: inventory.sessions.filter(row => row.source === 'herdr').length }, ...remote.sources } }, hostBus: remote.buses || {} };
  }
  async function inspect(id, expectedIdentity) {
    if (remoteHosts.snapshot().rows.some(row => row.id === id)) return unavailable(id, 'remote-inspect', now());
    return local.inspect(id, expectedIdentity);
  }
  return { get, inspect, inspectMessage: (id, expectedIdentity) => local.inspectMessage(id, expectedIdentity), close: async () => { remoteHosts.close(); await local.close?.(); } };
}

module.exports = { makeRemoteHosts, makeFederatedObserver, sanitizeRow, sanitizeSnapshot, sanitizeBus, relayObserved, sshArgs, remoteCommand, reasonFrom, MAX_LINE, FRESH_MS, BACKOFF };
