'use strict';
/* sidecar/control.js — the only place the observer mutates anything, and only when OBSERVER_CONTROL=1.

   Three actions, each targeting a Herdr pane id the page already shows:
     attach(paneId)  open a macOS Terminal window running `herdr agent attach <pane>`
     spawn(paneId)   new tab in that pane's workspace and cwd, start Claude there, then attach a Terminal to it
     close(paneId)   close the pane (ends the agent); the page asks the user to confirm first
   Every target is validated against the same pane-id shape the reader accepts, and attach/close additionally
   require Herdr to report an agent in that pane, so an arbitrary pane id cannot be closed through here. */
const path = require('node:path');
const childProcess = require('./child-env.js').guardChildProcess(require('node:child_process'));

const PANE = /^[A-Za-z0-9:_-]{1,100}$/;
const PROMPT = '➜|\\$ $|% $|> $';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const badRequest = reason => Object.assign(new Error(reason), { status: 400 });

function makeControl(options = {}) {
  const execute = options.execute || ((command, args, settings = {}) => new Promise((resolve, reject) => {
    childProcess.execFile(command, args, { timeout: settings.timeout || 20000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(Object.assign(error, { stdout, stderr }));
      resolve({ stdout, stderr });
    });
  }));
  const platform = options.platform || process.platform;
  const claudeArgs = Array.isArray(options.claudeArgs) ? options.claudeArgs : [];
  const now = options.now || Date.now;
  const wait = options.sleep || sleep;

  async function herdr(args, timeout) {
    const { stdout } = await execute('herdr', args, { timeout });
    let parsed;
    try { parsed = JSON.parse(stdout); } catch (_) { throw new Error('herdr ' + args.slice(0, 2).join(' ') + ' returned no JSON'); }
    if (parsed.error) throw new Error(parsed.error.message || ('herdr ' + args.slice(0, 2).join(' ') + ' failed'));
    return parsed.result;
  }
  const validPane = id => typeof id === 'string' && PANE.test(id);
  async function agentIn(paneId) {
    if (!validPane(paneId)) throw badRequest('invalid-pane');
    const result = await herdr(['agent', 'get', paneId], 5000);
    if (!result || !result.agent) throw badRequest('no-agent-in-pane');
    return result.agent;
  }
  async function openTerminal(paneId) {
    if (platform !== 'darwin') throw new Error('Opening a terminal is only implemented on macOS');
    // paneId is validated to [A-Za-z0-9:_-], so it is safe inside the AppleScript string literal.
    // `launch` starts Terminal without its default window if it was not running; `do script` then makes exactly one
    // window. `--takeover` replaces whatever client currently owns input (for example the wrapper's VS Code attach),
    // because the point of the button is to put this agent in front of the user now.
    const script = 'tell application "Terminal"\nlaunch\ndo script "herdr agent attach ' + paneId + ' --takeover"\nactivate\nend tell';
    await execute('osascript', ['-e', script], { timeout: 10000 });
  }

  async function attach(paneId) {
    const agent = await agentIn(paneId);
    await openTerminal(paneId);
    return { ok: true, action: 'attach', paneId, name: agent.name || null };
  }
  async function spawn(paneId) {
    if (!validPane(paneId)) throw badRequest('invalid-pane');
    const got = await herdr(['pane', 'get', paneId], 5000), pane = got && got.pane;
    if (!pane || typeof pane.cwd !== 'string' || !pane.cwd || typeof pane.workspace_id !== 'string') throw new Error('pane has no cwd or workspace');
    const stamp = new Date(now()).toTimeString().slice(0, 8).replace(/:/g, '');
    const name = ((path.basename(pane.cwd) || 'agent').replace(/[^A-Za-z0-9_-]/g, '-')) + '-' + stamp;
    const created = await herdr(['tab', 'create', '--workspace', pane.workspace_id, '--cwd', pane.cwd, '--label', name, '--no-focus'], 10000);
    const target = created && created.root_pane && created.root_pane.pane_id;
    if (!validPane(target)) throw new Error('tab create returned no pane');
    // The new tab's shell may still be loading its rc files; wait for a prompt (best effort), then start with retries.
    try { await execute('herdr', ['pane', 'wait-output', '--regex', PROMPT, target, '--timeout', '15000'], { timeout: 20000 }); } catch (_) { /* start anyway */ }
    const startArgs = ['agent', 'start', name, '--kind', 'claude', '--pane', target, '--timeout', '60000'];
    if (claudeArgs.length) startArgs.push('--', ...claudeArgs);
    let started = false, lastError = null;
    for (let attempt = 0; attempt < 3 && !started; attempt++) {
      try { await herdr(startArgs, 70000); started = true; }
      catch (error) {
        lastError = error;
        // A startup dialog (trust folder, resume picker) makes start report an error while the agent exists.
        try { await herdr(['agent', 'get', target], 5000); started = true; } catch (_) { await wait(1000); }
      }
    }
    if (!started) throw new Error('Claude did not start in ' + target + (lastError ? ': ' + lastError.message : ''));
    await openTerminal(target);
    return { ok: true, action: 'spawn', paneId: target, name, project: path.basename(pane.cwd) };
  }
  async function close(paneId) {
    const agent = await agentIn(paneId);
    await herdr(['pane', 'close', paneId], 10000);
    return { ok: true, action: 'close', paneId, name: agent.name || null };
  }
  return { attach, spawn, close };
}
module.exports = { makeControl, PANE };
