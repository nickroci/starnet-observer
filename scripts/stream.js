#!/usr/bin/env -S bun --no-env-file
/* Remote side of a multi-host observer: no HTTP server and no control surface. Writes one NDJSON line, the same
   snapshot /api/observer/sessions returns, every interval to stdout, and exits when stdin closes (the hub's ssh went
   away) or on SIGTERM/SIGHUP/SIGPIPE. Run by the hub as `ssh <host> 'cd <dir> && bun --no-env-file scripts/stream.js'`. */
'use strict';
const { makeObserver } = require('../sidecar/observer.js');
const { setKnownSecretSource } = require('../sidecar/redaction.js');
const { setClock } = require('../sidecar/failopen.js');

const INTERVAL = 2000, MAX_LINE = 4 * 1024 * 1024;

function startStream({ observer, write, interval = INTERVAL, setTimer = setTimeout, clearTimer = clearTimeout, onError = () => {} }) {
  let timer = null, stopped = false;
  async function tick() {
    timer = null;
    if (stopped) return;
    try {
      const line = JSON.stringify(await observer.get());
      // An oversized line would be dropped by the hub anyway; send a bounded, truthful unavailable snapshot instead.
      if (stopped) return;
      // write() resolves once the line has been handed to the pipe, so a line is never held back behind the next one.
      await write(line.length <= MAX_LINE ? line + '\n' : JSON.stringify({ sessions: [], health: 'unavailable', error: 'Snapshot too large' }) + '\n');
    } catch (error) { onError(error); }
    if (!stopped) timer = setTimer(tick, interval);
  }
  tick();
  return { stop() { stopped = true; if (timer) clearTimer(timer); timer = null; } };
}

if (require.main === module) {
  const heldSecrets = () => Object.entries(process.env).filter(([name]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(name)).map(([, value]) => value);
  setKnownSecretSource(heldSecrets);
  setClock(Date.now);
  let stream = null;
  const exit = () => { stream?.stop(); process.exit(0); };
  stream = startStream({ observer: makeObserver({ now: Date.now }), write: line => new Promise(resolve => process.stdout.write(line, () => resolve())) });
  process.stdout.on('error', exit);   // EPIPE: the hub is gone
  process.stdin.on('end', exit); process.stdin.on('close', exit); process.stdin.resume();
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGPIPE', 'SIGINT']) process.once(signal, exit);
}
module.exports = { startStream, INTERVAL, MAX_LINE };
