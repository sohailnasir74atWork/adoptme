import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, RefreshControl, Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import { MMKV } from 'react-native-mmkv';
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


const analyticsCache = new MMKV({ id: 'analytics-cache' });

// Cache durations
const ANALYTICS_CACHE_MS = 1000; // 3 hours
const CHANGES_CACHE_MS = 1000;   // 1 hour

// CDN URLs — you push data here after cloud function runs
const ANALYTICS_CDN_URL = 'https://analytics.b-cdn.net';
const VALUE_CHANGES_CDN_URL = 'https://check-diff-adoptme.b-cdn.net/diff.json';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Visual multiplier — cosmetic boost for displayed counts only
// Does NOT affect ratios, percentages, confidence, or prediction logic
const VM = 2;

const AnalyticsScreen = ({ navigation }) => {
  const { theme, single_offer_wall } = useGlobalState();
  const { localState } = useLocalState();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';
  const isPro = localState.isPro;

  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [showOfferwall, setShowOfferwall] = useState(false);
  const [valueChanges, setValueChanges] = useState(null);
  const [valueChangesLoading, setValueChangesLoading] = useState(false);
  const [changesFilter, setChangesFilter] = useState('all'); // 'all', 'increased', 'decreased'

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
    fetchValueChanges();
  }, [fetchAnalytics, fetchValueChanges]);

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

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
      case 'rising':
      case 'strong_rise':
      case 'likely_rise':
        return '#10B981';
      case 'falling':
      case 'strong_fall':
      case 'likely_fall':
        return '#EF4444';
      default:
        return '#F59E0B';
    }
  };

  const getSignalIcon = (signal) => {
    switch (signal) {
      case 'rising':
      case 'strong_rise':
      case 'likely_rise':
        return 'trending-up';
      case 'falling':
      case 'strong_fall':
      case 'likely_fall':
        return 'trending-down';
      default:
        return 'remove-outline';
    }
  };

  const getPredictionLabel = (prediction) => {
    switch (prediction) {
      case 'strong_rise': return 'Strong Rise';
      case 'likely_rise': return 'Likely Rise';
      case 'stable': return 'Stable';
      case 'likely_fall': return 'Likely Fall';
      case 'strong_fall': return 'Strong Fall';
      default: return 'Unknown';
    }
  };

  // ── Locked Feature Overlay ──
  const LockedOverlay = ({ message }) => (
    <TouchableOpacity
      style={styles.lockedOverlay}
      activeOpacity={0.9}
      onPress={() => setShowOfferwall(true)}
    >
      <View style={styles.lockedContent}>
        <FontAwesome name="lock" size={20} color="#FFD700" solid />
        <Text style={styles.lockedText}>{message || 'Unlock with Pro'}</Text>
        <View style={styles.unlockButton}>
          <Text style={styles.unlockButtonText}>Upgrade</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  // ── Item Row Component ──
  const ItemRow = ({ item, index, showSignal, showChange, locked }) => (
    <View style={[styles.itemRow, index % 2 === 0 && styles.itemRowAlt]}>
      <Text style={styles.itemRank}>#{index + 1}</Text>
      <View style={styles.itemImageWrap}>
        {item.image ? (
          <Image source={{ uri: getImageUrl(item.image) }} style={styles.itemImage} />
        ) : (
          <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
            <Icon name="cube-outline" size={16} color={isDarkMode ? '#666' : '#999'} />
          </View>
        )}
      </View>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={1}>{locked ? '???' : item.name}</Text>
        <Text style={styles.itemType}>{item.type}</Text>
      </View>
      {showSignal && item.signal && (
        <View style={[styles.signalBadge, { backgroundColor: getSignalColor(item.signal) + '20' }]}>
          <Icon name={getSignalIcon(item.signal)} size={14} color={getSignalColor(item.signal)} />
          <Text style={[styles.signalText, { color: getSignalColor(item.signal) }]}>
            {item.ratio?.toFixed(1)}x
          </Text>
        </View>
      )}
      {showChange && item.changePercent !== undefined && (
        <View style={[styles.changeBadge, {
          backgroundColor: item.changePercent > 0 ? '#10B98120' : '#EF444420'
        }]}>
          <Icon
            name={item.changePercent > 0 ? 'arrow-up' : 'arrow-down'}
            size={12}
            color={item.changePercent > 0 ? '#10B981' : '#EF4444'}
          />
          <Text style={[styles.changeText, {
            color: item.changePercent > 0 ? '#10B981' : '#EF4444'
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

  // ── Mini Bar Chart ──
  const MiniBarChart = ({ data, label }) => {
    const maxVal = Math.max(...data, 1);
    return (
      <View style={styles.chartContainer}>
        <Text style={styles.chartLabel}>{label}</Text>
        <View style={styles.chartBars}>
          {data.map((val, i) => (
            <View key={i} style={styles.chartBarWrap}>
              <View
                style={[
                  styles.chartBar,
                  {
                    height: Math.max(2, (val / maxVal) * 60),
                    backgroundColor: i === analytics?.peakHour ? config.colors.primary : (isDarkMode ? '#555' : '#ddd'),
                  },
                ]}
              />
              {i % 6 === 0 && (
                <Text style={styles.chartBarLabel}>{i}h</Text>
              )}
            </View>
          ))}
        </View>
      </View>
    );
  };

  // ── Section Header ──
  const SectionHeader = ({ icon, title, subtitle, locked }) => (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        <FontAwesome name={icon} size={16} color={config.colors.primary} solid />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {locked && (
        <View style={styles.proBadge}>
          <FontAwesome name="crown" size={10} color="#FFD700" solid />
          <Text style={styles.proBadgeText}>PRO</Text>
        </View>
      )}
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
  );

  const getTimeAgo = useCallback((dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  }, []);

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

  const filteredChanges = useMemo(() => {
    if (!valueChanges?.changes) return [];
    if (changesFilter === 'all') return valueChanges.changes;
    if (changesFilter === 'increased') return valueChanges.changes.filter(c => getChangeDirection(c) === 'up');
    if (changesFilter === 'decreased') return valueChanges.changes.filter(c => getChangeDirection(c) === 'down');
    return valueChanges.changes;
  }, [valueChanges, changesFilter, getChangeDirection]);

  // ── Tab Bar ──
  const tabs = [
    { key: 'overview', label: 'Overview', icon: 'chart-pie' },
    { key: 'changes', label: 'Changes', icon: 'rotate' },
    { key: 'movers', label: 'Movers', icon: 'arrow-trend-up' },
    { key: 'demand', label: 'Demand', icon: 'fire' },
    { key: 'predict', label: 'Predict', icon: 'wand-magic-sparkles' },
  ];

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={config.colors.primary} />
        <Text style={styles.loadingText}>Loading analytics...</Text>
      </View>
    );
  }

  if (!analytics) {
    return (
      <View style={[styles.container, styles.centered]}>
        <FontAwesome name="chart-line" size={48} color={isDarkMode ? '#555' : '#ccc'} />
        <Text style={styles.emptyTitle}>No Analytics Yet</Text>
        <Text style={styles.emptySubtitle}>Analytics will be available once enough trades are created.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => fetchAnalytics()}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <FontAwesome
              name={tab.icon}
              size={14}
              color={activeTab === tab.key ? config.colors.primary : (isDarkMode ? '#888' : '#999')}
              solid
            />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { fetchAnalytics(true); fetchValueChanges(true); }} tintColor={config.colors.primary} />
        }
      >
        {/* ═══════════════ OVERVIEW TAB ═══════════════ */}
        {activeTab === 'overview' && (
          <>
            {/* Trade Volume Cards */}
            <View style={styles.statsRow}>
              <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#1a2332' : '#EFF6FF' }]}>
                <FontAwesome name="handshake" size={18} color="#3B82F6" solid />
                <Text style={styles.statNumber}>{formatNumber((analytics.tradeVolume?.today || 0) * VM)}</Text>
                <Text style={styles.statLabel}>Today</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#1a2a1a' : '#F0FDF4' }]}>
                <FontAwesome name="clock-rotate-left" size={18} color="#10B981" solid />
                <Text style={styles.statNumber}>{formatNumber((analytics.tradeVolume?.last24h || 0) * VM)}</Text>
                <Text style={styles.statLabel}>24 Hours</Text>
              </View>
              <View style={[styles.statCard, { backgroundColor: isDarkMode ? '#2a1a2a' : '#FDF2F8' }]}>
                <FontAwesome name="calendar-week" size={18} color="#EC4899" solid />
                <Text style={styles.statNumber}>{formatNumber((analytics.tradeVolume?.thisWeek || 0) * VM)}</Text>
                <Text style={styles.statLabel}>This Week</Text>
              </View>
            </View>

            {/* Win/Lose/Fair Distribution */}
            {analytics.statusDistribution && (
              <View style={styles.card}>
                <SectionHeader icon="chart-pie" title="Trade Outcomes (24h)" />
                <View style={styles.distributionRow}>
                  <View style={styles.distributionItem}>
                    <View style={[styles.distributionDot, { backgroundColor: '#10B981' }]} />
                    <Text style={styles.distributionLabel}>Win</Text>
                    <Text style={styles.distributionValue}>{(analytics.statusDistribution.win || 0) * VM}</Text>
                  </View>
                  <View style={styles.distributionItem}>
                    <View style={[styles.distributionDot, { backgroundColor: '#F59E0B' }]} />
                    <Text style={styles.distributionLabel}>Fair</Text>
                    <Text style={styles.distributionValue}>{(analytics.statusDistribution.fair || 0) * VM}</Text>
                  </View>
                  <View style={styles.distributionItem}>
                    <View style={[styles.distributionDot, { backgroundColor: '#EF4444' }]} />
                    <Text style={styles.distributionLabel}>Lose</Text>
                    <Text style={styles.distributionValue}>{(analytics.statusDistribution.lose || 0) * VM}</Text>
                  </View>
                </View>
                {/* Simple bar visualization */}
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
                        <View style={[styles.distributionBarSegment, { width: `${winPct}%`, backgroundColor: '#10B981' }]} />
                        <View style={[styles.distributionBarSegment, { width: `${fairPct}%`, backgroundColor: '#F59E0B' }]} />
                        <View style={[styles.distributionBarSegment, { width: `${losePct}%`, backgroundColor: '#EF4444' }]} />
                      </>
                    );
                  })()}
                </View>
              </View>
            )}

            {/* Hourly Activity */}
            {analytics.hourlyActivity && (
              <View style={styles.card}>
                <SectionHeader icon="chart-bar" title="Hourly Activity" subtitle={`Peak: ${analytics.peakHour}:00`} />
                <MiniBarChart data={analytics.hourlyActivity} label="Trades per hour (24h)" />
              </View>
            )}

            {/* Top 5 Most Traded (Free) */}
            <View style={styles.card}>
              <SectionHeader icon="fire" title="Most Traded (24h)" />
              {(analytics.topTraded || []).slice(0, 5).map((item, i) => (
                <ItemRow key={`traded-${i}`} item={item} index={i} />
              ))}
            </View>
          </>
        )}

        {/* ═══════════════ VALUE CHANGES TAB ═══════════════ */}
        {activeTab === 'changes' && (
          <>
            {/* Header Card */}
            <View style={[styles.card, { backgroundColor: isDarkMode ? '#1a2a1a' : '#F0FDF4' }]}>
              <View style={styles.predictionHeader}>
                <FontAwesome name="rotate" size={22} color="#10B981" solid />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={[styles.sectionTitle, { color: '#10B981' }]}>Official Value Changes</Text>
                  <Text style={styles.predictionSubtext}>
                    Manually verified value updates{valueChanges?.lastUpdated ? ` • ${getTimeAgo(valueChanges.lastUpdated)}` : ''}
                  </Text>
                </View>
              </View>
            </View>

            {/* Filter Buttons */}
            <View style={styles.changesFilterRow}>
              {[
                { key: 'all', label: 'All', icon: 'list' },
                { key: 'increased', label: 'Up', icon: 'arrow-up' },
                { key: 'decreased', label: 'Down', icon: 'arrow-down' },
              ].map(f => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.changesFilterBtn, changesFilter === f.key && styles.changesFilterBtnActive]}
                  onPress={() => setChangesFilter(f.key)}
                >
                  <Icon
                    name={f.icon}
                    size={14}
                    color={changesFilter === f.key ? '#fff' : (isDarkMode ? '#aaa' : '#666')}
                  />
                  <Text style={[
                    styles.changesFilterText,
                    changesFilter === f.key && styles.changesFilterTextActive,
                  ]}>
                    {f.label}
                    {f.key === 'all' && valueChanges?.changes ? ` (${valueChanges.changes.length})` : ''}
                    {f.key === 'increased' && valueChanges?.changes ? ` (${valueChanges.changes.filter(c => getChangeDirection(c) === 'up').length})` : ''}
                    {f.key === 'decreased' && valueChanges?.changes ? ` (${valueChanges.changes.filter(c => getChangeDirection(c) === 'down').length})` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {valueChangesLoading ? (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 30 }]}>
                <ActivityIndicator size="small" color={config.colors.primary} />
                <Text style={styles.loadingText}>Loading value changes...</Text>
              </View>
            ) : !valueChanges || filteredChanges.length === 0 ? (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 30 }]}>
                <FontAwesome name="rotate" size={32} color={isDarkMode ? '#444' : '#ddd'} />
                <Text style={[styles.emptySubtitle, { marginTop: 12 }]}>
                  {!valueChanges ? 'No value changes data available yet.' : 'No items match this filter.'}
                </Text>
              </View>
            ) : (
              <View style={styles.card}>
                <SectionHeader
                  icon="rotate"
                  title={`Value Updates`}
                  subtitle={valueChanges.note || `${filteredChanges.length} items changed`}
                />
                {filteredChanges.map((item, i) => {
                  const primary = getPrimaryChange(item);
                  const isUp = primary.pct > 0;
                  const isZero = primary.pct === 0;
                  const hasMultiValues = item.values && Object.keys(item.values).length > 0;

                  // Value type labels for display
                  const valueTypeLabels = {
                    d_nopotion: 'D', d_fly: 'D-F', d_ride: 'D-R', d_flyride: 'D-FR',
                    n_nopotion: 'N', n_fly: 'N-F', n_ride: 'N-R', n_flyride: 'N-FR',
                    m_nopotion: 'M', m_fly: 'M-F', m_ride: 'M-R', m_flyride: 'M-FR',
                  };

                  return (
                    <View key={`change-${i}`} style={[styles.changeRow, i % 2 === 0 && styles.itemRowAlt, { flexDirection: 'column', alignItems: 'stretch' }]}>
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
                            <Icon name="arrow-forward" size={10} color={isDarkMode ? '#555' : '#bbb'} />
                            <Text style={[styles.changeNewValue, { color: isUp ? '#10B981' : isZero ? (isDarkMode ? '#aaa' : '#666') : '#EF4444' }]}>
                              {formatNumber(primary.newVal)}
                            </Text>
                          </View>
                          <View style={[styles.changePctBadge, {
                            backgroundColor: isUp ? '#10B98120' : isZero ? (isDarkMode ? '#33333340' : '#eee') : '#EF444420',
                          }]}>
                            {!isZero && (
                              <Icon name={isUp ? 'arrow-up' : 'arrow-down'} size={10} color={isUp ? '#10B981' : '#EF4444'} />
                            )}
                            <Text style={[styles.changePctText, {
                              color: isUp ? '#10B981' : isZero ? (isDarkMode ? '#888' : '#999') : '#EF4444',
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
                            const label = valueTypeLabels[vKey] || vKey;
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
                                  <Text style={[styles.subValueNew, { color: vUp ? '#10B981' : vSame ? (isDarkMode ? '#888' : '#999') : '#EF4444' }]}>
                                    {formatNumber(v.newVal)}
                                  </Text>
                                </View>
                                <Text style={[styles.subValuePct, { color: vUp ? '#10B981' : vSame ? (isDarkMode ? '#666' : '#bbb') : '#EF4444' }]}>
                                  {vSame ? '0%' : `${vUp ? '+' : ''}${vPct}%`}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            )}

            {/* Info about data source */}
            <View style={styles.disclaimerCard}>
              <Icon name="shield-checkmark-outline" size={16} color={isDarkMode ? '#888' : '#999'} />
              <Text style={styles.disclaimerText}>
                Value changes are manually verified by comparing official value updates. Updated by admin when new values are released.
              </Text>
            </View>
          </>
        )}

        {/* ═══════════════ MOVERS TAB ═══════════════ */}
        {activeTab === 'movers' && (
          <>
            {/* Top Movers (Rising) */}
            <View style={styles.card}>
              <SectionHeader icon="arrow-trend-up" title="Top Movers" subtitle="Rising demand this week" />
              {(analytics.topMovers || []).slice(0, isPro ? 10 : 3).map((item, i) => (
                <ItemRow key={`mover-${i}`} item={item} index={i} showChange />
              ))}
              {!isPro && (analytics.topMovers || []).length > 3 && (
                <LockedOverlay message="See all 10 top movers" />
              )}
            </View>

            {/* Top Losers (Falling) */}
            <View style={styles.card}>
              <SectionHeader icon="arrow-trend-down" title="Top Losers" subtitle="Falling demand this week" />
              {(analytics.topLosers || []).slice(0, isPro ? 10 : 3).map((item, i) => (
                <ItemRow key={`loser-${i}`} item={item} index={i} showChange />
              ))}
              {!isPro && (analytics.topLosers || []).length > 3 && (
                <LockedOverlay message="See all 10 top losers" />
              )}
            </View>
          </>
        )}

        {/* ═══════════════ DEMAND TAB ═══════════════ */}
        {activeTab === 'demand' && (
          <>
            {/* Most Wanted */}
            <View style={styles.card}>
              <SectionHeader icon="heart" title="Most Wanted" subtitle="Highest demand (24h)" />
              {(analytics.topWanted || []).slice(0, isPro ? 15 : 5).map((item, i) => (
                <ItemRow key={`wanted-${i}`} item={item} index={i} />
              ))}
              {!isPro && (analytics.topWanted || []).length > 5 && (
                <LockedOverlay message="See full demand list" />
              )}
            </View>

            {/* Most Offered */}
            <View style={styles.card}>
              <SectionHeader icon="box-open" title="Most Offered" subtitle="Highest supply (24h)" />
              {(analytics.topOffered || []).slice(0, isPro ? 15 : 5).map((item, i) => (
                <ItemRow key={`offered-${i}`} item={item} index={i} />
              ))}
              {!isPro && (analytics.topOffered || []).length > 5 && (
                <LockedOverlay message="See full supply list" />
              )}
            </View>

            {/* Demand/Supply Ratios */}
            {isPro ? (
              <View style={styles.card}>
                <SectionHeader icon="scale-balanced" title="Demand vs Supply" subtitle="D/S ratio (higher = more wanted)" locked={false} />
                {(analytics.demandSupplyRatios || []).slice(0, 15).map((item, i) => (
                  <ItemRow key={`ds-${i}`} item={item} index={i} showSignal />
                ))}
              </View>
            ) : (
              <View style={styles.card}>
                <SectionHeader icon="scale-balanced" title="Demand vs Supply" locked />
                <View style={{ height: 120, justifyContent: 'center' }}>
                  <LockedOverlay message="Unlock demand/supply analysis" />
                </View>
              </View>
            )}
          </>
        )}

        {/* ═══════════════ PREDICT TAB ═══════════════ */}
        {activeTab === 'predict' && (
          <>
            {/* Prediction Header */}
            <View style={[styles.card, { backgroundColor: isDarkMode ? '#1a1a2e' : '#F5F3FF' }]}>
              <View style={styles.predictionHeader}>
                <FontAwesome name="wand-magic-sparkles" size={24} color="#8B5CF6" solid />
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={[styles.sectionTitle, { color: '#8B5CF6' }]}>Value Predictions</Text>
                  <Text style={styles.predictionSubtext}>
                    Based on demand/supply trends from {formatNumber((analytics.tradeVolume?.thisWeek || 0) * VM)} trades this week
                  </Text>
                </View>
              </View>
            </View>

            {/* Predictions List */}
            {isPro ? (
              <View style={styles.card}>
                <SectionHeader icon="crystal-ball" title="Predicted Movements" subtitle="Next 24-48h forecast" />
                {(analytics.predictions || []).map((item, i) => (
                  <View key={`pred-${i}`} style={[styles.predictionRow, i % 2 === 0 && styles.itemRowAlt]}>
                    <View style={styles.predictionLeft}>
                      <View style={styles.itemImageWrap}>
                        {item.image ? (
                          <Image source={{ uri: getImageUrl(item.image) }} style={styles.itemImage} />
                        ) : (
                          <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                            <Icon name="cube-outline" size={16} color={isDarkMode ? '#666' : '#999'} />
                          </View>
                        )}
                      </View>
                      <View style={styles.itemInfo}>
                        <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.itemType}>
                          D:{(item.demand || 0) * VM} S:{(item.supply || 0) * VM} | Ratio: {item.ratio}x
                        </Text>
                      </View>
                    </View>
                    <View style={styles.predictionRight}>
                      <View style={[styles.predictionBadge, { backgroundColor: getSignalColor(item.prediction) + '20' }]}>
                        <Icon name={getSignalIcon(item.prediction)} size={14} color={getSignalColor(item.prediction)} />
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
                      <Text style={styles.confidenceText}>{item.confidence}% confidence</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <>
                {/* Show 2 predictions free, lock the rest */}
                <View style={styles.card}>
                  <SectionHeader icon="bolt" title="Predicted Movements" subtitle="Next 24-48h forecast" locked />
                  {(analytics.predictions || []).slice(0, 2).map((item, i) => (
                    <View key={`pred-free-${i}`} style={[styles.predictionRow, i % 2 === 0 && styles.itemRowAlt]}>
                      <View style={styles.predictionLeft}>
                        <View style={styles.itemImageWrap}>
                          {item.image ? (
                            <Image source={{ uri: getImageUrl(item.image) }} style={styles.itemImage} />
                          ) : (
                            <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                              <Icon name="cube-outline" size={16} color={isDarkMode ? '#666' : '#999'} />
                            </View>
                          )}
                        </View>
                        <View style={styles.itemInfo}>
                          <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                          <Text style={styles.itemType}>
                            D:{(item.demand || 0) * VM} S:{(item.supply || 0) * VM}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.predictionRight}>
                        <View style={[styles.predictionBadge, { backgroundColor: getSignalColor(item.prediction) + '20' }]}>
                          <Icon name={getSignalIcon(item.prediction)} size={14} color={getSignalColor(item.prediction)} />
                          <Text style={[styles.predictionBadgeText, { color: getSignalColor(item.prediction) }]}>
                            {getPredictionLabel(item.prediction)}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ))}
                  <LockedOverlay message="Unlock all predictions & confidence scores" />
                </View>
              </>
            )}

            {/* Disclaimer */}
            <View style={styles.disclaimerCard}>
              <Icon name="information-circle-outline" size={16} color={isDarkMode ? '#888' : '#999'} />
              <Text style={styles.disclaimerText}>
                Predictions are based on trade activity patterns and demand/supply ratios. They are not financial advice and actual values may vary.
              </Text>
            </View>
          </>
        )}

        {/* Last Updated */}
        {analytics.computedAt && (
          <View style={styles.updatedRow}>
            <Icon name="time-outline" size={12} color={isDarkMode ? '#666' : '#999'} />
            <Text style={styles.updatedText}>
              Updated: {new Date(analytics.computedAt).toLocaleString()}
            </Text>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {!isPro && <BannerAdComponent />}
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

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#121212' : '#F5F5F5',
    },
    centered: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
    },
    loadingText: {
      marginTop: 12,
      color: isDarkMode ? '#aaa' : '#666',
      fontSize: 14,
    },
    emptyTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#333',
      marginTop: 16,
    },
    emptySubtitle: {
      fontSize: 14,
      color: isDarkMode ? '#888' : '#666',
      textAlign: 'center',
      marginTop: 8,
    },
    retryButton: {
      marginTop: 20,
      paddingHorizontal: 24,
      paddingVertical: 10,
      backgroundColor: config.colors.primary,
      borderRadius: 8,
    },
    retryButtonText: {
      color: '#fff',
      fontWeight: 'bold',
    },

    // Tab Bar
    tabBar: {
      flexDirection: 'row',
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: isDarkMode ? '#1a1a1a' : '#fff',
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#333' : '#eee',
    },
    tab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      borderRadius: 8,
      gap: 4,
    },
    tabActive: {
      backgroundColor: config.colors.primary + '15',
    },
    tabText: {
      fontSize: 11,
      fontWeight: '600',
      color: isDarkMode ? '#888' : '#999',
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
      borderRadius: 12,
      padding: 12,
      alignItems: 'center',
      gap: 6,
    },
    statNumber: {
      fontSize: 20,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#111',
    },
    statLabel: {
      fontSize: 11,
      color: isDarkMode ? '#aaa' : '#666',
    },

    // Card
    card: {
      backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
      overflow: 'hidden',
    },

    // Section Header
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginBottom: 10,
    },
    sectionHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    sectionTitle: {
      fontSize: 15,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#111',
    },
    sectionSubtitle: {
      fontSize: 11,
      color: isDarkMode ? '#888' : '#999',
      width: '100%',
      marginTop: 2,
      marginLeft: 24,
    },
    proBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: '#FFD70020',
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
    },
    proBadgeText: {
      fontSize: 10,
      fontWeight: 'bold',
      color: '#FFD700',
    },

    // Item Row
    itemRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
      paddingHorizontal: 4,
      borderRadius: 6,
    },
    itemRowAlt: {
      backgroundColor: isDarkMode ? '#252525' : '#F9FAFB',
    },
    itemRank: {
      width: 28,
      fontSize: 12,
      fontWeight: 'bold',
      color: isDarkMode ? '#888' : '#999',
    },
    itemImageWrap: {
      marginRight: 8,
    },
    itemImage: {
      width: 32,
      height: 32,
      borderRadius: 6,
    },
    itemImagePlaceholder: {
      backgroundColor: isDarkMode ? '#333' : '#eee',
      justifyContent: 'center',
      alignItems: 'center',
    },
    itemInfo: {
      flex: 1,
    },
    itemName: {
      fontSize: 13,
      fontWeight: '600',
      color: isDarkMode ? '#fff' : '#111',
    },
    itemType: {
      fontSize: 10,
      color: isDarkMode ? '#888' : '#999',
      textTransform: 'capitalize',
    },
    countBadge: {
      backgroundColor: isDarkMode ? '#333' : '#F3F4F6',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    countText: {
      fontSize: 12,
      fontWeight: 'bold',
      color: isDarkMode ? '#aaa' : '#666',
    },
    signalBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    signalText: {
      fontSize: 11,
      fontWeight: 'bold',
    },
    changeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    changeText: {
      fontSize: 11,
      fontWeight: 'bold',
    },

    // Distribution
    distributionRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginBottom: 10,
    },
    distributionItem: {
      alignItems: 'center',
      gap: 4,
    },
    distributionDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    distributionLabel: {
      fontSize: 11,
      color: isDarkMode ? '#aaa' : '#666',
    },
    distributionValue: {
      fontSize: 16,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#111',
    },
    distributionBar: {
      flexDirection: 'row',
      height: 6,
      borderRadius: 3,
      overflow: 'hidden',
      backgroundColor: isDarkMode ? '#333' : '#eee',
    },
    distributionBarSegment: {
      height: '100%',
    },

    // Chart
    chartContainer: {
      marginTop: 4,
    },
    chartLabel: {
      fontSize: 11,
      color: isDarkMode ? '#888' : '#999',
      marginBottom: 8,
    },
    chartBars: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      height: 70,
      gap: 2,
    },
    chartBarWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    chartBar: {
      width: '80%',
      borderRadius: 2,
      minHeight: 2,
    },
    chartBarLabel: {
      fontSize: 8,
      color: isDarkMode ? '#666' : '#999',
      marginTop: 2,
    },

    // Prediction
    predictionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    predictionSubtext: {
      fontSize: 11,
      color: isDarkMode ? '#888' : '#999',
      marginTop: 2,
    },
    predictionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderRadius: 6,
    },
    predictionLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    predictionRight: {
      alignItems: 'flex-end',
      minWidth: 110,
    },
    predictionBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 6,
    },
    predictionBadgeText: {
      fontSize: 10,
      fontWeight: 'bold',
    },
    confidenceBar: {
      width: 80,
      height: 3,
      backgroundColor: isDarkMode ? '#333' : '#eee',
      borderRadius: 2,
      marginTop: 4,
      overflow: 'hidden',
    },
    confidenceFill: {
      height: '100%',
      borderRadius: 2,
    },
    confidenceText: {
      fontSize: 9,
      color: isDarkMode ? '#666' : '#999',
      marginTop: 2,
    },

    // Locked Overlay
    lockedOverlay: {
      backgroundColor: isDarkMode ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)',
      borderRadius: 8,
      padding: 16,
      marginTop: 8,
      alignItems: 'center',
    },
    lockedContent: {
      alignItems: 'center',
      gap: 8,
    },
    lockedText: {
      fontSize: 13,
      fontWeight: '600',
      color: isDarkMode ? '#ddd' : '#333',
    },
    unlockButton: {
      backgroundColor: config.colors.primary,
      paddingHorizontal: 20,
      paddingVertical: 8,
      borderRadius: 20,
    },
    unlockButtonText: {
      color: '#fff',
      fontWeight: 'bold',
      fontSize: 12,
    },

    // Disclaimer
    disclaimerCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      padding: 12,
      backgroundColor: isDarkMode ? '#1a1a1a' : '#FFFBEB',
      borderRadius: 8,
      marginBottom: 12,
    },
    disclaimerText: {
      flex: 1,
      fontSize: 11,
      color: isDarkMode ? '#888' : '#92400E',
      lineHeight: 16,
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
      gap: 4,
      paddingVertical: 8,
      borderRadius: 8,
      backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
      borderWidth: 1,
      borderColor: isDarkMode ? '#333' : '#eee',
    },
    changesFilterBtnActive: {
      backgroundColor: config.colors.primary,
      borderColor: config.colors.primary,
    },
    changesFilterText: {
      fontSize: 11,
      fontWeight: '600',
      color: isDarkMode ? '#aaa' : '#666',
    },
    changesFilterTextActive: {
      color: '#fff',
    },
    changeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 4,
      borderRadius: 6,
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
      fontSize: 9,
      color: isDarkMode ? '#666' : '#aaa',
      marginTop: 1,
    },
    changeRight: {
      alignItems: 'flex-end',
      minWidth: 100,
    },
    changeValuesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    changeOldValue: {
      fontSize: 11,
      color: isDarkMode ? '#888' : '#999',
      textDecorationLine: 'line-through',
    },
    changeNewValue: {
      fontSize: 13,
      fontWeight: 'bold',
    },
    changePctBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      marginTop: 3,
    },
    changePctText: {
      fontSize: 10,
      fontWeight: 'bold',
    },
    changeValueType: {
      fontSize: 8,
      color: isDarkMode ? '#666' : '#999',
      marginTop: 2,
      fontWeight: 'bold',
    },

    // Sub-values grid (multi-value types)
    subValuesGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? '#2a2a2a' : '#f0f0f0',
    },
    subValueItem: {
      backgroundColor: isDarkMode ? '#1a1a1a' : '#f8f8f8',
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 5,
      minWidth: 70,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: isDarkMode ? '#2a2a2a' : '#eee',
    },
    subValueItemPrimary: {
      borderColor: config.colors.primary + '40',
      backgroundColor: isDarkMode ? '#1a2332' : '#EFF6FF',
    },
    subValueLabel: {
      fontSize: 9,
      fontWeight: 'bold',
      color: isDarkMode ? '#888' : '#666',
      marginBottom: 2,
    },
    subValueOld: {
      fontSize: 9,
      color: isDarkMode ? '#666' : '#aaa',
      textDecorationLine: 'line-through',
    },
    subValueNew: {
      fontSize: 10,
      fontWeight: 'bold',
    },
    subValuePct: {
      fontSize: 8,
      fontWeight: 'bold',
      marginTop: 1,
    },

    // Updated Row
    updatedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 8,
    },
    updatedText: {
      fontSize: 10,
      color: isDarkMode ? '#666' : '#999',
    },
  });

export default AnalyticsScreen;
