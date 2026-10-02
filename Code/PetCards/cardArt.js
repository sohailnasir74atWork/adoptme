/**
 * cardArt.js — which art exists, and painted fallbacks for everything else.
 *
 * The painted art (PET_CARDS_ART_PROMPTS.md) is uploaded to the CDN over time.
 * The app asks for a file only when the CDN manifest lists it, so a missing
 * picture costs no request; until it arrives, each background is painted
 * with layered gradients (RN 0.87 `backgroundImage`), sharp at any size.
 */

import { cdnBase } from './cardConfig';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'pet_cards_art' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}

const MANIFEST_TTL_MS = 6 * 60 * 60 * 1000;
let petKeys = null;     // Set of card keys with HD art
let assetIds = null;    // Set of art ids (BG-…, P-…, CB-…)
let pet2k = null;       // Set of card keys with 2048 px wallpaper art
let loading = null;

// A manifest is a list of ids. Anything else (an error page, another file
// served on a catch-all path) is rejected rather than trusted.
const isIdList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

const readCache = (k) => {
  try {
    const raw = storage.getString(k);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && isIdList(v.list) ? v : null;
  } catch (e) {
    return null;
  }
};

// The CDN (and the phone's HTTP cache) keep files for 30 days. Pictures never
// change, so that's right for them; the id lists DO change, so they are asked
// for with a stamp that rolls over every 6 hours (a fresh copy at most 4x a day).
const listStamp = () => Math.floor(Date.now() / MANIFEST_TTL_MS);

const fetchList = async (url) => {
  const r = await fetch(`${url}?v=${listStamp()}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length'));
  if (len > 200000) throw new Error('not a manifest');
  const list = await r.json();
  if (!isIdList(list)) throw new Error('not a manifest');
  return list;
};

/** Load the CDN manifests (cached 6 h). Safe to call often. */
export const loadArtManifest = async () => {
  if (loading) return loading;
  const cachedPets = readCache('pets');
  const cachedAssets = readCache('assets');
  const cached2k = readCache('pets2k');
  if (cachedPets) petKeys = new Set(cachedPets.list);
  if (cachedAssets) assetIds = new Set(cachedAssets.list);
  if (cached2k) pet2k = new Set(cached2k.list);
  const fresh = (c) => c && Date.now() - c.at < MANIFEST_TTL_MS;
  if (fresh(cachedPets) && fresh(cachedAssets) && fresh(cached2k)) return null;
  loading = Promise.all([
    fetchList(`${cdnBase()}/pets/index.json`).then((list) => {
      petKeys = new Set(list);
      storage.set('pets', JSON.stringify({ at: Date.now(), list }));
    }).catch(() => {}),
    fetchList(`${cdnBase()}/index.json`).then((list) => {
      assetIds = new Set(list);
      storage.set('assets', JSON.stringify({ at: Date.now(), list }));
    }).catch(() => {}),
    fetchList(`${cdnBase()}/pets/2k/index.json`).then((list) => {
      pet2k = new Set(list);
      storage.set('pets2k', JSON.stringify({ at: Date.now(), list }));
    }).catch(() => {}),
  ]).finally(() => { loading = null; });
  return loading;
};

/** True when the HD pet art is on the CDN (unknown manifest → assume yes: the server only deals HD cards). */
export const hasPetArt = (key) => (petKeys ? petKeys.has(key) : true);
/** True when the 2048 px wallpaper art exists (otherwise wallpapers use the 1024). */
export const hasPetArt2k = (key) => !!pet2k && pet2k.has(key);
/** True when a painted asset (e.g. 'BG-HAUNTED-MIDWAY') has been uploaded. */
export const hasAsset = (id) => !!assetIds && assetIds.has(id);
export const assetUri = (id) => (hasAsset(id) ? `${cdnBase()}/${id}.webp` : null);

// ── Painted fallbacks ──────────────────────────────────────────────────────
// Each is a CSS background-image list: sky + light + ground. Designed to read
// as the same place as the AI painting that will replace it.
const sun = (x, y, c = '255,240,190') =>
  `radial-gradient(circle at ${x}% ${y}%, rgba(${c},0.95) 0%, rgba(${c},0.45) 7%, rgba(${c},0) 24%)`;
const ground = (c1, c2, y = 104) =>
  `radial-gradient(ellipse 140% 42% at 50% ${y}%, ${c1} 0%, ${c2} 55%, rgba(0,0,0,0) 72%)`;
const sky = (...stops) => `linear-gradient(180deg, ${stops.join(', ')})`;
const glow = (x, y, rgb, a = 0.5, r = 30) =>
  `radial-gradient(circle at ${x}% ${y}%, rgba(${rgb},${a}) 0%, rgba(${rgb},0) ${r}%)`;

export const BG_PAINT = {
  island_meadow: [sun(74, 22), ground('#3FAE5F', '#6CCB7C'), sky('#4DAEF0 0%', '#9AD7FF 40%', '#FFE6B5 60%', '#9FDB98 61%', '#5FBF73 100%')],
  island_beach: [sun(68, 18, '255,250,215'), ground('#F5DDA8', '#FBE9C4', 106), sky('#2FA8F0 0%', '#8EDCFF 42%', '#5FE0D8 55%', '#2BC4C4 60%', '#F3D9A2 64%', '#F8E6BE 100%')],
  island_sky: [sun(30, 20, '255,255,235'), glow(70, 60, '255,255,255', 0.7, 35), glow(20, 75, '255,255,255', 0.6, 30), sky('#5AA9F5 0%', '#A8D8FF 45%', '#FFE2F1 75%', '#FFF6E0 100%')],
  island_night: [glow(78, 18, '235,240,255', 0.9, 8), glow(30, 30, '160,130,255', 0.25, 45), ground('#173A3A', '#0F2A33'), sky('#060B22 0%', '#13204A 45%', '#2A2F6B 62%', '#0E2B33 63%', '#0A1F26 100%')],
  island_snow: [sun(70, 30, '255,220,200'), ground('#FFFFFF', '#E3EEFA'), sky('#3A4F8C 0%', '#9AA8D9 35%', '#F6C9C2 58%', '#F2F6FC 61%', '#E5EEF9 100%')],
  island_festival: [glow(20, 20, '255,90,60', 0.45), glow(80, 15, '255,200,60', 0.45), glow(50, 40, '255,140,0', 0.3, 40), ground('#6B1F2A', '#4A1420'), sky('#160A2E 0%', '#4A1747 40%', '#B5354B 60%', '#5A1A26 62%', '#3A0F1A 100%')],

  egg_farm: [sun(25, 24, '255,225,160'), ground('#D9A441', '#E9C46A'), sky('#8FC8F5 0%', '#FCE1B5 50%', '#F9C784 60%', '#C7A453 61%', '#B08A3E 100%')],
  egg_safari: [sun(50, 52, '255,170,70'), ground('#C9873A', '#E0A955'), sky('#5A2A6E 0%', '#D9542F 38%', '#FF9A3C 55%', '#E3A64E 61%', '#C98B3D 100%')],
  egg_jungle: [glow(50, 10, '230,255,170', 0.55, 40), ground('#1F6B3A', '#2E8B4B'), sky('#0F4A33 0%', '#2E8B57 35%', '#8BD17C 55%', '#2C7A43 61%', '#1A5A31 100%')],
  egg_aussie: [sun(72, 26, '255,230,180'), ground('#B4532A', '#C96A3A'), sky('#2E77D0 0%', '#7CC0F0 40%', '#F7C99B 58%', '#C0603A 61%', '#9C4423 100%')],
  egg_fossil: [glow(60, 30, '255,190,110', 0.55, 40), ground('#A86A33', '#C4884A'), sky('#5C3A1E 0%', '#B9763A 35%', '#F0B66B 55%', '#9C6233 61%', '#7A4A24 100%')],
  egg_ocean: [glow(50, -5, '220,255,255', 0.8, 40), ground('#E8D7A8', '#C9B98C', 108), sky('#7FE3F0 0%', '#25B5D6 25%', '#0E7FB8 55%', '#0A4F8A 85%', '#08386A 100%')],
  egg_mythic: [sun(50, 30, '255,245,210'), glow(20, 60, '255,255,255', 0.6), glow(80, 65, '255,255,255', 0.6), sky('#B9A3F0 0%', '#F3D9A6 45%', '#FFF3DA 70%', '#FFFFFF 100%')],
  egg_japan: [glow(25, 30, '255,190,220', 0.6, 35), glow(78, 25, '255,190,220', 0.5, 30), ground('#6FA77E', '#8EC59A'), sky('#9FD3E8 0%', '#FBE3EC 48%', '#FFD1E1 60%', '#7FB28C 61%', '#5E9670 100%')],
  egg_danger: [glow(70, 62, '255,90,20', 0.65, 35), glow(25, 70, '255,60,0', 0.45, 30), ground('#2A1A1A', '#3A2020'), sky('#1A0F14 0%', '#4A1A1A 35%', '#B53A12 58%', '#2B1515 62%', '#1A0E0E 100%')],
  egg_woodland: [glow(55, 15, '240,255,200', 0.6, 40), ground('#4C7A3A', '#6A9A4C'), sky('#264D2E 0%', '#4F8A4A 35%', '#B9D88F 55%', '#55803F 61%', '#3B6230 100%')],
  egg_moon: [glow(72, 28, '120,200,255', 0.7, 14), glow(30, 25, '200,160,255', 0.3, 40), ground('#C9CED8', '#9AA1AE'), sky('#05060F 0%', '#0E1330 45%', '#2B2F4F 62%', '#B8BECA 63%', '#8A92A0 100%')],
  egg_desert: [sun(30, 40, '255,200,150'), ground('#E2B36E', '#F0C98A'), sky('#3B2A6B 0%', '#B56AA8 35%', '#F5A97F 55%', '#E8B877 61%', '#D9A35E 100%')],
  egg_urban: [glow(50, 55, '255,170,120', 0.6, 40), ground('#3A3F55', '#4C526B'), sky('#2A1F4F 0%', '#7A3E7A 35%', '#F08A5D 56%', '#3D4259 62%', '#2B2F40 100%')],
  egg_endangered: [glow(50, 20, '255,245,200', 0.6, 40), ground('#3F7F55', '#5A9F6E'), sky('#7FB7A9 0%', '#CDE7D8 45%', '#F3EBC9 58%', '#5C9A6B 61%', '#3F7A52 100%')],
  egg_fairytale: [glow(70, 25, '255,210,255', 0.6, 35), glow(25, 60, '190,160,255', 0.4, 35), ground('#9C7FD1', '#B79BE3'), sky('#6F5BB8 0%', '#C8A7E8 40%', '#F9D2E5 58%', '#A88CD8 61%', '#8A70C2 100%')],
  egg_aztec: [sun(60, 28, '255,230,160'), ground('#2F7A5A', '#3E9470'), sky('#2A8C83 0%', '#7FCBB5 38%', '#F2D49A 56%', '#3B8C67 61%', '#2A6B4E 100%')],
  egg_southeast_asia: [glow(30, 35, '255,200,90', 0.55, 30), glow(75, 30, '255,170,60', 0.45, 25), ground('#1F5C66', '#2A7480'), sky('#1C2A5E 0%', '#6A4B8C 35%', '#F0A35E 56%', '#2C6C78 61%', '#1B4D57 100%')],
  egg_garden: [sun(78, 20, '255,245,200'), ground('#5DAA4E', '#7CC46A'), sky('#8CCBF2 0%', '#D9F0FF 40%', '#FFE9C9 56%', '#7DC36D 61%', '#56A04A 100%')],

  haunted_midway: [glow(76, 20, '255,240,210', 0.95, 11), glow(50, 58, '255,122,26', 0.35, 45), ground('#2A1747', '#3B1E5E'), sky('#07040F 0%', '#1C0F33 40%', '#4A2470 60%', '#2A1747 62%', '#1A0E2E 100%')],
  haunted_manor: [glow(70, 22, '255,245,220', 0.9, 12), glow(35, 45, '255,150,40', 0.35, 20), ground('#1E1430', '#2B1B45'), sky('#0A0A1F 0%', '#1E1B4B 40%', '#3E2A6B 60%', '#1E1430 62%', '#120C20 100%')],
  haunted_patch: [glow(25, 18, '255,245,220', 0.9, 10), glow(50, 75, '255,122,26', 0.4, 45), ground('#3A2410', '#4A2F14'), sky('#0B0618 0%', '#2A1450 45%', '#6B2E8C 60%', '#3A2410 62%', '#24160A 100%')],
  haunted_hotel: [glow(50, 12, '255,210,140', 0.8, 25), glow(20, 50, '255,170,80', 0.3, 30), ground('#4A1D3F', '#5E2550'), sky('#1A0B1F 0%', '#3B1438 40%', '#5E2550 61%', '#3A1030 62%', '#260A20 100%')],
  haunted_graveyard: [glow(68, 20, '200,255,230', 0.75, 12), glow(40, 60, '120,255,200', 0.2, 40), ground('#14302A', '#1C3F36'), sky('#040D12 0%', '#0E2A33 45%', '#1F4F4F 61%', '#14302A 62%', '#0B1F1A 100%')],
  haunted_swamp: [glow(50, 70, '140,255,58', 0.45, 40), glow(75, 20, '230,255,220', 0.7, 10), ground('#16301E', '#1F4529'), sky('#070F0A 0%', '#122B2A 45%', '#2E3F5E 60%', '#16301E 62%', '#0C1F12 100%')],
};

/** CSS background for a bg id (falls back to the meadow). */
export const paintFor = (bgId) => (BG_PAINT[bgId] || BG_PAINT.island_meadow).join(', ');
export const bgAssetId = (bgId) => `BG-${String(bgId).toUpperCase().replace(/_/g, '-')}`;
