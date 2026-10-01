jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({ getString: () => undefined, getNumber: () => undefined, set: () => {}, remove: () => {} }),
}));

const { valueChangeOf, freshDiffEntries, DIFF_MAX_AGE_MS } = require('../Code/Helper/analyticsDataHelper');

// Entries copied from the live diff.json (2026-09-29).
const PELICAN = {
  key: 'id:3', name: 'Pelican', type: 'pets', image: '/images/pets/Pelican.png',
  rvalue: { oldVal: 40, newVal: 41.5 }, nvalue: { oldVal: 158, newVal: 166 }, mvalue: { oldVal: 632, newVal: 664 },
};
const PEPPERMINT = {
  key: 'id:6', name: 'Peppermint Penguin', type: 'pets',
  mvalue: { oldVal: 550, newVal: 545 }, 'mvalue - nopotion': { oldVal: 565, newVal: 560 },
};
const RANK_ONLY = { key: 'id:26', name: 'Wood Pigeon', type: 'pets', score: { oldVal: 45, newVal: 44 } };

describe('valueChangeOf', () => {
  it('reads the regular value first', () => {
    expect(valueChangeOf(PELICAN)).toEqual({ oldVal: 40, newVal: 41.5, pct: 4, key: 'rvalue' });
  });

  it('falls back to mega when only mega moved', () => {
    expect(valueChangeOf(PEPPERMINT)).toMatchObject({ key: 'mvalue', pct: -1 });
  });

  it('ignores score, which is a rank (1 = best), not a value', () => {
    expect(valueChangeOf(RANK_ONLY)).toBeNull();
    // A value drop with a rising rank number must still read as a drop.
    const dirtyDucky = { name: 'Dirty Ducky', score: { oldVal: 100, newVal: 150 }, rvalue: { oldVal: 11, newVal: 9 } };
    expect(valueChangeOf(dirtyDucky).pct).toBe(-18);
  });

  it('reads the normalised {values, primary} shape', () => {
    const item = { name: 'X', primary: 'n_nopotion', values: { n_nopotion: { oldVal: 10, newVal: 12 } } };
    expect(valueChangeOf(item)).toMatchObject({ pct: 20, key: 'n_nopotion' });
  });

  it('rejects zero or missing old values', () => {
    expect(valueChangeOf({ name: 'New', rvalue: { oldVal: 0, newVal: 5 } })).toBeNull();
    expect(valueChangeOf(null)).toBeNull();
  });
});

describe('freshDiffEntries', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  it('returns entries of a recent diff', () => {
    const diff = { meta: { generatedAt: '2026-09-29T08:57:28Z' }, changed: [PELICAN] };
    expect(freshDiffEntries(diff, now)).toHaveLength(1);
  });

  it('drops a diff older than the cut-off', () => {
    const old = new Date(now - DIFF_MAX_AGE_MS - 1000).toISOString();
    expect(freshDiffEntries({ meta: { generatedAt: old }, changed: [PELICAN] }, now)).toEqual([]);
  });

  it('keeps an undated legacy payload', () => {
    expect(freshDiffEntries({ changes: [PELICAN] }, now)).toHaveLength(1);
    expect(freshDiffEntries(null, now)).toEqual([]);
  });
});
