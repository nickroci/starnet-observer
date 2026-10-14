'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { stationChildEnv } = require('./child-env.js');

const opaque = (prefix, value) => prefix + crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);
const clean = value => value.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 80);
const unassigned = () => ({ projectId: 'unassigned', project: 'Unassigned', projectKind: 'folder',
  repoId: 'unassigned', repo: 'Unassigned', repoKind: 'folder', worktree: null, folder: '' });

/* Git owns repository/worktree discovery. Only opaque identities and short labels cross the API.
   Canonical main-repository parents own rooms; direct folder agents use that same folder identity. */
function makeProjectResolver({ execute, now }) {
  if (typeof now !== 'function') throw new TypeError('Project resolver requires an injected now clock');
  const cache = new Map();
  const gitSettings = () => ({ timeout: 1000, maxBuffer: 16384,
    env: Object.fromEntries(Object.entries(stationChildEnv()).filter(([name]) => !name.startsWith('GIT_'))) });
  async function gitIdentity(folder) {
    const result = await execute('git', ['-C', folder, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], gitSettings());
    const lines = result.stdout.trim().split('\n');
    if (lines.length !== 3 || !lines.every(value => path.isAbsolute(value))) throw new Error('Unproven checkout');
    return Promise.all(lines.map(value => fs.realpath(value)));
  }
  async function resolve(cwd) {
    if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.length > 4096) return unassigned();
    const cached = cache.get(cwd);
    if (cached && now() - cached.at < 60000) return cached.value;
    let root;
    try { root = await fs.realpath(cwd); if (!(await fs.stat(root)).isDirectory()) return unassigned(); }
    catch (_) { return unassigned(); }
    let identity = root, kind = 'folder', worktree = null, mainRoot = null, linkedProof = false;
    try {
      const [checkout, gitDir, common] = await gitIdentity(root);
      let main = gitDir === common ? checkout : null;
      if (!main) {
        linkedProof = true;
        // Git worktree-list can invent a metadata-parent checkout for --separate-git-dir.
        // Only a previously observed main checkout in the existing bounded cache proves that association.
        const candidates = new Set([...cache.values()].filter(entry => entry.repositoryIdentity === common && entry.mainRoot && now() - entry.at < 60000)
          .map(entry => entry.mainRoot));
        if (candidates.size !== 1) return unassigned();
        const candidate = [...candidates][0];
        const [currentCheckout, currentGitDir, currentCommon] = await gitIdentity(candidate);
        if (currentCheckout !== candidate || currentGitDir !== common || currentCommon !== common) return unassigned();
        main = candidate;
      }
      identity = common; kind = 'repository'; root = main; mainRoot = gitDir === common ? main : null;
      if (checkout !== root) worktree = path.basename(checkout);
    } catch (_) {
      /* A canonical non-repository folder keeps its own room. Missing folders cannot prove identity. */
      if (linkedProof) return unassigned();
      identity = root; kind = 'folder'; worktree = null;
    }
    const projectFolder = kind === 'repository' ? path.dirname(root) : root;
    // Sub-folder inside the checkout the pane is working in ('' at the root): a display label only.
    let folder = '';
    try { const here = await fs.realpath(cwd), rel = path.relative(root, here); if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) folder = rel.split(path.sep).map(clean).filter(Boolean).join('/'); } catch (_) { folder = ''; }
    const value = { projectId: opaque('prj_', 'folder\0' + projectFolder), project: clean(path.basename(projectFolder)) || 'Local folder', projectKind: 'group',
      repoId: opaque(kind === 'repository' ? 'repo_' : 'dir_', identity), repo: clean(path.basename(root)) || 'Local folder', repoKind: kind,
      worktree: worktree ? clean(worktree) : null, folder: folder.slice(0, 120) };
    cache.set(cwd, { at: now(), value, mainRoot, repositoryIdentity: kind === 'repository' ? identity : null });
    if (cache.size > 256) cache.delete(cache.keys().next().value);
    return value;
  }
  return { resolve };
}
module.exports = { makeProjectResolver };
