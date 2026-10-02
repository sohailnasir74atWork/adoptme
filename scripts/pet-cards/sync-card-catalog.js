// Fill / refresh Supabase card_catalog (supabase/037_pet_cards.sql) from:
//   * the live values catalogue (adoptme.b-cdn.net): every pet, its rarity;
//   * scripts/pet-cards/sets.json (fetch-wiki-sets.py): sets, egg, background hint;
//   * the HD art manifest: which pets have their 1024 px art on the CDN.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/pet-cards/sync-card-catalog.js           # dry run
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/pet-cards/sync-card-catalog.js --apply   # write
//
//   --hd <file|url>   HD manifest (JSON array of card keys). Default: the CDN
//                     manifest written by hd-art/upload.py.
//
// Collector numbers never change: existing cards keep theirs, new pets are
// appended (commons first, legendaries last, A-Z inside a rarity). Pets that
// leave the catalogue are marked inactive, never deleted (players own them).

const path = require('path');
const fs = require('fs');

const FUNCTIONS_NM = path.join(__dirname, '..', '..', 'functions', 'node_modules');
const { createClient } = require(path.join(FUNCTIONS_NM, '@supabase', 'supabase-js'));

const APPLY = process.argv.includes('--apply');
const argAt = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const CATALOG_URL = 'https://adoptme.b-cdn.net';
const HD_SOURCE = argAt('--hd') || process.env.PET_CARDS_HD_MANIFEST || 'https://cardspull.b-cdn.net/v1/pets/index.json';
const RARITY = { common: 'common', uncommon: 'uncommon', rare: 'rare', 'ultra rare': 'ultra', 'ultra-rare': 'ultra', legendary: 'legendary' };
const RARITY_ORDER = ['common', 'uncommon', 'rare', 'ultra', 'legendary'];

// Same as normalizeName() in Code/Helper/valueSources.js.
const cardKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const loadJson = async (src) => {
  if (/^https?:\/\//.test(src)) {
    // Bypass the CDN's 30-day cache: the HD list changes with every upload.
    const r = await fetch(`${src}${src.includes('?') ? '&' : '?'}v=${Date.now()}`);
    if (!r.ok) throw new Error(`${src}: HTTP ${r.status}`);
    return r.json();
  }
  return JSON.parse(fs.readFileSync(src, 'utf8'));
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const catalog = await loadJson(CATALOG_URL);
  const wiki = JSON.parse(fs.readFileSync(path.join(__dirname, 'sets.json'), 'utf8'));
  let hd = [];
  try {
    hd = await loadJson(HD_SOURCE);
  } catch (e) {
    console.warn(`HD manifest not readable (${e.message}); every card stays hd_ready=false`);
  }
  if (!Array.isArray(hd) || !hd.every((k) => typeof k === 'string')) {
    console.warn('HD manifest is not a list of keys; every card stays hd_ready=false');
    hd = [];
  }
  const hdSet = new Set(hd);

  const setsOf = new Map();
  for (const [setId, keys] of Object.entries(wiki.sets)) {
    for (const k of keys) {
      if (!setsOf.has(k)) setsOf.set(k, []);
      setsOf.get(k).push(setId);
    }
  }

  const pets = [];
  const seen = new Set();
  for (const p of catalog) {
    if (!p || p.type !== 'pets' || p.hidden) continue;
    const k = cardKey(p.name);
    const rarity = RARITY[String(p.rarity || '').toLowerCase()];
    if (!k || seen.has(k)) continue;
    if (!rarity) {
      console.warn(`skip ${p.name}: unknown rarity "${p.rarity}"`);
      continue;
    }
    seen.add(k);
    pets.push({ key: k, name: String(p.name).slice(0, 80), rarity });
  }

  const { data: existing, error } = await sb.from('card_catalog').select('key, no, active');
  if (error) throw error;
  const numberOf = new Map(existing.map((r) => [r.key, r.no]));
  let nextNo = existing.reduce((m, r) => Math.max(m, r.no), 0) + 1;

  const fresh = pets.filter((p) => !numberOf.has(p.key))
    .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.name.localeCompare(b.name));
  for (const p of fresh) numberOf.set(p.key, nextNo++);

  const now = new Date().toISOString();
  const rows = pets.map((p) => ({
    key: p.key,
    name: p.name,
    rarity: p.rarity,
    no: numberOf.get(p.key),
    egg: wiki.egg[p.key] || null,
    sets: (setsOf.get(p.key) || []).sort(),
    bg: wiki.bg[p.key] || null,
    hd_ready: hdSet.has(p.key),
    active: true,
    updated_at: now,
  }));
  const gone = existing.filter((r) => r.active && !seen.has(r.key)).map((r) => r.key);

  const bySet = {};
  rows.forEach((r) => r.sets.forEach((s) => { bySet[s] = (bySet[s] || 0) + 1; }));
  console.log(`${rows.length} pets: ${fresh.length} new, ${rows.length - fresh.length} existing; ${gone.length} leaving`);
  console.log(`HD ready: ${rows.filter((r) => r.hd_ready).length}/${rows.length}`);
  console.log('per set:', bySet);
  if (!APPLY) {
    console.log('dry run: add --apply to write');
    return;
  }

  for (let i = 0; i < rows.length; i += 200) {
    const { error: e } = await sb.from('card_catalog').upsert(rows.slice(i, i + 200), { onConflict: 'key' });
    if (e) throw e;
  }
  if (gone.length) {
    const { error: e } = await sb.from('card_catalog').update({ active: false, updated_at: now }).in('key', gone);
    if (e) throw e;
  }
  console.log('written.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
