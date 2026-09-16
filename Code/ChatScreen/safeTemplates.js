// Vetted message catalogue for private chat.
//
// This file is the SINGLE SOURCE OF TRUTH for the quick-message drawer AND for
// safe chat (the under-13 mode described in Helper/ageGate.js). The canonical
// English copy lives here, is mirrored into Postgres by
// supabase/028_safe_chat_minors.sql, and the insert trigger rejects any
// restricted message whose text is not an exact match. Regenerate the SQL seed
// with `node scripts/gen-safe-templates-sql.js` after editing this list.
//
// WHY BOTH `en` AND `key`
// A sent message stores the template id in `tpl` and the canonical English in
// `text`. Readers on a current build render t(key) — so a French adult and an
// English child each read the thread in their own language — while older
// builds, push notifications, inbox previews and moderator review all fall
// back to the English `text` that is already there.
//
// IDs ARE PERMANENT. They are written into message rows. Renaming one
// retroactively breaks every message that used it; retire instead of rename.

export const TEMPLATE_CATEGORIES = ['trade', 'friendly', 'safety'];

// id → i18n key suffix is 1:1 (`chat.quick_msg_<id>`), which keeps the 20
// pre-existing trade phrases on the exact keys they already ship with in all
// five locales.
const T = (id, en, category) => ({ id, category, en, key: `chat.quick_msg_${id}` });

export const SAFE_TEMPLATES = [
  // ── Trade ───────────────────────────────────────────────────────────
  T('interest',      'Interested in your trade!',      'trade'),
  T('available',     'Is this still available?',       'trade'),
  T('what_pets',     'What pets do you have?',         'trade'),
  T('have_item',     'I have what you need',           'trade'),
  T('negotiate',     'Can we negotiate?',              'trade'),
  T('best_offer',    "What's your best offer?",        'trade'),
  T('add_more',      'Can you add more?',              'trade'),
  T('add_pets',      "I'll add more pets",             'trade'),
  T('change_item',   'Can you change something?',      'trade'),
  T('fair_trade',    "Fair trade, let's do it!",       'trade'),
  T('make_deal',     "Let's make a deal!",             'trade'),
  T('can_do',        'Can we do this trade?',          'trade'),
  T('discuss',       "I'm interested, let's discuss",  'trade'),
  T('check_inv',     'Let me check my inventory',      'trade'),
  T('ready',         "I'm ready to trade!",            'trade'),
  T('deal_accepted', 'Deal accepted!',                 'trade'),
  T('meet_hub',      'Meet me at the trading hub',     'trade'),
  T('when',          'When can you trade?',            'trade'),
  T('online',        'Are you online?',                'trade'),
  T('thanks',        'Thanks for the trade!',          'trade'),

  // ── Friendly / status ───────────────────────────────────────────────
  T('hi',            'Hi!',                            'friendly'),
  T('how_are_you',   'How are you?',                   'friendly'),
  T('im_good',       "I'm good, thanks!",              'friendly'),
  T('yes',           'Yes',                            'friendly'),
  T('no',            'No',                             'friendly'),
  T('ok',            'OK!',                            'friendly'),
  T('thank_you',     'Thank you!',                     'friendly'),
  T('youre_welcome', "You're welcome!",                'friendly'),
  T('please_wait',   'One moment please',              'friendly'),
  T('brb',           'Be right back',                  'friendly'),
  T('im_back',       "I'm back!",                      'friendly'),
  T('good_luck',     'Good luck!',                     'friendly'),
  T('congrats',      'Congrats!',                      'friendly'),
  T('nice_pets',     'Nice pets!',                     'friendly'),
  T('have_fun',      'Have fun!',                      'friendly'),
  T('not_interested', 'Sorry, not interested',         'friendly'),
  T('maybe_later',   'Maybe later',                    'friendly'),
  T('gtg',           'Got to go',                      'friendly'),
  T('see_you',       'See you later!',                 'friendly'),

  // ── Safety ──────────────────────────────────────────────────────────
  // Give a child a one-tap way to shut a conversation down without having to
  // compose the sentence themselves.
  T('keep_trading',    "Let's keep this about trading", 'safety'),
  T('no_personal_info', "I don't share personal info",  'safety'),
  T('stop_asking',     'Please stop asking me that',    'safety'),
];

// id → template, for O(1) lookup when rendering a received row.
export const TEMPLATE_BY_ID = SAFE_TEMPLATES.reduce((acc, tpl) => {
  acc[tpl.id] = tpl;
  return acc;
}, Object.create(null));

// canonical English → id, so a template sent by tapping the drawer on a build
// that predates `tpl` can still be recognised.
export const TEMPLATE_ID_BY_TEXT = SAFE_TEMPLATES.reduce((acc, tpl) => {
  acc[tpl.en] = tpl.id;
  return acc;
}, Object.create(null));

// =====================================================================
// Game ID sharing
// =====================================================================
// The one non-fixed text a restricted chat allows: the sender's in-game
// username, so a trade can actually happen. Reserved id — NOT in
// SAFE_TEMPLATES, because its `text` is the username rather than fixed copy.
//
// It is never free-typed. The button sends whatever is saved on the sender's
// own profile, which Settings already round-trips through the real Roblox API
// (verifyRobloxUsername), so the string is a genuine Roblox-moderated account
// name. The server re-checks it against the mirrored user_roblox row, which is
// what stops a modified client from smuggling a sentence through this hole.
export const GAME_ID_TEMPLATE_ID = 'game_id';

// Roblox usernames: 3-20 chars, letters/digits/underscore, alphanumeric at
// both ends, at most one underscore. Written without lookbehind on purpose —
// Hermes does not support it.
const ROBLOX_USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_]{1,18}[A-Za-z0-9]$/;

export const normalizeGameId = (raw) => (raw || '').trim();

export const isValidGameId = (raw) => {
  const value = normalizeGameId(raw);
  if (!ROBLOX_USERNAME_RE.test(value)) return false;
  // Count rather than assert with a lookahead — same reason as above.
  let underscores = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === '_') underscores += 1;
  }
  return underscores <= 1;
};

// =====================================================================
// Validation used by both the send path and the render path
// =====================================================================

// True when (tpl, text) is a legal payload for a restricted chat. Mirrors what
// the Postgres trigger enforces — keep the two in step. The trigger addition-
// ally proves a game_id belongs to the sender, which the client cannot.
export const isAllowedSafeMessage = (tpl, text) => {
  if (!tpl) return false;
  if (tpl === GAME_ID_TEMPLATE_ID) return isValidGameId(text);
  const known = TEMPLATE_BY_ID[tpl];
  return !!known && known.en === text;
};
