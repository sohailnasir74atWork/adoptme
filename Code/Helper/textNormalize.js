// =====================================================================
// textNormalize.js — the shared normalisation used by content moderation.
//
// Used by ContentModeration.js to turn a message into a form the blocklist in
// blocklist.js can be matched against. Cheap by design: one pass to split, a
// little per-token work, then Set lookups — no per-term regex.
//
// WHY NORMALISE AT ALL
// The old filter did an exact word match against a dictionary after replacing
// only '.' and ',' with spaces (leo-profanity's `sanitize`). That meant a
// single trailing '!' defeated it: "fuck!" went straight through, as did
// "fuck?", "oh fuck!", "(fuck)" and "fuck-you", because none of those
// characters were separators as far as the dictionary lookup was concerned.
//
// NO LOOKBEHIND IN HERE, DELIBERATELY
// `(?<=...)` is the natural way to say "a leet character with a letter on
// either side", and it is what this file used first. It is not worth the risk:
// Hermes compiles regex literals at RUNTIME, so an unsupported construct is
// not a build error — it is a SyntaxError thrown while the module loads, which
// on this code path means the app dies on the import that every chat screen
// makes. The index-based substitution below says the same thing with no
// assertion at all, and as a bonus it handles runs of adjacent leet characters
// ("n00b") that a consuming pattern would only half-convert.
// =====================================================================

// Leetspeak substitutions. Applied to a token only when that token already
// contains a real letter, which is what keeps "top 5" from becoming "top s"
// and the year "2024" from turning into nonsense — while still catching
// "sh!t", "b1tch", "f4g" and "n00b".
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'l' };

// The four leet characters that are not alphanumeric. Tokens are split on
// everything EXCEPT these, so that "sh!t" survives as one token; a leading or
// trailing one was ordinary punctuation ("fuck!") and gets trimmed off after.
const SYMBOL_EDGES = /^[@$!|]+|[@$!|]+$/g;
const TOKEN_SPLIT = /[^a-z0-9@$!|]+/;
const HAS_LETTER = /[a-z]/;
const REPEATS = /(.)\1+/g;

const deleetToken = (token) => {
  if (!HAS_LETTER.test(token)) return token;
  let out = '';
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    out += LEET[ch] !== undefined ? LEET[ch] : ch;
  }
  return out;
};

/**
 * Word tokens for whole-word matching.
 *
 * Returns, for each word: the word as written (lowercased, leet undone), the
 * same word with runs of repeated characters collapsed so "fuuuck" and
 * "fuckkk" both reduce to "fuck", and — for runs of very short tokens — the
 * run rejoined, so "f u c k" reduces to "fuck" too.
 *
 * Collapsing is offered as an EXTRA token rather than replacing the original,
 * because collapsing is lossy: "ass" collapses to "as", and "as" is a word.
 * Keeping both means "ass" still matches the term 'ass' while the innocent
 * "as" matches nothing.
 *
 * @param {string} text
 * @param {Set<string>} [allow] - words whose collapsed form must NOT be
 *   emitted, because collapsing them lands on a banned term by accident
 *   ("rapping" -> "raping"). See ALLOWED_TOKENS in blocklist.js.
 * @returns {string[]} unique tokens, never null
 */
export const moderationTokens = (text, allow) => {
  if (!text || typeof text !== 'string') return [];

  const words = [];
  for (const piece of text.toLowerCase().split(TOKEN_SPLIT)) {
    const trimmed = piece.replace(SYMBOL_EDGES, '');
    if (trimmed) words.push(deleetToken(trimmed));
  }

  const out = new Set();
  const addCollapsed = (word) => {
    const collapsed = word.replace(REPEATS, '$1');
    if (collapsed !== word) out.add(collapsed);
  };

  for (const word of words) {
    out.add(word);
    if (allow && allow.has(word)) continue;
    addCollapsed(word);
  }

  // Letter-spacing evasion: "f u c k", "f-u-c-k", "fu c k".
  //
  // Rejoin each maximal run of two or more tokens that are all one or two
  // characters long, and offer the result as another token. Nobody writes a
  // banned word that way by accident, and normal text only ever produces
  // harmless joins out of this ("I a m" -> "iam", "is it ok" -> "isitok").
  //
  // This is deliberately narrower than squashing the whole message, which is
  // what the squash form does. Whole-message squashing cannot be used for
  // single words because it matches across ordinary word boundaries: "wish it"
  // becomes "wishit", "happen is" becomes "happenis", "who reads" becomes
  // "whoreads". Joining only short runs has no such failure mode.
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      const joined = run.join('');
      if (joined.length >= 3 && joined.length <= 20) {
        out.add(joined);
        addCollapsed(joined);
      }
    }
    run = [];
  };
  for (const word of words) {
    if (word.length <= 2) run.push(word);
    else flush();
  }
  flush();

  return [...out];
};

/**
 * The message with every non-letter removed, for substring matching.
 *
 * This is what makes phrases matchable at all, since a phrase can never be a
 * single token, and it catches punctuated spelling ("s.e.n.d n-u-d-e-s").
 * Leet substitution is unconditional here because everything that is not a
 * letter is dropped straight afterwards, so position cannot matter.
 *
 * Repeats are deliberately NOT collapsed: doing it across the whole message
 * would turn "Niger" into a slur hit and "bookkeeper" into "bokeper".
 * Repetition is handled by the token path instead.
 *
 * @param {string} text
 * @returns {string}
 */
export const moderationSquash = (text) => {
  if (!text || typeof text !== 'string') return '';
  const lowered = text.toLowerCase();
  let out = '';
  for (let i = 0; i < lowered.length; i += 1) {
    const ch = lowered[i];
    const mapped = LEET[ch] !== undefined ? LEET[ch] : ch;
    if (mapped >= 'a' && mapped <= 'z') out += mapped;
  }
  return out;
};
