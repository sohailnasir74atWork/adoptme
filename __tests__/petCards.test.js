import {
  formatCompact, parseCatalog, buildValueIndex, setProgress, bestOwned, totalCopies,
  bestPull, revealTier, countdown, nextUtcMidnight, packsAvailable,
  parseShowcase, toggleShowcase, isShowcased, matchPalette, fusionOf, applyFusion,
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

describe('profile showcase', () => {
  const stored = [
    { k: 'shadowdragon', f: 'mega', s: 7, n: 'Shadow Dragon', r: 'legendary', no: 700, e: null, sets: ['haunted26'], bg: null },
    { k: 'trex', f: 'classic', s: null, n: 'T-Rex', r: 'legendary', no: 650, e: 'fossil', sets: ['egg_fossil'] },
    { k: 'old', f: 'holo', s: 3 },            // older shape without catalog fields
  ];
  it('parses stored entries into drawable cards and skips incomplete ones', () => {
    const items = parseShowcase(stored);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      card: { key: 'shadowdragon', name: 'Shadow Dragon', rarity: 'legendary', no: 700, egg: null, sets: ['haunted26'], bg: null },
      finish: 'mega', serial: 7,
    });
    expect(items[1].card.egg).toBe('fossil');
    expect(items[1].serial).toBeNull();
    expect(parseShowcase(null)).toEqual([]);
  });
  it('knows what is pinned', () => {
    expect(isShowcased(stored, 'shadowdragon', 'mega')).toBe(true);
    expect(isShowcased(stored, 'shadowdragon', 'holo')).toBe(false);
    expect(isShowcased(undefined, 'x', 'classic')).toBe(false);
  });
  it('pins newest first, replaces another finish of the same card, caps at 3, unpins on repeat', () => {
    let list = toggleShowcase([], 'a', 'classic');
    expect(list).toEqual([{ k: 'a', f: 'classic' }]);
    list = toggleShowcase(list, 'b', 'holo');
    list = toggleShowcase(list, 'c', 'foil');
    expect(list.map((e) => e.k)).toEqual(['c', 'b', 'a']);
    list = toggleShowcase(list, 'd', 'classic');            // 4th drops the oldest
    expect(list.map((e) => e.k)).toEqual(['d', 'c', 'b']);
    list = toggleShowcase(list, 'b', 'mega');               // other finish replaces the pin
    expect(list).toEqual([{ k: 'b', f: 'mega' }, { k: 'd', f: 'classic' }, { k: 'c', f: 'foil' }]);
    list = toggleShowcase(list, 'b', 'mega');               // same again unpins
    expect(list.map((e) => e.k)).toEqual(['d', 'c']);
    expect(toggleShowcase(stored, 'trex', 'classic')).toEqual([{ k: 'shadowdragon', f: 'mega' }, { k: 'old', f: 'holo' }]);
  });
});

describe('match my pet', () => {
  it('keeps the pet hue and sets lightness by tone', () => {
    const red = ['#E50F10', '#1B212C', '#CC110F'];            // Evil Unicorn
    const light = matchPalette(red, 'light');
    expect(light.dark).toBe(false);
    expect(light.css).toContain('hsl(0, 75%, 93%)');            // pastel of the red
    const dark = matchPalette(red, 'dark');
    expect(dark.dark).toBe(true);
    expect(dark.css).toContain('hsl(0, 70%, 10%)');             // deep of the red
    expect(dark.accent).toBe('hsl(1, 86%, 66%)');      // the vivid red, lifted to glow
  });
  it('leaves grey pets grey and survives missing colours', () => {
    expect(matchPalette(['#808080'], 'light').css).toContain('hsl(0, 0%, 93%)');
    expect(matchPalette(null, 'dark').css).toContain('linear-gradient');
  });
});

describe('neon fusion', () => {
  it('knows what a finish fuses into and whether 4 copies are there', () => {
    const e = [['classic', 5, null], ['neon', 2, null], ['holo', 1, 7]];
    expect(fusionOf(e, 'classic')).toEqual({ to: 'neon', have: 5, need: 4, ready: true });
    expect(fusionOf(e, 'neon')).toEqual({ to: 'mega', have: 2, need: 4, ready: false });
    expect(fusionOf(e, 'holo')).toBeNull();                   // only Classic and Neon fuse
    expect(fusionOf(null, 'classic')).toEqual({ to: 'neon', have: 0, need: 4, ready: false });
  });
  it('uses 4 copies, drops an emptied finish, adds one serial-less copy', () => {
    expect(applyFusion([['classic', 5, null]], 'classic', 'neon')).toEqual([['classic', 1, null], ['neon', 1, null]]);
    expect(applyFusion([['classic', 4, null], ['neon', 1, null]], 'classic', 'neon')).toEqual([['neon', 2, null]]);
    expect(applyFusion([['neon', 4, null], ['mega', 1, 12]], 'neon', 'mega')).toEqual([['mega', 2, 12]]);   // pulled serial kept
  });
});
