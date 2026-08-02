/**
 * valueHistoryHelper.js
 *
 * Reads per-item value history from the Bunny CDN published by the
 * `elvebredd_bunny` pipeline (https://adoptme-history.b-cdn.net).
 *
 * Two layers, both cached in MMKV:
 *   1. An index built once from the CDN catalog: "name|type" -> history key.
 *   2. The per-item history series, fetched lazily when a chart is opened.
 *
 * ── Why the index is keyed by name+type and not by id ──────────────────────
 * The app's catalog (adoptme.b-cdn.net) and the history feed are two separate
 * upstream feeds. Both carry an `id`, and both are internally consistent, but
 * they re-index differently from id 2591 onward. Measured 2026-08-02: joining
 * on id matches 3,415/3,419 items yet 496 of those matches (14.5%) resolve to a
 * *different* item — app id 2591 "Arctic Dusk Dragon" lands on the history
 * feed's "2D Kitty". That failure is silent: no error, just a wrong chart on one
 * item in seven. Name+type gives 3,349 unambiguous matches and fails loudly
 * (returns null) on the rest.
 */

import { CATALOG_URL, historyUrl } from './valueHistoryConfig';

// ── MMKV cache (same pattern as analyticsDataHelper) ──
let historyCache;
try {
  const { createMMKV } = require('react-native-mmkv');
  historyCache = createMMKV({ id: 'value-history-cache' });
} catch (e) {
  console.warn('[valueHistory] MMKV not available:', e.message);
  historyCache = {
    getString: () => undefined,
    getNumber: () => undefined,
    set: () => {},
    delete: () => {},
  };
}

const INDEX_KEY = 'vh_index';
const INDEX_TS_KEY = 'vh_index_ts';
const SERIES_PREFIX = 'vh_s_';
const SERIES_TS_PREFIX = 'vh_st_';

// The catalog only changes when the pipeline republishes (roughly weekly), and a
// stale index costs nothing worse than a missing chart on a brand-new pet.
const INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// History files are effectively immutable once written — the CDN serves them
// with max-age=2592000. A day is plenty to pick up an appended point.
const SERIES_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// A series needs at least two points to draw a line. Items below this render an
// explanatory empty state instead of a flat chart. As of 2026-08-02 this
// excludes 30 of 762 pets — all recent additions with a single snapshot.
export const MIN_POINTS_FOR_CHART = 2;

// ── Name normalization ──
// Must match the join used to verify coverage: lowercase, strip everything that
// isn't alphanumeric. Absorbs the casing and punctuation drift between the two
// feeds ("Water Opossum"/"Water Opposum" still differ and stay unmatched, but
// "Box Of Jokes"/"Box of Jokes" and "Socks & Sandals"/"Socks and Sandals" match).
export const normalizeItemName = (name) =>
  String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]/g, '');

const indexKeyFor = (name, type) =>
  `${normalizeItemName(name)}|${String(type || '').toLowerCase().trim()}`;

const isFresh = (tsKey, ttl) => {
  const ts = historyCache.getNumber(tsKey);
  if (!ts) return false;
  return Date.now() - ts < ttl;
};

// ── Index ──────────────────────────────────────────────────────────────────
// In-memory copy so repeated lookups during a render pass don't re-parse JSON.
let _indexMemo = null;
let _indexInflight = null;

/**
 * Build "name|type" -> history key from the CDN catalog.
 * Entries whose name+type is not unique are dropped: the catalog disambiguates
 * them with an "-<id>" suffix on the key, and since the app's id doesn't line up
 * with the catalog's there is no reliable way to pick the right one. 59 items
 * fall in this bucket (two "Jetpack", two "Dumbbell", ...); they get the
 * "no history" state rather than a coin-flip chart.
 */
const buildIndex = (catalog) => {
  const seen = Object.create(null);
  const index = Object.create(null);

  catalog.forEach((entry) => {
    if (!entry || !entry.h) return; // h: null -> no history file exists
    const key = indexKeyFor(entry.name, entry.type);
    if (key === '|') return;
    seen[key] = (seen[key] || 0) + 1;
    index[key] = entry.h;
  });

  Object.keys(seen).forEach((key) => {
    if (seen[key] > 1) delete index[key];
  });

  return index;
};

const loadIndex = async () => {
  if (_indexMemo) return _indexMemo;

  const cached = historyCache.getString(INDEX_KEY);
  if (cached && isFresh(INDEX_TS_KEY, INDEX_TTL_MS)) {
    try {
      _indexMemo = JSON.parse(cached);
      return _indexMemo;
    } catch (e) {
      historyCache.delete(INDEX_KEY);
    }
  }

  if (_indexInflight) return _indexInflight;

  _indexInflight = (async () => {
    try {
      const res = await fetch(CATALOG_URL);
      if (!res.ok) throw new Error(`catalog HTTP ${res.status}`);
      const catalog = await res.json();
      if (!Array.isArray(catalog) || !catalog.length) {
        throw new Error('catalog empty or not an array');
      }
      const index = buildIndex(catalog);
      historyCache.set(INDEX_KEY, JSON.stringify(index));
      historyCache.set(INDEX_TS_KEY, Date.now());
      _indexMemo = index;
      return index;
    } catch (e) {
      console.warn('[valueHistory] index build failed:', e.message);
      // Serve a stale index rather than nothing — an expired mapping is still
      // correct for every item that existed at the last successful build.
      if (cached) {
        try {
          _indexMemo = JSON.parse(cached);
          return _indexMemo;
        } catch (parseErr) {
          /* fall through */
        }
      }
      return null;
    } finally {
      _indexInflight = null;
    }
  })();

  return _indexInflight;
};

/** Warm the index ahead of first use so opening a chart doesn't pay for it. */
export const prefetchHistoryIndex = () => {
  loadIndex().catch(() => {});
};

// ── Series ─────────────────────────────────────────────────────────────────
const _seriesInflight = Object.create(null);

const isValidPoint = (p) =>
  p && typeof p === 'object' && typeof p.date === 'string' && p.date.length === 10;

const fetchSeries = async (historyKey) => {
  const cacheKey = SERIES_PREFIX + historyKey;
  const tsKey = SERIES_TS_PREFIX + historyKey;

  const cached = historyCache.getString(cacheKey);
  if (cached && isFresh(tsKey, SERIES_TTL_MS)) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      historyCache.delete(cacheKey);
    }
  }

  if (_seriesInflight[historyKey]) return _seriesInflight[historyKey];

  _seriesInflight[historyKey] = (async () => {
    try {
      const res = await fetch(historyUrl(historyKey));
      // 404 is expected and not an error: the catalog can name a key whose file
      // was never published. Cache the empty result so we don't refetch it.
      if (res.status === 404) {
        historyCache.set(cacheKey, '[]');
        historyCache.set(tsKey, Date.now());
        return [];
      }
      if (!res.ok) throw new Error(`history HTTP ${res.status}`);

      const raw = await res.json();
      const series = Array.isArray(raw) ? raw.filter(isValidPoint) : [];
      historyCache.set(cacheKey, JSON.stringify(series));
      historyCache.set(tsKey, Date.now());
      return series;
    } catch (e) {
      console.warn(`[valueHistory] series "${historyKey}" failed:`, e.message);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (parseErr) {
          /* fall through */
        }
      }
      return null; // null = fetch failed (retryable), [] = genuinely empty
    } finally {
      delete _seriesInflight[historyKey];
    }
  })();

  return _seriesInflight[historyKey];
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve an app catalog item to its history key, or null when the item has no
 * usable history (unpublished, or an ambiguous duplicate name).
 */
export const getHistoryKey = async (item) => {
  if (!item || !item.name) return null;
  const index = await loadIndex();
  if (!index) return null;
  return index[indexKeyFor(item.name, item.type)] || null;
};

/**
 * The four series the feed tracks, and the app catalog field each one
 * corresponds to. Documented in the pipeline README §3 — `D` is the regular
 * no-potion price, not the headline `rvalue`.
 */
export const SERIES = [
  { key: 'D', labelKey: 'value.history.series_regular', fallback: 'Regular', color: '#FF6666', currentFields: ['rvalue - nopotion', 'value', 'rvalue'] },
  { key: 'FR', labelKey: 'value.history.series_flyride', fallback: 'Fly & Ride', color: '#3498db', currentFields: ['rvalue - fly&ride', 'rvalue', 'value'] },
  { key: 'N', labelKey: 'value.history.series_neon', fallback: 'Neon', color: '#2ecc71', currentFields: ['nvalue', 'nvalue - nopotion'] },
  { key: 'M', labelKey: 'value.history.series_mega', fallback: 'Mega', color: '#9b59b6', currentFields: ['mvalue', 'mvalue - nopotion'] },
];

const toNumber = (v) => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[",\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Current value for a series, read from the app's own catalog row.
 *
 * The pipeline README is explicit that the last history point is NOT today's
 * value — history and the live values are separate upstream series, and 1,746
 * of 2,777 files stop at 2026-04-13. So the chart's final point comes from the
 * live row the app already has, appended to the fetched series.
 */
export const getCurrentValueFor = (item, seriesKey) => {
  const spec = SERIES.find((s) => s.key === seriesKey);
  if (!spec || !item) return null;
  for (let i = 0; i < spec.currentFields.length; i += 1) {
    const n = toNumber(item[spec.currentFields[i]]);
    if (n != null && n > 0) return n;
  }
  return null;
};

const todayISO = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Load a chart-ready series for one item and one band.
 *
 * Returns { points, status } where status is one of:
 *   'ok'        — points has >= MIN_POINTS_FOR_CHART entries, safe to draw
 *   'thin'      — the item exists upstream but has too few points to plot
 *   'none'      — no history published for this item (or an ambiguous name)
 *   'error'     — network/parse failure; the caller may offer a retry
 */
export const loadItemHistory = async (item, seriesKey) => {
  const historyKey = await getHistoryKey(item);
  if (!historyKey) return { points: [], status: 'none' };

  const raw = await fetchSeries(historyKey);
  if (raw == null) return { points: [], status: 'error' };

  const points = [];
  raw.forEach((p) => {
    const value = toNumber(p[seriesKey]);
    if (value != null) points.push({ date: p.date, value });
  });

  // Append today's live value so the line reaches the present instead of
  // stopping wherever the upstream series happened to end.
  const current = getCurrentValueFor(item, seriesKey);
  if (current != null) {
    const today = todayISO();
    const last = points[points.length - 1];
    if (last && last.date === today) {
      last.value = current;
    } else if (!last || last.date < today) {
      points.push({ date: today, value: current, isCurrent: true });
    }
  }

  if (points.length < MIN_POINTS_FOR_CHART) {
    return { points, status: points.length ? 'thin' : 'none' };
  }
  return { points, status: 'ok' };
};

/** Test hook — drops every cached index and series. */
export const clearHistoryCache = () => {
  _indexMemo = null;
  historyCache.delete(INDEX_KEY);
  historyCache.delete(INDEX_TS_KEY);
};
