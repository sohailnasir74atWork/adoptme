/**
 * profileCache.js
 * MMKV-based profile cache for user display data.
 *
 * Purpose: Reduce RTDB bandwidth by caching sender profiles locally.
 * When rendering chat messages, avatar/isPro/badges are fetched from cache
 * instead of being embedded in every message payload.
 *
 * Cache TTL: 30 minutes
 * Storage: react-native-mmkv (already a dependency)
 *
 * ⚠️ BACKWARDS COMPATIBLE:
 *   - Old messages still have avatar/isPro/sender fields → used first
 *   - New slim messages miss these fields → cache fills in
 *   - If cache misses too → sensible defaults (no crash)
 *
 * 🚀 WAVE 1+2 — moved to Supabase via userBackend:
 *   - displayName, avatar              → user_identity
 *   - isAdmin/isModerator/isBabyMod
 *     /isTrusted/isCMSR/isHelper       → user_roles
 *   - isPro, topBadge                  → user_cosmetics
 *   RTDB falls back per-field if Supabase has no row (mirror lag, brand-new
 *   user, or backfill miss). Game state (hasRecentGameWin, lastGameWinAt,
 *   robloxUsernameVerified) and shop subtree still read from RTDB —
 *   they migrate in later waves (or stay on RTDB; shop deferred).
 */


import { ref, get } from '@react-native-firebase/database';
import {
  getIdentity, getRoles, getCosmetics, getRoblox,
  getIdentityBatch, getRolesBatch, getCosmeticsBatch, getRobloxBatch,
} from '../Supabase/userBackend';

let cache;
try {
  const { createMMKV } = require('react-native-mmkv');
  cache = createMMKV({ id: 'profile-cache' });
} catch (e) {
  console.warn('[profileCache] MMKV not available:', e.message);
  cache = {
    getString: () => undefined,
    set: () => {},
    delete: () => {},
  };
}
const TTL = 30 * 60 * 1000; // 30 minutes

// ────────────────────────────────────────────────────────
//  READ from cache (synchronous — safe in render)
// ────────────────────────────────────────────────────────
export const getCachedProfile = (uid) => {
  if (!uid) return null;
  try {
    const raw = cache.getString(`p_${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > TTL) {
      cache.delete(`p_${uid}`);
      return null;
    }
    return parsed.d;
  } catch {
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  WRITE to cache
// ────────────────────────────────────────────────────────
export const setCachedProfile = (uid, data) => {
  if (!uid || !data) return;
  try {
    cache.set(`p_${uid}`, JSON.stringify({ d: data, t: Date.now() }));
  } catch {
    // Silently fail — cache is optional
  }
};

// ────────────────────────────────────────────────────────
//  FETCH from RTDB only if not cached (async)
//  Call this in useEffect or outside render loop
// ────────────────────────────────────────────────────────
export const getOrFetchProfile = async (db, uid) => {
  if (!uid || !db) return null;

  // 1. Check cache first
  const cached = getCachedProfile(uid);
  if (cached) return cached;

  // Fetch strategy:
  //   - identity / roles / cosmetics / roblox  → Supabase (always)
  //   - cosmetics row also carries active shop items (profileFrame, etc.)
  //     since 016_user_cosmetics_active migration — was 1 RTDB read here
  //   - hasRecentGameWin + lastGameWinAt       → RTDB (not mirrored)
  //   - RTDB fallback for mirrored fields fires ONLY if the corresponding
  //     Supabase table returned null (mirror lag / not-yet-backfilled user).
  //     Common case: 0 RTDB reads for the mirrored fields.
  const [identityRow, rolesRow, cosmeticsRow, robloxRow] = await Promise.all([
    getIdentity(uid),
    getRoles(uid),
    getCosmetics(uid),
    getRoblox(uid),
  ]);
  return assembleAndCacheProfile(db, uid, { identityRow, rolesRow, cosmeticsRow, robloxRow });
};

// Assemble + cache a profile from pre-fetched Supabase rows. Shared by
// getOrFetchProfile (single, 4 point queries) and warmProfileCache
// (bulk, 4 batch queries for the whole set) so the two paths can't
// drift. Does the RTDB game-win leaf reads + per-field RTDB fallback
// for whichever Supabase rows came back null.
const assembleAndCacheProfile = async (db, uid, { identityRow, rolesRow, cosmeticsRow, robloxRow }) => {
  try {
    const base = `users/${uid}`;

    const [hasRecentGameWinSnap, lastGameWinAtSnap] = await Promise.all([
      get(ref(db, `${base}/hasRecentGameWin`)),
      get(ref(db, `${base}/lastGameWinAt`)),
    ]);

    const hasRecentGameWin = hasRecentGameWinSnap.exists() ? hasRecentGameWinSnap.val() : null;
    const lastGameWinAt    = lastGameWinAtSnap.exists()    ? lastGameWinAtSnap.val()    : null;
    // Build a shopItems-shaped object from cosmeticsRow so the existing
    // expiresAt filter below works without a code shape change. Cold
    // cosmeticsRow (mirror lag) → null → no frame/bubble until mirror
    // catches up; same graceful degradation as identity/roles fallback.
    const shopItems = cosmeticsRow ? {
      profileFrame:  cosmeticsRow.profileFrame,
      chatTextColor: cosmeticsRow.chatTextColor,
      tradeCardBg:   cosmeticsRow.tradeCardBg,
      profileBanner: cosmeticsRow.profileBanner,
      chatBubbleBg:  cosmeticsRow.chatBubbleBg,
    } : null;

    // Selective RTDB fallback — only for Supabase tables that returned null.
    // This handles brand-new users and any backfill misses without paying
    // the per-cache-miss RTDB tax for everyone else.
    let fb = null;
    const missingFields = [];
    if (!identityRow)  missingFields.push('displayName', 'avatar');
    // RTDB leaf for admin is `admin` (not `isAdmin`); Supabase exposes it
    // as `isAdmin` via fromRolesRow. Use the correct RTDB name here so the
    // fallback works when the mirror row is missing.
    if (!rolesRow)     missingFields.push('admin', 'isModerator', 'isTrusted', 'isCMSR', 'isHelper');
    if (!cosmeticsRow) missingFields.push('isPro', 'topBadge');
    if (!robloxRow)    missingFields.push('robloxUsernameVerified');
    if (missingFields.length > 0) {
      const snaps = await Promise.all(
        missingFields.map((p) => get(ref(db, `${base}/${p}`)).catch(() => null))
      );
      fb = {};
      missingFields.forEach((p, i) => {
        if (snaps[i] && snaps[i].exists()) fb[p] = snaps[i].val();
      });
    }

    const displayName             = identityRow?.displayName          ?? fb?.displayName;
    const avatar                  = identityRow?.avatar               ?? fb?.avatar;
    const isPro                   = cosmeticsRow?.isPro               ?? fb?.isPro;
    const topBadge                = cosmeticsRow?.topBadge            ?? fb?.topBadge;
    const isAdmin                 = rolesRow?.isAdmin                 ?? fb?.admin;
    const isModerator             = rolesRow?.isModerator             ?? fb?.isModerator;
    const isTrusted               = rolesRow?.isTrusted               ?? fb?.isTrusted;
    const isCMSR                  = rolesRow?.isCMSR                  ?? fb?.isCMSR;
    const isHelper                = rolesRow?.isHelper                ?? fb?.isHelper;
    const robloxUsernameVerified  = robloxRow?.robloxUsernameVerified ?? fb?.robloxUsernameVerified;

    if (
      identityRow == null && rolesRow == null && cosmeticsRow == null && robloxRow == null &&
      hasRecentGameWin == null && lastGameWinAt == null && shopItems == null &&
      (!fb || Object.keys(fb).length === 0)
    ) {
      return null;
    }

    let chatTextColor = null;
    let profileFrame = null;
    let tradeCardBg = null;
    let chatBubbleBg = null;
    if (shopItems) {
      const now = Date.now();
      if (shopItems.chatTextColor && (shopItems.chatTextColor.expiresAt === -1 || shopItems.chatTextColor.expiresAt > now)) {
        chatTextColor = shopItems.chatTextColor.color || null;
      }
      if (shopItems.profileFrame && (shopItems.profileFrame.expiresAt === -1 || shopItems.profileFrame.expiresAt > now)) {
        profileFrame = shopItems.profileFrame;
      }
      if (shopItems.tradeCardBg && (shopItems.tradeCardBg.expiresAt === -1 || shopItems.tradeCardBg.expiresAt > now)) {
        tradeCardBg = shopItems.tradeCardBg;
      }
      if (shopItems.chatBubbleBg && (shopItems.chatBubbleBg.expiresAt === -1 || shopItems.chatBubbleBg.expiresAt > now)) {
        chatBubbleBg = shopItems.chatBubbleBg;
      }
    }

    const profile = {
      displayName: displayName || 'Anonymous',
      avatar: avatar || null,
      isPro: !!isPro,
      robloxUsernameVerified: !!robloxUsernameVerified,
      hasRecentGameWin: !!hasRecentGameWin,
      lastGameWinAt: lastGameWinAt || null,
      isAdmin: !!isAdmin,
      isModerator: !!isModerator,
      isTrusted: !!isTrusted,
      isCMSR: !!isCMSR,
      isHelper: !!isHelper,
      chatTextColor,
      profileFrame,
      tradeCardBg,
      chatBubbleBg: chatBubbleBg || null,
      topBadge: topBadge || null,
    };
    setCachedProfile(uid, profile);
    return profile;
  } catch (err) {
    console.warn('[profileCache] Fetch error:', err?.message);
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  WARM CACHE — pre-fetch profiles for a batch of UIDs
//  Call this when loading messages to cache all senders
// ────────────────────────────────────────────────────────
export const warmProfileCache = async (db, uids) => {
  if (!db || !Array.isArray(uids) || uids.length === 0) return;

  const uncached = [...new Set(uids)].filter(uid => !getCachedProfile(uid));
  if (uncached.length === 0) return;

  // 4 batched .in() queries for the WHOLE uncached set (chunked at 200
  // inside _batchByUid) instead of 4 single-row queries per uid — a
  // fresh chat page with 15 unknown senders is 4 Supabase round-trips,
  // not 60. Batch failure degrades to empty maps; assembleAndCacheProfile
  // then hits its per-field RTDB fallback exactly as a null row would.
  const [idMap, rolesMap, cosMap, rbxMap] = await Promise.all([
    getIdentityBatch(uncached).catch(() => new Map()),
    getRolesBatch(uncached).catch(() => new Map()),
    getCosmeticsBatch(uncached).catch(() => new Map()),
    getRobloxBatch(uncached).catch(() => new Map()),
  ]);

  // Assembly still runs in waves — it does 2 RTDB game-win leaf reads
  // per uid (plus fallback reads for rows missing above), and 10-wide
  // keeps that RTDB concurrency bounded.
  const WAVE = 10;
  for (let i = 0; i < uncached.length; i += WAVE) {
    const wave = uncached.slice(i, i + WAVE);
    await Promise.allSettled(wave.map(uid => assembleAndCacheProfile(db, uid, {
      identityRow: idMap.get(uid) ?? null,
      rolesRow: rolesMap.get(uid) ?? null,
      cosmeticsRow: cosMap.get(uid) ?? null,
      robloxRow: rbxMap.get(uid) ?? null,
    })));
  }
};

// ────────────────────────────────────────────────────────
//  SEED CACHE — populate from a message that already has
//  the data (old format messages). Zero RTDB cost.
// ────────────────────────────────────────────────────────
export const seedFromMessage = (msg) => {
  if (!msg?.senderId) return;

  // Only seed if we don't already have a cached version
  const existing = getCachedProfile(msg.senderId);
  if (existing) return;

  // Only seed if message actually has the data (old format)
  if (!msg.avatar && !msg.sender) return;

  setCachedProfile(msg.senderId, {
    displayName: msg.sender || 'Anonymous',
    avatar: msg.avatar || null,
    isPro: !!msg.isPro,
    robloxUsernameVerified: !!msg.robloxUsernameVerified,
    hasRecentGameWin: !!msg.hasRecentGameWin,
    lastGameWinAt: msg.lastGameWinAt || null,
    isAdmin: !!msg.isAdmin,
    isModerator: !!msg.isModerator,
    isTrusted: !!msg.isTrusted,
    isCMSR: !!msg.isCMSR,
    isHelper: !!msg.isHelper,
    topBadge: msg.topBadge || null,
    profileFrame: msg.profileFrame || null,
    chatTextColor: msg.chatTextColor || null,
    chatBubbleBg: msg.chatBubbleBg || null,
  });
};

// ────────────────────────────────────────────────────────
//  RESOLVE — get value from message first, then cache, then default
//  This is the key "backwards compatible" resolver
// ────────────────────────────────────────────────────────
export const resolveProfile = (msg) => {
  if (!msg) return { displayName: 'Anonymous', avatar: null, isPro: false, robloxUsernameVerified: false, hasRecentGameWin: false, chatTextColor: null, profileFrame: null, tradeCardBg: null, chatBubbleBg: null, topBadge: null, isTrusted: false, isCMSR: false, isHelper: false };

  const cached = getCachedProfile(msg.senderId);

  return {
    displayName: msg.sender || cached?.displayName || 'Anonymous',
    avatar: msg.avatar || cached?.avatar || null,
    isPro: msg.isPro ?? cached?.isPro ?? false,
    robloxUsernameVerified: msg.robloxUsernameVerified ?? cached?.robloxUsernameVerified ?? false,
    hasRecentGameWin: msg.hasRecentGameWin ?? cached?.hasRecentGameWin ?? (
      typeof (msg.lastGameWinAt || cached?.lastGameWinAt) === 'number' &&
      Date.now() - (msg.lastGameWinAt || cached?.lastGameWinAt) <= 24 * 60 * 60 * 1000
    ),
    isAdmin: msg.isAdmin ?? cached?.isAdmin ?? false,
    isModerator: msg.isModerator ?? cached?.isModerator ?? false,
    isTrusted: msg.isTrusted ?? cached?.isTrusted ?? false,
    isCMSR: msg.isCMSR ?? cached?.isCMSR ?? false,
    isHelper: msg.isHelper ?? cached?.isHelper ?? false,
    chatTextColor: msg.chatTextColor ?? cached?.chatTextColor ?? null,
    profileFrame: msg.profileFrame ?? cached?.profileFrame ?? null,
    tradeCardBg: cached?.tradeCardBg ?? null,
    chatBubbleBg: msg.chatBubbleBg ?? cached?.chatBubbleBg ?? null,
    topBadge: msg.topBadge ?? cached?.topBadge ?? null,
  };
};

// ────────────────────────────────────────────────────────
//  FULL-RECORD CACHE — caches the raw /users/{uid} record
//  for screens (BottomDrawer, admin tools) that need many
//  user fields beyond the chat-render subset. Kept under a
//  separate key prefix so the chat profile cache is unaffected.
// ────────────────────────────────────────────────────────
const FULL_KEY = (uid) => `full_${uid}`;

export const getCachedFullProfile = (uid) => {
  if (!uid) return null;
  try {
    const raw = cache.getString(FULL_KEY(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > TTL) {
      cache.delete(FULL_KEY(uid));
      return null;
    }
    return parsed.d;
  } catch {
    return null;
  }
};

export const setCachedFullProfile = (uid, record) => {
  if (!uid) return;
  try {
    cache.set(FULL_KEY(uid), JSON.stringify({ d: record || null, t: Date.now() }));
  } catch {
    // ignore — cache is optional
  }
};

export const invalidateFullProfile = (uid) => {
  if (!uid) return;
  try { cache.delete(FULL_KEY(uid)); } catch {}
};

// Read the raw /users/{uid} once, cache it, return it. Returns null on missing.
export const getOrFetchFullProfile = async (db, uid) => {
  if (!uid || !db) return null;
  const cached = getCachedFullProfile(uid);
  if (cached !== null) return cached;
  try {
    const snap = await get(ref(db, `users/${uid}`));
    const record = snap.exists() ? snap.val() : null;
    setCachedFullProfile(uid, record);
    return record;
  } catch (err) {
    console.warn('[profileCache] getOrFetchFullProfile error:', err?.message);
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  SEED CURRENT USER — call once on mount in chat screens
//  This ensures the user's OWN slim messages resolve correctly
// ────────────────────────────────────────────────────────
export const seedCurrentUser = async (user, localState, db) => {
  if (!user?.id) return;

  // Base profile (immediate, no Firebase read)
  const profile = {
    displayName: user.displayName || 'Anonymous',
    avatar: user.avatar || null,
    isPro: !!localState?.isPro,
    robloxUsernameVerified: !!user.robloxUsernameVerified,
    hasRecentGameWin: !!user.hasRecentGameWin || (user.lastGameWinAt && Date.now() - user.lastGameWinAt <= 24 * 60 * 60 * 1000) || false,
    lastGameWinAt: user.lastGameWinAt || null,
    isAdmin: !!user.isAdmin,
    isModerator: !!user.isModerator,
    isTrusted: !!user.isTrusted,
    isCMSR: !!user.isCMSR,
    isHelper: !!user.isHelper,
    topBadge: user.topBadge || null,
    chatTextColor: null,
    profileFrame: null,
    tradeCardBg: null,
    chatBubbleBg: null,
  };

  // Seed immediately with base data
  setCachedProfile(user.id, profile);

  // Then fetch avatar + cosmetics async (fire-and-forget)
  if (db) {
    try {
      // ✅ Fetch avatar from RTDB if missing from global state
      if (!profile.avatar) {
        const avatarSnap = await get(ref(db, `users/${user.id}/avatar`));
        if (avatarSnap.exists()) {
          profile.avatar = avatarSnap.val();
          // Re-seed immediately so messages pick up avatar
          setCachedProfile(user.id, profile);
        }
      }

      // 2026-09-02 (cost): this used to `get(users/{uid}/shop/activeItems)`
      // directly on every chat-screen mount — the #2 hottest RTDB path in the
      // profiler (6,892 events / 10 min). cosmeticsCache reads the exact same
      // node behind a 10-minute MMKV TTL and applies the identical expiresAt
      // filtering, and MainTabs already force-syncs it on app start — so on the
      // common path this is now zero RTDB reads instead of one per mount.
      // syncMyCosmetics returns the cached value when fresh, fetches when not.
      const { syncMyCosmetics } = require('./cosmeticsCache');
      const cos = await syncMyCosmetics(db, user.id);
      if (cos) {
        // Items are already expiry-filtered by syncMyCosmetics.
        if (cos.chatTextColor) profile.chatTextColor = cos.chatTextColor.color || null;
        if (cos.profileFrame)  profile.profileFrame  = cos.profileFrame;
        if (cos.tradeCardBg)   profile.tradeCardBg   = cos.tradeCardBg;
        if (cos.chatBubbleBg)  profile.chatBubbleBg  = cos.chatBubbleBg;
        // Re-seed with cosmetics
        setCachedProfile(user.id, profile);
      }
    } catch (e) {
      // Silently fail — cosmetics are non-essential
    }
  }
};

