'use strict';
const { unavailable } = require('./observer-inspector.js');
const ROOMS = [
  { name: 'Product', repos: ['helio-web', 'helio-mobile', 'helio-api'] },
  { name: 'Platform', repos: ['helio-auth', 'helio-billing', 'helio-data'] },
  { name: 'Intelligence', repos: ['helio-agents', 'helio-context', 'helio-evals'] },
  { name: 'Operations', repos: ['helio-console', 'helio-ci', 'helio-observability'] }
];
const TOOL_NAMES = new Set(['Bash', 'exec_command', 'shell', 'local_shell', 'write_stdin', 'Read', 'NotebookRead', 'view_image', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'apply_patch', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'web_search', 'web__run', 'functions.exec', 'functions.wait', 'wait', 'Task', 'Agent', 'spawn_agent', 'TodoWrite', 'update_plan']);

// A server-side allowlist, not a text replacement: private labels never reach the recording page.
// Opaque ownership IDs and live status/freshness remain unchanged; aliases are display identities only.
function makePresentationObserver(observer, now = Date.now) {
  const projects = new Map(), repos = new Map(), terminals = new Map(), worktrees = new Map();
  function project(id) {
    if (!projects.has(id)) {
      const index = projects.size, room = ROOMS[index];
      projects.set(id, { name: room?.name || 'Studio ' + (index + 1), repos: room?.repos || [], count: 0 });
    }
    return projects.get(id);
  }
  function repo(row, room) {
    if (!repos.has(row.repoId)) {
      const index = room.count++;
      repos.set(row.repoId, room.repos[index] || 'helio-' + room.name.toLowerCase().replace(/ /g, '-') + '-' + (index + 1));
    }
    return repos.get(row.repoId);
  }
  function rowProjection(row) {
    const room = project(row.projectId), repoName = repo(row, room);
    if (!terminals.has(row.id)) terminals.set(row.id, 'Terminal ' + (terminals.size + 1));
    const worktreeKey = row.repoId + '\0' + row.worktree;
    if (row.worktree && !worktrees.has(worktreeKey)) worktrees.set(worktreeKey, 'Worktree ' + (worktrees.size + 1));
    const helper = row.source === 'helper' || Object.hasOwn(row, 'parentId');
    const safe = {
      id: row.id, provider: row.provider, source: row.source, status: row.status,
      projectId: row.projectId, project: room.name, projectKind: row.projectKind,
      repoId: row.repoId, repo: repoName, repoKind: row.repoKind,
      worktree: row.worktree ? worktrees.get(worktreeKey) : null,
      paneId: row.paneId ? terminals.get(row.id) : null,
      title: helper ? 'Helper' : 'Live ' + (row.provider === 'claude' ? 'Claude' : 'Codex') + ' session',
      inspectionIdentity: null, observedAt: row.observedAt, inventoryHealth: row.inventoryHealth,
      presence: row.presence, helperOverflow: row.helperOverflow, usage: row.usage,
      tool: { available: row.tool?.available === true }
    };
    if (row.tool?.last) safe.tool.last = { name: TOOL_NAMES.has(row.tool.last.name) ? row.tool.last.name : 'Tool', phase: row.tool.last.phase, outcome: row.tool.last.outcome, at: row.tool.last.at };
    if (helper) {
      safe.parentId = row.parentId; safe.lineageState = row.lineageState;
      safe.taskEvidence = { state: 'unavailable', summary: null };
      safe.taskStatusEvidence = { status: row.taskStatusEvidence?.status || null };
      safe.lifecycleEvidence = { state: row.lifecycleEvidence?.state, reason: row.lifecycleEvidence?.reason };
    }
    return safe;
  }
  return {
    async get() {
      const inventory = await observer.get();
      // Sort only alias allocation; preserve the source roster's order and room/repository ownership.
      const sorted = [...inventory.sessions].sort((a, b) => String(a.projectId).localeCompare(String(b.projectId)) || String(a.repoId).localeCompare(String(b.repoId)) || a.id.localeCompare(b.id));
      for (const row of sorted) rowProjection(row);
      const source = value => value ? { health: value.health, observedAt: value.observedAt } : undefined;
      const bus = inventory.bus;
      return {
        presentation: { company: 'Helioforge', label: 'Live activity · fictional company labels' },
        sessions: inventory.sessions.map(rowProjection), aggregate: inventory.aggregate,
        health: inventory.health, observedAt: inventory.observedAt,
        error: inventory.error ? 'Local session inventory unavailable' : null,
        sources: { herdr: source(inventory.sources?.herdr), desktop: source(inventory.sources?.desktop) },
        bus: bus ? { health: bus.health, reason: bus.reason, observedAt: bus.observedAt, window: bus.window,
          messages: bus.messages.map(message => ({ id: message.id, from: message.from, to: message.to, sentAt: message.sentAt, acknowledgedAt: message.acknowledgedAt, wake: message.wake })) } : null
      };
    },
    async inspect(id) { return unavailable(id, 'presentation-mode', now()); },
    inspectMessage(id) { return { id, identity: null, health: 'unavailable', reason: 'presentation-mode', text: null }; }
  };
}
module.exports = { makePresentationObserver };
