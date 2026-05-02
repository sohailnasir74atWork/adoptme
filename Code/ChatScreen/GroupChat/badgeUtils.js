/**
 * Badge System — Centralized definitions & check functions
 * Phase 1: OG, Newbie, First Post, First Trade
 * Phase 2+: Chatty, Star Trader, Reviewer, Loved, On Fire, Diamond, Influencer, 5-Star
 * 📅 2026-03-13: Extended with 10 new badges (Pet Parent, Quiz Master, Memory King,
 *   Night Owl, Streak Master, Centurion, Social Bee, Helper, Popular, Collector)
 */

export const BADGE_DEFINITIONS = {
  // ── Phase 1 ──
  newbie: {
    id: 'newbie',
    name: 'Newbie',
    emoji: '🐣',
    color: '#fbbf24',
    bgLight: 'rgba(251,191,36,0.1)',
    bgDark: 'rgba(251,191,36,0.15)',
    description: 'Welcome to the community!',
    hint: 'Auto-earned in your first 7 days',
    tier: 1,
    phase: 1,
  },
  firstPost: {
    id: 'firstPost',
    name: 'Post',
    emoji: '📸',
    color: '#8b5cf6',
    bgLight: 'rgba(139,92,246,0.1)',
    bgDark: 'rgba(139,92,246,0.15)',
    description: 'Posted for the first time!',
    hint: 'Create your first post in the Feed',
    tier: 1,
    phase: 1,
  },
  firstTrade: {
    id: 'firstTrade',
    name: 'Trade',
    emoji: '🤝',
    color: '#10b981',
    bgLight: 'rgba(16,185,129,0.1)',
    bgDark: 'rgba(16,185,129,0.15)',
    description: 'Completed first trade!',
    hint: 'Complete 5 trades',
    tier: 1,
    phase: 1,
  },
  og: {
    id: 'og',
    name: 'OG',
    emoji: '🦄',
    color: '#ec4899',
    bgLight: 'rgba(236,72,153,0.1)',
    bgDark: 'rgba(236,72,153,0.15)',
    description: 'A true original!',
    hint: 'Be a member for 6+ months',
    tier: 3,
    phase: 1,
  },

  // ── Phase 2 ──
  chatty: {
    id: 'chatty',
    name: 'Chatty',
    emoji: '💬',
    color: '#3b82f6',
    bgLight: 'rgba(59,130,246,0.1)',
    bgDark: 'rgba(59,130,246,0.15)',
    description: 'Loves to chat!',
    hint: 'Send 100+ messages',
    tier: 1,
    phase: 2,
  },
  starTrader: {
    id: 'starTrader',
    name: 'Star Trader',
    emoji: '🌟',
    color: '#f59e0b',
    bgLight: 'rgba(245,158,11,0.1)',
    bgDark: 'rgba(245,158,11,0.15)',
    description: 'Trading master in the making!',
    hint: 'Complete 25+ trades',
    tier: 2,
    phase: 2,
  },
  loved: {
    id: 'loved',
    name: 'Loved',
    emoji: '❤️',
    color: '#ec4899',
    bgLight: 'rgba(236,72,153,0.1)',
    bgDark: 'rgba(236,72,153,0.15)',
    description: 'Everyone loves their content!',
    hint: 'Get 100+ reactions on your posts',
    tier: 2,
    phase: 2,
  },
  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    emoji: '📝',
    color: '#6366f1',
    bgLight: 'rgba(99,102,241,0.1)',
    bgDark: 'rgba(99,102,241,0.15)',
    description: 'Helpful community reviewer!',
    hint: 'Leave 25+ reviews',
    tier: 2,
    phase: 2,
  },

  // ── Phase 3 ──
  onFire: {
    id: 'onFire',
    name: 'On Fire',
    emoji: '🔥',
    color: '#ef4444',
    bgLight: 'rgba(239,68,68,0.1)',
    bgDark: 'rgba(239,68,68,0.15)',
    description: '7-day login streak!',
    hint: 'Log in 14 days in a row',
    tier: 2,
    phase: 3,
  },
  petParent: {
    id: 'petParent',
    name: 'Pet Parent',
    emoji: '🐾',
    color: '#f97316',
    bgLight: 'rgba(249,115,22,0.1)',
    bgDark: 'rgba(249,115,22,0.15)',
    description: 'A true pet lover!',
    hint: 'Add 50+ pets to your profile',
    tier: 1,
    phase: 3,
  },
  socialBee: {
    id: 'socialBee',
    name: 'Social Bee',
    emoji: '🐝',
    color: '#eab308',
    bgLight: 'rgba(234,179,8,0.1)',
    bgDark: 'rgba(234,179,8,0.15)',
    description: 'Buzzing everywhere!',
    hint: 'Join 10+ group chats',
    tier: 1,
    phase: 3,
  },
  quizMaster: {
    id: 'quizMaster',
    name: 'Quiz Master',
    emoji: '🧠',
    color: '#8b5cf6',
    bgLight: 'rgba(139,92,246,0.1)',
    bgDark: 'rgba(139,92,246,0.15)',
    description: 'Brain power activated!',
    hint: 'Answer 100+ quiz questions correctly',
    tier: 2,
    phase: 3,
  },
  memoryKing: {
    id: 'memoryKing',
    name: 'Memory King',
    emoji: '🃏',
    color: '#14b8a6',
    bgLight: 'rgba(20,184,166,0.1)',
    bgDark: 'rgba(20,184,166,0.15)',
    description: 'Unbeatable memory!',
    hint: 'Win 25+ memory games',
    tier: 2,
    phase: 3,
  },
  nightOwl: {
    id: 'nightOwl',
    name: 'Night Owl',
    emoji: '🦉',
    color: '#6366f1',
    bgLight: 'rgba(99,102,241,0.1)',
    bgDark: 'rgba(99,102,241,0.15)',
    description: 'Trading in the moonlight!',
    hint: 'Complete 15 trades after midnight',
    tier: 2,
    phase: 3,
  },
  helper: {
    id: 'helper',
    name: 'Helper',
    emoji: '🤲',
    color: '#22c55e',
    bgLight: 'rgba(34,197,94,0.1)',
    bgDark: 'rgba(34,197,94,0.15)',
    description: 'Always there to help!',
    hint: 'Send 1,000+ messages',
    tier: 2,
    phase: 3,
  },

  // ── Phase 4 ──
  diamondTrader: {
    id: 'diamondTrader',
    name: 'Diamond Trader',
    emoji: '💎',
    color: '#06b6d4',
    bgLight: 'rgba(6,182,212,0.1)',
    bgDark: 'rgba(6,182,212,0.15)',
    description: 'Elite trading legend!',
    hint: 'Complete 100+ trades',
    tier: 3,
    phase: 4,
  },
  influencer: {
    id: 'influencer',
    name: 'Influencer',
    emoji: '👑',
    color: '#a855f7',
    bgLight: 'rgba(168,85,247,0.1)',
    bgDark: 'rgba(168,85,247,0.15)',
    description: 'Community celebrity!',
    hint: 'Reach 200+ followers',
    tier: 3,
    phase: 4,
  },
  fiveStar: {
    id: 'fiveStar',
    name: '5-Star',
    emoji: '⭐',
    color: '#fbbf24',
    bgLight: 'rgba(251,191,36,0.1)',
    bgDark: 'rgba(251,191,36,0.15)',
    description: 'Top-rated community member!',
    hint: 'Maintain 4.5+ rating with 50+ reviews',
    tier: 3,
    phase: 4,
  },
  streakMaster: {
    id: 'streakMaster',
    name: 'Streak Master',
    emoji: '💪',
    color: '#dc2626',
    bgLight: 'rgba(220,38,38,0.1)',
    bgDark: 'rgba(220,38,38,0.15)',
    description: 'Unstoppable dedication!',
    hint: 'Reach a 60-day login streak',
    tier: 3,
    phase: 4,
  },
  centurion: {
    id: 'centurion',
    name: 'Centurion',
    emoji: '🏛️',
    color: '#b45309',
    bgLight: 'rgba(180,83,9,0.1)',
    bgDark: 'rgba(180,83,9,0.15)',
    description: '100 trades and counting!',
    hint: 'Complete 250+ trades',
    tier: 3,
    phase: 4,
  },
  popular: {
    id: 'popular',
    name: 'Popular',
    emoji: '📢',
    color: '#e11d48',
    bgLight: 'rgba(225,29,72,0.1)',
    bgDark: 'rgba(225,29,72,0.15)',
    description: 'Everyone loves your content!',
    hint: 'Get 500+ reactions on posts',
    tier: 3,
    phase: 4,
  },
  collector: {
    id: 'collector',
    name: 'Collector',
    emoji: '🗃️',
    color: '#0891b2',
    bgLight: 'rgba(8,145,178,0.1)',
    bgDark: 'rgba(8,145,178,0.15)',
    description: 'Ultimate pet collection!',
    hint: 'Own 200+ pets in your profile',
    tier: 3,
    phase: 4,
  },
};

// 📅 2026-03-13: AI-generated badge images (128×128 PNG, ~569KB total)
export const BADGE_IMAGES = {
  // Common
  newbie: require('../../Assets/badges/badge_newbie.webp'),
  firstPost: require('../../Assets/badges/badge_firstPost.webp'),
  firstTrade: require('../../Assets/badges/badge_firstTrade.webp'),
  chatty: require('../../Assets/badges/badge_chatty.webp'),
  petParent: require('../../Assets/badges/badge_petParent.webp'),
  socialBee: require('../../Assets/badges/badge_socialBee.webp'),
  // Uncommon
  starTrader: require('../../Assets/badges/badge_starTrader.webp'),
  loved: require('../../Assets/badges/badge_loved.webp'),
  reviewer: require('../../Assets/badges/badge_reviewer.webp'),
  onFire: require('../../Assets/badges/badge_onFire.webp'),
  quizMaster: require('../../Assets/badges/badge_quizMaster.webp'),
  memoryKing: require('../../Assets/badges/badge_memoryKing.webp'),
  nightOwl: require('../../Assets/badges/badge_nightOwl.webp'),
  helper: require('../../Assets/badges/badge_helper.webp'),
  // Rare
  og: require('../../Assets/badges/badge_og.webp'),
  diamondTrader: require('../../Assets/badges/badge_diamondTrader.webp'),
  influencer: require('../../Assets/badges/badge_influencer.webp'),
  fiveStar: require('../../Assets/badges/badge_fiveStar.webp'),
  streakMaster: require('../../Assets/badges/badge_streakMaster.webp'),
  centurion: require('../../Assets/badges/badge_centurion.webp'),
  popular: require('../../Assets/badges/badge_popular.webp'),
  collector: require('../../Assets/badges/badge_collector.webp'),
};

// Ordered list for display (hardest badges first)
export const BADGE_DISPLAY_ORDER = [
  'centurion', 'streakMaster', 'collector', 'popular',
  'influencer', 'diamondTrader', 'fiveStar', 'og',
  'nightOwl', 'quizMaster', 'memoryKing', 'helper',
  'onFire', 'starTrader', 'loved', 'reviewer',
  'petParent', 'socialBee', 'chatty', 'firstPost', 'firstTrade', 'newbie',
];

// Only show these badges as pills on the collapsed profile (top prestige badges)
export const PILL_BADGES = [
  'centurion', 'streakMaster', 'collector', 'popular',
  'influencer', 'diamondTrader', 'fiveStar', 'og', 'onFire', 'starTrader',
];

/**
 * Check which badges a user has earned (Phase 1 — computed client-side)
 * @param {Object} userData - user data from Firebase
 * @param {Object} savedBadges - badges already saved in DB (e.g. firstPost, firstTrade)
 * @returns {Object} - { badgeId: true/false } map
 */
export const computeBadges = (userData = {}, savedBadges = {}) => {
  const now = Date.now();
  const createdAt = userData.createdAt || userData.createdAtMs || 0;
  const accountAgeMs = createdAt > 0 ? now - createdAt : 0;

  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
  const SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;

  return {
    // Phase 1 — computed
    newbie: createdAt > 0, // Everyone with an account was once a newbie — permanent badge
    og: createdAt > 0 && accountAgeMs >= SIX_MONTHS,

    // Phase 1 — from DB
    firstPost: !!savedBadges.firstPost,
    firstTrade: !!savedBadges.firstTrade,

    // Phase 2 — from DB
    chatty: !!savedBadges.chatty,
    starTrader: !!savedBadges.starTrader,
    loved: !!savedBadges.loved,
    reviewer: !!savedBadges.reviewer,

    // Phase 3 — from DB
    onFire: !!savedBadges.onFire,
    petParent: !!savedBadges.petParent,
    socialBee: !!savedBadges.socialBee,
    quizMaster: !!savedBadges.quizMaster,
    memoryKing: !!savedBadges.memoryKing,
    nightOwl: !!savedBadges.nightOwl,
    helper: !!savedBadges.helper,

    // Phase 4 — from DB
    diamondTrader: !!savedBadges.diamondTrader,
    influencer: !!savedBadges.influencer,
    fiveStar: !!savedBadges.fiveStar,
    streakMaster: !!savedBadges.streakMaster,
    centurion: !!savedBadges.centurion,
    popular: !!savedBadges.popular,
    collector: !!savedBadges.collector,
  };
};

/**
 * Get the user's highest-tier earned badge.
 * Uses BADGE_DISPLAY_ORDER (hardest first) to pick the top badge.
 * @param {Object} savedBadges - { badgeId: true } map from RTDB
 * @returns {string|null} - badge ID of the top badge, or null
 */
export const getTopBadge = (savedBadges = {}) => {
  if (!savedBadges || typeof savedBadges !== 'object') return null;
  for (const badgeId of BADGE_DISPLAY_ORDER) {
    if (savedBadges[badgeId]) return badgeId;
  }
  return null;
};

/**
 * Recompute and write topBadge to user profile (fire-and-forget).
 * Called internally after awarding a badge — zero extra reads.
 * @param {Object} database - Firebase Realtime DB instance
 * @param {string} userId - user ID
 */
const updateTopBadge = async (database, userId) => {
  try {
    const { ref, get, set } = require('@react-native-firebase/database');
    const badgesSnap = await get(ref(database, `users/${userId}/badges`));
    const badges = badgesSnap.exists() ? badgesSnap.val() : {};
    const top = getTopBadge(badges);
    await set(ref(database, `users/${userId}/topBadge`), top);
  } catch (e) {
    console.warn('[Badges] Failed to update topBadge:', e);
  }
};

/**
 * Award a badge to a user (writes to Firebase Realtime DB)
 * Also updates the user's topBadge field for display.
 * @param {Object} database - Firebase Realtime DB instance
 * @param {string} userId - user ID
 * @param {string} badgeId - badge ID (e.g. 'firstPost')
 */
export const awardBadge = async (database, userId, badgeId) => {
  if (!database || !userId || !badgeId) return;
  try {
    const { ref, set } = require('@react-native-firebase/database');
    await set(ref(database, `users/${userId}/badges/${badgeId}`), true);
    // Fire-and-forget: recompute top badge
    updateTopBadge(database, userId);
  } catch (e) {
    console.warn('[Badges] Failed to award badge:', badgeId, e);
  }
};

/**
 * Increment a counter and award badge if threshold is met
 * Uses atomic increment to avoid race conditions
 * @param {Object} database - Firebase Realtime DB instance
 * @param {string} userId - user ID
 * @param {string} counterName - counter key (e.g. 'tradeCount', 'reviewCount', 'messageCount')
 * @param {Array} thresholds - array of { count, badgeId } to check
 */
export const incrementAndCheckBadge = async (database, userId, counterName, thresholds = []) => {
  if (!database || !userId || !counterName) return;
  try {
    let badgeStore;
    try {
      const { createMMKV } = require('react-native-mmkv');
      badgeStore = createMMKV({ id: 'badge-cache' });
    } catch (e) {
      console.warn('[badgeUtils] MMKV not available:', e.message);
      badgeStore = {
        getBoolean: () => undefined,
        set: () => {},
      };
    }

    // ✅ OPTIMIZATION: Skip entirely if all badges in this threshold list are already earned
    const allEarned = thresholds.every(({ badgeId }) => {
      return badgeStore.getBoolean(`earned_${userId}_${badgeId}`) === true;
    });
    if (allEarned && thresholds.length > 0) return; // All badges already earned — skip Firebase entirely

    const { ref, get, set, increment } = require('@react-native-firebase/database');
    const counterRef = ref(database, `users/${userId}/counters/${counterName}`);
    
    // Atomic increment
    await set(counterRef, increment(1));
    
    // Read new count
    const snap = await get(counterRef);
    const count = snap.exists() ? snap.val() : 0;

    // Check each threshold
    for (const { count: threshold, badgeId } of thresholds) {
      // Skip if we already know this badge is earned
      if (badgeStore.getBoolean(`earned_${userId}_${badgeId}`)) continue;

      if (count >= threshold) {
        // Check if badge already awarded (avoid unnecessary writes)
        const badgeSnap = await get(ref(database, `users/${userId}/badges/${badgeId}`));
        if (!badgeSnap.exists() || !badgeSnap.val()) {
          await set(ref(database, `users/${userId}/badges/${badgeId}`), true);
          // Fire-and-forget: recompute top badge
          updateTopBadge(database, userId);
        }
        // Mark as earned in MMKV — never check Firebase again for this badge
        badgeStore.set(`earned_${userId}_${badgeId}`, true);
      }
    }
  } catch (e) {
    console.warn('[Badges] Counter badge check failed:', counterName, e);
  }
};

// ── Pre-defined threshold configs ──

export const TRADE_BADGE_THRESHOLDS = [
  { count: 5, badgeId: 'firstTrade' },
  { count: 25, badgeId: 'starTrader' },
  { count: 100, badgeId: 'diamondTrader' },
  { count: 250, badgeId: 'centurion' },
];

export const REVIEW_BADGE_THRESHOLDS = [
  { count: 25, badgeId: 'reviewer' },
];

export const MESSAGE_BADGE_THRESHOLDS = [
  { count: 100, badgeId: 'chatty' },
  { count: 1000, badgeId: 'helper' },
];

export const REACTION_BADGE_THRESHOLDS = [
  { count: 100, badgeId: 'loved' },
  { count: 500, badgeId: 'popular' },
];

export const QUIZ_BADGE_THRESHOLDS = [
  { count: 100, badgeId: 'quizMaster' },
];

export const MEMORY_BADGE_THRESHOLDS = [
  { count: 25, badgeId: 'memoryKing' },
];

export const NIGHT_TRADE_BADGE_THRESHOLDS = [
  { count: 15, badgeId: 'nightOwl' },
];

export const GROUP_CHAT_BADGE_THRESHOLDS = [
  { count: 10, badgeId: 'socialBee' },
];

/**
 * Check and update daily login streak
 * Call once per app open (MainTabs mount)
 * - Yesterday → increment streak
 * - Today → skip (already counted)
 * - Older → reset to 1
 * - Streak >= 7 → award 'onFire' badge
 * @param {Object} database - Firebase Realtime DB instance
 * @param {string} userId - user ID
 */
export const checkDailyStreak = async (database, userId) => {
  if (!database || !userId) return;
  try {
    const { ref, get, set } = require('@react-native-firebase/database');
    const streakRef = ref(database, `users/${userId}/streak`);
    const snap = await get(streakRef);
    const data = snap.exists() ? snap.val() : null;

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (data?.lastDate === todayStr) {
      // Already logged in today — skip
      return;
    }

    let newStreak = 1;

    if (data?.lastDate) {
      // Check if lastDate was yesterday
      const lastDate = new Date(data.lastDate + 'T00:00:00');
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

      if (data.lastDate === yesterdayStr) {
        // Consecutive day — increment
        newStreak = (data.count || 0) + 1;
      }
      // else: gap > 1 day — reset to 1
    }

    // Save updated streak
    await set(streakRef, {
      count: newStreak,
      lastDate: todayStr,
    });

    // Award onFire badge at 14-day streak
    if (newStreak >= 14) {
      const badgeSnap = await get(ref(database, `users/${userId}/badges/onFire`));
      if (!badgeSnap.exists() || !badgeSnap.val()) {
        await set(ref(database, `users/${userId}/badges/onFire`), true);
      }
    }

    // Award streakMaster badge at 60-day streak
    if (newStreak >= 60) {
      const masterSnap = await get(ref(database, `users/${userId}/badges/streakMaster`));
      if (!masterSnap.exists() || !masterSnap.val()) {
        await set(ref(database, `users/${userId}/badges/streakMaster`), true);
      }
    }
  } catch (e) {
    console.warn('[Badges] Streak check failed:', e);
  }
};

/**
 * Check and award Influencer badge (100+ followers)
 * Call after a follow action
 * @param {Object} database - Firebase Realtime DB instance
 * @param {Object} firestoreDB - Firestore instance
 * @param {string} followedUserId - the user who was just followed
 */
export const checkInfluencerBadge = async (database, firestoreDB, followedUserId) => {
  if (!database || !firestoreDB || !followedUserId) return;
  try {
    const { ref, get, set } = require('@react-native-firebase/database');
    const { collection, query, where, getCountFromServer } = require('@react-native-firebase/firestore');

    // Check if already awarded
    const badgeSnap = await get(ref(database, `users/${followedUserId}/badges/influencer`));
    if (badgeSnap.exists() && badgeSnap.val()) return; // Already has badge

    // Count followers from Firestore
    const followersQuery = query(
      collection(firestoreDB, 'following'),
      where('followingId', '==', followedUserId)
    );
    
    const countSnap = await getCountFromServer(followersQuery);
    const followerCount = countSnap.data().count;

    if (followerCount >= 200) {
      await set(ref(database, `users/${followedUserId}/badges/influencer`), true);
    }
  } catch (e) {
    console.warn('[Badges] Influencer check failed:', e);
  }
};

/**
 * Check and award 5-Star badge (4.5+ avg with 20+ reviews)
 * Call after a rating is submitted
 * @param {Object} database - Firebase Realtime DB instance
 * @param {string} ratedUserId - the user who received the rating
 * @param {number} newAverage - the new average rating
 * @param {number} newCount - the new review count
 */
export const checkFiveStarBadge = async (database, ratedUserId, newAverage, newCount) => {
  if (!database || !ratedUserId) return;
  try {
    const { ref, get, set } = require('@react-native-firebase/database');

    if (newAverage >= 4.5 && newCount >= 50) {
      const badgeSnap = await get(ref(database, `users/${ratedUserId}/badges/fiveStar`));
      if (!badgeSnap.exists() || !badgeSnap.val()) {
        await set(ref(database, `users/${ratedUserId}/badges/fiveStar`), true);
      }
    }
  } catch (e) {
    console.warn('[Badges] 5-Star check failed:', e);
  }
};

/**
 * 📅 2026-03-13: Check and award Pet Parent badge (20+ pets in profile)
 * Call after user updates their owned pets list
 */
export const checkPetParentBadge = async (database, userId, petCount) => {
  if (!database || !userId) return;
  try {
    const { ref, get, set } = require('@react-native-firebase/database');
    if (petCount >= 50) {
      const badgeSnap = await get(ref(database, `users/${userId}/badges/petParent`));
      if (!badgeSnap.exists() || !badgeSnap.val()) {
        await set(ref(database, `users/${userId}/badges/petParent`), true);
      }
    }
  } catch (e) {
    console.warn('[Badges] Pet Parent check failed:', e);
  }
};

/**
 * 📅 2026-03-13: Check and award Collector badge (100+ pets in profile)
 * Call after user updates their owned pets list
 */
export const checkCollectorBadge = async (database, userId, petCount) => {
  if (!database || !userId) return;
  try {
    const { ref, get, set } = require('@react-native-firebase/database');
    if (petCount >= 200) {
      const badgeSnap = await get(ref(database, `users/${userId}/badges/collector`));
      if (!badgeSnap.exists() || !badgeSnap.val()) {
        await set(ref(database, `users/${userId}/badges/collector`), true);
      }
    }
  } catch (e) {
    console.warn('[Badges] Collector check failed:', e);
  }
};

/**
 * 📅 2026-03-13: Check if trade was made after midnight (Night Owl)
 * Call after a trade is completed — pass the trade timestamp
 */
export const checkNightOwlTrade = async (database, userId) => {
  if (!database || !userId) return;
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 5) { // Between midnight and 5am
    await incrementAndCheckBadge(database, userId, 'nightTradeCount', NIGHT_TRADE_BADGE_THRESHOLDS);
  }
};

