'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ObserverModel = require('../frontend/app/observer-model.js');
const ObserverMail = require('../frontend/app/observer-mail.js');
const ObserverInspector = require('../frontend/app/observer-inspector.js');
const ObserverMailInspector = require('../frontend/app/observer-mail-inspector.js');
const ObserverScene = require('../frontend/app/observer-scene.js');
let document;
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
    ObserverView: { create: () => ({ setFx() {}, fx() { return true; }, update() {}, focus() {}, overview() {}, zoomBy() {}, start() {}, stop() {}, invalidate() {} }) },
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
  console.log('control UI: buttons only on live Herdr panes, close confirms first, attach/close/spawn post the shown pane id OK');
})().catch(error => { console.error(error); process.exit(1); });
