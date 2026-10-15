'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite = require('bun:sqlite');
const { makeBusReader, publicBus, relayBinding } = require('../sidecar/observer-bus.js');

// The llm-bus native schema plus the remote tables exactly as llm_bus_remote_store.py creates them.
const SCHEMA = `CREATE TABLE agents (address TEXT PRIMARY KEY, kind TEXT NOT NULL, project TEXT NOT NULL, scope TEXT NOT NULL,
  last_seen TEXT NOT NULL, ended_at TEXT, messaging_socket TEXT);
CREATE TABLE messages (id INTEGER PRIMARY KEY, sender TEXT NOT NULL REFERENCES agents(address), recipient TEXT NOT NULL REFERENCES agents(address),
  body TEXT NOT NULL, sender_cwd TEXT, recipient_cwd TEXT, sender_scope TEXT, recipient_scope TEXT,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), acknowledged_at TEXT, wake_status TEXT, wake_via TEXT, wake_reason TEXT, wake_checked_at TEXT);`;
const REMOTE = `CREATE TABLE remote_publications (address TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE remote_binding (id INTEGER PRIMARY KEY CHECK(id=1), connection TEXT NOT NULL);
CREATE TABLE remote_proxies (address TEXT PRIMARY KEY);
CREATE TABLE remote_peers (address TEXT PRIMARY KEY, repo_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE remote_outbox (id TEXT PRIMARY KEY, local_id INTEGER NOT NULL REFERENCES messages(id), envelope TEXT NOT NULL, state TEXT NOT NULL);
CREATE TABLE remote_imports (id TEXT PRIMARY KEY, local_id INTEGER NOT NULL REFERENCES messages(id), envelope TEXT NOT NULL, ack_synced INTEGER NOT NULL DEFAULT 0, wake_claimed INTEGER NOT NULL DEFAULT 0);`;

const S1 = '11111111-1111-4111-8111-111111111111', S2 = '22222222-2222-4222-8222-222222222222', R1 = '01a13f77-ab47-74e3-91d4-e7c83c17ee97';
const NOW = Date.parse('2026-10-15T18:00:00.000Z'), iso = ms => new Date(ms).toISOString();
const LOCAL = 'claude:' + S1, OTHER = 'codex:' + S2, FAR = 'whitenoise/llm-bus/codex:' + R1, SECRET_BODY = 'PRIVATE-BODY-CANARY';

assert.deepEqual(relayBinding('https://user:pw@llm-bus-relay.example.dev:8443/v1?k=PRIVATE|friend-1'), { relay: 'llm-bus-relay.example.dev', machine: 'friend-1' }, 'host name only');
for (const bad of [null, 'https://relay.example.dev', '|friend-1', 'https://relay.example.dev|bad machine', 'ftp://relay.example.dev|m', 'not a url|m']) assert.equal(relayBinding(bad), null, String(bad));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'observer-bus-relay-'));
try {
  const file = path.join(temp, 'bus.sqlite3'), scratch = path.join(temp, 'scratch'); fs.mkdirSync(scratch);
  const db = new sqlite.Database(file);
  db.exec(SCHEMA);
  for (const address of [LOCAL, OTHER, FAR]) db.query("INSERT INTO agents VALUES (?, 'x', 'p', 's', ?, NULL, NULL)").run(address, iso(NOW));
  const insert = (sender, recipient, at, ack = null) => db.query('INSERT INTO messages(sender, recipient, body, sent_at, acknowledged_at) VALUES (?, ?, ?, ?, ?)').run(sender, recipient, SECRET_BODY, iso(at), ack && iso(ack)).lastInsertRowid;
  const plain = insert(LOCAL, OTHER, NOW - 50000);
  // Without remote tables the bus is a plain local bus: no relay view, no relay fields.
  const before = makeBusReader({ now: () => NOW, file, tempRoot: scratch }).read();
  assert.equal(before.health, 'available'); assert.equal(before.remote, null); assert.equal(before.rows[0].relay, undefined);
  assert.equal(Object.hasOwn(publicBus(before, []), 'remote'), false);

  db.exec(REMOTE);
  db.query('INSERT INTO remote_binding VALUES (1, ?)').run('https://llm-bus-relay.example.dev|friend-1');
  const out = insert(LOCAL, FAR, NOW - 40000), inbound = insert(FAR, LOCAL, NOW - 30000, NOW - 20000), queued = insert(OTHER, FAR, NOW - 10000);
  db.query("INSERT INTO remote_outbox VALUES ('u1', ?, ?, 'accepted_remote')").run(out, JSON.stringify({ body: SECRET_BODY }));
  db.query("INSERT INTO remote_outbox VALUES ('u2', ?, ?, 'queued_local')").run(queued, JSON.stringify({ body: SECRET_BODY }));
  db.query("INSERT INTO remote_imports(id, local_id, envelope) VALUES ('u3', ?, ?)").run(inbound, JSON.stringify({ body: SECRET_BODY }));
  const peer = (machine, id, lastSeen, ended = 0, repo = 'llm-bus') => db.query('INSERT INTO remote_peers VALUES (?, ?, ?)').run(machine + '/' + repo + '/codex:' + id, repo,
    JSON.stringify({ address: machine + '/' + repo + '/codex:' + id, machine_id: machine, repo_id: repo, native_address: 'codex:' + id, last_seen: iso(lastSeen), ended }));
  peer('whitenoise', 'a', NOW - 5 * 60000); peer('whitenoise', 'b', NOW - 3600000); peer('whitenoise', 'c', NOW - 60000, 1);
  peer('whitenoise', 'd', NOW - 25 * 3600000); peer('whitenoise', 'e', NOW - 7200000, 0, 'docs');
  peer('friend-1', 'self', NOW - 1000);   // this machine's own sessions are never a peer
  peer('quiet-box', 'z', NOW - 48 * 3600000);
  db.close();

  const state = makeBusReader({ now: () => NOW, file, tempRoot: scratch }).read();
  assert.equal(state.health, 'available');
  const byId = new Map(state.rows.map(row => [row.id, row]));
  assert.equal(byId.get(Number(plain)).relay, undefined, 'a local message has no relay');
  assert.deepEqual(byId.get(Number(out)).relay, { direction: 'out', machine: 'whitenoise', repo: 'llm-bus', provider: 'codex', state: 'accepted_remote' });
  assert.deepEqual(byId.get(Number(queued)).relay, { direction: 'out', machine: 'whitenoise', repo: 'llm-bus', provider: 'codex', state: 'queued_local' });
  assert.deepEqual(byId.get(Number(inbound)).relay, { direction: 'in', machine: 'whitenoise', repo: 'llm-bus', provider: 'codex', state: 'acknowledged' });
  assert.equal(state.remote.relay, 'llm-bus-relay.example.dev'); assert.equal(state.remote.machine, 'friend-1');
  assert.deepEqual(state.remote.peers, [
    { machine: 'quiet-box', repos: ['llm-bus'], agents: 0, lastSeen: NOW - 48 * 3600000 },
    { machine: 'whitenoise', repos: ['docs', 'llm-bus'], agents: 3, lastSeen: NOW - 60000 }
  ], 'per machine: ended and 24h-idle sessions are not counted; this machine is excluded');
  assert.equal(state.remote.lastActivityAt, NOW - 10000, 'newest relayed message or peer activity; this machine\'s own sessions do not count');

  const view = publicBus(state, [{ id: 'obs_local', provider: 'claude', sessionId: S1 }]);
  const text = JSON.stringify(view);
  for (const secret of [SECRET_BODY, R1, S2, 'codex:' + R1]) assert.equal(text.includes(secret), false, 'no body or native session id reaches the page: ' + secret);
  const outView = view.messages.find(message => message.id === Number(out));
  assert.equal(outView.from, 'obs_local'); assert.equal(outView.to, 'external', 'the far side is never an observed pane');
  assert.equal(outView.relay.state, 'accepted_remote');
  assert.deepEqual(view.remote.peers.map(peer => peer.machine), ['quiet-box', 'whitenoise']);
  view.remote.peers[0].repos.push('mutated'); view.messages[1].relay.state = 'mutated';
  assert.deepEqual(state.remote.peers[0].repos, ['llm-bus'], 'public view never aliases reader state');
  assert.notEqual(state.rows[1].relay.state, 'mutated');

  // A malformed relay table never costs the local bus.
  const broken = new sqlite.Database(file); broken.exec('DROP TABLE remote_outbox; CREATE TABLE remote_outbox (nope TEXT)'); broken.close();
  const degraded = makeBusReader({ now: () => NOW, file, tempRoot: scratch }).read();
  assert.equal(degraded.health, 'available'); assert.equal(degraded.rows.length, 4); assert.equal(degraded.remote, null);
  assert.ok(degraded.rows.every(row => row.relay === undefined));
  assert.deepEqual(fs.readdirSync(scratch), [], 'private copies removed');
  console.log('observer bus relay: host-only binding, per-message direction/peer/state, per-machine roster with llm-bus idle rule, no bodies or session ids, never aliased, malformed tables degrade to local OK');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
