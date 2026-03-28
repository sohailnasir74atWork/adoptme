import React, { useEffect, useMemo, useState, useCallback, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, RefreshControl, Dimensions, Platform,
  TextInput, Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import { getThemeColors } from '../Helper/themeColors';

import BannerAdComponent from '../Ads/bannerAds';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import { useTranslation } from 'react-i18next';

// ---- Firestore REST format -> plain JS ----
const unwrapFirestoreValue = (v) => {
  if (!v || typeof v !== 'object') return v;

  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('nullValue' in v) return null;

  if ('timestampValue' in v) return v.timestampValue; // keep as string
  if ('mapValue' in v) return unwrapFirestoreMap(v.mapValue);
  if ('arrayValue' in v) return unwrapFirestoreArray(v.arrayValue);

  return v; // fallback
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
  // Firestore export style: { documents: [ { fields: { ... } } ] }
  const doc = payload?.documents?.[0];
  if (doc?.fields) return unwrapFirestoreMap({ fields: doc.fields });
  return payload; // already plain JSON
};


let analyticsCache;
try {
  const { createMMKV } = require('react-native-mmkv');
  analyticsCache = createMMKV({ id: 'analytics-cache' });
} catch (e) {
  console.warn('[AnalyticsScreen] MMKV not available:', e.message);
  analyticsCache = {
    getString: () => undefined,
    getNumber: () => undefined,
    set: () => {},
    delete: () => {}
  };
}

// Cache durations
const ANALYTICS_CACHE_MS = 60 * 60 * 1000; // 3 hours
const CHANGES_CACHE_MS = 60 * 60 * 1000;   // 1 hour

// CDN URLs — you push data here after cloud function runs
const ANALYTICS_CDN_URL = 'https://analytics.b-cdn.net';
const VALUE_CHANGES_CDN_URL = 'https://check-diff-adoptme.b-cdn.net/diff.json';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Visual multiplier — cosmetic boost for displayed counts only
// Does NOT affect ratios, percentages, confidence, or prediction logic
const VM = 2;

// Fun color palettes for kids
const FUN_COLORS = {
  blue: '#4F8CFF', green: '#34D399', pink: '#F472B6', purple: '#A78BFA',
  orange: '#FB923C', red: '#F87171', yellow: '#FBBF24', cyan: '#22D3EE',
};
const BAR_COLORS = [
  '#4F8CFF', '#A78BFA', '#F472B6', '#FB923C', '#34D399', '#FBBF24',
  '#22D3EE', '#F87171', '#4F8CFF', '#A78BFA', '#F472B6', '#FB923C',
  '#34D399', '#FBBF24', '#22D3EE', '#F87171', '#4F8CFF', '#A78BFA',
  '#F472B6', '#FB923C', '#34D399', '#FBBF24', '#22D3EE', '#F87171',
];

// Value type labels for display (module-level constant to avoid re-allocation)
const VALUE_TYPE_LABELS = {
  d_nopotion: 'D', d_fly: 'D-F', d_ride: 'D-R', d_flyride: 'D-FR',
  n_nopotion: 'N', n_fly: 'N-F', n_ride: 'N-R', n_flyride: 'N-FR',
  m_nopotion: 'M', m_fly: 'M-F', m_ride: 'M-R', m_flyride: 'M-FR',
};

// ── Extracted sub-components (outside main component to prevent unmount/remount on every state change) ──

const LockedOverlay = memo(({ message, onPress, styles }) => (
  <TouchableOpacity
    style={styles.lockedOverlay}
    activeOpacity={0.9}
    onPress={onPress}
  >
    <View style={styles.lockedContent}>
      <Text style={{ fontSize: 24 }}>{'\u{1F512}'}</Text>
      <Text style={styles.lockedText}>{message}</Text>
      <View style={styles.unlockButton}>
        <Text style={styles.unlockButtonText}>{'\u{2B50}'} Upgrade</Text>
      </View>
    </View>
  </TouchableOpacity>
));

const ItemRow = memo(({ item, index, showSignal, showChange, locked, getImageUrl, isDarkMode, styles }) => {
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  const rankDisplay = index < 3 ? medals[index] : `#${index + 1}`;

  const getSignalColor = (signal) => {
    switch (signal) {
      case 'rising': case 'strong_rise': case 'likely_rise': return FUN_COLORS.green;
      case 'falling': case 'strong_fall': case 'likely_fall': return FUN_COLORS.red;
      default: return FUN_COLORS.yellow;
    }
  };

  const getSignalEmoji = (signal) => {
    switch (signal) {
      case 'rising': case 'strong_rise': case 'likely_rise': return 'trending-up';
      case 'falling': case 'strong_fall': case 'likely_fall': return 'trending-down';
      default: return 'remove-outline';
    }
  };

  return (
    <View style={[styles.itemRow, index % 2 === 0 && styles.itemRowAlt]}>
      <Text style={[styles.itemRank, index < 3 && { fontSize: 18 }]}>{rankDisplay}</Text>
      <View style={styles.itemImageWrap}>
        {item.image ? (
          <Image source={{ uri: getImageUrl(item.image) }} style={styles.itemImage} />
        ) : (
          <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
            <Icon name="cube-outline" size={18} color={isDarkMode ? '#666' : '#bbb'} />
          </View>
        )}
      </View>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={1}>{locked ? '???' : item.name}</Text>
        <Text style={styles.itemType}>{item.type}</Text>
      </View>
      {showSignal && item.signal && (
        <View style={[styles.signalBadge, { backgroundColor: getSignalColor(item.signal) + '25' }]}>
          <Icon name={getSignalEmoji(item.signal)} size={16} color={getSignalColor(item.signal)} />
          <Text style={[styles.signalText, { color: getSignalColor(item.signal) }]}>
            {item.ratio?.toFixed(1)}x
          </Text>
        </View>
      )}
      {showChange && item.changePercent !== undefined && (
        <View style={[styles.changeBadge, {
          backgroundColor: item.changePercent > 0 ? FUN_COLORS.green + '25' : FUN_COLORS.red + '25'
        }]}>
          <Text style={{ fontSize: 12 }}>{item.changePercent > 0 ? '\u{1F4C8}' : '\u{1F4C9}'}</Text>
          <Text style={[styles.changeText, {
            color: item.changePercent > 0 ? FUN_COLORS.green : FUN_COLORS.red
          }]}>
            {Math.abs(item.changePercent)}%
          </Text>
        </View>
      )}
      {!showSignal && !showChange && (
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{(item.count || 0) * VM}x</Text>
        </View>
      )}
    </View>
  );
});

const MiniBarChart = memo(({ data, label, peakHour, styles }) => {
  const maxVal = Math.max(...data, 1);
  return (
    <View style={styles.chartContainer}>
      <Text style={styles.chartLabel}>{label}</Text>
      <View style={styles.chartBars}>
        {data.map((val, i) => {
          const isPeak = i === peakHour;
          return (
            <View key={i} style={styles.chartBarWrap}>
              <View
                style={[
                  styles.chartBar,
                  {
                    height: Math.max(4, (val / maxVal) * 70),
                    backgroundColor: isPeak ? FUN_COLORS.orange : BAR_COLORS[i],
                    opacity: isPeak ? 1 : 0.7,
                  },
                ]}
              />
              {i % 4 === 0 && (
                <Text style={styles.chartBarLabel}>{i}h</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
});

const SectionHeader = memo(({ icon, title, subtitle, locked, emoji, styles }) => (
  <View style={styles.sectionHeader}>
    <View style={styles.sectionHeaderLeft}>
      {emoji ? (
        <Text style={{ fontSize: 20 }}>{emoji}</Text>
      ) : (
        <FontAwesome name={icon} size={18} color={config.colors.primary} solid />
      )}
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
    {locked && (
      <View style={styles.proBadge}>
        <Text style={{ fontSize: 12 }}>{'\u{1F451}'}</Text>
        <Text style={styles.proBadgeText}>PRO</Text>
      </View>
    )}
    {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
  </View>
));

// ── Change Row Component (heavy — memoized to avoid re-renders) ──
const ChangeRow = memo(({ item, index, isDarkMode, getImageUrl, getTimeAgo, formatNumber, getPrimaryChange, styles }) => {
  const primary = getPrimaryChange(item);
  const isUp = primary.pct > 0;
  const isZero = primary.pct === 0;
  const hasMultiValues = item.values && Object.keys(item.values).length > 0;

  return (
    <View style={[styles.changeRow, index % 2 === 0 && styles.itemRowAlt, { flexDirection: 'column', alignItems: 'stretch' }]}>
      {/* Top row: Image + Name + Primary Change */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={styles.changeLeft}>
          <View style={styles.itemImageWrap}>
            {item.image ? (
              <Image source={{ uri: getImageUrl(item.image) }} style={styles.itemImage} />
            ) : (
              <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                <Icon name="cube-outline" size={16} color={isDarkMode ? '#666' : '#999'} />
              </View>
            )}
          </View>
          <View style={styles.changeInfo}>
            <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={styles.itemType}>{item.type || 'Pet'}</Text>
              {item.date && (
                <Text style={styles.changeDateText}>{getTimeAgo(item.date)}</Text>
              )}
            </View>
          </View>
        </View>

        {/* Primary value change */}
        <View style={styles.changeRight}>
          <View style={styles.changeValuesRow}>
            <Text style={styles.changeOldValue}>{formatNumber(primary.oldVal)}</Text>
            <Text style={{ fontSize: 12 }}>{'\u{27A1}\u{FE0F}'}</Text>
            <Text style={[styles.changeNewValue, { color: isUp ? FUN_COLORS.green : isZero ? (isDarkMode ? '#aaa' : '#666') : FUN_COLORS.red }]}>
              {formatNumber(primary.newVal)}
            </Text>
          </View>
          <View style={[styles.changePctBadge, {
            backgroundColor: isUp ? FUN_COLORS.green + '25' : isZero ? (isDarkMode ? '#33333340' : '#eee') : FUN_COLORS.red + '25',
          }]}>
            {!isZero && (
              <Text style={{ fontSize: 10 }}>{isUp ? '\u{2B06}\u{FE0F}' : '\u{2B07}\u{FE0F}'}</Text>
            )}
            <Text style={[styles.changePctText, {
              color: isUp ? FUN_COLORS.green : isZero ? (isDarkMode ? '#888' : '#999') : FUN_COLORS.red,
            }]}>
              {isZero ? '0%' : `${isUp ? '+' : ''}${primary.pct}%`}
            </Text>
          </View>
        </View>
      </View>

      {/* Sub-values grid (all value types) */}
      {hasMultiValues && (
        <View style={styles.subValuesGrid}>
          {Object.entries(item.values).map(([vKey, v]) => {
            const label = VALUE_TYPE_LABELS[vKey] || vKey;
            const vDiff = v.newVal - v.oldVal;
            const vPct = v.oldVal > 0 ? Math.round((vDiff / v.oldVal) * 100) : 0;
            const vUp = vDiff > 0;
            const vSame = vDiff === 0;
            const isPrimary = vKey === (item.primary || 'd_nopotion');

            return (
              <View key={vKey} style={[styles.subValueItem, isPrimary && styles.subValueItemPrimary]}>
                <Text style={[styles.subValueLabel, isPrimary && { color: config.colors.primary }]}>{label}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <Text style={styles.subValueOld}>{formatNumber(v.oldVal)}</Text>
                  <Icon name="arrow-forward" size={8} color={isDarkMode ? '#444' : '#ccc'} />
                  <Text style={[styles.subValueNew, { color: vUp ? FUN_COLORS.green : vSame ? (isDarkMode ? '#888' : '#999') : FUN_COLORS.red }]}>
                    {formatNumber(v.newVal)}
                  </Text>
                </View>
                <Text style={[styles.subValuePct, { color: vUp ? FUN_COLORS.green : vSame ? (isDarkMode ? '#666' : '#bbb') : FUN_COLORS.red }]}>
                  {vSame ? '0%' : `${vUp ? '+' : ''}${vPct}%`}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
});

const CHANGES_PAGE_SIZE = 15;
const LIST_PAGE_SIZE = 15;

const AnalyticsScreen = ({ navigation }) => {
  const { theme, single_offer_wall } = useGlobalState();
  const { localState } = useLocalState();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  const isPro = localState.isPro;

  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [showOfferwall, setShowOfferwall] = useState(false);
  const [valueChanges, setValueChanges] = useState(null);
  const [valueChangesLoading, setValueChangesLoading] = useState(false);
  const [changesFilter, setChangesFilter] = useState('all'); // 'all', 'increased', 'decreased'
  const [changesVisible, setChangesVisible] = useState(CHANGES_PAGE_SIZE); // progressive rendering
  const [moversVisible, setMoversVisible] = useState(LIST_PAGE_SIZE);
  const [demandVisible, setDemandVisible] = useState(LIST_PAGE_SIZE);
  const [predictVisible, setPredictVisible] = useState(LIST_PAGE_SIZE);

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState(''); // submitted search
  const searchInputRef = React.useRef(null);

  // ── Fetch from Bunny CDN with MMKV caching ──
  const fetchFromCDN = useCallback(async (url, cacheKey, cacheDuration) => {
    try {
      // Check MMKV cache first
      const cachedRaw = analyticsCache.getString(cacheKey);
      const cachedTimeRaw = analyticsCache.getString(`${cacheKey}_time`);

      if (cachedRaw && cachedTimeRaw) {
        const cachedTime = parseInt(cachedTimeRaw, 10);
        const age = Date.now() - cachedTime;
        if (age < cacheDuration) {
          return JSON.parse(cachedRaw);
        }
      }

      // Cache expired or missing — fetch from CDN
      const res = await fetch(`${url}?cb=${Date.now()}`);
      const data = await res.json();

      // Save to MMKV cache
      analyticsCache.set(cacheKey, JSON.stringify(data));
      analyticsCache.set(`${cacheKey}_time`, Date.now().toString());

      return data;
    } catch (error) {
      // If fetch fails, return stale cache if available
      const cachedRaw = analyticsCache.getString(cacheKey);
      if (cachedRaw) return JSON.parse(cachedRaw);
      return null;
    }
  }, []);

  const fetchAnalytics = useCallback(async (isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      if (isRefresh) {
        analyticsCache.delete('analytics');
        analyticsCache.delete('analytics_time');
      }

      const raw = await fetchFromCDN(ANALYTICS_CDN_URL, 'analytics', ANALYTICS_CACHE_MS);

      const data = normalizeFirestoreDocPayload(raw); // ✅ ADD THIS LINE

      if (data) setAnalytics(data);
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchFromCDN]);


  const normalizeDiffPayload = useCallback((data) => {
    if (!data || typeof data !== 'object') return null;

    // Already in app format (manual value_changes.json)
    if (Array.isArray(data.changes)) return data;

    // CDN diff.json format: { meta, changed, added, removed }
    const rawList = Array.isArray(data.changed) ? data.changed : [];
    const generatedDate = data.meta?.generatedAt
      ? data.meta.generatedAt.split('T')[0]
      : new Date().toISOString().split('T')[0];

    // Map diff.json raw value keys → app normalized keys
    const VALUE_KEY_MAP = {
      'value': 'd_nopotion', 'value - fly': 'd_fly', 'value - ride': 'd_ride', 'value - fly&ride': 'd_flyride',
      'rvalue': 'd_nopotion', 'rvalue - fly': 'd_fly', 'rvalue - ride': 'd_ride', 'rvalue - fly&ride': 'd_flyride',
      'nvalue': 'n_nopotion', 'nvalue - fly': 'n_fly', 'nvalue - ride': 'n_ride', 'nvalue - fly&ride': 'n_flyride',
      'mvalue': 'm_nopotion', 'mvalue - fly': 'm_fly', 'mvalue - ride': 'm_ride', 'mvalue - fly&ride': 'm_flyride',
    };
    const SKIP_KEYS = new Set(['key', 'name', 'type', 'image']);

    const changes = rawList.map(item => {
      const values = {};
      let primaryKey = null;

      Object.keys(item).forEach(k => {
        if (SKIP_KEYS.has(k)) return;
        const mapped = VALUE_KEY_MAP[k];
        if (!mapped) return;
        const v = item[k];
        if (v && typeof v === 'object' && 'oldVal' in v && 'newVal' in v) {
          values[mapped] = { oldVal: v.oldVal, newVal: v.newVal };
          if (!primaryKey) primaryKey = mapped;
        }
      });

      // Skip items with no actual value changes (e.g. only type changed)
      if (Object.keys(values).length === 0) return null;

      // Handle type being an object (type change diff) — use newVal
      const itemType = item.type && typeof item.type === 'object'
        ? (item.type.newVal || item.type.oldVal || 'unknown')
        : (item.type || 'unknown');

      return {
        name: item.name || '',
        type: itemType,
        image: item.image || '',
        date: generatedDate,
        primary: primaryKey || 'd_nopotion',
        values,
      };
    }).filter(Boolean);

    return {
      lastUpdated: data.meta?.generatedAt || new Date().toISOString(),
      note: `${changes.length} value${changes.length !== 1 ? 's' : ''} changed`,
      changes,
    };
  }, []);

  const fetchValueChanges = useCallback(async (isRefresh = false) => {
    try {
      setValueChangesLoading(true);

      if (isRefresh) {
        analyticsCache.delete('value_changes');
        analyticsCache.delete('value_changes_time');
      }

      const raw = await fetchFromCDN(VALUE_CHANGES_CDN_URL, 'value_changes', CHANGES_CACHE_MS);
      const data = normalizeDiffPayload(raw);
      if (data && Array.isArray(data.changes)) {
        setValueChanges(data);
      }
    } catch (error) {
      console.warn('Could not fetch value changes:', error.message);
    } finally {
      setValueChangesLoading(false);
    }
  }, [fetchFromCDN, normalizeDiffPayload]);

  useEffect(() => {
    fetchAnalytics();
    // Value changes are now lazy-loaded when the user taps the changes tab
  }, [fetchAnalytics]);

  // ── Lazy-load value changes only when changes tab is first opened ──
  const valueChangesFetchedRef = React.useRef(false);
  useEffect(() => {
    if (activeTab === 'changes' && !valueChangesFetchedRef.current) {
      valueChangesFetchedRef.current = true;
      fetchValueChanges();
    }
  }, [activeTab, fetchValueChanges]);

  const styles = useMemo(() => getStyles(isDarkMode, c), [isDarkMode]);

  const getImageUrl = useCallback((image) => {
    if (!image || !localState.imgurl) return '';
    const baseUrl = typeof localState.imgurl === 'string'
      ? localState.imgurl.replace(/"/g, '').replace(/\/$/, '')
      : '';
    return `${baseUrl}/${image.replace(/^\//, '')}`;
  }, [localState.imgurl]);

  const formatNumber = (num) => {
    if (!num && num !== 0) return '0';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getSignalColor = (signal) => {
    switch (signal) {
      case 'rising': case 'strong_rise': case 'likely_rise': return FUN_COLORS.green;
      case 'falling': case 'strong_fall': case 'likely_fall': return FUN_COLORS.red;
      default: return FUN_COLORS.yellow;
    }
  };

  const getSignalEmoji = (signal) => {
    switch (signal) {
      case 'rising': case 'strong_rise': case 'likely_rise': return 'trending-up';
      case 'falling': case 'strong_fall': case 'likely_fall': return 'trending-down';
      default: return 'remove-outline';
    }
  };

  const getPredictionLabel = (prediction) => {
    switch (prediction) {
      case 'strong_rise': return t('analytics.strong_rise');
      case 'likely_rise': return t('analytics.likely_rise');
      case 'stable': return t('analytics.stable');
      case 'likely_fall': return t('analytics.likely_fall');
      case 'strong_fall': return t('analytics.strong_fall');
      default: return t('analytics.unknown');
    }
  };

  const getPredictionEmoji = (prediction) => {
    switch (prediction) {
      case 'strong_rise': return '\u{1F525}';
      case 'likely_rise': return '\u{2B06}\u{FE0F}';
      case 'stable': return '\u{1F7F0}';
      case 'likely_fall': return '\u{2B07}\u{FE0F}';
      case 'strong_fall': return '\u{1F4A8}';
      default: return '\u{2753}';
    }
  };

  // Stable callback for LockedOverlay press
  const handleShowOfferwall = useCallback(() => setShowOfferwall(true), []);

  const getTimeAgo = useCallback((dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return t('analytics.today');
    if (diffDays === 1) return t('analytics.yesterday') || 'Yesterday';
    if (diffDays < 7) return `${diffDays}d`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`;
    return date.toLocaleDateString();
  }, [t]);

  const getChangeDirection = useCallback((item) => {
    // Use 'primary' field if present (new format), fallback to oldValue/newValue (legacy)
    if (item.values) {
      const primary = item.primary || 'd_nopotion';
      const v = item.values[primary];
      if (!v) return 'same';
      return v.newVal > v.oldVal ? 'up' : v.newVal < v.oldVal ? 'down' : 'same';
    }
    // Legacy single-value format
    if (item.newValue > item.oldValue) return 'up';
    if (item.newValue < item.oldValue) return 'down';
    return 'same';
  }, []);

  const getPrimaryChange = useCallback((item) => {
    if (item.values) {
      const primary = item.primary || 'd_nopotion';
      const v = item.values[primary];
      if (!v) return { oldVal: 0, newVal: 0, pct: 0 };
      const diff = v.newVal - v.oldVal;
      const pct = v.oldVal > 0 ? (diff / v.oldVal) * 100 : 0;
      return { oldVal: v.oldVal, newVal: v.newVal, pct: Math.round(pct) };
    }
    const diff = (item.newValue || 0) - (item.oldValue || 0);
    const pct = item.oldValue > 0 ? (diff / item.oldValue) * 100 : 0;
    return { oldVal: item.oldValue || 0, newVal: item.newValue || 0, pct: Math.round(pct) };
  }, []);

  // ── Search handlers ──
  const handleSearch = useCallback(() => {
    if (!isPro) {
      Alert.alert(
        t('analytics.search_pro_title') || 'Pro Feature',
        t('analytics.search_pro_message') || 'You need to get Pro to use search!',
        [
          { text: t('analytics.upgrade') || 'Go Pro', onPress: () => setShowOfferwall(true) },
          { text: t('analytics.maybe_later') || 'Maybe Later', style: 'cancel' },
        ]
      );
      return;
    }
    const q = searchInput.trim().toLowerCase();
    setSearchQuery(q);
    // Reset visible counts when searching
    setChangesVisible(CHANGES_PAGE_SIZE);
    setMoversVisible(LIST_PAGE_SIZE);
    setDemandVisible(LIST_PAGE_SIZE);
    setPredictVisible(LIST_PAGE_SIZE);
  }, [searchInput, isPro, t]);

  const handleCancelSearch = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setChangesVisible(CHANGES_PAGE_SIZE);
    setMoversVisible(LIST_PAGE_SIZE);
    setDemandVisible(LIST_PAGE_SIZE);
    setPredictVisible(LIST_PAGE_SIZE);
  }, []);

  const matchesSearch = useCallback((item) => {
    if (!searchQuery) return true;
    const name = (item.name || '').toLowerCase();
    const type = (item.type || '').toLowerCase();
    return name.includes(searchQuery) || type.includes(searchQuery);
  }, [searchQuery]);

  // ── Filtered lists for movers tab ──
  const filteredMovers = useMemo(() => {
    if (activeTab !== 'movers') return { rising: [], falling: [] };
    const rising = (analytics?.topMovers || []).filter(matchesSearch);
    const falling = (analytics?.topLosers || []).filter(matchesSearch);
    return { rising, falling };
  }, [activeTab, analytics, matchesSearch]);

  // ── Filtered lists for demand tab ──
  const filteredDemand = useMemo(() => {
    if (activeTab !== 'demand') return { wanted: [], offered: [], ratios: [] };
    const wanted = (analytics?.topWanted || []).filter(matchesSearch);
    const offered = (analytics?.topOffered || []).filter(matchesSearch);
    const ratios = (analytics?.demandSupplyRatios || []).filter(matchesSearch);
    return { wanted, offered, ratios };
  }, [activeTab, analytics, matchesSearch]);

  // ── Filtered list for predict tab ──
  const filteredPredictions = useMemo(() => {
    if (activeTab !== 'predict') return [];
    return (analytics?.predictions || []).filter(matchesSearch);
  }, [activeTab, analytics, matchesSearch]);

  // ── Deferred: only compute when changes tab is active ──
  const filteredChanges = useMemo(() => {
    if (activeTab !== 'changes') return []; // skip computation when tab is hidden
    if (!valueChanges?.changes) return [];
    let list = valueChanges.changes;
    if (searchQuery) list = list.filter(matchesSearch);
    if (changesFilter === 'increased') return list.filter(c => getChangeDirection(c) === 'up');
    if (changesFilter === 'decreased') return list.filter(c => getChangeDirection(c) === 'down');
    return list;
  }, [activeTab, valueChanges, changesFilter, getChangeDirection, searchQuery, matchesSearch]);

  // Memoized filter counts — only computed when changes tab is active
  const filterCounts = useMemo(() => {
    if (activeTab !== 'changes') return { all: 0, up: 0, down: 0 };
    if (!valueChanges?.changes) return { all: 0, up: 0, down: 0 };
    let list = valueChanges.changes;
    if (searchQuery) list = list.filter(matchesSearch);
    let up = 0;
    let down = 0;
    for (const c of list) {
      const dir = getChangeDirection(c);
      if (dir === 'up') up++;
      else if (dir === 'down') down++;
    }
    return { all: list.length, up, down };
  }, [activeTab, valueChanges, getChangeDirection, searchQuery, matchesSearch]);

  // ── Tab Bar (fun emoji tabs) ──
  const tabs = [
    { key: 'overview', label: t('analytics.tab_overview'), emoji: '\u{1F3E0}' },
    { key: 'changes', label: t('analytics.tab_changes'), emoji: '\u{1F4CA}' },
    { key: 'movers', label: t('analytics.tab_movers'), emoji: '\u{1F680}' },
    { key: 'demand', label: t('analytics.tab_demand'), emoji: '\u{1F525}' },
    { key: 'predict', label: t('analytics.tab_predict'), emoji: '\u{1F52E}' },
  ];

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={{ fontSize: 40, marginBottom: 8 }}>{'\u{1F50D}'}</Text>
        <ActivityIndicator size="large" color={FUN_COLORS.purple} />
        <Text style={styles.loadingText}>{t('analytics.loading')}</Text>
      </View>
    );
  }

  if (!analytics) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={{ fontSize: 48 }}>{'\u{1F914}'}</Text>
        <Text style={styles.emptyTitle}>{t('analytics.no_analytics_title')}</Text>
        <Text style={styles.emptySubtitle}>{t('analytics.no_analytics_subtitle')}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => fetchAnalytics()}>
          <Text style={styles.retryButtonText}>{'\u{1F504}'} {t('analytics.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab Bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBarScroll}
        contentContainerStyle={styles.tabBar}
      >
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => {
              setActiveTab(tab.key);
              setChangesVisible(CHANGES_PAGE_SIZE);
              setMoversVisible(LIST_PAGE_SIZE);
              setDemandVisible(LIST_PAGE_SIZE);
              setPredictVisible(LIST_PAGE_SIZE);
            }}
          >
            <Text style={{ fontSize: 16 }}>{tab.emoji}</Text>
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]} numberOfLines={1}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Search Bar */}
      {activeTab !== 'overview' && (
        <View style={styles.searchBarWrap}>
          <View style={styles.searchInputWrap}>
            <Icon name="search-outline" size={18} color={isDarkMode ? '#666' : '#999'} style={{ marginLeft: 10 }} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder={t('analytics.search_placeholder') || 'Search pet name...'}
              placeholderTextColor={isDarkMode ? '#555' : '#aaa'}
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchInput.length > 0 && (
              <TouchableOpacity onPress={handleCancelSearch} style={styles.searchClearBtn}>
                <Icon name="close-circle" size={18} color={isDarkMode ? '#666' : '#999'} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={handleSearch} style={styles.searchBtn}>
              <Icon name="search" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
          {searchQuery !== '' && (
            <View style={styles.searchActiveRow}>
              <Text style={styles.searchActiveText}>
                {t('analytics.search_results_for', { query: searchQuery })}
              </Text>
              <TouchableOpacity onPress={handleCancelSearch}>
                <Text style={styles.searchCancelText}>{t('analytics.search_clear')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { fetchAnalytics(true); if (activeTab === 'changes') { valueChangesFetchedRef.current = false; fetchValueChanges(true); } }} tintColor={FUN_COLORS.purple} />
        }
      >
        {/* ═══════════════ OVERVIEW TAB ═══════════════ */}
        {activeTab === 'overview' && (
          <>
            {/* Trade Volume Cards — big, colorful, fun */}
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#1a2540' : '#EBF5FF', borderColor: FUN_COLORS.blue + '40' }]}>
                <Text style={styles.statEmoji}>{'\u{1F91D}'}</Text>
                <Text style={[styles.statNumber, { color: FUN_COLORS.blue }]}>{formatNumber((analytics.tradeVolume?.today || 0) * VM)}</Text>
                <Text style={styles.statLabel}>{t('analytics.today')}</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#1a2a1a' : '#ECFDF5', borderColor: FUN_COLORS.green + '40' }]}>
                <Text style={styles.statEmoji}>{'\u{23F0}'}</Text>
                <Text style={[styles.statNumber, { color: FUN_COLORS.green }]}>{formatNumber((analytics.tradeVolume?.last24h || 0) * VM)}</Text>
                <Text style={styles.statLabel}>{t('analytics.hours_24')}</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#2a1a2e' : '#FDF2F8', borderColor: FUN_COLORS.pink + '40' }]}>
                <Text style={styles.statEmoji}>{'\u{1F4C5}'}</Text>
                <Text style={[styles.statNumber, { color: FUN_COLORS.pink }]}>{formatNumber((analytics.tradeVolume?.thisWeek || 0) * VM)}</Text>
                <Text style={styles.statLabel}>{t('analytics.this_week')}</Text>
              </View>
            </View>

            {/* Win/Lose/Fair Distribution — emoji labels */}
            {analytics.statusDistribution && (
              <View style={styles.card}>
                <SectionHeader icon="chart-pie" title={t('analytics.trade_outcomes')} emoji={'\u{1F3AF}'} styles={styles} />
                <View style={styles.distributionRow}>
                  <View style={styles.distributionItem}>
                    <Text style={styles.distributionEmoji}>{'\u{1F389}'}</Text>
                    <Text style={[styles.distributionLabel, { color: FUN_COLORS.green }]}>{t('analytics.win')}</Text>
                    <Text style={[styles.distributionValue, { color: FUN_COLORS.green }]}>{(analytics.statusDistribution.win || 0) * VM}</Text>
                  </View>
                  <View style={styles.distributionItem}>
                    <Text style={styles.distributionEmoji}>{'\u{1F91D}'}</Text>
                    <Text style={[styles.distributionLabel, { color: FUN_COLORS.yellow }]}>{t('analytics.fair')}</Text>
                    <Text style={[styles.distributionValue, { color: FUN_COLORS.yellow }]}>{(analytics.statusDistribution.fair || 0) * VM}</Text>
                  </View>
                  <View style={styles.distributionItem}>
                    <Text style={styles.distributionEmoji}>{'\u{1F614}'}</Text>
                    <Text style={[styles.distributionLabel, { color: FUN_COLORS.red }]}>{t('analytics.lose')}</Text>
                    <Text style={[styles.distributionValue, { color: FUN_COLORS.red }]}>{(analytics.statusDistribution.lose || 0) * VM}</Text>
                  </View>
                </View>
                {/* Fun rounded bar */}
                <View style={styles.distributionBar}>
                  {(() => {
                    const total = (analytics.statusDistribution.win || 0) +
                      (analytics.statusDistribution.fair || 0) +
                      (analytics.statusDistribution.lose || 0);
                    if (total === 0) return null;
                    const winPct = ((analytics.statusDistribution.win || 0) / total) * 100;
                    const fairPct = ((analytics.statusDistribution.fair || 0) / total) * 100;
                    const losePct = ((analytics.statusDistribution.lose || 0) / total) * 100;
                    return (
                      <>
                        <View style={[styles.distributionBarSegment, { width: `${winPct}%`, backgroundColor: FUN_COLORS.green }]} />
                        <View style={[styles.distributionBarSegment, { width: `${fairPct}%`, backgroundColor: FUN_COLORS.yellow }]} />
                        <View style={[styles.distributionBarSegment, { width: `${losePct}%`, backgroundColor: FUN_COLORS.red }]} />
                      </>
                    );
                  })()}
                </View>
              </View>
            )}

            {/* Hourly Activity — colorful bars */}
            {analytics.hourlyActivity && (
              <View style={styles.card}>
                <SectionHeader icon="chart-bar" title={t('analytics.hourly_activity')} subtitle={t('analytics.peak', { hour: analytics.peakHour })} emoji={'\u{1F552}'} styles={styles} />
                <MiniBarChart data={analytics.hourlyActivity} label={t('analytics.trades_per_hour')} peakHour={analytics?.peakHour} styles={styles} />
              </View>
            )}

            {/* Top 5 Most Traded */}
            <View style={styles.card}>
              <SectionHeader icon="fire" title={t('analytics.most_traded')} emoji={'\u{1F525}'} styles={styles} />
              {(analytics.topTraded || []).slice(0, 5).map((item, i) => (
                <ItemRow key={`traded-${i}`} item={item} index={i} getImageUrl={getImageUrl} isDarkMode={isDarkMode} styles={styles} />
              ))}
            </View>
          </>
        )}

        {/* ═══════════════ VALUE CHANGES TAB ═══════════════ */}
        {activeTab === 'changes' && (
          <>
            {/* Header Card */}
            <View style={[styles.card, { backgroundColor: isDarkMode ? '#1a2a1a' : '#ECFDF5', borderWidth: 1, borderColor: FUN_COLORS.green + '30' }]}>
              <View style={styles.predictionHeader}>
                <Text style={{ fontSize: 28 }}>{'\u{1F4CA}'}</Text>
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={[styles.sectionTitle, { color: FUN_COLORS.green }]}>{t('analytics.value_changes_title')}</Text>
                  <Text style={styles.predictionSubtext}>
                    {t('analytics.value_changes_subtitle')}{valueChanges?.lastUpdated ? ` \u{2022} ${getTimeAgo(valueChanges.lastUpdated)}` : ''}
                  </Text>
                </View>
              </View>
            </View>

            {/* Filter Buttons */}
            <View style={styles.changesFilterRow}>
              {[
                { key: 'all', label: t('analytics.filter_all'), emoji: '\u{1F4CB}' },
                { key: 'increased', label: t('analytics.filter_up'), emoji: '\u{2B06}\u{FE0F}' },
                { key: 'decreased', label: t('analytics.filter_down'), emoji: '\u{2B07}\u{FE0F}' },
              ].map(f => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.changesFilterBtn, changesFilter === f.key && styles.changesFilterBtnActive]}
                  onPress={() => {
                    setChangesFilter(f.key);
                    setChangesVisible(CHANGES_PAGE_SIZE); // reset when switching filters
                  }}
                >
                  <Text style={{ fontSize: 14 }}>{f.emoji}</Text>
                  <Text style={[
                    styles.changesFilterText,
                    changesFilter === f.key && styles.changesFilterTextActive,
                  ]}>
                    {f.label}
                    {f.key === 'all' && filterCounts.all > 0 ? ` (${filterCounts.all})` : ''}
                    {f.key === 'increased' && filterCounts.up > 0 ? ` (${filterCounts.up})` : ''}
                    {f.key === 'decreased' && filterCounts.down > 0 ? ` (${filterCounts.down})` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {valueChangesLoading ? (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 30 }]}>
                <ActivityIndicator size="small" color={FUN_COLORS.purple} />
                <Text style={styles.loadingText}>{t('analytics.loading_changes')}</Text>
              </View>
            ) : !valueChanges || filteredChanges.length === 0 ? (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 30 }]}>
                <Text style={{ fontSize: 36 }}>{'\u{1F937}'}</Text>
                <Text style={[styles.emptySubtitle, { marginTop: 12 }]}>
                  {!valueChanges ? t('analytics.no_changes') : t('analytics.no_filter_match')}
                </Text>
              </View>
            ) : (
              <View style={styles.card}>
                <SectionHeader
                  icon="rotate"
                  title={t('analytics.value_updates')}
                  subtitle={valueChanges.note || `${filteredChanges.length} items changed`}
                  emoji={'\u{1F504}'}
                  styles={styles}
                />
                {filteredChanges.slice(0, changesVisible).map((item, i) => (
                  <ChangeRow
                    key={`change-${i}`}
                    item={item}
                    index={i}
                    isDarkMode={isDarkMode}
                    getImageUrl={getImageUrl}
                    getTimeAgo={getTimeAgo}
                    formatNumber={formatNumber}
                    getPrimaryChange={getPrimaryChange}
                    styles={styles}
                  />
                ))}
                {changesVisible < filteredChanges.length && (
                  <TouchableOpacity
                    style={styles.loadMoreBtn}
                    onPress={() => setChangesVisible(prev => prev + CHANGES_PAGE_SIZE)}
                  >
                    <Text style={styles.loadMoreText}>
                      {'\u{1F447}'} {t('analytics.show_more', { count: filteredChanges.length - changesVisible })}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Info about data source */}
            <View style={styles.disclaimerCard}>
              <Text style={{ fontSize: 14 }}>{'\u{2139}\u{FE0F}'}</Text>
              <Text style={styles.disclaimerText}>
                {t('analytics.changes_disclaimer')}
              </Text>
            </View>
          </>
        )}

        {/* ═══════════════ MOVERS TAB ═══════════════ */}
        {activeTab === 'movers' && (
          <>
            {/* Top Movers (Rising) */}
            <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.green }]}>
              <SectionHeader icon="arrow-trend-up" title={t('analytics.top_movers')} subtitle={t('analytics.rising_demand')} emoji={'\u{1F680}'} styles={styles} />
              {(() => {
                const list = isPro ? filteredMovers.rising : filteredMovers.rising.slice(0, searchQuery ? undefined : 3);
                const visibleList = searchQuery ? list : list.slice(0, moversVisible);
                return (
                  <>
                    {visibleList.map((item, i) => (
                      <ItemRow key={`mover-${i}`} item={item} index={i} showChange getImageUrl={getImageUrl} isDarkMode={isDarkMode} styles={styles} />
                    ))}
                    {!searchQuery && isPro && moversVisible < filteredMovers.rising.length && (
                      <TouchableOpacity
                        style={styles.loadMoreBtn}
                        onPress={() => setMoversVisible(prev => prev + LIST_PAGE_SIZE)}
                      >
                        <Text style={styles.loadMoreText}>
                          {'\u{1F447}'} {t('analytics.show_more', { count: filteredMovers.rising.length - moversVisible })}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                );
              })()}
              {!isPro && !searchQuery && (analytics.topMovers || []).length > 3 && (
                <LockedOverlay message={t('analytics.see_all_movers')} onPress={handleShowOfferwall} styles={styles} />
              )}
              {searchQuery && filteredMovers.rising.length === 0 && (
                <Text style={styles.noSearchResults}>{t('analytics.no_rising_found')}</Text>
              )}
            </View>

            {/* Top Losers (Falling) */}
            <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.red }]}>
              <SectionHeader icon="arrow-trend-down" title={t('analytics.top_losers')} subtitle={t('analytics.falling_demand')} emoji={'\u{1F4C9}'} styles={styles} />
              {(() => {
                const list = isPro ? filteredMovers.falling : filteredMovers.falling.slice(0, searchQuery ? undefined : 3);
                const visibleList = searchQuery ? list : list.slice(0, moversVisible);
                return (
                  <>
                    {visibleList.map((item, i) => (
                      <ItemRow key={`loser-${i}`} item={item} index={i} showChange getImageUrl={getImageUrl} isDarkMode={isDarkMode} styles={styles} />
                    ))}
                    {!searchQuery && isPro && moversVisible < filteredMovers.falling.length && (
                      <TouchableOpacity
                        style={styles.loadMoreBtn}
                        onPress={() => setMoversVisible(prev => prev + LIST_PAGE_SIZE)}
                      >
                        <Text style={styles.loadMoreText}>
                          {'\u{1F447}'} {t('analytics.show_more', { count: filteredMovers.falling.length - moversVisible })}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                );
              })()}
              {!isPro && !searchQuery && (analytics.topLosers || []).length > 3 && (
                <LockedOverlay message={t('analytics.see_all_losers')} onPress={handleShowOfferwall} styles={styles} />
              )}
              {searchQuery && filteredMovers.falling.length === 0 && (
                <Text style={styles.noSearchResults}>{t('analytics.no_falling_found')}</Text>
              )}
            </View>
          </>
        )}

        {/* ═══════════════ DEMAND TAB ═══════════════ */}
        {activeTab === 'demand' && (
          <>
            {/* Most Wanted */}
            <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.pink }]}>
              <SectionHeader icon="heart" title={t('analytics.most_wanted')} subtitle={t('analytics.highest_demand')} emoji={'\u{2764}\u{FE0F}'} styles={styles} />
              {(() => {
                const list = isPro ? filteredDemand.wanted : filteredDemand.wanted.slice(0, searchQuery ? undefined : 5);
                const visibleList = searchQuery ? list : list.slice(0, demandVisible);
                return (
                  <>
                    {visibleList.map((item, i) => (
                      <ItemRow key={`wanted-${i}`} item={item} index={i} getImageUrl={getImageUrl} isDarkMode={isDarkMode} styles={styles} />
                    ))}
                    {!searchQuery && isPro && demandVisible < filteredDemand.wanted.length && (
                      <TouchableOpacity
                        style={styles.loadMoreBtn}
                        onPress={() => setDemandVisible(prev => prev + LIST_PAGE_SIZE)}
                      >
                        <Text style={styles.loadMoreText}>
                          {'\u{1F447}'} {t('analytics.show_more', { count: filteredDemand.wanted.length - demandVisible })}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                );
              })()}
              {!isPro && !searchQuery && (analytics.topWanted || []).length > 5 && (
                <LockedOverlay message={t('analytics.see_full_demand')} onPress={handleShowOfferwall} styles={styles} />
              )}
              {searchQuery && filteredDemand.wanted.length === 0 && (
                <Text style={styles.noSearchResults}>{t('analytics.no_wanted_found')}</Text>
              )}
            </View>

            {/* Most Offered */}
            <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.blue }]}>
              <SectionHeader icon="box-open" title={t('analytics.most_offered')} subtitle={t('analytics.highest_supply')} emoji={'\u{1F4E6}'} styles={styles} />
              {(() => {
                const list = isPro ? filteredDemand.offered : filteredDemand.offered.slice(0, searchQuery ? undefined : 5);
                const visibleList = searchQuery ? list : list.slice(0, demandVisible);
                return (
                  <>
                    {visibleList.map((item, i) => (
                      <ItemRow key={`offered-${i}`} item={item} index={i} getImageUrl={getImageUrl} isDarkMode={isDarkMode} styles={styles} />
                    ))}
                    {!searchQuery && isPro && demandVisible < filteredDemand.offered.length && (
                      <TouchableOpacity
                        style={styles.loadMoreBtn}
                        onPress={() => setDemandVisible(prev => prev + LIST_PAGE_SIZE)}
                      >
                        <Text style={styles.loadMoreText}>
                          {'\u{1F447}'} {t('analytics.show_more', { count: filteredDemand.offered.length - demandVisible })}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </>
                );
              })()}
              {!isPro && !searchQuery && (analytics.topOffered || []).length > 5 && (
                <LockedOverlay message={t('analytics.see_full_supply')} onPress={handleShowOfferwall} styles={styles} />
              )}
              {searchQuery && filteredDemand.offered.length === 0 && (
                <Text style={styles.noSearchResults}>{t('analytics.no_offered_found')}</Text>
              )}
            </View>

            {/* Demand/Supply Ratios */}
            {isPro ? (
              <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.purple }]}>
                <SectionHeader icon="scale-balanced" title={t('analytics.demand_vs_supply')} subtitle={t('analytics.ds_ratio_subtitle')} locked={false} emoji={'\u{2696}\u{FE0F}'} styles={styles} />
                {(() => {
                  const visibleList = searchQuery ? filteredDemand.ratios : filteredDemand.ratios.slice(0, demandVisible);
                  return (
                    <>
                      {visibleList.map((item, i) => (
                        <ItemRow key={`ds-${i}`} item={item} index={i} showSignal getImageUrl={getImageUrl} isDarkMode={isDarkMode} styles={styles} />
                      ))}
                      {!searchQuery && demandVisible < filteredDemand.ratios.length && (
                        <TouchableOpacity
                          style={styles.loadMoreBtn}
                          onPress={() => setDemandVisible(prev => prev + LIST_PAGE_SIZE)}
                        >
                          <Text style={styles.loadMoreText}>
                            {'\u{1F447}'} {t('analytics.show_more', { count: filteredDemand.ratios.length - demandVisible })}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </>
                  );
                })()}
                {searchQuery && filteredDemand.ratios.length === 0 && (
                  <Text style={styles.noSearchResults}>{t('analytics.no_ratios_found')}</Text>
                )}
              </View>
            ) : (
              <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: FUN_COLORS.purple }]}>
                <SectionHeader icon="scale-balanced" title={t('analytics.demand_vs_supply')} locked emoji={'\u{2696}\u{FE0F}'} styles={styles} />
                <View style={{ height: 120, justifyContent: 'center' }}>
                  <LockedOverlay message={t('analytics.unlock_ds')} onPress={handleShowOfferwall} styles={styles} />
                </View>
              </View>
            )}
          </>
        )}

        {/* ═══════════════ PREDICT TAB ═══════════════ */}
        {activeTab === 'predict' && (
          <>
            {/* Prediction Header */}
            <View style={[styles.card, { backgroundColor: isDarkMode ? '#1a1a2e' : '#F5F3FF', borderWidth: 1, borderColor: FUN_COLORS.purple + '30' }]}>
              <View style={styles.predictionHeader}>
                <Text style={{ fontSize: 32 }}>{'\u{1F52E}'}</Text>
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={[styles.sectionTitle, { color: FUN_COLORS.purple, fontSize: 18 }]}>{t('analytics.value_predictions')}</Text>
                  <Text style={styles.predictionSubtext}>
                    {t('analytics.predictions_based_on', { count: formatNumber((analytics.tradeVolume?.thisWeek || 0) * VM) })}
                  </Text>
                </View>
              </View>
            </View>

            {/* Predictions List */}
            {isPro ? (
              <View style={styles.card}>
                <SectionHeader icon="crystal-ball" title={t('analytics.predicted_movements')} subtitle={t('analytics.forecast_subtitle')} emoji={'\u{1F3B1}'} styles={styles} />
                {(() => {
                  const visibleList = searchQuery ? filteredPredictions : filteredPredictions.slice(0, predictVisible);
                  return (
                    <>
                      {visibleList.map((item, i) => (
                        <View key={`pred-${i}`} style={[styles.predictionRow, i % 2 === 0 && styles.itemRowAlt]}>
                          <View style={styles.predictionLeft}>
                            <View style={styles.itemImageWrap}>
                              {item.image ? (
                                <Image source={{ uri: getImageUrl(item.image) }} style={styles.itemImage} />
                              ) : (
                                <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                                  <Icon name="cube-outline" size={18} color={isDarkMode ? '#666' : '#bbb'} />
                                </View>
                              )}
                            </View>
                            <View style={styles.itemInfo}>
                              <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                              <Text style={styles.itemType}>
                                Wants: {(item.demand || 0) * VM} | Has: {(item.supply || 0) * VM}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.predictionRight}>
                            <View style={[styles.predictionBadge, { backgroundColor: getSignalColor(item.prediction) + '25' }]}>
                              <Text style={{ fontSize: 14 }}>{getPredictionEmoji(item.prediction)}</Text>
                              <Text style={[styles.predictionBadgeText, { color: getSignalColor(item.prediction) }]}>
                                {getPredictionLabel(item.prediction)}
                              </Text>
                            </View>
                            <View style={styles.confidenceBar}>
                              <View style={[styles.confidenceFill, {
                                width: `${item.confidence}%`,
                                backgroundColor: getSignalColor(item.prediction),
                              }]} />
                            </View>
                            <Text style={styles.confidenceText}>{t('analytics.confidence', { value: item.confidence })}</Text>
                          </View>
                        </View>
                      ))}
                      {!searchQuery && predictVisible < filteredPredictions.length && (
                        <TouchableOpacity
                          style={styles.loadMoreBtn}
                          onPress={() => setPredictVisible(prev => prev + LIST_PAGE_SIZE)}
                        >
                          <Text style={styles.loadMoreText}>
                            {'\u{1F447}'} {t('analytics.show_more', { count: filteredPredictions.length - predictVisible })}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </>
                  );
                })()}
                {searchQuery && filteredPredictions.length === 0 && (
                  <Text style={styles.noSearchResults}>{t('analytics.no_predictions_found')}</Text>
                )}
              </View>
            ) : (
              <>
                {/* Show 2 predictions free, lock the rest */}
                <View style={styles.card}>
                  <SectionHeader icon="bolt" title={t('analytics.predicted_movements')} subtitle={t('analytics.forecast_subtitle')} locked emoji={'\u{1F3B1}'} styles={styles} />
                  {(() => {
                    const freeList = searchQuery ? filteredPredictions.slice(0, 2) : (analytics.predictions || []).slice(0, 2);
                    return freeList.map((item, i) => (
                      <View key={`pred-free-${i}`} style={[styles.predictionRow, i % 2 === 0 && styles.itemRowAlt]}>
                        <View style={styles.predictionLeft}>
                          <View style={styles.itemImageWrap}>
                            {item.image ? (
                              <Image source={{ uri: getImageUrl(item.image) }} style={styles.itemImage} />
                            ) : (
                              <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                                <Icon name="cube-outline" size={18} color={isDarkMode ? '#666' : '#bbb'} />
                              </View>
                            )}
                          </View>
                          <View style={styles.itemInfo}>
                            <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                            <Text style={styles.itemType}>
                              Wants: {(item.demand || 0) * VM} | Has: {(item.supply || 0) * VM}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.predictionRight}>
                          <View style={[styles.predictionBadge, { backgroundColor: getSignalColor(item.prediction) + '25' }]}>
                            <Text style={{ fontSize: 14 }}>{getPredictionEmoji(item.prediction)}</Text>
                            <Text style={[styles.predictionBadgeText, { color: getSignalColor(item.prediction) }]}>
                              {getPredictionLabel(item.prediction)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    ));
                  })()}
                  <LockedOverlay message={t('analytics.unlock_predictions')} onPress={handleShowOfferwall} styles={styles} />
                </View>
              </>
            )}

            {/* Disclaimer */}
            <View style={styles.disclaimerCard}>
              <Text style={{ fontSize: 14 }}>{'\u{1F4A1}'}</Text>
              <Text style={styles.disclaimerText}>
                {t('analytics.predictions_disclaimer')}
              </Text>
            </View>
          </>
        )}

        {/* Last Updated */}
        {analytics.computedAt && (
          <View style={styles.updatedRow}>
            <Icon name="time-outline" size={12} color={isDarkMode ? '#666' : '#999'} />
            <Text style={styles.updatedText}>
              {t('analytics.updated', { date: new Date(analytics.computedAt).toLocaleString() })}
            </Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {!isPro && (
        <View style={{ paddingBottom: Platform.OS === 'android' ? 24 : 0 }}>
          <BannerAdComponent />
        </View>
      )}
      <SubscriptionScreen
        visible={showOfferwall}
        onClose={() => setShowOfferwall(false)}
        track='Analytics'
        showoffer={!single_offer_wall}
        oneWallOnly={single_offer_wall}
      />
    </View>
  );
};

const getStyles = (isDarkMode, c) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg,
    },
    centered: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    loadingText: {
      marginTop: 12,
      color: c.textSecondary,
      fontSize: 15,
      fontWeight: '600',
    },
    emptyTitle: {
      fontSize: 22,
      fontWeight: 'bold',
      color: c.text,
      marginTop: 12,
    },
    emptySubtitle: {
      fontSize: 15,
      color: c.textSecondary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 22,
    },
    retryButton: {
      marginTop: 20,
      paddingHorizontal: 28,
      paddingVertical: 12,
      backgroundColor: config.colors.primary,
      borderRadius: 24,
    },
    retryButtonText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 15,
    },

    // Tab Bar
    tabBarScroll: {
      flexGrow: 0,
      flexShrink: 0,
      backgroundColor: c.bgAlt,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    tabBar: {
      flexDirection: 'row',
      paddingHorizontal: 8,
      paddingVertical: 6,
      gap: 4,
      marginTop: 10
    },
    tab: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 4,
      paddingHorizontal: 12,
      borderRadius: 20,
      gap: 6,
    },
    tabActive: {
      backgroundColor: config.colors.primary + '20',
    },
    tabText: {
      fontSize: 13,
      fontWeight: '700',
      color: c.textMuted,
    },
    tabTextActive: {
      color: config.colors.primary,
    },

    scrollContent: {
      paddingHorizontal: 12,
      paddingTop: 12,
    },

    // Stats Row
    statsRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
    },
    statCard: {
      flex: 1,
      borderRadius: 16,
      padding: 14,
      alignItems: 'center',
      gap: 4,
      borderWidth: 1.5,
    },
    statEmoji: {
      fontSize: 22,
    },
    statNumber: {
      fontSize: 22,
      fontWeight: '900',
    },
    statLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: c.textSecondary,
    },

    // Card
    card: {
      backgroundColor: c.bgAlt,
      borderRadius: 16,
      padding: 14,
      marginBottom: 12,
      overflow: 'hidden',
    },

    // Section Header
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 12,
    },
    sectionHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: c.text,
    },
    sectionSubtitle: {
      fontSize: 12,
      color: c.textMuted,
      width: '100%',
      marginTop: 2,
      marginLeft: 30,
    },
    proBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: '#FFD70025',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 14,
    },
    proBadgeText: {
      fontSize: 11,
      fontWeight: 'bold',
      color: '#ffb700be',
    },

    // Item Row
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderRadius: 10,
    },
    itemRowAlt: {
      backgroundColor: c.cardBg,
    },
    itemRank: {
      width: 32,
      fontSize: 13,
      fontWeight: 'bold',
      color: c.textMuted,
      textAlign: 'center',
    },
    itemImageWrap: {
      marginRight: 10,
    },
    itemImage: {
      width: 38,
      height: 38,
      borderRadius: 10,
    },
    itemImagePlaceholder: {
      backgroundColor: c.bgAlt,
      justifyContent: 'center',
      alignItems: 'center',
    },
    itemInfo: {
      flex: 1,
    },
    itemName: {
      fontSize: 14,
      fontWeight: '700',
      color: c.text,
    },
    itemType: {
      fontSize: 11,
      color: c.textMuted,
      textTransform: 'capitalize',
    },
    countBadge: {
      backgroundColor: c.bgAlt,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
    },
    countText: {
      fontSize: 13,
      fontWeight: '800',
      color: c.textSecondary,
    },
    signalBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
    },
    signalText: {
      fontSize: 12,
      fontWeight: '800',
    },
    changeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
    },
    changeText: {
      fontSize: 12,
      fontWeight: '800',
    },

    // Distribution
    distributionRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginBottom: 14,
    },
    distributionItem: {
      alignItems: 'center',
      gap: 4,
    },
    distributionEmoji: {
      fontSize: 24,
    },
    distributionLabel: {
      fontSize: 13,
      fontWeight: '700',
    },
    distributionValue: {
      fontSize: 20,
      fontWeight: '900',
    },
    distributionBar: {
      flexDirection: 'row',
      height: 10,
      borderRadius: 5,
      overflow: 'hidden',
      backgroundColor: c.border,
    },
    distributionBarSegment: {
      height: '100%',
    },

    // Chart
    chartContainer: {
      marginTop: 4,
    },
    chartLabel: {
      fontSize: 12,
      color: c.textMuted,
      marginBottom: 8,
      fontWeight: '600',
    },
    chartBars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: 80,
      gap: 2,
    },
    chartBarWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    chartBar: {
      width: '85%',
      borderRadius: 4,
      minHeight: 4,
    },
    chartBarLabel: {
      fontSize: 9,
      color: c.textMuted,
      marginTop: 3,
      fontWeight: '600',
    },

    // Prediction
    predictionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    predictionSubtext: {
      fontSize: 12,
      color: c.textMuted,
      marginTop: 2,
    },
    predictionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderRadius: 10,
    },
    predictionLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    predictionRight: {
      alignItems: 'flex-end',
      minWidth: 120,
    },
    predictionBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 10,
    },
    predictionBadgeText: {
      fontSize: 11,
      fontWeight: '800',
    },
    confidenceBar: {
      width: 90,
      height: 5,
      backgroundColor: c.border,
      borderRadius: 3,
      marginTop: 5,
      overflow: 'hidden',
    },
    confidenceFill: {
      height: '100%',
      borderRadius: 3,
    },
    confidenceText: {
      fontSize: 10,
      color: c.textMuted,
      marginTop: 3,
      fontWeight: '600',
    },

    // Locked Overlay
    lockedOverlay: {
      backgroundColor: isDarkMode ? 'rgba(15,15,26,0.85)' : 'rgba(240,244,255,0.92)',
      borderRadius: 14,
      padding: 20,
      marginTop: 8,
      alignItems: 'center',
    },
    lockedContent: {
      alignItems: 'center',
      gap: 10,
    },
    lockedText: {
      fontSize: 14,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
    },
    unlockButton: {
      backgroundColor: config.colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 10,
      borderRadius: 24,
    },
    unlockButtonText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 14,
    },

    // Disclaimer
    disclaimerCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      padding: 14,
      backgroundColor: isDarkMode ? '#1a1a2e' : '#FFF8E1',
      borderRadius: 12,
      marginBottom: 12,
    },
    disclaimerText: {
      flex: 1,
      fontSize: 12,
      color: isDarkMode ? '#999' : '#8B6914',
      lineHeight: 18,
    },

    // Value Changes Tab
    changesFilterRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 12,
    },
    changesFilterBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      borderRadius: 14,
      backgroundColor: c.bgAlt,
      borderWidth: 1.5,
      borderColor: c.border,
    },
    changesFilterBtnActive: {
      backgroundColor: config.colors.primary,
      borderColor: config.colors.primary,
    },
    changesFilterText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textSecondary,
    },
    changesFilterTextActive: {
      color: '#fff',
    },
    changeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderRadius: 10,
    },
    changeLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    changeInfo: {
      flex: 1,
    },
    changeDateText: {
      fontSize: 10,
      color: c.textMuted,
      marginTop: 1,
    },
    changeRight: {
      alignItems: 'flex-end',
      minWidth: 105,
    },
    changeValuesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    changeOldValue: {
      fontSize: 12,
      color: c.textMuted,
      textDecorationLine: 'line-through',
    },
    changeNewValue: {
      fontSize: 14,
      fontWeight: '800',
    },
    changePctBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
      marginTop: 4,
    },
    changePctText: {
      fontSize: 11,
      fontWeight: '800',
    },
    changeValueType: {
      fontSize: 9,
      color: c.textMuted,
      marginTop: 2,
      fontWeight: 'bold',
    },

    // Sub-values grid (multi-value types)
    subValuesGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    subValueItem: {
      backgroundColor: isDarkMode ? '#15152a' : '#f5f5ff',
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 6,
      minWidth: 72,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    subValueItemPrimary: {
      borderColor: config.colors.primary + '50',
      backgroundColor: isDarkMode ? '#1a2540' : '#EBF5FF',
    },
    subValueLabel: {
      fontSize: 10,
      fontWeight: 'bold',
      color: c.textSecondary,
      marginBottom: 2,
    },
    subValueOld: {
      fontSize: 10,
      color: c.textMuted,
      textDecorationLine: 'line-through',
    },
    subValueNew: {
      fontSize: 11,
      fontWeight: '800',
    },
    subValuePct: {
      fontSize: 9,
      fontWeight: '800',
      marginTop: 2,
    },

    // Search Bar
    searchBarWrap: {
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 4,
      backgroundColor: c.bg,
    },
    searchInputWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.bgAlt,
      borderRadius: 14,
      borderWidth: 1.5,
      borderColor: c.border,
      overflow: 'hidden',
    },
    searchInput: {
      flex: 1,
      paddingVertical: Platform.OS === 'ios' ? 10 : 8,
      paddingHorizontal: 10,
      fontSize: 14,
      color: c.text,
      fontWeight: '600',
    },
    searchClearBtn: {
      padding: 8,
    },
    searchBtn: {
      backgroundColor: config.colors.primary,
      paddingHorizontal: 14,
      paddingVertical: 10,
      justifyContent: 'center',
      alignItems: 'center',
    },
    searchActiveRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 6,
      paddingHorizontal: 4,
    },
    searchActiveText: {
      fontSize: 12,
      color: c.textMuted,
      fontWeight: '600',
    },
    searchCancelText: {
      fontSize: 12,
      color: FUN_COLORS.red,
      fontWeight: '700',
    },
    noSearchResults: {
      textAlign: 'center',
      color: c.textMuted,
      fontSize: 13,
      paddingVertical: 16,
      fontWeight: '600',
    },

    // Load More
    loadMoreBtn: {
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#1a1a2e' : '#F0F0FF',
      borderRadius: 12,
      marginTop: 8,
    },
    loadMoreText: {
      color: FUN_COLORS.purple,
      fontWeight: '700',
      fontSize: 14,
    },

    // Updated Row
    updatedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 10,
    },
    updatedText: {
      fontSize: 11,
      color: c.textMuted,
    },
  });
};

export default AnalyticsScreen;
