'use strict';
const assert = require('node:assert/strict');
const Model = require('../frontend/app/observer-model.js');
const Scene = require('../frontend/app/observer-scene.js');

const NOW = 10 * 3600000;
const row = (id, extra = {}) => ({ id, project: 'P', projectId: 'p' + (extra.host || ''), projectKind: 'group', repo: 'r', repoId: 'r', provider: 'codex', status: 'idle', ...extra });
const agent = (c, repo = 'llm-bus', provider = 'codex') => ({ id: 'peer_' + c.repeat(24), provider, repo, lastSeen: NOW - 120000 });
const remote = (machine, extra = {}) => ({ relay: 'relay.example.dev', machine, lastActivityAt: NOW - 60000, peers: [], ...extra });
const peer = (machine, list, extra = {}) => ({ machine, repos: [...new Set(list.map(value => value.repo))], agents: list.length, lastSeen: NOW - 120000, list, ...extra });
const inside = (point, rect) => point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
const shadowHost = (net, shadow, member) => ({ id: shadow.host, shadow: true, health: 'shadow', machine: shadow.machine, relay: net.relay, member, agents: shadow.agents });

// Networks: one per relay host from each bus's own binding; observed machines are members, never shadows.
{
  const nets = Scene.relayNetworks([
    [null, { health: 'available', remote: remote('mac', { lastActivityAt: NOW - 20 * 60000, peers: [peer('whitenoise', [agent('a')]), peer('vm-1', [agent('v')])] }) }],
    ['vm', { health: 'available', remote: remote('vm-1', { peers: [peer('whitenoise', [agent('a'), agent('b', 'docs', 'claude')]), peer('mac', [agent('m')])] }) }],
    ['down', { health: 'unavailable', remote: remote('down-1', { relay: 'other.example.dev' }) }],
    ['plain', { health: 'available' }], ['broken', { health: 'available', remote: { relay: 7 } }], ['none', null]
  ], NOW);
  assert.deepEqual(nets.map(net => net.relay), ['other.example.dev', 'relay.example.dev']);
  const main = nets[1];
  assert.deepEqual(main.members.map(member => [member.host, member.machine, member.state]), [[null, 'mac', 'quiet'], ['vm', 'vm-1', 'active']],
    'this machine first; active only with relay activity in the last 15 minutes');
  assert.deepEqual(main.shadows.map(shadow => [shadow.host, shadow.machine, shadow.agents, shadow.list.map(value => value.id)]),
    [['relay:whitenoise', 'whitenoise', 2, [agent('b').id, agent('a').id]]], 'rosters merged across members, sorted by repo; observed machines are never shadows');
  assert.deepEqual(nets[0].members.map(member => member.state), ['unknown'], 'an unreadable bus never claims a live relay');
  assert.equal(Scene.relayNetworks([[null, { health: 'available', remote: remote('mac', { lastActivityAt: null }) }]], NOW)[0].members[0].state, 'quiet', 'no activity seen is quiet, not live');

  const ghosts = Scene.shadowRows(nets);
  assert.deepEqual(ghosts.map(value => [value.id, value.host, value.provider, value.repo, value.status, value.shadow, value.source]),
    [[agent('b').id, 'relay:whitenoise', 'claude', 'docs', 'unknown', true, 'relay'], [agent('a').id, 'relay:whitenoise', 'codex', 'llm-bus', 'unknown', true, 'relay']],
    'one ghost row per listed agent, room per shared repo, status unknown');
  assert.ok(ghosts.every(value => !value.paneId && !value.sessionId), 'ghosts carry nothing that could address, inspect or control a session');
}

// This machine on a relay with one unobserved machine: a shadow ship docks beside the flagship, ghost crew at desks.
{
  const nets = Scene.relayNetworks([[null, { health: 'available', remote: remote('mac', { peers: [peer('whitenoise', [agent('a'), agent('b')])] }) }]], NOW);
  const ghosts = Scene.shadowRows(nets), layout = Model.createLayout(); layout.reconcile([row('obs_a'), ...ghosts]);
  const plainLayout = Model.createLayout(); plainLayout.reconcile([row('obs_a')]);
  const plain = Scene.build(plainLayout.onPage(0), 0);
  const scene = Scene.build(layout.onPage(0), 0, { relays: nets, hosts: [shadowHost(nets[0], nets[0].shadows[0], null)] });
  const flagship = scene.ships.find(ship => ship.local), shadow = scene.ships.find(ship => ship.shadow);
  assert.equal(plain.relays, undefined, 'no relay without a bus that reports one');
  assert.ok(shadow.rect.x > flagship.rect.x + flagship.rect.w, 'the shadow ship docks east of the flagship');
  assert.equal(scene.links.length, 0, 'a shadow ship has no ssh observation link');
  const crew = scene.workers.filter(worker => worker.row.shadow);
  assert.deepEqual(crew.map(worker => worker.id).sort(), ghosts.map(value => value.id).sort(), 'every listed agent has a desk');
  for (const worker of crew) assert.ok(inside(worker.chair, shadow.rect), 'ghost crew sit on their own ship');
  for (const worker of crew) assert.deepEqual(worker.route.at(-1), shadow.mail.hub, 'ghost crew walk to their own mailroom');
  const local = scene.workers.find(worker => worker.id === 'obs_a'), alone = plain.workers.find(worker => worker.id === 'obs_a');
  assert.deepEqual(local.route, alone.route, 'observed crew routes are unchanged');
  assert.deepEqual(scene.relays[0].links.map(link => [link.from, link.to, link.shadow, link.a.z]), [[null, 'relay:whitenoise', true, 2.2]], 'one relay link, mailroom to mailroom, above the decks');

  // Couriers: desk → this mailroom → across the relay link → the far mailroom → the far agent's desk, and back.
  const fake = { seatFor: id => (scene.workers.some(w => w.id === id) ? 0 : undefined), pageFor: () => 0, colorFor: () => ({ accent: '#fff' }) };
  const target = crew[0].id, sent = state => ({ from: 'obs_a', to: 'external', acknowledgedAt: null, wake: 'unsupported', relay: { direction: 'out', machine: 'whitenoise', repo: 'llm-bus', peer: target, state } });
  const out = Scene.route(scene, fake, sent('accepted_remote'), []);
  assert.equal(out.key, 'obs_a>' + target);
  assert.deepEqual(out.to.slice(-2), [shadow.mail.hub, scene.mail.hub], 'the outbound leg crosses from this hub to the far hub');
  assert.deepEqual(out.to[0], crew[0].route[0], 'and ends at the far agent\'s chair');
  assert.deepEqual(out.from.at(-1), scene.mail.hub);
  const inbound = Scene.route(scene, fake, { from: 'external', to: 'obs_a', relay: { direction: 'in', machine: 'whitenoise', repo: 'llm-bus', peer: target, state: 'delivered_local' } }, []);
  assert.equal(inbound.key, target + '>obs_a'); assert.deepEqual(inbound.from[0], crew[0].route[0]);
  const unknown = Scene.route(scene, fake, { ...sent('accepted_remote'), relay: { ...sent('accepted_remote').relay, peer: 'peer_' + 'f'.repeat(24) } }, []);
  assert.deepEqual(unknown.to, [shadow.mail.hub, scene.mail.hub], 'an agent the roster no longer lists: that machine\'s mailroom');
  assert.equal(Scene.route(scene, fake, { from: 'obs_a', to: 'external' }, []).key, 'obs_a>chute', 'unrelayed outside mail still uses the chute');
  assert.equal(Scene.route(scene, fake, { ...sent('queued_local'), relay: { ...sent('queued_local').relay, machine: 'elsewhere' } }, []).key, 'obs_a>chute', 'a machine with no relay link: chute');

  // Pending: where llm-bus last proved it is.
  const at = state => Scene.pending(scene, fake, [sent(state)]);
  assert.ok(inside(at('queued_local')[0].point, scene.mail.rect), 'queued: still in this mailroom');
  const mid = at('accepted_remote')[0].point, link = scene.relays[0].links[0];
  assert.deepEqual([mid.x, mid.y], [(link.a.x + link.b.x) / 2, (link.a.y + link.b.y) / 2], 'held by the relay: halfway along the link');
  assert.deepEqual([at('delivered_local')[0].point.x, at('delivered_local')[0].point.y], [crew[0].route[0].x, crew[0].route[0].y], 'delivered: at the far agent\'s desk');
  assert.deepEqual(at('expired'), [], 'expired is not pending anywhere');
  assert.equal(at('accepted_remote')[0].mark, true, 'relay sends never wake locally: marked like any unsupported wake');
}

// Two observed machines on one relay: their mailrooms are linked; each ship shows only its own half of a crossing.
{
  const layout = Model.createLayout(); layout.reconcile([row('obs_l'), row('obs_v', { host: 'vm' })]);
  const nets = Scene.relayNetworks([[null, { health: 'available', remote: remote('mac', { peers: [peer('vm-1', [agent('v')])] }) }], ['vm', { health: 'available', remote: remote('vm-1', { peers: [peer('mac', [agent('m')])] }) }]], NOW);
  const scene = Scene.build(layout.onPage(0), 0, { hosts: [{ id: 'vm', health: 'available', agents: 1 }], relays: nets }), vmShip = scene.ships.find(ship => ship.id === 'vm');
  assert.deepEqual(nets[0].shadows, [], 'both machines are observed: no shadows');
  assert.deepEqual(scene.relays[0].links.map(link => [link.from, link.to, link.shadow]), [[null, 'vm', false]]);
  const fake = { seatFor: id => (['obs_l', 'obs_v'].includes(id) ? 0 : undefined), pageFor: () => 0, colorFor: () => ({ accent: '#fff' }) };
  const vmOut = Scene.route(scene, fake, { from: 'obs_v', to: 'external', relay: { direction: 'out', machine: 'mac', repo: 'llm-bus', state: 'accepted_remote' } }, [], 'vm');
  assert.deepEqual(vmOut.to, [scene.mail.hub, vmShip.mail.hub], 'the vm half flies from the vm mailroom to this machine\'s');
  assert.deepEqual(vmOut.from.at(-1), vmShip.mail.hub);
  assert.deepEqual(Scene.pending(scene, fake, [{ to: 'external', acknowledgedAt: null, relay: { direction: 'out', machine: 'mac', repo: 'llm-bus', state: 'delivered_local' } }], 'vm'), [],
    'delivered to an observed machine: its own mailroom shows the copy, so none is drawn here');
}
console.log('relay scene: networks and shadows from bus bindings, ghost crew rows, shadow ships docked beside their member, unchanged crew and ssh links, desk-to-desk relay couriers and truthful pending spots OK');
