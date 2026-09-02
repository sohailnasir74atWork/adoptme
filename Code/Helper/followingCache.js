/**
 * followingCache.js — shared cache for "who does this user follow?"
 *
 * The `following` query (where followerId == uid) runs in three screens:
 * StatusFeed, Trades and DesignMainScreen. StatusFeed already cached it in
 * MMKV with a 1-hour TTL and wrote through on follow/unfollow; the other two
 * refetched from Firestore on every mount.
 *
 * This module exposes StatusFeed's cache to the other two call sites. It
 * deliberately uses the SAME MMKV store id and the SAME keys
 * ('following_ids' / 'following_ids_ts'), so all three screens share one
 * cache entry and StatusFeed's existing write-through on follow/unfollow
 * (StatusFeed.js handleFollowToggle) keeps every screen fresh — no second
 * invalidation path to maintain.
 *
 * Scale note (COST_OPTIMIZATION_2026-09.md F8): the query carries limit(200),
 * but the whole `following` collection holds only ~19.5k docs across all
 * users, so a typical read returns ~3 documents. This is duplicated work
 * against an existing cache rather than a large cost — worth removing, but it
 * is not the expensive item the limit makes it look like.
 */

import { collection, query, where, limit, getDocs } from '@react-native-firebase/firestore';

const STORE_ID = 'status-feed-cache';  // must match StatusFeed.js
const KEY = 'following_ids';           // must match StatusFeed.js
const TTL = 60 * 60 * 1000;            // 1 hour — matches FOLLOWING_CACHE_TTL
const FETCH_LIMIT = 200;               // unchanged from the original call sites

let store;
try {
  const { createMMKV } = require('react-native-mmkv');
  store = createMMKV({ id: STORE_ID });
} catch (e) {
  console.warn('[followingCache] MMKV not available:', e?.message);
  store = {
    getString: () => undefined,
    getNumber: () => undefined,
    set: () => {},
    delete: () => {},
  };
}

/** Synchronous read of the cached ids. Returns null when absent/expired. */
export const getCachedFollowingIds = () => {
  try {
    const ts = store.getNumber(`${KEY}_ts`);
    if (!ts || (Date.now() - ts) >= TTL) return null;
    const raw = store.getString(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeCache = (ids) => {
  try {
    store.set(KEY, JSON.stringify(ids));
    store.set(`${KEY}_ts`, Date.now());
  } catch {
    // cache is optional
  }
};

/**
 * Cached read of the current user's following list.
 *
 * Serves from MMKV when fresh (zero Firestore reads), otherwise queries and
 * caches. Errors resolve to a stale-or-empty list rather than throwing, which
 * matches how all three call sites already behaved.
 *
 * @param {object} firestoreDB
 * @param {string} userId
 * @param {boolean} [force=false] skip the TTL and refetch
 * @returns {Promise<string[]>} followingId values
 */
export const getFollowingIds = async (firestoreDB, userId, force = false) => {
  if (!firestoreDB || !userId) return [];

  if (!force) {
    const cached = getCachedFollowingIds();
    if (cached) return cached;
  }

  try {
    const snap = await getDocs(query(
      collection(firestoreDB, 'following'),
      where('followerId', '==', userId),
      limit(FETCH_LIMIT),
    ));
    const ids = snap.docs.map((d) => d.data().followingId).filter(Boolean);
    writeCache(ids);
    return ids;
  } catch (err) {
    console.warn('[followingCache] fetch failed:', err?.message);
    // Fall back to a stale entry if there is one — better than dropping the
    // Following filter entirely on a transient network error.
    try {
      const raw = store.getString(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
};

/** Drop the cache — e.g. on sign-out, so the next user doesn't inherit it. */
export const clearFollowingCache = () => {
  try {
    store.delete(KEY);
    store.delete(`${KEY}_ts`);
  } catch {}
};
