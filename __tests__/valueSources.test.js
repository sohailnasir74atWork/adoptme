/**
 * Tests for valueSources — the Shark/Frost unit maths and the source split.
 *
 * Fixtures are real rows from both live feeds on 2026-09-17:
 *   Elvebredd  https://adoptme.b-cdn.net                   (shark-native)
 *   GG         https://adoptme-gg-values.b-cdn.net/gg.json (frost-native)
 *
 * The two anchor pets are the whole point. Elvebredd prices the Shark at
 * exactly 1.00 and the Frost Dragon at 313; GG prices the Frost Dragon at
 * exactly 1.00 and the Shark at 0.00608696. Every conversion below follows
 * from those four numbers, and each feed carries its own — the sites disagree
 * on the Frost:Shark ratio by ~1.9x.
 */

import {
  VALUE_SOURCE,
  VALUE_UNIT,
  deriveFactor,
  sharksPerFrost,
  convert,
  rawValue,
  valueOf,
  formatValue,
  indexSource,
  itemInSource,
  priceOf,
  factorHealth,
  fromLegacyMode,
  toLegacyMode,
  sourceOfTrade,
  sourceOfItems,
  sourceStatement,
  sourceTag,
  categoriesFor,
  resolveItemImage,
} from '../Code/Helper/valueSources';

// ── Fixtures ──────────────────────────────────────────────────────────────

const pet = (name, rvalue, over = {}) => ({
  name,
  type: 'pets',
  rvalue,
  'rvalue - nopotion': rvalue,
  'rvalue - ride': rvalue,
  'rvalue - fly': rvalue,
  'rvalue - fly&ride': rvalue,
  ...over,
});

const ELVEBREDD = [
  pet('Shark', 1, { 'rvalue - ride': 1.3, 'rvalue - fly': 1.3, 'rvalue - fly&ride': 1.7 }),
  pet('Frost Dragon', 313, { 'rvalue - nopotion': 326 }),
  pet('Bat Dragon', 930, { 'rvalue - nopotion': 943 }),
  pet('Dog', 0.46),
  { name: 'Rainbow Rattle', type: 'toys', value: 1900 },
  { name: 'Safari Egg', type: 'eggs', rvalue: 210, value: 210 },
];

const GG = [
  { ...pet('Shark', 0.00608696), valueSource: 'gg' },
  { ...pet('Frost Dragon', 1), valueSource: 'gg' },
  { ...pet('Bat Dragon', 2.971, { 'rvalue - nopotion': 3 }), valueSource: 'gg' },
  { name: 'Rainbow Rattle', type: 'toys', value: 10.15, valueSource: 'gg' },
];

beforeEach(() => {
  deriveFactor(VALUE_SOURCE.ELVEBREDD, ELVEBREDD);
  deriveFactor(VALUE_SOURCE.GG, GG);
  indexSource(VALUE_SOURCE.ELVEBREDD, ELVEBREDD);
  indexSource(VALUE_SOURCE.GG, GG);
});

// ── Factor derivation ─────────────────────────────────────────────────────

describe('deriveFactor', () => {
  test('reads each feed’s own Frost:Shark ratio from its anchor pets', () => {
    expect(sharksPerFrost(VALUE_SOURCE.ELVEBREDD)).toBe(313);
    expect(sharksPerFrost(VALUE_SOURCE.GG)).toBeCloseTo(164.2856, 3);
  });

  test('the two sites disagree by ~1.9x — each must keep its own factor', () => {
    const ratio = sharksPerFrost(VALUE_SOURCE.ELVEBREDD) / sharksPerFrost(VALUE_SOURCE.GG);
    expect(ratio).toBeCloseTo(1.905, 2);
  });

  test('uses the headline rvalue, not a potion variant', () => {
    // A fly&ride Shark is 1.7, which would give 313/1.7 = 184 — the wrong unit.
    expect(sharksPerFrost(VALUE_SOURCE.ELVEBREDD)).not.toBeCloseTo(184, 0);
  });

  test('a feed missing an anchor keeps the previous factor rather than rescaling', () => {
    const before = sharksPerFrost(VALUE_SOURCE.ELVEBREDD);
    expect(deriveFactor(VALUE_SOURCE.ELVEBREDD, [pet('Dog', 0.46)])).toBeNull();
    expect(sharksPerFrost(VALUE_SOURCE.ELVEBREDD)).toBe(before);
  });
});

// ── Conversion ────────────────────────────────────────────────────────────

describe('convert', () => {
  test('a native-unit value passes through untouched', () => {
    expect(convert(930, VALUE_SOURCE.ELVEBREDD, VALUE_UNIT.SHARK)).toBe(930);
    expect(convert(2.971, VALUE_SOURCE.GG, VALUE_UNIT.FROST)).toBe(2.971);
  });

  test('elvebredd divides into Frosts, gg multiplies into Sharks', () => {
    expect(convert(313, VALUE_SOURCE.ELVEBREDD, VALUE_UNIT.FROST)).toBe(1);
    expect(convert(1, VALUE_SOURCE.GG, VALUE_UNIT.SHARK)).toBeCloseTo(164.2856, 3);
  });

  test('zero stays zero', () => {
    expect(convert(0, VALUE_SOURCE.GG, VALUE_UNIT.SHARK)).toBe(0);
  });
});

describe('the anchors read 1.00 on both feeds', () => {
  const frostOpts = { valueType: 'd', isFly: true, isRide: true, unit: VALUE_UNIT.FROST };

  test('a Frost Dragon is 1 Frost, whichever site priced it', () => {
    const e = ELVEBREDD.find((i) => i.name === 'Frost Dragon');
    const g = GG.find((i) => i.name === 'Frost Dragon');
    expect(valueOf(e, { ...frostOpts, source: VALUE_SOURCE.ELVEBREDD })).toBeCloseTo(1, 6);
    expect(valueOf(g, { ...frostOpts, source: VALUE_SOURCE.GG })).toBeCloseTo(1, 6);
  });

  test('a Shark is 1 Shark, whichever site priced it', () => {
    const e = ELVEBREDD.find((i) => i.name === 'Shark');
    const g = GG.find((i) => i.name === 'Shark');
    const opts = { valueType: 'd', unit: VALUE_UNIT.SHARK };
    expect(valueOf(e, { ...opts, source: VALUE_SOURCE.ELVEBREDD })).toBeCloseTo(1, 6);
    expect(valueOf(g, { ...opts, source: VALUE_SOURCE.GG })).toBeCloseTo(1, 6);
  });
});

// ── Reading values off items ──────────────────────────────────────────────

describe('rawValue', () => {
  test('picks the potion variant for pets', () => {
    const shark = ELVEBREDD.find((i) => i.name === 'Shark');
    expect(rawValue(shark, 'd', false, false)).toBe(1);
    expect(rawValue(shark, 'd', true, true)).toBe(1.7);
  });

  test('simple categories use `value` and ignore potions', () => {
    const toy = ELVEBREDD.find((i) => i.name === 'Rainbow Rattle');
    expect(rawValue(toy, 'd', true, true)).toBe(1900);
  });

  test('eggs read rvalue — the app special-cases them', () => {
    const egg = ELVEBREDD.find((i) => i.name === 'Safari Egg');
    expect(rawValue(egg)).toBe(210);
  });
});

// ── Formatting ────────────────────────────────────────────────────────────

describe('formatValue', () => {
  test('keeps small Frost values visible instead of rounding them to 0.00', () => {
    // toFixed(2) renders all of these as "0.00" — which hid 86% of the
    // Elvebredd catalogue in Frost mode.
    expect(formatValue(0.0014696)).toBe('0.00147');
    expect(formatValue(0.00015)).toBe('0.00015');
    expect(formatValue(0.0456)).toBe('0.0456');
  });

  test('stays short for ordinary Shark values', () => {
    expect(formatValue(930)).toBe('930');
    expect(formatValue(12.345)).toBe('12.35');
    expect(formatValue(1234.5678)).toBe('1,234.57');
  });

  test('trims trailing zeros and handles zero', () => {
    expect(formatValue(3.0)).toBe('3');
    expect(formatValue(1.2)).toBe('1.2');
    expect(formatValue(0)).toBe('0');
  });
});

// ── Cross-source matching ─────────────────────────────────────────────────

describe('priceOf', () => {
  test('follows an item into the other catalogue by name', () => {
    const batFromElvebredd = ELVEBREDD.find((i) => i.name === 'Bat Dragon');
    const priced = priceOf(batFromElvebredd, {
      source: VALUE_SOURCE.GG, unit: VALUE_UNIT.FROST, isFly: true, isRide: true,
    });
    expect(priced.missing).toBe(false);
    expect(priced.value).toBeCloseTo(2.971, 4);
  });

  test('says "missing" rather than 0 when a source does not list the item', () => {
    const dog = ELVEBREDD.find((i) => i.name === 'Dog');
    const priced = priceOf(dog, { source: VALUE_SOURCE.GG });
    expect(priced.missing).toBe(true);
    expect(priced.value).toBe(0);
  });

  test('each source answers with its OWN number for the same pet', () => {
    const bat = ELVEBREDD.find((i) => i.name === 'Bat Dragon');
    const opts = { unit: VALUE_UNIT.FROST, isFly: true, isRide: true };
    const viaElvebredd = priceOf(bat, { ...opts, source: VALUE_SOURCE.ELVEBREDD }).value;
    const viaGG = priceOf(bat, { ...opts, source: VALUE_SOURCE.GG }).value;
    // Elvebredd's own 930 Sharks converted with Elvebredd's own factor...
    expect(viaElvebredd).toBeCloseTo(930 / 313, 6);
    // ...and GG's own figure, untouched, because GG is already frost-native.
    expect(viaGG).toBe(2.971);
  });

  /**
   * Across the 773 pets both sites price, the median disagreement in Frost
   * units is 16.5% and 40 pets differ by more than 50% — that spread is the
   * product feature, not drift to reconcile.
   *
   * Bat Dragon is deliberately NOT the example here: the two sites land within
   * 0.01% of each other on it, which makes it useless for showing divergence.
   * The Shark is the clearest case, because the sites disagree about the
   * benchmark itself — 1/313 of a Frost against 1/164.
   */
  test('the two sources genuinely disagree, most sharply on the Shark', () => {
    const shark = ELVEBREDD.find((i) => i.name === 'Shark');
    const opts = { unit: VALUE_UNIT.FROST, valueType: 'd' };
    const viaElvebredd = priceOf(shark, { ...opts, source: VALUE_SOURCE.ELVEBREDD }).value;
    const viaGG = priceOf(shark, { ...opts, source: VALUE_SOURCE.GG }).value;
    expect(viaElvebredd).toBeCloseTo(1 / 313, 6);
    expect(viaGG).toBeCloseTo(0.00608696, 6);
    expect(viaGG / viaElvebredd).toBeCloseTo(1.905, 2);
  });
});

describe('itemInSource', () => {
  test('matches across spelling differences in punctuation and case', () => {
    expect(itemInSource({ name: 'bat  dragon' }, VALUE_SOURCE.GG)).toBeTruthy();
  });
});

// ── Factor health ─────────────────────────────────────────────────────────

describe('factorHealth', () => {
  test('flags the 163.94 that was applied to the wrong feed', () => {
    const health = factorHealth(163.94, VALUE_SOURCE.ELVEBREDD);
    expect(health.ok).toBe(false);
    expect(health.ratio).toBeCloseTo(1.909, 2);
  });

  test('accepts the correct figure', () => {
    expect(factorHealth(313, VALUE_SOURCE.ELVEBREDD).ok).toBe(true);
  });

  test('tolerates small market drift', () => {
    expect(factorHealth(315, VALUE_SOURCE.ELVEBREDD).ok).toBe(true);
  });
});

// ── Legacy compatibility ──────────────────────────────────────────────────

describe('legacy isSharkMode', () => {
  test('translates the old three-way flag', () => {
    expect(fromLegacyMode(true)).toEqual({ source: VALUE_SOURCE.ELVEBREDD, unit: VALUE_UNIT.SHARK });
    expect(fromLegacyMode(false)).toEqual({ source: VALUE_SOURCE.ELVEBREDD, unit: VALUE_UNIT.FROST });
    expect(fromLegacyMode('GG')).toEqual({ source: VALUE_SOURCE.GG, unit: VALUE_UNIT.FROST });
  });

  test('round-trips so old readers still show something sensible', () => {
    expect(toLegacyMode(VALUE_SOURCE.GG, VALUE_UNIT.FROST)).toBe('GG');
    expect(toLegacyMode(VALUE_SOURCE.ELVEBREDD, VALUE_UNIT.SHARK)).toBe(true);
    expect(toLegacyMode(VALUE_SOURCE.ELVEBREDD, VALUE_UNIT.FROST)).toBe(false);
  });

  test('an undefined flag reads as the pre-2026 default, not as broken', () => {
    expect(fromLegacyMode(undefined)).toEqual({ source: VALUE_SOURCE.ELVEBREDD, unit: VALUE_UNIT.SHARK });
  });
});

// ── Source labelling on trades and chat lists ─────────────────────────────

describe('sourceOfTrade', () => {
  test('reads valueSource when the trade has one', () => {
    expect(sourceOfTrade({ valueSource: 'gg' })).toBe(VALUE_SOURCE.GG);
    expect(sourceOfTrade({ valueSource: 'elvebredd' })).toBe(VALUE_SOURCE.ELVEBREDD);
  });

  test('falls back to the legacy three-way isSharkMode', () => {
    expect(sourceOfTrade({ isSharkMode: 'GG' })).toBe(VALUE_SOURCE.GG);
    expect(sourceOfTrade({ isSharkMode: true })).toBe(VALUE_SOURCE.ELVEBREDD);
    expect(sourceOfTrade({ isSharkMode: false })).toBe(VALUE_SOURCE.ELVEBREDD);
  });

  test('falls back to the items when the trade itself says nothing', () => {
    expect(sourceOfTrade({ hasItems: [{ name: 'Bat Dragon', valueSource: 'gg' }] }))
      .toBe(VALUE_SOURCE.GG);
  });

  test('a pre-2026-09 trade reads as Elvebredd — it was the only catalogue then', () => {
    expect(sourceOfTrade({ hasItems: [{ name: 'Bat Dragon' }] })).toBe(VALUE_SOURCE.ELVEBREDD);
    expect(sourceOfTrade({})).toBe(VALUE_SOURCE.ELVEBREDD);
    expect(sourceOfTrade(null)).toBe(VALUE_SOURCE.ELVEBREDD);
  });
});

describe('chat list labelling', () => {
  test('names the catalogue that priced the list', () => {
    expect(sourceOfItems([{ name: 'Bat Dragon', valueSource: 'gg' }])).toBe(VALUE_SOURCE.GG);
    expect(sourceOfItems([{ name: 'Bat Dragon' }])).toBe(VALUE_SOURCE.ELVEBREDD);
    expect(sourceOfItems([])).toBe(VALUE_SOURCE.ELVEBREDD);
  });

  test('the sentence reads naturally — not "Based on GG Values values"', () => {
    expect(sourceStatement(VALUE_SOURCE.GG)).toBe('Based on GG values');
    expect(sourceStatement(VALUE_SOURCE.ELVEBREDD)).toBe('Based on Elvebredd values');
    expect(sourceStatement(undefined)).toBe('Based on Elvebredd values');
  });

  test('the trade badge tag is short enough to sit next to a timestamp', () => {
    expect(sourceTag(VALUE_SOURCE.GG)).toBe('GG');
    expect(sourceTag(VALUE_SOURCE.ELVEBREDD)).toBe('ELV');
  });
});

// ── A feed that is neither shark- nor frost-native ────────────────────────
//
// The GG source moved from adoptmevalues.gg to amvgg.com on 2026-09-17, and
// amvgg quotes in a THIRD unit: its Frost Dragon is 1.725, not 1.00. Nothing
// in the app had to change, because conversion reads the anchors rather than
// assuming a native unit. These tests exist so that stays true.

describe('amvgg units (Frost Dragon = 1.725, Shark = 0.0105)', () => {
  const AMVGG = [
    { ...pet('Shark', 0.0105), valueSource: 'gg' },
    { ...pet('Frost Dragon', 1.725), valueSource: 'gg' },
    { ...pet('Bat Dragon', 5.125, { 'rvalue - nopotion': 5.175 }), valueSource: 'gg' },
  ];

  beforeEach(() => {
    deriveFactor(VALUE_SOURCE.GG, AMVGG);
    indexSource(VALUE_SOURCE.GG, AMVGG);
  });

  test('the ratio is unchanged — both anchors scaled together', () => {
    // adoptmevalues.gg gave 164.2856 from 1 / 0.00608696; amvgg gives the same
    // from 1.725 / 0.0105. A source swap must not move the factor.
    expect(sharksPerFrost(VALUE_SOURCE.GG)).toBeCloseTo(164.2857, 3);
  });

  test('the anchors still read 1.00 in their own units', () => {
    const frost = AMVGG.find((i) => i.name === 'Frost Dragon');
    const shark = AMVGG.find((i) => i.name === 'Shark');
    const o = { source: VALUE_SOURCE.GG, valueType: 'd', isFly: true, isRide: true };
    expect(valueOf(frost, { ...o, unit: VALUE_UNIT.FROST })).toBeCloseTo(1, 6);
    expect(valueOf(shark, { ...o, unit: VALUE_UNIT.SHARK })).toBeCloseTo(1, 6);
  });

  test('a raw 5.125 normalises to the same 2.971 Frosts the old source gave', () => {
    const bat = AMVGG.find((i) => i.name === 'Bat Dragon');
    const v = valueOf(bat, {
      source: VALUE_SOURCE.GG, unit: VALUE_UNIT.FROST, valueType: 'd', isFly: true, isRide: true,
    });
    expect(v).toBeCloseTo(2.971, 3);
  });

  test('and agrees with Elvebredd, which stores the same pet as 930 Sharks', () => {
    const bat = AMVGG.find((i) => i.name === 'Bat Dragon');
    const viaGG = valueOf(bat, {
      source: VALUE_SOURCE.GG, unit: VALUE_UNIT.FROST, valueType: 'd', isFly: true, isRide: true,
    });
    expect(viaGG).toBeCloseTo(930 / 313, 2);
  });
});

// ── Categories derived from the feed ──────────────────────────────────────
//
// The two sources carry the same ten types today, but only because the
// pipeline maps GG's categories onto Elvebredd's names. Either site can add
// one, so the filter bar reads the data instead of a constant.

describe('categoriesFor', () => {
  test('lists only the types the feed actually contains', () => {
    const rows = [{ type: 'pets' }, { type: 'eggs' }, { type: 'pets' }];
    expect(categoriesFor(rows)).toEqual(['PETS', 'EGGS']);
  });

  test('keeps the familiar order regardless of row order', () => {
    const rows = [{ type: 'stickers' }, { type: 'pets' }, { type: 'eggs' }];
    expect(categoriesFor(rows)).toEqual(['PETS', 'EGGS', 'STICKERS']);
  });

  test('surfaces an UNKNOWN type rather than hiding its items', () => {
    // The failure this guards against: a feed adds a category, the hardcoded
    // list omits it, and those items become unreachable in the UI.
    const rows = [{ type: 'pets' }, { type: 'houses' }];
    expect(categoriesFor(rows)).toEqual(['PETS', 'HOUSES']);
  });

  test('prefix entries lead the list', () => {
    expect(categoriesFor([{ type: 'pets' }], { prefix: ['MY_STUFF', 'ALL'] }))
      .toEqual(['MY_STUFF', 'ALL', 'PETS']);
  });

  test('falls back to the familiar list before any data loads', () => {
    expect(categoriesFor([])).toContain('PETS');
    expect(categoriesFor(null)).toContain('PET WEAR');
  });
});

// ── Artwork ───────────────────────────────────────────────────────────────

describe('resolveItemImage', () => {
  const BASE = 'https://elvebredd.com';

  test('prefixes a relative path with the base host', () => {
    expect(resolveItemImage({ name: 'Bat Dragon', image: '/images/pets/Bat Dragon.png' }, BASE))
      .toBe('https://elvebredd.com/images/pets/Bat Dragon.png');
  });

  test('returns an absolute URL untouched — never double-prefixed', () => {
    // The bug this guards: blind prefixing produced
    // https://elvebredd.com/https://amvgg.com/... and rendered nothing.
    const abs = 'https://amvgg.com/items/Cozy%20Cabin.webp';
    expect(resolveItemImage({ name: 'Cozy Cabin', image: abs }, BASE)).toBe(abs);
  });

  test('falls back to ggImage for a GG-only item with no borrowed art', () => {
    expect(resolveItemImage(
      { name: 'Cozy Cabin', image: '', ggImage: 'https://amvgg.com/items/Cozy%20Cabin.webp' },
      BASE,
    )).toBe('https://amvgg.com/items/Cozy%20Cabin.webp');
  });

  test('returns empty when there is no art at all', () => {
    expect(resolveItemImage({ name: 'Nothing', image: '' }, BASE)).toBe('');
    expect(resolveItemImage(null, BASE)).toBe('');
  });
});
