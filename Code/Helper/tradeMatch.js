/**
 * tradeMatch.js — Trade Match ("get your dream pet") client helpers.
 *
 * Server side: supabase/032_trade_match.sql. The phone keeps a compact copy
 * of the player's PUBLIC trade lists in Supabase:
 *   have = owned pets marked "For Trade"        (availableForTrade === true)
 *   want = wishlist pets marked "Trading"        (availableForTrade === true)
 *          + the dream pet the player picked
 * Both are already visible on the player's profile, so matching exposes
 * nothing new.
 *
 * Cost rules:
 *   - sync only when the lists changed (hash per uid), or once a week so an
 *     active player never ages out of matching (rows expire after 120 days);
 *   - coalesce bursts (My Stuff auto-saves every edit) with a short debounce;
 *   - matches are cached on the phone for 10 minutes, stats for 1 hour.
 *
 * Everything is keyed by uid, never by the device: the MMKV `ownedPets`
 * cache is per device and survives account switches, so callers pass the
 * lists they just loaded or saved for a known uid.
 */

import { supabase } from '../Supabase/client';
import { normalizeName } from './valueSources';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'trade-match' });
} catch (e) {
  const mem = new Map();
  storage = {
    getString: (k) => mem.get(k),
    getNumber: (k) => mem.get(k),
    getBoolean: (k) => mem.get(k),
    set: (k, v) => mem.set(k, v),
    remove: (k) => mem.delete(k),
  };
}

export const MAX_ITEMS = 150;
const SYNC_DEBOUNCE_MS = 3000;
const RESYNC_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const MATCHES_TTL_MS = 10 * 60 * 1000;
const STATS_TTL_MS = 60 * 60 * 1000;
const LANGS = ['en', 'ru', 'es', 'fr', 'de', 'ar'];

// ── Keys ──────────────────────────────────────────────────────────────────

/** 'Pet Wear' -> 'petwear', 'Pets' -> 'pet', 'Eggs' -> 'egg'. */
export const coarseType = (type) => {
  let t = String(type || '').toLowerCase().replace(/[^a-z]/g, '');
  if (t.length > 3 && t.endsWith('s')) t = t.slice(0, -1);
  return (t || 'x').slice(0, 12);
};

/**
 * One key per item, whichever catalogue (Elvebredd or GG) the player picked
 * it from: normalised name + coarse type. Must match the SQL regex
 * ^[a-z0-9]{1,60}\|[a-z]{1,12}$ — returns null when it can't.
 */
export const petKey = (pet) => {
  if (!pet) return null;
  const name = normalizeName(pet.name || pet.Name).slice(0, 60);
  if (!name) return null;
  return `${name}|${coarseType(pet.category || pet.type)}`;
};

const toEntry = (pet) => {
  const k = petKey(pet);
  if (!k) return null;
  const v = pet.valueType === 'n' || pet.valueType === 'm' ? pet.valueType : 'd';
  return {
    k,
    n: String(pet.name || pet.Name || '').slice(0, 60),
    v,
    f: !!pet.isFly,
    r: !!pet.isRide,
    i: String(pet.imageUrl || pet.image || '').slice(0, 300),
  };
};

/** Unique entries (same pet + variant counted once), capped. */
export const compactList = (pets) => {
  const out = [];
  const seen = new Set();
  for (const pet of Array.isArray(pets) ? pets : []) {
    if (out.length >= MAX_ITEMS) break;
    const e = toEntry(pet);
    if (!e) continue;
    const sig = `${e.k}:${e.v}:${e.f}:${e.r}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(e);
  }
  return out;
};

/** The payload for sync_trade_inventory. */
export const buildTradeInventory = (ownedPets, wishlistPets, dreamKey) => {
  const owned = Array.isArray(ownedPets) ? ownedPets : [];
  const wishlist = Array.isArray(wishlistPets) ? wishlistPets : [];
  const have = compactList(owned.filter((p) => p && p.availableForTrade === true));
  const want = compactList(wishlist.filter((p) => p && (p.availableForTrade === true || (dreamKey && petKey(p) === dreamKey))));
  const dream = dreamKey && want.some((e) => e.k === dreamKey) ? dreamKey : null;
  return { have, want, dream };
};

// Small, stable string hash (FNV-1a) — only used to skip unchanged syncs.
export const hashString = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
};

// ── Per-uid settings ──────────────────────────────────────────────────────

export const getDreamKey = (uid) => (uid ? storage.getString(`dream_${uid}`) || null : null);

export const setDreamKeyLocal = (uid, key) => {
  if (!uid) return;
  if (key) storage.set(`dream_${uid}`, key);
  else storage.remove(`dream_${uid}`);
};

export const alertsEnabled = () => storage.getBoolean('alerts') ?? true;
export const setAlertsEnabled = (on) => storage.set('alerts', !!on);

// ── Sync ──────────────────────────────────────────────────────────────────

const timers = new Map();

const langOf = (lang) => {
  let l = lang;
  if (!l) {
    // Lazy so unit tests can load this module without the app's i18n setup.
    try { l = require('../../i18n').default.language; } catch (e) { l = 'en'; }
  }
  const base = String(l || 'en').slice(0, 2);
  return LANGS.includes(base) ? base : 'en';
};

async function doSync(uid, ownedPets, wishlistPets, dreamKey, lang) {
  const inv = buildTradeInventory(ownedPets, wishlistPets, dreamKey);
  const alerts = alertsEnabled();
  const l = langOf(lang);
  const hash = hashString(JSON.stringify([inv, alerts, l]));
  const lastHash = storage.getString(`hash_${uid}`);
  const lastAt = storage.getNumber(`syncAt_${uid}`) || 0;
  if (hash === lastHash && Date.now() - lastAt < RESYNC_EVERY_MS) return { skipped: true };
  // Nothing public and never synced from this phone: don't create an empty row.
  if (!lastHash && inv.have.length === 0 && inv.want.length === 0) return { skipped: true };

  const { data, error } = await supabase.rpc('sync_trade_inventory', {
    p_have: inv.have,
    p_want: inv.want,
    p_dream: inv.dream,
    p_lang: l,
    p_alerts: alerts,
  });
  if (error) throw error;
  storage.set(`hash_${uid}`, hash);
  storage.set(`syncAt_${uid}`, Date.now());
  storage.remove(`matches_${uid}`); // lists changed -> matches are stale
  return data;
}

/**
 * Queue a sync of `uid`'s lists. Safe to call on every load/save: bursts are
 * coalesced and unchanged lists never reach the server.
 * `dreamKey` defaults to the one stored for this uid.
 */
export const syncTradeInventory = (uid, ownedPets, wishlistPets, { dreamKey, lang, immediate = false } = {}) => {
  if (!uid || !Array.isArray(ownedPets) || !Array.isArray(wishlistPets)) return Promise.resolve(null);
  const dream = dreamKey === undefined ? getDreamKey(uid) : dreamKey;
  if (timers.has(uid)) clearTimeout(timers.get(uid).t);
  return new Promise((resolve) => {
    const run = () => {
      timers.delete(uid);
      doSync(uid, ownedPets, wishlistPets, dream, lang)
        .then(resolve)
        .catch((e) => {
          console.warn('[tradeMatch] sync failed:', e?.message);
          resolve(null);
        });
    };
    if (immediate) run();
    else timers.set(uid, { t: setTimeout(run, SYNC_DEBOUNCE_MS) });
  });
};

// ── Matches & stats ───────────────────────────────────────────────────────

const readCache = (key, ttl) => {
  try {
    const raw = storage.getString(key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    return Date.now() - at < ttl ? data : null;
  } catch {
    return null;
  }
};
const writeCache = (key, data) => storage.set(key, JSON.stringify({ at: Date.now(), data }));

/** Cached match count for the Home card (no network). */
export const cachedMatchCount = (uid) => {
  const m = uid ? readCache(`matches_${uid}`, 24 * 60 * 60 * 1000) : null;
  return Array.isArray(m) ? m.length : null;
};

export const fetchTradeMatches = async (uid, { force = false } = {}) => {
  if (!uid) return [];
  if (!force) {
    const cached = readCache(`matches_${uid}`, MATCHES_TTL_MS);
    if (cached) return cached;
  }
  const { data, error } = await supabase.rpc('find_trade_matches', { p_limit: 30 });
  if (error) throw error;
  const list = Array.isArray(data) ? data : [];
  writeCache(`matches_${uid}`, list);
  return list;
};

export const fetchTradeMatchStats = async ({ force = false } = {}) => {
  if (!force) {
    const cached = readCache('stats', STATS_TTL_MS);
    if (cached) return cached;
  }
  const { data, error } = await supabase.rpc('trade_match_stats');
  if (error) throw error;
  writeCache('stats', data || {});
  return data || {};
};

export const reportDreamFound = async (key) => {
  const { data, error } = await supabase.rpc('report_dream_found', { p_key: key });
  if (error) throw error;
  if (data) writeCache('stats', data);
  return data;
};
