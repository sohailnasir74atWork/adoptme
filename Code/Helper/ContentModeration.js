import Filter from 'leo-profanity';

/**
 * Comprehensive Content Moderation Utility
 * Detects: profanity, spam, inappropriate content, links, scams
 */

// ✅ Initialize leo-profanity filter
Filter.loadDictionary('en');

// ✅ Custom spam/scam keywords and phrases
const SPAM_KEYWORDS = [
  // Spam/Scam phrases
  'subscribe my channel',
  'subscribe to my channel',
  'subscribe to channel',
  'check out my channel',
  'visit my channel',
  // Note: "free", "give away", "giveaway", "free gems" are normal trading-game
  // talk and are intentionally NOT blocked. Only real scam phrases stay below.
  'free robux',
  'click here',
  'limited time',
  'act now',
  'discord.gg',
  'discord.com',
  'join discord',
  'add me on discord',



  'exploit',
  'mod menu',
  'free account',
  'selling account',
  'buy account',
  'trade account',
  'account for sale',

  'referral code',
  'rose toy',
];

// ✅ Inappropriate content patterns (beyond profanity)
const INAPPROPRIATE_PATTERNS = [
  // Core porn/NSFW signals (incl. light obfuscation)
  /p\W*o\W*r\W*n/i,
  /p\*rn/i,
  /\bxxx\b/i,
  /\bnsfw\b/i,
  /\badult\s*content\b/i,
  /\bexplicit\b/i,
  /\bsex(?:ual|y|ually)?\b/i,
  /\berotic(?:a)?\b/i,
  /\bhard\s*core\b/i,
  /\bsoft\s*core\b/i,

  // Nudity
  /\bnude(?:s)?\b/i,
  /\bnaked\b/i,
  /\bnudity\b/i,

  // Breasts / chest
  /\bboob(?:s|ies)?\b/i,
  /\bbreast(?:s)?\b/i,
  /\btit(?:s|ties|ty)?\b/i,
  /\bcleavage\b/i,
  /\bnipple(?:s)?\b/i,
  /\bareolae?\b/i,

  // Penis terms
  /\bpenis\b/i,
  /\bdick\b/i,
  /\bcock\b/i,
  /\bschlong\b/i,
  /\bwang\b/i,

  // Vulva/vagina terms (note: some are strong slurs; include only if you truly want them blocked)
  /\bvagina\b/i,
  /\bclit\b/i,
  /\blabia\b/i,
  /\bpuss(?:y|ies)\b/i,
  /\bcunt\b/i,

  // Butt / anus
  /\bbutt\b/i,
  /\bbooty\b/i,
  /\bass(?:hole)?\b/i,
  /\banus\b/i,

  // Sex acts
  /\banal\b/i,
  /\boral\b/i,
  /\bblow\s*job\b/i,
  /\bhand\s*job\b/i,
  /\brim\s*job\b/i,
  /\bfellatio\b/i,
  /\bcunnilingus\b/i,

  // Masturbation / fluids
  /\bmasturbat(?:e|es|ed|ing|ion)\b/i,
  /\bjerk\s*off\b/i,
  /\borgasm(?:s|ic)?\b/i,
  /\bcum(?:shot|ming)?\b/i,
  /\bejaculat(?:e|es|ed|ing|ion)\b/i,

  // Kink / fetish
  /\bbdsm\b/i,
  /\bkink(?:y)?\b/i,
  /\bfetish(?:es)?\b/i,
];

// ✅ Extra kid-safety blocked words / phrases.
// This list is meant to be easy to grow — just add entries below.
// Single words match as whole words (so "abuse" won't flag "abuses"? it will,
// because variants are listed); phrases allow flexible spacing.
// Matching is case-insensitive.
const EXTRA_BLOCKED_WORDS = [
  // Abuse / harassment
  'abuse', 'abusive', 'abuser',
  // Sexual violence
  'rape', 'raping', 'rapist', 'molest', 'molester',
  'pedo', 'pedophile', 'paedophile', 'incest', 'bestiality',
  // Sexual slurs / acts not already covered by patterns
  'horny', 'slut', 'whore', 'prostitute', 'hooker',
  'orgy', 'gangbang', 'creampie', 'deepthroat',
  'dildo', 'vibrator', 'buttplug',
  // Self-harm
  'suicide', 'self harm', 'self-harm', 'kys', 'kill yourself',
  // Predatory / unsafe requests
  'send nudes', 'send nude', 'send pics', 'send pic',
];

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Pre-compile a whole-word, case-insensitive regex per entry. Spaces inside a
// phrase become \s+ so "send  nudes" / "send\nnudes" still match.
const EXTRA_BLOCKED_REGEXES = EXTRA_BLOCKED_WORDS.map((w) => {
  const body = escapeRegExp(w.trim().toLowerCase()).replace(/\s+/g, '\\s+');
  return new RegExp(`\\b${body}\\b`, 'i');
});

/**
 * Check if text contains an entry from the extra kid-safety blocklist.
 * @param {string} text - Text to check
 * @returns {boolean} - True if a blocked word/phrase is found
 */
export const containsExtraBlocked = (text) => {
  if (!text || typeof text !== 'string') return false;
  return EXTRA_BLOCKED_REGEXES.some((re) => re.test(text));
};

// ✅ Allowed link domains (YouTube + TikTok)
const ALLOWED_LINK_PATTERNS = [
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i,
  /(?:https?:\/\/)?(?:www\.)?tiktok\.com\//i,
  /(?:https?:\/\/)?vm\.tiktok\.com\//i,
];

// ✅ URL patterns (already covered, but included for completeness)
const URL_PATTERNS = [
  /https?:\/\//i,
  /www\./i,
  /\.(com|net|org|io|co|me|xyz|dev|app|tech|tv|gg|link|click|online|site|website|web|blog|shop|store|buy|sale|deal)/i,
];

/**
 * Check if text contains profanity using leo-profanity
 * @param {string} text - Text to check
 * @returns {boolean} - True if profanity detected
 */
export const containsProfanity = (text) => {
  if (!text || typeof text !== 'string') return false;
  return Filter.check(text);
};

/**
 * Check if text contains spam keywords
 * @param {string} text - Text to check
 * @returns {boolean} - True if spam detected
 */
export const containsSpam = (text) => {
  if (!text || typeof text !== 'string') return false;
  const lowerText = text.toLowerCase();
  return SPAM_KEYWORDS.some(keyword => lowerText.includes(keyword.toLowerCase()));
};

/**
 * Check if text contains inappropriate patterns
 * @param {string} text - Text to check
 * @returns {boolean} - True if inappropriate content detected
 */
export const containsInappropriateContent = (text) => {
  if (!text || typeof text !== 'string') return false;
  return INAPPROPRIATE_PATTERNS.some(pattern => pattern.test(text));
};

/**
 * Check if text contains URLs/links
 * @param {string} text - Text to check
 * @returns {boolean} - True if URL detected
 */
export const containsLink = (text) => {
  if (!text || typeof text !== 'string') return false;
  return URL_PATTERNS.some(pattern => pattern.test(text));
};

/**
 * Check if a link in the text is an allowed domain (YouTube or TikTok)
 * @param {string} text - Text to check
 * @returns {boolean} - True if the link is YouTube or TikTok
 */
export const isAllowedLink = (text) => {
  if (!text || typeof text !== 'string') return false;
  return ALLOWED_LINK_PATTERNS.some(pattern => pattern.test(text));
};

/**
 * Comprehensive content moderation check
 * Checks for: profanity, spam, inappropriate content, links
 * @param {string} text - Text to check
 * @param {{skipLinkCheck?: boolean, skipAll?: boolean}} [options] - Options
 *   - skipLinkCheck: bypass only the link check
 *   - skipAll: bypass every check (used for admins/full moderators)
 * @returns {{isValid: boolean, reason?: string}} - Validation result
 */
export const validateContent = (text, options = {}) => {
  if (!text || typeof text !== 'string') {
    return { isValid: true }; // Empty text is valid
  }

  // Full bypass — admins / full moderators can post anything.
  if (options.skipAll) {
    return { isValid: true };
  }

  // Check profanity
  if (containsProfanity(text)) {
    return {
      isValid: false,
      reason: 'Inappropriate language is not allowed.',
    };
  }

  // Check spam keywords
  if (containsSpam(text)) {
    return {
      isValid: false,
      reason: 'Spam content is not allowed.',
    };
  }

  // Check inappropriate patterns + extra kid-safety blocklist
  if (containsInappropriateContent(text) || containsExtraBlocked(text)) {
    return {
      isValid: false,
      reason: 'Inappropriate content is not allowed.',
    };
  }

  // Check links (skip for admins/mods)
  if (!options.skipLinkCheck && containsLink(text)) {
    return {
      isValid: false,
      reason: 'Links are not allowed in messages.',
    };
  }

  return { isValid: true };
};

/**
 * Get detailed violation information (for admin/debugging)
 * @param {string} text - Text to check
 * @returns {object} - Detailed violation info
 */
export const getContentViolations = (text) => {
  if (!text || typeof text !== 'string') {
    return {
      hasViolations: false,
      violations: [],
    };
  }

  const violations = [];

  if (containsProfanity(text)) {
    violations.push('profanity');
  }
  if (containsSpam(text)) {
    violations.push('spam');
  }
  if (containsInappropriateContent(text) || containsExtraBlocked(text)) {
    violations.push('inappropriate_content');
  }
  if (containsLink(text)) {
    violations.push('link');
  }

  return {
    hasViolations: violations.length > 0,
    violations,
  };
};

/**
 * Clean profanity from text (replace with asterisks)
 * @param {string} text - Text to clean
 * @returns {string} - Cleaned text
 */
export const cleanProfanity = (text) => {
  if (!text || typeof text !== 'string') return text;
  return Filter.clean(text);
};

