/* Isometric observer geometry. Allocations and observed rows remain owned by ObserverModel and the controller. */
'use strict';
const ObserverScene = (() => {
  const Model = typeof module !== 'undefined' && module.exports ? require('./observer-model.js') : ObserverModel;
  const project = ({ x, y, z = 0 }) => ({ x: 24 * (x - y), y: 12 * (x + y) - 24 * z });
  const unproject = ({ x, y }) => ({ x: x / 48 + y / 24, y: y / 24 - x / 48, z: 0 });
  const contains = (rect, point) => point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h;
  const pointAt = (rect, x, y, z = 0) => ({ x: rect.x + x, y: rect.y + y, z });
  const strip = (a, b, kind) => ({ kind, rect: { x: Math.min(a.x, b.x) - 1, y: Math.min(a.y, b.y) - 1, w: Math.abs(b.x - a.x) + 2, h: Math.abs(b.y - a.y) + 2 } });
  const deskFor = (rect, block, seat) => ({ x: rect.x + [2, 6, 12, 16][seat % 4], y: rect.y + 6 + block * 7 + Math.floor(seat / 4) * 3, w: 2, h: 1 });

  const partitionsFor = (rect, block) => [1, 11].map(x => ({ x: rect.x + x, y: rect.y + 3 + block * 7, w: 8, h: 1 }));

  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const rootObstacles = rect => Array.from({ length: 24 }, (_, seat) => deskFor(rect, Math.floor(seat / 8), seat % 8))
    .concat([1, 2].flatMap(block => partitionsFor(rect, block)));
  const helperStationFor = (rect, block, offset) => ({ x: rect.x + offset.x, y: rect.y + block * 7 + offset.y - 0.51,
    w: offset.w, h: offset.h + 0.51 });
  function projectedBounds(extents) {
    const corners = extents.flatMap(({ rect, height = 3.2 }) => [rect.x, rect.x + rect.w].flatMap(x =>
      [rect.y, rect.y + rect.h].flatMap(y => [project({ x, y, z: height }), project({ x, y, z: -2.5 })])));
    return { minX: Math.min(...corners.map(p => p.x)) - 48, maxX: Math.max(...corners.map(p => p.x)) + 48,
      minY: Math.min(...corners.map(p => p.y)) - 24, maxY: Math.max(...corners.map(p => p.y)) + 24 };
  }
  function observatoryFor() {
    const rect = { x: 0, y: -14, w: 14, h: 10 }, desk = { x: 4, y: -12, w: 2, h: 1 }, chair = { x: 5, y: -12.5, z: 0 };
    const screens = [1, 7].map(x => ({ rect: { x, y: -14, w: 2, h: 1 }, height: 3 }));
    const telescopes = [1, 10].map(x => ({ rect: { x, y: -11, w: 1, h: 1 }, height: 3.5 }));
    const plant = { rect: { x: 8, y: -9, w: 1, h: 1 }, height: 2 }, light = { rect: { x: 8, y: -13, w: 1, h: 1 }, height: 4.5 };
    return { rect, desk, chair, viewer: { id: 'observer_viewer', label: 'Viewer', kind: 'ambient', point: chair }, screens, telescopes, plant, light,
      link: [{ x: 12, y: -4, z: 0 }, { x: 12, y: 0, z: 0 }, { x: 12, y: 5, z: 0 }, { x: 7, y: 5, z: 0 }, { x: 7, y: 6, z: 0 }],
      extents: [{ rect, height: 3.2 }, { rect: desk, height: 1.5 }, ...screens, ...telescopes, plant, light] };
  }
  function build(rooms, page) {
    const mail = { rect: { x: 0, y: 0, w: 14, h: 12 }, hub: { x: 7, y: 6, z: 0 },
      tower: { x: 5, y: 1, w: 4, h: 3 }, pads: [4, 7, 10].map(x => ({ x, y: 9, z: 0 })),
      pod: [{ x: 11, y: 9, z: 0 }, { x: 11, y: 6, z: 0 }, { x: 7, y: 6, z: 0 }],
      chute: [{ x: 2, y: 9, z: 0 }, { x: 2, y: 6, z: 0 }, { x: 7, y: 6, z: 0 }] };
    const observatory = observatoryFor(), platforms = [], walkways = [{ kind: 'observatory-link', rect: { x: 11, y: -4, w: 2, h: 4 } }], workers = [], helperOverflow = [], banks = new Map();
    for (const room of rooms) {
      const slot = room.slot % 8, bank = slot % 2, index = Math.floor(slot / 2);
      const rect = { x: bank ? 24 : -30, y: (bank ? -42 : -48) + 32 * index, w: 20, h: 26 };
      const spineX = bank ? 19 : -5, entry = pointAt(rect, 10, 25), elbow = pointAt(rect, 10, 28), join = { x: spineX, y: elbow.y, z: 0 };
      if (!banks.has(bank)) banks.set(bank, []); banks.get(bank).push(join.y);
      walkways.push(strip(entry, elbow, 'connector'), strip(elbow, join, 'connector'));
      const sections = [];
      for (let block = 0; block < room.blocks.length; block++) {
        const value = room.blocks[block], previous = sections.at(-1);
        if (previous && previous.repo === value.repo) previous.rect.h += 7;
        else sections.push({ repo: value.repo, label: value.label, partitions: block ? partitionsFor(rect, block) : [], rect: { x: rect.x + 1, y: rect.y + 4 + block * 7, w: 18, h: 7 }, sign: pointAt(rect, 1.5, 4 + block * 7, 1.25) });
      }
      const decorationRegions = [
        { kind: 'wall', edge: 'rear-y', rect: { x: rect.x + 2, y: rect.y + 0.5, w: 16, h: 2 } },
        { kind: 'wall', edge: 'rear-x', rect: { x: rect.x + 0.2, y: rect.y + 4, w: 0.6, h: 18 } },
        { kind: 'corner', rect: { x: rect.x + 18.5, y: rect.y + 1, w: 1, h: 2 } },
        { kind: 'apron', rect: { x: rect.x + 1, y: rect.y + 24, w: 2, h: 1 } },
        { kind: 'apron', rect: { x: rect.x + 17, y: rect.y + 24, w: 2, h: 1 } }
      ];
      platforms.push({ key: room.key, projectId: room.projectId, name: room.name, annex: room.annex, accent: room.accent, rect, sections,
        decorationRegions, entry: { point: entry, edge: 'front-y' }, sign: pointAt(rect, 10, 0, 1.25) });
      for (const { row, block, seat, kind } of room.rows) {
        if (kind === 'helper') continue;
        const desk = deskFor(rect, block, seat);
        const chair = { x: desk.x + 1, y: desk.y - 0.5, z: 0 }, laneY = chair.y - 0.75;
        workers.push({ id: row.id, row, kind: 'session', parentId: null, scale: 1, platformKey: room.key, accent: room.accent, desk, chair,
          route: [chair, { x: chair.x, y: laneY, z: 0 }, { x: rect.x + 10, y: laneY, z: 0 }, entry, elbow, join, { x: spineX, y: 6, z: 0 }, mail.hub] });
      }
      const platform = platforms.at(-1), stations = [];
      const lanes = [0, 1, 2].flatMap(block => [4.75, 7.75].map(y => ({ x: rect.x + 1, y: rect.y + block * 7 + y - 0.25, w: 18, h: 0.5 })))
        .concat([{ x: rect.x + 9.5, y: rect.y + 3, w: 1, h: 22 }]);
      const reserved = rootObstacles(rect).concat(lanes);
      for (const value of room.rows.filter(value => value.kind === 'helper')) {
        const { row, block, helperSlot, parentId, rootId } = value, offset = helperSlot == null ? null : Model.helperStations[helperSlot];
        const desk = offset && { x: rect.x + offset.x, y: rect.y + block * 7 + offset.y, w: offset.w, h: offset.h };
        const chair = desk && { x: desk.x + desk.w / 2, y: desk.y - 0.36, z: 0 };
        const station = offset && helperStationFor(rect, block, offset);
        const section = sections.find(section => section.repo === room.blocks[block].repo && contains(section.rect, chair || { x: NaN, y: NaN }));
        if (!desk || !section || !contains(section.rect, { x: station.x, y: station.y })
          || !contains(section.rect, { x: station.x + station.w - 0.001, y: station.y + station.h - 0.001 })
          || [...reserved, ...stations].some(obstacle => overlaps(station, obstacle))) {
          helperOverflow.push({ id: row.id, row, parentId, rootId, platformKey: room.key, reason: 'No collision-free helper station' }); continue;
        }
        stations.push(station);
        workers.push({ id: row.id, row, kind: 'helper', parentId, rootId, scale: 0.72, platformKey: room.key, accent: room.accent,
          desk, chair, station, helperSlot, route: null, anchor: null, connector: null });
      }
      platform.helperStations = stations;
    }
    for (const [bank, ys] of banks) {
      const x = bank ? 19 : -5;
      walkways.push(strip({ x, y: Math.min(6, ...ys) }, { x, y: Math.max(6, ...ys) }, 'spine'), strip({ x, y: 6 }, mail.hub, 'hub-link'));
    }
    for (const worker of workers.filter(worker => worker.kind === 'helper')) {
      const parent = workers.find(parent => parent.id === worker.parentId);
      if (parent) { worker.anchor = { ...parent.chair }; worker.connector = { from: worker.anchor, to: { ...worker.chair } }; }
    }
    const extents = [mail.rect, ...platforms.map(p => p.rect), ...walkways.map(w => w.rect)].map(rect => ({ rect }))
      .concat(observatory.extents);
    const bounds = projectedBounds(extents);
    const revision = JSON.stringify([page, observatory.extents, rooms.map(r => [r.key, r.slot, r.blocks.map(b => b.repo)]).sort(),
      workers.map(w => [w.id, w.kind, w.parentId, w.chair.x, w.chair.y]).sort()]);
    return { page, revision, platforms, walkways, workers, helperOverflow, observatory, mail, bounds };
  }

  const viewportOf = v => ({ width: Number.isFinite(v.width) && v.width > 0 ? v.width : 1, height: Number.isFinite(v.height) && v.height > 0 ? v.height : 1 });
  const fitZoom = (bounds, v) => Math.max(0.0001, Math.min(3, Math.max(1, v.width - 48) / Math.max(1, bounds.maxX - bounds.minX), Math.max(1, v.height - 48) / Math.max(1, bounds.maxY - bounds.minY)));
  const clampZoom = (zoom, bounds, v) => Math.max(Math.min(0.15, fitZoom(bounds, v)), Math.min(3, zoom));
  function constrain(camera, bounds, viewport) {
    const v = viewportOf(viewport), zoom = clampZoom(camera.zoom, bounds, v), result = { zoom, tx: camera.tx, ty: camera.ty };
    for (const [offset, low, high, size] of [['tx', 'minX', 'maxX', 'width'], ['ty', 'minY', 'maxY', 'height']]) {
      result[offset] = (bounds[high] - bounds[low]) * zoom <= v[size] - 48
        ? (v[size] - (bounds[low] + bounds[high]) * zoom) / 2
        : Math.max(24 - bounds[high] * zoom, Math.min(v[size] - 24 - bounds[low] * zoom, result[offset]));
    }
    return result;
  }
  function fit(bounds, viewport) {
    const v = viewportOf(viewport), zoom = fitZoom(bounds, v);
    return { zoom, tx: (v.width - (bounds.minX + bounds.maxX) * zoom) / 2, ty: (v.height - (bounds.minY + bounds.maxY) * zoom) / 2 };
  }
  function focus(point, bounds, viewport) {
    const v = viewportOf(viewport), at = project(point), zoom = clampZoom(Math.max(fitZoom(bounds, v), Math.min(1.25, v.width / 100)), bounds, v);
    return constrain({ zoom, tx: v.width / 2 - at.x * zoom, ty: v.height * 0.6 - at.y * zoom }, bounds, v);
  }
  function platformBounds(scene, key) {
    const platform = scene.platforms.find(platform => platform.key === key);
    return platform ? projectedBounds([{ rect: platform.rect, height: 3.2 }]) : null;
  }
  function focusPlatform(scene, key, viewport) {
    const bounds = platformBounds(scene, key);
    if (!bounds) return null;
    return constrain(fit(bounds, viewport), scene.bounds, viewport);
  }
  function hitPlatform(point, scene, camera) {
    const floor = fromScreen(point, camera);
    return scene.platforms.filter(platform => contains(platform.rect, floor)).sort((a, b) => a.key.localeCompare(b.key))[0]?.key || null;
  }
  function zoomAt(camera, screenPoint, factor, bounds, viewport) {
    const v = viewportOf(viewport), zoom = clampZoom(camera.zoom * factor, bounds, v), ratio = zoom / camera.zoom;
    return constrain({ zoom, tx: screenPoint.x - (screenPoint.x - camera.tx) * ratio, ty: screenPoint.y - (screenPoint.y - camera.ty) * ratio }, bounds, v);
  }
  const pan = (camera, delta, bounds, viewport) => constrain({ ...camera, tx: camera.tx + delta.x, ty: camera.ty + delta.y }, bounds, viewport);
  function toScreen(point, camera) { const p = project(point); return { x: camera.tx + p.x * camera.zoom, y: camera.ty + p.y * camera.zoom }; }
  const fromScreen = (point, camera) => unproject({ x: (point.x - camera.tx) / camera.zoom, y: (point.y - camera.ty) / camera.zoom });
  function hitTest(point, regions) {
    let chosen = null;
    for (const r of regions) if (point.x >= r.left && point.x <= r.left + r.width && point.y >= r.top && point.y <= r.top + r.height && (!chosen || r.depth >= chosen.depth)) chosen = r;
    return chosen ? chosen.id : null;
  }
  function endpoint(scene, layout, id) {
    if (layout.seatFor(id) !== undefined) {
      const page = layout.pageFor(id), worker = scene.workers.find(w => w.id === id);
      if (page === scene.page && worker) return { key: id, points: worker.route };
      return { key: 'pod', points: scene.mail.pod, deck: page + 1 };
    }
    return { key: 'chute', points: scene.mail.chute };
  }
  function route(scene, layout, message, rows) {
    const from = endpoint(scene, layout, message.from), to = endpoint(scene, layout, message.to), recipient = rows.find(r => r.id === message.to);
    return { key: from.key + '>' + to.key, from: from.points, to: to.points, color: recipient ? layout.colorFor(Model.projectKey(recipient)).accent : '#c9d3da' };
  }
  function pending(scene, layout, messages) {
    const spots = new Map();
    for (const message of messages) {
      if (message.acknowledgedAt) continue;
      const end = endpoint(scene, layout, message.to), key = end.key + ':' + (end.deck || '');
      if (!spots.has(key)) spots.set(key, { point: { ...end.points[0], z: 1.2 }, count: 0, mark: false, label: end.deck ? 'D' + end.deck : '' });
      const spot = spots.get(key); spot.count++; if (['failed', 'unsupported', 'unknown'].includes(message.wake)) spot.mark = true;
    }
    return [...spots.values()];
  }

  // A small local graph keeps ambient feet off desks and out of inter-platform space.
  function graphFor(platform) {
    const cells = new Map(), r = platform.rect;
    // Reserve future desks and section partitions too: growth must never place an obstacle under a wandering worker.
    const obstacles = rootObstacles(r)
      // Reserve candidate stations before helpers arrive, so a new desk cannot appear on an in-flight path.
      .concat([0, 1, 2].flatMap(block => Model.helperStations.map(offset => helperStationFor(r, block, offset))))
      .concat(platform.helperStations || [])
      .concat(platform.decorationRegions.filter(d => d.kind !== 'apron').map(d => d.rect));
    for (let x = 1; x < r.w - 1; x++) for (let y = 3; y < r.h - 2; y++) {
      const point = pointAt(r, x + 0.5, y + 0.5);
      if (!obstacles.some(o => contains(o, point))) cells.set(x + ',' + y, point);
    }
    const graph = { cells, rect: r, obstacles, edges: new Map() };
    for (const [key, point] of cells) {
      const [x, y] = key.split(',').map(Number);
      graph.edges.set(key, [(x - 1) + ',' + y, (x + 1) + ',' + y, x + ',' + (y - 1), x + ',' + (y + 1)]
        .filter(next => cells.has(next) && safeSegment(graph, point, cells.get(next))));
    }
    return graph;
  }
  // Slab intersection tests the entire segment, including sub-cell furniture and endpoint joins.
  function crosses(rect, a, b) {
    let low = 0, high = 1;
    for (const [axis, size] of [['x', 'w'], ['y', 'h']]) {
      const delta = b[axis] - a[axis], min = rect[axis] + 1e-8, max = rect[axis] + rect[size] - 1e-8;
      if (Math.abs(delta) < 1e-10) { if (a[axis] <= min || a[axis] >= max) return false; }
      else {
        const first = (min - a[axis]) / delta, second = (max - a[axis]) / delta;
        low = Math.max(low, Math.min(first, second)); high = Math.min(high, Math.max(first, second));
        if (low > high) return false;
      }
    }
    return low <= high;
  }
  function safeSegment(graph, a, b, worker) {
    if (!graph || !contains(graph.rect, a) || !contains(graph.rect, b)) return false;
    return !graph.obstacles.some(obstacle => {
      const own = worker?.station && obstacle.x === worker.station.x && obstacle.y === worker.station.y
        && obstacle.w === worker.station.w && obstacle.h === worker.station.h;
      // Only its owner can cross the chair apron. Its actual desk remains solid.
      return crosses(own ? worker.desk : obstacle, a, b);
    });
  }
  function nearest(graph, point, worker) {
    let best, distance = Infinity;
    for (const [key, p] of graph.cells) {
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d < distance && safeSegment(graph, point, p, worker)) { best = key; distance = d; }
    }
    return best;
  }
  function pathTo(graph, from, to, worker) {
    if (!graph) return [];
    const start = nearest(graph, from, worker), end = nearest(graph, to, worker);
    if (!start || !end) return [];
    const queue = [start], previous = new Map([[start, null]]);
    for (let index = 0; index < queue.length && !previous.has(end); index++) {
      const key = queue[index];
      for (const next of graph.edges.get(key)) if (!previous.has(next)) { previous.set(next, key); queue.push(next); }
    }
    if (!previous.has(end)) return [];
    const keys = []; for (let key = end; key !== null; key = previous.get(key)) keys.unshift(key);
    const points = [{ ...from }, ...keys.map(key => ({ ...graph.cells.get(key) })), { ...to }];
    for (let index = 1; index < points.length - 1;) {
      const a = points[index - 1], b = points[index], c = points[index + 1];
      if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-8
        && safeSegment(graph, a, c, worker)) points.splice(index, 1);
      else index++;
    }
    return points.slice(1);
  }
  function direction(dx, dy) {
    const p = project({ x: dx, y: dy });
    return ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][(Math.round(Math.atan2(p.y, p.x) / (Math.PI / 4)) + 8) % 8];
  }
  function createMovement() {
    const actors = new Map(); let page = null, last = null, revision = null, graphs = new Map(), ordered = [];
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const closed = worker => worker.row.lifecycleEvidence?.state === 'closed' || worker.row.lineageState === 'closed';
    const atDesk = worker => ['working', 'blocked'].includes(worker.row.status);
    const verified = worker => ['open', 'verified'].includes(worker.row.lineageState);
    const isStale = (worker, stale) => typeof stale === 'function' ? stale(worker) : stale;
    function clearFollow(actor) { actor.followParent = null; actor.cursor = null; actor.arrival = null; actor.targetKey = null; actor.assignment = null; actor.formation = null; }
    function reset() { actors.clear(); graphs.clear(); ordered = []; page = null; last = null; revision = null; }
    function reconcile(scene, { now, stale = false, reduced = false }) {
      if (page !== scene.page) reset(); page = scene.page;
      const geometryChanged = revision !== scene.revision;
      if (geometryChanged) { graphs = new Map(scene.platforms.map(p => [p.key, graphFor(p)])); revision = scene.revision; }
      const ids = new Set(scene.workers.map(w => w.id)); for (const id of actors.keys()) if (!ids.has(id)) actors.delete(id);
      for (const worker of scene.workers) {
        let actor = actors.get(worker.id);
        const moved = !actor || actor.worker.platformKey !== worker.platformKey || distance(actor.worker.chair, worker.chair) > 0.001;
        if (moved) {
          actor = { worker, point: { ...worker.chair }, path: [], due: now + 2000 + Model.hash(worker.id) % 5000,
            trip: 0, direction: 'south', trail: [], arc: 0 };
          actors.set(worker.id, actor);
        }
        const reparented = actor.worker.parentId !== worker.parentId;
        actor.worker = worker;
        if (geometryChanged || reparented) { actor.path = []; actor.trail = []; actor.arc = 0; clearFollow(actor); }
        if (reduced) { actor.point = { ...worker.chair }; actor.path = []; actor.trail = []; clearFollow(actor); }
      }
      // Resolve only bounded, verified immediate-parent chains; malformed rows never gain roaming intent.
      function depth(actor) {
        const seen = new Set([actor.worker.id]); let current = actor, value = 0;
        while (current.worker.kind === 'helper') {
          if (!verified(current.worker) || ++value > 3 || seen.has(current.worker.parentId)) return Infinity;
          seen.add(current.worker.parentId); current = actors.get(current.worker.parentId);
          if (!current || current.worker.platformKey !== actor.worker.platformKey) return Infinity;
        }
        return value;
      }
      ordered = [...actors.values()].map(actor => ({ actor, depth: depth(actor) }))
        .sort((a, b) => a.depth - b.depth || (a.actor.worker.helperSlot ?? -1) - (b.actor.worker.helperSlot ?? -1)
          || a.actor.worker.id.localeCompare(b.actor.worker.id));
      for (const entry of ordered) entry.actor.depth = entry.depth;
      for (const actor of actors.values()) if (actor.formation && actor.formation.memberIds.some(id => !actors.has(id) || actors.get(id).worker.parentId !== actor.worker.id)) actor.formation = null;
      if (last === null) last = now;
    }
    function record(actor, point) {
      const previous = actor.trail.at(-1);
      if (previous && distance(previous.point, point) < 1e-8) return;
      actor.arc += previous ? distance(previous.point, point) : 0;
      actor.trail.push({ point: { ...point }, arc: actor.arc });
      const n = actor.trail.length;
      if (n > 2) {
        const [a, b, c] = actor.trail.slice(-3).map(node => node.point);
        if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-8
          && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0) actor.trail.splice(n - 2, 1);
      }
      while (actor.trail.length > 256 || (actor.trail.length > 2 && actor.trail[1].arc < actor.arc - 48)) actor.trail.shift();
    }
    function historyAt(parent, arc, side = 0) {
      for (let i = 1; i < parent.trail.length; i++) {
        const a = parent.trail[i - 1], b = parent.trail[i];
        if (a.arc <= arc && b.arc >= arc && b.arc > a.arc) {
          const t = (arc - a.arc) / (b.arc - a.arc), dx = (b.point.x - a.point.x) / (b.arc - a.arc), dy = (b.point.y - a.point.y) / (b.arc - a.arc);
          return { arc, dx, dy, point: { x: a.point.x + (b.point.x - a.point.x) * t - dy * side,
            y: a.point.y + (b.point.y - a.point.y) * t + dx * side, z: 0 } };
        }
      }
      return null;
    }
    function trailTarget(parent, spacing, side = 0) {
      // Quantized arc targets avoid a new grid search for every animation frame.
      return historyAt(parent, Math.floor((parent.arc - spacing) / 0.8) * 0.8, side);
    }
    function historicalPath(parent, fromArc, target, side) {
      const first = historyAt(parent, fromArc, side);
      if (!first) return [];
      const points = [first.point];
      for (let i = 1; i < parent.trail.length - 1; i++) {
        const node = parent.trail[i], next = parent.trail[i + 1];
        if (node.arc < fromArc || node.arc >= target.arc) continue;
        // Both sides of a historical vertex are explicit; their connector must also be safe.
        points.push(historyAt(parent, node.arc, side).point);
        const length = next.arc - node.arc;
        points.push({ x: node.point.x - (next.point.y - node.point.y) / length * side,
          y: node.point.y + (next.point.x - node.point.x) / length * side, z: 0 });
      }
      points.push(target.point); return points;
    }
    function clearEnvelope(graph, points) {
      const radius = 0.28 * 0.72 + 0.1, r = graph.rect;
      if (!points.length || points.some(p => p.x < r.x + radius || p.x > r.x + r.w - radius
        || p.y < r.y + radius || p.y > r.y + r.h - radius)) return false;
      return points.every((point, i) => !graph.obstacles.some(o => crosses({ x: o.x - radius, y: o.y - radius,
        w: o.w + radius * 2, h: o.h + radius * 2 }, i ? points[i - 1] : point, point)));
    }
    function canFollow(actor, parent, stale) {
      return actor.worker.kind === 'helper' && Number.isFinite(actor.depth) && !isStale(actor.worker, stale)
        && !closed(actor.worker) && !atDesk(actor.worker) && parent && !parent.frozen
        && !closed(parent.worker) && !atDesk(parent.worker)
        && (parent.worker.row.status === 'idle' || (parent.worker.kind === 'helper' && parent.followParent))
        && parent.trail.length > 1;
    }
    function formationFor(parent, graph, stale) {
      const members = ordered.map(entry => entry.actor).filter(actor => actor.worker.parentId === parent.worker.id && canFollow(actor, parent, stale));
      const memberIds = members.map(actor => actor.worker.id), membership = JSON.stringify(memberIds);
      const proposed = members.map((actor, i) => {
        const side = i === members.length - 1 && members.length % 2 ? 0 : i % 2 ? 0.6 : -0.6;
        return { actor, side, target: trailTarget(parent, 1.6 + 1.2 * Math.floor(i / 2), side) };
      });
      const signature = JSON.stringify([membership, proposed.map(p => p.target ? [p.target.arc, p.target.dx, p.target.dy] : null)]);
      let group = parent.formation;
      if (!group || group.membership !== membership) group = { membership, memberIds, mode: 'single', streak: 0, signature: null, advance: null };
      if (group.signature !== signature) {
        // The centre stripe fills the space between pair feet, proving the full squad envelope.
        const clear = proposed.every(p => p.target && clearEnvelope(graph, historicalPath(parent, p.target.arc - 0.8, p.target, p.side))
          && (p.side !== -0.6 || clearEnvelope(graph, historicalPath(parent, p.target.arc - 0.8, historyAt(parent, p.target.arc), 0))));
        const advance = Math.floor(parent.arc / 0.8);
        if (!clear) { group.mode = 'single'; group.streak = 0; }
        else if (group.mode === 'single' && group.advance !== advance && ++group.streak >= 2) group.mode = 'pairs';
        group.advance = advance; group.signature = signature;
      }
      parent.formation = group;
      return proposed.map((p, i) => ({ actor: p.actor, side: group.mode === 'pairs' ? p.side : 0,
        target: group.mode === 'pairs' ? p.target : trailTarget(parent, (i + 1) * 1.6),
        assignment: JSON.stringify([parent.worker.id, membership, group.mode, i]) }));
    }
    function follow(actor, parent, graph, assignment) {
      if (actor.assignment !== assignment.assignment) {
        actor.path = []; clearFollow(actor); actor.followParent = parent.worker.id; actor.assignment = assignment.assignment;
      }
      if (actor.path.length) return;
      if (actor.arrival !== null) { actor.cursor = actor.arrival; actor.arrival = null; }
      const target = assignment.target, side = assignment.side;
      const key = target && JSON.stringify([assignment.assignment, target.arc, target.dx, target.dy, side]);
      if (!target || target.arc <= (actor.cursor ?? -Infinity) || actor.targetKey === key) return;
      actor.targetKey = key;
      let path = actor.cursor !== null ? historicalPath(parent, actor.cursor, target, side) : [];
      let from = actor.point;
      for (const point of path) { if (!safeSegment(graph, from, point, actor.worker)) { path = []; break; } from = point; }
      if (!path.length) path = safeSegment(graph, actor.point, target.point, actor.worker) ? [target.point] : pathTo(graph, actor.point, target.point, actor.worker);
      actor.path = path; actor.arrival = path.length ? target.arc : null;
    }
    function returnHome(actor, graph) {
      actor.formation = null;
      if (actor.followParent || actor.cursor !== null && actor.cursor !== undefined) { actor.path = []; clearFollow(actor); }
      if (distance(actor.point, actor.worker.chair) <= 0.001) { actor.path = []; return; }
      const key = 'home';
      if (actor.targetKey !== key) { actor.path = pathTo(graph, actor.point, actor.worker.chair, actor.worker); actor.targetKey = key; }
    }
    function step(now, { stale = false, reduced = false } = {}) {
      const elapsed = last === null ? 0 : Math.max(0, Math.min(250, now - last)); last = now;
      const output = [], formations = new Map();
      for (const { actor } of ordered) {
        const { worker } = actor, graph = graphs.get(worker.platformKey), parent = actors.get(worker.parentId);
        const frozen = Boolean(isStale(worker, stale) || (Number.isFinite(actor.depth) && parent?.frozen) || closed(worker));
        actor.frozen = frozen;
        if (reduced) { actor.point = { ...worker.chair }; actor.path = []; actor.trail = []; clearFollow(actor); actor.due = now + 2000; }
        else if (frozen) { actor.path = []; actor.trail = []; clearFollow(actor); }
        else {
          const following = canFollow(actor, parent, stale);
          let assignment;
          if (following) {
            if (!formations.has(parent.worker.id)) formations.set(parent.worker.id, formationFor(parent, graph, stale));
            assignment = formations.get(parent.worker.id).find(entry => entry.actor === actor);
          }
          if (atDesk(worker) || (worker.kind === 'helper' && !following)) returnHome(actor, graph);
          else if (following) follow(actor, parent, graph, assignment);
          else if (!actor.path.length && now >= actor.due && graph?.cells.size) {
            const cells = [...graph.cells.values()], target = cells[(Model.hash(worker.id) + ++actor.trip * 97) % cells.length];
            actor.path = pathTo(graph, actor.point, target, worker); actor.targetKey = null;
          }
          const ambient = !atDesk(worker) && (worker.kind !== 'helper' || following);
          if (ambient) record(actor, actor.point);
          else { actor.trail = []; actor.arc = 0; }
          let remaining = elapsed * 1.6 / 1000;
          while (actor.path.length && remaining > 0) {
            const target = actor.path[0], dx = target.x - actor.point.x, dy = target.y - actor.point.y, length = Math.hypot(dx, dy);
            if (length > 0.0001) actor.direction = direction(dx, dy);
            if (length <= remaining) { actor.point = { ...target }; actor.path.shift(); remaining -= length; }
            else { actor.point = { x: actor.point.x + dx * remaining / length, y: actor.point.y + dy * remaining / length, z: 0 }; remaining = 0; }
            if (ambient) record(actor, actor.point);
            if (!actor.path.length) {
              actor.due = now + 4000 + Model.hash(worker.id) % 7000;
              if (following) follow(actor, parent, graph, assignment);
            }
          }
        }
        const pose = frozen ? 'idle' : !reduced && actor.path.length ? 'walk' : worker.row.status === 'working' ? 'working' : worker.row.status === 'blocked' ? 'waiting' : 'idle';
        output.push({ id: worker.id, point: { ...actor.point }, pose, direction: pose === 'working' || pose === 'waiting' ? 'south' : actor.direction });
      }
      for (const actor of actors.values()) if (actor.formation && !formations.has(actor.worker.id)) actor.formation = null;
      return output;
    }
    return { reconcile, step, reset };
  }
  return { build, project, unproject, fit, focus, platformBounds, focusPlatform, hitPlatform, zoomAt, pan, toScreen, fromScreen, hitTest, endpoint, route, pending, createMovement };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ObserverScene;
