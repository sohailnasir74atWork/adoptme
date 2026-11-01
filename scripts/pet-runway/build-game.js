#!/usr/bin/env node
/**
 * Pack the Pet Runway game (Code/PetRunway/game/) into Code/PetRunway/runwayGameHtml.js, the string
 * the app hands to react-native-webview (source={{ html }}). The game ships inside the app bundle:
 * no download and no remote code. Fonts are bundled (Latin woff2); pet art comes from the Pet Cards CDN.
 *
 *   npm run runway:build        (after every edit in Code/PetRunway/game/, or after anchors.py)
 *
 * Also writes Code/PetRunway/runwayKeys.js (every text key the game reads, so the app can send the
 * player's language) and scripts/pet-runway/strings.en.json (the English text for those keys).
 * __tests__/petRunway.test.js fails when any of these drift apart.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'Code/PetRunway/game');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const JS_FILES = ['i18n.js', 'items.js', 'world.js', 'engine.js', 'studio.js', 'magic.js'];

// Fonts: key -> [CSS family, file]. The keys match FONTS in world.js.
const FONT_FILES = { lilita: ['Lilita One', 'lilita'], pacifico: ['Pacifico', 'pacifico'], cherry: ['Cherry Bomb One', 'cherry'], creep: ['Creepster', 'creep'], bungee: ['Bungee', 'bungee'], chewy: ['Chewy', 'chewy'] };
const b64 = (f) => fs.readFileSync(path.join(dir, 'fonts', f + '.woff2')).toString('base64');
const fontData = {};
let fontCss = `@font-face{font-family:"Nunito";font-weight:600 900;src:url(data:font/woff2;base64,${b64('nunito')}) format("woff2")}`;
for (const [key, [family, file]] of Object.entries(FONT_FILES)) {
  const data = `data:font/woff2;base64,${b64(file)}`;
  fontData[key] = { family, data };
  fontCss += `@font-face{font-family:"${family}";src:url(${data}) format("woff2")}`;
}

function build() {
const anchors = JSON.parse(read('anchors.json'));
const js = JS_FILES.map((f) => `// ---- ${f} ----\n${read(f)}`).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"><title>Pet Runway</title><style>${fontCss}</style><style>${read('page.css')}</style></head><body>${read('page.html')}<script>
const ANCHORS = ${JSON.stringify(anchors)};
const FONT_DATA = ${JSON.stringify(fontData)};
${js}
</script></body></html>`;

// ---------- text keys ----------
const en = {};
const add = (k, v) => { if (k && v != null && en[k] === undefined) en[k] = String(v); };
// T('key', 'Default') and Tf('key', 'Default', …) with a literal key, in the scripts.
for (const m of js.matchAll(/\b(?:Tf?|lbl|fine)\(\s*'([a-z0-9_]+)'\s*,\s*'((?:[^'\\]|\\.)*)'/g)) add(m[1], m[2].replace(/\\'/g, "'"));
// data-t / data-ta in the page: the text inside the element (or its aria-label) is the English.
for (const m of read('page.html').matchAll(/data-t="([a-z0-9_]+)"[^>]*>([^<]*)</g)) add(m[1], m[2].trim());
for (const m of read('page.html').matchAll(/data-ta="([a-z0-9_]+)"[^>]*aria-label="([^"]*)"/g)) add(m[1], m[2]);
// Names that come from the game's data tables.
const ctx = { window: {}, INIT: {}, Math, JSON, Object, Array, String, Number, parseInt, Date };
ctx.T = (k, d) => d; ctx.Tf = (k, d) => d; ctx.esc = (s) => s; ctx.FALLBACK_FONT = 'sans-serif';
vm.createContext(ctx);
vm.runInContext(`${read('items.js')}\n${read('world.js')}\nthis.D = { ITEMS, CATS, SCENES, PATTERNS, FILLS, FRAMES, FX, FONTS, ADJ, NOUN, BANNERS, GLOWS, PET_LOOKS, THEMES, WORDS, TAG_NAMES, STAMP_STYLES };`, ctx);
const listOf = (file, name) => vm.runInNewContext(read(file).match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`))[1]);
const D = ctx.D;
D.ITEMS.filter((i) => i.cat !== 'words').forEach((i) => add('item_' + i.id, i.name));
D.WORDS.forEach(([w], i) => add('word_' + i, w));
[...D.CATS, ['photos', 'My pictures']].forEach(([k, n]) => add('cat_' + k, n));
Object.entries(D.SCENES).forEach(([k, s]) => add('scene_' + k, s.name));
Object.entries(D.PATTERNS).forEach(([k, s]) => add('pat_' + k, s.name));
Object.entries(D.FRAMES).forEach(([k, s]) => add('frame_' + k, s.name));
Object.entries(D.FX).forEach(([k, s]) => add('fx_' + k, s.name));
D.FILLS.forEach(([k, n]) => add('fill_' + k, n));
D.GLOWS.forEach(([k, n]) => add('glow_' + k, n));
D.BANNERS.forEach(([k, n]) => add('banner_' + k, n));
D.FONTS.forEach(([k, , n]) => add('font_' + k, n));
D.PET_LOOKS.forEach(([n], i) => add('look_' + i, n));
D.ADJ.filter(Boolean).forEach((w) => add('adj_' + w, w));
D.NOUN.forEach((w) => add('noun_' + w, w));
D.THEMES.forEach((t) => add('theme_' + t.id, t.name));
Object.entries(D.TAG_NAMES).forEach(([k, n]) => add('tag_' + k, n));
listOf('studio.js', 'TABS').forEach(([k, n]) => add('tab_' + k, n));
listOf('studio.js', 'BRUSHES').forEach(([k, n]) => add('brush_' + k, n));
listOf('studio.js', 'SHAPES').forEach(([k, n]) => add('shape_' + k, n));
listOf('magic.js', 'MOVES').forEach(([k, n]) => add('move_' + k, n));
[['vertical', 'Top to bottom'], ['diagonal', 'Diagonal'], ['radial', 'Spotlight']].forEach(([k, n]) => add('style_' + k, n));

const keys = Object.keys(en).sort();
// What the Events screen (React Native) offers: library themes, scenes, items and stamp styles.
const catalog = {
  themes: D.THEMES.map((t) => ({ id: t.id, tags: t.tags })),
  scenes: Object.keys(D.SCENES).filter((k) => k !== 'custom'),
  items: D.ITEMS.filter((i) => i.cat !== 'words').map((i) => ({ id: i.id, cat: i.cat })),
  stamps: Object.keys(D.STAMP_STYLES),
  banners: ['#FF4F9A', '#B58CFF', '#6EC6FF', '#5FD3B0', '#FFC94A', '#FF9A3C', '#E0245E', '#3F7BE0'],
};
return { html, keys, en, catalog };
}

module.exports = { build };
if (require.main === module) {
const { html, keys, en, catalog } = build();
fs.writeFileSync(path.join(root, 'Code/PetRunway/runwayGameHtml.js'), `// GENERATED by scripts/pet-runway/build-game.js from Code/PetRunway/game/. Do not edit.\nexport default ${JSON.stringify(html)};\n`);
fs.writeFileSync(path.join(root, 'Code/PetRunway/runwayKeys.js'), `// GENERATED by scripts/pet-runway/build-game.js: every text key the game reads (Code/Translation/*.json → "pet_runway"). Do not edit.\nexport const RUNWAY_KEYS = ${JSON.stringify(keys)};\n`);
fs.writeFileSync(path.join(root, 'Code/PetRunway/runwayCatalog.js'), `// GENERATED by scripts/pet-runway/build-game.js: what MODs can pick for an event. Do not edit.\nexport const RUNWAY_CATALOG = ${JSON.stringify(catalog)};\n`);
fs.writeFileSync(path.join(__dirname, 'strings.en.json'), JSON.stringify(Object.fromEntries(keys.map((k) => [k, en[k]])), null, 2) + '\n');
console.log(`runwayGameHtml.js written (${(html.length / 1024).toFixed(1)} KB), ${keys.length} text keys`);
}
