/**
 * cardMath.js — pure helpers for Pet Cards (tested in __tests__/petCards.test.js).
 * No React, no network.
 */

import { FINISHES, RARITIES, FUSE_NEXT, FUSE_COPIES } from './cardConfig';

/** 675 → "675", 2430 → "2.4K", 9100000 → "9.1M", 3.25 → "3.25". */
export const formatCompact = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const trim = (x) => String(parseFloat(x.toFixed(1)));
  if (a >= 1e6) return `${trim(v / 1e6)}M`;
  if (a >= 1e4) return `${Math.round(v / 1e3)}K`;
  if (a >= 1e3) return `${trim(v / 1e3)}K`;
  if (a >= 100) return String(Math.round(v));
  if (a >= 10) return trim(v);
  return String(parseFloat(v.toFixed(2)));
};

const normalizeName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Card catalogue rows from card_catalog_list() → objects. */
export const parseCatalog = (rows) => (Array.isArray(rows) ? rows : [])
  .filter((r) => Array.isArray(r) && r[0])
  .map(([key, name, rarity, no, egg, sets, bg]) => ({
    key, name, rarity, no, egg: egg || null, sets: Array.isArray(sets) ? sets : [], bg: bg || null,
  }));

/** Values feed (Elvebredd rows) → Map(cardKey → { r, n, m }). */
export const buildValueIndex = (rows) => {
  const map = new Map();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (!row || row.type !== 'pets') continue;
    const k = normalizeName(row.name);
    if (!k || map.has(k)) continue;
    const num = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null);
    map.set(k, { r: num(row.rvalue), n: num(row.nvalue), m: num(row.mvalue) });
  }
  return map;
};

export const inSet = (card, setId) => setId === 'all' || (card.sets || []).includes(setId);

export const cardsInSet = (catalog, setId) => catalog.filter((c) => inSet(c, setId));

/** owned = { key: [[finish, count, serial], …] } (get_card_collection). */
export const setProgress = (catalog, owned, setId) => {
  const cards = cardsInSet(catalog, setId);
  const have = cards.filter((c) => owned && owned[c.key] && owned[c.key].length).length;
  return { have, total: cards.length, done: cards.length > 0 && have >= cards.length };
};

/** The fanciest finish a player owns of one card: { finish, count, serial } or null. */
export const bestOwned = (entries) => {
  if (!Array.isArray(entries) || !entries.length) return null;
  let best = null;
  for (const [finish, count, serial] of entries) {
    const rank = FINISHES.indexOf(finish);
    if (!best || rank > FINISHES.indexOf(best.finish)) best = { finish, count, serial: serial ?? null };
  }
  return best;
};

export const totalCopies = (entries) => (Array.isArray(entries) ? entries.reduce((s, e) => s + (e[1] || 0), 0) : 0);

/** Sort for the album: collector number. */
export const byNumber = (a, b) => a.no - b.no;

/** Rarity rank (0 = common … 4 = legendary). */
export const rarityRank = (r) => RARITIES.indexOf(r);

/** The pull to brag about in a pack: rarest finish, then rarest pet, then new. */
export const bestPull = (cards) => {
  if (!Array.isArray(cards) || !cards.length) return null;
  return [...cards].sort((a, b) =>
    FINISHES.indexOf(b.finish) - FINISHES.indexOf(a.finish)
    || rarityRank(b.rarity) - rarityRank(a.rarity)
    || (b.new ? 1 : 0) - (a.new ? 1 : 0))[0];
};

/** How dramatic the reveal is: 0 plain, 1 rare glow, 2 legendary burst, 3 mega/full-art. */
export const revealTier = (card) => {
  if (!card) return 0;
  if (card.finish === 'mega' || card.finish === 'fullart') return 3;
  if (card.rarity === 'legendary' || card.finish === 'gilded') return 2;
  if (card.rarity === 'ultra' || card.finish === 'holo' || card.finish === 'neon') return 1;
  return 0;
};

/** "4h 12m" / "12m" / "<1m" until a timestamp. */
export const countdown = (untilMs, nowMs = Date.now()) => {
  const left = Math.max(0, untilMs - nowMs);
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  if (h > 0) return { h, m };
  return { h: 0, m: Math.max(m, left > 0 ? 1 : 0) };
};

/** Next UTC midnight after `nowMs` (free packs refresh then). */
export const nextUtcMidnight = (nowMs = Date.now()) => (Math.floor(nowMs / 86400000) + 1) * 86400000;

/** Packs the player can open right now. */
export const packsAvailable = (wallet) => {
  if (!wallet) return 0;
  return (wallet.freeReady ? 1 : 0) + (wallet.bonusPacks || 0);
};

// ── Neon fusion (fuse_card, supabase/044) ──

/** What fusing one finish of a card would make: { to, have, need, ready } or null. */
export const fusionOf = (entries, finish) => {
  const to = FUSE_NEXT[finish];
  if (!to) return null;
  const e = (Array.isArray(entries) ? entries : []).find((x) => x[0] === finish);
  const have = e ? e[1] || 0 : 0;
  return { to, have, need: FUSE_COPIES, ready: have >= FUSE_COPIES };
};

/** The owned entries after a fusion: 4 of `from` used (row gone at 0), one `to` added with no serial. */
export const applyFusion = (entries, from, to) => {
  const list = (Array.isArray(entries) ? entries : [])
    .map((e) => (e[0] === from ? [e[0], (e[1] || 0) - FUSE_COPIES, e[2] ?? null] : e))
    .filter((e) => e[1] > 0);
  const i = list.findIndex((e) => e[0] === to);
  if (i >= 0) list[i] = [to, list[i][1] + 1, list[i][2] ?? null];
  else list.push([to, 1, null]);
  return list;
};

// ── Profile showcase (user_cosmetics.card_showcase, written by set_card_showcase) ──
export const SHOWCASE_MAX = 3;

/**
 * Stored entries {k, f, s, n, r, no, e, sets, bg} → [{ card, finish, serial }] the
 * card renderer can draw. Entries without catalog fields (older shape) are skipped.
 */
export const parseShowcase = (list) => (Array.isArray(list) ? list : [])
  .filter((e) => e && e.k && e.f && e.n && e.r)
  .slice(0, SHOWCASE_MAX)
  .map((e) => ({
    card: {
      key: e.k, name: e.n, rarity: e.r, no: e.no ?? null, egg: e.e || null,
      sets: Array.isArray(e.sets) ? e.sets : [], bg: e.bg || null,
    },
    finish: e.f,
    serial: e.s ?? null,
  }));

export const isShowcased = (list, key, finish) =>
  (Array.isArray(list) ? list : []).some((e) => e && e.k === key && e.f === finish);

/**
 * Pin or unpin one (card, finish). Returns the next list as [{k, f}], newest
 * first. The same (card, finish) again unpins it; another finish of a pinned
 * card replaces it; a 4th card drops the oldest.
 */
export const toggleShowcase = (list, key, finish) => {
  const cur = (Array.isArray(list) ? list : [])
    .filter((e) => e && e.k && e.f)
    .map((e) => ({ k: e.k, f: e.f }));
  if (cur.some((e) => e.k === key && e.f === finish)) return cur.filter((e) => e.k !== key);
  return [{ k: key, f: finish }, ...cur.filter((e) => e.k !== key)].slice(0, SHOWCASE_MAX);
};

// ── "Match my pet" backgrounds (Wallpaper Studio) ──
const hexToHsl = (hex) => {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return { h: 0, s: 0, l: 0.5 };
  // eslint-disable-next-line no-bitwise
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
};

const hsl = (h, s, l, a = 1) => {
  const deg = Math.round(h * 360) % 360;
  const pct = (x) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
  return a < 1 ? `hsla(${deg}, ${pct(s)}, ${pct(l)}, ${a})` : `hsl(${deg}, ${pct(s)}, ${pct(l)})`;
};

// A grey pet (Dalmatian, Crow) stays grey; any colour gets enough saturation to read.
const sat = (c, lo, hi) => (c.s < 0.1 ? c.s : Math.max(lo, Math.min(hi, c.s)));

/**
 * A pet's colours [main, second, accent] (petColors.json) → a wallpaper
 * background { css, accent, dark } in the same shape as the colour themes.
 * Only the hues come from the pet: lightness is set by the tone, so a black
 * pet still gets a pastel light background and a pale one a deep dark one.
 */
export const matchPalette = (colors, tone = 'light') => {
  const list = Array.isArray(colors) && colors.length ? colors : ['#9AA8B8'];
  const [main, second, accent] = [0, 1, 2].map((i) => hexToHsl(list[i] || list[0]));
  if (tone === 'dark') {
    return {
      dark: true,
      accent: hsl(accent.h, sat(accent, 0.7, 1), 0.66),
      css: [
        `radial-gradient(ellipse 70% 45% at 30% 28%, ${hsl(accent.h, sat(accent, 0.7, 1), 0.55, 0.5)} 0%, ${hsl(accent.h, sat(accent, 0.7, 1), 0.55, 0)} 70%)`,
        `radial-gradient(ellipse 65% 40% at 75% 75%, ${hsl(second.h, sat(second, 0.5, 0.9), 0.5, 0.35)} 0%, ${hsl(second.h, sat(second, 0.5, 0.9), 0.5, 0)} 70%)`,
        `linear-gradient(170deg, ${hsl(main.h, sat(main, 0.3, 0.7), 0.1)} 0%, ${hsl(second.h, sat(second, 0.35, 0.7), 0.2)} 55%, ${hsl(main.h, sat(main, 0.3, 0.7), 0.05)} 100%)`,
      ].join(', '),
    };
  }
  return {
    dark: false,
    accent: hsl(accent.h, sat(accent, 0.6, 1), 0.5),
    css: [
      'radial-gradient(ellipse 70% 42% at 25% 18%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 70%)',
      `radial-gradient(ellipse 60% 40% at 80% 85%, ${hsl(accent.h, sat(accent, 0.5, 0.9), 0.75, 0.6)} 0%, ${hsl(accent.h, sat(accent, 0.5, 0.9), 0.75, 0)} 70%)`,
      `linear-gradient(170deg, ${hsl(main.h, sat(main, 0.35, 0.75), 0.93)} 0%, ${hsl(second.h, sat(second, 0.35, 0.7), 0.83)} 50%, ${hsl(accent.h, sat(accent, 0.45, 0.8), 0.73)} 100%)`,
    ].join(', '),
  };
};
