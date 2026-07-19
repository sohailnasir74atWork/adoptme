/**
 * HomeTrackerCard — Pet Tracker entry on the home tab.
 * Promo card when the user has no grinds; live progress mini-widget once
 * they do. Reads MMKV directly (instant, offline, zero network).
 */

import React, { useMemo, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import { getGrinds, subscribe, todayCount, getDailyGoal } from './trackerStorage';
import { grindTotals } from './agingMath';
import { GOAL_COLORS, ProgressBar } from './trackerShared';

const HomeTrackerCard = ({ isDarkMode, navigation }) => {
  const { t } = useTranslation();
  const grinds = useSyncExternalStore(subscribe, getGrinds);

  const grind = useMemo(() => {
    if (!grinds.length) return null;
    return grinds.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a), grinds[0]);
  }, [grinds]);

  const cardBg = isDarkMode ? '#1C1C1E' : '#fff';
  const textColor = isDarkMode ? '#fff' : '#111';
  const subColor = isDarkMode ? '#94A3B8' : '#64748b';

  if (!grind) {
    return (
      <TouchableOpacity
        style={[styles.card, { backgroundColor: cardBg }]}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('PetTracker')}
      >
        <View style={[styles.promoIcon, { backgroundColor: `${config.colors.primary}1A` }]}>
          <FontAwesome name="chart-line" size={18} color={config.colors.primary} solid />
        </View>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text style={[styles.title, { color: textColor }]}>
            {t('tracker.home_promo_title', { defaultValue: 'Pet Aging & Growing Tracker' })}
          </Text>
          <Text style={[styles.sub, { color: subColor }]} numberOfLines={2}>
            {t('tracker.home_promo_sub', { defaultValue: 'Plan Neon & Mega grinds — track every pet to Full Grown' })}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={12} color={config.colors.primary} />
      </TouchableOpacity>
    );
  }

  const totals = grindTotals(grind);
  const goalColor = GOAL_COLORS[grind.goal] || config.colors.primary;
  const today = todayCount();
  const goal = getDailyGoal();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: cardBg }]}
      activeOpacity={0.8}
      onPress={() => navigation.navigate('PetTracker')}
    >
      {grind.imageUrl ? (
        <Image source={{ uri: grind.imageUrl }} style={styles.petImage} resizeMode="contain" />
      ) : (
        <View style={[styles.promoIcon, { backgroundColor: `${goalColor}1A` }]}>
          <FontAwesome name="paw" size={16} color={goalColor} solid />
        </View>
      )}
      <View style={{ flex: 1, marginHorizontal: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.title, { color: textColor }]} numberOfLines={1}>{grind.petName}</Text>
          <Text style={[styles.pct, { color: goalColor }]}>{totals.pct}%</Text>
        </View>
        <ProgressBar
          pct={totals.pct}
          color={goalColor}
          trackColor={isDarkMode ? '#333' : '#eee'}
          height={5}
          style={{ marginVertical: 5 }}
        />
        <Text style={[styles.sub, { color: subColor }]} numberOfLines={1}>
          {t('tracker.tasks_left', { count: totals.remaining, defaultValue: '{{count}} tasks left' })}
          {'  ·  '}
          {t('tracker.today_short', { done: today, goal, defaultValue: 'Today {{done}}/{{goal}}' })}
        </Text>
      </View>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <Text style={[styles.continueText, { color: config.colors.primary }]}>
          {t('tracker.continue_grind', { defaultValue: 'Continue' })}
        </Text>
        <FontAwesome name="chevron-right" size={11} color={config.colors.primary} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
    padding: 12,
    borderRadius: 16,
  },
  promoIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  petImage: { width: 40, height: 40, borderRadius: 10 },
  title: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  pct: { fontSize: 13, fontWeight: '800' },
  sub: { fontSize: 11, marginTop: 2 },
  continueText: { fontSize: 11, fontWeight: '700' },
});

export default HomeTrackerCard;
