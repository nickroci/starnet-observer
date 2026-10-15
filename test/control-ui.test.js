'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ObserverModel = require('../frontend/app/observer-model.js');
const ObserverMail = require('../frontend/app/observer-mail.js');
const ObserverInspector = require('../frontend/app/observer-inspector.js');
const ObserverMailInspector = require('../frontend/app/observer-mail-inspector.js');
const ObserverScene = require('../frontend/app/observer-scene.js');
let document, viewOptions;
function element() {
  return { textContent: '', children: [], hidden: false, dataset: {}, value: '', scrollTop: 0, handlers: {}, attributes: {}, style: { setProperty() {} }, parent: null, disabled: false,
    classList: { toggle() {}, add() {} },
    append(...nodes) { for (const node of nodes) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = this; this.children.push(node); } },
    replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this.append(...nodes); },
    setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }, addEventListener(name, fn) { this.handlers[name] = fn; },
    focus() { document.activeElement = this; }, scrollIntoView() {}, querySelectorAll() { return this.children; },
    insertBefore(node, before) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = this; const at = this.children.indexOf(before); if (at < 0) this.children.push(node); else this.children.splice(at, 0, node); },
    remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
    contains(node) { for (let at = node; at; at = at.parent) if (at === this) return true; return false; },
    open: false, show() { this.open = true; }, showModal() { this.open = true; }, close() { this.open = false; } };
}
(async () => {
  const elements = {};
  const filters = ['all', 'working', 'blocked'].map(value => { const button = element(); button.dataset.filter = value; return button; });
  document = { documentElement: element(), body: element(), activeElement: null, hidden: false, getElementById: id => elements[id] || (elements[id] = element()), createElement: element, addEventListener() {} };
  elements.filters = element(); elements.filters.children = filters;
  const posts = [], confirms = []; const lastPost = () => JSON.stringify(posts.at(-1)); let confirmAnswer = false, listener;
  const context = { console, Date, Set, Map, document, setTimeout: () => 1, clearTimeout() {}, ObserverModel, ObserverMail, ObserverInspector, ObserverMailInspector, ObserverScene, encodeURIComponent,
    ObserverView: { create: options => (viewOptions = options, { setFx() {}, fx() { return true; }, update() {}, focus() {}, overview() {}, zoomBy() {}, start() {}, stop() {}, invalidate() {} }) },
    window: { __OBSERVER_CONTROL__: true, __OBSERVER_THEME__: {}, localStorage: { getItem() { return 'on'; }, setItem() {} }, addEventListener() {}, confirm: message => { confirms.push(message); return confirmAnswer; } },
    SPRITES: { init: async () => ({}) },
    Harness: { api: { get: () => new Promise(() => {}), post: async (path, body) => { posts.push([path, body]); return { ok: true, paneId: 'w1:pX', name: 'spawned' }; } } },
    QuerySpine: { define() {}, invalidate() { return Promise.resolve(); }, subscribe(key, fn) { if (key === 'observer.sessions') listener = fn; return () => {}; } }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/app/observer.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  const sessions = [
    { id: 'obs_' + 'a'.repeat(24), paneId: 'w1:p1', source: 'herdr', project: 'repo', projectId: 'repo1', projectKind: 'repository', provider: 'claude', sessionId: 's1', status: 'working', title: 'Alpha', tool: { available: false } },
    { id: 'obs_' + 'b'.repeat(24), paneId: null, source: 'desktop', project: 'repo', projectId: 'repo1', projectKind: 'repository', provider: 'codex', sessionId: 's2', status: 'idle', title: 'Window', tool: { available: false } }
  ];
  listener({ data: { sessions, health: 'available', observedAt: Date.now() } });
  const group = elements.sessions.children[0], heading = group.children[0], rows = group.children[2].children;
  assert.equal(rows.length, 2);
  const [herdrRow, desktopRow] = rows.map(item => ({ button: item.children[0], inspect: item.children[2], attach: item.children[3], close: item.children[4] }));
  assert.equal(herdrRow.inspect.textContent, '⌕'); assert.equal(herdrRow.attach.textContent, '⇱'); assert.equal(herdrRow.close.textContent, '✕');
  assert.equal(herdrRow.attach.hidden, false); assert.equal(herdrRow.close.hidden, false, 'a live Herdr pane gets attach and close');
  assert.equal(desktopRow.attach.hidden, true); assert.equal(desktopRow.close.hidden, true, 'a desktop window has no pane to act on');
  // Close asks first; a "no" sends nothing.
  herdrRow.close.handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(confirms.length, 1); assert.match(confirms[0], /Stop .*Alpha.* in pane w1:p1\?/); assert.deepEqual(posts, []);
  confirmAnswer = true; herdrRow.close.handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(lastPost(), JSON.stringify(['/api/control/close', { paneId: 'w1:p1' }]), 'vm-realm objects compare by shape');
  herdrRow.attach.handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(lastPost(), JSON.stringify(['/api/control/attach', { paneId: 'w1:p1' }]), 'vm-realm objects compare by shape');
  // Spawn uses the first Herdr pane of the project as the seed, without a confirm.
  const spawn = heading.children.at(-1); assert.equal(spawn.textContent, '+');
  spawn.handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(lastPost(), JSON.stringify(['/api/control/spawn', { paneId: 'w1:p1' }]), 'vm-realm objects compare by shape'); assert.equal(confirms.length, 2);
  assert.equal(elements['control-notice'] ? 1 : document.body.children.length, 1, 'a notice is shown');
  // A stale row hides both actions again.
  listener({ data: { sessions: [{ ...sessions[0], observedAt: Date.now() - 10 * 60 * 1000 }], health: 'available', observedAt: Date.now() } });
  // Remote rows (multi-host hub) get the same actions, posting their host-namespaced pane id.
  const remote = { ...sessions[0], id: 'obs_' + 'c'.repeat(24), paneId: 'herdr-dev-2/w1:p2', host: 'herdr-dev-2', projectId: 'prj_remote', title: 'Remote', observedAt: Date.now() };
  listener({ data: { sessions: [sessions[0], remote], health: 'available', observedAt: Date.now() } });
  const remoteItem = elements.sessions.children.flatMap(section => section.children[2].children).find(item => item.children[0].dataset.sessionId === remote.id);
  assert.equal(remoteItem.children[3].hidden, false, 'a live remote pane gets attach');
  remoteItem.children[3].handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(lastPost(), JSON.stringify(['/api/control/attach', { paneId: 'herdr-dev-2/w1:p2' }]));
  // ── Multi-host panel: host tabs and ship clicks choose whose crew is listed; nothing starts from the canvas.
  assert.equal(typeof viewOptions.onShip, 'function', 'ship clicks are selection targets');
  const hosts = { local: { health: 'available', observedAt: Date.now(), reason: null, agents: 1 }, 'herdr-dev-2': { health: 'available', observedAt: Date.now(), reason: null, agents: 1 }, empty: { health: 'available', observedAt: Date.now(), reason: null, agents: 0 } };
  const blocked = { ...remote, status: 'blocked' };
  const multi = () => listener({ data: { sessions: [sessions[0], blocked], health: 'available', observedAt: Date.now(), sources: { hosts } } });
  multi();
  const tabs = elements['host-tabs'];
  assert.equal(tabs.hidden, false); assert.deepEqual(tabs.children.map(tab => tab.dataset.host), ['', 'empty', 'herdr-dev-2'], 'one tab per host, this machine first');
  assert.equal(tabs.children[0].attributes['aria-selected'], 'true'); assert.equal(elements['crew-title'].textContent, 'This machine crew');
  const listed = () => elements.sessions.children.flatMap(section => section.children[2].children).map(item => item.children[0].dataset.sessionId);
  assert.deepEqual(listed(), [sessions[0].id], 'this machine lists only local rows');
  assert.equal(elements['host-spawn'].hidden, true, 'no "New agent in ~" row for a local host that has agents');
  const confirmsBefore = confirms.length, postsBefore = posts.length;
  viewOptions.onShip('herdr-dev-2');
  assert.equal(posts.length, postsBefore, 'a ship click starts nothing'); assert.equal(confirms.length, confirmsBefore, 'and asks nothing');
  assert.equal(elements['crew-title'].textContent, 'herdr-dev-2 crew'); assert.equal(viewOptions.hostSelection(), 'herdr-dev-2');
  assert.deepEqual(listed(), [remote.id], 'the panel switches to that host');
  assert.match(elements['host-health'].textContent, /^Live · 1 agent$/);
  // Blocked: the row reads "waiting for input", carries the attach hint and a prominent attach button.
  const blockedItem = elements.sessions.children.flatMap(section => section.children[2].children)[0];
  assert.equal(blockedItem.title, 'Waiting for input — press ⇱ to attach'); assert.match(blockedItem.className, /needs-input/);
  assert.match(blockedItem.children[3].className, /prominent/);
  const walk = node => [node, ...(node.children || []).flatMap(walk)], statusNode = walk(blockedItem).find(node => /^status /.test(node.className || ''));
  assert.ok(statusNode, 'fixture: the row has a status chip'); assert.equal(statusNode.textContent, 'waiting for input');
  // "New agent in ~" on a remote host posts spawn-host for that host; the panel then selects the agent when it appears.
  const spawnRow = elements['host-spawn']; assert.equal(spawnRow.hidden, false); assert.equal(spawnRow.children[0].textContent, 'New agent in ~');
  spawnRow.children[1].handlers.click(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(lastPost(), JSON.stringify(['/api/control/spawn-host', { host: 'herdr-dev-2' }]));
  assert.doesNotMatch(elements['control-notice']?.textContent || document.body.children.at(-1).textContent, /terminal/i, 'spawn never says a terminal is opening');
  // The fake returns paneId 'w1:pX': once a row with that pane appears, it is selected (and the panel follows its host).
  const spawned = { ...sessions[0], id: 'obs_' + 'd'.repeat(24), paneId: 'w1:pX', title: 'Spawned', observedAt: Date.now() };
  listener({ data: { sessions: [sessions[0], blocked, spawned], health: 'available', observedAt: Date.now(), sources: { hosts } } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['crew-title'].textContent, 'This machine crew', 'selecting the spawned local agent switches the panel to its host');
  // Host tab click and an empty host: its "New agent in ~" row is the way in.
  tabs.children.find(tab => tab.dataset.host === 'empty').handlers.click();
  assert.equal(elements['crew-title'].textContent, 'empty crew'); assert.deepEqual(listed(), []);
  assert.equal(elements['host-spawn'].hidden, false); assert.equal(elements.empty.textContent, 'No sessions on empty.');
  // A host that disappears falls back to this machine.
  listener({ data: { sessions: [sessions[0]], health: 'available', observedAt: Date.now(), sources: { hosts: { local: hosts.local, 'herdr-dev-2': hosts['herdr-dev-2'] } } } });
  assert.equal(elements['crew-title'].textContent, 'This machine crew');
  // Selecting a remote agent on the canvas switches the panel to its host.
  listener({ data: { sessions: [sessions[0], blocked], health: 'available', observedAt: Date.now(), sources: { hosts: { local: hosts.local, 'herdr-dev-2': hosts['herdr-dev-2'] } } } });
  viewOptions.onSelect(blocked.id);
  assert.equal(elements['crew-title'].textContent, 'herdr-dev-2 crew');
  console.log('control UI: buttons only on live Herdr panes, close confirms first, attach/close/spawn post the shown pane id, remote rows, host tabs/ship selection, blocked hint, New agent in ~ and spawn-then-select OK');
})().catch(error => { console.error(error); process.exit(1); });
