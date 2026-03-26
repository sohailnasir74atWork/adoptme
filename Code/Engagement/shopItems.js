/**
 * shopItems.js — Mystery Egg & Cosmetic Item Catalog
 * 📅 2026-03-13: Created for XP Shop / Mystery Egg system
 *
 * Defines all egg tiers, reward pools, and cosmetic item definitions
 * for Profile Frames, Chat Text Colors, and Trade Card Backgrounds.
 */

// ════════════════════════════════════════════════════════════
//  RARITY TIERS
// ════════════════════════════════════════════════════════════
export const RARITY = {
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  LEGENDARY: 'legendary',
  EXCLUSIVE: 'exclusive',
};

export const RARITY_CONFIG = {
  [RARITY.COMMON]:    { label: 'Common',    color: '#94a3b8', emoji: '⚪', bgLight: '#f1f5f9', bgDark: '#1e293b' },
  [RARITY.UNCOMMON]:  { label: 'Uncommon',  color: '#22c55e', emoji: '🟢', bgLight: '#f0fdf4', bgDark: '#14532d' },
  [RARITY.RARE]:      { label: 'Rare',      color: '#3b82f6', emoji: '🔵', bgLight: '#eff6ff', bgDark: '#1e3a5f' },
  [RARITY.LEGENDARY]: { label: 'Legendary', color: '#f59e0b', emoji: '🟡', bgLight: '#fffbeb', bgDark: '#78350f' },
  [RARITY.EXCLUSIVE]: { label: 'Exclusive', color: '#a855f7', emoji: '🟣', bgLight: '#faf5ff', bgDark: '#581c87' },
};

// ════════════════════════════════════════════════════════════
//  COSMETIC TYPES
// ════════════════════════════════════════════════════════════
export const COSMETIC_TYPE = {
  FRAME: 'profileFrame',
  TEXT_COLOR: 'chatTextColor',
  TRADE_BG: 'tradeCardBg',
  BANNER: 'profileBanner',
  CHAT_BG: 'chatBubbleBg',
};

// ════════════════════════════════════════════════════════════
//  PROFILE FRAMES (15 total)
//  Rendered as styled borders around avatar. Each frame has:
//  - borderColor(s) for the ring
//  - borderWidth
//  - Optional glow/shadow color
//  duration: days (-1 = permanent)
// ════════════════════════════════════════════════════════════
export const FRAMES = {
  rainbow_glow: {
    id: 'rainbow_glow',
    name: '🌈 Rainbow Glow',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.LEGENDARY,
    duration: 30,
    borderColors: ['#FF6B6B', '#FFA07A', '#FFD700', '#7CFC00', '#00CED1', '#9370DB'],
    borderWidth: 4,
    glowColor: '#FFD70060',
  },
  pastel_ring: {
    id: 'pastel_ring',
    name: '🩷 Pastel Ring',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.COMMON,
    duration: 1,
    borderColors: ['#F9A8D4'],
    borderWidth: 4,
    glowColor: null,
  },
  fire_ring: {
    id: 'fire_ring',
    name: '🔥 Fire Ring',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    borderColors: ['#F97316', '#EF4444'],
    borderWidth: 4,
    glowColor: '#F9731640',
  },
  frost_crystal: {
    id: 'frost_crystal',
    name: '❄️ Frost Crystal',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    borderColors: ['#38BDF8', '#A5F3FC'],
    borderWidth: 4,
    glowColor: '#38BDF840',
  },
  ocean_wave: {
    id: 'ocean_wave',
    name: '🌊 Ocean Wave',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    borderColors: ['#0EA5E9', '#06B6D4'],
    borderWidth: 4,
    glowColor: '#0EA5E940',
  },
  butterfly_wings: {
    id: 'butterfly_wings',
    name: '🦋 Butterfly Wings',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    borderColors: ['#F0ABFC', '#C084FC', '#E879F9'],
    borderWidth: 4,
    glowColor: '#E879F940',
  },
  diamond: {
    id: 'diamond',
    name: '💎 Diamond',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.RARE,
    duration: 7,
    borderColors: ['#93C5FD', '#BFDBFE', '#60A5FA'],
    borderWidth: 4,
    glowColor: '#60A5FA50',
  },
  neon_unicorn: {
    id: 'neon_unicorn',
    name: '🦄 Neon Unicorn',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.RARE,
    duration: 7,
    borderColors: ['#A855F7', '#EC4899'],
    borderWidth: 4,
    glowColor: '#A855F750',
  },
  cherry_blossom: {
    id: 'cherry_blossom',
    name: '🌸 Cherry Blossom',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.RARE,
    duration: 7,
    borderColors: ['#FDA4AF', '#FBCFE8'],
    borderWidth: 4,
    glowColor: '#FDA4AF40',
  },
  cotton_cloud: {
    id: 'cotton_cloud',
    name: '☁️ Cotton Cloud',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.RARE,
    duration: 7,
    borderColors: ['#FFFFFF', '#BAE6FD', '#FBCFE8', '#E0E7FF'],
    borderWidth: 4,
    glowColor: '#BAE6FD50',
  },
  starlight_princess: {
    id: 'starlight_princess',
    name: '👸 Starlight Princess',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.LEGENDARY,
    duration: 30,
    borderColors: ['#F9A8D4', '#FBBF24', '#F472B6', '#FDE68A'],
    borderWidth: 4,
    glowColor: '#FBBF2460',
  },
  royal_crown: {
    id: 'royal_crown',
    name: '👑 Royal Crown',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.LEGENDARY,
    duration: 30,
    borderColors: ['#F59E0B', '#FBBF24', '#D97706'],
    borderWidth: 4,
    glowColor: '#F59E0B60',
  },
  neon_kawaii: {
    id: 'neon_kawaii',
    name: '💖 Neon Kawaii',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.LEGENDARY,
    duration: 30,
    borderColors: ['#FF6EB4', '#A855F7', '#FF1493', '#D946EF'],
    borderWidth: 4,
    glowColor: '#FF6EB460',
  },
  crystal_heart: {
    id: 'crystal_heart',
    name: '💎❤️ Crystal Heart',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.EXCLUSIVE,
    duration: -1, // permanent
    borderColors: ['#F43F5E', '#FDA4AF', '#FFFFFF', '#FB7185', '#FECDD3'],
    borderWidth: 4,
    glowColor: '#F43F5E60',
  },
  holographic: {
    id: 'holographic',
    name: '✨ Holographic',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.EXCLUSIVE,
    duration: -1, // permanent
    borderColors: ['#A855F7', '#EC4899', '#3B82F6', '#10B981', '#F59E0B'],
    borderWidth: 4,
    glowColor: '#A855F760',
  },
  sparkle: {
    id: 'sparkle',
    name: '✨ Sparkle (Lv10)',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.EXCLUSIVE,
    duration: -1, // permanent
    borderColors: ['#FDE047', '#FEF08A'],
    borderWidth: 4,
    glowColor: '#FDE04760',
  },
  tradeBorder: {
    id: 'tradeBorder',
    name: '💼 Trade Pro (Lv15)',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.EXCLUSIVE,
    duration: -1, // permanent
    borderColors: ['#10B981', '#34D399'],
    borderWidth: 4,
    glowColor: '#10B98160',
  },
  animatedFrame: {
    id: 'animatedFrame',
    name: '⭐ Rising Star (Lv20)',
    type: COSMETIC_TYPE.FRAME,
    rarity: RARITY.EXCLUSIVE,
    duration: -1, // permanent
    borderColors: ['#FACC15', '#F59E0B', '#EF4444', '#EC4899'],
    borderWidth: 4,
    glowColor: '#FACC1560',
  },
};

// ════════════════════════════════════════════════════════════
//  CHAT TEXT COLORS (8 total)
//  Applied to the sender's message text in group + private chat.
//  Apple-style vibrant mid-tones — readable on both #0f172a and #ffffff.
//  duration: days (-1 = permanent)
// ════════════════════════════════════════════════════════════
export const TEXT_COLORS = {
  pastel_pink: {
    id: 'pastel_pink',
    name: '🩷 Bubblegum',
    type: COSMETIC_TYPE.TEXT_COLOR,
    rarity: RARITY.COMMON,
    duration: 1,
    color: '#FF6B9D',   // Bright bubblegum pink — fun & girly
  },
  ocean_blue: {
    id: 'ocean_blue',
    name: '💙 Sky Blue',
    type: COSMETIC_TYPE.TEXT_COLOR,
    rarity: RARITY.COMMON,
    duration: 1,
    color: '#4DA6FF',   // Bright sky blue — friendly & cheerful
  },
  emerald_green: {
    id: 'emerald_green',
    name: '💚 Lime',
    type: COSMETIC_TYPE.TEXT_COLOR,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    color: '#4CD964',   // Bright lime green — playful & energetic
  },
  sunset_orange: {
    id: 'sunset_orange',
    name: '🧡 Mango',
    type: COSMETIC_TYPE.TEXT_COLOR,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    color: '#FF9500',   // Warm mango orange — fun & bold
  },
  purple_dream: {
    id: 'purple_dream',
    name: '💜 Grape',
    type: COSMETIC_TYPE.TEXT_COLOR,
    rarity: RARITY.RARE,
    duration: 7,
    color: '#BF5AF2',   // Vivid grape purple — magical & fun
  },
  ruby_red: {
    id: 'ruby_red',
    name: '❤️ Cherry',
    type: COSMETIC_TYPE.TEXT_COLOR,
    rarity: RARITY.RARE,
    duration: 7,
    color: '#FF3B5C',   // Bright cherry red — bold & exciting
  },
  candy: {
    id: 'candy',
    name: '🍬 Candy',
    type: COSMETIC_TYPE.TEXT_COLOR,
    rarity: RARITY.LEGENDARY,
    duration: 30,
    color: 'candy',     // special — alternates pink/purple per character
    colors: ['#FF6B9D', '#BF5AF2', '#FF3B5C', '#FF9500'],
  },
  golden: {
    id: 'golden',
    name: '💛 Gold',
    type: COSMETIC_TYPE.TEXT_COLOR,
    rarity: RARITY.LEGENDARY,
    duration: 30,
    color: '#FFD60A',   // Bright gold — premium & shiny
  },
  rainbow: {
    id: 'rainbow',
    name: '🌈 Rainbow',
    type: COSMETIC_TYPE.TEXT_COLOR,
    rarity: RARITY.EXCLUSIVE,
    duration: -1, // permanent
    color: 'rainbow', // special — each character gets a different color
    colors: ['#FF3B5C', '#FF9500', '#FFD60A', '#4CD964', '#4DA6FF', '#BF5AF2'],
  },
};

// ════════════════════════════════════════════════════════════
//  TRADE CARD BACKGROUNDS (8 total)
//  Applied as background tint on user's trade posts.
//  Premium tinted bgs — rich enough to notice, light enough for text.
//  Light: vibrant tinted white. Dark: deep jewel tones.
//  duration: days (-1 = permanent)
// ════════════════════════════════════════════════════════════
export const TRADE_BG_COLORS = {
  cotton_candy: {
    id: 'cotton_candy',
    name: '🍬 Cotton Candy',
    type: COSMETIC_TYPE.TRADE_BG,
    rarity: RARITY.COMMON,
    duration: 1,
    color: '#FFD6E8',      // warm pink tinted white
    darkColor: '#3D1A2B',  // deep rose
  },
  mint_fresh: {
    id: 'mint_fresh',
    name: '🍃 Mint Fresh',
    type: COSMETIC_TYPE.TRADE_BG,
    rarity: RARITY.COMMON,
    duration: 1,
    color: '#C4F5DE',      // minty bright
    darkColor: '#0D3B2C',  // deep teal
  },
  sky_blue: {
    id: 'sky_blue',
    name: '☁️ Sky Blue',
    type: COSMETIC_TYPE.TRADE_BG,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    color: '#C7E2FF',      // crisp sky tint
    darkColor: '#142A47',  // deep navy
  },
  sunset_glow: {
    id: 'sunset_glow',
    name: '🌅 Sunset Glow',
    type: COSMETIC_TYPE.TRADE_BG,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    color: '#FFE0B2',      // warm amber tint
    darkColor: '#3D2008',  // burnished brown
  },
  lavender_dream: {
    id: 'lavender_dream',
    name: '💜 Lavender Dream',
    type: COSMETIC_TYPE.TRADE_BG,
    rarity: RARITY.RARE,
    duration: 7,
    color: '#DDD6FE',      // rich lavender
    darkColor: '#2E1065',  // deep purple
  },
  cherry_pop: {
    id: 'cherry_pop',
    name: '🍒 Cherry Pop',
    type: COSMETIC_TYPE.TRADE_BG,
    rarity: RARITY.RARE,
    duration: 7,
    color: '#FFB8C6',      // vivid cherry pink
    darkColor: '#4A0D22',  // deep crimson
  },
  golden_hour: {
    id: 'golden_hour',
    name: '✨ Golden Hour',
    type: COSMETIC_TYPE.TRADE_BG,
    rarity: RARITY.LEGENDARY,
    duration: 30,
    color: '#FEEAA0',      // rich gold tint
    darkColor: '#3B2506',  // deep amber
  },
  aurora: {
    id: 'aurora',
    name: '🌌 Aurora',
    type: COSMETIC_TYPE.TRADE_BG,
    rarity: RARITY.EXCLUSIVE,
    duration: -1,
    color: '#C4B5FD',      // holographic purple-blue
    darkColor: '#1E1145',  // deep indigo
  },
};

// ════════════════════════════════════════════════════════════
//  PROFILE BANNER GRADIENTS (8 total)
//  Applied to the gradient banner at the top of the profile drawer.
//  Each has a 3-color gradient array [start, mid, end].
//  Bright, saturated — these are full-bleed banners, so go bold!
//  duration: days (-1 = permanent)
// ════════════════════════════════════════════════════════════
export const BANNER_GRADIENTS = {
  ocean_breeze: {
    id: 'ocean_breeze',
    name: '🌊 Ocean Breeze',
    type: COSMETIC_TYPE.BANNER,
    rarity: RARITY.COMMON,
    duration: 1,
    gradient: ['#0077FF', '#00B4D8', '#00E5A0'],
  },
  rose_garden: {
    id: 'rose_garden',
    name: '🌹 Rose Garden',
    type: COSMETIC_TYPE.BANNER,
    rarity: RARITY.COMMON,
    duration: 1,
    gradient: ['#FF2D55', '#FF375F', '#FF6090'],
  },
  forest_glow: {
    id: 'forest_glow',
    name: '🌲 Forest Glow',
    type: COSMETIC_TYPE.BANNER,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    gradient: ['#00875A', '#30D158', '#63E6BE'],
  },
  sunset_blaze: {
    id: 'sunset_blaze',
    name: '🌅 Sunset Blaze',
    type: COSMETIC_TYPE.BANNER,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    gradient: ['#FF6B00', '#FF9500', '#FFD60A'],
  },
  midnight_sky: {
    id: 'midnight_sky',
    name: '🌃 Midnight Sky',
    type: COSMETIC_TYPE.BANNER,
    rarity: RARITY.RARE,
    duration: 7,
    gradient: ['#0F172A', '#1E3A5F', '#5E60CE'],
  },
  candy_pop: {
    id: 'candy_pop',
    name: '🍭 Candy Pop',
    type: COSMETIC_TYPE.BANNER,
    rarity: RARITY.RARE,
    duration: 7,
    gradient: ['#FF2D78', '#BF5AF2', '#5E5CE6'],
  },
  golden_royale: {
    id: 'golden_royale',
    name: '👑 Golden Royale',
    type: COSMETIC_TYPE.BANNER,
    rarity: RARITY.LEGENDARY,
    duration: 30,
    gradient: ['#C77A00', '#FFB300', '#FFD60A'],
  },
  aurora_borealis: {
    id: 'aurora_borealis',
    name: '✨ Aurora Borealis',
    type: COSMETIC_TYPE.BANNER,
    rarity: RARITY.EXCLUSIVE,
    duration: -1,
    gradient: ['#5E5CE6', '#BF5AF2', '#FF2D55'],
  },
};

// ════════════════════════════════════════════════════════════
//  CHAT BUBBLE BACKGROUNDS (8 total)
//  Applied as background tint on user's chat message bubbles.
//  Premium tinted bgs — noticeable but text-friendly.
//  Light: rich tinted pastels. Dark: deep vibrant tones.
//  Text on dark bgs automatically uses lighter text.
//  duration: days (-1 = permanent)
// ════════════════════════════════════════════════════════════
export const CHAT_BG_COLORS = {
  soft_blush: {
    id: 'soft_blush',
    name: '🩷 Rose Quartz',
    type: COSMETIC_TYPE.CHAT_BG,
    rarity: RARITY.COMMON,
    duration: 1,
    color: '#FFD1DC',      // rich rose tint
    darkColor: '#3D1028',  // deep plum
  },
  mint_fresh: {
    id: 'mint_fresh',
    name: '🍃 Jade',
    type: COSMETIC_TYPE.CHAT_BG,
    rarity: RARITY.COMMON,
    duration: 1,
    color: '#B8F0D5',      // vivid mint
    darkColor: '#0B3D2E',  // deep forest
  },
  sky_breeze: {
    id: 'sky_breeze',
    name: '☁️ Sapphire',
    type: COSMETIC_TYPE.CHAT_BG,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    color: '#B3D9FF',      // saturated sky
    darkColor: '#0F2847',  // deep ocean
  },
  lavender_mist: {
    id: 'lavender_mist',
    name: '💜 Amethyst',
    type: COSMETIC_TYPE.CHAT_BG,
    rarity: RARITY.UNCOMMON,
    duration: 3,
    color: '#D4C4FC',      // rich lavender
    darkColor: '#241554',  // deep violet
  },
  peach_cream: {
    id: 'peach_cream',
    name: '🍑 Coral',
    type: COSMETIC_TYPE.CHAT_BG,
    rarity: RARITY.RARE,
    duration: 7,
    color: '#FFCBA4',      // warm coral
    darkColor: '#3A1D08',  // deep bronze
  },
  ocean_depth: {
    id: 'ocean_depth',
    name: '🌊 Aqua',
    type: COSMETIC_TYPE.CHAT_BG,
    rarity: RARITY.RARE,
    duration: 7,
    color: '#A8DEFF',      // bright aqua
    darkColor: '#083554',  // deep teal
  },
  golden_glow_bg: {
    id: 'golden_glow_bg',
    name: '✨ Amber',
    type: COSMETIC_TYPE.CHAT_BG,
    rarity: RARITY.LEGENDARY,
    duration: 30,
    color: '#FDE68A',      // rich amber
    darkColor: '#452A08',  // deep honey
  },
  holographic_bg: {
    id: 'holographic_bg',
    name: '🌈 Holographic',
    type: COSMETIC_TYPE.CHAT_BG,
    rarity: RARITY.EXCLUSIVE,
    duration: -1,
    color: '#C7B2FF',      // vivid holo purple
    darkColor: '#15102E',  // deep space
  },
};

// ════════════════════════════════════════════════════════════
//  ALL ITEMS (combined lookup)
// ════════════════════════════════════════════════════════════
export const ALL_ITEMS = { ...FRAMES, ...TEXT_COLORS, ...TRADE_BG_COLORS, ...BANNER_GRADIENTS, ...CHAT_BG_COLORS };

// ════════════════════════════════════════════════════════════
//  EGG DEFINITIONS
//  Each egg has a cost and weighted drop table.
//  Drop table maps rarity → weight (probability).
// ════════════════════════════════════════════════════════════
export const EGGS = {
  common_egg: {
    id: 'common_egg',
    name: 'Common Egg',
    emoji: '🥚',
    cost: 3,
    color: '#D4A574',
    description: 'A basic egg with mostly common rewards',
    dropTable: {
      [RARITY.COMMON]: 70,
      [RARITY.UNCOMMON]: 25,
      [RARITY.RARE]: 5,
      [RARITY.LEGENDARY]: 0,
      [RARITY.EXCLUSIVE]: 0,
    },
  },
  star_egg: {
    id: 'star_egg',
    name: 'Star Egg',
    emoji: '⭐',
    cost: 7,
    color: '#FBBF24',
    description: 'Better odds for uncommon and rare items',
    dropTable: {
      [RARITY.COMMON]: 50,
      [RARITY.UNCOMMON]: 35,
      [RARITY.RARE]: 15,
      [RARITY.LEGENDARY]: 0,
      [RARITY.EXCLUSIVE]: 0,
    },
  },
  crystal_egg: {
    id: 'crystal_egg',
    name: 'Crystal Egg',
    emoji: '💎',
    cost: 15,
    color: '#60A5FA',
    description: 'High chance of rare + legendary rewards',
    dropTable: {
      [RARITY.COMMON]: 0,
      [RARITY.UNCOMMON]: 30,
      [RARITY.RARE]: 50,
      [RARITY.LEGENDARY]: 20,
      [RARITY.EXCLUSIVE]: 0,
    },
  },
  royal_egg: {
    id: 'royal_egg',
    name: 'Royal Egg',
    emoji: '👑',
    cost: 30,
    color: '#A855F7',
    description: 'The rarest egg — exclusive items possible!',
    dropTable: {
      [RARITY.COMMON]: 0,
      [RARITY.UNCOMMON]: 0,
      [RARITY.RARE]: 40,
      [RARITY.LEGENDARY]: 40,
      [RARITY.EXCLUSIVE]: 20,
    },
  },
};

export const EGG_LIST = Object.values(EGGS);

// Helper: Get all items of a specific rarity
export const getItemsByRarity = (rarity) => {
  return Object.values(ALL_ITEMS).filter(item => item.rarity === rarity);
};
