/**
 * tradeStatus.js — the one Win / Fair / Lose rule for every screen.
 *
 * Elvebredd, AdoptMeWFL and GG all call a trade fair only when both totals
 * are exactly equal (checked in their calculator code, 2026-10-03), so 0.01
 * apart already reads WIN or LOSE. We keep a band instead: within 5% of the
 * bigger side, either way, is FAIR. Screens show the exact difference next
 * to the word, so a player can still match it against those sites.
 *
 * give: what you hand over. get: what you receive.
 */

export const FAIR_BAND = 0.05;

// Signed gap as a fraction of the bigger side: + you get more, - you give more.
export const valueGap = (give, get) => {
  const g = Number(give) || 0;
  const r = Number(get) || 0;
  const big = Math.max(g, r);
  return big > 0 ? (r - g) / big : 0;
};

export const tradeStatus = (give, get) => {
  const gap = valueGap(give, get);
  if (gap > FAIR_BAND) return 'win';
  if (gap < -FAIR_BAND) return 'lose';
  return 'fair';
};

// The single letter stored on posted trades and matched by the feed filters.
export const STATUS_LETTER = { win: 'w', lose: 'l', fair: 'f' };

// The trade feed reads trades from the buyer's side, the opposite of the
// poster's calculator: the Win chip finds trades the poster saved as a lose.
export const BUYER_FILTER_LETTER = { win: 'l', lose: 'w', fair: 'f' };
