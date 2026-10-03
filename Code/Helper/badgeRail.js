/**
 * badgeRail.js — which badges a player wears, in priority order.
 *
 * One list for every surface (UserBadgeRail.jsx draws it), in this order:
 *
 *   authority role (admin > mod > jmd) → trusted → cmsr (house, then art)
 *   → helper → squad rank (3+ friends inline; any friend on the profile)
 *   → verified
 *
 * Inline rows show every badge (no cap) as icons and move the one labelled
 * authority chip to the end (inlineOrder); the profile drawer keeps ORDER.
 *
 * CMSR is two badges with one name: House CMSR (`isCMSR`, the original flag)
 * and Art CMSR (`isArtCMSR`). Same "CMSR" label, different icon; a player can
 * wear both.
 *
 * Pro is not in the list: it is never cut (the paywall promises it next to
 * the name), so the rail draws it on its own.
 */

import { rankFor } from './squad';

export const ORDER = ['admin', 'mod', 'jmd', 'trusted', 'cmsr_house', 'cmsr_art', 'helper', 'squad', 'verified'];
export const AUTHORITY = ['admin', 'mod', 'jmd'];

const count = (u) => Number(u.squadCount) || 0;

// Authority badges stay mutually exclusive (admin beats mod beats jmd), as
// the old per-surface blocks had them.
const HAS = {
  admin: (u) => !!u.isAdmin,
  mod: (u) => !u.isAdmin && !!u.isModerator,
  jmd: (u) => !u.isAdmin && !u.isModerator && !!u.isBabyMod,
  trusted: (u) => !!u.isTrusted,
  cmsr_house: (u) => !!u.isCMSR,
  cmsr_art: (u) => !!u.isArtCMSR,
  helper: (u) => !!u.isHelper,
  // 'rank': only once the squad has a rank (3+, Code/Helper/squad.js RANKS);
  // 'any': from the first counted friend (the profile drawer).
  squad: (u, { squad }) => (squad === 'any' ? count(u) >= 1 : !!rankFor(count(u))),
  verified: (u) => !!u.robloxUsernameVerified,
};

/**
 * Badge keys this user wears, in ORDER. `allowed` lets a surface leave some
 * out (group chats never show app-wide Admin/Mod); `squad` is 'rank' or 'any'.
 */
export const badgeKeysFor = (u, { allowed = ORDER, squad = 'rank' } = {}) => {
  if (!u) return [];
  const opts = { squad };
  return ORDER.filter((k) => allowed.includes(k) && HAS[k](u, opts));
};

/** Inline order: the icon badges in ORDER, then the authority chip last. */
export const inlineOrder = (keys) => {
  if (!Array.isArray(keys)) return [];
  return [...keys.filter((k) => !AUTHORITY.includes(k)), ...keys.filter((k) => AUTHORITY.includes(k))];
};
