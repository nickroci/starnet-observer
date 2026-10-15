'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { makeOverseerState } = require('../sidecar/overseer-state.js');
const { makeControl } = require('../sidecar/control.js');
const { createServer } = require('../server.js');
(async () => {
  // ---- sidecar: every action goes through Herdr, invalid targets never reach a process ----
  const calls = [];
  const replies = { 'agent get w1:p2': { result: { agent: { name: 'alpha' } } }, 'agent get w1:p9': { error: { message: 'agent not found' } },
    'pane get w1:p2': { result: { pane: { cwd: '/Users/x/dev/proj', workspace_id: 'w1' } } },
    'tab create': { result: { root_pane: { pane_id: 'w1:p3' } } }, 'agent start': { error: { message: 'blocked during startup' } }, 'agent get w1:p3': { result: { agent: { name: 'proj-120000' } } },
    'pane close w1:p2': { result: { type: 'ok' } } };
  const execute = async (command, args, settings) => {
    assert.equal(typeof settings.env.HERDR_SOCKET_PATH, 'string');
    assert.equal(settings.env.STARNET_TEST_TOKEN, undefined);
    calls.push([command, ...args]);
    if (command === 'osascript') return { stdout: '' };
    if (args[0] === 'pane' && args[1] === 'wait-output') return { stdout: '{}' };
    const key = [args[0], args[1], args[2]].join(' '), short = [args[0], args[1]].join(' ');
    return { stdout: JSON.stringify(replies[key] || replies[short] || { error: { message: 'unexpected ' + key } }) };
  };
  const control = makeControl({ execute, platform: 'darwin', claudeArgs: ['--dangerously-skip-permissions'], now: () => new Date('2026-10-14T12:00:00').getTime(), sleep: async () => {} });
  await assert.rejects(control.attach('w1;rm -rf'), error => error.status === 400);
  await assert.rejects(control.close('../x'), error => error.status === 400);
  assert.equal(calls.length, 0, 'invalid pane ids never execute anything');
  assert.deepEqual(await control.attach('w1:p2'), { ok: true, action: 'attach', paneId: 'w1:p2', name: 'alpha' });
  assert.deepEqual(calls[0], ['herdr', 'agent', 'get', 'w1:p2']);
  assert.equal(calls[1][0], 'osascript'); assert.match(calls[1][2], /HERDR_SOCKET_PATH=.*herdr agent attach w1:p2 --takeover/);
  await assert.rejects(control.close('w1:p9'), /agent not found/);
  assert.ok(!calls.some(call => call[1] === 'pane' && call[2] === 'close'), 'a pane without an agent is never closed');
  calls.length = 0;
  const spawned = await control.spawn('w1:p2');
  assert.deepEqual(spawned, { ok: true, action: 'spawn', paneId: 'w1:p3', name: 'proj-120000', project: 'proj' });
  const order = calls.map(call => call.slice(0, 3).join(' '));
  assert.deepEqual(order, ['herdr pane get', 'herdr tab create', 'herdr pane wait-output', 'herdr agent start', 'herdr agent get', 'osascript -e ' + calls.at(-1)[2]]);
  const start = calls.find(call => call[1] === 'agent' && call[2] === 'start');
  assert.deepEqual(start.slice(3), ['proj-120000', '--kind', 'claude', '--pane', 'w1:p3', '--timeout', '60000', '--', '--dangerously-skip-permissions']);
  assert.deepEqual(calls[1].slice(3), ['--workspace', 'w1', '--cwd', '/Users/x/dev/proj', '--label', 'proj-120000', '--no-focus']);
  calls.length = 0;
  assert.deepEqual(await control.close('w1:p2'), { ok: true, action: 'close', paneId: 'w1:p2', name: 'alpha' });
  assert.deepEqual(calls.map(call => call.slice(1, 3).join(' ')), ['agent get', 'pane close']);
  await assert.rejects(makeControl({ execute, platform: 'linux' }).attach('w1:p2'), /only implemented on macOS/);
  // Real private persistence, fake Herdr boundary: no desktop mutation runs.
  const previousSecret = process.env.STARNET_TEST_TOKEN; process.env.STARNET_TEST_TOKEN = 'private-canary';
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'observer-control-'));
  const endpoint = '/fixture/overseer.sock';
  const identity = { pane_id: 'w9:p1', workspace_id: 'w9', terminal_id: 't9', agent: 'claude', name: 'renamed' };
  replies['workspace create'] = { result: { root_pane: { pane_id: 'w9:p1' } } };
  replies['agent get w9:p1'] = { result: { agent: identity } };
  replies['pane get w9:p1'] = { result: { pane: identity } };
  replies['agent list'] = { result: { agents: [identity] } };
  const settings = { execute, platform: 'darwin', overseerHome: home, endpoint, sleep: async () => {} };
  try {
    assert.throws(() => makeControl({ ...settings, overseerState: makeOverseerState({ file: path.join(home, 'identity.json'), endpoint: '/foreign.sock' }) }), /overseer-unavailable/);
    calls.length = 0;
    let announceWorkspace, releaseWorkspace;
    const workspaceStarted = new Promise(resolve => { announceWorkspace = resolve; });
    const workspaceGate = new Promise(resolve => { releaseWorkspace = resolve; });
    const boss = makeControl({ ...settings, execute: async (command, args, options) => {
      if (args[0] === 'workspace' && args[1] === 'create') { announceWorkspace(); await workspaceGate; }
      return execute(command, args, options);
    } });
    const concurrent = boss.overseer();
    await workspaceStarted;
    try { await assert.rejects(makeControl(settings).overseer(), /overseer-unavailable/); }
    finally { releaseWorkspace(); }
    assert.deepEqual(await concurrent, { ok: true, action: 'overseer', paneId: 'w9:p1', name: 'overseer', home });
    assert.match(await fs.readFile(path.join(home, 'CLAUDE.md'), 'utf8'), /^# Overseer/);
    assert.equal(calls.filter(call => call[1] === 'workspace' && call[2] === 'create').length, 1);
    await fs.writeFile(path.join(home, 'CLAUDE.md'), 'edited by user');
    await assert.rejects(makeControl(settings).overseer(), error => error.status === 409 && error.paneId === 'w9:p1');
    assert.equal(await fs.readFile(path.join(home, 'CLAUDE.md'), 'utf8'), 'edited by user');
    const before = calls.length;
    replies['agent list'] = { result: { agents: [{ ...identity, terminal_id: 'reused' }] } };
    await assert.rejects(makeControl(settings).overseer(), /overseer-unavailable/);
    assert.equal(calls.slice(before).some(call => call[1] === 'workspace'), false);
    replies['agent get w9:p1'] = { result: { agent: { ...identity, workspace_id: 'foreign' } } };
    await assert.rejects(boss.attach('w9:p1'), /overseer-unavailable/);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
    if (previousSecret === undefined) delete process.env.STARNET_TEST_TOKEN; else process.env.STARNET_TEST_TOKEN = previousSecret;
  }
  await uncertainOverseer();

  // ---- server: control routes exist only with a control object, need the token, validate the body ----
  const observer = { async get() { return { health: 'available', sessions: [] }; }, async inspect() { return {}; }, inspectMessage() { return {}; } };
  const hits = [];
  const fake = { attach: async id => (hits.push(['attach', id]), { ok: true }), spawn: async id => (hits.push(['spawn', id]), { ok: true }), close: async () => { throw Object.assign(new Error('no-agent-in-pane'), { status: 400 }); }, overseer: async () => { hits.push(['overseer']); throw Object.assign(new Error('overseer-exists'), { status: 409, paneId: 'w9:p1' }); } };
  const serve = async (control) => { const server = createServer({ observer, token: 't', control }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return { server, base: 'http://127.0.0.1:' + server.address().port }; };
  const post = (base, path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'X-Observer-Token': 't', 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const off = await serve(null);
  try {
    assert.equal((await post(off.base, '/api/control/attach', { paneId: 'w1:p2' })).status, 405, 'read-only server refuses control POSTs');
    assert.match(await (await fetch(off.base + '/')).text(), /__OBSERVER_CONTROL__=false/);
  } finally { off.server.close(); off.server.closeAllConnections(); }
  const on = await serve(fake);
  try {
    assert.match(await (await fetch(on.base + '/')).text(), /__OBSERVER_CONTROL__=true/);
    assert.equal((await post(on.base, '/api/control/attach', { paneId: 'w1:p2' }, { 'X-Observer-Token': 'wrong' })).status, 403);
    assert.equal((await post(on.base, '/api/control/attach', 'not json')).status, 400);
    assert.equal((await post(on.base, '/api/control/attach', { paneId: 'w1 p2' })).status, 400);
    assert.equal((await post(on.base, '/api/control/attach', { paneId: 'w1:p2' }, { 'Content-Type': 'text/plain' })).status, 400);
    assert.equal((await post(on.base, '/api/control/reboot', { paneId: 'w1:p2' })).status, 405);
    assert.equal((await fetch(on.base + '/api/control/attach', { headers: { 'X-Observer-Token': 't' } })).status, 404, 'GET never reaches an action');
    assert.equal((await post(on.base, '/api/control/attach', { paneId: 'w1:p2' })).status, 200);
    assert.equal((await post(on.base, '/api/control/spawn', { paneId: 'w1:p2' })).status, 200);
    const closed = await post(on.base, '/api/control/close', { paneId: 'w1:p2' });
    assert.equal(closed.status, 400); assert.deepEqual(await closed.json(), { error: 'no-agent-in-pane' });
    assert.equal((await post(on.base, '/api/control/attach', { paneId: 'w1:p2' }, { Origin: 'http://evil.example' })).status, 403);
    const boss = await post(on.base, '/api/control/overseer', {}); assert.equal(boss.status, 409); assert.deepEqual(await boss.json(), { error: 'overseer-exists', paneId: 'w9:p1' });
    assert.deepEqual(hits, [['attach', 'w1:p2'], ['spawn', 'w1:p2'], ['overseer']]);
    assert.equal((await post(on.base, '/api/observer/sessions', {})).status, 405, 'observer routes stay GET-only');
  } finally { on.server.close(); on.server.closeAllConnections(); }
  console.log('control: overseer brief/409, pane validation, Herdr-gated close, spawn command order, terminal launch, opt-in routes, token/origin/body guards OK');
})().catch(error => { console.error(error); process.exit(1); });

async function uncertainOverseer() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'observer-uncertain-'));
  const endpoint = '/fixture/pinned.sock', calls = [];
  let missing = false, valid = false;
  const identity = { pane_id: 'target', workspace_id: 'work', terminal_id: 'term', agent: 'claude' };
  const execute = async (command, args, settings) => {
    calls.push([command, ...args]);
    assert.equal(settings.env.HERDR_SOCKET_PATH, endpoint);
    const key = args.slice(0, 2).join(' ');
    const reply = result => ({ stdout: JSON.stringify({ result }) });
    if (command === 'osascript') return { stdout: '' };
    if (key === 'workspace create') return reply({ root_pane: { pane_id: 'target' } });
    if (key === 'pane wait-output' || key === 'agent start') return reply({});
    if (key === 'agent get') return reply({ agent: valid ? identity : { ...identity, terminal_id: null } });
    if (key === 'pane get') {
      if (missing) { missing = false; throw Object.assign(new Error('CLI exit 1'), { stdout: JSON.stringify({ error: { code: 'pane_not_found', message: 'pane target not found' } }) }); }
      return reply({ pane: identity });
    }
    if (key === 'agent list') return reply({ agents: [] });
    throw Error('unexpected call');
  };
  const options = { execute, endpoint, platform: 'darwin', overseerHome: home, sleep: async () => {} };
  try {
    await assert.rejects(makeControl(options).overseer(), /overseer-unavailable/);
    assert.equal(calls.some(call => call[0] === 'osascript'), false, 'unverified launch is never attached');
    const created = () => calls.filter(call => call[1] === 'workspace' && call[2] === 'create').length;
    await assert.rejects(makeControl(options).overseer(), /overseer-unavailable/);
    assert.equal(created(), 1, 'uncertain launch survives observer/control restart');
    missing = true; valid = true;
    await makeControl(options).overseer();
    assert.equal(created(), 2, 'only confirmed missing pane permits replacement');
  } finally { await fs.rm(home, { recursive: true, force: true }); }
}
