import {
  formatCompact, parseCatalog, buildValueIndex, setProgress, bestOwned, totalCopies,
  bestPull, revealTier, countdown, nextUtcMidnight, packsAvailable,
} from '../Code/PetCards/cardMath';
import { bgIdFor, themeIdFor, hashKey } from '../Code/PetCards/cardConfig';

describe('formatCompact', () => {
  it('formats values like the card plate shows them', () => {
    expect(formatCompact(675)).toBe('675');
    expect(formatCompact(2430)).toBe('2.4K');
    expect(formatCompact(12500)).toBe('13K');
    expect(formatCompact(9100000)).toBe('9.1M');
    expect(formatCompact(3.25)).toBe('3.25');
    expect(formatCompact(10.75)).toBe('10.8');
    expect(formatCompact('x')).toBe('—');
  });
});

const catalog = parseCatalog([
  ['shadowdragon', 'Shadow Dragon', 'legendary', 700, null, ['haunted26', 'dragons'], null],
  ['batdragon', 'Bat Dragon', 'legendary', 701, null, ['haunted26', 'dragons'], null],
  ['trex', 'T-Rex', 'legendary', 650, 'fossil', ['egg_fossil'], null],
  ['dog', 'Dog', 'common', 1, null, [], null],
]);

describe('catalog and sets', () => {
  it('parses compact rows', () => {
    expect(catalog).toHaveLength(4);
    expect(catalog[2]).toEqual({ key: 'trex', name: 'T-Rex', rarity: 'legendary', no: 650, egg: 'fossil', sets: ['egg_fossil'], bg: null });
  });
  it('counts set progress from the owned map', () => {
    const owned = { shadowdragon: [['holo', 1, 42]], dog: [['classic', 3, null]] };
    expect(setProgress(catalog, owned, 'haunted26')).toEqual({ have: 1, total: 2, done: false });
    expect(setProgress(catalog, owned, 'all')).toEqual({ have: 2, total: 4, done: false });
    expect(setProgress(catalog, { trex: [['classic', 1, null]] }, 'egg_fossil').done).toBe(true);
    expect(setProgress(catalog, owned, 'nope')).toEqual({ have: 0, total: 0, done: false });
  });
  it('picks the fanciest owned finish', () => {
    expect(bestOwned([['classic', 2, null], ['mega', 1, 7], ['holo', 1, 99]])).toEqual({ finish: 'mega', count: 1, serial: 7 });
    expect(bestOwned([])).toBeNull();
    expect(totalCopies([['classic', 2, null], ['holo', 3, 1]])).toBe(5);
  });
});

describe('values index', () => {
  it('maps the values feed by card key', () => {
    const idx = buildValueIndex([
      { type: 'pets', name: 'Shadow Dragon', rvalue: 675, nvalue: 2400, mvalue: 9000 },
      { type: 'toys', name: 'Shadow Dragon', rvalue: 1 },
      { type: 'pets', name: 'Dog', rvalue: 0 },
    ]);
    expect(idx.get('shadowdragon')).toEqual({ r: 675, n: 2400, m: 9000 });
    expect(idx.get('dog')).toEqual({ r: null, n: null, m: null });
  });
});

describe('reveal', () => {
  const pack = [
    { key: 'a', rarity: 'common', finish: 'classic', new: true },
    { key: 'b', rarity: 'legendary', finish: 'classic' },
    { key: 'c', rarity: 'rare', finish: 'holo' },
  ];
  it('brags about the rarest finish first', () => {
    expect(bestPull(pack).key).toBe('c');
  });
  it('scales the drama', () => {
    expect(revealTier(pack[0])).toBe(0);
    expect(revealTier(pack[1])).toBe(2);
    expect(revealTier(pack[2])).toBe(1);
    expect(revealTier({ rarity: 'common', finish: 'mega' })).toBe(3);
  });
});

describe('time and packs', () => {
  it('counts down', () => {
    expect(countdown(Date.UTC(2026, 9, 2), Date.UTC(2026, 9, 1, 19, 48))).toEqual({ h: 4, m: 12 });
    expect(countdown(1000, 0)).toEqual({ h: 0, m: 1 });
    expect(countdown(0, 5)).toEqual({ h: 0, m: 0 });
  });
  it('finds the next UTC midnight', () => {
    expect(nextUtcMidnight(Date.UTC(2026, 9, 1, 23, 59))).toBe(Date.UTC(2026, 9, 2));
  });
  it('counts packs ready', () => {
    expect(packsAvailable({ freeReady: true, bonusPacks: 2 })).toBe(3);
    expect(packsAvailable(null)).toBe(0);
  });
});

describe('art choice', () => {
  it('gives each card a stable background by origin', () => {
    expect(bgIdFor(catalog[0], 'classic')).toMatch(/^haunted_/);
    expect(bgIdFor(catalog[0], 'classic')).toBe(bgIdFor(catalog[0], 'holo'));
    expect(bgIdFor(catalog[2], 'classic')).toBe('egg_fossil');
    expect(bgIdFor(catalog[3], 'neon')).toBe('island_night');
    expect(bgIdFor({ key: 'x', sets: ['winter26'] }, 'classic')).toBe('island_snow');
    expect(bgIdFor(catalog[3], 'classic')).toBe('island_meadow');
    expect(themeIdFor(catalog[0])).toBe('haunted');
    expect(themeIdFor(catalog[3])).toBe('island');
    expect(hashKey('abc')).toBe(hashKey('abc'));
  });
});
