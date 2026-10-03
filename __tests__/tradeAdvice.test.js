jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({ getString: () => undefined, getNumber: () => undefined, set: () => {}, remove: () => {} }),
}));

const { adviseTrade, feedNudge } = require('../Code/Helper/tradeAdvice');
const { liquidityFor } = require('../Code/Helper/analyticsDataHelper');

const maps = {
  marketMap: {
    'crystal egg': { wanted: 175, offered: 16, liquidity: 'fast' },
    'throwback egg': { wanted: 18, offered: 110, liquidity: 'slow' },
    catte: { wanted: 3, offered: 70, liquidity: 'slow' },
    cow: { wanted: 31, offered: 65, liquidity: null },
  },
  hotMap: { 'silverback gorilla': { pct: 26, isHot: true } },
  dropMap: { 'dirty ducky': { pct: -18 } },
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

describe('adviseTrade', () => {
  it('needs both sides', () => {
    expect(adviseTrade({ give: [pet('Cow')], receive: [], giveTotal: 10, getTotal: 0, maps })).toBeNull();
  });

  it('takes a value win that also trades fast', () => {
    const r = adviseTrade({ give: [pet('Cow')], receive: [pet('Crystal Egg')], giveTotal: 10, getTotal: 12, maps });
    expect(r.verdict).toBe('take');
    expect(r.reasons.map((x) => x.key)).toEqual(['value_win', 'get_fast']);
  });

  it('warns on a small value win made of slow, falling pets', () => {
    const r = adviseTrade({
      give: [pet('Cow')], receive: [pet('Catte'), pet('Dirty Ducky')], giveTotal: 10, getTotal: 10.8, maps,
    });
    expect(r.verdict).toBe('think');
    expect(r.reasons.map((x) => x.key)).toContain('get_slow');
  });

  it('skips a big loss', () => {
    const r = adviseTrade({ give: [pet('Crystal Egg')], receive: [pet('Throwback Egg')], giveTotal: 20, getTotal: 10, maps });
    expect(r.verdict).toBe('skip');
    expect(r.reasons[0]).toEqual({ key: 'value_lose', params: { pct: 50 } });
  });

  it('flags giving away a rising pet', () => {
    const r = adviseTrade({ give: [pet('Silverback Gorilla')], receive: [pet('Cow')], giveTotal: 10, getTotal: 10, maps });
    expect(r.verdict).toBe('think');
    expect(r.reasons.map((x) => x.key)).toContain('give_rising');
  });

  it('works with no analytics at all (value only)', () => {
    const r = adviseTrade({ give: [pet('A')], receive: [pet('B')], giveTotal: 10, getTotal: 14, maps: {} });
    expect(r).toMatchObject({ verdict: 'take', reasons: [{ key: 'value_win', params: { pct: 29 } }] });
  });
});

describe('feedNudge', () => {
  const nudge = (args) => feedNudge(adviseTrade({ maps, ...args }), { giveTotal: args.giveTotal, getTotal: args.getTotal });

  it('turns a short deal into a counter-offer with the amount to ask for', () => {
    const r = nudge({ give: [pet('Cow')], receive: [pet('Catte')], giveTotal: 10, getTotal: 8.5 });
    expect(r).toEqual({ tone: 'counter', reason: { key: 'ask_more', params: { amount: 1.5 } } });
  });

  it('suggests offering less when the gap is big', () => {
    const r = nudge({ give: [pet('Crystal Egg')], receive: [pet('Throwback Egg')], giveTotal: 20, getTotal: 10 });
    expect(r).toEqual({ tone: 'counter', reason: { key: 'ask_more_big', params: { amount: 10 } } });
  });

  it('never says skip: an even trade of slow, falling pets is still a counter', () => {
    const r = nudge({ give: [pet('Cow')], receive: [pet('Catte'), pet('Dirty Ducky')], giveTotal: 10, getTotal: 10 });
    expect(r.tone).toBe('counter');
    expect(['get_slow', 'get_dropping']).toContain(r.reason.key);
  });

  it('leads a good deal with what the totals cannot show', () => {
    const r = nudge({ give: [pet('Cow')], receive: [pet('Crystal Egg')], giveTotal: 10, getTotal: 12 });
    expect(r).toEqual({ tone: 'good', reason: { key: 'get_fast', params: { name: 'Crystal Egg', count: 175 } } });
  });

  it('is null when there is no advice', () => {
    expect(feedNudge(null)).toBeNull();
  });
});
