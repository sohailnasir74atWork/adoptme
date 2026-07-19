import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
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

const TrendingPets = ({ isDarkMode, navigation }) => {
  const { t } = useTranslation();
  const [gainers, setGainers] = useState([]);
  const [losers, setLosers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchGen, setFetchGen] = useState(0); // bumped after CDN fetch seeds cache

  // Fetch from CDN if cache is empty or stale (4 hours) — works for all users including logged-out
  useEffect(() => {
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    const cached = analyticsCache?.getString(CHANGES_CACHE_KEY);
    const cachedTs = analyticsCache?.getNumber('value_changes_ts');
    const isFresh = cached && cachedTs && (Date.now() - cachedTs < FOUR_HOURS_MS);
    if (isFresh) {
      setFetchGen(g => g + 1);
    } else {
      fetchAnalyticsData()
        .then(() => setFetchGen(g => g + 1))
        .catch(() => setLoading(false));
    }
  }, []);

  useEffect(() => {
    // Don't process until CDN fetch completes or cache is confirmed fresh
    if (fetchGen === 0) return;

    try {
      const cachedChanges = analyticsCache?.getString(CHANGES_CACHE_KEY);
      if (!cachedChanges) { setLoading(false); return; }

      const changesData = JSON.parse(cachedChanges);
      const rawList = Array.isArray(changesData?.changed) ? changesData.changed
        : Array.isArray(changesData?.changes) ? changesData.changes
          : [];

      const gainersList = [];
      const losersList = [];

      rawList.forEach((item) => {
        const name = String(item.name || '').toLowerCase().trim();
        if (!name) return;

        const change = getPrimaryChange(item);
        if (!change || change.pct === 0) return;

        const entry = { id: name, pct: change.pct };

        if (change.pct > 0) {
          gainersList.push(entry);
        } else {
          losersList.push(entry);
        }
      });

      // Sort gainers descending by pct, losers by most negative
      gainersList.sort((a, b) => b.pct - a.pct);
      losersList.sort((a, b) => a.pct - b.pct);

      setGainers(gainersList.slice(0, 1));
      setLosers(losersList.slice(0, 1));
    } catch (err) {
      console.warn('[TrendingPets] Error:', err.message);
    } finally {
      setLoading(false);
    }
  }, [fetchGen]);

  if (!loading && gainers.length === 0 && losers.length === 0) return null;

  return (
    <View style={styles.section}>
      {loading ? (
        <View style={[styles.card, { backgroundColor: isDarkMode ? '#1C1C1E' : '#fff' }]}>
          <View style={styles.statsRow}>
            {[0, 1].map((col) => (
              <View key={col} style={[styles.statPill, { backgroundColor: isDarkMode ? '#26262a' : '#F4F4F5' }]}>
                <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: isDarkMode ? '#333' : '#ddd' }} />
                <View style={{ flex: 1, height: 10, borderRadius: 3, backgroundColor: isDarkMode ? '#333' : '#e5e5e5' }} />
                <View style={{ width: 34, height: 10, borderRadius: 3, backgroundColor: isDarkMode ? '#333' : '#e5e5e5' }} />
              </View>
            ))}
          </View>
          <View style={styles.teaserRow}>
            <View style={{ width: '60%', height: 10, borderRadius: 3, backgroundColor: isDarkMode ? '#333' : '#e5e5e5' }} />
          </View>
        </View>
      ) : (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => navigation.navigate('Analytics')}
        style={[styles.card, { backgroundColor: isDarkMode ? '#1C1C1E' : '#fff' }]}
      >
        <View style={styles.statsRow}>
          {gainers.length > 0 && (
            <View style={[styles.statPill, { backgroundColor: isDarkMode ? '#12261f' : '#F0FDF4' }]}>
              <FontAwesome name="fire-flame-curved" size={12} color="#10B981" solid />
              <Text style={[styles.statLabel, { color: '#10B981' }]} numberOfLines={1}>{t('trending.hot')}</Text>
              <FontAwesome name="lock" size={9} color={isDarkMode ? '#777' : '#aaa'} solid />
              <Text style={[styles.statPct, { color: '#10B981' }]}>+{gainers[0].pct}%</Text>
            </View>
          )}
          {losers.length > 0 && (
            <View style={[styles.statPill, { backgroundColor: isDarkMode ? '#2a1a1a' : '#FEF2F2' }]}>
              <FontAwesome name="arrow-trend-down" size={12} color="#EF4444" solid />
              <Text style={[styles.statLabel, { color: '#EF4444' }]} numberOfLines={1}>{t('trending.dropping')}</Text>
              <FontAwesome name="lock" size={9} color={isDarkMode ? '#777' : '#aaa'} solid />
              <Text style={[styles.statPct, { color: '#EF4444' }]}>{losers[0].pct}%</Text>
            </View>
          )}
        </View>
        <View style={styles.teaserRow}>
          <FontAwesome name="lock" size={10} color={config.colors.primary} solid />
          <Text style={styles.teaserText}>{t('trending.locked_teaser')}</Text>
          <FontAwesome name="chevron-right" size={9} color={config.colors.primary} />
        </View>
      </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 16,
    marginTop: 8,
  },
  card: {
    borderRadius: 14,
    padding: 10,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  statPct: {
    fontSize: 12,
    fontWeight: '800',
    marginLeft: 'auto',
  },
  teaserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 8,
  },
  teaserText: {
    fontSize: 11,
    fontWeight: '600',
    color: config.colors.primary,
    textAlign: 'center',
    flexShrink: 1,
  },
});

export default TrendingPets;
