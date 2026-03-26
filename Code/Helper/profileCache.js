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
 */


import { ref, get } from '@react-native-firebase/database';

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

  // 2. Fetch from RTDB
  try {
    const snap = await get(ref(db, `users/${uid}`));
    if (!snap.exists()) return null;

    const data = snap.val();

    // Fetch active cosmetics
    let chatTextColor = null;
    let profileFrame = null;
    let tradeCardBg = null;
    let chatBubbleBg = null;
    const shopItems = data.shop?.activeItems;
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
      displayName: data.displayName || 'Anonymous',
      avatar: data.avatar || null,
      isPro: !!data.isPro,
      robloxUsernameVerified: !!data.robloxUsernameVerified,
      hasRecentGameWin: !!data.hasRecentGameWin,
      lastGameWinAt: data.lastGameWinAt || null,
      isAdmin: !!data.isAdmin,
      isModerator: !!data.isModerator,
      isTrusted: !!data.isTrusted,
      isCMSR: !!data.isCMSR,
      chatTextColor,
      profileFrame,
      tradeCardBg,
      chatBubbleBg: chatBubbleBg || null,
      topBadge: data.topBadge || null,
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

  // Filter to only uncached UIDs
  const uncached = [...new Set(uids)].filter(uid => !getCachedProfile(uid));
  if (uncached.length === 0) return;

  // Fetch in parallel (max 10 at a time to avoid flooding)
  const batch = uncached.slice(0, 10);
  await Promise.allSettled(batch.map(uid => getOrFetchProfile(db, uid)));
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
  if (!msg) return { displayName: 'Anonymous', avatar: null, isPro: false, robloxUsernameVerified: false, hasRecentGameWin: false, chatTextColor: null, profileFrame: null, tradeCardBg: null, chatBubbleBg: null, topBadge: null, isTrusted: false, isCMSR: false };

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
    chatTextColor: msg.chatTextColor ?? cached?.chatTextColor ?? null,
    profileFrame: msg.profileFrame ?? cached?.profileFrame ?? null,
    tradeCardBg: cached?.tradeCardBg ?? null,
    chatBubbleBg: msg.chatBubbleBg ?? cached?.chatBubbleBg ?? null,
    topBadge: msg.topBadge ?? cached?.topBadge ?? null,
  };
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

      const snap = await get(ref(db, `users/${user.id}/shop/activeItems`));
      if (snap.exists()) {
        const items = snap.val();
        const now = Date.now();
        if (items.chatTextColor && (items.chatTextColor.expiresAt === -1 || items.chatTextColor.expiresAt > now)) {
          profile.chatTextColor = items.chatTextColor.color || null;
        }
        if (items.profileFrame && (items.profileFrame.expiresAt === -1 || items.profileFrame.expiresAt > now)) {
          profile.profileFrame = items.profileFrame;
        }
        if (items.tradeCardBg && (items.tradeCardBg.expiresAt === -1 || items.tradeCardBg.expiresAt > now)) {
          profile.tradeCardBg = items.tradeCardBg;
        }
        if (items.chatBubbleBg && (items.chatBubbleBg.expiresAt === -1 || items.chatBubbleBg.expiresAt > now)) {
          profile.chatBubbleBg = items.chatBubbleBg;
        }
        // Re-seed with cosmetics
        setCachedProfile(user.id, profile);
      }
    } catch (e) {
      // Silently fail — cosmetics are non-essential
    }
  }
};

