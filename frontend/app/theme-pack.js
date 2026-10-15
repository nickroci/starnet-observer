/* Resolved snapshots only; the server owns validation and inheritance. */
'use strict';
const ThemePack = (() => {
  function freezeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    for (const value of Object.values(snapshot)) freezeSnapshot(value);
    return Object.freeze(snapshot);
  }
  let defaults = typeof module !== 'undefined' && module.exports
    ? freezeSnapshot(require('../assets/themes/starnet/theme.json')) : null;
  function getDefault() {
    if (!defaults && typeof window !== 'undefined') defaults = freezeSnapshot(window.__OBSERVER_THEME_DEFAULT__);
    if (!defaults) throw new Error('Canonical theme default bootstrap is unavailable');
    return defaults;
  }
  return Object.freeze({ freezeSnapshot, getDefault });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ThemePack;
