/**
 * tradeAdvice.js — the guide line under a trade, written for the taker.
 *
 * The WIN / FAIR / LOSE totals already show the value gap, so the guide never
 * turns it into "skip it", "ask for more" or "offer less". That talked buyers
 * out of trades the other side was happy to make. It says what is good about
 * what they'd get instead: how often it is asked for in trades, how many
 * players wishlist it, whether its value is climbing. All from the weekly
 * analytics file. Pure: no React, no storage.
 */

import { normalizeName } from './analyticsDataHelper';
import { FAIR_BAND, valueGap } from './tradeStatus';

const nameOf = (item) => String(item?.name || item?.Name || '').trim();

/**
 * Used by the trade feed (the viewer gives the poster's wants and gets the
 * poster's has) and the Home calculator (Me gives, You gets).
 *
 * give / receive: arrays of items. (Not named `get`: Hermes rejects
 * `{ get = [] }` in a parameter pattern.)
 * giveTotal / getTotal: the totals shown for each side, same value source.
 * maps: { demandMap, marketMap, wishMap, hotMap } (hotMap only for trades
 * priced on Elvebredd values; the moves come from that diff).
 * Returns { tone: 'good' | 'popular' | 'close', reason: { key, params } | null,
 * extra: { key, params } | null, demand: 1-10 | null } or null. `extra` is
 * the next-best thing to say, for screens with room for a second line.
 * A short trade with nothing good to say about the taker's side returns
 * null: no line at all, rather than a negative one.
 */
const STRONG_DEMAND = 8; // 8-10/10 ≈ the 100 most-asked-for items this week
const STEADY_DEMAND = 6;
const MANY_ASKS = 10;
const SOME_ASKS = 5;
const MANY_WISHLISTS = 20;

// Best first. Within a tier, the item with the bigger number wins.
const highlightsFor = (item, maps) => {
  const name = nameOf(item);
  const key = normalizeName(name);
  const demand = maps.demandMap?.[key];
  const asks = Number(maps.marketMap?.[key]?.wanted) || 0;
  const wishes = Number(maps.wishMap?.[key]?.count) || 0;
  const hot = maps.hotMap?.[key];
  const out = [];
  if (asks >= MANY_ASKS) out.push({ tier: 5, n: asks, key: 'asked_for', params: { name, count: asks } });
  if (wishes >= MANY_WISHLISTS) out.push({ tier: 4, n: wishes, key: 'wishlisted', params: { name, count: wishes } });
  if (hot?.pct > 0) out.push({ tier: 3, n: hot.pct, key: 'get_rising', params: { name, pct: hot.pct } });
  if (asks >= SOME_ASKS) out.push({ tier: 2, n: asks, key: 'asked_for', params: { name, count: asks } });
  if (demand?.score >= STEADY_DEMAND) out.push({ tier: 1, n: demand.score, key: 'steady_demand', params: { name, score: demand.score } });
  return out;
};

export const tradeHighlight = ({ give = [], receive = [], giveTotal = 0, getTotal = 0, maps = {} }) => {
  const getItems = receive.filter(Boolean);
  if (!give.filter(Boolean).length || !getItems.length) return null;
  const gv = Number(giveTotal) || 0;
  const tv = Number(getTotal) || 0;
  if (gv <= 0 && tv <= 0) return null;

  const ranked = getItems
    .flatMap((item) => highlightsFor(item, maps || {}))
    .sort((a, b) => b.tier - a.tier || b.n - a.n);
  const best = ranked[0];
  // asked_for and steady_demand both say "people ask for it": the second line
  // needs another pet or another kind of fact (wishlists, rising value).
  const family = (h) => (h.key === 'steady_demand' ? 'asked_for' : h.key);
  const next = best && ranked.find((h) => h.params.name !== best.params.name || family(h) !== family(best));
  const demand = getItems.reduce((top, item) => {
    const score = maps?.demandMap?.[normalizeName(nameOf(item))]?.score || 0;
    return Math.max(top, score);
  }, 0);
  const reason = best ? { key: best.key, params: best.params } : null;
  const extra = next ? { key: next.key, params: next.params } : null;
  const shownDemand = demand >= STEADY_DEMAND ? demand : null;
  const out = (tone, r) => ({ tone, reason: r, extra, demand: shownDemand });

  const gap = valueGap(gv, tv);
  if (gap > FAIR_BAND) return out('good', reason || { key: 'value_win', params: { pct: Math.round(gap * 100) } });
  const popular = best && (best.tier >= 2 || demand >= STRONG_DEMAND);
  if (popular) return out('popular', reason);
  if (gap >= -FAIR_BAND) return out('close', reason || { key: 'value_fair', params: {} });
  if (reason) return out('close', reason);
  return null;
};

export const TONE_STYLE = {
  good: { icon: 'thumbs-up-outline', color: '#10B981' },
  popular: { icon: 'flame-outline', color: '#8B5CF6' },
  close: { icon: 'swap-horizontal-outline', color: '#F59E0B' },
};
