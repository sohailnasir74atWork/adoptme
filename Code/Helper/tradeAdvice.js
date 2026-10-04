/**
 * tradeAdvice.js — "Should I take it?" for one trade, from the taker's side.
 *
 * Weighs three things the plain Win/Fair/Lose total can't see:
 *   value   — what you get vs what you give (the calculator totals)
 *   trading — how easily each side's pets trade on (marketMap.liquidity,
 *             from last week's trade posts)
 *   trend   — pets whose value just moved (hotMap / dropMap, Elvebredd diff)
 *
 * Returns { verdict: 'take' | 'think' | 'skip', reasons: [{ key, params }] }
 * or null when there is nothing to judge. Pure: no React, no storage.
 */

import { normalizeName } from './analyticsDataHelper';
import { FAIR_BAND, valueGap } from './tradeStatus';

const BIG_GAP = 0.25;

const nameOf = (item) => String(item?.name || item?.Name || '').trim();

const liquidityScore = (items, marketMap) => {
  let score = 0;
  let rated = 0;
  let best = null; // the most notable pet on this side, for the reason text
  items.forEach((item) => {
    const m = marketMap?.[normalizeName(nameOf(item))];
    if (!m || !m.liquidity) return;
    rated += 1;
    score += m.liquidity === 'fast' ? 1 : -1;
    if (!best || m.wanted > best.wanted) best = { name: nameOf(item), ...m };
  });
  return { avg: rated ? score / rated : 0, rated, best };
};

const moved = (items, map) => {
  let top = null;
  items.forEach((item) => {
    const h = map?.[normalizeName(nameOf(item))];
    if (h && (!top || Math.abs(h.pct) > Math.abs(top.pct))) top = { name: nameOf(item), pct: h.pct };
  });
  return top;
};

/**
 * give / receive: arrays of items (the taker gives `give`, receives `receive`).
 * (Not named `get`: Hermes rejects `{ get = [] }` in a parameter pattern.)
 * giveTotal / getTotal: the calculator totals for each side, same source.
 */
export const adviseTrade = ({ give = [], receive = [], giveTotal = 0, getTotal = 0, maps = {} }) => {
  const giveItems = give.filter(Boolean);
  const getItems = receive.filter(Boolean);
  if (!giveItems.length || !getItems.length) return null;
  const gv = Number(giveTotal) || 0;
  const tv = Number(getTotal) || 0;
  if (gv <= 0 && tv <= 0) return null;

  const reasons = [];
  let score = 0;

  // ── Value ──
  const gap = valueGap(gv, tv);
  const pct = Math.round(Math.abs(gap) * 100);
  if (gap > FAIR_BAND) {
    score += gap >= BIG_GAP ? 3 : 2;
    reasons.push({ key: 'value_win', params: { pct }, weight: 2 });
  } else if (gap < -FAIR_BAND) {
    score -= gap <= -BIG_GAP ? 3 : 2;
    reasons.push({ key: 'value_lose', params: { pct }, weight: 3 });
  } else {
    reasons.push({ key: 'value_fair', params: {}, weight: 1 });
  }

  // ── How easily each side trades on ──
  const giveLiq = liquidityScore(giveItems, maps.marketMap);
  const getLiq = liquidityScore(getItems, maps.marketMap);
  if (getLiq.rated && getLiq.avg <= -0.5 && getLiq.best) {
    score -= 1;
    reasons.push({ key: 'get_slow', params: { name: getLiq.best.name }, weight: 2 });
  } else if (getLiq.rated && getLiq.avg >= 0.5 && getLiq.best) {
    score += 1;
    reasons.push({ key: 'get_fast', params: { name: getLiq.best.name, count: getLiq.best.wanted }, weight: 2 });
  }
  if (giveLiq.rated && giveLiq.avg >= 0.5 && giveLiq.best && !(getLiq.avg >= 0.5)) {
    score -= 1;
    reasons.push({ key: 'give_fast', params: { name: giveLiq.best.name, count: giveLiq.best.wanted }, weight: 1 });
  }

  // ── Recent value moves ──
  const getDrop = moved(getItems, maps.dropMap);
  const getRise = moved(getItems, maps.hotMap);
  const giveRise = moved(giveItems, maps.hotMap);
  if (getDrop) {
    score -= 1;
    reasons.push({ key: 'get_dropping', params: { name: getDrop.name, pct: Math.abs(getDrop.pct) }, weight: 2 });
  } else if (getRise) {
    score += 1;
    reasons.push({ key: 'get_rising', params: { name: getRise.name, pct: getRise.pct }, weight: 1 });
  }
  if (giveRise) {
    score -= 1;
    reasons.push({ key: 'give_rising', params: { name: giveRise.name, pct: giveRise.pct }, weight: 1 });
  }

  const verdict = score >= 2 ? 'take' : score <= -2 ? 'skip' : 'think';
  // Lead with the reason that explains the verdict best.
  const ordered = reasons
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .map(({ key, params }) => ({ key, params }));
  return { verdict, score, reasons: ordered.slice(0, 2) };
};

/**
 * The trade feed's take on adviseTrade's result, for someone browsing another
 * player's post. A red "Skip it" there read as a judgement on the post, and
 * people scrolled past without opening it, so the feed never says no: a short
 * deal becomes "worth a counter-offer" with the amount to ask for.
 *
 * giveTotal / getTotal: the same totals passed to adviseTrade.
 * Returns { tone: 'good' | 'close' | 'counter', reason: { key, params } } or
 * null. The ask_more* reasons carry the raw `amount`; the caller formats it.
 */
const BIG_ASK = 0.4; // past this gap, "ask for more" alone sounds hopeless

export const feedNudge = (advice, { giveTotal = 0, getTotal = 0 } = {}) => {
  if (!advice) return null;
  const short = (Number(giveTotal) || 0) - (Number(getTotal) || 0);
  const lose = advice.reasons.find((r) => r.key === 'value_lose');
  // Counter only when the values are short. A fair trade of slow pets stays
  // "could work": the card's ⚖️ already says fair, and the two must agree.
  const tone = lose ? 'counter' : advice.verdict === 'take' ? 'good' : 'close';

  let reason;
  if (lose && short > 0) {
    reason = { key: lose.params.pct >= BIG_ASK * 100 ? 'ask_more_big' : 'ask_more', params: { amount: short } };
  } else {
    // The card already shows the value difference next to the totals, so
    // lead with what the numbers can't say.
    reason = advice.reasons.find((r) => !r.key.startsWith('value_')) || advice.reasons[0];
  }
  return { tone, reason };
};

export const FEED_TONE_STYLE = {
  good: { icon: 'thumbs-up-outline', color: '#10B981' },
  close: { icon: 'swap-horizontal-outline', color: '#F59E0B' },
  counter: { icon: 'chatbubbles-outline', color: '#3B82F6' },
};

export const VERDICT_STYLE = {
  take: { emoji: '✅', color: '#10B981' },
  think: { emoji: '🤔', color: '#F59E0B' },
  skip: { emoji: '❌', color: '#EF4444' },
};
