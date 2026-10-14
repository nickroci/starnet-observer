/* Isometric observer renderer. Paints ObserverScene geometry, observed crews and courier frames on one Canvas2D.
   Everything that moves or glows is either observed metadata (pose, desk lamp, drones, envelopes) or labelled
   ambient decoration (strolls, monitor glyphs, stars, radar, shuttle); ambient effects stop when stale or reduced.
   The view never fetches: freshness, hover text, names, mail frames and the inspected id all come from callbacks. */
'use strict';
const ObserverView = (() => {
  const Scene = typeof module !== 'undefined' && module.exports ? require('./observer-scene.js') : ObserverScene;
  const PALETTE = Object.freeze({
    space: '#020406', hullTop: '#1b2026', hullSeam: '#12161a', hullLeft: '#0c0f12', hullRight: '#13171c', wall: '#151a1f',
    wallCap: '#2a3138', grate: '#161a1f', grateDark: '#0f1215', window: '#ff9d3a', amber: '#c8781c', cyan: '#3fd8e8', rail: '#3a424c',
    console: '#232a31', consoleTop: '#2e363e', chair: '#1a1f25', glass: 'rgba(6,9,8,0.92)', ink: '#dcf3e3', dim: '#8fb59c', focus: '#fff27a',
    repo: '#7ef2d8'
  });
  const STATUS = Object.freeze({ working: '#6ff7a0', blocked: '#ffbd5c', idle: '#7c8a83', done: '#7c8a83', unknown: '#4a524e' });
  const LOD = Object.freeze({ overview: 0.45, detail: 1.1 });
  const CACHE = Object.freeze({ pixels: 4e6, axis: 4096, buckets: [0.25, 0.5, 1, 2] });
  /* Approved skins draw about 19 design px tall natively (76 source px at 0.25). Crew stand ~40 px: just under
     two height units beside 48x24 floor diamonds, matching the fallback silhouette so loading never resizes them. */
  const SPRITE_SCALE = 2.1, CREW_HEIGHT = 40, MIN_HIT = 20, ZOOM_STEP = 1.25;
  const SKIN = { claude: 'blank_amber', codex: 'blank_blue' };
  const P = Scene.project;

  // ---------- pure helpers (exported for tests) ----------
  const lodFor = zoom => zoom < LOD.overview ? 'overview' : zoom < LOD.detail ? 'sections' : 'detail';
  // One static-layer resolution per zoom bucket, capped by the pixel budget so huge decks never allocate unbounded canvases.
  function cacheResolution(bounds, zoom, dpr) {
    const want = Math.max(0.01, zoom * dpr), bucket = CACHE.buckets.find(value => value >= want) || CACHE.buckets.at(-1);
    const w = Math.max(1, bounds.maxX - bounds.minX), h = Math.max(1, bounds.maxY - bounds.minY);
    return Math.min(bucket, CACHE.axis / w, CACHE.axis / h, Math.sqrt(CACHE.pixels / (w * h)));
  }
  const statusSignature = scene => scene.workers.map(worker => worker.id + ':' + worker.row.status).sort().join('|');
  // Greedy by priority: a plate is dropped, never overlapped, when it collides with an accepted higher-priority plate.
  function placePlates(plates) {
    const accepted = [];
    for (const plate of plates.slice().sort((a, b) => b.priority - a.priority)) {
      const hit = accepted.some(other => plate.x < other.x + other.w && other.x < plate.x + plate.w && plate.y < other.y + other.h && other.y < plate.y + plate.h);
      if (!hit) accepted.push(plate);   // `force` only keeps a plate on stage (stagePlates); priority alone settles collisions
    }
    return accepted;
  }
  /* Plates whose anchor is off stage are discarded, except forced hover/focus plates, which are clamped into view.
     Clamping happens before collision resolution, so what is accepted is exactly what is drawn. */
  function stagePlates(plates, viewport, margin = 4) {
    return plates.filter(plate => plate.force || (plate.x + plate.w > 0 && plate.x < viewport.width && plate.y + plate.h > 0 && plate.y < viewport.height))
      .map(plate => ({ ...plate, x: Math.max(margin, Math.min(viewport.width - plate.w - margin, plate.x)), y: Math.max(margin, Math.min(viewport.height - plate.h - margin, plate.y)) }));
  }
  /* Envelopes that share a logical anchor (off-deck groups all rest at the pod) are stacked for display only,
     in a stable order (label, then colour), 14 design px apart; their scene coordinates are left untouched. */
  function stackEnvelopes(envelopes) {
    const groups = new Map();
    for (const envelope of envelopes) {
      const key = [envelope.point.x, envelope.point.y, envelope.point.z || 0].map(value => Math.round(value * 100)).join(',');
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(envelope);
    }
    return [...groups.values()].flatMap(group => group.slice().sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')) || String(a.color).localeCompare(String(b.color)))
      .map((envelope, index) => ({ envelope, lift: index * 14 })));
  }
  const hash = text => { let value = 2166136261; for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; };
  const center = rect => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

  // ---------- primitive painters (design pixels) ----------
  function poly(ctx, points, fill, stroke) {
    ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  const rectPoly = (rect, z = 0) => [P({ x: rect.x, y: rect.y, z }), P({ x: rect.x + rect.w, y: rect.y, z }), P({ x: rect.x + rect.w, y: rect.y + rect.h, z }), P({ x: rect.x, y: rect.y + rect.h, z })];
  /* Camera-facing side faces of a floor polygon wound like corners(): (x,y) → (x,y+h) → (x+w,y+h) → (x+w,y).
     The outward normal of edge a→b is (a.y-b.y, b.x-a.x); a face is visible when it points toward the viewer
     (nx+ny>0). `side` is right (lit, +x) or left (shaded, +y). */
  function visibleFaces(points) {
    const faces = [];
    for (let index = 0; index < points.length; index++) {
      const a = points[index], b = points[(index + 1) % points.length], nx = a.y - b.y, ny = b.x - a.x;
      if (nx + ny <= 0.0001) continue;
      faces.push({ a, b, side: nx > ny + 0.0001 ? 'right' : ny > nx + 0.0001 ? 'left' : 'mid' });
    }
    return faces;
  }
  function prism(ctx, corners, top, bottom, colors) {
    for (const { a, b, side } of visibleFaces(corners))
      poly(ctx, [P({ ...a, z: top }), P({ ...b, z: top }), P({ ...b, z: bottom }), P({ ...a, z: bottom })], colors[side] || colors.right);
    poly(ctx, corners.map(point => P({ ...point, z: top })), colors.top, colors.edge);
  }
  const corners = rect => [{ x: rect.x, y: rect.y }, { x: rect.x, y: rect.y + rect.h }, { x: rect.x + rect.w, y: rect.y + rect.h }, { x: rect.x + rect.w, y: rect.y }];
  const box = (ctx, rect, height, colors, base = 0) => prism(ctx, corners(rect), base + height, base, colors);
  function isoEllipse(ctx, point, radius, stroke, fill, width = 1) {
    const at = P(point); ctx.beginPath(); ctx.ellipse(at.x, at.y, radius * 34, radius * 17, 0, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke(); ctx.lineWidth = 1; }
  }
  function glow(ctx, point, radius, color, alpha) {
    const at = P(point), gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
    gradient.addColorStop(0, color); gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.ellipse(at.x, at.y, radius, radius / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function line(ctx, a, b, color, width = 1, alpha = 1) {
    const from = P(a), to = P(b); ctx.save(); ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.restore();
  }
  const shade = (color, amount) => {
    const value = parseInt(String(color).slice(1, 7), 16); if (!Number.isFinite(value)) return color;
    const channel = shift => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * (1 + amount))));
    return '#' + [16, 8, 0].map(shift => channel(shift).toString(16).padStart(2, '0')).join('');
  };

  // ---------- static world art: decks, skirts, walls, walkways, hub, wall props, status light pools ----------
  function paintDeck(ctx, rect, accent, sectionRects) {
    const deck = { top: PALETTE.hullTop, left: PALETTE.hullLeft, right: PALETTE.hullRight };
    prism(ctx, corners(rect), 0, -1, deck);
    sectionRects.forEach((section, index) => { if (index % 2) poly(ctx, rectPoly(section), 'rgba(255,255,255,0.025)'); });
    ctx.save(); ctx.globalAlpha = 0.55;
    for (let x = rect.x + 2; x < rect.x + rect.w; x += 2) line(ctx, { x, y: rect.y }, { x, y: rect.y + rect.h }, PALETTE.hullSeam);
    for (let y = rect.y + 2; y < rect.y + rect.h; y += 2) line(ctx, { x: rect.x, y }, { x: rect.x + rect.w, y }, PALETTE.hullSeam);
    ctx.restore();
    // Warm window strips along both visible skirt faces, rivets at the corners.
    for (let x = rect.x + 0.75; x < rect.x + rect.w - 0.5; x += 1.5) poly(ctx, [P({ x, y: rect.y + rect.h, z: -0.38 }), P({ x: x + 0.6, y: rect.y + rect.h, z: -0.38 }), P({ x: x + 0.6, y: rect.y + rect.h, z: -0.55 }), P({ x, y: rect.y + rect.h, z: -0.55 })], 'rgba(255,157,58,0.72)');
    for (let y = rect.y + 0.75; y < rect.y + rect.h - 0.5; y += 1.5) poly(ctx, [P({ x: rect.x + rect.w, y, z: -0.38 }), P({ x: rect.x + rect.w, y: y + 0.6, z: -0.38 }), P({ x: rect.x + rect.w, y: y + 0.6, z: -0.55 }), P({ x: rect.x + rect.w, y, z: -0.55 })], 'rgba(255,157,58,0.6)');
    // Project hue: front-top edge lamp strip.
    line(ctx, { x: rect.x, y: rect.y + rect.h }, { x: rect.x + rect.w, y: rect.y + rect.h }, accent, 2, 0.9);
    line(ctx, { x: rect.x + rect.w, y: rect.y }, { x: rect.x + rect.w, y: rect.y + rect.h }, accent, 2, 0.9);
  }
  function paintRearWalls(ctx, rect) {
    const height = 1.25, wall = { x: [P({ x: rect.x, y: rect.y }), P({ x: rect.x, y: rect.y + rect.h }), P({ x: rect.x, y: rect.y + rect.h, z: height }), P({ x: rect.x, y: rect.y, z: height })],
      y: [P({ x: rect.x, y: rect.y }), P({ x: rect.x + rect.w, y: rect.y }), P({ x: rect.x + rect.w, y: rect.y, z: height }), P({ x: rect.x, y: rect.y, z: height })] };
    poly(ctx, wall.x, PALETTE.hullRight); poly(ctx, wall.y, PALETTE.wall);
    ctx.save(); ctx.globalAlpha = 0.6;
    for (let y = rect.y + 2; y < rect.y + rect.h; y += 2) line(ctx, { x: rect.x, y, z: 0 }, { x: rect.x, y, z: height }, PALETTE.hullSeam);
    for (let x = rect.x + 2; x < rect.x + rect.w; x += 2) line(ctx, { x, y: rect.y, z: 0 }, { x, y: rect.y, z: height }, PALETTE.hullSeam);
    ctx.restore();
    line(ctx, { x: rect.x, y: rect.y + rect.h, z: height }, { x: rect.x, y: rect.y, z: height }, PALETTE.wallCap, 2);
    line(ctx, { x: rect.x, y: rect.y, z: height }, { x: rect.x + rect.w, y: rect.y, z: height }, PALETTE.wallCap, 2);
  }
  // Wall and corner furnishings never reshuffle between polls: the kind is a hash of platform key and region.
  const WALL_KINDS = ['rack', 'screen', 'vent', 'rack', 'board'], CORNER_KINDS = ['tank', 'planter', 'crates', 'mast'];
  const wallUnits = (region) => {
    const r = region.rect;
    if (region.kind === 'corner') return [r];
    return region.edge === 'rear-x'
      ? Array.from({ length: Math.floor(r.h / 3) }, (_, i) => ({ x: r.x, y: r.y + i * 3 + 0.5, w: r.w, h: 2 }))
      : Array.from({ length: Math.floor(r.w / 3) }, (_, i) => ({ x: r.x + i * 3 + 0.5, y: r.y, w: 2, h: r.h }));
  };
  /* Pure geometry, so every footprint is testable against the scene's reserved region (the walk obstacle).
     Wall units are laid out in (along, depth) terms: a rear-x unit is only 0.6 deep, so depth is fitted, never assumed. */
  function furnishing(kind, unit, edge) {
    const rearX = edge === 'rear-x', depth = rearX ? unit.w : unit.h;
    const at = (a, d, z = 0) => rearX ? { x: unit.x + d, y: unit.y + a, z } : { x: unit.x + a, y: unit.y + d, z };
    const foot = (a, d, along, deep) => rearX ? { x: unit.x + d, y: unit.y + a, w: deep, h: along } : { x: unit.x + a, y: unit.y + d, w: along, h: deep };
    const fit = (inset, want) => { const deep = Math.min(want, depth - 0.2); return [Math.min(inset, depth - deep - 0.1), deep]; };
    const box = (rect, height, colors, base = 0) => ({ box: rect, height, colors, base });
    const stroke = (a, b, color, width = 1, alpha = 1) => ({ line: [a, b], color, width, alpha });
    const dark = { top: '#262d34', left: '#101418', right: '#171c21' };
    if (kind === 'rack') {
      const [d, deep] = fit(0.1, 1), front = d + deep, out = [box(foot(0.1, d, 1.4, deep), 1.1, dark)];
      for (let z = 0.25; z < 1; z += 0.22) out.push(stroke(at(0.3, front, z), at(1.1, front, z), '#2b343c'));
      return out;
    }
    if (kind === 'screen') {
      const [d, deep] = fit(0.05, 0.12), front = d + deep, face = [at(0.2, front, 0.45), at(1.8, front, 0.45), at(1.8, front, 1.05), at(0.2, front, 1.05)];
      return [box(foot(0.1, d, 1.8, deep), 1.1, dark), { quad: face, fill: '#0b2a30', stroke: PALETTE.cyan },
        stroke({ ...face[0], z: 0.62 }, { ...face[1], z: 0.85 }, PALETTE.cyan, 1, 0.7)];
    }
    if (kind === 'vent') {
      const [d, deep] = fit(0.2, 0.6), front = d + deep;
      return [box(foot(0.3, d, 1.2, deep), 0.5, { top: '#2a2219', left: '#140f0a', right: '#1d160e' }), stroke(at(0.4, front, 0.3), at(1.4, front, 0.3), PALETTE.amber, 1, 0.8)];
    }
    if (kind === 'board') { const [d, deep] = fit(0.2, 0.3); return [box(foot(0.2, d, 1.4, deep), 0.9, { top: '#3a3024', left: '#1e1810', right: '#2a2116' })]; }
    if (kind === 'tank') return [box(foot(0.1, 0.2, 0.8, 0.8), 1.0, { top: '#2b3a40', left: '#122026', right: '#1a2a30' }), stroke(at(0.1, 1, 0.6), at(0.9, 1, 0.6), PALETTE.cyan, 1, 0.6)];
    if (kind === 'planter') return [box(foot(0.1, 0.3, 0.8, 1.2), 0.35, { top: '#1f3a24', left: '#0f1a12', right: '#16261a' }),
      ...[[0.3, 0.6], [0.6, 1.1], [0.45, 0.9]].map(([a, d]) => ({ ellipse: at(a, d, 0.55), radius: 0.16, fill: '#3f8a46' }))];
    if (kind === 'crates') return [box(foot(0.1, 0.3, 0.8, 0.8), 0.5, { top: '#5a4428', left: '#2a1f12', right: '#3d2d1a' }),
      box(foot(0.2, 0.4, 0.5, 0.5), 0.4, { top: '#6a5230', left: '#2f2214', right: '#45331d' }, 0.5)];
    return [stroke(at(0.5, 1, 0), at(0.5, 1, 2.2), PALETTE.rail, 2), { ellipse: at(0.5, 1, 2.2), radius: 0.12, fill: '#ff5a3a' }];
  }
  function furnishings(platform, region, index) {
    const kinds = region.kind === 'corner' ? CORNER_KINDS : WALL_KINDS;
    return wallUnits(region).flatMap((unit, slot) => furnishing(kinds[hash(platform.key + ':' + index + ':' + slot) % kinds.length], unit, region.edge));
  }
  function paintWallRegion(ctx, platform, region, index) {
    for (const part of furnishings(platform, region, index)) {
      if (part.box) box(ctx, part.box, part.height, part.colors, part.base);
      else if (part.line) line(ctx, part.line[0], part.line[1], part.color, part.width, part.alpha);
      else if (part.quad) poly(ctx, part.quad.map(P), part.fill, part.stroke);
      else isoEllipse(ctx, part.ellipse, part.radius, null, part.fill);
    }
  }
  function paintWalkway(ctx, walkway) {
    const r = walkway.rect;
    prism(ctx, corners(r), 0, -0.35, { top: PALETTE.grate, left: PALETTE.hullLeft, right: PALETTE.hullRight });
    ctx.save(); ctx.globalAlpha = 0.5;
    for (let x = r.x + 0.5; x < r.x + r.w; x += 0.5) line(ctx, { x, y: r.y }, { x, y: r.y + r.h }, PALETTE.grateDark);
    for (let y = r.y + 0.5; y < r.y + r.h; y += 0.5) line(ctx, { x: r.x, y }, { x: r.x + r.w, y }, PALETTE.grateDark);
    ctx.restore();
    const long = r.w >= r.h, length = long ? r.w : r.h;
    for (let t = 0; t <= length; t += 2) {
      for (const side of [0, 1]) {
        const base = long ? { x: r.x + t, y: r.y + side * r.h } : { x: r.x + side * r.w, y: r.y + t };
        line(ctx, { ...base, z: 0 }, { ...base, z: 0.3 }, PALETTE.rail, 1);
        if (t % 8 === 0 && side) isoEllipse(ctx, { ...base, z: 0.34 }, 0.06, null, PALETTE.window);
      }
      if (t % 6 === 0) { const base = long ? { x: r.x + t, y: r.y + r.h } : { x: r.x + r.w, y: r.y + t }; line(ctx, { ...base, z: -0.35 }, { ...base, z: -2.5 }, '#0b0e11', 2, 0.8); }
    }
    for (const side of [0, 1]) {
      const a = long ? { x: r.x, y: r.y + side * r.h } : { x: r.x + side * r.w, y: r.y }, b = long ? { x: r.x + r.w, y: r.y + side * r.h } : { x: r.x + side * r.w, y: r.y + r.h };
      line(ctx, { ...a, z: 0.3 }, { ...b, z: 0.3 }, PALETTE.rail, 1);
    }
  }
  function paintHub(ctx, mail) {
    const r = mail.rect, c = 2, oct = [{ x: r.x + c, y: r.y }, { x: r.x, y: r.y + c }, { x: r.x, y: r.y + r.h - c }, { x: r.x + c, y: r.y + r.h },
      { x: r.x + r.w - c, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h - c }, { x: r.x + r.w, y: r.y + c }, { x: r.x + r.w - c, y: r.y }];
    prism(ctx, oct, 0, -1.5, { top: '#1d2228', left: PALETTE.hullLeft, right: PALETTE.hullRight, mid: '#101317' });
    // Hazard chevron border: an amber dash over a black band, inset half a unit.
    const inset = [{ x: r.x + c, y: r.y + 0.5 }, { x: r.x + 0.5, y: r.y + c }, { x: r.x + 0.5, y: r.y + r.h - c }, { x: r.x + c, y: r.y + r.h - 0.5 },
      { x: r.x + r.w - c, y: r.y + r.h - 0.5 }, { x: r.x + r.w - 0.5, y: r.y + r.h - c }, { x: r.x + r.w - 0.5, y: r.y + c }, { x: r.x + r.w - c, y: r.y + 0.5 }].map(point => P(point));
    ctx.save(); ctx.lineWidth = 6; poly(ctx, inset, null, '#070809'); ctx.setLineDash([10, 10]); ctx.lineWidth = 4; poly(ctx, inset, null, PALETTE.amber); ctx.restore();
    for (const pad of mail.pads) { isoEllipse(ctx, pad, 1.1, PALETTE.amber, '#14181c', 1.5); isoEllipse(ctx, pad, 0.7, 'rgba(200,120,28,0.6)'); glow(ctx, pad, 30, PALETTE.amber, 0.18); }
    // Pod rack for off-deck routes and the outbound launch rail into space for outside endpoints.
    const pod = mail.pod[0]; box(ctx, { x: pod.x - 0.6, y: pod.y - 0.5, w: 1.2, h: 1 }, 0.9, { top: '#2a3138', left: '#111519', right: '#191e23' });
    for (let z = 0.25; z < 0.9; z += 0.3) line(ctx, { x: pod.x - 0.5, y: pod.y + 0.5, z }, { x: pod.x + 0.5, y: pod.y + 0.5, z }, PALETTE.cyan, 1, 0.5);
    const chute = mail.chute[0];
    box(ctx, { x: r.x - 1.5, y: chute.y - 0.35, w: chute.x - r.x + 2, h: 0.7 }, 0.25, { top: '#2b2620', left: '#120f0b', right: '#1b1712' });
    for (let x = r.x - 1.2; x < chute.x; x += 0.8) line(ctx, { x, y: chute.y - 0.3, z: 0.26 }, { x: x - 0.3, y: chute.y, z: 0.26 }, PALETTE.amber, 1, 0.8);
    const t = mail.tower;
    box(ctx, t, 3.2, { top: '#232a31', left: '#0d1013', right: '#151a1f' });
    line(ctx, { x: t.x, y: t.y + t.h, z: 2.4 }, { x: t.x + t.w, y: t.y + t.h, z: 2.4 }, PALETTE.cyan, 2, 0.8);
    line(ctx, { x: t.x + t.w, y: t.y, z: 2.4 }, { x: t.x + t.w, y: t.y + t.h, z: 2.4 }, PALETTE.cyan, 2, 0.8);
    for (let z = 0.6; z < 2.2; z += 0.5) line(ctx, { x: t.x + 0.6, y: t.y + t.h, z }, { x: t.x + t.w - 0.6, y: t.y + t.h, z }, 'rgba(255,157,58,0.55)', 2);
  }
  function paintStatic(ctx, scene) {
    const hub = scene.mail.rect;
    const pieces = [
      ...scene.platforms.map(platform => ({ key: center(platform.rect).x + center(platform.rect).y, paint: () => paintDeck(ctx, platform.rect, platform.accent, platform.sections.map(s => s.rect)) })),
      ...scene.walkways.map(walkway => {
        // Hub links stop at the hub edge so the grate never paints over the pad.
        const r = walkway.rect, rect = walkway.kind !== 'hub-link' ? r : r.x < hub.x ? { ...r, w: Math.max(0, hub.x - r.x) } : { ...r, x: hub.x + hub.w, w: Math.max(0, r.x + r.w - hub.x - hub.w) };
        return { key: center(rect).x + center(rect).y + (walkway.kind === 'connector' ? 40 : 0), paint: () => rect.w > 0 && paintWalkway(ctx, { ...walkway, rect }) };
      }),
      { key: center(hub).x + center(hub).y + 0.01, paint: () => paintHub(ctx, scene.mail) },
      ...(scene.observatory ? [{ key: middle(scene.observatory.rect), paint: () => paintObservatoryDeck(ctx, scene.observatory) }] : [])
    ].sort((a, b) => a.key - b.key);
    for (const piece of pieces) piece.paint();
    for (const platform of scene.platforms) {
      paintRearWalls(ctx, platform.rect);
      platform.decorationRegions.forEach((region, index) => { if (region.kind === 'wall' || region.kind === 'corner') paintWallRegion(ctx, platform, region, index); });
    }
    // Status-driven light pools: the screen glow on a seated worker, never title or timestamp driven.
    for (const worker of scene.workers) {
      const status = worker.row.status, scale = worker.scale || 1;
      glow(ctx, { ...worker.chair, y: worker.chair.y + 0.4 }, 44 * scale, PALETTE.cyan, status === 'working' ? 0.35 : status === 'blocked' ? 0.12 : 0.06);
      if (status === 'blocked') glow(ctx, { x: worker.desk.x + worker.desk.w - 0.2, y: worker.desk.y + 0.2 }, 26 * scale, STATUS.blocked, 0.25);
    }
    // Helper tethers: a dashed floor line from the helper's chair to its exact immediate parent's chair.
    for (const worker of scene.workers) if (worker.connector) {
      const from = P(worker.connector.from), to = P(worker.connector.to);
      ctx.save(); ctx.globalAlpha = 0.6; ctx.strokeStyle = worker.accent; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke(); ctx.restore();
    }
  }
  // Observatory deck: a cool counterweight to the amber mailroom. Tall props are depth items, never cached here.
  function paintObservatoryDeck(ctx, observatory) {
    const r = observatory.rect;
    prism(ctx, corners(r), 0, -1, { top: '#161d24', left: PALETTE.hullLeft, right: PALETTE.hullRight });
    ctx.save(); ctx.globalAlpha = 0.5;
    for (let x = r.x + 2; x < r.x + r.w; x += 2) line(ctx, { x, y: r.y }, { x, y: r.y + r.h }, '#0f2a33');
    for (let y = r.y + 2; y < r.y + r.h; y += 2) line(ctx, { x: r.x, y }, { x: r.x + r.w, y }, '#0f2a33');
    ctx.restore();
    line(ctx, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }, PALETTE.cyan, 2, 0.7);
    line(ctx, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, PALETTE.cyan, 2, 0.7);
    paintRearWalls(ctx, r);
    const light = observatory.light.rect;
    glow(ctx, { x: light.x + light.w / 2, y: light.y + light.h / 2 + 1.5 }, 70, PALETTE.cyan, 0.35);
  }
  // Observatory props: each returns a depth item for the shared stream, so crew walking past occlude correctly.
  const middle = rect => rect.x + rect.w / 2 + rect.y + rect.h / 2;
  function paintObservatoryScreen(ctx, screen, now, animate) {
    const r = screen.rect, front = r.y + r.h, top = screen.height - 0.4;
    box(ctx, { x: r.x, y: r.y, w: r.w, h: 0.3 }, screen.height, { top: '#20272e', left: '#0d1013', right: '#151a1f' });
    const face = [{ x: r.x + 0.15, y: r.y + 0.3, z: 1.1 }, { x: r.x + r.w - 0.15, y: r.y + 0.3, z: 1.1 }, { x: r.x + r.w - 0.15, y: r.y + 0.3, z: top }, { x: r.x + 0.15, y: r.y + 0.3, z: top }];
    poly(ctx, face.map(P), '#071c24', PALETTE.cyan);
    // Ambient radar sweep; a frozen scene keeps one fixed phase.
    const phase = animate ? (now / 6000 + r.x / 7) % 1 : 0.3, x = r.x + 0.15 + phase * (r.w - 0.3);
    line(ctx, { x, y: r.y + 0.3, z: 1.15 }, { x, y: r.y + 0.3, z: top - 0.05 }, PALETTE.cyan, 1, 0.6);
    line(ctx, { x: r.x, y: front, z: 0 }, { x: r.x + r.w, y: front, z: 0 }, '#0d1013', 1, 0.6);
  }
  function paintTelescope(ctx, telescope, now, animate) {
    const r = telescope.rect, base = { x: r.x + r.w / 2, y: r.y + r.h / 2 }, mount = { ...base, z: 1.6 };
    for (const [dx, dy] of [[-0.4, 0.3], [0.4, 0.3], [0, -0.45]]) line(ctx, { x: base.x + dx, y: base.y + dy, z: 0 }, mount, PALETTE.rail, 1.5);
    // A slow ±6° ambient sweep over the rear rail, frozen when stale or reduced.
    const angle = (animate ? Math.sin(now / 40000 * Math.PI * 2) * 6 : 0) * Math.PI / 180;
    const tip = { x: mount.x + Math.sin(angle) * 0.7, y: mount.y - Math.cos(angle) * 0.7, z: telescope.height - 0.3 }, tail = { x: mount.x - Math.sin(angle) * 0.3, y: mount.y + Math.cos(angle) * 0.3, z: 1.3 };
    line(ctx, tail, tip, '#c9d3da', 4); line(ctx, tail, tip, '#5b6b78', 2);
    isoEllipse(ctx, tip, 0.08, null, PALETTE.cyan);
  }
  function paintPlant(ctx, plant) {
    const r = plant.rect;
    box(ctx, { x: r.x + 0.25, y: r.y + 0.25, w: 0.5, h: 0.5 }, 0.45, { top: '#1f3a24', left: '#0f1a12', right: '#16261a' });
    for (const [dx, dy, z] of [[0.4, 0.5, 0.9], [0.65, 0.4, 1.3], [0.5, 0.6, 1.7]]) isoEllipse(ctx, { x: r.x + dx, y: r.y + dy, z }, 0.22, null, '#3f8a46');
  }
  function paintLamp(ctx, light) {
    const r = light.rect, post = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    line(ctx, { ...post, z: 0 }, { ...post, z: light.height - 0.2 }, PALETTE.rail, 2);
    isoEllipse(ctx, { ...post, z: light.height - 0.15 }, 0.16, null, PALETTE.cyan);
  }
  // The Viewer is ambient: the neutral fallback figure, never a provider skin, status colour or hit target.
  function paintViewer(ctx, viewer) {
    const foot = P(viewer.point), h = CREW_HEIGHT, w = 16;
    isoEllipse(ctx, viewer.point, 0.28, null, 'rgba(0,0,0,0.38)');
    ctx.save(); ctx.globalAlpha = 0.8; ctx.fillStyle = '#6f7a82'; ctx.strokeStyle = '#05080a';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(foot.x - w / 2, foot.y - h * 0.72, w, h * 0.72, 6) : ctx.rect(foot.x - w / 2, foot.y - h * 0.72, w, h * 0.72); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(foot.x, foot.y - h * 0.84, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
  }

  // ---------- dynamic items (depth sorted with crew) ----------
  function paintDesk(ctx, worker, now, animate) {
    const d = worker.desk, status = worker.row.status;
    box(ctx, d, 0.55, { top: PALETTE.consoleTop, left: '#14191e', right: '#1c2228', edge: 'rgba(255,255,255,0.05)' });
    // Side monitors leave the seated worker's face clear; the camera sees their lit rims.
    const rim = status === 'working' ? 0.95 : status === 'blocked' ? 0.6 : 0.3;
    for (const x of [d.x + 0.05, d.x + 1.55]) {
      box(ctx, { x, y: d.y + 0.1, w: 0.4, h: 0.5 }, 0.5, { top: '#0e1216', left: '#0a0d10', right: '#11161a' }, 0.55);
      line(ctx, { x, y: d.y + 0.6, z: 1.05 }, { x: x + 0.4, y: d.y + 0.6, z: 1.05 }, PALETTE.cyan, 1.5, rim);
      if (animate && status === 'working') {
        const scroll = ((now / 600 + hash(worker.id) % 7) % 3) / 3;
        for (let i = 0; i < 3; i++) line(ctx, { x: x + 0.05, y: d.y + 0.6, z: 0.65 + ((i / 3 + scroll) % 1) * 0.35 }, { x: x + 0.3, y: d.y + 0.6, z: 0.65 + ((i / 3 + scroll) % 1) * 0.35 }, PALETTE.cyan, 1, 0.35);
      }
    }
    // Observed status lamp: steady, never blinking.
    const lamp = { x: d.x + 1.85, y: d.y + 0.9, z: 0.6 };
    isoEllipse(ctx, lamp, 0.09, null, STATUS[status] || STATUS.unknown);
    if (status === 'working' || status === 'blocked') glow(ctx, lamp, 10, STATUS[status], 0.6);
  }
  // A helper's jump seat: one compact console that stays inside its reviewed desk footprint (w1 × h0.72).
  function paintHelperDesk(ctx, worker, now, animate) {
    const d = worker.desk, status = worker.row.status;
    box(ctx, d, 0.45, { top: shade(worker.accent, -0.6), left: '#14191e', right: '#1c2228', edge: 'rgba(255,255,255,0.05)' });
    const screen = { x: d.x + d.w - 0.35, y: d.y + 0.08, w: 0.3, h: 0.36 };
    box(ctx, screen, 0.4, { top: '#0e1216', left: '#0a0d10', right: '#11161a' }, 0.45);
    const rimY = screen.y + screen.h, rim = status === 'working' ? 0.95 : status === 'blocked' ? 0.6 : 0.3;
    line(ctx, { x: screen.x, y: rimY, z: 0.85 }, { x: screen.x + screen.w, y: rimY, z: 0.85 }, PALETTE.cyan, 1, rim);
    if (animate && status === 'working') {
      const scroll = ((now / 600 + hash(worker.id) % 7) % 3) / 3;
      for (let i = 0; i < 2; i++) line(ctx, { x: screen.x + 0.04, y: rimY, z: 0.5 + ((i / 2 + scroll) % 1) * 0.3 }, { x: screen.x + 0.24, y: rimY, z: 0.5 + ((i / 2 + scroll) % 1) * 0.3 }, PALETTE.cyan, 1, 0.35);
    }
    const lamp = { x: d.x + 0.15, y: d.y + d.h - 0.15, z: 0.5 };
    isoEllipse(ctx, lamp, 0.07, null, STATUS[status] || STATUS.unknown);
    if (status === 'working' || status === 'blocked') glow(ctx, lamp, 8, STATUS[status], 0.6);
  }
  function paintChair(ctx, worker) {
    const c = worker.chair, s = worker.scale || 1;
    box(ctx, { x: c.x - 0.3 * s, y: c.y - 0.35 * s, w: 0.6 * s, h: 0.5 * s }, 0.35 * s, { top: '#20262c', left: '#0f1317', right: '#161b20' });
    box(ctx, { x: c.x - 0.3 * s, y: c.y - 0.45 * s, w: 0.6 * s, h: 0.1 * s }, 0.55 * s, { top: '#252c33', left: '#0f1317', right: '#161b20' }, 0.35 * s);
  }
  // Low repository partition, one unit long: long walls are cut into units so they depth-sort correctly with crew.
  function paintPartition(ctx, unit, accent) {
    box(ctx, unit, 0.6, { top: '#2a3138', left: '#12161a', right: '#191e23' });
    line(ctx, { x: unit.x, y: unit.y + unit.h, z: 0.6 }, { x: unit.x + unit.w, y: unit.y + unit.h, z: 0.6 }, accent, 1, 0.55);
  }
  function paintApronProp(ctx, region) {
    const r = region.rect, post = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    line(ctx, { ...post, z: 0 }, { ...post, z: 1.6 }, PALETTE.rail, 2);
    isoEllipse(ctx, { ...post, z: 1.65 }, 0.14, null, PALETTE.window);
    glow(ctx, { ...post, z: 0 }, 40, PALETTE.amber, 0.22);
  }

  // ---------- the view ----------
  function create({ canvas, onSelect = () => {}, onTitleToggle = () => {}, onPlatform = () => {}, onMode = () => {}, hoverLabel = () => null, nameFor = () => '', reducedMotion = () => false, onCamera = () => {}, env = {} }) {
    const win = env.window || (typeof window !== 'undefined' ? window : {});
    const raf = env.raf || (fn => win.requestAnimationFrame(fn)), caf = env.caf || (id => win.cancelAnimationFrame(id));
    const dprOf = env.dpr || (() => win.devicePixelRatio || 1);
    const makeCanvas = env.createCanvas || ((w, h) => { const node = win.document.createElement('canvas'); node.width = w; node.height = h; return node; });
    const sprites = env.sprites !== undefined ? env.sprites : (typeof SPRITES !== 'undefined' ? SPRITES : null);
    const ctx = canvas.getContext('2d');
    const movement = Scene.createMovement(), bodies = new Map();
    /* stale: the whole inventory (scene ambience). rowStale: one worker's own source health and observation time;
       a fresh Desktop source never animates or blesses a stale Herdr or helper row. */
    let scene = null, stale = () => false, rowStale = () => false, mailFrame = null, inspected = () => null;
    const workerStale = worker => !!stale() || !!rowStale(worker);
    // regions: hit-testable painted crew. anchors: every crew head/foot, painted or not, for plates whose box can
    // still reach the stage when the body itself is just off it.
    let camera = { zoom: 1, tx: 0, ty: 0 }, mode = 'overview', platform = null, focused = null, hovered = null, pointer = null, regions = [], anchors = [];
    // Listed helpers without a floor station, counted on the worker they belong beside (or their platform sign).
    let overflowByWorker = new Map(), overflowByPlatform = new Map(), lastMovedAt = -Infinity;
    /* tap: the last completed click — its point, time and the worker it hit (or null). Selecting a worker moves the
       camera at once, so a following click or double-click at the same point keeps this target instead of hit-testing
       whatever geometry the moved camera now shows there. A drag, pinch, cancel or stop clears it; a worker that leaves
       stays recorded as the target, so the gesture selects nothing rather than the floor now under the old point. */
    let tap = null;
    const TAP_SLOP = 10, TAP_MS = 800;
    // titleRegions: accepted worker plates, valid only for their painted scene and camera.
    let titleRegions = [];
    const titleAt = point => paintedFrameCurrent() ? titleRegions.find(r => point.x >= r.left && point.x <= r.left + r.width && point.y >= r.top && point.y <= r.top + r.height)?.id || null : null;
    /* signRegions: the repository section signs actually drawn last frame, keyed by exact repository id. They are
       screen boxes for the scene and camera they were drawn with; after any change to either they hit nothing until
       the next paint, so a stale box can never toggle whichever repository the moved view now shows there. */
    let signRegions = [], plateFrame = null, repositories = new Set(), repositorySelection = () => null, onRepositoryToggle = () => {};
    const paintedFrameCurrent = () => !!plateFrame && plateFrame.scene === scene && plateFrame.zoom === camera.zoom && plateFrame.tx === camera.tx && plateFrame.ty === camera.ty;
    const signAt = point => {
      if (!paintedFrameCurrent()) return null;
      return signRegions.find(r => point.x >= r.left && point.x <= r.left + r.width && point.y >= r.top && point.y <= r.top + r.height)?.repo || null;
    };
    const sameTap = point => !!tap && Math.hypot(point.x - tap.point.x, point.y - tap.point.y) <= TAP_SLOP;
    function setMode(next, key = null) {
      if (next === mode && key === platform) return;
      mode = next; platform = key; onMode({ mode, platform });
    }
    let viewport = { width: 0, height: 0 }, dpr = 1, frame = null, running = false, staticLayer = null, stars = null, observer = null;
    const pointers = new Map(); let drag = null, pinch = null;
    // Paint scheduling: a live scene keeps its RAF; a frozen (stale or reduced) one paints once per invalidation.
    let dirty = false, reported = null, workerIndex = new Map(), signature = '', platformCounts = new Map();
    const readiness = new Map(), watchers = [];

    function measure() {
      const width = canvas.clientWidth || canvas.width || 1, height = canvas.clientHeight || canvas.height || 1, ratio = dprOf();
      if (width === viewport.width && height === viewport.height && ratio === dpr) return false;
      viewport = { width, height }; dpr = ratio;
      canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr));
      stars = null; reframe(); return true;
    }
    function limits() {
      if (!scene) return { canZoomIn: false, canZoomOut: false };
      const middle = { x: viewport.width / 2, y: viewport.height / 2 };
      return { canZoomIn: camera.zoom < Scene.zoomAt(camera, middle, 1e6, scene.bounds, viewport).zoom - 1e-6,
        canZoomOut: camera.zoom > Scene.zoomAt(camera, middle, 1e-6, scene.bounds, viewport).zoom + 1e-6 };
    }
    function setCamera(next) {
      const moved = next.zoom !== camera.zoom || next.tx !== camera.tx || next.ty !== camera.ty;
      camera = next;
      const now = limits();
      if (!reported || now.canZoomIn !== reported.canZoomIn || now.canZoomOut !== reported.canZoomOut) { reported = now; onCamera(now); }
      if (moved) invalidate();
    }
    // Coalesced: any number of invalidations before the next frame cost one paint.
    function invalidate() { dirty = true; if (running && frame === null) frame = raf(loop); }
    /* Overview refits; focus recentres its worker; platform refits its platform; manual keeps the user's view,
       clamped to the occupied scene. A removed worker or platform returns to the overview. */
    function reframe() {
      if (!scene) return;
      const worker = focused && workerIndex.get(focused), fitted = mode === 'platform' && Scene.focusPlatform(scene, platform, viewport);
      if (mode === 'focus' && worker) setCamera(Scene.focus(pointOf(focused) || worker.chair, scene.bounds, viewport));
      else if (fitted) setCamera(fitted);
      else if (mode === 'manual') setCamera(Scene.pan(camera, { x: 0, y: 0 }, scene.bounds, viewport));
      else { setMode('overview'); setCamera(Scene.fit(scene.bounds, viewport)); }
    }
    let actors = [];
    const pointOf = id => { const actor = actors.find(value => value.id === id); return actor ? actor.point : null; };

    function update(next, options = {}) {
      const revised = !scene || scene.revision !== next.revision;
      scene = next; workerIndex = new Map(scene.workers.map(worker => [worker.id, worker])); signature = statusSignature(scene);
      platformCounts = new Map(); for (const worker of scene.workers) platformCounts.set(worker.platformKey, (platformCounts.get(worker.platformKey) || 0) + 1);
      measure();
      if (typeof options.stale === 'function') stale = options.stale;
      if (typeof options.rowStale === 'function') rowStale = options.rowStale;
      if (typeof options.mailFrame === 'function') mailFrame = options.mailFrame;
      if (typeof options.inspected === 'function') inspected = options.inspected;
      if (typeof options.repositorySelection === 'function') repositorySelection = options.repositorySelection;
      if (typeof options.onRepositoryToggle === 'function') onRepositoryToggle = options.onRepositoryToggle;
      // A section sign names a repository only when a worker on the floor carries that exact repository id.
      repositories = new Set(scene.workers.map(worker => worker.row.repoId).filter(id => typeof id === 'string' && id));
      overflowByWorker = new Map(); overflowByPlatform = new Map();
      for (const entry of scene.helperOverflow || []) {
        const owner = [entry.parentId, entry.rootId].find(id => workerIndex.has(id));
        if (owner) overflowByWorker.set(owner, (overflowByWorker.get(owner) || 0) + 1);
        else overflowByPlatform.set(entry.platformKey, (overflowByPlatform.get(entry.platformKey) || 0) + 1);
      }
      movement.reconcile(scene, { now: clock(), stale: workerStale, reduced: reducedMotion() });
      for (const id of bodies.keys()) if (!scene.workers.some(worker => worker.id === id)) bodies.delete(id);
      if (focused && !scene.workers.some(worker => worker.id === focused)) { focused = null; if (mode === 'focus') setMode('overview'); }
      if (mode === 'platform' && !scene.platforms.some(value => value.key === platform)) setMode('overview');
      if (revised) reframe();
      invalidate();
    }
    const clock = env.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    function focus(id) {
      if (!scene) return;
      const worker = workerIndex.get(id);
      if (!worker) return;
      measure(); focused = id; setMode('focus'); setCamera(Scene.focus(pointOf(id) || worker.chair, scene.bounds, viewport));
    }
    // Fits one project platform. Never selects or inspects a worker; an unknown key changes nothing.
    function focusPlatform(key) {
      if (!scene) return false;
      measure();
      const next = Scene.focusPlatform(scene, key, viewport);
      if (!next) return false;
      focused = null; setMode('platform', key); setCamera(next);
      return true;
    }
    function overview() { focused = null; setMode('overview'); reframe(); }
    function zoomBy(factor, at) {
      if (!scene) return;
      measure(); setMode('manual'); setCamera(Scene.zoomAt(camera, at || { x: viewport.width / 2, y: viewport.height / 2 }, factor, scene.bounds, viewport));
    }
    function panBy(delta) { if (!scene) return; measure(); setMode('manual'); setCamera(Scene.pan(camera, delta, scene.bounds, viewport)); }

    // ---------- static layer cache ----------
    function staticFor() {
      const resolution = cacheResolution(scene.bounds, camera.zoom, dpr);
      const key = scene.revision + '#' + signature + '#' + resolution;
      if (staticLayer && staticLayer.key === key) return staticLayer;
      // Floor, never ceil: the continuous budget holds for the integer backing store too (≤ 4 MP, ≤ 4096 per axis).
      const b = scene.bounds, spanX = Math.max(1, b.maxX - b.minX), spanY = Math.max(1, b.maxY - b.minY);
      const width = Math.max(1, Math.floor(spanX * resolution)), height = Math.max(1, Math.floor(spanY * resolution));
      const layer = makeCanvas(width, height), layerCtx = layer.getContext('2d'), sx = width / spanX, sy = height / spanY;
      layerCtx.setTransform(sx, 0, 0, sy, -b.minX * sx, -b.minY * sy);
      paintStatic(layerCtx, scene);
      staticLayer = { key, canvas: layer, resolution, bounds: b, builds: (staticLayer ? staticLayer.builds : 0) + 1 };
      return staticLayer;
    }

    // ---------- space background (screen space, deterministic) ----------
    function starfield() {
      if (stars) return stars;
      const list = [];
      let seed = hash('starfield');
      const next = () => (seed = Math.imul(seed ^ (seed >>> 15), 2246822519) >>> 0) / 4294967296;
      for (let i = 0; i < 220; i++) list.push({ x: next(), y: next(), size: next() < 0.8 ? 1 : next() < 0.7 ? 1.5 : 2, a: 0.25 + next() * 0.6, twinkle: next() < 0.1, period: 4000 + next() * 3000 });
      stars = list; return stars;
    }
    function paintSpace(now, animate) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = PALETTE.space; ctx.fillRect(0, 0, viewport.width, viewport.height);
      const shiftX = animate ? camera.tx * 0.05 : 0, shiftY = animate ? camera.ty * 0.05 : 0;
      for (const star of starfield()) {
        const x = ((star.x * viewport.width + shiftX) % viewport.width + viewport.width) % viewport.width, y = ((star.y * viewport.height + shiftY) % viewport.height + viewport.height) % viewport.height;
        ctx.globalAlpha = star.twinkle && animate ? star.a * (0.55 + 0.45 * Math.sin(now / star.period * Math.PI * 2)) : star.a;
        ctx.fillStyle = '#cfe6ff'; ctx.fillRect(x, y, star.size, star.size);
      }
      ctx.globalAlpha = 1;
      // Distant planet arc anchored bottom-left of the stage, as in the reference.
      const radius = Math.max(viewport.width, viewport.height) * 0.42, cx = -radius * 0.35, cy = viewport.height + radius * 0.55;
      const planet = ctx.createRadialGradient(cx + radius * 0.3, cy - radius * 0.3, radius * 0.2, cx, cy, radius);
      planet.addColorStop(0, '#1b2a3a'); planet.addColorStop(0.85, '#0b131c'); planet.addColorStop(1, 'rgba(63,216,232,0.25)');
      ctx.fillStyle = planet; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
      // An occasional distant shuttle (ambient): eight seconds in every sixty.
      if (animate) {
        const t = now % 60000;
        if (t < 8000) { const x = viewport.width * (1.1 - (t / 8000) * 1.2), y = viewport.height * 0.12 + Math.sin(t / 900) * 4;
          ctx.fillStyle = '#9fb3c6'; ctx.fillRect(x, y, 7, 2); ctx.fillStyle = PALETTE.window; ctx.fillRect(x + 7, y, 3, 2); }
      }
    }

    // ---------- crew ----------
    function bodyFor(worker) {
      let body = bodies.get(worker.id);
      if (!body) { body = { id: worker.id, skin: SKIN[worker.row.provider] || 'blank', px: 0, py: 0, dir: 'south', state: 'idle', aph: (hash(worker.id) % 628) / 100 }; bodies.set(worker.id, body); }
      body.skin = SKIN[worker.row.provider] || 'blank';
      return body;
    }
    function paintCrew(worker, actor, now, reduced) {
      // Helpers stand at their reviewed scale (0.72): body, fallback, shadow and hit box all follow it.
      const foot = P(actor.point), body = bodyFor(worker), size = worker.scale || 1, scale = SPRITE_SCALE * size;
      // Our own contact shadow (the shared one is skipped): a small projected floor ellipse under every body, fallback
      // included, culled only by its own footprint.
      if (onStage({ x: actor.point.x - 0.3, y: actor.point.y - 0.3, w: 0.6, h: 0.6 }, 0, 2)) isoEllipse(ctx, actor.point, 0.28 * size, null, 'rgba(0,0,0,0.38)');
      body.px = foot.x; body.py = foot.y; body.dir = actor.direction;
      body.state = actor.pose === 'walk' ? 'walk' : 'idle'; body.working = actor.pose === 'working'; body.sitting = actor.pose === 'working';
      ctx.save(); ctx.translate(foot.x, foot.y); ctx.scale(scale, scale); ctx.translate(-foot.x, -foot.y);
      let extent = null;
      // The stateful sprite call always runs (pose, facing, frame and skin loading advance); the shared seam rejects
      // painting when the complete scaled sprite bounds miss the stage. Its bounds are in body space around the foot.
      const shouldPaint = bounds => {
        const toScreen = (value, origin, offset) => offset + (origin + (value - origin) * scale) * camera.zoom;
        const left = toScreen(bounds.x, foot.x, camera.tx), right = toScreen(bounds.x + bounds.w, foot.x, camera.tx);
        const top = toScreen(bounds.y, foot.y, camera.ty), bottom = toScreen(bounds.y + bounds.h, foot.y, camera.ty);
        return right >= -1 && left <= viewport.width + 1 && bottom >= -1 && top <= viewport.height + 1;
      };
      try { extent = sprites && sprites.drawBody ? sprites.drawBody(ctx, body, now, { reducedMotion: reduced, skipGroundShadow: true, shouldPaint }) : null; } catch (_) { extent = null; }
      ctx.restore();
      if (!extent) {
        watchSkin(body.skin);
        // Visible upright fallback silhouette while sprites load or are unavailable.
        const h = CREW_HEIGHT * size, w = 16 * size;
        ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = worker.accent; ctx.strokeStyle = '#05080a';
        ctx.beginPath(); ctx.roundRect ? ctx.roundRect(foot.x - w / 2, foot.y - h * 0.72, w, h * 0.72, 6 * size) : ctx.rect(foot.x - w / 2, foot.y - h * 0.72, w, h * 0.72); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(foot.x, foot.y - h * 0.84, 6 * size, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
        extent = { top: foot.y - h, w, h, fallback: true };
      } else if (!extent.fallback) extent = { top: foot.y + (extent.top - foot.y) * scale, w: extent.w * scale, h: extent.h * scale, painted: extent.painted };
      // Hit regions are in CSS pixels; DPR only touches the backing store.
      const left = camera.tx + (foot.x - extent.w / 2) * camera.zoom, top = camera.ty + extent.top * camera.zoom;
      const width = extent.w * camera.zoom, height = extent.h * camera.zoom, padX = Math.max(0, (MIN_HIT - width) / 2), padY = Math.max(0, (MIN_HIT - height) / 2);
      const region = { id: worker.id, left: left - padX, top: top - padY, width: width + padX * 2, height: height + padY * 2, depth: foot.y, head: { x: camera.tx + foot.x * camera.zoom, y: top }, foot: camera.ty + foot.y * camera.zoom };
      anchors.push(region);
      if (extent.painted !== false) regions.push(region);
    }

    /* A frozen scene repaints when a skin set it is waiting on finishes loading. One pending job per skin; a job
       that settles without frames (pre-init or missing set) never schedules work, so no loop is parked on assets. */
    function watchSkin(skin) {
      if (!sprites || typeof sprites.ensureSkin !== 'function') return;
      let job; try { job = sprites.ensureSkin(skin); } catch (_) { return; }
      if (!job || typeof job.then !== 'function' || readiness.get(skin) === job) return;
      readiness.set(skin, job);
      job.then(ok => { if (ok && running && readiness.get(skin) === job) invalidate(); }, () => {});
    }

    // ---------- mail (airborne pass) ----------
    function paintMail(mail, now, animate) {
      for (const { envelope, lift } of stackEnvelopes(mail.envelopes)) {
        const anchor = P(envelope.point), at = { x: anchor.x, y: anchor.y - lift }; ctx.save(); ctx.globalAlpha = envelope.alpha;
        ctx.fillStyle = envelope.color; ctx.fillRect(at.x - 7, at.y - 5, 14, 10); ctx.strokeStyle = '#3a2508'; ctx.strokeRect(at.x - 7, at.y - 5, 14, 10);
        ctx.beginPath(); ctx.moveTo(at.x - 7, at.y - 5); ctx.lineTo(at.x, at.y + 1); ctx.lineTo(at.x + 7, at.y - 5); ctx.stroke();
        if (envelope.count > 1 || envelope.label || envelope.mark) {
          ctx.font = "13px VT323, monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = envelope.mark ? '#ff6b5a' : PALETTE.ink;
          ctx.fillText([envelope.label, envelope.count > 1 ? '×' + envelope.count : '', envelope.mark ? '!' : ''].filter(Boolean).join(' '), at.x + 10, at.y);
        }
        ctx.restore();
      }
      for (const drone of mail.drones) {
        const at = P(drone.point), bob = drone.parked && animate ? Math.sin(now / 500) : 0;
        isoEllipse(ctx, { ...drone.point, z: 0 }, 0.25, null, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = '#2a3138'; ctx.fillRect(at.x - 9, at.y - 4 + bob, 18, 6);
        ctx.fillStyle = '#4a5560'; ctx.fillRect(at.x - 12, at.y - 6 + bob, 6, 2); ctx.fillRect(at.x + 6, at.y - 6 + bob, 6, 2);
        const running = drone.parcels[0] || PALETTE.cyan; ctx.fillStyle = running; ctx.fillRect(at.x - 1, at.y - 3 + bob, 2, 2);
        drone.parcels.forEach((color, index) => { ctx.fillStyle = color; ctx.fillRect(at.x - 4, at.y + 3 + index * 3 + bob, 8, 2); });
      }
    }

    // ---------- plates (screen space) ----------
    function textPlate(text, x, y, { accent = PALETTE.dim, size = 13, color = PALETTE.ink, priority = 0, force = false, dash = null } = {}) {
      ctx.font = size + 'px VT323, monospace';
      const width = Math.ceil(ctx.measureText(text).width) + 12, height = Math.round(size * 1.35);
      return { text, x: Math.round(x - width / 2), y: Math.round(y - height), w: width, h: height, accent, size, color, priority, force, dash };
    }
    function drawPlate(plate) {
      const { x, y } = plate;
      ctx.fillStyle = PALETTE.glass; ctx.fillRect(x, y, plate.w, plate.h);
      ctx.globalAlpha = 0.12; ctx.fillStyle = '#000'; for (let sy = y + 2; sy < y + plate.h - 1; sy += 3) ctx.fillRect(x + 1, sy, plate.w - 2, 1); ctx.globalAlpha = 1;
      ctx.strokeStyle = plate.accent; if (plate.dash) ctx.setLineDash(plate.dash); ctx.strokeRect(x + 0.5, y + 0.5, plate.w - 1, plate.h - 1); ctx.setLineDash([]);
      ctx.fillStyle = plate.accent; ctx.fillRect(x + 1, y, plate.w - 2, 2);
      ctx.font = plate.size + 'px VT323, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = plate.color;
      ctx.fillText(plate.text, x + 6, y + plate.h / 2 + 1);
    }
    function clipText(text, max, size) {
      ctx.font = size + 'px VT323, monospace';
      if (ctx.measureText(text).width <= max) return text;
      let cut = text.length; while (cut > 1 && ctx.measureText(text.slice(0, cut) + '…').width > max) cut--;
      return text.slice(0, cut).trimEnd() + '…';
    }
    const signSize = base => Math.max(12, Math.min(22, base * camera.zoom));
    function paintPlates(isStale, staleKeys) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const tier = lodFor(camera.zoom), plates = [], screen = point => Scene.toScreen(point, camera), selectedRepo = repositorySelection();
      for (const platform of scene.platforms) {
        const at = screen(platform.sign), size = signSize(tier === 'overview' ? 30 : 22), listed = overflowByPlatform.get(platform.key);
        const label = clipText((platform.name || 'Unassigned').toUpperCase() + (platform.annex ? ' +' + platform.annex : '') + ' · ' + (platformCounts.get(platform.key) || 0) + (listed ? ' · +' + listed + ' listed' : ''), viewport.width * 0.4, size);
        plates.push(textPlate(label, at.x, at.y - 6, { accent: platform.accent, size, color: platform.accent, priority: 50 }));
        if (isStale || staleKeys.has(platform.key)) plates.push(textPlate('STALE', at.x, at.y - 6 - size * 1.5, { accent: STATUS.blocked, size: 13, color: STATUS.blocked, priority: 49, dash: [3, 3] }));
        if (tier !== 'overview') for (const section of platform.sections) {
          const point = screen(section.sign), text = clipText(String(section.label || section.repo || ''), 160, 13);
          // A selected repository's sign changes colour only: same text, size and priority, so placement never moves.
          const repo = repositories.has(section.repo) ? section.repo : null, chosen = repo !== null && repo === selectedRepo;
          if (text) plates.push({ ...textPlate(text, point.x, point.y - 2, { accent: chosen ? PALETTE.repo : shade(platform.accent, -0.3), size: 13, color: chosen ? PALETTE.repo : '#c7d4cc', priority: 30 }), repo });
        }
      }
      const hubAt = screen({ x: scene.mail.tower.x + scene.mail.tower.w / 2, y: scene.mail.tower.y + scene.mail.tower.h / 2, z: 3.4 });
      plates.push(textPlate('MAILROOM · llm-bus', hubAt.x, hubAt.y, { accent: PALETTE.amber, size: signSize(18), color: PALETTE.window, priority: 45 }));
      const observatory = scene.observatory;
      if (observatory) {
        const r = observatory.rect, signAt = screen({ x: r.x + r.w / 2, y: r.y, z: 3.6 });
        plates.push(textPlate('OBSERVATORY ✦', signAt.x, signAt.y, { accent: PALETTE.cyan, size: signSize(18), color: PALETTE.cyan, priority: 44 }));
        // Ambient: dim, no status dot, never a hover, focus or inspection target.
        if (tier !== 'overview') { const head = screen({ ...observatory.viewer.point, z: 2 }); plates.push(textPlate(observatory.viewer.label + ' · ambient', head.x, head.y, { accent: '#3a444e', size: 12, color: PALETTE.dim, priority: 6 })); }
      }
      const inspectedId = inspected();
      for (const region of anchors) {
        const worker = workerIndex.get(region.id); if (!worker) continue;
        const status = worker.row.status, head = region.head;
        if (tier === 'overview') { ctx.fillStyle = STATUS[status] || STATUS.unknown; ctx.beginPath(); ctx.arc(head.x, head.y - 5, 2.5, 0, Math.PI * 2); ctx.fill(); }
        // Worker name plates carry their worker as a title target.
        if (region.id === hovered) plates.push({ ...textPlate(clipText(hoverLabel(region.id) || nameFor(region.id), viewport.width - 24, 15), head.x, head.y - 6, { accent: worker.accent, size: 15, priority: 100, force: true }), target: region.id });
        else if (region.id === focused) plates.push({ ...textPlate(clipText(hoverLabel(region.id) || nameFor(region.id), viewport.width - 24, 14), head.x, head.y - 6, { accent: PALETTE.focus, size: 14, priority: 90, force: true }), target: region.id });
        else if (status === 'blocked') plates.push({ ...textPlate(nameFor(region.id) + ' · WAITING', head.x, head.y - 6, { accent: STATUS.blocked, size: 13, color: STATUS.blocked, priority: 70 }), target: region.id });
        else if (tier === 'detail' && worker.row.worktree) plates.push(textPlate(clipText(String(worker.row.worktree), 110, 12), head.x, region.foot + 18, { accent: shade(worker.accent, -0.35), size: 12, color: PALETTE.dim, priority: 10 }));
        if (region.id === inspectedId) plates.push(textPlate('⌕ inspecting', head.x, head.y - 30, { accent: PALETTE.focus, size: 13, color: PALETTE.focus, priority: 95 }));
        const listed = overflowByWorker.get(region.id);
        if (listed && tier !== 'overview') plates.push(textPlate('+' + listed + ' helper' + (listed > 1 ? 's' : '') + ' in list', head.x, region.foot + 34, { accent: shade(worker.accent, -0.35), size: 12, color: PALETTE.dim, priority: 8 }));
      }
      const accepted = placePlates(stagePlates(plates, viewport));
      for (const plate of accepted) drawPlate(plate);
      // Title hits are exactly the accepted, drawn plate boxes: never the body, never a dropped plate.
      titleRegions = accepted.filter(plate => plate.target).map(plate => ({ id: plate.target, left: plate.x, top: plate.y, width: plate.w, height: plate.h }));
      // Repository hits are likewise only accepted, drawn section signs; platform headings and dropped signs have none.
      signRegions = accepted.filter(plate => plate.repo).map(plate => ({ repo: plate.repo, left: plate.x, top: plate.y, width: plate.w, height: plate.h }));
      plateFrame = { scene, zoom: camera.zoom, tx: camera.tx, ty: camera.ty };
      // Hover brackets around the real painted extent.
      const hover = regions.find(region => region.id === hovered);
      if (hover) {
        const worker = workerIndex.get(hovered), r = hover, arm = 6;
        ctx.strokeStyle = worker ? worker.accent : PALETTE.focus; ctx.lineWidth = 2;
        for (const [x, y, dx, dy] of [[r.left, r.top, 1, 1], [r.left + r.width, r.top, -1, 1], [r.left, r.top + r.height, 1, -1], [r.left + r.width, r.top + r.height, -1, -1]]) {
          ctx.beginPath(); ctx.moveTo(x, y + dy * arm); ctx.lineTo(x, y); ctx.lineTo(x + dx * arm, y); ctx.stroke();
        }
        ctx.lineWidth = 1;
      }
    }

    // ---------- frame ----------
    /* Conservative screen test for a floor footprint raised to `height`, padded for glows and rims (design px).
       Projection is affine, so the rectangle's projected corners bound everything drawn on it. */
    let visibleArea = null;
    function onStage(rect, height, pad) {
      const v = visibleArea;
      const left = 24 * (rect.x - rect.y - rect.h) - pad, right = 24 * (rect.x + rect.w - rect.y) + pad;
      const top = 12 * (rect.x + rect.y) - 24 * height - pad, bottom = 12 * (rect.x + rect.w + rect.y + rect.h) + pad;
      return right >= v.left && left <= v.right && bottom >= v.top && top <= v.bottom;
    }
    function paint(now) {
      measure();
      regions = []; anchors = [];
      if (!scene) { paintSpace(now, false); return; }
      const isStale = !!stale(), reduced = !!reducedMotion(), animate = !isStale && !reduced;
      actors = movement.step(now, { stale: workerStale, reduced });
      if (mode === 'focus' && focused) { const point = pointOf(focused); if (point) setCamera(Scene.focus(point, scene.bounds, viewport)); }   // immediate, so a reduced-motion snap keeps the worker in view
      const mail = mailFrame ? mailFrame(now) : { drones: [], envelopes: [] };
      paintSpace(now, animate);
      ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * camera.tx, dpr * camera.ty);
      const layer = staticFor(), b = layer.bounds;
      ctx.drawImage(layer.canvas, b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      // Hub ambience: radar dish and beacon sweep (cosmetic).
      const t = scene.mail.tower, top = { x: t.x + t.w / 2, y: t.y + t.h / 2, z: 3.2 }, at = P(top);
      const sweep = animate ? (now / 20000) * Math.PI * 2 : 0.6;
      ctx.strokeStyle = PALETTE.rail; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(at.x, at.y - 14); ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = '#3a444e'; ctx.beginPath(); ctx.ellipse(at.x, at.y - 16, 14 * Math.abs(Math.cos(sweep)) + 3, 6, 0, 0, Math.PI * 2); ctx.fill();
      glow(ctx, { ...top, z: 3.9 }, 22, PALETTE.amber, animate ? 0.35 + 0.3 * Math.max(0, Math.sin(now / 4000 * Math.PI * 2)) : 0.35);
      // Depth-sorted solid furniture, apron posts and crew. Wholly offscreen furniture is never submitted; every crew
      // body is submitted so its sprite state advances, and the shared sprite seam skips its pixels when off stage.
      const items = [], zoom = camera.zoom;
      visibleArea = { left: -camera.tx / zoom, top: -camera.ty / zoom, right: (viewport.width - camera.tx) / zoom, bottom: (viewport.height - camera.ty) / zoom };
      const byId = new Map(actors.map(actor => [actor.id, actor])), staleKeys = new Set();
      for (const worker of scene.workers) {
        // Each worker animates on its own row's freshness; a stale row freezes its desk, sprite breathing and blinks.
        const own = workerStale(worker), live = animate && !own;
        if (own) staleKeys.add(worker.platformKey);
        const paintStation = worker.kind === 'helper' ? paintHelperDesk : paintDesk;
        if (onStage(worker.desk, 1.1, 16)) items.push({ depth: middle(worker.desk), draw: () => paintStation(ctx, worker, now, live) });
        const c = worker.chair;
        if (onStage({ x: c.x - 0.3, y: c.y - 0.45, w: 0.6, h: 0.6 }, 0.9, 4)) items.push({ depth: c.x + c.y - 0.6, draw: () => paintChair(ctx, worker) });
        const actor = byId.get(worker.id);
        if (actor) items.push({ depth: actor.point.x + actor.point.y, tie: worker.id, draw: () => paintCrew(worker, actor, now, !live) });
      }
      const observatory = scene.observatory;
      if (observatory) {
        const { desk, chair, viewer } = observatory;
        if (onStage(desk, 1.1, 16)) items.push({ depth: middle(desk), draw: () => {
          box(ctx, desk, 0.55, { top: '#22303a', left: '#101a20', right: '#17232a', edge: 'rgba(63,216,232,0.12)' });
          line(ctx, { x: desk.x + 0.3, y: desk.y + desk.h, z: 0.6 }, { x: desk.x + desk.w - 0.3, y: desk.y + desk.h, z: 0.6 }, PALETTE.cyan, 1.5, 0.5);
        } });
        if (onStage({ x: chair.x - 0.3, y: chair.y - 0.45, w: 0.6, h: 0.6 }, 0.9, 4)) items.push({ depth: chair.x + chair.y - 0.6, draw: () => paintChair(ctx, { chair }) });
        if (onStage({ x: viewer.point.x - 0.5, y: viewer.point.y - 0.5, w: 1, h: 1 }, 2, 12)) items.push({ depth: viewer.point.x + viewer.point.y, tie: viewer.id, draw: () => paintViewer(ctx, viewer) });
        for (const screen of observatory.screens) if (onStage(screen.rect, screen.height, 8)) items.push({ depth: middle(screen.rect), draw: () => paintObservatoryScreen(ctx, screen, now, animate) });
        for (const telescope of observatory.telescopes) if (onStage(telescope.rect, telescope.height, 8)) items.push({ depth: middle(telescope.rect), draw: () => paintTelescope(ctx, telescope, now, animate) });
        if (onStage(observatory.plant.rect, observatory.plant.height, 8)) items.push({ depth: middle(observatory.plant.rect), draw: () => paintPlant(ctx, observatory.plant) });
        if (onStage(observatory.light.rect, observatory.light.height, 8)) items.push({ depth: middle(observatory.light.rect), draw: () => paintLamp(ctx, observatory.light) });
      }
      for (const platform of scene.platforms) for (const section of platform.sections) for (const wall of section.partitions || [])
        for (let x = wall.x; x < wall.x + wall.w - 1e-6; x++) {
          const unit = { x, y: wall.y, w: Math.min(1, wall.x + wall.w - x), h: wall.h };
          if (onStage(unit, 0.6, 4)) items.push({ depth: unit.x + unit.w / 2 + unit.y + unit.h / 2, draw: () => paintPartition(ctx, unit, platform.accent) });
        }
      for (const platform of scene.platforms) for (const region of platform.decorationRegions) if (region.kind === 'apron' && onStage(region.rect, 1.8, 44))
        items.push({ depth: region.rect.x + region.rect.y + 1, draw: () => paintApronProp(ctx, region) });
      items.sort((a, b) => a.depth - b.depth || String(a.tie || '').localeCompare(String(b.tie || '')));
      for (const item of items) item.draw();
      /* The selected repository's crew, roots and helpers alike, each get a ring; a worker whose own fresh status is
         working gets a thicker double ring and a glow. Read from the controller per paint; nothing accumulates. */
      const selectedRepo = repositorySelection();
      if (selectedRepo != null) for (const worker of scene.workers) {
        const point = worker.row.repoId === selectedRepo && pointOf(worker.id); if (!point) continue;
        const working = worker.row.status === 'working' && !workerStale(worker), radius = 0.62 * worker.scale;
        if (working) glow(ctx, point, 40 * worker.scale, PALETTE.repo, 0.4);
        isoEllipse(ctx, point, radius, PALETTE.repo, null, working ? 3 : 1.5);
        if (working) isoEllipse(ctx, point, radius + 0.16, PALETTE.repo, null, 1);
      }
      // Focus and hover floor rings sit over the floor but under the plates.
      for (const [id, color] of [[focused, PALETTE.focus], [hovered, null]]) {
        const point = id && pointOf(id); if (!point) continue;
        const worker = workerIndex.get(id);
        ctx.save(); ctx.globalAlpha = color && animate ? 0.6 + 0.35 * Math.sin(now / 450) : 0.85;
        isoEllipse(ctx, point, 0.55, color || (worker ? worker.accent : PALETTE.focus), null, 2); ctx.restore();
      }
      // A zoomed platform keeps a thin outline in its accent, so platform focus reads as a mode.
      const zoomed = mode === 'platform' && scene.platforms.find(value => value.key === platform);
      if (zoomed) { ctx.save(); ctx.lineWidth = 2 / zoom; poly(ctx, rectPoly(zoomed.rect, 0.02), null, zoomed.accent); ctx.restore(); }
      paintMail(mail, now, animate);
      if (isStale) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.save(); ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = 'rgba(128,128,128,0.45)'; ctx.fillRect(0, 0, viewport.width, viewport.height); ctx.restore(); }
      // Hovering a worker's own name plate keeps it hovered, so the plate stays put to be clicked.
      if (pointer) { hovered = Scene.hitTest(pointer, regions) || titleAt(pointer); canvas.style.cursor = drag && drag.moved ? 'grabbing' : hovered || signAt(pointer) ? 'pointer' : 'grab'; }
      paintPlates(isStale, staleKeys);
      return animate;
    }
    // Live scenes keep animating; a frozen scene stops after this paint until something invalidates it.
    function loop(now) {
      frame = null;
      if (!running) return;
      dirty = false;
      const animating = paint(now);
      if ((animating || dirty) && running && frame === null) frame = raf(loop);
    }

    // ---------- input ----------
    const local = event => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    function pointerDown(event) {
      const point = local(event); pointers.set(event.pointerId, point);
      if (canvas.setPointerCapture) try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) }; drag = null; lastMovedAt = clock(); }
      else drag = { start: point, last: point, moved: false, at: clock(), touch: event.pointerType === 'touch' };
    }
    function pointerMove(event) {
      const point = local(event);
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, point);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.distance > 0) zoomBy(distance / pinch.distance, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        lastMovedAt = clock();
        pinch.distance = distance; return;
      }
      if (drag) {
        const threshold = drag.touch ? 6 : 4;
        if (!drag.moved && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) > threshold) drag.moved = true;
        if (drag.moved) { panBy({ x: point.x - drag.last.x, y: point.y - drag.last.y }); drag.last = point; lastMovedAt = clock(); }
      }
      pointer = event.pointerType === 'touch' ? null : point;
      invalidate();
    }
    function pointerUp(event) {
      const point = local(event); pointers.delete(event.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
      if (drag && !drag.moved && (!drag.touch || clock() - drag.at < 300)) {
        /* A quick repeat at the same point is the same gesture: it keeps the first click's target. A title plate
           toggles once per gesture, so its double-click never opens then closes; a body click focuses at once. */
        const repeat = sameTap(point) && clock() - tap.at <= TAP_MS;
        const title = repeat ? tap.title : titleAt(point), target = title ? null : repeat ? tap.id : Scene.hitTest(point, regions);
        // A repository sign is the lowest-precedence target: a worker title or body under the point always wins.
        const sign = title || target ? null : repeat ? tap.sign : signAt(point);
        if (title && !repeat && workerIndex.has(title)) onTitleToggle(title);
        if (sign && !repeat) onRepositoryToggle(sign);
        tap = { id: target, title, sign, point, at: clock() };
        if (target && workerIndex.has(target)) onSelect(target);
      } else tap = null;   // a drag, pinch or slow touch ends any remembered gesture
      drag = null;
    }
    // A cancelled gesture only clears state: an interrupted tap must never select.
    function pointerCancel(event) { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; drag = null; tap = null; }
    function pointerLeave() { pointer = null; hovered = null; invalidate(); }
    /* Double-click zooms: an exact worker hit selects and focuses that worker; otherwise the platform under the
       pointer is fitted. A drag, pan or pinch in the gesture never zooms, and a platform never selects a worker. */
    function doubleClick(event) {
      if (!scene || clock() - lastMovedAt < 500) return;
      event.preventDefault();
      const point = local(event), known = sameTap(point) ? tap : null;
      tap = null;
      if (known && (known.title || known.sign)) return;   // a title or sign double-click already toggled once; it never zooms
      // The clicks' own target decides; only a double-click with no recorded click hit-tests the current view.
      const id = known ? (known.id && workerIndex.has(known.id) ? known.id : null) : Scene.hitTest(point, regions);
      if (id) { onSelect(id); return; }
      if (known && known.id) return;   // its worker left: never substitute the floor now under the old point
      const key = Scene.hitPlatform(point, scene, camera);
      if (key && focusPlatform(key)) onPlatform(key);
    }
    function wheel(event) { event.preventDefault(); zoomBy(Math.exp(-event.deltaY * 0.0015), local(event)); }
    // Keyboard camera controls only while the canvas itself has focus; text inputs are never intercepted.
    function keyDown(event) {
      const step = 48, keys = { ArrowLeft: () => panBy({ x: step, y: 0 }), ArrowRight: () => panBy({ x: -step, y: 0 }), ArrowUp: () => panBy({ x: 0, y: step }),
        ArrowDown: () => panBy({ x: 0, y: -step }), '+': () => zoomBy(ZOOM_STEP), '=': () => zoomBy(ZOOM_STEP), '-': () => zoomBy(1 / ZOOM_STEP), '0': overview };
      if (!keys[event.key] || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault(); keys[event.key]();
    }
    const listeners = [['pointerdown', pointerDown], ['pointermove', pointerMove], ['pointerup', pointerUp], ['pointercancel', pointerCancel], ['pointerleave', pointerLeave], ['wheel', wheel, { passive: false }], ['keydown', keyDown], ['dblclick', doubleClick]];
    function start() {
      if (running) return;
      running = true;
      for (const [name, fn, options] of listeners) canvas.addEventListener(name, fn, options);
      const Observer = env.ResizeObserver || win.ResizeObserver;
      if (Observer && !observer) { observer = new Observer(() => { if (measure()) invalidate(); }); observer.observe(canvas); }
      watch(); invalidate();
    }
    // Visual inputs a frozen scene cannot see itself: reduced-motion preference, DPR (re-armed per ratio) and fonts.
    function listen(target, name, fn) { if (target && target.addEventListener) { target.addEventListener(name, fn); watchers.push(() => target.removeEventListener(name, fn)); } }
    function watch() {
      const media = query => (typeof win.matchMedia === 'function' ? win.matchMedia(query) : null);
      listen(media('(prefers-reduced-motion: reduce)'), 'change', invalidate);
      const ratio = () => {
        const query = media('(resolution: ' + dprOf() + 'dppx)'), changed = () => { if (!running) return; query.removeEventListener('change', changed); measure(); invalidate(); ratio(); };
        listen(query, 'change', changed);
      };
      ratio();
      const fonts = win.document && win.document.fonts;
      listen(fonts, 'loadingdone', invalidate);
      if (fonts && fonts.ready && typeof fonts.ready.then === 'function') fonts.ready.then(() => { if (running) invalidate(); }, () => {});
    }
    function stop() {
      if (!running) return;
      running = false; if (frame !== null) caf(frame); frame = null; dirty = false;
      for (const [name, fn, options] of listeners) canvas.removeEventListener(name, fn, options);
      if (observer) { observer.disconnect(); observer = null; }
      while (watchers.length) watchers.pop()();
      readiness.clear();
      pointers.clear(); drag = null; pinch = null; pointer = null; hovered = null; tap = null; titleRegions = []; signRegions = []; plateFrame = null;
    }
    return { update, focus, focusPlatform, overview, zoomBy, start, stop, paint, limits, invalidate,
      camera: () => ({ ...camera }), mode: () => mode, platform: () => platform, hitRegions: () => regions.map(region => ({ ...region })), hovered: () => hovered,
      cacheBuilds: () => (staticLayer ? staticLayer.builds : 0), running: () => running, titleRegions: () => titleRegions.map(region => ({ ...region })),
      signRegions: () => signRegions.map(region => ({ ...region })) };
  }
  return { create, lodFor, cacheResolution, statusSignature, placePlates, stagePlates, stackEnvelopes, visibleFaces, furnishing, furnishings, wallUnits, paintDesk, paintHelperDesk, WALL_KINDS, CORNER_KINDS, PALETTE, STATUS, LOD, SPRITE_SCALE, CREW_HEIGHT };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ObserverView;
