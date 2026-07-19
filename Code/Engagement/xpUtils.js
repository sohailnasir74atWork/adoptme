/**
 * xpUtils.js
 * XP & Level System — Universal progression for the AdoptMe app.
 *
 * Every action earns XP → XP determines level → levels unlock cosmetics.
 * Uses RTDB increment() for atomic, non-blocking writes (~$1-2/mo for 10K DAU).
 *
 * RTDB structure:
 *   users/{uid}/xp/total: 4520
 *   users/{uid}/xp/level: 12
 */

import { ref, increment, update, get, push, set } from '@react-native-firebase/database';

// ────────────────────────────────────────────────────────
//  LEVEL TABLE
// ────────────────────────────────────────────────────────
const LEVELS = [
  { level: 1,  xp: 0,       title: 'Hatchling',    emoji: '🥚' },
  { level: 2,  xp: 200,     title: 'Newborn',      emoji: '🐣' },
  { level: 3,  xp: 500,     title: 'Junior',       emoji: '🌱' },
  { level: 5,  xp: 1200,    title: 'Explorer',     emoji: '🌿',  unlock: 'greenName' },
  { level: 7,  xp: 2500,    title: 'Adventurer',   emoji: '🏕️' },
  { level: 10, xp: 5000,    title: 'Collector',    emoji: '🌟',  unlock: 'sparkle' },
  { level: 12, xp: 8000,    title: 'Veteran',      emoji: '🔥' },
  { level: 15, xp: 12000,   title: 'Trader Pro',   emoji: '💼',  unlock: 'tradeBorder' },
  { level: 18, xp: 18000,   title: 'Expert',       emoji: '💎' },
  { level: 20, xp: 25000,   title: 'Rising Star',  emoji: '⭐',  unlock: 'animatedFrame' },
  { level: 23, xp: 35000,   title: 'Master',       emoji: '🏆' },
  { level: 25, xp: 50000,   title: 'Legend',        emoji: '👑',  unlock: 'rainbowName' },
  { level: 28, xp: 75000,   title: 'Elite',        emoji: '🦅' },
  { level: 30, xp: 100000,  title: 'Mythic',       emoji: '🦄',  unlock: 'holographic' },
];

// ────────────────────────────────────────────────────────
//  XP ACTIONS & AMOUNTS
// ────────────────────────────────────────────────────────
export const XP_ACTIONS = {
  DAILY_LOGIN:       50,
  COMPLETE_TRADE:    25,
  CREATE_POST:       20,
  LEAVE_REVIEW:      30,
  CORRECT_QUIZ:      10,
  WIN_MEMORY_GAME:   50,
  UPDATE_PETS:       10,
  STREAK_7_DAY:      200,
  POST_STATUS:       15,
};

// ────────────────────────────────────────────────────────
//  GET LEVEL FROM XP
// ────────────────────────────────────────────────────────
export const getLevelFromXP = (xp) => {
  if (!xp || xp < 0) return LEVELS[0];
  let current = LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp >= lvl.xp) current = lvl;
    else break;
  }
  return current;
};

// ────────────────────────────────────────────────────────
//  GET NEXT LEVEL INFO (for progress bar)
// ────────────────────────────────────────────────────────
export const getNextLevel = (xp) => {
  if (!xp || xp < 0) return LEVELS[1] || LEVELS[0];
  for (const lvl of LEVELS) {
    if (xp < lvl.xp) return lvl;
  }
  return LEVELS[LEVELS.length - 1]; // Max level
};

// ────────────────────────────────────────────────────────
//  GET XP PROGRESS (0 to 1) for current level
// ────────────────────────────────────────────────────────
export const getXPProgress = (xp) => {
  const current = getLevelFromXP(xp);
  const next = getNextLevel(xp);
  if (current.level === next.level) return 1; // Max level
  const required = next.xp - current.xp;
  const earned = xp - current.xp;
  return Math.min(1, Math.max(0, earned / required));
};

// ────────────────────────────────────────────────────────
//  GET ALL UNLOCKS for a given level
// ────────────────────────────────────────────────────────
export const getUnlocks = (level) => {
  return LEVELS
    .filter(l => l.level <= level && l.unlock)
    .map(l => l.unlock);
};

// ────────────────────────────────────────────────────────
//  UNLOCK MAPPING & AUTO-GRANT
// ────────────────────────────────────────────────────────
const UNLOCK_ITEM_MAP = {
  greenName: 'emerald_green',
  sparkle: 'sparkle',
  tradeBorder: 'tradeBorder',
  animatedFrame: 'animatedFrame',
  rainbowName: 'rainbow',
  holographic: 'holographic',
};

// ────────────────────────────────────────────────────────
//  ADD XP — fire-and-forget, non-blocking
//  Uses increment() for atomic writes
// ────────────────────────────────────────────────────────
export const addXP = async (db, uid, amount, action = null) => {
  if (!db || !uid || !amount || amount <= 0) return;

  try {
    const xpRef = ref(db, `users/${uid}/xp`);

    // 1. Atomic increment (always — 1 write only)
    await update(xpRef, {
      total: increment(amount),
    });

    // ✅ OPTIMIZATION: For small XP (< 10), skip level recalculation
    // Level only changes at big thresholds (100, 200, 500...) so recalculating
    // for every 2-10 XP gain wastes 2 RTDB reads per call.
    // Level will be recalculated on the next significant XP event (trade, game, quiz).
    if (amount < 10) {
      return null; // Skip level check — saves 2 reads
    }

    // 2. Read new total & recalculate level (only for XP >= 10)
    const snap = await get(ref(db, `users/${uid}/xp/total`));
    const newTotal = snap.val() || 0;
    const newLevel = getLevelFromXP(newTotal);

    // 3. Update level if changed & check for unlocks
    await update(xpRef, {
      level: newLevel.level,
    });

    // Auto-grant level unlocks
    if (newLevel.unlock && UNLOCK_ITEM_MAP[newLevel.unlock]) {
      const rewardKey = newLevel.unlock;
      const rewardSnap = await get(ref(db, `users/${uid}/levelRewards/${rewardKey}`));
      
      // If not already granted
      if (!rewardSnap.exists()) {
        const itemId = UNLOCK_ITEM_MAP[rewardKey];
        const { ALL_ITEMS } = require('./shopItems');
        const item = ALL_ITEMS[itemId];
        
        if (item) {
          const now = Date.now();
          const activeItemData = {
            id: item.id,
            name: item.name,
            rarity: item.rarity,
            activatedAt: now,
            expiresAt: -1, // Permanent
          };
          if (item.color) activeItemData.color = item.color;
          if (item.darkColor) activeItemData.darkColor = item.darkColor;

          // 🛡️ 2026-07-16: Preserve any still-valid active cosmetic of this type
          // into ownedItems before the level unlock takes its slot — legacy items
          // lived only in activeItems and were destroyed by this overwrite.
          try {
            const existingSnap = await get(ref(db, `users/${uid}/shop/activeItems/${item.type}`));
            if (existingSnap.exists()) {
              const existing = existingSnap.val();
              const stillValid = existing?.expiresAt === -1 || existing?.expiresAt > now;
              if (stillValid && existing.id !== item.id) {
                const ownedListSnap = await get(ref(db, `users/${uid}/shop/ownedItems/${item.type}`));
                const ownedList = ownedListSnap.exists() ? Object.values(ownedListSnap.val() || {}) : [];
                if (!ownedList.some(i => i?.id === existing.id)) {
                  await set(push(ref(db, `users/${uid}/shop/ownedItems/${item.type}`)), { ...existing, type: item.type });
                }
              }
            }
          } catch {}

          // Record as granted and set active
          await update(ref(db, `users/${uid}`), {
            [`levelRewards/${rewardKey}`]: now,
            [`shop/activeItems/${item.type}`]: activeItemData,
          });

          // Tell cache to resync next time it loads
          try {
            const { syncMyCosmetics } = require('../Helper/cosmeticsCache');
            syncMyCosmetics(db, uid, true); // Force sync
          } catch {}
        }
      }
    }

    // Cache XP in MMKV for instant renders
    try {
      const { setCachedEggXP } = require('../Helper/cosmeticsCache');
      setCachedEggXP(newTotal);
    } catch {}

    return { total: newTotal, level: newLevel };
  } catch (err) {
    console.warn('[XP] addXP error:', err?.message);
    return null;
  }
};

// ────────────────────────────────────────────────────────
//  GET USER XP DATA
// ────────────────────────────────────────────────────────
export const getUserXP = async (db, uid) => {
  if (!db || !uid) return { total: 0, level: 1 };
  try {
    const snap = await get(ref(db, `users/${uid}/xp`));
    if (!snap.exists()) return { total: 0, level: 1 };
    const data = snap.val();
    return {
      total: data.total || 0,
      level: data.level || getLevelFromXP(data.total || 0).level,
    };
  } catch {
    return { total: 0, level: 1 };
  }
};

// Export LEVELS for UI
export { LEVELS };
