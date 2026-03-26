/**
 * analyticsDataHelper.js
 * 
 * Shared helper that reads analytics + value-changes data from MMKV cache
 * (same cache used by AnalyticsScreen) and builds fast lookup maps for
 * demand scores and hot (value-rise) items.
 * 
 * If cache is empty, fetches directly from CDN and caches the result.
 * Uses in-flight deduplication to prevent multiple screens from triggering
 * duplicate CDN requests.
 */



// ── Same cache instance & keys as AnalyticsScreen.js ──
let analyticsCache;
try {
  const { createMMKV } = require('react-native-mmkv');
  analyticsCache = createMMKV({ id: 'analytics-cache' });
} catch (e) {
  console.warn('[analyticsDataHelper] MMKV not available:', e.message);
  analyticsCache = {
    getString: () => undefined,
    getNumber: () => undefined,
    set: () => {},
    delete: () => {},
  };
}
const ANALYTICS_CACHE_KEY = 'analytics';
const ANALYTICS_TS_KEY = 'analytics_ts';
const CHANGES_CACHE_KEY = 'value_changes';
const CHANGES_TS_KEY = 'value_changes_ts';

// ── CDN URLs (same as AnalyticsScreen) ──
const ANALYTICS_CDN_URL = 'https://analytics.b-cdn.net';
const VALUE_CHANGES_CDN_URL = 'https://check-diff-adoptme.b-cdn.net/diff.json';

const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

// ── In-flight promise deduplication ──
// Prevents duplicate CDN requests when multiple screens mount at the same time
let _inflight = null;

// ── Firestore unwrappers (duplicated to keep this module self-contained) ──
const unwrapFirestoreValue = (v) => {
    if (!v || typeof v !== 'object') return v;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return Number(v.doubleValue);
    if ('booleanValue' in v) return Boolean(v.booleanValue);
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('mapValue' in v) return unwrapFirestoreMap(v.mapValue);
    if ('arrayValue' in v) return unwrapFirestoreArray(v.arrayValue);
    return v;
};

const unwrapFirestoreMap = (mapValue) => {
    const fields = mapValue?.fields || {};
    const out = {};
    Object.keys(fields).forEach((k) => {
        out[k] = unwrapFirestoreValue(fields[k]);
    });
    return out;
};

const unwrapFirestoreArray = (arrayValue) => {
    const values = arrayValue?.values || [];
    return values.map(unwrapFirestoreValue);
};

const normalizeFirestoreDocPayload = (payload) => {
    const doc = payload?.documents?.[0];
    if (doc?.fields) return unwrapFirestoreMap({ fields: doc.fields });
    return payload;
};

// ── Value-changes diff normalizer ──
const VALUE_KEY_MAP = {
    'value': 'd_nopotion', 'value - fly': 'd_fly', 'value - ride': 'd_ride', 'value - fly&ride': 'd_flyride',
    'rvalue': 'd_nopotion', 'rvalue - fly': 'd_fly', 'rvalue - ride': 'd_ride', 'rvalue - fly&ride': 'd_flyride',
    'nvalue': 'n_nopotion', 'nvalue - fly': 'n_fly', 'nvalue - ride': 'n_ride', 'nvalue - fly&ride': 'n_flyride',
    'mvalue': 'm_nopotion', 'mvalue - fly': 'm_fly', 'mvalue - ride': 'm_ride', 'mvalue - fly&ride': 'm_flyride',
};
const SKIP_KEYS = new Set(['key', 'name', 'type', 'image']);

const normalizeDiffItem = (item) => {
    // Adoptme format: score: {oldVal, newVal}
    if (item.score && typeof item.score === 'object' && 'oldVal' in item.score && 'newVal' in item.score) {
        const diff = item.score.newVal - item.score.oldVal;
        const pct = item.score.oldVal > 0 ? Math.round((diff / item.score.oldVal) * 100) : 0;
        return { oldVal: item.score.oldVal, newVal: item.score.newVal, pct };
    }

    // MM2 format: inline value keys
    let primaryOld = 0;
    let primaryNew = 0;
    let foundPrimary = false;

    for (const k of Object.keys(item)) {
        if (SKIP_KEYS.has(k)) continue;
        const mapped = VALUE_KEY_MAP[k];
        if (!mapped) continue;
        const v = item[k];
        if (v && typeof v === 'object' && 'oldVal' in v && 'newVal' in v) {
            if (!foundPrimary) {
                primaryOld = v.oldVal;
                primaryNew = v.newVal;
                foundPrimary = true;
            }
        }
    }

    if (!foundPrimary) return null;
    const diff = primaryNew - primaryOld;
    const pct = primaryOld > 0 ? Math.round((diff / primaryOld) * 100) : 0;
    return { oldVal: primaryOld, newVal: primaryNew, pct };
};

export const normalizeName = (name) => (name || '').toLowerCase().trim();

const isCacheFresh = (tsKey) => {
    const ts = analyticsCache.getNumber(tsKey);
    if (!ts) return false;
    return Date.now() - ts < CACHE_DURATION_MS;
};

// ── Build maps from raw data (called once, result is cached in state) ──
const buildMaps = (analyticsRaw, changesRaw) => {
    const result = { demandMap: {}, hotMap: {} };

    try {
        if (analyticsRaw) {
            let analytics = typeof analyticsRaw === 'string' ? JSON.parse(analyticsRaw) : analyticsRaw;
            analytics = normalizeFirestoreDocPayload(analytics);
            const topWanted = analytics?.topWanted || [];
            const total = topWanted.length;

            if (total > 0) {
                topWanted.forEach((item, index) => {
                    const name = normalizeName(item.name);
                    if (!name) return;
                    const score = Math.max(1, Math.round(10 - (index / total) * 9));
                    result.demandMap[name] = { score, label: `${score}/10`, count: (item.count || 0) };
                });
            }
        }

        if (changesRaw) {
            let changesData = typeof changesRaw === 'string' ? JSON.parse(changesRaw) : changesRaw;
            const rawList = Array.isArray(changesData?.changed) ? changesData.changed
                : Array.isArray(changesData?.changes) ? changesData.changes
                    : [];

            rawList.forEach((item) => {
                const name = normalizeName(item.name);
                if (!name) return;

                // Adoptme format: score: {oldVal, newVal}
                if (item.score && typeof item.score === 'object' && 'oldVal' in item.score && 'newVal' in item.score) {
                    if (item.score.newVal > item.score.oldVal) {
                        const pct = item.score.oldVal > 0 ? Math.round(((item.score.newVal - item.score.oldVal) / item.score.oldVal) * 100) : 0;
                        result.hotMap[name] = { pct, isHot: true };
                    }
                    return;
                }

                // MM2 format: item.values
                if (item.values) {
                    const primary = item.primary || 'd_nopotion';
                    const v = item.values[primary];
                    if (v && v.newVal > v.oldVal) {
                        const pct = v.oldVal > 0 ? Math.round(((v.newVal - v.oldVal) / v.oldVal) * 100) : 0;
                        result.hotMap[name] = { pct, isHot: true };
                    }
                    return;
                }

                const normalized = normalizeDiffItem(item);
                if (normalized && normalized.pct > 0) {
                    result.hotMap[name] = { pct: normalized.pct, isHot: true };
                }
            });
        }
    } catch (error) {
        console.warn('[analyticsDataHelper] Error building maps:', error.message);
    }

    return result;
};

/**
 * Async — fetches from CDN if cache is empty/stale, then returns maps.
 * Deduplicates: if multiple screens call this simultaneously, only one
 * CDN fetch runs and all callers share the same promise.
 */
export const fetchAnalyticsData = async () => {
    // If a fetch is already in flight, reuse it
    if (_inflight) return _inflight;

    // If cache is fresh, return from cache immediately (no async needed)
    const cachedAnalytics = analyticsCache.getString(ANALYTICS_CACHE_KEY);
    const cachedChanges = analyticsCache.getString(CHANGES_CACHE_KEY);
    if (cachedAnalytics && isCacheFresh(ANALYTICS_TS_KEY) && cachedChanges && isCacheFresh(CHANGES_TS_KEY)) {
        return buildMaps(cachedAnalytics, cachedChanges);
    }

    // Start fetch and store the promise for deduplication
    _inflight = (async () => {
        let analyticsRaw = cachedAnalytics;
        let changesRaw = cachedChanges;

        if (!analyticsRaw || !isCacheFresh(ANALYTICS_TS_KEY)) {
            try {
                const res = await fetch(ANALYTICS_CDN_URL);
                if (res.ok) {
                    const text = await res.text();
                    analyticsCache.set(ANALYTICS_CACHE_KEY, text);
                    analyticsCache.set(ANALYTICS_TS_KEY, Date.now());
                    analyticsRaw = text;
                }
            } catch (e) {
                console.warn('[analyticsDataHelper] Analytics fetch failed:', e.message);
            }
        }

        if (!changesRaw || !isCacheFresh(CHANGES_TS_KEY)) {
            try {
                const res = await fetch(VALUE_CHANGES_CDN_URL);
                if (res.ok) {
                    const text = await res.text();
                    analyticsCache.set(CHANGES_CACHE_KEY, text);
                    analyticsCache.set(CHANGES_TS_KEY, Date.now());
                    changesRaw = text;
                }
            } catch (e) {
                console.warn('[analyticsDataHelper] Value changes fetch failed:', e.message);
            }
        }

        return buildMaps(analyticsRaw, changesRaw);
    })();

    try {
        const result = await _inflight;
        return result;
    } finally {
        _inflight = null; // Clear after completion
    }
};

/**
 * Quick lookup helpers — O(1) hash map access
 */
export const getDemandScore = (itemName, demandMap) => {
    return demandMap[normalizeName(itemName)] || null;
};

export const getHotStatus = (itemName, hotMap) => {
    return hotMap[normalizeName(itemName)] || null;
};
