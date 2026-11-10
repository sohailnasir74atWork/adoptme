// Market snapshot card on Home (2026-11-04, features LOG "batch 2"). It used
// to be a one-gainer / one-loser teaser; it now shows the market at a glance:
// when values last moved, how many changed, trade volume, and the top 3 risers
// and fallers. Free for everyone — the Analytics screen keeps its own gating.
//
// Data: only what the app already downloads and caches in the 'analytics-cache'
// MMKV (Helper/analyticsDataHelper.js fetchAnalyticsData):
//   check-diff-adoptme.b-cdn.net/diff.json  meta.generatedAt, changed[] (movers)
//   analytics.b-cdn.net                     tradeVolume.{last24h,thisWeek}, updatedAt
// No Firestore / RTDB reads. If neither feed is available the card is hidden.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import { fetchAnalyticsData, freshDiffEntries, valueChangeOf, normalizeName } from '../Helper/analyticsDataHelper';
import { useLocalState } from '../LocalGlobelStats';
import { resolveItemImage } from '../Helper/valueSources';
import ValueHistoryModal from '../ValuesScreen/ValueHistoryModal';

let analyticsCache = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  analyticsCache = createMMKV({ id: 'analytics-cache' });
} catch (e) {
  console.warn('[TrendingPets] MMKV not available:', e.message);
}
const CHANGES_CACHE_KEY = 'value_changes';
const ANALYTICS_CACHE_KEY = 'analytics';
const MOVERS_PER_SIDE = 3;
// fetchAnalyticsData has no timeout of its own; never leave the skeleton up.
const LOADING_GIVE_UP_MS = 12000;

const readJSON = (key) => {
  try {
    const raw = analyticsCache?.getString(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const toMs = (v) => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const compactCount = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(v));
};

// Builds the snapshot from the cached feeds. null = nothing to show.
const buildSnapshot = () => {
  const diff = readJSON(CHANGES_CACHE_KEY);
  let analytics = readJSON(ANALYTICS_CACHE_KEY);
  // The feed has been served as a Firestore REST document before.
  if (analytics?.documents) analytics = null;

  const entries = freshDiffEntries(diff);
  const rising = [];
  const falling = [];
  entries.forEach((item) => {
    const name = String(item?.name || '').trim();
    if (!name) return;
    const change = valueChangeOf(item);
    if (!change || change.pct === 0) return;
    const entry = { key: `${normalizeName(name)}|${item.type || ''}`, name, type: item.type, pct: change.pct };
    (change.pct > 0 ? rising : falling).push(entry);
  });
  rising.sort((a, b) => b.pct - a.pct);
  falling.sort((a, b) => a.pct - b.pct);

  const stats = [];
  if (entries.length > 0) stats.push({ key: 'changed', value: entries.length, labelKey: 'trending.values_changed', defaultLabel: 'Values changed' });
  const volume = analytics?.tradeVolume;
  if (volume && Number(volume.last24h) > 0) stats.push({ key: 'd1', value: volume.last24h, labelKey: 'trending.trades_24h', defaultLabel: 'Trades (24h)' });
  if (volume && Number(volume.thisWeek) > 0) stats.push({ key: 'd7', value: volume.thisWeek, labelKey: 'trending.trades_7d', defaultLabel: 'Trades (7d)' });

  if (stats.length === 0 && rising.length === 0 && falling.length === 0) return null;

  // "Updated" is the time of the value update when movers are shown, else the
  // analytics run that produced the trade counts.
  const updatedAt = entries.length > 0
    ? toMs(diff?.meta?.generatedAt || diff?.lastUpdated)
    : toMs(analytics?.updatedAt || analytics?.computedAt);

  return {
    updatedAt,
    stats: stats.slice(0, 3),
    rising: rising.slice(0, MOVERS_PER_SIDE),
    falling: falling.slice(0, MOVERS_PER_SIDE),
  };
};

const TrendingPets = ({ isDarkMode, navigation }) => {
  const { t } = useTranslation();
  const { localState } = useLocalState();
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [historyTarget, setHistoryTarget] = useState(null);

  useEffect(() => {
    let alive = true;
    const giveUp = setTimeout(() => { if (alive) setLoading(false); }, LOADING_GIVE_UP_MS);
    // fetchAnalyticsData serves from cache when fresh and refreshes both feeds
    // otherwise; it never throws, but guard anyway.
    fetchAnalyticsData()
      .catch(() => null)
      .then(() => {
        if (!alive) return;
        try {
          setSnapshot(buildSnapshot());
        } catch (err) {
          console.warn('[TrendingPets] Error:', err.message);
        }
        setLoading(false);
      });
    return () => { alive = false; clearTimeout(giveUp); };
  }, []);

  const colors = useMemo(() => ({
    card: isDarkMode ? '#1C1C1E' : '#fff',
    tile: isDarkMode ? '#334155' : '#f1f5f9',
    text: isDarkMode ? '#f8fafc' : '#0f172a',
    sub: isDarkMode ? '#94a3b8' : '#64748b',
    skeleton: isDarkMode ? '#333' : '#e5e5e5',
  }), [isDarkMode]);

  const updatedText = useMemo(() => {
    if (!snapshot?.updatedAt) return null;
    const diffMs = Date.now() - snapshot.updatedAt;
    const mins = Math.floor(diffMs / 60000);
    const hours = Math.floor(diffMs / 3600000);
    if (mins < 1) return t('home.updated_just_now');
    if (mins < 60) return t('home.updated_mins_ago', { count: mins });
    if (hours < 24) return t('home.updated_hours_ago', { count: hours });
    return t('home.updated_on_date', { date: new Date(snapshot.updatedAt).toLocaleDateString() });
  }, [snapshot, t]);

  const openAnalytics = useCallback(() => {
    navigation.navigate('Analytics', { tab: 'changes' });
  }, [navigation]);

  // Movers come from Elvebredd's diff, so they are resolved in the Elvebredd
  // catalogue (localState.data) — the same feed the history chart reads.
  const openMover = useCallback((mover) => {
    let found = null;
    try {
      const raw = localState?.data;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const rows = parsed && typeof parsed === 'object' ? Object.values(parsed) : [];
      const name = normalizeName(mover.name);
      const type = String(mover.type || '').toLowerCase();
      found = rows.find((r) => r && normalizeName(r.name) === name && String(r.type || '').toLowerCase() === type)
        || rows.find((r) => r && normalizeName(r.name) === name)
        || null;
    } catch {
      found = null;
    }
    if (!found) {
      openAnalytics();
      return;
    }
    setHistoryTarget({ item: found, imageUrl: resolveItemImage(found, localState?.imgurl) });
  }, [localState?.data, localState?.imgurl, openAnalytics]);

  if (!loading && !snapshot) return null;

  if (loading) {
    return (
      <View style={styles.section}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={[styles.skelLine, { width: '40%', backgroundColor: colors.skeleton }]} />
          <View style={[styles.statsRow, { marginTop: 10 }]}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.statTile, { backgroundColor: colors.tile, height: 46 }]} />
            ))}
          </View>
        </View>
      </View>
    );
  }

  const renderColumn = (list, color, titleKey, defaultTitle) => (
    <View style={styles.moverCol}>
      <Text style={[styles.moverHead, { color }]} numberOfLines={1}>{t(titleKey, { defaultValue: defaultTitle })}</Text>
      {list.map((m) => (
        <TouchableOpacity
          key={m.key}
          style={styles.moverRow}
          activeOpacity={0.6}
          onPress={() => openMover(m)}
          accessibilityRole="button"
          accessibilityLabel={`${m.name} ${m.pct > 0 ? '+' : ''}${m.pct}%`}
        >
          <Text style={[styles.moverName, { color: colors.text }]} numberOfLines={1}>{m.name}</Text>
          <Text style={[styles.moverPct, { color }]}>{m.pct > 0 ? '+' : ''}{m.pct}%</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const hasMovers = snapshot.rising.length > 0 || snapshot.falling.length > 0;

  return (
    <View style={styles.section}>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={styles.headerRow} activeOpacity={0.7} onPress={openAnalytics} accessibilityRole="button">
          <FontAwesome name="chart-line" size={13} color={config.colors.primary} solid />
          <Text style={[styles.title, { color: colors.text }]}>{t('trending.market', { defaultValue: 'Market' })}</Text>
          {updatedText ? (
            <Text style={[styles.updated, { color: colors.sub }]} numberOfLines={1}>{updatedText}</Text>
          ) : <View style={{ flex: 1 }} />}
          <FontAwesome name="chevron-right" size={10} color={colors.sub} />
        </TouchableOpacity>

        {snapshot.stats.length > 0 && (
          <View style={styles.statsRow}>
            {snapshot.stats.map((s) => (
              <View key={s.key} style={[styles.statTile, { backgroundColor: colors.tile }]}>
                <Text style={[styles.statValue, { color: colors.text }]} numberOfLines={1}>{compactCount(s.value)}</Text>
                <Text style={[styles.statLabel, { color: colors.sub }]} numberOfLines={1}>{t(s.labelKey, { defaultValue: s.defaultLabel })}</Text>
              </View>
            ))}
          </View>
        )}

        {hasMovers && (
          <View style={styles.moversRow}>
            {snapshot.rising.length > 0 && renderColumn(snapshot.rising, '#10B981', 'trending.rising', 'Rising')}
            {snapshot.falling.length > 0 && renderColumn(snapshot.falling, '#EF4444', 'trending.falling', 'Falling')}
          </View>
        )}
      </View>
      <ValueHistoryModal
        visible={!!historyTarget}
        item={historyTarget?.item}
        imageUrl={historyTarget?.imageUrl}
        isDarkMode={isDarkMode}
        onClose={() => setHistoryTarget(null)}
      />
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
    padding: 12,
  },
  skelLine: {
    height: 12,
    borderRadius: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  updated: {
    flex: 1,
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'right',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  statTile: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  moversRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 10,
  },
  moverCol: {
    flex: 1,
  },
  moverHead: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  moverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  moverName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  moverPct: {
    fontSize: 12,
    fontWeight: '800',
  },
});

export default TrendingPets;
