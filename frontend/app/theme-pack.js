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
  function applyInterface(snapshot, doc) {
    const fallback = getDefault().ui.colors, colors = snapshot?.ui?.colors || {};
    for (const key of Object.keys(fallback)) {
      doc.documentElement.style.setProperty('--' + key, Object.hasOwn(colors, key) ? colors[key] : fallback[key]);
    }
  }
  return Object.freeze({ freezeSnapshot, getDefault, applyInterface });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ThemePack;
else if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  ThemePack.applyInterface(ThemePack.freezeSnapshot(window.__OBSERVER_THEME_PACK__) || ThemePack.getDefault(), document);
}
