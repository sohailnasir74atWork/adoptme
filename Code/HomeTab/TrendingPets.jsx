import React, { useEffect, useState, useMemo, memo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
} from 'react-native';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import { fetchAnalyticsData } from '../Helper/analyticsDataHelper';

let analyticsCache = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  analyticsCache = createMMKV({ id: 'analytics-cache' });
} catch (e) {
  console.warn('[TrendingPets] MMKV not available:', e.message);
}
const CHANGES_CACHE_KEY = 'value_changes';

const SKIP_KEYS = new Set(['key', 'name', 'type', 'image']);
const VALUE_KEY_MAP = {
  'value': true, 'value - fly': true, 'value - ride': true, 'value - fly&ride': true,
  'rvalue': true, 'rvalue - fly': true, 'rvalue - ride': true, 'rvalue - fly&ride': true,
  'nvalue': true, 'nvalue - fly': true, 'nvalue - ride': true, 'nvalue - fly&ride': true,
  'mvalue': true, 'mvalue - fly': true, 'mvalue - ride': true, 'mvalue - fly&ride': true,
};

// Extract primary value change (old → new) from a diff item
const getPrimaryChange = (item) => {
  // Adoptme format: score: {oldVal, newVal}
  if (item.score && typeof item.score === 'object' && 'oldVal' in item.score && 'newVal' in item.score) {
    const diff = item.score.newVal - item.score.oldVal;
    const pct = item.score.oldVal > 0 ? Math.round((diff / item.score.oldVal) * 100) : 0;
    return { pct, oldVal: item.score.oldVal, newVal: item.score.newVal };
  }

  // New format with item.values (MM2)
  if (item.values) {
    const primary = item.primary || 'd_nopotion';
    const v = item.values[primary];
    if (v && 'oldVal' in v && 'newVal' in v) {
      const diff = v.newVal - v.oldVal;
      const pct = v.oldVal > 0 ? Math.round((diff / v.oldVal) * 100) : 0;
      return { pct, oldVal: v.oldVal, newVal: v.newVal };
    }
    return null;
  }

  // Old format with inline keys (MM2)
  for (const k of Object.keys(item)) {
    if (SKIP_KEYS.has(k)) continue;
    if (!VALUE_KEY_MAP[k]) continue;
    const v = item[k];
    if (v && typeof v === 'object' && 'oldVal' in v && 'newVal' in v) {
      const diff = v.newVal - v.oldVal;
      const pct = v.oldVal > 0 ? Math.round((diff / v.oldVal) * 100) : 0;
      return { pct, oldVal: v.oldVal, newVal: v.newVal };
    }
  }
  return null;
};

const MiniPetRow = memo(({ pet, isDark, isGainer }) => (
  <View style={[styles.miniRow, { backgroundColor: isDark ? '#1C1C1E' : '#fff' }]}>
    {pet.imageUrl ? (
      <Image source={{ uri: pet.imageUrl }} style={styles.miniImage} resizeMode="contain" />
    ) : (
      <View style={[styles.miniImage, { backgroundColor: isDark ? '#333' : '#f0f0f0', justifyContent: 'center', alignItems: 'center' }]}>
        <FontAwesome name="paw" size={14} color={isDark ? '#666' : '#aaa'} />
      </View>
    )}
    <Text style={[styles.miniName, { color: isDark ? '#fff' : '#111' }]} numberOfLines={1}>
      {pet.displayName}
    </Text>
    <Text style={[styles.miniPct, { color: isGainer ? '#10B981' : '#EF4444' }]}>
      {isGainer ? '+' : ''}{pet.pct}%
    </Text>
  </View>
));

const TrendingPets = ({ isDarkMode, navigation }) => {
  const { localState } = useLocalState();
  const { t } = useTranslation();
  const [gainers, setGainers] = useState([]);
  const [losers, setLosers] = useState([]);
  const [fetchGen, setFetchGen] = useState(0); // bumped after CDN fetch seeds cache

  // Fetch from CDN if cache is empty or stale (4 hours) — works for all users including logged-out
  useEffect(() => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const cached = analyticsCache?.getString(CHANGES_CACHE_KEY);
    const cachedTs = analyticsCache?.getNumber('value_changes_ts');
    const isFresh = cached && cachedTs && (Date.now() - cachedTs < FOUR_HOURS_MS);
    if (!isFresh) {
      fetchAnalyticsData()
        .then(() => setFetchGen(g => g + 1))
        .catch(() => {});
    }
  }, []);

  // Parse all pets from local data for image lookup
  const petMap = useMemo(() => {
    try {
      const rawData = localState.data;
      if (!rawData) return {};
      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      const items = typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
      const map = {};
      items.forEach(item => {
        if (item?.name) map[(item.name || '').toLowerCase().trim()] = item;
      });
      return map;
    } catch {
      return {};
    }
  }, [localState.data]);

  const getImageUrl = (item) => {
    if (!item?.image || !localState.imgurl) return '';
    return `${localState.imgurl.replace(/"/g, '').replace(/\/$/, '')}/${item.image.replace(/^\//, '')}`;
  };

  useEffect(() => {
    if (Object.keys(petMap).length === 0) return;

    try {
      const cachedChanges = analyticsCache?.getString(CHANGES_CACHE_KEY);
      if (!cachedChanges) return;

      const changesData = JSON.parse(cachedChanges);
      const rawList = Array.isArray(changesData?.changed) ? changesData.changed
        : Array.isArray(changesData?.changes) ? changesData.changes
          : [];

      const gainersList = [];
      const losersList = [];

      rawList.forEach((item) => {
        const name = (item.name || '').toLowerCase().trim();
        if (!name) return;

        const change = getPrimaryChange(item);
        if (!change || change.pct === 0) return;

        const pet = petMap[name];
        const entry = {
          id: name,
          displayName: pet?.name || name.charAt(0).toUpperCase() + name.slice(1),
          imageUrl: pet ? getImageUrl(pet) : '',
          pct: change.pct,
        };

        if (change.pct > 0) {
          gainersList.push(entry);
        } else {
          losersList.push(entry);
        }
      });

      // Sort gainers descending by pct, losers by most negative
      gainersList.sort((a, b) => b.pct - a.pct);
      losersList.sort((a, b) => a.pct - b.pct);

      setGainers(gainersList.slice(0, 3));
      setLosers(losersList.slice(0, 3));
    } catch (err) {
      console.warn('[TrendingPets] Error:', err.message);
    }
  }, [petMap, fetchGen]);

  if (gainers.length === 0 && losers.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <FontAwesome name="chart-simple" size={18} color={isDarkMode ? '#fff' : '#111'} solid />
          <Text style={[styles.title, { color: isDarkMode ? '#fff' : '#111' }]}>
            {t('trending.market_overview')}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('Analytics')}
          activeOpacity={0.7}
          style={styles.seeAll}
        >
          <Text style={styles.seeAllText}>{t('trending.full_analytics')}</Text>
          <FontAwesome name="chevron-right" size={10} color={config.colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.listsRow}>
        {/* 🔥 Hot / Gainers */}
        {gainers.length > 0 && (
          <View style={[styles.listCard, { backgroundColor: isDarkMode ? '#1a2332' : '#F0FDF4' }]}>
            <View style={styles.listHeader}>
              <FontAwesome name="fire-flame-curved" size={12} color="#10B981" solid />
              <Text style={[styles.listTitle, { color: '#10B981' }]}>{t('trending.hot')}</Text>
            </View>
            {gainers.map((pet) => (
              <MiniPetRow key={pet.id} pet={pet} isDark={isDarkMode} isGainer />
            ))}
          </View>
        )}

        {/* 📉 Losers */}
        {losers.length > 0 && (
          <View style={[styles.listCard, { backgroundColor: isDarkMode ? '#2a1a1a' : '#FEF2F2' }]}>
            <View style={styles.listHeader}>
              <FontAwesome name="arrow-trend-down" size={12} color="#EF4444" solid />
              <Text style={[styles.listTitle, { color: '#EF4444' }]}>{t('trending.dropping')}</Text>
            </View>
            {losers.map((pet) => (
              <MiniPetRow key={pet.id} pet={pet} isDark={isDarkMode} isGainer={false} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seeAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: config.colors.primary,
  },
  listsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  listCard: {
    flex: 1,
    borderRadius: 14,
    padding: 10,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  listTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 8,
    marginBottom: 4,
  },
  miniImage: {
    width: 26,
    height: 26,
    borderRadius: 6,
    marginRight: 6,
  },
  miniName: {
    flex: 1,
    fontSize: 11,
    fontWeight: '600',
  },
  miniPct: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4,
  },
});

export default TrendingPets;
