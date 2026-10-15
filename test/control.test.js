'use strict';
const assert = require('node:assert/strict');
const { makeControl } = require('../sidecar/control.js');
const { createServer } = require('../server.js');
(async () => {
  // ---- sidecar: every action goes through Herdr, invalid targets never reach a process ----
  const calls = [];
  const replies = { 'agent get w1:p2': { result: { agent: { name: 'alpha' } } }, 'agent get w1:p9': { error: { message: 'agent not found' } },
    'pane get w1:p2': { result: { pane: { cwd: '/Users/x/dev/proj', workspace_id: 'w1' } } },
    'tab create': { result: { root_pane: { pane_id: 'w1:p3' } } }, 'agent start': { error: { message: 'blocked during startup' } }, 'agent get w1:p3': { result: { agent: { name: 'proj-120000' } } },
    'pane close w1:p2': { result: { type: 'ok' } } };
  const execute = async (command, args) => {
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
  assert.equal(calls[1][0], 'osascript'); assert.match(calls[1][2], /^tell application "Terminal"\nlaunch\ndo script "herdr agent attach w1:p2 --takeover"\nactivate\nend tell$/);
  await assert.rejects(control.close('w1:p9'), /agent not found/);
  assert.ok(!calls.some(call => call[1] === 'pane' && call[2] === 'close'), 'a pane without an agent is never closed');
  calls.length = 0;
  const spawned = await control.spawn('w1:p2');
  assert.deepEqual(spawned, { ok: true, action: 'spawn', paneId: 'w1:p3', name: 'proj-120000', project: 'proj' });
  const order = calls.map(call => call.slice(0, 3).join(' '));
  assert.deepEqual(order, ['herdr pane get', 'herdr tab create', 'herdr pane wait-output', 'herdr agent start', 'herdr agent get', 'osascript -e tell application "Terminal"\nlaunch\ndo script "herdr agent attach w1:p3 --takeover"\nactivate\nend tell']);
  const start = calls.find(call => call[1] === 'agent' && call[2] === 'start');
  assert.deepEqual(start.slice(3), ['proj-120000', '--kind', 'claude', '--pane', 'w1:p3', '--timeout', '60000', '--', '--dangerously-skip-permissions']);
  assert.deepEqual(calls[1].slice(3), ['--workspace', 'w1', '--cwd', '/Users/x/dev/proj', '--label', 'proj-120000', '--no-focus']);
  calls.length = 0;
  assert.deepEqual(await control.close('w1:p2'), { ok: true, action: 'close', paneId: 'w1:p2', name: 'alpha' });
  assert.deepEqual(calls.map(call => call.slice(1, 3).join(' ')), ['agent get', 'pane close']);
  await assert.rejects(makeControl({ execute, platform: 'linux' }).attach('w1:p2'), /only implemented on macOS/);
  // Overseer: refuses a second one, writes the brief once, starts in its own workspace, attaches.
  const files = new Map(), fsFake = { async mkdir(dir) { files.set(dir, 'dir'); }, async access(file) { if (!files.has(file)) throw new Error('ENOENT'); }, async writeFile(file, body) { files.set(file, body); } };
  replies['agent get overseer'] = { error: { message: 'agent not found' } }; replies['workspace create'] = { result: { root_pane: { pane_id: 'w9:p1' } } }; replies['agent get w9:p1'] = { result: { agent: { name: 'overseer' } } };
  const home = '/tmp/obs-test/overseer', boss = makeControl({ execute, platform: 'darwin', overseerHome: home, fs: fsFake, sleep: async () => {} });
  calls.length = 0;
  const seated = await boss.overseer();
  assert.deepEqual(seated, { ok: true, action: 'overseer', paneId: 'w9:p1', name: 'overseer', home });
  assert.match(files.get(home + '/CLAUDE.md'), /^# Overseer/); assert.match(files.get(home + '/CLAUDE.md'), /herdr --skill/);
  assert.deepEqual(calls.map(call => call.slice(0, 3).join(' ')).slice(0, 5), ['herdr agent get', 'herdr workspace create', 'herdr pane wait-output', 'herdr agent start', 'herdr agent get']);
  assert.deepEqual(calls[1].slice(3), ['--workspace'].slice(0, 0).concat(['--cwd', home, '--label', 'overseer', '--no-focus']));
  assert.deepEqual(calls[3].slice(3, 5), ['overseer', '--kind']);
  assert.match(calls.at(-1)[2], /herdr agent attach w9:p1 --takeover/);
  files.set(home + '/CLAUDE.md', 'edited by user'); replies['agent get overseer'] = { result: { agent: { name: 'overseer', pane_id: 'w9:p1' } } };
  await assert.rejects(boss.overseer(), error => error.status === 409 && error.paneId === 'w9:p1');
  assert.equal(files.get(home + '/CLAUDE.md'), 'edited by user', 'an existing brief is never overwritten');

  // ---- remote hosts: herdr runs over ssh, only for configured remotes, every argument validated and single-quoted ----
  {
    const rcalls = [];
    const rreplies = { 'agent get w1:p2': { result: { agent: { name: 'beta' } } }, 'pane get w1:p2': { result: { pane: { cwd: '/home/nick/proj', workspace_id: 'w1' } } },
      'tab create': { result: { root_pane: { pane_id: 'w1:p4' } } }, 'workspace create': { result: { root_pane: { pane_id: 'w2:p1' } } },
      'workspace list': { result: { workspaces: [{ label: 'proj', workspace_id: 'w1' }] } }, 'agent start': { result: { type: 'ok' } }, 'pane close w1:p2': { result: { type: 'ok' } } };
    const unq = word => word.replace(/^'(.*)'$/, '$1');
    const rexec = async (command, args) => {
      rcalls.push([command, ...args]);
      if (command === 'osascript') return { stdout: '' };
      if (command === 'ssh' && args.at(-1) === 'printf %s "$HOME"') return { stdout: '/home/nick' };
      const words = command === 'ssh' ? args.at(-1).split(' ').slice(2).map(unq) : args;
      if (words[0] === 'pane' && words[1] === 'wait-output') return { stdout: '{}' };
      const key = words.slice(0, 3).join(' '), short = words.slice(0, 2).join(' ');
      return { stdout: JSON.stringify(rreplies[key] || rreplies[short] || { error: { message: 'unexpected ' + key } }) };
    };
    const remote = makeControl({ execute: rexec, platform: 'darwin', claudeArgs: ['--dangerously-skip-permissions'], now: () => new Date('2026-10-14T12:00:00').getTime(), sleep: async () => {},
      remotes: [{ id: 'herdr-dev-2', ssh: 'nick@34.153.167.160' }] });
    for (const bad of ['herdr-dev-1/w1:p2', 'nope/w1:p2', 'herdr-dev-2/w1;id', "herdr-dev-2/w1'p2", 'herdr-dev-2/$(id)']) await assert.rejects(remote.attach(bad), error => error.status === 400, bad);
    await assert.rejects(remote.spawnHost('herdr-dev-1', null), error => error.status === 400, 'an unlisted host is refused');
    for (const folder of ['../etc', '~/a/../b', 'rel/path', '~/a b', "~/a'b", '~/$(id)', '~/a;b', 'x'.repeat(300)]) await assert.rejects(remote.spawnHost('herdr-dev-2', folder), error => error.status === 400, folder);
    assert.equal(rcalls.length, 0, 'invalid hosts, panes and folders never execute anything');
    assert.deepEqual(await remote.attach('herdr-dev-2/w1:p2'), { ok: true, action: 'attach', paneId: 'herdr-dev-2/w1:p2', name: 'beta' });
    assert.deepEqual(rcalls[0], ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', 'nick@34.153.167.160',
      `PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH" herdr 'agent' 'get' 'w1:p2'`]);
    assert.equal(rcalls[1][0], 'osascript');
    assert.equal(rcalls[1][2], `tell application "Terminal"\nlaunch\ndo script "ssh -t nick@34.153.167.160 'PATH=$HOME/.local/bin:$PATH herdr agent attach w1:p2 --takeover'"\nactivate\nend tell`);
    rcalls.length = 0;
    assert.deepEqual(await remote.spawn('herdr-dev-2/w1:p2'), { ok: true, action: 'spawn', paneId: 'herdr-dev-2/w1:p4', name: 'proj-120000', project: 'proj' });
    assert.ok(rcalls.every(call => call[0] === 'ssh' || call[0] === 'osascript'), 'remote spawn never runs local herdr');
    assert.ok(rcalls.some(call => call.at(-1).endsWith(`'agent' 'start' 'proj-120000' '--kind' 'claude' '--pane' 'w1:p4' '--timeout' '60000' '--' '--dangerously-skip-permissions'`)));
    rcalls.length = 0;
    // Host-level spawn: home by default; an existing workspace labelled after the folder is reused, else one is created.
    assert.deepEqual(await remote.spawnHost('herdr-dev-2', '~/proj'), { ok: true, action: 'spawn-host', host: 'herdr-dev-2', paneId: 'herdr-dev-2/w1:p4', name: 'proj-120000', folder: '/home/nick/proj' });
    assert.ok(rcalls.some(call => call.at(-1).endsWith(`'tab' 'create' '--workspace' 'w1' '--cwd' '/home/nick/proj' '--label' 'proj-120000' '--no-focus'`)));
    rcalls.length = 0;
    const home = await remote.spawnHost('herdr-dev-2', null);
    assert.equal(home.folder, '/home/nick'); assert.equal(home.paneId, 'herdr-dev-2/w2:p1');
    assert.ok(rcalls.some(call => call.at(-1).endsWith(`'workspace' 'create' '--cwd' '/home/nick' '--label' 'nick' '--no-focus'`)));
    assert.ok(!rcalls.some(call => call.at(-1) === 'printf %s "$HOME"'), 'the remote home is looked up once and cached');
    rcalls.length = 0;
    assert.deepEqual(await remote.close('herdr-dev-2/w1:p2'), { ok: true, action: 'close', paneId: 'herdr-dev-2/w1:p2', name: 'beta' });
    assert.ok(rcalls.at(-1).at(-1).endsWith(`herdr 'pane' 'close' 'w1:p2'`));
    // A local control without remotes refuses every namespaced id.
    await assert.rejects(control.attach('herdr-dev-2/w1:p2'), error => error.status === 400);
    await assert.rejects(control.spawnHost('herdr-dev-2', null), error => error.status === 400);
  }

  // ---- server: control routes exist only with a control object, need the token, validate the body ----
  const observer = { async get() { return { health: 'available', sessions: [] }; }, async inspect() { return {}; }, inspectMessage() { return {}; } };
  const hits = [];
  const fake = { spawnHost: async (host, folder) => (hits.push(['spawn-host', host, folder]), { ok: true }), attach: async id => (hits.push(['attach', id]), { ok: true }), spawn: async id => (hits.push(['spawn', id]), { ok: true }), close: async () => { throw Object.assign(new Error('no-agent-in-pane'), { status: 400 }); }, overseer: async () => { hits.push(['overseer']); throw Object.assign(new Error('overseer-exists'), { status: 409, paneId: 'w9:p1' }); } };
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
    // A remote row's pane id is host-namespaced ("vm/w1:p2"): the server passes it to control, which knows the hosts.
    for (const bad of ['Herdr-Dev/w1:p2', 'a/b/w1:p2', '-o/w1:p2', 'vm/w1 p2', '/w1:p2']) assert.equal((await post(on.base, '/api/control/attach', { paneId: bad })).status, 400, 'malformed host prefix ' + bad);
    assert.equal((await post(on.base, '/api/control/attach', { paneId: 'herdr-dev-2/w1:p2' })).status, 200);
    assert.equal((await post(on.base, '/api/control/spawn-host', { host: 7 })).status, 400, 'host must be a string or null');
    assert.equal((await post(on.base, '/api/control/spawn-host', { host: 'herdr-dev-2', folder: ['~'] })).status, 400, 'folder must be a string');
    assert.equal((await post(on.base, '/api/control/spawn-host', { host: 'herdr-dev-2', folder: '~/proj' })).status, 200);
    assert.equal((await post(on.base, '/api/control/spawn-host', [])).status, 400, 'body must be an object');
    assert.equal((await post(on.base, '/api/control/attach', { paneId: 'w1:p2' }, { 'Content-Type': 'text/plain' })).status, 400);
    assert.equal((await post(on.base, '/api/control/reboot', { paneId: 'w1:p2' })).status, 405);
    assert.equal((await fetch(on.base + '/api/control/attach', { headers: { 'X-Observer-Token': 't' } })).status, 404, 'GET never reaches an action');
    assert.equal((await post(on.base, '/api/control/attach', { paneId: 'w1:p2' })).status, 200);
    assert.equal((await post(on.base, '/api/control/spawn', { paneId: 'w1:p2' })).status, 200);
    const closed = await post(on.base, '/api/control/close', { paneId: 'w1:p2' });
    assert.equal(closed.status, 400); assert.deepEqual(await closed.json(), { error: 'no-agent-in-pane' });
    assert.equal((await post(on.base, '/api/control/attach', { paneId: 'w1:p2' }, { Origin: 'http://evil.example' })).status, 403);
    const boss = await post(on.base, '/api/control/overseer', {}); assert.equal(boss.status, 409); assert.deepEqual(await boss.json(), { error: 'overseer-exists', paneId: 'w9:p1' });
    assert.deepEqual(hits, [['attach', 'herdr-dev-2/w1:p2'], ['spawn-host', 'herdr-dev-2', '~/proj'], ['attach', 'w1:p2'], ['spawn', 'w1:p2'], ['overseer']]);
    assert.equal((await post(on.base, '/api/observer/sessions', {})).status, 405, 'observer routes stay GET-only');
  } finally { on.server.close(); on.server.closeAllConnections(); }
  console.log('control: overseer brief/409, pane validation, Herdr-gated close, spawn command order, terminal launch, opt-in routes, token/origin/body guards OK');
})().catch(error => { console.error(error); process.exit(1); });
