/**
 * valueSources.js — the one place that knows how the two value feeds differ.
 *
 * 📅 2026-09-17. The app carries two catalogues of Adopt Me item values:
 *
 *   Elvebredd  https://adoptme.b-cdn.net                      3,491 items
 *   GG         https://adoptme-gg-values.b-cdn.net/gg.json    1,134 items
 *
 * Both are bare arrays in the same shape — same field names, same key order,
 * same types — so anything that reads one can read the other. The pipeline at
 * DataFetching/adoptme enforces that mechanically (`npm run parity`).
 *
 * ── SOURCE and UNIT are two different things ──────────────────────────────
 *
 * This is the distinction the app was missing. Keep them separate — and see
 * "Why this is derived and not stored" below for what a stale factor costs:
 *
 *   SOURCE   which site priced the item   Elvebredd | GG
 *   UNIT     what the number is counted in   Shark | Frost — ELVEBREDD ONLY
 *
 * ── ⚠️ Units are Elvebredd's. GG has none. ───────────────────────────────
 *
 * 📅 2026-09-19. The Shark and the Frost Dragon are ELVEBREDD's benchmark
 * pets. GG is a separate system with its own scale: on its own site it quotes
 * in Baseless, Frost or Ride Pot, and its Shark is just another pet in the
 * catalogue, not a unit. So GG has no anchors, no factor and nothing to
 * convert — it is shown exactly as published, and `convert` returns it
 * untouched.
 *
 * Treating GG as convertible into Elvebredd's Sharks is what produced the bug
 * this replaced. GG's own Shark price (0.0105 against its 1.725 Frost Dragon)
 * puts a Frost at 164 Sharks where Elvebredd puts it at 313 — a 1.905x
 * disagreement — so dividing by it dragged every GG number to a median 0.618x
 * of its Elvebredd counterpart and matched nothing on the GG site. Undead
 * Jousting Horse is the worked example: GG publishes 0.66 and the app showed
 * 62.86, while Elvebredd read 122. In Frosts the two feeds agree (0.383 vs
 * 0.390) — the gap was never in the values, only in the Shark anchor.
 *
 * Do not give GG an anchor entry again. If a third source appears, decide
 * first whether it shares Elvebredd's benchmarks; if it does not, it belongs
 * on this side of the line with GG.
 *
 * ── Elvebredd's own two units ────────────────────────────────────────────
 *
 * Adopt Me traders price things in benchmark pets:
 *
 *              Shark        Frost Dragon      1 Frost = ? Sharks
 *   Elvebredd  1.00  <-unit  313              313.00
 *
 * Converting between them is division by the feed's own Frost Dragon price —
 * which is why `sharksPerFrost` is derived FROM THE FEED at load time (see
 * deriveFactor) instead of being stored as a constant. A site can rebase its
 * scale whenever it likes; a constant cannot follow it.
 *
 * ── ⚠️ Why this is derived and not stored ────────────────────────────────
 *
 * The factor DRIFTS. Elvebredd's has moved 28 times in two years — about once
 * every 26 days — climbing 142 -> 313 as the Frost Dragon appreciated against
 * the Shark.
 *
 * RTDB `factor` sat at 163.94, which was the correct figure in October 2025
 * and was then never touched. 342 days later the real value was 313, so Frost
 * mode had drifted to showing a Frost Dragon as 1.91 instead of 1.00 — every
 * Frost reading inflated ~1.91x. (It is near GG's 164.29 by coincidence, not
 * because anyone copied it from there.)
 *
 * So the lesson is not "someone typed the wrong number" — it is that any
 * stored factor is wrong within weeks. Deriving it per feed at load time is
 * the only version that stays correct. `factorHealth()` reports when a derived
 * factor disagrees with the RTDB value so a stale node is visible, not silent.
 *
 * ── Precision: use formatValue, never .toFixed(2) ─────────────────────────
 *
 * Frost is a big unit. Most of the catalogue is worth a tiny fraction of one,
 * so a fixed 2 decimals renders it as "0.00":
 *
 *                  Shark mode        Frost mode
 *   Elvebredd      476 / 3,491       3,004 / 3,491   <- 86% of the catalogue
 *   GG               0 / 1,134         641 / 1,134
 *
 * That is not a GG problem — it already hides most of the Elvebredd catalogue
 * in Frost mode today. `formatValue` uses significant figures instead, so a
 * 0.0004 Frost item reads as "0.0004" rather than "0.00".
 */

// ── Sources ────────────────────────────────────────────────────────────────

export const VALUE_SOURCE = {
  ELVEBREDD: 'elvebredd',
  GG: 'gg',
};

/**
 * Elvebredd stays the default: it is what every existing user already sees,
 * it has 3x the items, and it owns the artwork. GG is the opt-in second
 * opinion. The toggle is the user's to change and their choice persists.
 */
export const DEFAULT_VALUE_SOURCE = VALUE_SOURCE.ELVEBREDD;

export const SOURCE_LABEL = {
  [VALUE_SOURCE.ELVEBREDD]: 'Elvebredd',
  [VALUE_SOURCE.GG]: 'GG Values',
};

export const SOURCE_URL = {
  [VALUE_SOURCE.ELVEBREDD]: 'https://adoptme.b-cdn.net',
  [VALUE_SOURCE.GG]: 'https://adoptme-gg-values.b-cdn.net/gg.json',
};

// ── Units ──────────────────────────────────────────────────────────────────

export const VALUE_UNIT = {
  SHARK: 'shark',
  FROST: 'frost',
};

export const DEFAULT_VALUE_UNIT = VALUE_UNIT.SHARK;

export const UNIT_LABEL = {
  [VALUE_UNIT.SHARK]: 'Shark',
  [VALUE_UNIT.FROST]: 'Frost',
};

/**
 * Elvebredd's two anchor prices, in its own units.
 *
 * GG is deliberately absent — it has no unit system (see the header). The
 * default is the real Elvebredd figure, so a cold start is approximately
 * right; deriveFactor overwrites it as soon as the feed arrives.
 */
const ANCHORS = {
  [VALUE_SOURCE.ELVEBREDD]: { shark: 1, frost: 313 },
};

// ── Factor derivation ──────────────────────────────────────────────────────

const derived = {};

/**
 * The anchor is the HEADLINE `rvalue`, not a potion variant — a benchmark pet
 * is quoted plain. On Elvebredd the Shark reads:
 *
 *   rvalue 1   nopotion 1   ride 1.3   fly 1.3   fly&ride 1.7
 *
 * `rvalue` puts the Shark at exactly 1.00, which is what makes it the unit.
 * Using fly&ride would give 184 instead of 313, because a fly&ride Shark is a
 * different, dearer animal than the benchmark.
 */
const anchorValue = (item) => {
  if (!item) return 0;
  const v = Number(item.type === 'pets' ? item.rvalue : item.value);
  return Number.isFinite(v) ? v : 0;
};

const findPet = (rows, name) => {
  if (!Array.isArray(rows)) return null;
  const want = String(name).toLowerCase();
  return rows.find((r) => r && r.type === 'pets' && String(r.name).toLowerCase() === want) || null;
};

/**
 * Derive `sharksPerFrost` for one feed from its own two anchor pets.
 *
 * Call once per feed load, with the UNWRAPPED array. Returns the factor, or
 * null when the feed is missing an anchor — in which case the previous value
 * is kept rather than replaced with something wrong.
 */
export const deriveFactor = (source, rows) => {
  // GG has no unit system, so there is no factor to derive. Returning null
  // here — rather than quietly computing one — is what stops the Shark
  // conversion coming back.
  if (source === VALUE_SOURCE.GG) return null;

  const shark = anchorValue(findPet(rows, 'Shark'));
  const frost = anchorValue(findPet(rows, 'Frost Dragon'));

  if (!(shark > 0) || !(frost > 0)) {
    // Keep whatever we had. A feed that briefly loses an anchor must not
    // silently rescale the whole catalogue.
    return null;
  }

  ANCHORS[source] = { shark, frost };
  const value = frost / shark;
  derived[source] = { shark, frost, value, at: Date.now() };
  return value;
};

const anchorsOf = (source) => ANCHORS[source] || ANCHORS[VALUE_SOURCE.ELVEBREDD];

/**
 * How many Sharks one Frost Dragon is worth, on Elvebredd.
 *
 * Returns null for GG, which does not count in Sharks or Frosts at all.
 */
export const sharksPerFrost = (source = VALUE_SOURCE.ELVEBREDD) => {
  if (source === VALUE_SOURCE.GG) return null;
  const a = anchorsOf(source);
  return a.shark > 0 ? a.frost / a.shark : 1;
};

export const getDerivedFactors = () => ({ ...derived });

/**
 * Compare a derived factor against the RTDB `factor` value, so a stale or
 * wrong constant is visible instead of silently mispricing everything.
 *
 * Returns null when there is nothing to compare, otherwise
 * `{ rtdb, derived, ratio, ok }`. `ok` is a 2% tolerance — the anchors move
 * with the market, so exact equality is not expected or wanted.
 */
export const factorHealth = (rtdbFactor, source = VALUE_SOURCE.ELVEBREDD) => {
  if (source === VALUE_SOURCE.GG) return null;   // nothing to compare
  const rtdb = Number(rtdbFactor);
  const mine = sharksPerFrost(source);
  if (!Number.isFinite(rtdb) || rtdb <= 0 || !mine) return null;
  const ratio = mine / rtdb;
  return { rtdb, derived: mine, ratio, ok: Math.abs(ratio - 1) <= 0.02 };
};

// ── Conversion ─────────────────────────────────────────────────────────────

/**
 * Convert one raw feed number into the requested unit.
 *
 * Divide by the price of the unit you want, in the feed's own numbers:
 *
 *   sharks = value / sharkValue        frosts = value / frostValue
 *
 * GG is exempt — it has no units, so there is nothing to convert and it is
 * returned exactly as published. See "Units are Elvebredd's" in the header for
 * why, and for what converting it cost. Elvebredd keeps both units; its
 * Shark/Frost toggle is unaffected.
 */
export const convert = (value, source, unit) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 0;

  // Shown as published. See the block above before changing this.
  if (source === VALUE_SOURCE.GG) return n;

  const a = anchorsOf(source);
  const divisor = unit === VALUE_UNIT.FROST ? a.frost : a.shark;
  if (!(divisor > 0)) return n;

  return n / divisor;
};

// ── Reading a value off an item ────────────────────────────────────────────

/**
 * Categories the feeds price with a single `value`, mirroring
 * HomeScreen.getItemValue. `eggs` is the odd one out: it carries the price in
 * `rvalue`, and both feeds write `value` too, so either key works.
 */
const SIMPLE_CATEGORIES = [
  'eggs', 'vehicles', 'pet wear', 'other', 'toys', 'strollers', 'food', 'gifts', 'stickers',
];

export const isSimpleCategory = (type) =>
  SIMPLE_CATEGORIES.includes(String(type || '').toLowerCase());

/**
 * The RAW value for an item, in its feed's native unit and at full precision.
 *
 * `valueType` is 'd' | 'n' | 'm' (regular / neon / mega); the fly and ride
 * flags pick the potion variant. Simple categories ignore all three.
 */
export const rawValue = (item, valueType = 'd', isFly = false, isRide = false) => {
  if (!item) return 0;

  if (isSimpleCategory(item.type)) {
    const raw = String(item.type).toLowerCase() === 'eggs'
      ? (item.rvalue ?? item.value)
      : item.value;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  if (!valueType) return 0;

  const key = valueType === 'n' ? 'nvalue' : valueType === 'm' ? 'mvalue' : 'rvalue';
  const suffix = isFly && isRide ? ' - fly&ride'
    : isFly ? ' - fly'
      : isRide ? ' - ride' : ' - nopotion';

  const n = Number(item[key + suffix]);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The value to display: raw, converted into the active unit.
 *
 * Deliberately NOT rounded. Rounding is a rendering decision and belongs in
 * formatValue — rounding here is what made 3,004 Elvebredd items read as 0.00
 * in Frost mode.
 */
export const valueOf = (item, {
  source = DEFAULT_VALUE_SOURCE,
  unit = DEFAULT_VALUE_UNIT,
  valueType = 'd',
  isFly = false,
  isRide = false,
} = {}) => convert(rawValue(item, valueType, isFly, isRide), source, unit);

// ── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format a value for display with enough precision to stay meaningful.
 *
 * A fixed 2 decimals is right for Sharks (a dear pet is 930) and useless for
 * Frosts (most of the catalogue is under 0.01). This scales the decimals to
 * the magnitude instead, and trims trailing zeros so common values stay short.
 *
 *   1234.5678 -> "1,234.57"      0.0456  -> "0.0456"
 *      12.345 -> "12.35"         0.00015 -> "0.00015"
 *       1.005 -> "1.01"          0       -> "0"
 */
export const formatValue = (value, { maxSignificant = 4 } = {}) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '0';

  const abs = Math.abs(n);
  let decimals;
  // 📅 2026-09-19. Below 100, allow 4 decimals and let the trim below drop
  // what is not needed. GG is shown as published (see convert) and 28% of its
  // values above 1 carry 3 or 4 decimals — 1.725, 5.125, 13.65 — so a fixed 2
  // would round a Frost Dragon to "1.73" and undo native display. The whole GG
  // catalogue tops out at 40, so it never reaches the 100 band. Elvebredd is
  // barely affected: 34 of its 8,352 values above 1 carry a 3rd decimal, and
  // the toFixed also truncates the ~172 float-noise values (1058.9000000000001)
  // rather than exposing them.
  if (abs >= 100) decimals = 2;
  else if (abs >= 1) decimals = 4;
  else {
    // Keep `maxSignificant` significant digits below 1, capped so the string
    // stays readable. 0.0456 -> 4 dp, 0.00015 -> 5 dp.
    const leadingZeros = Math.floor(-Math.log10(abs));
    decimals = Math.min(leadingZeros + maxSignificant, 8);
  }

  const fixed = n.toFixed(decimals);
  // Trim trailing zeros: "1.20" -> "1.2", "3.00" -> "3".
  const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
  const [intPart, decPart] = trimmed.split('.');
  const withSeparators = Number(intPart).toLocaleString('en-US');
  return decPart ? `${withSeparators}.${decPart}` : withSeparators;
};

/** Convenience: read an item and format it in one step. */
export const displayValue = (item, opts) => formatValue(valueOf(item, opts));

// ── Cross-source item matching ─────────────────────────────────────────────

/**
 * One key for one item, whichever catalogue named it.
 *
 * 1,091 of GG's 1,134 names match an Elvebredd item on this key alone. The
 * 43 that do not are 36 Houses (Elvebredd has no such category) and 7 spelling
 * differences, which the pipeline already aliases when borrowing artwork — so
 * by the time a GG row reaches the app its `image` is the Elvebredd path and
 * no alias table is needed here.
 */
export const normalizeName = (name) =>
  String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

let ggIndex = new Map();
let elvebreddIndex = new Map();

const buildIndex = (rows) => {
  const next = new Map();
  if (Array.isArray(rows)) {
    for (const item of rows) {
      if (!item || !item.name) continue;
      const key = normalizeName(item.name);
      // First writer wins. Elvebredd lists 37 names on more than one row; the
      // earlier row is the canonical one, matching the pipeline's own rule.
      if (!next.has(key)) next.set(key, item);
    }
  }
  return next;
};

/** Called once per feed load, with the UNWRAPPED array. */
export const indexSource = (source, rows) => {
  if (source === VALUE_SOURCE.GG) ggIndex = buildIndex(rows);
  else elvebreddIndex = buildIndex(rows);
  return source === VALUE_SOURCE.GG ? ggIndex.size : elvebreddIndex.size;
};

export const getIndexSize = (source) =>
  (source === VALUE_SOURCE.GG ? ggIndex : elvebreddIndex).size;

/**
 * The same item as priced by `source`.
 *
 * Returns null when that catalogue does not list it — which is a real answer,
 * not an error. 2,363 Elvebredd names are absent from GG (98% of them worth
 * under 0.01 Frost), and 43 GG names are absent from Elvebredd. The caller
 * should say "not listed" rather than show 0.
 */
export const itemInSource = (item, source) => {
  if (!item) return null;
  const index = source === VALUE_SOURCE.GG ? ggIndex : elvebreddIndex;
  return index.get(normalizeName(item.name || item.Name)) || null;
};

/**
 * Price an item from the ACTIVE source, following it across catalogues by
 * name. `missing` distinguishes "this source does not list it" from "it is
 * listed at zero" — different messages to a trader.
 */
export const priceOf = (item, {
  source = DEFAULT_VALUE_SOURCE,
  unit = DEFAULT_VALUE_UNIT,
  valueType = 'd',
  isFly = false,
  isRide = false,
} = {}) => {
  if (!item) return { value: 0, missing: true, source };

  // An item already from this source needs no lookup.
  const own = (item.valueSource || VALUE_SOURCE.ELVEBREDD) === source
    ? item
    : itemInSource(item, source);

  if (!own) return { value: 0, missing: true, source };

  return {
    value: valueOf(own, { source, unit, valueType, isFly, isRide }),
    missing: false,
    source,
    item: own,
  };
};

// ── Legacy `isSharkMode` compatibility ─────────────────────────────────────
//
// Trades and settings saved before 2026-09 carry a three-way `isSharkMode`:
//
//   true    Shark units, Elvebredd
//   false   Frost units, Elvebredd
//   'GG'    GG values   (an earlier, since-removed GG mode)
//
// Those rows still have to render. Translate on read; never write this shape
// back.

export const fromLegacyMode = (isSharkMode) => {
  if (isSharkMode === 'GG') {
    return { source: VALUE_SOURCE.GG, unit: VALUE_UNIT.FROST };
  }
  return {
    source: VALUE_SOURCE.ELVEBREDD,
    unit: isSharkMode === false ? VALUE_UNIT.FROST : VALUE_UNIT.SHARK,
  };
};

/** What to stamp on a NEW saved trade, so old readers still show something. */
export const toLegacyMode = (source, unit) => {
  if (source === VALUE_SOURCE.GG) return 'GG';
  return unit !== VALUE_UNIT.FROST;
};

/**
 * Which catalogue priced a saved trade.
 *
 * Reads `valueSource` when present, then falls back to the legacy three-way
 * `isSharkMode`, then to its items. Trades posted before 2026-09 carry none of
 * these, and Elvebredd is the honest answer for those — it was the only
 * catalogue then.
 */
export const sourceOfTrade = (trade) => {
  if (!trade) return VALUE_SOURCE.ELVEBREDD;
  if (trade.valueSource === VALUE_SOURCE.GG || trade.valueSource === VALUE_SOURCE.ELVEBREDD) {
    return trade.valueSource;
  }
  if (trade.isSharkMode === 'GG') return VALUE_SOURCE.GG;

  const fromItems = [...(trade.hasItems || []), ...(trade.wantsItems || [])]
    .find((i) => i && i.valueSource);
  return fromItems?.valueSource === VALUE_SOURCE.GG ? VALUE_SOURCE.GG : VALUE_SOURCE.ELVEBREDD;
};

/**
 * Which catalogue priced a list of items sent into a chat.
 *
 * Items shared before 2026-09 carry no `valueSource`, and Elvebredd is the
 * honest answer for those — it was the only catalogue then.
 */
export const sourceOfItems = (items) => {
  const found = Array.isArray(items) ? items.find((i) => i && i.valueSource) : null;
  return found?.valueSource === VALUE_SOURCE.GG ? VALUE_SOURCE.GG : VALUE_SOURCE.ELVEBREDD;
};

/** As above, but the human label. */
export const sourceLabelForItems = (items) => SOURCE_LABEL[sourceOfItems(items)];

/** Short tag for a badge: "ELV" or "GG". */
export const sourceTag = (source) =>
  source === VALUE_SOURCE.GG ? 'GG' : 'ELV';

/**
 * Bare site name, for sentences that supply their own noun.
 *
 * Separate from SOURCE_LABEL because that one is button text — SOURCE_LABEL.gg
 * is "GG Values", which would read "Based on GG Values values".
 */
export const SOURCE_NAME = {
  [VALUE_SOURCE.ELVEBREDD]: 'Elvebredd',
  [VALUE_SOURCE.GG]: 'GG',
};

/**
 * The sentence shown above a shared item list, e.g. in chat:
 * "Based on Elvebredd values" / "Based on GG values".
 */
export const sourceStatement = (source) =>
  `Based on ${SOURCE_NAME[source] || SOURCE_NAME[VALUE_SOURCE.ELVEBREDD]} values`;

// ── Artwork ───────────────────────────────────────────────────────────────

/**
 * The image URL for an item, from whichever source priced it.
 *
 * Three cases, in order:
 *
 *   relative path   `/images/pets/Bat Dragon.png` — prefixed with baseImgUrl
 *                   (`https://elvebredd.com`). 1,517 of GG's 1,561 rows carry
 *                   one of these, borrowed from the Elvebredd catalogue by the
 *                   pipeline, so most GG art renders for free.
 *   absolute URL    returned untouched. The 44 GG rows with no Elvebredd
 *                   counterpart — 36 Houses and 8 spelling mismatches — fall
 *                   back to `ggImage` (`https://amvgg.com/items/<Name>.webp`),
 *                   which serves 200 image/webp with no Referer needed.
 *   neither         '' — the caller already renders its empty state.
 *
 * Callers used to prefix blindly, which would turn an absolute ggImage into
 * `https://elvebredd.com/https://amvgg.com/...`. Hence one resolver.
 */
export const resolveItemImage = (item, baseImgUrl) => {
  if (!item || !item.name) return '';

  const raw = String(item.image || '');
  if (/^https?:\/\//.test(raw)) return raw;

  if (raw && baseImgUrl) {
    const base = String(baseImgUrl).replace(/"/g, '').replace(/\/$/, '');
    return `${base}/${raw.replace(/^\//, '')}`;
  }

  // GG-only item with no borrowed art.
  const own = String(item.ggImage || '');
  return /^https?:\/\//.test(own) ? own : '';
};

// ── Category lists, derived from the active feed ──────────────────────────

/**
 * The category filters to show, taken FROM THE DATA rather than hardcoded.
 *
 * The two feeds happen to share one vocabulary today — all ten types line up,
 * because the pipeline maps amvgg's categories onto Elvebredd's names. But
 * that is a property of the current mapping, not a guarantee: Elvebredd
 * carries 3,491 items to GG's 1,561, and either site can add a category
 * whenever it likes.
 *
 * A hardcoded list fails silently in both directions — a NEW type gets no
 * filter and its items become unreachable, and a type the active feed does not
 * carry shows an empty filter. Deriving the list means the bar always matches
 * what is actually there.
 *
 * `preferredOrder` keeps the familiar ordering for the types we know about;
 * anything unrecognised is appended alphabetically rather than dropped.
 */
const PREFERRED_ORDER = [
  'pets', 'eggs', 'toys', 'vehicles', 'pet wear',
  'strollers', 'other', 'food', 'gifts', 'stickers',
];

export const categoriesFor = (rows, { prefix = [] } = {}) => {
  const present = new Set();
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const type = String(row?.type || '').trim().toLowerCase();
      if (type) present.add(type);
    }
  }

  // Nothing loaded yet — fall back to the familiar list so the bar is never
  // empty on a cold start.
  const types = present.size ? [...present] : [...PREFERRED_ORDER];

  const known = PREFERRED_ORDER.filter((t) => types.includes(t));
  const unknown = types.filter((t) => !PREFERRED_ORDER.includes(t)).sort();

  return [...prefix, ...[...known, ...unknown].map((t) => t.toUpperCase())];
};

export const __testing = { anchorValue, ANCHORS, PREFERRED_ORDER };
