'use strict';
const assert = require('node:assert/strict');
const Model = require('../frontend/app/observer-model.js');
const Scene = require('../frontend/app/observer-scene.js');

const NOW = 10 * 3600000;
const row = (id, extra = {}) => ({ id, project: 'P', projectId: 'p' + (extra.host || ''), projectKind: 'group', repo: 'r', repoId: 'r', provider: 'codex', status: 'idle', ...extra });
const remote = (machine, extra = {}) => ({ relay: 'relay.example.dev', machine, lastActivityAt: NOW - 60000, peers: [], ...extra });
const peer = (machine, agents, extra = {}) => ({ machine, repos: ['llm-bus'], agents, lastSeen: NOW - 120000, ...extra });
const inside = (point, rect) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;

// Networks: one per relay host, from each bus's own binding; members' machines are never outposts.
{
  const nets = Scene.relayNetworks([
    [null, { health: 'available', remote: remote('mac', { lastActivityAt: NOW - 20 * 60000, peers: [peer('whitenoise', 2), peer('vm-1', 1)] }) }],
    ['vm', { health: 'available', remote: remote('vm-1', { peers: [peer('whitenoise', 5, { repos: ['docs'] }), peer('mac', 1)] }) }],
    ['down', { health: 'unavailable', remote: remote('down-1', { relay: 'other.example.dev' }) }],
    ['plain', { health: 'available' }], ['broken', { health: 'available', remote: { relay: 7 } }], ['none', null]
  ], NOW);
  assert.deepEqual(nets.map(net => net.relay), ['other.example.dev', 'relay.example.dev']);
  const main = nets[1];
  assert.deepEqual(main.members.map(member => [member.host, member.machine, member.state]), [[null, 'mac', 'quiet'], ['vm', 'vm-1', 'active']],
    'this machine first; active only with relay activity in the last 15 minutes');
  assert.deepEqual(main.outposts, [{ machine: 'whitenoise', agents: 5, repos: ['docs', 'llm-bus'], lastSeen: NOW - 120000 }], 'merged across members; observed machines excluded');
  assert.deepEqual(nets[0].members.map(member => member.state), ['unknown'], 'an unreadable bus never claims a live relay');
  assert.deepEqual(Scene.relayNetworks([[null, { health: 'available', remote: remote('mac', { lastActivityAt: null }) }]], NOW)[0].members[0].state, 'quiet', 'no activity seen is quiet, not live');
  assert.deepEqual(Scene.relayNetworks([], NOW), []);
}

// Single machine bound to a relay: the relay floats east of the station; the camera fits it; nothing else moves.
{
  const layout = Model.createLayout(); layout.reconcile([row('obs_a')]);
  const rooms = layout.onPage(0), plain = Scene.build(rooms, 0);
  const relays = Scene.relayNetworks([[null, { health: 'available', remote: remote('mac', { peers: [peer('whitenoise', 3), peer('quiet-box', 0)] }) }]], NOW);
  const scene = Scene.build(rooms, 0, { relays });
  assert.equal(plain.relays, undefined, 'no relay without a bus that reports one');
  assert.equal(scene.ships, undefined, 'a relay never invents ships');
  const relay = scene.relays[0], east = Math.max(...[scene.mail.rect, ...scene.platforms.map(p => p.rect), scene.observatory.rect].map(r => r.x + r.w));
  assert.ok(relay.rect.x > east, 'the relay is in space east of everything observed');
  assert.deepEqual(relay.members.map(member => [member.host, member.from.z, member.to]), [[null, 3.2, relay.center]], 'the beam leaves the mailroom tower top');
  assert.deepEqual(relay.outposts.map(outpost => [outpost.machine, outpost.agents]), [['whitenoise', 3], ['quiet-box', 0]]);
  for (const outpost of relay.outposts) assert.ok(outpost.rect.x > relay.rect.x + relay.rect.w, 'outposts sit beyond the relay');
  assert.ok(scene.bounds.maxX > plain.bounds.maxX || scene.bounds.maxY > plain.bounds.maxY || scene.bounds.minY < plain.bounds.minY, 'the camera fits the relay');
  assert.deepEqual(scene.workers.map(w => [w.id, w.route]), plain.workers.map(w => [w.id, w.route]), 'crew routes are unchanged');
  assert.notEqual(scene.revision, plain.revision); assert.notEqual(Scene.build(rooms, 0, { relays: Scene.relayNetworks([[null, { health: 'available', remote: remote('mac') }]], NOW) }).revision, scene.revision, 'outposts are part of the revision');

  // Couriers: outgoing relayed mail flies desk → hub → tower → relay; incoming the reverse; never the space chute.
  const fake = { seatFor: id => (id === 'obs_a' ? 0 : undefined), pageFor: () => 0, colorFor: () => ({ accent: '#fff' }) };
  const out = Scene.route(scene, fake, { from: 'obs_a', to: 'external', relay: { direction: 'out', machine: 'whitenoise', repo: 'llm-bus', state: 'accepted_remote' } }, []);
  assert.equal(out.key, 'obs_a>' + relay.key); assert.deepEqual(out.to[0], { ...relay.center, z: 0 }); assert.deepEqual(out.to.at(-1), scene.mail.hub);
  const inbound = Scene.route(scene, fake, { from: 'external', to: 'obs_a', relay: { direction: 'in', machine: 'whitenoise', repo: 'llm-bus', state: 'delivered_local' } }, []);
  assert.equal(inbound.key, relay.key + '>obs_a'); assert.deepEqual(inbound.from[0], { ...relay.center, z: 0 });
  assert.equal(Scene.route(scene, fake, { from: 'obs_a', to: 'external' }, []).key, 'obs_a>chute', 'unrelayed outside mail still uses the chute');
  assert.equal(Scene.route(plain, fake, { from: 'obs_a', to: 'external', relay: { direction: 'out', machine: 'x', repo: 'r', state: 'queued_local' } }, []).key, 'obs_a>chute', 'no relay drawn: chute');

  // Pending: where llm-bus last proved it is. Queued: this mailroom's tower; accepted: the relay; delivered: that outpost.
  const send = state => ({ to: 'external', acknowledgedAt: null, wake: 'unsupported', relay: { direction: 'out', machine: 'whitenoise', repo: 'llm-bus', state } });
  const at = state => Scene.pending(scene, fake, [send(state)]);
  assert.ok(inside(at('queued_local')[0].point, scene.mail.rect), 'queued: still in this mailroom');
  assert.ok(inside(at('accepted_remote')[0].point, relay.rect), 'accepted: at the relay');
  assert.ok(inside(at('delivered_local')[0].point, relay.outposts[0].rect), 'delivered: at the far machine\'s outpost');
  assert.deepEqual(at('expired'), [], 'expired is not pending anywhere');
  assert.deepEqual(Scene.pending(scene, fake, [{ ...send('delivered_local'), relay: { ...send('delivered_local').relay, machine: 'not-listed' } }]), [], 'a delivered message to an unlisted machine is not drawn');
  assert.equal(at('accepted_remote')[0].mark, true, 'relay sends never wake locally: marked like any unsupported wake');
}

// Two observed hosts on one relay: each mailroom beams to the same satellite; each ship's mail stays its own half.
{
  const layout = Model.createLayout(); layout.reconcile([row('obs_l'), row('obs_v', { host: 'vm' })]);
  const rooms = layout.onPage(0), hosts = [{ id: 'vm', health: 'available', agents: 1 }];
  const relays = Scene.relayNetworks([[null, { health: 'available', remote: remote('mac', { peers: [peer('vm-1', 1)] }) }], ['vm', { health: 'available', remote: remote('vm-1', { peers: [peer('mac', 1)] }) }]], NOW);
  const scene = Scene.build(rooms, 0, { hosts, relays }), relay = scene.relays[0], vmShip = scene.ships.find(ship => ship.id === 'vm');
  assert.deepEqual(relay.members.map(member => member.host), [null, 'vm']); assert.deepEqual(relay.outposts, [], 'both machines are observed: no outposts');
  assert.ok(relay.rect.x > Math.max(...scene.ships.map(ship => ship.rect.x + ship.rect.w)), 'east of every hull');
  assert.ok(relay.center.y >= scene.mail.hub.y && relay.center.y <= vmShip.mail.hub.y, 'between the mailrooms it serves');
  const fake = { seatFor: id => (['obs_l', 'obs_v'].includes(id) ? 0 : undefined), pageFor: () => 0, colorFor: () => ({ accent: '#fff' }) };
  const vmOut = Scene.route(scene, fake, { from: 'obs_v', to: 'external', relay: { direction: 'out', machine: 'mac', repo: 'llm-bus', state: 'accepted_remote' } }, [], 'vm');
  assert.deepEqual(vmOut.to.at(-1), vmShip.mail.hub, 'the vm half flies from the vm mailroom');
  assert.deepEqual(Scene.pending(scene, fake, [{ to: 'external', acknowledgedAt: null, relay: { direction: 'out', machine: 'mac', repo: 'llm-bus', state: 'delivered_local' } }], 'vm'), [],
    'delivered to an observed machine: its own mailroom shows the copy, so none is drawn here');
}
console.log('relay scene: networks from bus bindings, member states (active/quiet/unknown), outposts exclude observed machines, east placement and camera fit, unchanged crew, relay courier routes and truthful pending spots OK');
