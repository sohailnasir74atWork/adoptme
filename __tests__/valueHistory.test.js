/**
 * Tests for valueHistoryHelper — the name+type join and series assembly.
 *
 * Fixtures are real rows lifted from https://adoptme-history.b-cdn.net/values.json
 * on 2026-08-02, including the id-collision pair that makes an id-based join
 * unsafe (app id 2591 is "Arctic Dusk Dragon"; the history feed's 2591 is
 * "2D Kitty").
 */

const mockMmkvStore = new Map();

jest.mock(
  'react-native-mmkv',
  () => ({
    createMMKV: () => ({
      getString: (k) => mockMmkvStore.get(k),
      getNumber: (k) => mockMmkvStore.get(k),
      set: (k, v) => mockMmkvStore.set(k, v),
      delete: (k) => mockMmkvStore.delete(k),
    }),
  }),
  { virtual: true }
);

// ── Fixtures ──
const CATALOG = [
  { id: '168', name: 'Shadow Dragon', type: 'pets', h: 'shadow-dragon' },
  { id: '3354', name: 'Rubber Ducky', type: 'pets', h: 'rubber-ducky' },
  { id: '1049', name: 'Jetpack', type: 'pet wear', h: 'jetpack-1049' },
  { id: '1066', name: 'Jetpack', type: 'pet wear', h: 'jetpack-1066' },
  { id: '2596', name: 'Arctic Dusk Dragon', type: 'pets', h: 'arctic-dusk-dragon' },
  { id: '2591', name: '2D Kitty', type: 'pets', h: '2d-kitty' },
  { id: '2658', name: 'Endangered Egg', type: 'eggs', h: null },
  // Name carries "&" but the derived history key spells it "and" — proof the key
  // is not reconstructable from the name.
  { id: '900', name: 'Socks & Sandals', type: 'pet wear', h: 'socks-and-sandals-900' },
];

const SERIES_FILES = {
  'shadow-dragon': [
    { date: '2024-08-08', D: 708, FR: 255, N: 615, M: 2065 },
    { date: '2025-02-01', D: 780, FR: 500, N: 900, M: 2800 },
    { date: '2026-08-02', D: 834, FR: 667, N: 1340, M: 3720 },
  ],
  'rubber-ducky': [{ date: '2026-07-24', D: 0.012, FR: 0.462, N: 0.6, M: 1.7 }],
  'arctic-dusk-dragon': [
    { date: '2026-01-01', D: 100, FR: 120, N: 200, M: 500 },
    { date: '2026-04-13', D: 140, FR: 160, N: 260, M: 640 },
  ],
  '2d-kitty': [
    { date: '2026-01-01', D: 1, FR: 2, N: 3, M: 4 },
    { date: '2026-04-13', D: 1.5, FR: 2.5, N: 3.5, M: 4.5 },
  ],
};

let fetchCalls = [];

beforeEach(() => {
  mockMmkvStore.clear();
  fetchCalls = [];
  jest.resetModules();
  global.fetch = jest.fn(async (url) => {
    fetchCalls.push(url);
    if (url.endsWith('/values.json')) {
      return { ok: true, status: 200, json: async () => CATALOG };
    }
    const m = url.match(/\/history\/(.+)\.json$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      if (SERIES_FILES[key]) {
        return { ok: true, status: 200, json: async () => SERIES_FILES[key] };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  });
});

const load = () => require('../Code/Helper/valueHistoryHelper');

// App catalog rows use the app's own field names and its own ids.
const appItem = (over) => ({
  name: 'Shadow Dragon',
  type: 'pets',
  'rvalue - nopotion': 834,
  'rvalue - fly&ride': 667,
  nvalue: 1340,
  mvalue: 3730,
  ...over,
});

describe('name normalization', () => {
  test('absorbs the casing and spacing drift between the two feeds', () => {
    const { normalizeItemName } = load();
    expect(normalizeItemName('Box Of Jokes')).toBe(normalizeItemName('box of jokes'));
    expect(normalizeItemName('White WInter Hat')).toBe(normalizeItemName('White Winter Hat'));
    expect(normalizeItemName('Tortuga De La Isla')).toBe(normalizeItemName('Tortuga de la Isla'));
    expect(normalizeItemName('Sun & Moon Earrings')).toBe(normalizeItemName('sun & moon  earrings'));
  });

  test('does not rewrite & to "and" — the feeds agree on which one a name uses', () => {
    // Verified against the full catalog on 2026-08-02: expanding & to "and"
    // produces an identical join (3,349 unique / 59 ambiguous / 11 unmatched).
    // "and" only ever appears in the derived history key, never in `name`.
    const { normalizeItemName } = load();
    expect(normalizeItemName('Socks & Sandals')).not.toBe(normalizeItemName('Socks and Sandals'));
  });

  test('handles null and non-string input', () => {
    const { normalizeItemName } = load();
    expect(normalizeItemName(null)).toBe('');
    expect(normalizeItemName(undefined)).toBe('');
    expect(normalizeItemName(1234)).toBe('1234');
  });
});

describe('history key resolution', () => {
  test('resolves a known pet by name+type', async () => {
    const { getHistoryKey } = load();
    await expect(getHistoryKey(appItem())).resolves.toBe('shadow-dragon');
  });

  test('ignores the app id entirely — the feeds disagree above id 2590', async () => {
    const { getHistoryKey } = load();
    // The app's id 2591 is "Arctic Dusk Dragon". An id-based lookup would hit
    // the history feed's 2591, which is "2D Kitty". Name+type must not.
    const key = await getHistoryKey(appItem({ id: '2591', name: 'Arctic Dusk Dragon' }));
    expect(key).toBe('arctic-dusk-dragon');
    expect(key).not.toBe('2d-kitty');
  });

  test('returns null for duplicate name+type rather than guessing', async () => {
    const { getHistoryKey } = load();
    await expect(getHistoryKey({ name: 'Jetpack', type: 'pet wear' })).resolves.toBeNull();
  });

  test('returns null when the catalog has no history file', async () => {
    const { getHistoryKey } = load();
    await expect(getHistoryKey({ name: 'Endangered Egg', type: 'eggs' })).resolves.toBeNull();
  });

  test('returns null for an item absent from the feed', async () => {
    const { getHistoryKey } = load();
    await expect(getHistoryKey({ name: 'Dylan', type: 'pets' })).resolves.toBeNull();
  });

  test('matches a name whose key spells out its punctuation', async () => {
    // Catalog name is "Socks & Sandals"; its history key is "socks-and-sandals-900".
    // The key is opaque — resolution must go through the name, never the slug.
    const { getHistoryKey } = load();
    await expect(
      getHistoryKey({ name: 'Socks & Sandals', type: 'pet wear' })
    ).resolves.toBe('socks-and-sandals-900');
  });

  test('downloads the catalog once and serves later lookups from cache', async () => {
    const { getHistoryKey } = load();
    await getHistoryKey(appItem());
    await getHistoryKey({ name: 'Rubber Ducky', type: 'pets' });
    expect(fetchCalls.filter((u) => u.endsWith('/values.json'))).toHaveLength(1);
  });
});

describe('series assembly', () => {
  test('returns chartable points for a well-covered pet', async () => {
    const { loadItemHistory } = load();
    const { status, points } = await loadItemHistory(appItem(), 'D');
    expect(status).toBe('ok');
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points[0]).toEqual({ date: '2024-08-08', value: 708 });
  });

  test('reads the band asked for, not the headline value', async () => {
    const { loadItemHistory } = load();
    const neon = await loadItemHistory(appItem(), 'N');
    expect(neon.points[0].value).toBe(615);
    const mega = await loadItemHistory(appItem(), 'M');
    expect(mega.points[0].value).toBe(2065);
  });

  test('flags a single-point series as thin instead of drawing it', async () => {
    const { loadItemHistory } = load();
    const item = { name: 'Rubber Ducky', type: 'pets' }; // no live value to append
    const { status, points } = await loadItemHistory(item, 'D');
    expect(status).toBe('thin');
    expect(points).toHaveLength(1);
  });

  test('reports items with no published history as none', async () => {
    const { loadItemHistory } = load();
    const { status, points } = await loadItemHistory({ name: 'Endangered Egg', type: 'eggs' }, 'D');
    expect(status).toBe('none');
    expect(points).toHaveLength(0);
  });

  test('a 404 on the series file is empty, not an error', async () => {
    const { loadItemHistory } = load();
    // Catalog names a key whose file was never published.
    const catalogWithGhost = CATALOG.concat([
      { id: '9999', name: 'Ghost Pet', type: 'pets', h: 'ghost-pet' },
    ]);
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith('/values.json')) return { ok: true, status: 200, json: async () => catalogWithGhost };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const { status } = await loadItemHistory({ name: 'Ghost Pet', type: 'pets' }, 'D');
    expect(status).toBe('none');
  });

  test('surfaces a network failure as error so the sheet can offer a retry', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith('/values.json')) return { ok: true, status: 200, json: async () => CATALOG };
      throw new Error('offline');
    });
    const { loadItemHistory } = load();
    const { status } = await loadItemHistory(appItem(), 'D');
    expect(status).toBe('error');
  });
});

describe('current value is appended, not inferred from history', () => {
  test('appends a live point when history stops in the past', async () => {
    const { loadItemHistory } = load();
    // Arctic Dusk Dragon's series ends 2026-04-13 — the common case, 1,746 files
    // stop on that date. The live value must still terminate the line.
    const item = appItem({ name: 'Arctic Dusk Dragon', 'rvalue - nopotion': 999 });
    const { points } = await loadItemHistory(item, 'D');
    const last = points[points.length - 1];
    expect(last.value).toBe(999);
    expect(last.isCurrent).toBe(true);
    expect(last.date > '2026-04-13').toBe(true);
  });

  test('overwrites rather than duplicates when history already reaches today', async () => {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    global.fetch = jest.fn(async (url) => {
      if (url.endsWith('/values.json')) return { ok: true, status: 200, json: async () => CATALOG };
      return {
        ok: true,
        status: 200,
        json: async () => [
          { date: '2026-01-01', D: 100, FR: 1, N: 1, M: 1 },
          { date: iso, D: 500, FR: 1, N: 1, M: 1 },
        ],
      };
    });
    const { loadItemHistory } = load();
    const { points } = await loadItemHistory(appItem({ 'rvalue - nopotion': 777 }), 'D');
    const dates = points.map((p) => p.date);
    expect(dates.filter((d) => d === iso)).toHaveLength(1);
    expect(points[points.length - 1].value).toBe(777);
  });

  test('a thin series plus a live value becomes chartable', async () => {
    const { loadItemHistory } = load();
    const item = { name: 'Rubber Ducky', type: 'pets', 'rvalue - nopotion': 0.02 };
    const { status, points } = await loadItemHistory(item, 'D');
    expect(status).toBe('ok');
    expect(points).toHaveLength(2);
  });
});

describe('getCurrentValueFor field mapping', () => {
  test('D reads the no-potion regular price, not the headline rvalue', () => {
    const { getCurrentValueFor } = load();
    const item = { 'rvalue - nopotion': 834, rvalue: 667, value: 700 };
    expect(getCurrentValueFor(item, 'D')).toBe(834);
  });

  test('falls through to the next field when the preferred one is absent', () => {
    const { getCurrentValueFor } = load();
    expect(getCurrentValueFor({ value: 42 }, 'D')).toBe(42);
  });

  test('parses quoted and comma-formatted numbers from the feed', () => {
    const { getCurrentValueFor } = load();
    expect(getCurrentValueFor({ nvalue: '"1,340"' }, 'N')).toBe(1340);
  });

  test('returns null when nothing usable is present', () => {
    const { getCurrentValueFor } = load();
    expect(getCurrentValueFor({ mvalue: 'n/a' }, 'M')).toBeNull();
    expect(getCurrentValueFor({}, 'M')).toBeNull();
  });
});
