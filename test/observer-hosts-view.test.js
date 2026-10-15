'use strict';
const assert = require('node:assert/strict');
const Model = require('../frontend/app/observer-model.js');
const Scene = require('../frontend/app/observer-scene.js');
const View = require('../frontend/app/observer-view.js');

// Multi-host view: ship clicks select a host (floor or label), blocked agents carry a "!" attention badge.
function context() {
  const target = { texts: [], fillText(text) { target.texts.push(String(text)); }, measureText: text => ({ width: String(text).length * 7 }), createRadialGradient: () => ({ addColorStop() {} }), getContext() { return target; } };
  return new Proxy(target, { get: (t, key) => key in t ? t[key] : () => {}, set: (t, key, value) => { t[key] = value; return true; } });
}
function canvas(width = 1000, height = 700) {
  const ctx = context(), handlers = new Map();
  return { ctx, handlers, clientWidth: width, clientHeight: height, width: 0, height: 0, style: {}, getContext: () => ctx,
    addEventListener(name, fn) { handlers.set(name, fn); }, removeEventListener(name) { handlers.delete(name); }, getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} };
}
const row = (id, extra) => ({ id, project: 'P', projectId: 'p', projectKind: 'group', repo: 'r', repoId: 'r', provider: 'claude', status: 'idle', ...extra });

assert.equal(View.needsAttention({ row: { status: 'blocked' } }, false), true);
assert.equal(View.needsAttention({ row: { status: 'blocked' } }, true), false, 'a stale blocked row is last known, not a live alarm');
for (const status of ['working', 'idle', 'done', 'unknown']) assert.equal(View.needsAttention({ row: { status } }, false), false, status);
{
  const fills = []; const ctx = new Proxy({ fillRect: (...args) => fills.push(args) }, { get: (t, key) => key in t ? t[key] : () => {}, set: (t, key, value) => { t[key] = value; return true; } });
  const box = View.paintAttention(ctx, 100, 50);
  assert.ok(fills.length >= 6, 'the badge is built from pixel rectangles');
  assert.ok(box.left < 100 && box.left + box.width > 100 && box.top + box.height <= 50 + 1, 'centred above the anchor');
}

const layout = Model.createLayout();
const rows = [row('obs_local', { status: 'working' }), row('obs_blocked', { host: 'vm', status: 'blocked' }), row('obs_idle', { host: 'vm', status: 'idle' })];
layout.reconcile(rows);
const hosts = [{ id: 'vm', health: 'available', agents: 2, mail: { mode: 'relay', observed: 'none', lastRelayedAt: null } }, { id: 'empty', health: 'stale', observedAt: 1, agents: 0 }];
const scene = Scene.build(layout.onPage(0), 0, { hosts });
assert.equal(scene.links.length, 2, 'fixture: an observation link per remote ship'); assert.equal(scene.relays.length, 1, 'fixture: one relay-configured host');
const node = canvas(), ships = [];
let now = 0, chosenHost = null; const staleIds = new Set();
const view = View.create({ canvas: node, nameFor: id => id, onShip: host => { ships.push(host); chosenHost = host; }, hostSelection: () => chosenHost,
  env: { raf: () => 1, caf() {}, now: () => now, dpr: () => 1, createCanvas: () => canvas(), sprites: { drawBody: (ctx, body) => ({ top: body.py - 19, w: 10, h: 19 }) } } });
view.start();
view.update(scene, { mailFrame: () => ({ drones: [], envelopes: [] }), rowStale: worker => staleIds.has(worker.id) });
view.overview(); now += 16; view.paint(now);
assert.equal(View.lodFor(view.camera().zoom), 'overview', 'fixture: whole multi-ship station at overview zoom');
assert.deepEqual(view.attentionRegions().map(region => region.id), ['obs_blocked'], 'only the blocked agent gets a badge, visible at overview');
staleIds.add('obs_blocked'); now += 16; view.paint(now);
assert.deepEqual(view.attentionRegions(), [], 'a stale blocked row has no badge');
staleIds.clear(); now += 16; view.paint(now);
assert.equal(view.attentionRegions().length, 1);

// The remote ship's own label is drawn at overview and still when zoomed onto its room (it outranks room signs and is
// clamped into view while the hull is on screen).
const labelled = () => node.ctx.texts.some(text => /^● VM · 2 agents/.test(text));
node.ctx.texts.length = 0; now += 16; view.paint(now);
assert.ok(labelled(), 'remote ship label at overview');
const drawn = text => node.ctx.texts.includes(text);
assert.ok(drawn('ssh · observing'), 'a live host\'s observation link says what it is');
assert.ok(drawn('ssh · stale'), 'a stale host\'s link shows its real state');
assert.ok(drawn('relay configured · not seen'), 'a configured but unobserved relay says so');
assert.ok(!drawn('relay · mail'), 'and is never drawn as a working mail link');
const vmRoom = scene.platforms.find(platform => platform.host === 'vm');
assert.ok(view.focusPlatform(vmRoom.key)); node.ctx.texts.length = 0; now += 16; view.paint(now);
assert.ok(labelled(), 'remote ship label when zoomed onto its room'); assert.ok(node.ctx.texts.some(text => /^P · 2/.test(text)), 'and the room sign survives');
view.overview(); now += 16; view.paint(now);
// Ship clicks: anywhere on an empty hull floor (or its label) selects that host; the flagship floor selects this machine.
const click = point => { const at = Scene.toScreen(point, view.camera()), event = { clientX: at.x, clientY: at.y, pointerId: 1, pointerType: 'mouse', preventDefault() {} };
  node.handlers.get('pointerdown')(event); node.handlers.get('pointerup')(event); now += 400; view.paint(now); };
const empty = scene.ships.find(ship => ship.id === 'empty'), flagship = scene.ships.find(ship => ship.local);
click({ x: empty.mail.rect.x + 2, y: empty.mail.rect.y + empty.mail.rect.h - 2 });
assert.deepEqual(ships, ['empty'], 'a remote hull floor click selects that host');
click({ x: flagship.rect.x + 2, y: flagship.rect.y + flagship.rect.h - 2 });
assert.deepEqual(ships, ['empty', null], 'the flagship floor selects this machine');
// Without onShip (a page with no remotes) nothing on the floor is a ship target.
const plain = View.create({ canvas: canvas(), nameFor: id => id, env: { raf: () => 1, caf() {}, now: () => 0, dpr: () => 1, createCanvas: () => canvas(), sprites: { drawBody: () => null } } });
plain.start(); plain.update(Scene.build(layout.onPage(0).filter(room => !room.host), 0), { mailFrame: () => ({ drones: [], envelopes: [] }) }); plain.paint(16);
assert.equal(Scene.build(layout.onPage(0).filter(room => !room.host), 0).links, undefined, 'no remotes, no observation links');
view.stop(); assert.deepEqual(view.attentionRegions(), [], 'stop clears badges');
// "~ home": a home-folder room and its own section read "~ home"; a repository room in home keeps its repo section name.
assert.equal(Model.projectName({ project: 'nick', projectHome: true }), '~ home');
assert.equal(Model.projectName({ project: 'web' }), 'web');
{
  const homeLayout = Model.createLayout();
  homeLayout.reconcile([row('obs_home', { project: 'nick', projectId: 'p_home', repo: 'nick', repoId: 'd_home', repoKind: 'folder', projectHome: true }),
    row('obs_repo', { project: 'nick', projectId: 'p_home', repo: 'tools', repoId: 'r_tools', repoKind: 'repository', projectHome: true })]);
  const [room] = homeLayout.onPage(0);
  assert.equal(room.name, '~ home', 'the room sign');
  const homeScene = Scene.build(homeLayout.onPage(0), 0);
  assert.deepEqual(homeScene.platforms[0].sections.map(section => section.label).sort(), ['tools', '~ home'], 'section labels');
}
console.log('observer hosts view: "~ home" labels, blocked "!" badge (fresh only, overview too), ship floor/label selection, observation/relay labels, links only with remotes OK');
