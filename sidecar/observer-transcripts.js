'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const inspector = require('./observer-inspector.js');
const { note: failNote } = require('./failopen.js');

const READ_BYTES = 256 * 1024;
const cleanName = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120) : '';

// Only tool identity/outcome and numeric usage cross this boundary. Conversation bodies stay on disk.
function consumeRecord(state, record, provider, position) {
  const payload = provider === 'codex' ? record.payload : record.message;
  if (!payload || typeof payload !== 'object') return;
  const blocks = provider === 'claude' && Array.isArray(payload.content) ? payload.content : [payload];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    const call = provider === 'codex' && record.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(block.type);
    const use = provider === 'claude' && record.type === 'assistant' && block.type === 'tool_use';
    if (call || use) {
      const callId = cleanName(call ? block.call_id : block.id), name = cleanName(typeof block.name === 'string' ? inspector.redactText(block.name) : '');
      if (!callId || !name) continue;
      if (state.calls.has(callId)) continue;
      state.calls.add(callId);
      if (state.calls.size > 512) state.calls.delete(state.calls.values().next().value);
      state.tool = { callId, name, phase: 'started', outcome: 'unknown', at: typeof record.timestamp === 'string' && Number.isFinite(Date.parse(record.timestamp)) ? new Date(record.timestamp).toISOString() : null, position };
    }
    const output = provider === 'codex' && record.type === 'response_item' && ['function_call_output', 'custom_tool_call_output'].includes(block.type);
    const result = provider === 'claude' && record.type === 'user' && block.type === 'tool_result';
    if ((output || result) && state.tool && state.tool.callId === cleanName(output ? block.call_id : block.tool_use_id)) {
      state.tool.phase = 'finished';
      state.tool.outcome = result && typeof block.is_error === 'boolean' ? block.is_error ? 'error' : 'ok' : 'unknown';
    }
  }
}

function makeTranscriptObserver(options = {}) {
  const io = options.fs || fs, now = options.now;
  if (typeof now !== 'function') throw new TypeError('Transcript observer requires an injected now clock');
  const roots = options.roots || { codex: path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions'),
    claude: path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects') };
  const states = new Map(), detailStates = new Map(), indices = new Map(), pending = new Map();

  async function locate(provider, sessionId, fresh = false) {
    let index = indices.get(provider);
    if (fresh || !index || now() - index.at > 60000) {
      const files = new Map(); let visited = 0;
      async function walk(directory, depth) {
        if (depth > 4) return;
        const entries = await io.readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (++visited > 50000) throw new Error('Transcript index too large');
          const full = path.join(directory, entry.name);
          if (entry.isDirectory()) await walk(full, depth + 1);
          else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            const match = entry.name.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.jsonl$/i);
            if (match) files.set(match[1], files.has(match[1]) ? null : full);
          }
        }
      }
      await walk(roots[provider], 0);
      index = { at: now(), files }; indices.set(provider, index);
    }
    return index.files.get(sessionId) || null;
  }

  const childBindings = new WeakSet();
  async function containedChild(provider, candidate) {
    const root = await io.realpath(roots[provider]);
    const relative = path.relative(path.resolve(roots[provider]), path.resolve(candidate));
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Child outside root');
    let full = root;
    for (const part of relative.split(path.sep)) {
      full = path.join(full, part);
      if ((await io.lstat(full)).isSymbolicLink()) throw new Error('Child symlink');
    }
    const actual = await io.realpath(full);
    if (!actual.startsWith(root + path.sep) || actual !== full) throw new Error('Child outside root');
    return actual;
  }
  const sameResource = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;
  const sameFile = (a, b) => sameResource(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
  async function capturePath(provider, candidate, child) {
    const root = await io.realpath(roots[provider]);
    const full = child ? await containedChild(provider, candidate) : await io.realpath(candidate);
    const relative = path.relative(root, full);
    if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Transcript outside root');
    const components = [];
    let current = root;
    for (const part of [null, ...relative.split(path.sep)]) {
      if (part !== null) current = path.join(current, part);
      const stat = await io.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Transcript symlink');
      components.push({ file: current, stat });
    }
    return { provider, candidate, root, full, components, stat: components.at(-1).stat };
  }
  async function verifyPath(resource, stat) {
    // O_NOFOLLOW guards only the last component. Bind the descriptor to the entire
    // contained path before reading and again before exporting a projection.
    if (!stat.isFile() || !sameFile(resource.stat, stat) ||
      await io.realpath(roots[resource.provider]) !== resource.root || await io.realpath(resource.candidate) !== resource.full)
      throw new Error('Transcript path changed');
    for (const component of resource.components) {
      const current = await io.lstat(component.file);
      if (current.isSymbolicLink() || !sameResource(component.stat, current)) throw new Error('Transcript path changed');
      if (component.file === resource.full && !sameFile(resource.stat, current)) throw new Error('Transcript changed during read');
    }
  }
  function childMetadata(data, provider, sessionId, parentSessionId) {
    let verified = false, nickname = null;
    for (const line of data.subarray(0, Math.max(0, data.lastIndexOf(10))).toString('utf8').split('\n')) {
      let record;
      try { record = JSON.parse(line); } catch (_) { continue; }
      if (provider === 'codex' && record.type === 'session_meta') {
        if (verified || !inspector.recordBelongsToSession(record, provider, sessionId, { provider, sessionId, parentSessionId })) return null;
        verified = true;
        nickname = typeof record.payload.agent_nickname === 'string' ? cleanName(inspector.redactText(record.payload.agent_nickname)) : null;
      }
      if (provider === 'claude' && ['user', 'assistant'].includes(record.type) && record.isMeta !== true) {
        if (!inspector.recordBelongsToSession(record, provider, sessionId, { provider, sessionId, parentSessionId })) return null;
        verified = true;
      }
    }
    return verified ? { nickname } : null;
  }
  function recordIdentityConflicts(record, provider, sessionId, binding) {
    const identityRecord = provider === 'codex' && record.type === 'session_meta' ||
      provider === 'claude' && record.isMeta !== true && ['user', 'assistant'].includes(record.type);
    return identityRecord && !inspector.recordBelongsToSession(record, provider, sessionId, binding);
  }
  async function bindChild(provider, sessionId, parentSessionId, candidate, spawn) {
    if (!roots[provider] || !sessionId || !parentSessionId || sessionId === parentSessionId) return null;
    let handle;
    try {
      candidate = candidate || await locate(provider, sessionId);
      if (!candidate) return null;
      const resource = await capturePath(provider, candidate, true);
      const full = resource.full;
      if (provider === 'claude' && (path.basename(full) !== 'agent-' + sessionId + '.jsonl' ||
        path.basename(path.dirname(full)) !== 'subagents' || path.basename(path.dirname(path.dirname(full))) !== parentSessionId)) return null;
      handle = await io.open(full, require('node:fs').constants.O_RDONLY | require('node:fs').constants.O_NOFOLLOW);
      const stat = await handle.stat();
      await verifyPath(resource, stat);
      const buffer = Buffer.alloc(Math.min(stat.size, READ_BYTES));
      const read = await handle.read(buffer, 0, buffer.length, 0);
      const data = buffer.subarray(0, read.bytesRead);
      const metadata = childMetadata(data, provider, sessionId, parentSessionId);
      if (!metadata) return null;
      const projection = inspector.createProjection();
      function collect(bytes, tail = false) {
        let beginningConsumed = false;
        let start = tail ? bytes.indexOf(10) + 1 : 0, end;
        if (tail && !start) return;
        while ((end = bytes.indexOf(10, start)) !== -1) {
          try {
            const record = JSON.parse(bytes.subarray(start, end).toString('utf8'));
            const belongs = inspector.recordBelongsToSession(record, provider, sessionId, { provider, sessionId, parentSessionId });
            inspector.consumeMetadata(projection, record, provider, start, sessionId, { provider, sessionId, parentSessionId },
              { header: !tail && stat.size > READ_BYTES, beginning: !tail && belongs && !beginningConsumed });
            if (belongs) beginningConsumed = true;
          } catch (_) { projection.usagePartial = true; }
          start = end + 1;
        }
      }
      collect(data);
      if (stat.size > READ_BYTES) {
        projection.bounded = true;
        if (projection.model) projection.modelPartial = true;
        const offset = stat.size - READ_BYTES, tail = Buffer.alloc(READ_BYTES);
        const tailRead = await handle.read(tail, 0, tail.length, offset);
        const bytes = tail.subarray(0, tailRead.bytesRead);
        collect(bytes, true);
        // Match inspection's complete tail rows. Overlap may repeat valid records;
        // only conflicting identity metadata rejects the already-proved prefix.
        let start = bytes.indexOf(10) + 1, end;
        if (!start) start = bytes.length;
        while ((end = bytes.indexOf(10, start)) !== -1) {
          let record;
          try { record = JSON.parse(bytes.subarray(start, end).toString('utf8')); } catch (_) { start = end + 1; continue; }
          if (recordIdentityConflicts(record, provider, sessionId, { provider, sessionId, parentSessionId })) return null;
          start = end + 1;
        }
      }
      const nickname = metadata.nickname;
      const after = await handle.stat();
      await verifyPath(resource, after);
      const stats = inspector.metadata(projection, provider, now());
      const usage = { ...Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].map(key => [key, stats[key]])),
        coverage: 'bounded-transcript', observedAt: now() };
      const binding = Object.freeze({ provider, sessionId, parentSessionId, file: candidate, nickname, projection, usage, spawn });
      childBindings.add(binding);
      return binding;
    } catch (_) { return null; }
    finally { if (handle) await handle.close().catch(() => failNote('observer.transcripts.close', new Error('Transcript handle cleanup failed'))); }
  }
  async function corroborateClaudeSpawn(file, spawn, parentBinding) {
    const sidecar = file.slice(0, -6) + '.meta.json';
    let resource, handle;
    try { resource = await capturePath('claude', sidecar, true); }
    catch (error) { return error.code === 'ENOENT'; }
    try {
      if (resource.stat.size > 16384) return false;
      handle = await io.open(resource.full, require('node:fs').constants.O_RDONLY | require('node:fs').constants.O_NOFOLLOW);
      await verifyPath(resource, await handle.stat());
      const buffer = Buffer.alloc(resource.stat.size), read = await handle.read(buffer, 0, buffer.length, 0);
      const meta = JSON.parse(buffer.subarray(0, read.bytesRead).toString('utf8'));
      await verifyPath(resource, await handle.stat());
      return meta.toolUseId === spawn.toolUseId && (meta.parentAgentId === undefined || meta.parentAgentId === (parentBinding?.sessionId || null));
    } catch (_) { return false; }
    finally { if (handle) await handle.close().catch(() => failNote('observer.transcripts.close', new Error('Transcript handle cleanup failed'))); }
  }
  async function claudeCandidates(parentSessionId, parentBinding, parentId) {
    try {
      const canonical = parentBinding?.parentSessionId || parentSessionId;
      const parentFile = parentBinding?.file || await locate('claude', canonical);
      if (!parentFile) return [];
      const projection = parentBinding?.projection || states.get(parentId)?.projection;
      if (!projection) return [];
      const directory = path.join(path.dirname(parentBinding ? path.dirname(path.dirname(parentFile)) : parentFile), canonical, 'subagents');
      await containedChild('claude', directory);
      const entries = await io.readdir(directory, { withFileTypes: true });
      if (entries.length > 256) return [];
      const result = [];
      for (const entry of entries.filter(entry => entry.isFile() && /^agent-[A-Za-z0-9_-]{1,100}\.jsonl$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
        const sessionId = entry.name.slice(6, -6), spawn = projection.helperSpawns.get(sessionId);
        if (!spawn) continue;
        const file = path.join(directory, entry.name);
        if (!await corroborateClaudeSpawn(file, spawn, parentBinding)) continue;
        const event = projection.helperEvents.get(sessionId);
        result.push({ sessionId, file, canonical, spawn: { ...spawn, parentId, parentBinding: parentBinding || null,
          parentSessionId: parentSessionId }, event: event && (!event.toolUseId || event.toolUseId === spawn.toolUseId) ? event : null });
      }
      return result;
    } catch (_) { return []; }
  }

  async function readFile(id, provider, sessionId, detailed, binding) {
    if (binding && !childBindings.has(binding)) {
      states.delete(id); detailStates.delete(id); return { available: false };
    }
    const selected = detailed ? detailStates : states;
    if (!sessionId || !roots[provider]) { selected.delete(id); return { available: false }; }
    if (detailed) {
      for (const [key, value] of detailStates) if (now() - value.usedAt > 60000) detailStates.delete(key);
      if (!detailStates.has(id) && detailStates.size >= 32) detailStates.delete(detailStates.keys().next().value);
    }
    let state = selected.get(id);
    if (!state || state.sessionId !== sessionId || state.provider !== provider || state.bindingKey !== JSON.stringify(binding ? [binding.parentSessionId, binding.file] : null)) {
      state = { sessionId, provider, bindingKey: JSON.stringify(binding ? [binding.parentSessionId, binding.file] : null), offset: 0, tool: null, inode: null, file: null, verified: false, calls: new Set(), mtime: null, prefix: null, prefixLength: 0, anchor: null };
      state.projection = inspector.createProjection();
      selected.set(id, state);
    }
    state.usedAt = now();
    const light = () => {
      const stats = inspector.metadata(state.projection, provider, now());
      return { available: true, last: state.tool ? { ...state.tool } : null, usage: {
        ...Object.fromEntries(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'].map(key => [key, stats[key]])),
        coverage: 'bounded-transcript', observedAt: state.observedAt } };
    };
    let handle;
    try {
      const candidate = binding ? binding.file : state.file || await locate(provider, sessionId);
      if (!candidate) return { available: false };
      if (binding && provider === 'codex' && await locate(provider, sessionId, true) !== candidate)
        throw new Error('Child identity ambiguous');
      const resource = await capturePath(provider, candidate, !!binding);
      const full = resource.full;
      handle = await io.open(full, require('node:fs').constants.O_RDONLY | require('node:fs').constants.O_NOFOLLOW);
      const stat = await handle.stat();
      await verifyPath(resource, stat);
      let first, firstRead;
      if (binding) {
        first = Buffer.alloc(Math.min(stat.size, READ_BYTES));
        firstRead = await handle.read(first, 0, first.length, 0);
      }
      if (binding && !childMetadata(first.subarray(0, firstRead.bytesRead), provider, sessionId, binding.parentSessionId))
        throw new Error('Child identity unavailable');
      // Validate the complete previously projected window, not two sampled sentinels.
      // Rebuild from a bounded tail on change: no retained turn can outlive its raw evidence.
      const prefixLength = state.prefixLength || Math.min(stat.size, 4096);
      const prefix = Buffer.alloc(prefixLength);
      const prefixRead = await handle.read(prefix, 0, prefix.length, 0);
      const prefixHash = crypto.createHash('sha256').update(prefix.subarray(0, prefixRead.bytesRead)).digest('hex');
      let windowChanged = false;
      if (state.anchor) {
        const previous = Buffer.alloc(state.anchor.length);
        const read = await handle.read(previous, 0, previous.length, state.offset - previous.length);
        windowChanged = read.bytesRead !== previous.length || !previous.equals(state.anchor);
      }
      const rewritten = windowChanged || (state.prefix !== null && state.prefix !== prefixHash) ||
        state.device !== stat.dev || state.inode !== stat.ino || stat.size < state.offset;
      if (state.verified && !rewritten && state.offset === stat.size && state.mtime === stat.mtimeMs) {
        await verifyPath(resource, await handle.stat());
        state.observedAt = now();
        if (detailed) return { available: true, ...inspector.snapshot(state.projection, provider, now()) };
        return light();
      }
      const generation = !rewritten && detailed ? state.projection.generation : null;
      state.calls.clear(); state.tool = null; state.verified = false;
      state.projection = inspector.createProjection();
      if (generation) state.projection.generation = generation;
      if (!first) {
        first = Buffer.alloc(Math.min(stat.size, READ_BYTES));
        firstRead = await handle.read(first, 0, first.length, 0);
      }
      let identityConflict = false, beginningConsumed = false;
      const prefixData = first.subarray(0, firstRead.bytesRead);
      const completePrefix = prefixData.subarray(0, Math.max(0, prefixData.lastIndexOf(10)));
      for (const line of completePrefix.toString('utf8').split('\n')) {
        try {
          const record = JSON.parse(line);
          if ((binding || provider === 'codex') && recordIdentityConflicts(record, provider, sessionId, binding)) identityConflict = true;
          const matches = inspector.recordBelongsToSession(record, provider, sessionId, binding) &&
            (provider !== 'codex' || record.type === 'session_meta');
          if (!matches) {
            // The verified header can supply a model fallback when the current tail
            // contains no turn context. No header conversation is ever retained.
            inspector.consumeMetadata(state.projection, record, provider, 0, sessionId, binding, { header: true });
            continue;
          }
          state.verified = true;
          inspector.consumeMetadata(state.projection, record, provider, 1, sessionId, binding, { header: true, beginning: !beginningConsumed });
          beginningConsumed = true;
        } catch (_) { /* Only a complete identity record verifies the file. */ continue; }
      }
      if (identityConflict) throw new Error('Transcript identity conflict');
      if (!state.verified) throw new Error('Transcript identity unavailable');
      if (stat.size > READ_BYTES && state.projection.model) state.projection.modelPartial = true;
      const offset = Math.max(0, stat.size - READ_BYTES);
      const buffer = Buffer.alloc(stat.size - offset);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      const data = buffer.subarray(0, bytesRead);
      // A tail may begin inside a UTF-8 sequence or JSON row. Withhold its first fragment,
      // and its unfinished final row, until a complete newline-delimited record is present.
      let start = offset ? data.indexOf(10) + 1 : 0, end;
      if (offset && start === 0) start = data.length;
      if (offset) { state.projection.truncated = true; state.projection.bounded = true; }
      while ((end = data.indexOf(10, start)) !== -1) {
        try {
          const record = JSON.parse(data.subarray(start, end).toString('utf8'));
          const belongs = inspector.recordBelongsToSession(record, provider, sessionId, binding);
          if ((binding || provider === 'codex') && recordIdentityConflicts(record, provider, sessionId, binding)) identityConflict = true;
          {
            if (detailed) inspector.consume(state.projection, record, provider, offset + start, sessionId, binding);
            else {
              inspector.consumeMetadata(state.projection, record, provider, offset + start, sessionId, binding);
              if (belongs) consumeRecord(state, record, provider, offset + start);
            }
          }
        } catch (_) {
          state.projection.truncated = true; state.projection.usagePartial = true;
        }
        start = end + 1;
      }
      if (identityConflict) throw new Error('Transcript identity conflict');
      await verifyPath(resource, await handle.stat());
      state.prefix = prefixHash; state.prefixLength = prefixRead.bytesRead;
      state.device = stat.dev; state.inode = stat.ino; state.mtime = stat.mtimeMs; state.file = full;
      state.offset = offset + bytesRead; state.anchor = Buffer.from(data); state.observedAt = now();
      if (detailed) return { available: true, ...inspector.snapshot(state.projection, provider, now()) };
      return light();
    } catch (_) {
      state.file = null;
      states.delete(id); detailStates.delete(id);
      return { available: false };
    }
    finally { if (handle) await handle.close().catch(() => failNote('observer.transcripts.close', new Error('Transcript handle cleanup failed'))); }
  }
  function read(id, provider, sessionId, detailed = false, binding) {
    const key = JSON.stringify([id, provider, sessionId, detailed, binding?.parentSessionId, binding?.file]);
    if (!pending.has(key)) pending.set(key, readFile(id, provider, sessionId, detailed, binding).finally(() => pending.delete(key)));
    return pending.get(key);
  }
  async function inspectChild(id, binding) {
    if (!childBindings.has(binding)) return { available: false };
    async function verifySpawn(current = binding, seen = new Set()) {
      if (current.provider !== 'claude') return true;
      if (seen.size >= 3 || seen.has(current) || !childBindings.has(current)) return false;
      seen.add(current);
      const spawn = current.spawn;
      if (!spawn || spawn.parentBinding && !await verifySpawn(spawn.parentBinding, seen)) return false;
      const parent = await read(spawn.parentId, 'claude', spawn.parentSessionId, false, spawn.parentBinding);
      const projection = states.get(spawn.parentId)?.projection;
      const proof = projection?.helperSpawns.get(current.sessionId);
      // The selected chain is already in seen before its ancestors are reread.
      // Even a null (ambiguous) claim contradicts another immediate parent.
      const conflictingParent = [...seen].some(child => child.parentSessionId === current.parentSessionId &&
        child.spawn?.parentId !== spawn.parentId && projection?.helperSpawns.has(child.sessionId));
      return parent.available && !conflictingParent && proof?.toolUseId === spawn.toolUseId &&
        await corroborateClaudeSpawn(current.file, spawn, spawn.parentBinding);
    }
    if (!await verifySpawn()) return { available: false };
    const result = await read(id, binding.provider, binding.sessionId, true, binding);
    return await verifySpawn() ? result : { available: false };
  }
  function retain(ids) {
    for (const selected of [states, detailStates]) for (const id of selected.keys()) if (!ids.has(id)) selected.delete(id);
  }
  return { resetHelperIndex: () => indices.clear(), helperMetadata: id => states.get(id)?.projection, read, inspect: (id, provider, sessionId) => read(id, provider, sessionId, true), retain,
    bindChild, claudeCandidates, inspectChild };
}
module.exports = { makeTranscriptObserver };
