import Filter from 'leo-profanity';
import { ACTIVE_BLOCKLIST, ALLOWED_TOKENS } from './blocklist';
import { moderationTokens, moderationSquash } from './textNormalize';

/**
 * Content moderation for chat, posts and comments.
 * Detects: profanity, slurs, sexual content, grooming, self-harm, threats,
 * drugs, off-platform contact solicitation, scams and links.
 *
 * ---------------------------------------------------------------------
 * COST
 * ---------------------------------------------------------------------
 * Two passes over the message, then O(1) lookups:
 *
 *   tokens  -> Set.has()  per token        (~10-30 lookups)
 *   squash  -> ONE compiled alternation regex
 *   links   -> 3 + 3 small regexes
 *
 * The previous version ran ~125 regexes and ~25 substring scans on every
 * send: 60 INAPPROPRIATE_PATTERNS + 40 EXTRA_BLOCKED_REGEXES + 25
 * SPAM_KEYWORDS `includes()`, all of them executed even when the first one
 * already matched. Both index structures below are built once at import.
 *
 * ---------------------------------------------------------------------
 * WHAT CHANGED, AND WHY IT MATTERED
 * ---------------------------------------------------------------------
 * Matching used to be `leo-profanity`'s exact-word lookup, whose sanitiser
 * only replaces '.' and ',' with spaces. Every one of these reached the room:
 *
 *     fuck!   fuck?   oh fuck!   (fuck)   fuck-you   shit!   bitch!
 *     fuk   fck   f*ck   fuuuck   fucc   phuck   f u c k   sh!t   b1tch
 *
 * Normalisation in textNormalize.js closes the punctuation, repetition and
 * leetspeak families outright; the rest are spelled out as their own rows in
 * blocklist.js. leo-profanity's dictionary is still folded in below, so its
 * coverage is kept — it just gets matched properly now.
 */

// ---------------------------------------------------------------------
// Index 1 — whole-word terms.
//
// leo-profanity's 253-word EN dictionary is merged in rather than called at
// runtime. Its own `check()` does a linear scan of that array per token; a Set
// does the same job in O(1), and going through our tokeniser means its words
// finally survive a trailing '!'.
// ---------------------------------------------------------------------
Filter.loadDictionary('en');

const WORD_TERMS = new Set([
  ...ACTIVE_BLOCKLIST.filter((t) => t.mode === 'word').map((t) => t.term),
  ...Filter.list().map((w) => String(w).toLowerCase().replace(/[^a-z0-9]/g, '')),
].filter(Boolean));

// ---------------------------------------------------------------------
// Index 2 — squash terms (phrases, and long words safe to match inside
// other text), as a single alternation compiled once.
//
// Longest-first so the alternation reports the most specific hit rather than
// whichever prefix it reached first — 'sendnudes' over 'nudes'.
// ---------------------------------------------------------------------
const SQUASH_TERMS = ACTIVE_BLOCKLIST
  .filter((t) => t.mode === 'squash' && t.term)
  .map((t) => t.term)
  .sort((a, b) => b.length - a.length);

const SQUASH_RE = SQUASH_TERMS.length
  ? new RegExp(SQUASH_TERMS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'))
  : null;

// Category lookup, for callers that want to tailor the message shown or log
// which kind of rule fired. Built from the same rows, so it cannot drift.
const TERM_CATEGORY = new Map(ACTIVE_BLOCKLIST.map((t) => [t.term, t.category]));

// ✅ Allowed link domains (YouTube + TikTok)
const ALLOWED_LINK_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i,
  /(?:https?:\/\/)?(?:www\.)?tiktok\.com\//i,
  /(?:https?:\/\/)?vm\.tiktok\.com\//i,
];

// ✅ URL patterns
const URL_PATTERNS = [
  /https?:\/\//i,
  /www\./i,
  /\.(com|net|org|io|co|me|xyz|dev|app|tech|tv|gg|link|click|online|site|website|web|blog|shop|store|buy|sale|deal)/i,
];

/**
 * Find the first blocked term in a piece of text.
 * @param {string} text
 * @returns {{term: string, category: string}|null} - null when clean
 */
export const findBlockedTerm = (text) => {
  if (!text || typeof text !== 'string') return null;

  for (const token of moderationTokens(text, ALLOWED_TOKENS)) {
    if (WORD_TERMS.has(token)) {
      return { term: token, category: TERM_CATEGORY.get(token) || 'profanity' };
    }
  }

  if (SQUASH_RE) {
    const hit = SQUASH_RE.exec(moderationSquash(text));
    if (hit) {
      return { term: hit[0], category: TERM_CATEGORY.get(hit[0]) || 'profanity' };
    }
  }

  return null;
};

/**
 * Check if text contains profanity or any other blocked content.
 * @param {string} text - Text to check
 * @returns {boolean} - True if blocked content detected
 */
export const containsProfanity = (text) => findBlockedTerm(text) !== null;

/**
 * Check if text contains scam/spam terms specifically.
 * @param {string} text - Text to check
 * @returns {boolean} - True if spam detected
 */
export const containsSpam = (text) => findBlockedTerm(text)?.category === 'scam';

/**
 * Check if text contains sexual, grooming or other inappropriate content.
 * Kept as a named export because callers outside chat use it directly.
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export const containsInappropriateContent = (text) => {
  const hit = findBlockedTerm(text);
  return !!hit && hit.category !== 'scam';
};

/** @deprecated Merged into the blocklist. Kept so older imports still resolve. */
export const containsExtraBlocked = containsInappropriateContent;

/**
 * Check if text contains URLs/links
 * @param {string} text - Text to check
 * @returns {boolean} - True if URL detected
 */
export const containsLink = (text) => {
  if (!text || typeof text !== 'string') return false;
  return URL_PATTERNS.some((pattern) => pattern.test(text));
};

/**
 * Check if a link in the text is an allowed domain (YouTube or TikTok)
 * @param {string} text - Text to check
 * @returns {boolean} - True if the link is YouTube or TikTok
 */
export const isAllowedLink = (text) => {
  if (!text || typeof text !== 'string') return false;
  return ALLOWED_LINK_PATTERNS.some((pattern) => pattern.test(text));
};

// Per-category copy. Callers currently show a single translated string, but
// the category rides along on the result so a more specific message (or a
// self-harm helpline instead of a scolding) can be wired up without touching
// the matching code.
const REASONS = {
  scam: 'Spam content is not allowed.',
  selfharm: 'This message cannot be sent. If you need someone to talk to, please reach out to a trusted adult.',
  grooming: 'This message cannot be sent.',
};

/**
 * Comprehensive content moderation check
 * @param {string} text - Text to check
 * @param {{skipLinkCheck?: boolean, skipAll?: boolean}} [options] - Options
 *   - skipLinkCheck: bypass only the link check
 *   - skipAll: bypass every check (used for admins/full moderators)
 * @returns {{isValid: boolean, reason?: string, category?: string}} - Validation result
 */
export const validateContent = (text, options = {}) => {
  if (!text || typeof text !== 'string') {
    return { isValid: true }; // Empty text is valid
  }

  // Full bypass — admins / full moderators can post anything.
  if (options.skipAll) {
    return { isValid: true };
  }

  const hit = findBlockedTerm(text);
  if (hit) {
    return {
      isValid: false,
      category: hit.category,
      reason: REASONS[hit.category] || 'Inappropriate language is not allowed.',
    };
  }

  // Check links (skip for admins/mods)
  if (!options.skipLinkCheck && containsLink(text)) {
    return {
      isValid: false,
      category: 'link',
      reason: 'Links are not allowed in messages.',
    };
  }

  return { isValid: true };
};

/**
 * Get detailed violation information (for admin/debugging)
 * @param {string} text - Text to check
 * @returns {{hasViolations: boolean, violations: string[], term?: string}}
 */
export const getContentViolations = (text) => {
  const hit = findBlockedTerm(text);
  const violations = [];

  if (hit) violations.push(hit.category);
  if (containsLink(text)) violations.push('link');

  return {
    hasViolations: violations.length > 0,
    violations,
    term: hit?.term,
  };
};

/**
 * Clean profanity from text (replace with asterisks).
 * Note: this only masks leo-profanity's dictionary, not the full blocklist,
 * and nothing in the app calls it — sends are rejected outright instead.
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
export const cleanProfanity = (text) => {
  if (!text || typeof text !== 'string') return text;
  return Filter.clean(text);
};
