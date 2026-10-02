/**
 * cardsApi.js — Pet Cards server calls (supabase/037_pet_cards.sql) + caches.
 *
 * Reads: cards_state when the hub opens (cached 2 min), the catalogue once
 * per catalogVersion (MMKV), get_card_collection when the album opens
 * (cached 5 min; dropped after every pack). No realtime.
 *
 * Development: when the 037 functions are not deployed yet, __DEV__ builds
 * fall back to cardsMock.js (same rules, kept on the device) so every screen
 * can be exercised. Release builds never include the mock.
 */

import { supabase } from '../Supabase/client';
import { parseCatalog } from './cardMath';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'pet_cards' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}

const STATE_TTL_MS = 2 * 60 * 1000;
const COLLECTION_TTL_MS = 5 * 60 * 1000;

let currentUid = null;
let stateCache = null;          // { at, uid, data }
const collectionCache = new Map(); // uid -> { at, data }
let catalogCache = null;        // { version, list }
let mock = null;

const isMissingFunction = (error) =>
  !!error && (error.code === 'PGRST202' || /Could not find the function|does not exist/i.test(error.message || ''));

async function call(fn, args) {
  if (mock) return mock[fn](args);
  const { data, error } = await supabase.rpc(fn, args || {});
  if (error) {
    if (__DEV__ && isMissingFunction(error)) {
      // 037 not deployed: switch this session to the local simulation.
      mock = require('./cardsMock').default;
      console.log('[PetCards] 037 not deployed: using the local mock');
      return mock[fn](args);
    }
    throw error;
  }
  return data;
}

/** Map a server error to an i18n key under pet_cards.err.* */
export const errorKey = (e) => {
  const m = String(e?.message || e || '');
  if (/free pack already opened/.test(m)) return 'free_used';
  if (/star pack limit/.test(m)) return 'star_limit';
  if (/no bonus packs/.test(m)) return 'no_bonus';
  if (/pack not available/.test(m)) return 'pack_closed';
  if (/no cards in this pack/.test(m)) return 'pack_empty';
  if (/not enough shards/.test(m)) return 'shards';
  if (/already owned/.test(m)) return 'owned';
  if (/sign in required/.test(m)) return 'sign_in';
  return 'generic';
};

/** Scope caches to the signed-in player (null after sign-out). */
export const setCardsUser = (uid) => {
  if (uid === currentUid) return;
  currentUid = uid || null;
  stateCache = null;
  collectionCache.clear();
};

export const isMockActive = () => !!mock;

export async function getCardsState({ force = false } = {}) {
  if (!force && stateCache && stateCache.uid === currentUid && Date.now() - stateCache.at < STATE_TTL_MS) {
    return stateCache.data;
  }
  const data = await call('cards_state');
  stateCache = { at: Date.now(), uid: currentUid, data };
  return data;
}

/** Last state without a network call (for an instant first paint). */
export const peekCardsState = () => (stateCache && stateCache.uid === currentUid ? stateCache.data : null);

export async function getCatalog(version) {
  if (catalogCache && catalogCache.version === version) return catalogCache.list;
  try {
    const raw = storage.getString('catalog');
    if (raw) {
      const saved = JSON.parse(raw);
      if (saved && saved.version === version && Array.isArray(saved.rows)) {
        catalogCache = { version, list: parseCatalog(saved.rows) };
        return catalogCache.list;
      }
    }
  } catch (e) { /* refetch */ }
  const rows = await call('card_catalog_list');
  catalogCache = { version, list: parseCatalog(rows) };
  if (!mock) {
    try { storage.set('catalog', JSON.stringify({ version, rows })); } catch (e) { /* cache only */ }
  }
  return catalogCache.list;
}

export async function getCollection(uid = null, { force = false } = {}) {
  const who = uid || currentUid || 'me';
  const hit = collectionCache.get(who);
  if (!force && hit && Date.now() - hit.at < COLLECTION_TTL_MS) return hit.data;
  const data = await call('get_card_collection', { p_uid: uid });
  collectionCache.set(who, { at: Date.now(), data });
  return data;
}

const afterChange = (wallet) => {
  collectionCache.delete(currentUid || 'me');
  if (stateCache && wallet) stateCache = { ...stateCache, at: Date.now(), data: { ...stateCache.data, wallet } };
};

/** source: 'free' | 'stars' | 'bonus' */
export async function openPack(setId, source) {
  const data = await call('open_card_pack', { p_set: setId, p_source: source });
  afterChange(data?.wallet);
  return data;
}

export async function craftCard(key) {
  const data = await call('craft_card', { p_key: key });
  afterChange(data?.wallet);
  return data;
}

export async function setShowcase(cards) {
  return call('set_card_showcase', { p_cards: cards.slice(0, 3).map((c) => ({ k: c.key, f: c.finish })) });
}
