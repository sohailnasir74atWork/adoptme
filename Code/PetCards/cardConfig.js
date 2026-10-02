/**
 * cardConfig.js — Pet Cards constants (PET_CARDS_PLAN.md).
 *
 * The server (supabase/037_pet_cards.sql) decides everything that matters:
 * odds, pity, shards, crafting costs, serials. The tables here mirror it for
 * DISPLAY only (labels, colours, the odds sheet when the server is slow).
 */

// Where card art lives (scripts/pet-cards/hd-art/upload.py → Bunny). Its own
// zone on purpose: adoptme.b-cdn.net answers EVERY path with the 1.2 MB values
// catalogue, so a missing picture there would cost 1.2 MB instead of a 404.
export const CARDS_CDN = 'https://cardspull.b-cdn.net/v1';
// Dev builds can point at a local art server (scripts/pet-cards/dev-cdn.py).
export const cdnBase = () => (__DEV__ && global.__PET_CARDS_CDN__) || CARDS_CDN;

export const RARITIES = ['common', 'uncommon', 'rare', 'ultra', 'legendary'];

// Adopt Me's own rarity colours (PET_CARDS_PLAN.md §3.2).
export const RARITY_STYLE = {
  common:    { base: '#9AA8B8', light: '#E6ECF2', dark: '#5B6878', glow: '#C9D6E3' },
  uncommon:  { base: '#3DBE5A', light: '#DDF7E3', dark: '#1F7A37', glow: '#5CFF85' },
  rare:      { base: '#2E9BF0', light: '#DCEFFE', dark: '#145E9C', glow: '#4FD2FF' },
  ultra:     { base: '#A855F7', light: '#F1E3FF', dark: '#6B21A8', glow: '#D07BFF' },
  legendary: { base: '#F5A700', light: '#FFF1CC', dark: '#A16207', glow: '#FFD23F' },
};

// Simple → fancy. `fancy` finishes get a global serial number.
export const FINISHES = ['classic', 'foil', 'neon', 'holo', 'gilded', 'mega', 'fullart'];
export const FINISH_STYLE = {
  classic: { mult: 1, fancy: false, chance: 72 },
  foil:    { mult: 2, fancy: false, chance: 14 },
  neon:    { mult: 3, fancy: false, chance: 8 },
  holo:    { mult: 5, fancy: true, chance: 4 },
  gilded:  { mult: 10, fancy: true, chance: 1.4 },
  mega:    { mult: 20, fancy: true, chance: 0.5 },
  fullart: { mult: 40, fancy: true, chance: 0.1 },
};
export const FIRST_EDITION_MAX = 100;   // serial #1–#100 carries the 1st Edition stamp

export const RARITY_POINTS = { common: 1, uncommon: 2, rare: 4, ultra: 8, legendary: 16 };
export const DUPE_SHARDS = { common: 5, uncommon: 10, rare: 25, ultra: 50, legendary: 100 };
export const CRAFT_COST = { common: 40, uncommon: 80, rare: 200, ultra: 400, legendary: 1000 };
export const STAR_PACK_COST = 5;
export const STAR_PACKS_PER_DAY = 2;
export const STREAK_BONUS_EVERY = 7;

// Fallback odds sheet (the server sends the real one in cards_state).
export const DEFAULT_ODDS = {
  slot: { common: 40, uncommon: 28, rare: 18, ultra: 10, legendary: 4 },
  hit: { rare: 55, ultra: 30, legendary: 15 },
  finish: Object.fromEntries(FINISHES.map((f) => [f, FINISH_STYLE[f].chance])),
  bias: 0.45,
  pity_legend: 8,
  pity_holo: 12,
};

// Set themes (PET_CARDS_PLAN.md §3.3). Colours used by frames, packs and screens.
export const THEMES = {
  island: {
    panel: '#FFF9EE', panelText: '#2B2116', subText: '#7A6A55', plate: '#F6EAD3',
    stage: ['#0E2A47', '#1B4F7A', '#F6B26B'], accent: '#F59E0B', packA: '#38BDF8', packB: '#F59E0B',
  },
  haunted: {
    panel: '#1A1230', panelText: '#F4ECFF', subText: '#B9A6D9', plate: '#251A42',
    stage: ['#07040F', '#1C0F33', '#3B1E5E'], accent: '#FF7A1A', packA: '#3B1E5E', packB: '#FF7A1A',
  },
  winter: {
    panel: '#F2F8FF', panelText: '#10243A', subText: '#5B7896', plate: '#E2EEFB',
    stage: ['#06142A', '#12355E', '#7DD3FC'], accent: '#38BDF8', packA: '#1E3A8A', packB: '#7DD3FC',
  },
};
export const themeOf = (id) => THEMES[id] || THEMES.island;

// Art backgrounds (PET_CARDS_ART_PROMPTS.md §7). The CDN files are optional:
// every id has a painted-gradient fallback in cardArt.js.
export const HAUNTED_BGS = ['midway', 'manor', 'patch', 'hotel', 'graveyard', 'swamp'];
export const EGG_IDS = ['farm', 'safari', 'jungle', 'aussie', 'fossil', 'ocean', 'mythic', 'japan', 'danger',
  'woodland', 'moon', 'desert', 'urban', 'endangered', 'fairytale', 'aztec', 'southeast_asia', 'garden'];

// Small stable hash so a card always gets the same variant background.
export const hashKey = (s) => {
  let h = 0;
  // eslint-disable-next-line no-bitwise
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

/**
 * Which background a card shows: Halloween cards → one of six haunted scenes,
 * egg pets → their egg's biome, event pets → the island variant for their
 * event, everyone else → the island meadow. Neon finish → the night island.
 */
export const bgIdFor = (card, finish) => {
  if (!card) return 'island_meadow';
  const sets = card.sets || [];
  if (sets.includes('haunted26')) return `haunted_${HAUNTED_BGS[hashKey(card.key) % HAUNTED_BGS.length]}`;
  if (finish === 'neon') return 'island_night';
  if (card.egg && EGG_IDS.includes(card.egg)) return `egg_${card.egg}`;
  if (card.bg === 'snow' || sets.includes('winter26')) return 'island_snow';
  if (card.bg === 'festival') return 'island_festival';
  if (card.bg === 'beach') return 'island_beach';
  return 'island_meadow';
};

/** Theme for a card's frame: Halloween cards wear the Haunted Carnival theme. */
export const themeIdFor = (card) => ((card?.sets || []).includes('haunted26') ? 'haunted' : 'island');

export const petArtUrl = (key, size = 1024) => {
  if (size <= 512) return `${cdnBase()}/pets/512/${key}.webp`;
  if (size >= 2048) return `${cdnBase()}/pets/2k/${key}.webp`;   // wallpapers only
  return `${cdnBase()}/pets/${key}.webp`;
};
