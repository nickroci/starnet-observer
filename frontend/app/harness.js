'use strict';
// The observer needs only authenticated JSON GETs (plus opt-in control POSTs), not StarNet's provider/runtime client.
const Harness = {
  api: {
    async get(path, options = {}) {
      const response = await fetch(path, {
        method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: options.signal,
        headers: { 'X-Observer-Token': window.__OBSERVER_TOKEN__ }
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Observer request failed (' + response.status + ')');
      return body;
    },
    // Control actions (OBSERVER_CONTROL=1 only): the one POST surface, same token, JSON body.
    async post(path, payload) {
      const response = await fetch(path, {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'X-Observer-Token': window.__OBSERVER_TOKEN__, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {})
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Observer request failed (' + response.status + ')');
      return body;
    }
  }
};
