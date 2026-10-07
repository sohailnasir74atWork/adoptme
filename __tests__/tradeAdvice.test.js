jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({ getString: () => undefined, getNumber: () => undefined, set: () => {}, remove: () => {} }),
}));

const { tradeHighlight } = require('../Code/Helper/tradeAdvice');
const { liquidityFor } = require('../Code/Helper/analyticsDataHelper');

const maps = {
  marketMap: {
    'crystal egg': { wanted: 175, offered: 16, liquidity: 'fast' },
    'throwback egg': { wanted: 18, offered: 110, liquidity: 'slow' },
    catte: { wanted: 3, offered: 70, liquidity: 'slow' },
    cow: { wanted: 31, offered: 65, liquidity: null },
  },
  hotMap: { 'silverback gorilla': { pct: 26, isHot: true } },
};
const pet = (name) => ({ name });

describe('liquidityFor', () => {
  it('matches the calibration week', () => {
    expect(liquidityFor(175, 16)).toBe('fast');
    expect(liquidityFor(156, 364)).toBe('fast'); // Ride potion: traded like currency
    expect(liquidityFor(18, 110)).toBe('slow');
    expect(liquidityFor(41, 133)).toBe('fast'); // Cattuccino: 40+ asks a week sells, however many are offered
    expect(liquidityFor(31, 65)).toBeNull(); // Cow: busy both ways
    expect(liquidityFor(1, 2)).toBeNull(); // too little data
  });
});

describe('tradeHighlight', () => {
  const feedMaps = {
    ...maps,
    demandMap: {
      'crystal egg': { score: 10 }, cow: { score: 7 }, catte: { score: 3 }, 'giant panda': { score: 7 },
    },
    wishMap: { 'bat dragon': { count: 151 }, cow: { count: 12 } },
  };
  const hl = (args) => tradeHighlight({ maps: feedMaps, ...args });
  const all = (r) => JSON.stringify(r);

  it('never tells the buyer to ask for more or offer less', () => {
    const r = hl({ give: [pet('Cow')], receive: [pet('Crystal Egg')], giveTotal: 20, getTotal: 10 });
    expect(all(r)).not.toMatch(/ask_more|offer|amount/);
    expect(r).toEqual({
      tone: 'popular',
      reason: { key: 'asked_for', params: { name: 'Crystal Egg', count: 175 } },
      extra: null, // not "keep asking for" right after "asked for in 175 trades"
      demand: 10,
    });
  });

  it('leads with how wanted the pet is on a good deal too', () => {
    const r = hl({ give: [pet('Catte')], receive: [pet('Bat Dragon'), pet('Cow')], giveTotal: 10, getTotal: 12 });
    expect(r.tone).toBe('good');
    expect(r.reason).toEqual({ key: 'asked_for', params: { name: 'Cow', count: 31 } });
  });

  it('gives a second line about another pet or another kind of fact', () => {
    const r = hl({ give: [pet('Catte')], receive: [pet('Bat Dragon'), pet('Cow')], giveTotal: 10, getTotal: 12 });
    expect(r.extra).toEqual({ key: 'wishlisted', params: { name: 'Bat Dragon', count: 151 } });
    const one = hl({ give: [pet('Cow')], receive: [pet('Silverback Gorilla'), pet('Giant Panda')], giveTotal: 10, getTotal: 10 });
    expect(one.reason.key).toBe('get_rising');
    expect(one.extra).toEqual({ key: 'steady_demand', params: { name: 'Giant Panda', score: 7 } });
  });

  it('uses wishlists when nobody asked for it in trades', () => {
    const r = hl({ give: [pet('Cow')], receive: [pet('Bat Dragon')], giveTotal: 10, getTotal: 10 });
    expect(r).toEqual({ tone: 'popular', reason: { key: 'wishlisted', params: { name: 'Bat Dragon', count: 151 } }, extra: null, demand: null });
  });

  it('mentions a rising pet only when value moves are passed in', () => {
    const args = { give: [pet('Cow')], receive: [pet('Silverback Gorilla')], giveTotal: 10, getTotal: 9 };
    expect(hl(args).reason).toEqual({ key: 'get_rising', params: { name: 'Silverback Gorilla', pct: 26 } });
    expect(tradeHighlight({ ...args, maps: { ...feedMaps, hotMap: null } })).toBeNull();
  });

  it('falls back to steady demand, and shows no low demand score', () => {
    const r = hl({ give: [pet('Cow')], receive: [pet('Giant Panda')], giveTotal: 10, getTotal: 8 });
    expect(r).toEqual({ tone: 'close', reason: { key: 'steady_demand', params: { name: 'Giant Panda', score: 7 } }, extra: null, demand: 7 });
    expect(hl({ give: [pet('Cow')], receive: [pet('Catte')], giveTotal: 10, getTotal: 10 }).demand).toBeNull();
  });

  it('says nothing about a short trade with nothing good to point at', () => {
    expect(hl({ give: [pet('Cow')], receive: [pet('Dirty Ducky')], giveTotal: 10, getTotal: 5 })).toBeNull();
  });

  it('keeps value lines when there is no demand data', () => {
    expect(tradeHighlight({ give: [pet('A')], receive: [pet('B')], giveTotal: 10, getTotal: 14, maps: {} }))
      .toEqual({ tone: 'good', reason: { key: 'value_win', params: { pct: 29 } }, extra: null, demand: null });
    expect(tradeHighlight({ give: [pet('A')], receive: [pet('B')], giveTotal: 10, getTotal: 10 }))
      .toEqual({ tone: 'close', reason: { key: 'value_fair', params: {} }, extra: null, demand: null });
  });

  it('needs both sides', () => {
    expect(hl({ give: [], receive: [pet('Cow')], giveTotal: 0, getTotal: 10 })).toBeNull();
  });
});
