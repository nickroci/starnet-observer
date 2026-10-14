'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const childProcess = require('./child-env.js').guardChildProcess(require('node:child_process'));
const { makeDesktopObserver } = require('./observer-desktop.js');
const { makeProjectResolver } = require('./observer-projects.js');
const { makeTranscriptObserver } = require('./observer-transcripts.js');
const { makeHelperObserver } = require('./observer-helpers.js');
const { makeBusReader, publicBus } = require('./observer-bus.js');
const { unavailable, redactText } = require('./observer-inspector.js');
const { makeIdentityResolver } = require('./observer-identity.js');

const STATUSES = new Set(['working', 'blocked', 'idle', 'done', 'unknown']);
const text = (value, length) => String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, length);

const COUNTERS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const emptyCoverage = () => ({ eligible: 0, available: 0, partial: 0, unavailable: 0, stale: 0 });
function aggregateRows(rows, now) {
  const groups = new Map();
  for (const row of rows) {
    // Claude's opaque helper identity already encodes its verified canonical root
    // and agentId. Immediate parent rows do not define that transcript namespace.
    const helper = row.provider === 'claude' && row.source === 'helper' && row.presence === 'verified-lineage' &&
      /^helper:obs_[a-f0-9]{24}$/.test(row.inspectionIdentity || '');
    const verified = helper || row.source !== 'desktop' && ['codex', 'claude'].includes(row.provider) &&
      UUID.test(row.sessionId || '') && !!row.inspectionIdentity;
    const key = helper ? row.provider + ':' + row.inspectionIdentity : verified ?
      row.provider + ':' + row.sessionId.toLowerCase() : 'presence:' + row.id;
    if (!groups.has(key)) groups.set(key, { verified, rows: [] });
    groups.get(key).rows.push(row);
  }
  const agents = { observed: 0, verifiedSessions: 0, presenceOnly: 0,
    statuses: Object.fromEntries([...STATUSES].map(status => [status, 0])), stale: 0 };
  const coverage = { ...emptyCoverage(), conflicting: 0,
    counters: Object.fromEntries(COUNTERS.map(key => [key, emptyCoverage()])) };
  const totals = Object.fromEntries(COUNTERS.map(key => [key, null]));
  const overflow = new Set();
  const fresh = row => row.inventoryHealth === 'available' && Number.isFinite(row.observedAt) && now - row.observedAt <= 6000;
  const rank = row => [fresh(row) ? 1 : 0, row.observedAt ?? -1, row.source === 'herdr' ? 1 : 0];
  const compare = (a, b) => { const ar = rank(a), br = rank(b);
    return br[0] - ar[0] || br[1] - ar[1] || br[2] - ar[2] || String(a.id).localeCompare(String(b.id)); };
  const signature = row => JSON.stringify([STATUSES.has(row.status) ? row.status : 'unknown',
    COUNTERS.map(key => row.usage?.[key] || null)]);
  for (const group of groups.values()) {
    const candidates = group.rows.sort(compare), row = candidates[0];
    const stale = !fresh(row);
    const peers = candidates.filter(value => JSON.stringify(rank(value)) === JSON.stringify(rank(row)));
    if (group.verified && !stale && peers.some(value => signature(value) !== signature(row))) {
      coverage.conflicting++; continue;
    }
    agents.observed++;
    if (stale) agents.stale++;
    else agents.statuses[STATUSES.has(row.status) ? row.status : 'unknown']++;
    if (!group.verified) { agents.presenceOnly++; continue; }
    agents.verifiedSessions++; coverage.eligible++;
    let usable = 0, complete = 0;
    for (const key of COUNTERS) {
      const counter = coverage.counters[key]; counter.eligible++;
      if (stale) { counter.stale++; continue; }
      const item = row.usage?.[key];
      if (!item || !Number.isSafeInteger(item.value) || item.value < 0 || !['available', 'partial'].includes(item.state)) {
        counter.unavailable++; continue;
      }
      counter[item.state]++; usable++;
      if (item.state === 'available') complete++;
      const sum = (totals[key] ?? 0) + item.value;
      if (!Number.isSafeInteger(sum)) overflow.add(key);
      totals[key] = overflow.has(key) ? null : sum;
    }
    if (stale) coverage.stale++;
    else coverage[complete === COUNTERS.length ? 'available' : usable ? 'partial' : 'unavailable']++;
  }
  const usage = Object.fromEntries(COUNTERS.map(key => {
    const counter = coverage.counters[key], value = totals[key];
    return [key, { value, state: value === null ? 'unavailable' :
      counter.partial || counter.unavailable || counter.stale || coverage.conflicting ? 'partial' : 'available' }];
  }));
  return { agents, usage, coverage };
}

function makeObserver(options = {}) {
  const now = options.now;
  if (typeof now !== 'function') throw new TypeError('Observer requires an injected now clock');
  const execute = options.execute || ((command, args, settings) => new Promise((resolve, reject) => {
    childProcess.execFile(command, args, settings, (error, stdout) => error ? reject(error) : resolve({ stdout }));
  }));
  const projects = options.projects || makeProjectResolver({ execute, now });
  const transcripts = options.transcripts || makeTranscriptObserver({ now });
  const helpers = options.helpers || makeHelperObserver({ transcripts, now });
  const bus = options.bus || makeBusReader({ now });
  const desktop = options.desktop || makeDesktopObserver({ execute, now });
  const endpoint = options.endpoint || process.env.HERDR_SOCKET_PATH || path.join(os.homedir(), '.config/herdr/herdr.sock');
  const identities = options.identities || makeIdentityResolver({ execute, now, endpoint, readConfiguration: options.readIdentityConfiguration, readProcessBirth: options.readProcessBirth });
  let identityProofs = new Map();
  let lastGood = [], aggregate = aggregateRows([]), refreshStartedAt = null, pending = null, mail = null;
  const sources = { herdr: { health: 'unavailable', observedAt: null, reason: 'not-observed' },
    desktop: { health: 'unavailable', observedAt: null, reason: 'not-observed' } };
  const rowsBySource = { herdr: [], desktop: [], helper: [] };
  function retainUnavailable(source, reason) {
    sources[source] = { ...sources[source], health: 'unavailable', reason };
    rowsBySource[source] = rowsBySource[source].map(row => ({ ...row, inventoryHealth: 'unavailable' }));
  }

  async function refreshHerdr() {
    try {
      const result = await execute('herdr', ['agent', 'list'], { timeout: 3000, maxBuffer: 2 * 1024 * 1024 });
      const inventory = JSON.parse(result.stdout);
      if (!inventory || !inventory.result || !Array.isArray(inventory.result.agents)) throw new Error('Invalid inventory');
      const inventoryAt = now();
      const rows = [], seen = new Set(), proofs = new Map();
      const identityRefresh = { endpointTimedOut: false };
      const panes = [];
      for (const pane of inventory.result.agents) {
        if (!pane || !['codex', 'claude'].includes(pane.agent)) continue;
        if (typeof pane.pane_id !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(pane.pane_id) || seen.has(pane.pane_id)) throw new Error('Invalid pane identity');
        seen.add(pane.pane_id);
        panes.push(pane);
      }
      let resolved;
      if (identities.resolveMany) resolved = await identities.resolveMany(panes, identityRefresh);
      else {
        resolved = [];
        for (const pane of panes) resolved.push(await identities.resolve(pane, identityRefresh));
      }
      for (const [index, pane] of panes.entries()) {
        const id = 'obs_' + crypto.createHash('sha256').update(endpoint + '\0' + pane.pane_id).digest('hex').slice(0, 24);
        const identity = resolved[index];
        const sessionId = identity.sessionId;
        if (identity.proof) proofs.set(id, identity.proof);
        const tool = await transcripts.read(id, pane.agent, sessionId);
        rows.push({ id, paneId: pane.pane_id, provider: pane.agent,
          title: text(redactText(String(pane.terminal_title_stripped || pane.agent)), 160),
          ...await projects.resolve(pane.foreground_cwd || pane.cwd),
          status: STATUSES.has(pane.agent_status) ? pane.agent_status : 'unknown', sessionId,
          identitySource: identity.source, identityHealth: sessionId ? 'available' : 'unavailable',
          tool, usage: tool.usage || null, source: 'herdr', observedAt: inventoryAt, inventoryHealth: 'available',
          inspectionIdentity: sessionId ? pane.agent + ':' + sessionId : null, presence: 'pane' });
      }
      identityProofs = proofs; identities.retain?.(seen);
      rowsBySource.herdr = rows; sources.herdr = { health: 'available', observedAt: inventoryAt, reason: null };
    } catch (_) {
      // Process stderr, raw inventory and transcript contents are never sent to the browser.
      retainUnavailable('herdr', 'Local session inventory unavailable. Check that Herdr is running and on PATH.');
    }
  }
  async function refreshDesktop() {
    try {
      const data = await desktop.inventory();
      if (!data || data.health !== 'available' || !Array.isArray(data.windows)) {
        retainUnavailable('desktop', data?.reason || 'native-reader-unavailable'); return;
      }
      const observedAt = data.observedAt ?? now();
      rowsBySource.desktop = data.windows.map(row => ({ ...row, source: 'desktop', observedAt, inventoryHealth: 'available' }));
      sources.desktop = { health: 'available', observedAt, reason: data.reason || null };
    } catch (_) { retainUnavailable('desktop', 'native-reader-unavailable'); }
  }
  async function refresh() {
    await Promise.all([refreshHerdr(), refreshDesktop()]);
    let lineage;
    try { lineage = await helpers.children(rowsBySource.herdr); }
    catch (_) { lineage = { rows: [], annotations: new Map(), overflow: new Map() }; }
    rowsBySource.herdr = rowsBySource.herdr.map(row => {
      const { parentId, lineageState, taskEvidence, lifecycleEvidence, taskStatusEvidence, task, helperSlot, helperOverflow, ...base } = row;
      return { ...base, ...lineage.annotations.get(row.id), helperOverflow: lineage.overflow.get(row.id) || 0 };
    });
    rowsBySource.helper = lineage.rows.map(row => ({ ...row, helperOverflow: lineage.overflow.get(row.id) || 0 }));
    lastGood = [...rowsBySource.herdr, ...rowsBySource.desktop, ...rowsBySource.helper];
    aggregate = aggregateRows(lastGood, now());
    transcripts.retain(new Set(lastGood.filter(row => row.source !== 'desktop').map(row => row.id)));
    // Bus health is independent of Herdr: its own read, observedAt and stale retention.
    try { mail = bus.read(); } catch (_) { mail = { rows: mail ? mail.rows : [], observedAt: mail ? mail.observedAt : null, health: 'unavailable', reason: 'unreadable' }; }
    return snapshot();
  }
  function snapshot() {
    const available = Object.values(sources).some(source => source.health === 'available');
    const times = Object.values(sources).map(source => source.observedAt).filter(value => value !== null);
    return { sessions: lastGood, aggregate, observedAt: times.length ? Math.max(...times) : null,
      health: available ? 'available' : 'unavailable', error: available ? null : sources.herdr.reason,
      sources: { herdr: { ...sources.herdr }, desktop: { ...sources.desktop } },
      bus: mail ? publicBus(mail, lastGood) : null };
  }
  function get() {
    if (pending) return pending;
    if (refreshStartedAt !== null && now() - refreshStartedAt < 2000) return Promise.resolve(snapshot());
    refreshStartedAt = now();
    pending = refresh().finally(() => { pending = null; });
    return pending;
  }
  async function inspect(id, expectedIdentity) {
    // Bound caller input independently of HTTP; omission preserves legacy inspection callers.
    if (expectedIdentity !== undefined && (typeof expectedIdentity !== 'string' || expectedIdentity.length > 128 ||
      !/^(?:(?:codex|claude):[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|(?:helper:)?obs_[a-f0-9]{24})(?:\|obs_[a-f0-9]{24})?$/i.test(expectedIdentity)))
      return unavailable(id, 'invalid-identity', now());
    const inventory = await get();
    const row = inventory.sessions.find(row => row.id === id);
    const reason = !row ? 'unknown-session' : row.inventoryHealth !== 'available' ? 'inventory-unavailable' :
      !row.inspectionIdentity ? 'identity-unavailable' : null;
    if (reason) return unavailable(id, reason, now());
    const inspectionIdentity = row.inspectionIdentity + (row.source === 'helper' || Object.hasOwn(row, 'parentId') ? '|' + row.parentId : '');
    if (expectedIdentity !== undefined && expectedIdentity !== inspectionIdentity)
      return unavailable(id, 'identity-mismatch', now());
    // A helper's content is owned by its full live ancestry, including a footer-bound
    // root. Keep these private proofs outside public inventory and projection rows.
    const targets = [row], visited = new Set([row.id]);
    let ancestor = row;
    while (Object.hasOwn(ancestor, 'parentId')) {
      ancestor = inventory.sessions.find(value => value.id === ancestor.parentId);
      if (!ancestor || visited.has(ancestor.id) || visited.size > 64 || ancestor.inventoryHealth !== 'available' || !ancestor.inspectionIdentity)
        return unavailable(id, 'identity-unavailable', now());
      visited.add(ancestor.id); targets.push(ancestor);
    }
    if (targets.some(target => target.identitySource === 'footer' && !identityProofs.has(target.id)))
      return unavailable(id, 'identity-unavailable', now());
    const capturedProofs = new Map(targets.map(target => [target.id, identityProofs.get(target.id)]));
    const proofs = [...capturedProofs.values()].filter(Boolean);
    if (new Set(proofs.map(proof => proof.paneId)).size > 1) return unavailable(id, 'identity-unavailable', now());
    const validateFooter = async () => {
      if (!proofs.length) return true;
      if (identities.revalidateAll) return identities.revalidateAll(proofs);
      // Existing injected single-proof adapters remain supported; serial checks
      // cannot establish coherent ownership for a multi-pane ancestry.
      return proofs.length === 1 && await identities.revalidate(proofs[0]);
    };
    if (!await validateFooter()) return unavailable(id, 'identity-unavailable', now());
    const data = row.source === 'desktop' ? await desktop.inspect(row.inspectionIdentity) :
      row.source === 'helper' || Object.hasOwn(row, 'parentId') ? await helpers.inspect(row) :
      await transcripts.inspect(row.id, row.provider, row.sessionId);
    // A concurrent roster refresh can change/remove the source identity while the read is in flight.
    const current = rowsBySource[row.source].find(value => value.id === id);
    if (!current || current.inventoryHealth !== 'available' || current.provider !== row.provider || current.inspectionIdentity !== row.inspectionIdentity || current.parentId !== row.parentId || Object.hasOwn(current, 'parentId') !== Object.hasOwn(row, 'parentId'))
      return unavailable(id, current?.inventoryHealth === 'unavailable' ? 'inventory-unavailable' :
        expectedIdentity !== undefined ? 'identity-mismatch' : 'identity-unavailable', now());
    if (!await validateFooter()) return unavailable(id, 'identity-unavailable', now());
    // Revalidation itself is asynchronous: check ownership again after its last await.
    for (const target of targets) {
      const live = rowsBySource[target.source].find(value => value.id === target.id);
      const proof = capturedProofs.get(target.id), liveProof = identityProofs.get(target.id);
      if (!live || live.inventoryHealth !== 'available' || live.provider !== target.provider || live.inspectionIdentity !== target.inspectionIdentity ||
        live.parentId !== target.parentId || Object.hasOwn(live, 'parentId') !== Object.hasOwn(target, 'parentId') || live.identitySource !== target.identitySource ||
        proof && (!liveProof || liveProof.terminalId !== proof.terminalId || liveProof.sessionId !== proof.sessionId ||
          liveProof.birth?.pid !== proof.birth?.pid || liveProof.birth?.startSeconds !== proof.birth?.startSeconds ||
          liveProof.birth?.startMicroseconds !== proof.birth?.startMicroseconds))
        return unavailable(id, 'identity-unavailable', now());
    }
    if (row.source === 'desktop') return data.health === 'available' ? { ...data, id, inspectionIdentity } : unavailable(id, data.reason || 'identity-unavailable', now());
    if (!data.available || data.health === 'unavailable') return unavailable(id, 'transcript-unavailable', now());
    const { available, ...projection } = data;
    return { ...projection, id, inspectionIdentity, asOf: new Date(now()).toISOString(),
      provenance: { kind: 'transcript', coverage: 'bounded-transcript', identity: 'session' } };
  }
  return { get, inspect, inspectMessage: (id, expectedIdentity) => bus.inspect(id, expectedIdentity) };
}
module.exports = { makeObserver };
