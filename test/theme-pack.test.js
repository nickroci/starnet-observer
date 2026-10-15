'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { loadThemePack, validatePack, resolvePack, validateInstalledPacks } = require('../sidecar/theme-packs.js');
const ThemePack = require('../frontend/app/theme-pack.js');
const { SCENE_ART_ROLES } = require('../frontend/app/scene-art-roles.js');
const root = path.resolve(__dirname, '../frontend');
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'assets/themes/starnet/theme.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const custom = value => ({ version: 1, id: 'sample', extends: 'starnet', ...value });
const initial = loadThemePack({}, root);
assert.equal(initial.effectiveId, 'starnet');
assert.deepEqual(initial.warnings, []);
assert.equal(initial.scene.colors.space, '#020406');
assert.equal(initial.scene.colors.stale, '#ffbd5c');
assert.equal(initial.ui.colors.stale, '#efbc70');
assert.deepEqual(initial.scene.projectAccents, ['#78add7', '#70c5bc', '#84c98d', '#b3c184', '#dbbd79', '#e39a6c', '#d68e98', '#d89bd0', '#b49be3', '#9aa2ee']);
const partial = resolvePack(custom({ ui: { colors: { glow: '#112233', ink: '#aabbcc' }, shapes: { control: [10, 10, 10, 10] } }, scene: { colors: { stale: '#abc123' } } }), defaults,
  { colors: { accent: '#123456', background: '#654321', panel: '#112244', text: '#abcdef' } });
assert.equal(partial.ui.colors.phosphor, '#123456');
assert.equal(partial.ui.colors.chrome, '#123456');
assert.equal(partial.ui.colors.glow, 'rgba(18,52,86,.22)');
assert.equal(partial.ui.colors.bg, '#654321');
assert.equal(partial.ui.colors.panel, '#112244');
assert.equal(partial.ui.colors.ink, '#abcdef');
assert.equal(partial.scene.colors.stale, '#abc123');
assert.equal(partial.scene.colors.working, '#6ff7a0');
assert.deepEqual(partial.ui.shapes.mailRow, [2, 8, 2, 2]);
assert.deepEqual(defaults.ui.shapes.control, [2, 8, 2, 8], 'resolution never mutates canonical defaults');
for (const invalid of [
  { version: 2 }, { id: '../sample' }, { extends: 'other' }, { scripts: [] }, { ui: null },
  { ui: { colors: { madeUp: '#123456' } } }, { ui: { colors: { ink: 'url(secret)' } } },
  { ui: { colors: { ink: 'rgba(256,0,0,.2)' } } }, { ui: { colors: { ink: 'rgba(1,2,3,1.1)' } } },
  { ui: { typography: { profile: 'remote' } } }, { ui: { typography: { scale: 1.11 } } },
  { ui: { typography: { scale: NaN } } }, { ui: { typography: { font: 'fonts/other.woff2' } } },
  { ui: { shapes: { control: [1, 2, 3] } } }, { ui: { shapes: { panel: [25, 1, 1, 1] } } },
  { ui: { shapes: { badgeCut: 'custom' } } }, { ui: { decor: { glow: 0 } } },
  { ui: { decor: { focus: false } } }, { ui: { logo: { image: 'https://host/logo.png', alt: 'Brand' } } },
  { ui: { logo: { image: 'branding/logo.png', alt: '' } } },
  { scene: { backgroundFx: 'new' } }, { scene: { ambientFx: 'new' } },
  { scene: { projectAccents: ['#123456'] } }, { scene: { art: { style: 'station', assets: {} } } },
  { scene: { art: { style: 'home-office', assets: {} }, backgroundFx: 'none', ambientFx: 'none' } },
  { crew: { blank: { tracks: {} } } }, { crew: { unknown: {} } }
]) assert.throws(() => validatePack(custom(invalid), defaults), /Invalid theme pack/);
validatePack(custom({ ui: { colors: { ink: 'rgba(255,0,1,.25)' }, typography: { profile: 'dm-sans', scale: 0.9 } } }), defaults);
assert.equal(Object.keys(SCENE_ART_ROLES).length, 34);
assert.deepEqual(SCENE_ART_ROLES.floor.source, { width: 48, height: 24 });
assert.notDeepEqual(SCENE_ART_ROLES.chair.source, SCENE_ART_ROLES.helperChair.source);
// The metadata must contain the actual projected chair boxes at both native sizes.
for (const [role, scale] of [['chair', 1], ['helperChair', 0.72]]) {
  const spec = SCENE_ART_ROLES[role];
  for (const box of [{ x: -.3, y: -.35, w: .6, h: .5, low: 0, high: .35 }, { x: -.3, y: -.45, w: .6, h: .1, low: .35, high: .9 }]) {
    for (const x of [box.x, box.x + box.w]) for (const y of [box.y, box.y + box.h]) for (const z of [box.low, box.high]) {
      const px = 24 * (x - y) * scale + spec.foot.x, py = (12 * (x + y) - 24 * z) * scale + spec.foot.y;
      assert.ok(px >= 0 && px <= spec.source.width && py >= 0 && py <= spec.source.height, role + ' clips its reserved chair bounds');
    }
  }
}
for (const [role, spec] of Object.entries(SCENE_ART_ROLES)) {
  assert.ok(spec.source.width <= 512 && spec.source.height <= 512);
  if (['chair', 'helperChair', 'viewer', 'carrier'].includes(role)) continue;
  const { w, h, height } = spec.extent;
  for (const x of [0, w]) for (const y of [0, h]) for (const z of [0, height]) {
    const px = 24 * (x - y) + spec.foot.x, py = 12 * (x + y) - 24 * z + spec.foot.y;
    assert.ok(px >= 0 && px <= spec.source.width && py >= 0 && py <= spec.source.height, role + ' clips its native extent');
  }
}
const frozen = ThemePack.freezeSnapshot(Object.freeze({ nested: { list: [1] } }));
assert.ok(Object.isFrozen(frozen.nested.list));
assert.throws(() => ThemePack.getDefault().ui.colors.ink = '#000000', TypeError);
const browser = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'app/theme-pack.js'), 'utf8') + '\nwindow.readDefault = () => ThemePack.getDefault();', browser);
browser.window.__OBSERVER_THEME_DEFAULT__ = clone(defaults);
assert.equal(browser.window.readDefault().id, 'starnet', 'helper may load before nonce data');
const fakeDocument = () => { const styles = new Map(); return { styles, documentElement: { style: { setProperty(key, value) { styles.set(key, value); } } } }; };
const colorKeys = Object.keys(defaults.ui.colors);
assert.equal(colorKeys.length, 48);
const applied = snapshot => { const doc = fakeDocument(); ThemePack.applyInterface(snapshot, doc); return doc.styles; };
assert.deepEqual(applied(defaults), new Map(colorKeys.map(key => ['--' + key, defaults.ui.colors[key]])), 'default binds exactly the canonical inventory');
const overridden = applied({ ui: { colors: { ...defaults.ui.colors, phosphor: '#123456', glow: 'rgba(18,52,86,.22)', madeUp: '#abcdef' } } });
assert.equal(overridden.get('--phosphor'), '#123456'); assert.equal(overridden.get('--glow'), 'rgba(18,52,86,.22)');
assert.equal(overridden.has('--madeUp'), false, 'unknown snapshot keys never become properties'); assert.equal(overridden.size, 48);
const sparse = applied({ ui: { colors: { ink: '#aabbcc' } } });
assert.equal(sparse.get('--ink'), '#aabbcc'); assert.equal(sparse.get('--bg'), defaults.ui.colors.bg, 'missing keys fall back to the default'); assert.equal(sparse.size, 48);
for (const pack of [undefined, { ...clone(defaults), ui: { ...clone(defaults.ui), colors: { ...defaults.ui.colors, phosphor: '#654321' } } }]) {
  const doc = fakeDocument(), page = { window: { __OBSERVER_THEME_DEFAULT__: clone(defaults), __OBSERVER_THEME_PACK__: pack }, document: doc };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app/theme-pack.js'), 'utf8'), page);
  assert.equal(doc.styles.size, 48);
  assert.equal(doc.styles.get('--phosphor'), pack ? '#654321' : defaults.ui.colors.phosphor, 'load applies the selected snapshot or the default');
  if (pack) assert.ok(Object.isFrozen(page.window.__OBSERVER_THEME_PACK__.ui.colors), 'load freezes the selected snapshot');
}
const pageSource = fs.readFileSync(path.join(root, 'observer.html'), 'utf8');
const head = pageSource.slice(0, pageSource.indexOf('</head>'));
assert.ok(head.indexOf('href="css/observer.css"') < head.indexOf('<!--observer-boot--><script src="app/theme-pack.js"></script>'), 'boot marker then theme helper follow the stylesheet in head');
assert.ok(pageSource.includes('<!--observer-boot--><script src="app/theme-pack.js"></script></head>'), 'theme helper is the last head element');
assert.equal(pageSource.split('app/theme-pack.js').length, 2, 'theme helper loads exactly once');
// One whole-source audit catches unextracted colors without per-token fixtures.
const normalize = value => /^#[a-f0-9]{3}$/i.test(value) ? '#' + [...value.slice(1)].map(value => value + value).join('') : value;
for (const [filename, inventory] of [['css/observer.css', defaults.ui.colors], ['app/observer-view.js', defaults.scene.colors], ['app/observer-model.js', defaults.scene.colors], ['app/observer-mail.js', defaults.scene.colors], ['app/observer-scene.js', defaults.scene.colors]]) {
  const literals = fs.readFileSync(path.join(root, filename), 'utf8').match(/#[a-f0-9]{3,6}\b|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(?:\d*\.)?\d+\s*\)/gi) || [];
  const values = new Set([...Object.values(inventory), ...defaults.scene.projectAccents]);
  assert.deepEqual([...new Set(literals.map(normalize))].filter(value => !values.has(value)), [], filename + ' has unextracted fixed colors');
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'observer-theme-test-'));
const frontend = path.join(temporary, 'frontend');
const install = (id, value) => {
  const directory = path.join(frontend, 'assets/themes', id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'theme.json'), JSON.stringify(value));
  return directory;
};
// These headers test structural IO only. Browser decode remains a separate gate.
function png(width, height, size = 33) {
  const buffer = Buffer.alloc(size);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(buffer);
  buffer.writeUInt32BE(13, 8); buffer.write('IHDR', 12); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(height, 20);
  return buffer;
}
function writeResource(directory, relative, buffer) {
  fs.mkdirSync(path.dirname(path.join(directory, relative)), { recursive: true });
  fs.writeFileSync(path.join(directory, relative), buffer);
}
try {
  install('starnet', defaults);
  for (const group of Object.values(defaults.crew)) for (const frames of Object.values(group.tracks)) for (const relative of frames) writeResource(frontend, relative, png(144, 144));
  assert.throws(() => loadThemePack({ pack: 'missing' }, frontend), /Unknown or uninstalled/);
  assert.throws(() => loadThemePack({ pack: '../bad' }, frontend), /Invalid theme.pack/);
  const directory = install('sample', custom({ ui: { colors: { ink: '#123456' } } }));
  assert.equal(loadThemePack({ pack: 'sample' }, frontend).ui.colors.ink, '#123456');
  assert.deepEqual(validateInstalledPacks(frontend), ['sample', 'starnet']);
  const fallback = value => {
    install('sample', value);
    const result = loadThemePack({ pack: 'sample', colors: { accent: '#abcdef' } }, frontend);
    assert.equal(result.requestedId, 'sample'); assert.equal(result.effectiveId, 'starnet');
    assert.equal(result.ui.colors.glow, 'rgba(171,205,239,.22)');
    assert.equal(result.warnings.length, 1); assert.equal(result.warnings[0].code, 'theme-pack-invalid');
    assert.ok(!JSON.stringify(result.warnings).includes(temporary), 'warnings never expose private paths');
    assert.throws(() => validateInstalledPacks(frontend));
    return result;
  };
  fallback(custom({ ui: { colors: { unknown: '#123456' } } }));
  fallback(custom({ id: 'other' }));
  fs.writeFileSync(path.join(directory, 'theme.json'), '{private malformed data');
  assert.equal(loadThemePack({ pack: 'sample' }, frontend).warnings[0].reason, 'manifest-json');
  fs.writeFileSync(path.join(directory, 'theme.json'), ' '.repeat(65537));
  assert.equal(loadThemePack({ pack: 'sample' }, frontend).warnings[0].reason, 'resource-size');
  const tracks = {};
  for (const direction of ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']) {
    tracks['rot.' + direction] = ['crew/standing.png'];
    tracks['walk.' + direction] = Array(6).fill('crew/standing.png');
  }
  for (const direction of ['south', 'east', 'north', 'west']) tracks['sit.' + direction] = ['crew/standing.png'];
  tracks['type.north'] = Array(4).fill('crew/standing.png');
  const crewPack = custom({ crew: { blank: { tracks } } });
  writeResource(directory, 'crew/standing.png', png(144, 144)); install('sample', crewPack);
  const replacement = loadThemePack({ pack: 'sample' }, frontend);
  assert.equal(replacement.crew.blank.set, 'sample_blank');
  assert.equal(replacement.crew.blank.scale, .25); assert.equal(replacement.crew.blank.sourceStandingHeight, 76);
  assert.equal(replacement.crew.blank.presentation, 'review');
  assert.equal(replacement.crew.blank.tracks['rot.south'][0], '/assets/themes/sample/crew/standing.png');
  assert.equal(replacement.crew.blank_blue.set, 'approved_blank_blue');
  for (const relative of ['crew/../standing.png', 'crew/%2e%2e/standing.png', 'crew/a\\b.png', '/crew/standing.png', 'crew/standing.png?x', 'other/standing.png']) {
    const damaged = clone(crewPack); damaged.crew.blank.tracks['rot.south'][0] = relative; fallback(damaged);
  }
  const incomplete = clone(crewPack); incomplete.crew.blank.tracks['walk.south'].pop(); fallback(incomplete);
  const authoredGeometry = clone(crewPack); authoredGeometry.crew.blank.scale = 1; fallback(authoredGeometry);
  writeResource(directory, 'crew/standing.png', png(143, 144)); fallback(crewPack);
  writeResource(directory, 'crew/standing.png', png(144, 144, 131073)); fallback(crewPack);
  const external = path.join(temporary, 'outside.png'); fs.writeFileSync(external, png(144, 144));
  fs.rmSync(path.join(directory, 'crew/standing.png')); fs.symlinkSync(external, path.join(directory, 'crew/standing.png'));
  assert.equal(fallback(crewPack).warnings[0].reason, 'asset-containment');
  fs.rmSync(path.join(directory, 'crew/standing.png')); writeResource(directory, 'crew/standing.png', png(144, 144));
  // A complete office pack uses fixed native role dimensions; role omissions fail atomically.
  const assets = Object.fromEntries(Object.keys(SCENE_ART_ROLES).map(role => [role, 'scene/' + role.toLowerCase() + '.png']));
  const office = custom({ scene: { art: { style: 'home-office', assets }, backgroundFx: 'none', ambientFx: 'none' } });
  for (const [role, relative] of Object.entries(assets)) writeResource(directory, relative, png(SCENE_ART_ROLES[role].source.width, SCENE_ART_ROLES[role].source.height));
  install('sample', office);
  assert.equal(loadThemePack({ pack: 'sample' }, frontend).scene.art.style, 'home-office');
  const missingChair = clone(office); delete missingChair.scene.art.assets.helperChair; fallback(missingChair);
  const badFx = clone(office); badFx.scene.backgroundFx = 'rain'; fallback(badFx);
  writeResource(directory, assets.helperChair, png(30, 37)); fallback(office);
  writeResource(directory, assets.helperChair, png(22, 27, 262145)); fallback(office);
  writeResource(directory, assets.helperChair, png(22, 27));
  writeResource(directory, assets.floor, Buffer.alloc(33)); assert.equal(fallback(office).warnings[0].reason, 'png-header');
  writeResource(directory, assets.floor, png(48, 24));
  for (const [role, relative] of Object.entries(assets)) writeResource(directory, relative, png(SCENE_ART_ROLES[role].source.width, SCENE_ART_ROLES[role].source.height, 190000));
  assert.equal(fallback(office).warnings[0].reason, 'scene-budget');
  for (const [role, relative] of Object.entries(assets)) writeResource(directory, relative, png(SCENE_ART_ROLES[role].source.width, SCENE_ART_ROLES[role].source.height));
  // Distinct crew paths enforce the per-pack byte budget despite valid headers/dimensions.
  const large = clone(crewPack); let index = 0;
  for (const frames of Object.values(large.crew.blank.tracks)) for (let i = 0; i < frames.length; i++) {
    frames[i] = 'crew/frame-' + index++ + '.png'; writeResource(directory, frames[i], png(144, 144, 70000));
  }
  assert.equal(fallback(large).warnings[0].reason, 'crew-budget');
  const logo = custom({ ui: { logo: { image: 'branding/logo.png', alt: 'Example Brand' } } });
  writeResource(directory, 'branding/logo.png', png(224, 48)); install('sample', logo);
  assert.equal(loadThemePack({ pack: 'sample' }, frontend).ui.logo.image, '/assets/themes/sample/branding/logo.png');
  writeResource(directory, 'branding/logo.png', png(1025, 48)); fallback(logo);
  writeResource(directory, 'branding/logo.png', png(224, 48, 131073)); fallback(logo);
  const font = custom({ ui: { typography: { profile: 'dm-sans' } } });
  const fontHeader = Buffer.alloc(48); fontHeader.write('wOF2'); fontHeader.writeUInt32BE(48, 8);
  writeResource(directory, 'fonts/dm-sans.woff2', fontHeader);
  writeResource(directory, 'fonts/DM-Sans-OFL.txt', Buffer.from('SIL OPEN FONT LICENSE Version 1.1'));
  install('sample', font);
  assert.equal(loadThemePack({ pack: 'sample' }, frontend).ui.typography.font, '/assets/themes/sample/fonts/dm-sans.woff2');
  writeResource(directory, 'fonts/dm-sans.woff2', Buffer.alloc(524289)); fallback(font);
  fs.rmSync(path.join(directory, 'fonts/dm-sans.woff2')); fallback(font);
  install('sample', custom({}));
  fs.symlinkSync(directory, path.join(frontend, 'assets/themes/linked'));
  assert.deepEqual(validateInstalledPacks(frontend), ['sample', 'starnet'], 'author discovery does not follow directory links');
  assert.equal(loadThemePack({ pack: 'linked' }, frontend).effectiveId, 'starnet');
  const invalidDirectory = path.join(frontend, 'assets/themes/Bad'); fs.mkdirSync(invalidDirectory);
  assert.throws(() => validateInstalledPacks(frontend), /pack-directory/); fs.rmSync(invalidDirectory, { recursive: true });
  for (let i = 0; i < 15; i++) install('extra-' + i, { version: 1, id: 'extra-' + i, extends: 'starnet' });
  assert.throws(() => validateInstalledPacks(frontend), /pack-count/);
  for (let i = 0; i < 15; i++) fs.rmSync(path.join(frontend, 'assets/themes/extra-' + i), { recursive: true });
  const validator = path.resolve(__dirname, '../scripts/validate-theme-packs.mjs');
  const valid = spawnSync(process.execPath, [validator, frontend], { encoding: 'utf8' }); assert.equal(valid.status, 0, valid.stderr);
  const brokenDefault = clone(defaults); brokenDefault.ui.typography.scale = 9; install('starnet', brokenDefault);
  assert.throws(() => loadThemePack({ pack: 'sample' }, frontend), /typography-scale/, 'invalid default fails startup instead of fallback');
  const invalid = spawnSync(process.execPath, [validator, frontend], { encoding: 'utf8' }); assert.equal(invalid.status, 1);
  assert.ok(!invalid.stderr.includes(temporary));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log('theme packs: inventory, inheritance, schema, native roles, bounded IO, containment, crew/logo/font/office resources, fallback and author validation passed');
