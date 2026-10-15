'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { makeHelperObserver } = require('../sidecar/observer-helpers.js');
const { makeTranscriptObserver } = require('../sidecar/observer-transcripts.js');
const ID = '00000000-0000-0000-0000-000000000001';
const line = row => JSON.stringify(row) + '\n';
const spawn = (child, call = 'spawn-' + child, description = 'Task ' + child) => [
  { type: 'assistant', sessionId: ID, timestamp: '2026-10-15T10:00:00Z', message: { content: [{ type: 'tool_use', name: 'Agent', id: call, input: { description, prompt: 'PRIVATE PROMPT' } }] } },
  { type: 'user', sessionId: ID, toolUseResult: { status: 'async_launched', agentId: child }, message: { content: [{ type: 'tool_result', tool_use_id: call }] } }
].map(line).join('');
// Ordinary parent conversation, well past the bounded tail window (≈790KB) so early spawns fall out of it.
const padding = (rows, tag = 'p') => Array.from({ length: rows }, (_, i) =>
  line({ type: 'user', sessionId: ID, timestamp: '2026-10-15T10:30:00Z', message: { content: tag + i + ' ' + 'x'.repeat(600) } })).join('');
const childRow = (child, timestamp) => line({ type: 'assistant', sessionId: ID, agentId: child, isSidechain: true, timestamp,
  message: { id: 'm-' + child, usage: { input_tokens: 3 }, content: 'CHILD ' + child } });
const notification = (child, status) => line({ type: 'queue-operation', operation: 'enqueue', sessionId: ID, timestamp: '2026-10-15T11:00:00Z',
  content: '<task-notification><task-id>' + child + '</task-id><tool-use-id>spawn-' + child + '</tool-use-id><status>' + status + '</status><summary>s</summary></task-notification>' });

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starnet-helper-index-'));
  try {
    let clock = Date.parse('2026-10-15T12:00:00Z');
    const now = () => clock;
    const claude = path.join(root, 'claude'), codex = path.join(root, 'codex');
    await fs.mkdir(codex); const directory = path.join(claude, ID, 'subagents'); await fs.mkdir(directory, { recursive: true });
    const parentFile = path.join(claude, ID + '.jsonl');
    const child = async (name, { meta = 'spawn-' + name, at = '2026-10-15T10:01:00Z' } = {}) => {
      await fs.writeFile(path.join(directory, 'agent-' + name + '.jsonl'), childRow(name, at));
      if (meta) await fs.writeFile(path.join(directory, 'agent-' + name + '.meta.json'), JSON.stringify({ toolUseId: meta }));
    };
    await child('early1'); await child('early2'); await child('nometa', { meta: null }); await child('badmeta', { meta: 'spawn-other' }); await child('late');
    const head = line({ type: 'user', sessionId: ID, timestamp: '2026-10-15T09:59:00Z', message: { content: 'PARENT START' } });
    // Early spawns sit past the verified 256KB head and far before the tail, as in a long orchestrator session.
    await fs.writeFile(parentFile, head + padding(500, 'h') + spawn('early1') + spawn('early2') + spawn('nometa') + spawn('badmeta') + padding(1700) + spawn('late'));
    assert((await fs.stat(parentFile)).size > 1024 * 1024, 'fixture parent exceeds 1MB');
    const transcripts = makeTranscriptObserver({ now, roots: { claude, codex } });
    const helpers = makeHelperObserver({ now, transcripts, readEdges: () => ({ rows: [] }) });
    const parent = { id: 'parent', provider: 'claude', sessionId: ID, inspectionIdentity: 'claude:' + ID, source: 'herdr', inventoryHealth: 'available', projectId: 'p', project: 'P' };
    const names = result => result.rows.map(row => row.sessionId).sort();

    // First pass sees only the tail window; the full-file index builds in the background.
    let result = await helpers.children([parent]);
    assert.deepEqual(names(result), ['late'], 'tail window alone holds only the latest spawn');
    await transcripts.spawnIndexIdle();
    result = await helpers.children([parent]);
    assert.deepEqual(names(result), ['early1', 'early2', 'late', 'nometa'], 'index finds spawns far outside the window; mismatched sidecar is rejected');
    assert.equal(result.rows.find(row => row.sessionId === 'early1').taskEvidence.summary, 'Task early1');
    assert(!JSON.stringify(result.rows).includes('PRIVATE PROMPT'));
    const early = result.rows.find(row => row.sessionId === 'early1');
    assert.equal((await helpers.inspect(early)).available, true, 'index-proven helper stays inspectable');

    // Appends are followed incrementally, even when the new spawn is itself pushed out of the tail.
    await child('appended');
    await fs.appendFile(parentFile, spawn('appended') + padding(1700, 'q'));
    result = await helpers.children([parent]);
    assert(names(result).includes('appended'), 'appended spawn found through the incremental index');
    assert(names(result).includes('early2'));

    // Rewrite only middle bytes, preserving the inode, length, prefix and entire bounded tail.
    // A previously granted private binding must be revoked before a refresh can commit new bindings.
    for (const append of [false, true]) {
      await child('revoked');
      const before = head + padding(500, 'h') + spawn('revoked') + padding(1700, 'z');
      await fs.writeFile(parentFile, before);
      result = await helpers.children([parent]);
      const revoked = result.rows.find(row => row.sessionId === 'revoked');
      assert(revoked);
      assert.equal((await helpers.inspect(revoked)).available, true);
      const after = before.replace('"Agent"', '"Other"');
      assert.equal(Buffer.byteLength(after), Buffer.byteLength(before));
      await fs.writeFile(parentFile, after + (append ? padding(20, 'appended-after-rewrite') : ''));
      assert.equal((await helpers.inspect(revoked)).available, false, 'middle rewrite revokes private inspection, including when followed by append');
      result = await helpers.children([parent]);
      assert(!names(result).includes('revoked'), 'middle rewrite removes the helper relationship');
    }
    // Restore the append/event scenario after the independent rewrite cases.
    await fs.writeFile(parentFile, head + padding(500, 'h') + spawn('early1') + spawn('early2') + padding(1700));
    result = await helpers.children([parent]);

    // Terminal events outside the tail are indexed too, so a finished early helper reads done, not unknown.
    await fs.appendFile(parentFile, notification('early2', 'completed'));
    result = await helpers.children([parent]);
    assert.equal(result.rows.find(row => row.sessionId === 'early2').status, 'done');

    // A conflicting second spawn claim for the same child is ambiguous and drops it.
    await fs.appendFile(parentFile, spawn('early1', 'spawn-early1-again'));
    result = await helpers.children([parent]);
    assert(!names(result).includes('early1'), 'repeated claim with another tool use id fails closed');

    // A rewrite that keeps the same prefix but different later bytes restarts the index from the first byte.
    await fs.writeFile(parentFile, head + padding(500, 'h') + spawn('early1') + padding(2600, 'r'));
    result = await helpers.children([parent]);
    assert.deepEqual(names(result), ['early1'], 'rewrite drops spawns that no longer exist');
    // Replacement by rename (new inode) also resets.
    await fs.writeFile(parentFile + '.tmp', head + padding(500, 'h') + spawn('late') + padding(1700, 's')); await fs.rename(parentFile + '.tmp', parentFile);
    result = await helpers.children([parent]);
    assert.deepEqual(names(result), ['late'], 'replacement drops spawns that no longer exist');

    // Liveness: the helper's own recent conversation row means working; old rows stay unknown; terminal means done.
    await fs.writeFile(parentFile, head + padding(500, 'h') + spawn('live') + padding(1700, 't'));
    await child('live', { at: new Date(clock - 5000).toISOString() });
    result = await helpers.children([parent]); await transcripts.spawnIndexIdle(); result = await helpers.children([parent]);
    assert.equal(result.rows.find(row => row.sessionId === 'live').status, 'working', 'own row 5s ago reads working');
    clock += 30000; result = await helpers.children([parent]);
    assert.equal(result.rows.find(row => row.sessionId === 'live').status, 'unknown', 'own row 35s ago is not evidence of work');
    await fs.writeFile(path.join(directory, 'agent-live.jsonl'), childRow('live', new Date(clock - 1000).toISOString()));
    await fs.appendFile(parentFile, notification('live', 'completed'));
    result = await helpers.children([parent]);
    assert.equal(result.rows.find(row => row.sessionId === 'live').status, 'done', 'terminal event wins over a recent row');

    // Root ambiguity lives outside both bounded windows. A nested valid claim cannot
    // choose a parent for that same canonical child, even when root's merged value is null.
    await child('scout'); await child('nested');
    const scoutFile = path.join(directory, 'agent-scout.jsonl');
    const nestedSpawn = spawn('nested', 'spawn-nested', 'Nested task').split('\n').filter(Boolean).map(row =>
      line({ ...JSON.parse(row), agentId: 'scout', isSidechain: true })).join('');
    await fs.appendFile(scoutFile, nestedSpawn);
    await fs.writeFile(parentFile, head + padding(500, 'h') + spawn('scout') + padding(1700));
    result = await helpers.children([parent]);
    await transcripts.spawnIndexIdle();
    result = await helpers.children([parent]);
    const nested = result.rows.find(row => row.sessionId === 'nested');
    assert(nested, 'nested helper starts with an unambiguous immediate parent');
    assert.equal((await helpers.inspect(nested)).available, true);
    await fs.writeFile(parentFile, head + padding(500, 'h') + spawn('scout') +
      spawn('nested', 'root-one') + spawn('nested', 'root-two') + padding(1700));
    assert.equal((await helpers.inspect(nested)).available, false, 'indexed ambiguous ancestor revokes the existing private binding');
    result = await helpers.children([parent]);
    assert.deepEqual(names(result), ['scout'], 'indexed ambiguous ancestor claim prevents a guessed nested parent');

    // Delay only the root's full index read. The first snapshot must finish with
    // its valid tail helper, but no guessed nested ancestry or private transcript.
    await fs.writeFile(parentFile, head + padding(500, 'h') + spawn('nested', 'root-one') +
      spawn('nested', 'root-two') + padding(1700) + spawn('scout'));
    const indexedFile = await fs.realpath(parentFile);
    let releaseIndex, indexStarted;
    const indexGate = new Promise(resolve => { releaseIndex = resolve; });
    const started = new Promise(resolve => { indexStarted = resolve; });
    const delayedFs = Object.create(fs);
    delayedFs.open = async (file, ...args) => {
      const handle = await fs.open(file, ...args);
      return new Proxy(handle, { get(target, name) {
        if (name === 'read') return async (buffer, offset, length, position) => {
          if (file === indexedFile && length > 256 * 1024) { indexStarted(); await indexGate; }
          return target.read(buffer, offset, length, position);
        };
        const value = target[name];
        return typeof value === 'function' ? value.bind(target) : value;
      } });
    };
    const coldTranscripts = makeTranscriptObserver({ now, fs: delayedFs, roots: { claude, codex } });
    const coldHelpers = makeHelperObserver({ now, transcripts: coldTranscripts, readEdges: () => ({ rows: [] }) });
    let deadline;
    const timeout = new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Cold-index snapshot or inspection blocked on background scan')), 3000); });
    try {
      await Promise.race([(async () => {
        result = await coldHelpers.children([parent]);
        await started;
        assert.deepEqual(names(result), ['scout'], 'cold snapshot keeps tail helper but withholds nested ancestry until ancestor claims are complete');
        assert.equal((await coldHelpers.inspect(result.rows[0])).available, false, 'pending full index denies private inspection even for a valid tail helper');
        // Exercise the private transcript boundary using real proved child bindings,
        // independently of traversal's new rule withholding the nested public row.
        const scoutCandidate = (await coldTranscripts.claudeCandidates(ID, undefined, parent.id)).find(value => value.sessionId === 'scout');
        const scoutBinding = await coldTranscripts.bindChild('claude', 'scout', ID, scoutCandidate.file, scoutCandidate.spawn);
        const nestedCandidate = (await coldTranscripts.claudeCandidates('scout', scoutBinding, 'cold-scout')).find(value => value.sessionId === 'nested');
        assert(nestedCandidate);
        const nestedBinding = await coldTranscripts.bindChild('claude', 'nested', ID, nestedCandidate.file, nestedCandidate.spawn);
        assert(nestedBinding);
        assert.equal((await coldTranscripts.inspectChild('cold-nested', nestedBinding)).available, false, 'pending ancestor index cannot authorize private nested content');
      })(), timeout]);
    } finally { clearTimeout(deadline); releaseIndex(); await coldTranscripts.spawnIndexIdle(); }
    result = await coldHelpers.children([parent]);
    assert.deepEqual(names(result), ['scout'], 'completed root ambiguity continues to suppress nested helper');
    assert.equal((await coldHelpers.inspect(result.rows[0])).available, true, 'complete proof unlocks valid tail helper inspection');

    console.log('observer helpers index: spawns outside the tail, append, conflict, rewrite/replacement reset, sidecar corroboration and activity status PASS');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
