'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { makeRemoteHosts, makeFederatedObserver, sanitizeRow, sshArgs, remoteCommand, reasonFrom, MAX_LINE, BACKOFF } = require('../sidecar/observer-remotes.js');
const { startStream } = require('../scripts/stream.js');
const { PANE } = require('../sidecar/control.js');

const UUID = '0892c334-acab-400e-8611-45662a9add31';
const row = (over = {}) => ({ id: 'obs_' + 'a'.repeat(24), paneId: 'w1:p1', provider: 'claude', role: null, title: 'Remote task', projectId: 'prj_' + '1'.repeat(20),
  project: 'work', projectKind: 'group', repoId: 'dir_' + '2'.repeat(20), repo: 'work', repoKind: 'folder', worktree: null, folder: '', status: 'idle',
  sessionId: UUID, identitySource: 'native', identityHealth: 'available', tool: { available: true, last: { name: 'Bash', phase: 'finished', outcome: 'ok', at: '2026-10-15T10:00:00.000Z', callId: 'secret', position: 9 } },
  usage: null, source: 'herdr', observedAt: 1, inventoryHealth: 'available', inspectionIdentity: 'claude:' + UUID, presence: 'pane', helperOverflow: 0, ...over });

// A fake ssh child: tests push stdout chunks and decide when it exits.
function fakeSpawn() {
  const children = [];
  const spawn = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { end() { child.stdinEnded = true; } };
    child.kill = signal => { child.killed = signal; };
    child.command = command; child.args = args;
    children.push(child); return child;
  };
  return { spawn, children };
}
function fakeTimers() {
  const timers = [];
  return { timers, setTimer: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimer: timer => { timer.cleared = true; }, run() { const timer = timers.shift(); if (timer && !timer.cleared) timer.fn(); return timer; } };
}

// ── ssh argv and remote command: fixed, quoted, and option-injection proof.
{
  const args = sshArgs({ id: 'vm', ssh: 'nick@34.153.167.160', dir: '~/starnet-observer' });
  assert.deepEqual(args.slice(0, 10), ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', '--']);
  assert.equal(args[10], 'nick@34.153.167.160');
  assert.equal(args[11], 'cd "$HOME"/\'starnet-observer\' && PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" exec bun --no-env-file scripts/stream.js');
  assert.equal(remoteCommand("/srv/it's"), 'cd \'/srv/it\'\\\'\'s\' && PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH" exec bun --no-env-file scripts/stream.js');
  for (const ssh of ['-oProxyCommand=x', 'a b', 'host;rm', '', 'user@host@x', 42]) assert.throws(() => sshArgs({ id: 'vm', ssh }), /Invalid ssh target/);
  assert.equal(reasonFrom('nick@1.2.3.4: Permission denied (publickey).', 255), 'SSH authentication failed');
  assert.equal(reasonFrom('weird /home/nick/secret path', 3), 'SSH stream exited (3)', 'raw ssh stderr never reaches the page');
}

// ── Sanitising: known fields only, host-scoped ids, namespaced pane ids, bounded text, checked enums.
{
  const safe = sanitizeRow('vm', row({ title: 'x\u0007y'.padEnd(500, 'z'), status: 'hacking', evil: '<script>', tool: { available: true, last: { name: 'Bash', callId: 'c', position: 3, at: 5 } } }), 1000);
  assert.equal(safe.host, 'vm'); assert.match(safe.id, /^obs_[a-f0-9]{24}$/); assert.notEqual(safe.id, 'obs_' + 'a'.repeat(24));
  assert.equal(safe.paneId, 'vm/w1:p1'); assert.equal(PANE.test(safe.paneId), false, 'a remote pane id can never match a control target');
  assert.equal(safe.title.length, 160); assert.equal(safe.title.includes('\u0007'), false);
  assert.equal(safe.status, 'unknown'); assert.equal('evil' in safe, false); assert.equal('callId' in safe.tool.last, false);
  assert.equal(safe.observedAt, 1000, 'observedAt is the hub receipt time');
  assert.match(safe.projectId, /^prj_[a-f0-9]{20}$/); assert.notEqual(safe.projectId, 'prj_' + '1'.repeat(20));
  assert.match(safe.repoId, /^dir_[a-f0-9]{20}$/);
  // The same remote folder on two hosts never merges into one room, and never matches the local id.
  assert.equal(sanitizeRow('vm', row({ projectHome: true }), 1).projectHome, true, 'the home-folder display flag survives');
  for (const value of ['yes', 1, {}]) assert.equal('projectHome' in sanitizeRow('vm', row({ projectHome: value }), 1), false, 'only a literal true');
  assert.notEqual(sanitizeRow('vm2', row(), 1).projectId, safe.projectId);
  assert.notEqual(sanitizeRow('vm2', row(), 1).repoId, safe.repoId);
  assert.equal(safe.inspectionIdentity, 'claude:' + UUID);
  assert.equal(sanitizeRow('vm', row({ inspectionIdentity: 'claude:' + UUID.replace('0', '1') }), 1).inspectionIdentity, null, 'a mismatched identity is dropped');
  for (const bad of [{ id: 'nope' }, { provider: 'chatgpt' }, { source: 'desktop' }]) assert.equal(sanitizeRow('vm', row(bad), 1), null);
  const helper = sanitizeRow('vm', row({ id: 'obs_' + 'b'.repeat(24), source: 'helper', parentId: 'obs_' + 'a'.repeat(24), sessionId: 'agent-1', inspectionIdentity: 'helper:obs_' + 'b'.repeat(24),
    taskEvidence: { state: 'available', summary: 'Look', source: 'spawn', observedAt: 1 }, lifecycleEvidence: { state: 'running', reason: 'r' } }), 1);
  assert.equal(helper.parentId, safe.id, 'helper parent ids are remapped with the same host scope');
  assert.equal(helper.inspectionIdentity, 'helper:' + helper.id);
}

// ── Stream, health transitions, unterminated tail, size cap, backoff and close.
{
  let clock = 10000;
  const { spawn, children } = fakeSpawn(), timers = fakeTimers();
  const hosts = makeRemoteHosts({ remotes: [{ id: 'vm', ssh: 'nick@host' }], spawn, now: () => clock, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  assert.equal(children.length, 1); assert.equal(children[0].command, 'ssh');
  assert.equal(hosts.snapshot().sources.vm.health, 'unavailable');
  assert.equal(hosts.snapshot().sources.vm.reason, 'Connecting');
  const line = JSON.stringify({ sessions: [row()], health: 'available', bus: { messages: [{ id: 1 }] } });
  children[0].stdout.emit('data', line.slice(0, 20));
  assert.equal(hosts.snapshot().rows.length, 0, 'a partial line is not a snapshot');
  children[0].stdout.emit('data', line.slice(20) + '\n');
  let snap = hosts.snapshot();
  assert.equal(snap.sources.vm.health, 'available'); assert.equal(snap.rows.length, 1); assert.equal(snap.sources.vm.agents, 1);
  assert.equal('bus' in snap, false, 'the remote bus is dropped at the hub');
  children[0].stdout.emit('data', 'not json\n');
  assert.equal(hosts.snapshot().rows.length, 1, 'garbage keeps the last good snapshot');
  clock += 10001;
  snap = hosts.snapshot();
  assert.equal(snap.sources.vm.health, 'stale'); assert.equal(snap.rows[0].inventoryHealth, 'unavailable', 'stale rows are never live');
  // An oversized line is dropped whole, including its tail after the cap.
  children[0].stdout.emit('data', 'x'.repeat(MAX_LINE + 1));
  children[0].stdout.emit('data', JSON.stringify({ sessions: [] }) + '\n');
  assert.equal(hosts.snapshot().rows.length, 1, 'the tail of an oversized line is not parsed');
  // Exit with an unterminated last line: it is discarded, never parsed.
  children[0].stdout.emit('data', JSON.stringify({ sessions: [] }));
  children[0].stderr.emit('data', 'nick@host: Permission denied (publickey).');
  children[0].emit('close', 255);
  assert.equal(hosts.snapshot().rows.length, 1, 'an unterminated tail at exit is discarded');
  assert.equal(hosts.snapshot().sources.vm.reason, 'SSH authentication failed');
  assert.equal(timers.timers[0].delay, BACKOFF[0]);
  timers.run(); assert.equal(children.length, 2, 'reconnects after the backoff');
  children[1].emit('close', 1); assert.equal(timers.timers[0].delay, BACKOFF[1], 'backoff grows on repeated failure');
  timers.run(); for (let i = 0; i < 10; i++) { children.at(-1).emit('close', 1); timers.run(); }
  children.at(-1).emit('close', 1);
  assert.equal(timers.timers[0].delay, 60000, 'backoff caps at 60s');
  timers.run();
  children.at(-1).stdout.emit('data', JSON.stringify({ sessions: [] }) + '\n');
  children.at(-1).emit('close', 1);
  assert.equal(timers.timers[0].delay, BACKOFF[0], 'a good snapshot resets the backoff');
  const before = children.length;
  hosts.close();
  assert.equal(timers.timers[0].cleared, true);
  timers.run(); assert.equal(children.length, before, 'nothing reconnects after close');
}

// ── Federation: never awaits ssh; merged aggregate; remote inspect; local unchanged.
(async () => {
  const localRow = row({ id: 'obs_' + 'c'.repeat(24), sessionId: UUID.replace('0892', '1111'), inspectionIdentity: 'claude:' + UUID.replace('0892', '1111') });
  const local = { get: async () => ({ sessions: [localRow], aggregate: null, health: 'available', observedAt: 5, error: null,
      sources: { herdr: { health: 'available', observedAt: 5, reason: null }, desktop: { health: 'unavailable', observedAt: null, reason: 'x' } }, bus: { health: 'available', messages: [] } }),
    inspect: async id => ({ id, local: true }), inspectMessage: () => ({ local: true }) };
  // A remote that never emits: get() must resolve promptly from the cache with that host unavailable.
  const silent = fakeSpawn();
  const hung = makeRemoteHosts({ remotes: [{ id: 'vm', ssh: 'nick@host' }], spawn: silent.spawn, now: () => 5, setTimer: () => ({}), clearTimer: () => {} });
  const federated = makeFederatedObserver(local, hung, () => 5);
  const started = Date.now();
  const first = await Promise.race([federated.get(), new Promise((_, reject) => setTimeout(() => reject(new Error('get() waited on ssh')), 500))]);
  assert.ok(Date.now() - started < 500);
  assert.equal(first.sources.hosts.vm.health, 'unavailable'); assert.equal(first.sources.hosts.local.health, 'available');
  assert.equal(first.sessions.length, 1); assert.equal(first.sessions[0].host, null);
  assert.equal(first.aggregate.agents.observed, 1);
  // Now the remote speaks.
  silent.children[0].stdout.emit('data', JSON.stringify({ sessions: [row()] }) + '\n');
  const second = await federated.get();
  assert.equal(second.sessions.length, 2); assert.equal(second.sources.hosts.vm.health, 'available'); assert.equal(second.sources.hosts.vm.agents, 1);
  assert.equal(second.aggregate.agents.observed, 2, 'aggregate is recomputed over the merged roster');
  assert.deepEqual(second.bus, { health: 'available', messages: [] }, 'bus stays local');
  const remoteId = second.sessions[1].id;
  const inspected = await federated.inspect(remoteId);
  assert.equal(inspected.health, 'unavailable'); assert.equal(inspected.reason, 'remote-inspect');
  assert.deepEqual(await federated.inspect(localRow.id), { id: localRow.id, local: true });
  federated.close(); assert.equal(silent.children[0].killed, 'SIGTERM'); assert.equal(silent.children[0].stdinEnded, true);

  // ── Remote stream side: one line per tick, written and awaited before the next is scheduled; stop is final.
  const writes = [], ticks = fakeTimers();
  let n = 0;
  const stream = startStream({ observer: { get: async () => ({ sessions: [], n: ++n }) }, write: async value => { writes.push(value); }, setTimer: ticks.setTimer, clearTimer: ticks.clearTimer });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 1); assert.ok(writes[0].endsWith('\n')); assert.equal(JSON.parse(writes[0]).n, 1);
  assert.equal(ticks.timers.length, 1, 'the next tick is scheduled only after the write resolved');
  ticks.run(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes.length, 2);
  stream.stop(); assert.equal(ticks.timers[0].cleared, true);
  // ── Ships: remote rooms get their own slot space and an offset ship; single-host scenes carry no ships at all.
  const Model = require('../frontend/app/observer-model.js'), Scene = require('../frontend/app/observer-scene.js');
  const layout = Model.createLayout();
  const localRows = [row({ id: 'obs_' + '1'.repeat(24), host: null })];
  layout.reconcile(localRows);
  const single = Scene.build(layout.onPage(0), 0, {});
  assert.equal('ships' in single, false, 'no remotes → no hulls, identical scene shape');
  const remoteRows = [row({ id: 'obs_' + '2'.repeat(24), host: 'vm' }), row({ id: 'obs_' + '3'.repeat(24), host: 'vm', projectId: 'prj_' + '9'.repeat(20), project: 'other' })];
  // Same projectId as a local row, different host: still its own room.
  layout.reconcile([...localRows, ...remoteRows]);
  const rooms = layout.onPage(0);
  assert.equal(rooms.length, 3);
  assert.equal(rooms.find(room => !room.host).slot, 0, 'the local room keeps slot 0');
  assert.deepEqual(rooms.filter(room => room.host === 'vm').map(room => room.slot).sort(), [0, 1], 'remote rooms number their own slots');
  const multi = Scene.build(rooms, 0, { hosts: [{ id: 'vm', health: 'stale', observedAt: 1, agents: 2 }, { id: 'empty', health: 'unavailable', reason: 'SSH connection refused', agents: 0 }] });
  assert.equal(multi.ships.length, 3); assert.equal(multi.ships[0].local, true);
  const vmShip = multi.ships[1], emptyShip = multi.ships[2];
  const inside = (rect, hull) => rect.x >= hull.x && rect.x + rect.w <= hull.x + hull.w && rect.y >= hull.y && rect.y + rect.h <= hull.y + hull.h;
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const platform of multi.platforms.filter(p => p.host === 'vm')) assert.ok(inside(platform.rect, vmShip.rect), 'remote rooms sit inside their hull');
  for (const platform of multi.platforms.filter(p => !p.host)) assert.ok(inside(platform.rect, multi.ships[0].rect), 'local rooms sit inside the flagship');
  assert.ok(!overlaps(vmShip.rect, multi.ships[0].rect) && !overlaps(emptyShip.rect, vmShip.rect) && !overlaps(emptyShip.rect, multi.ships[0].rect), 'ships do not overlap');
  assert.ok(vmShip.rect.y >= multi.ships[0].rect.y + multi.ships[0].rect.h && emptyShip.rect.y >= vmShip.rect.y + vmShip.rect.h, 'remote ships dock in a line below the flagship');
  assert.ok(emptyShip.rect.w > 0 && emptyShip.rect.w <= 10 && emptyShip.rect.h <= 10, 'an empty host gets a compact hull just around its dock');
  const flag = multi.ships[0].rect;
  assert.ok(vmShip.rect.y - (flag.y + flag.h) >= 8 && emptyShip.rect.y - (vmShip.rect.y + vmShip.rect.h) >= 8, 'a clear gap between hulls');
  for (const ship of [vmShip, emptyShip]) assert.equal(ship.dock.y, ship.rect.y + 2, 'the dock sits on the hull edge nearest the mailroom');
  const vmRooms = multi.platforms.filter(p => p.host === 'vm');
  assert.ok(vmRooms.some(p => p.rect.y === vmShip.dock.y), 'rooms start right beside the dock');
  const extent = [vmShip.dock, ...vmRooms.map(p => p.rect)], bottom = Math.max(...extent.map(r => r.y + r.h));
  assert.ok(vmShip.rect.y + vmShip.rect.h - bottom <= 6, 'the hull wraps its rooms tightly');
  // Bridges: one per remote ship, a chain up the mailroom corridor, crossing no room.
  assert.equal(single.bridges, undefined, 'no remotes → no bridges');
  assert.equal(multi.bridges.length, 2);
  const [toVm, toEmpty] = multi.bridges;
  assert.deepEqual([toVm.host, toVm.health, toEmpty.host, toEmpty.health], ['vm', 'stale', 'empty', 'unavailable']);
  assert.deepEqual(toVm.from, { x: 7, y: multi.mail.rect.y + multi.mail.rect.h }, 'the first bridge leaves the mailroom');
  assert.deepEqual(toVm.to, { x: 7, y: vmShip.dock.y }, 'and reaches the first dock');
  assert.deepEqual(toEmpty.from, { x: 7, y: vmShip.rect.y + vmShip.rect.h }, 'the next leaves the bottom of the ship above');
  assert.ok(toVm.to.y - flag.y - flag.h <= 14, 'the bridge spans the gap directly, not across an empty hull');
  assert.deepEqual(toEmpty.to, { x: 7, y: emptyShip.dock.y });
  for (const bridge of multi.bridges) for (const platform of multi.platforms) assert.ok(!overlaps(bridge.rect, platform.rect), 'a bridge crosses no room');
  const remoteWorker = multi.workers.find(worker => worker.row.host === 'vm');
  assert.deepEqual(remoteWorker.route.at(-1), multi.mail.hub, 'remote crew route over the bridge to the mailroom');
  assert.deepEqual(remoteWorker.route.at(-2), { x: 7, y: vmShip.dock.y + 2, z: 0 }, 'by way of their own dock');
  assert.ok(multi.bounds.maxY > single.bounds.maxY, 'the camera fits every ship');
  const localCrew = multi.workers.find(worker => !worker.row.host), alone = single.workers.find(worker => worker.id === localCrew.id);
  assert.deepEqual(localCrew.route, alone.route, 'local crew routes are unchanged by remotes');
  assert.notEqual(multi.revision, Scene.build(rooms, 0, { hosts: [{ id: 'vm', health: 'available', agents: 2 }, { id: 'empty', health: 'unavailable', agents: 0 }] }).revision, 'host health is part of the scene revision');
  console.log('observer remotes: fixed ssh argv, option-injection refusal, sanitised host-scoped rows/ids/panes, partial/garbage/oversized/unterminated lines, stale truth, backoff, cache-only federation, remote inspect, local bus, stream flush ordering, per-host room slots, stacked ship hulls and mailroom bridges OK');
})().catch(error => { console.error(error); process.exit(1); });
