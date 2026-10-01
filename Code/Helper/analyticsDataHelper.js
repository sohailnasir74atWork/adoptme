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
    remove: () => {},
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

// ── Value-changes diff reader ──
// diff.json entries carry {oldVal,newVal} per value key: rvalue (regular),
// nvalue (neon), mvalue (mega), plus "- fly"/"- ride" variants. They may
// also carry `score`, which is a RANK (1 = most valuable), not a value, so a
// rising score means the pet got LESS valuable. Never read it as a price.
const PRIMARY_VALUE_KEYS = ['rvalue', 'value', 'nvalue', 'mvalue'];
const VALUE_KEY_RE = /^[rnm]?value( - .+)?$/;
const MM2_PRIMARY_DEFAULT = 'd_nopotion';

// A diff older than this is not "news" any more: no Hot / +X% badges.
export const DIFF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const asChange = (v) => {
    if (!v || typeof v !== 'object') return null;
    const oldVal = Number(v.oldVal);
    const newVal = Number(v.newVal);
    if (!Number.isFinite(oldVal) || !Number.isFinite(newVal) || oldVal <= 0) return null;
    return { oldVal, newVal, pct: Math.round(((newVal - oldVal) / oldVal) * 100) };
};

/**
 * The value change of one diff entry: {oldVal, newVal, pct, key} or null.
 * Prefers the regular value, then neon, then mega. Rank-only (`score`)
 * entries return null.
 */
export const valueChangeOf = (item) => {
    if (!item || typeof item !== 'object') return null;

    // Normalised format ({values, primary}): MM2 feed and AnalyticsScreen.
    if (item.values && typeof item.values === 'object') {
        const key = item.primary || MM2_PRIMARY_DEFAULT;
        const c = asChange(item.values[key]);
        return c ? { ...c, key } : null;
    }

    for (const key of PRIMARY_VALUE_KEYS) {
        const c = asChange(item[key]);
        if (c) return { ...c, key };
    }
    for (const key of Object.keys(item)) {
        if (!VALUE_KEY_RE.test(key)) continue;
        const c = asChange(item[key]);
        if (c) return { ...c, key };
    }
    return null;
};

/** The entries of a diff payload, or [] when it is missing or too old. */
export const freshDiffEntries = (changesData, now = Date.now()) => {
    if (!changesData || typeof changesData !== 'object') return [];
    const generatedAt = Date.parse(changesData.meta?.generatedAt || changesData.lastUpdated || '');
    if (Number.isFinite(generatedAt) && now - generatedAt > DIFF_MAX_AGE_MS) return [];
    return Array.isArray(changesData.changed) ? changesData.changed
        : Array.isArray(changesData.changes) ? changesData.changes
            : [];
};

export const normalizeName = (name) => (typeof name === 'string' ? name : String(name || '')).toLowerCase().trim();

const isCacheFresh = (tsKey) => {
    const ts = analyticsCache.getNumber(tsKey);
    if (!ts) return false;
    return Date.now() - ts < CACHE_DURATION_MS;
};

// How easily a pet trades, from last week's trade posts (demandWindow '7d').
//   fast: lots of people ask for it, or asks clearly beat offers
//   slow: offered at least 4x as often as it is asked for
// Thresholds checked on the 2026-09-29 week (1,730 trades): Crystal Egg
// 175 wanted / 16 offered = fast, Ride Potion 156/364 = fast (it's currency),
// Throwback Egg 18/110 and Catte 3/70 = slow.
export const liquidityFor = (wanted, offered) => {
    const w = Number(wanted) || 0;
    const o = Number(offered) || 0;
    if (w >= 40 || (w >= 20 && w * 2 >= o) || (w >= 5 && w >= o * 1.5)) return 'fast';
    if (o >= 8 && w * 4 <= o) return 'slow';
    return null; // average, or too little data to say
};

// ── Build maps from raw data (called once, result is cached in state) ──
//   demandMap: 1-10 rank score from topWanted
//   hotMap / dropMap: value risers / fallers from the latest diff
//   marketMap: { wanted, offered, liquidity } per pet (7-day trade posts)
const buildMaps = (analyticsRaw, changesRaw) => {
    const result = { demandMap: {}, hotMap: {}, dropMap: {}, marketMap: {} };

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

            // Before 2026-09-29 the counts were mostly wishlists and owned
            // pets, not trades, so they say nothing about how fast a pet sells.
            if (analytics?.demandWindow === '7d') {
                const market = {};
                const add = (list, field) => (Array.isArray(list) ? list : []).forEach((item) => {
                    const name = normalizeName(item?.name);
                    if (!name) return;
                    market[name] = market[name] || { wanted: 0, offered: 0 };
                    market[name][field] = Number(item.count) || 0;
                });
                add(analytics.topWanted, 'wanted');
                add(analytics.topOffered, 'offered');
                Object.keys(market).forEach((name) => {
                    const m = market[name];
                    result.marketMap[name] = { ...m, liquidity: liquidityFor(m.wanted, m.offered) };
                });
            }
        }

        if (changesRaw) {
            const changesData = typeof changesRaw === 'string' ? JSON.parse(changesRaw) : changesRaw;
            freshDiffEntries(changesData).forEach((item) => {
                const name = normalizeName(item.name);
                if (!name) return;
                const change = valueChangeOf(item);
                if (change && change.pct >= 1) result.hotMap[name] = { pct: change.pct, isHot: true };
                else if (change && change.pct <= -1) result.dropMap[name] = { pct: change.pct };
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
                const res = await fetch(`${ANALYTICS_CDN_URL}?cb=${Date.now()}`);
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
                const res = await fetch(`${VALUE_CHANGES_CDN_URL}?cb=${Date.now()}`);
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

export const getMarket = (itemName, marketMap) => (marketMap && marketMap[normalizeName(itemName)]) || null;
