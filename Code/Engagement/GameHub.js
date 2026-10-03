/**
 * GameHub.js
 * The Mini Games screen: every solo game in one list.
 *
 * Opened from the Home tab "Mini Games" card. Ice Breaker, Pet Quiz, Memory
 * Match and Word Scramble are modals owned by this screen; the Arrow Puzzle,
 * Quiz Battle and Trade Showdown are their own stack screens. `route.params.open` (ice | quiz | memory |
 * scramble) opens one game straight away when a Home icon was tapped.
 *
 * The game list and icons are in ./miniGames (shared with the Home tab).
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import DailyQuiz from './DailyQuiz';
import MemoryMatch from './MemoryMatch';
import IceBreaker from './IceBreaker';
import WordScramble from './WordScramble';
import RewardedAdManager from '../Ads/RewardedAdManager';
import { GAMES, FRIEND_GAMES, GAME_ICONS } from './miniGames';

// iOS refuses to present a Modal from a screen that is still being pushed,
// so a game asked for by the Home card waits for the push to finish. The
// timer covers a missed transitionEnd; it is past the ~350 ms push.
const OPEN_FALLBACK_MS = 700;

const GameHub = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  const [openGame, setOpenGame] = useState(null);

  // Warm the rewarded ad when the hub opens: every game here has a "watch
  // ad for more plays" button, and a cold load at tap time used to time out.
  useEffect(() => {
    try { RewardedAdManager.prepare(); } catch (_) {}
  }, []);

  const play = useCallback((id) => {
    if (id === 'arrow') navigation.navigate('ArrowGameScreen');
    else setOpenGame(id);
  }, [navigation]);

  const requested = route?.params?.open;
  useEffect(() => {
    if (!requested) return undefined;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      play(requested);
      navigation.setParams({ open: undefined });
    };
    const unsubscribe = navigation.addListener('transitionEnd', (e) => {
      if (!e?.data?.closing) go();
    });
    const timer = setTimeout(go, OPEN_FALLBACK_MS);
    return () => { unsubscribe(); clearTimeout(timer); };
  }, [requested, play, navigation]);

  const close = useCallback(() => setOpenGame(null), []);

  return (
    <ScrollView
      style={[styles.flex1, { backgroundColor: c.bg }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Image source={GAME_ICONS.controller} style={styles.heroIcon} resizeMode="contain" />
        <View style={styles.flex1}>
          <Text style={styles.heroTitle}>{t('mini_games.title')}</Text>
          <Text style={styles.heroSub}>{t('mini_games.hero_sub')}</Text>
        </View>
      </View>

      <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>{t('mini_games.daily_title')}</Text>

      {GAMES.map((g) => (
        <TouchableOpacity
          key={g.id}
          style={[styles.row, { backgroundColor: c.cardBg, borderColor: c.border }]}
          onPress={() => play(g.id)}
          activeOpacity={0.85}
        >
          <View style={[styles.tile, { backgroundColor: g.color + '1F' }]}>
            <Image source={GAME_ICONS[g.id]} style={styles.tileIcon} resizeMode="contain" />
          </View>
          <View style={styles.flex1}>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>{t(`mini_games.${g.id}_name`)}</Text>
            <Text style={[styles.desc, { color: c.textSecondary }]} numberOfLines={2}>{t(`mini_games.${g.id}_desc`)}</Text>
            <View style={[styles.tag, { backgroundColor: g.color + '1F' }]}>
              <Text style={[styles.tagText, { color: g.color }]}>{t(`mini_games.${g.tag}`)}</Text>
            </View>
          </View>
          <View style={[styles.playBtn, { backgroundColor: g.color }]}>
            <Text style={styles.playText}>{t('mini_games.play')}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>{t('mini_games.friends_title')}</Text>

      {FRIEND_GAMES.map((g) => (
        <TouchableOpacity
          key={g.id}
          style={[styles.row, { backgroundColor: c.cardBg, borderColor: c.border }]}
          onPress={() => navigation.navigate(g.screen)}
          activeOpacity={0.85}
        >
          <View style={[styles.tile, { backgroundColor: g.color + '1F' }]}>
            <Image source={GAME_ICONS[g.icon]} style={styles.tileIcon} resizeMode="contain" />
          </View>
          <View style={styles.flex1}>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>{t(`mini_games.${g.id}_name`)}</Text>
            <Text style={[styles.desc, { color: c.textSecondary }]} numberOfLines={2}>{t(`mini_games.${g.id}_desc`)}</Text>
            <View style={[styles.tag, { backgroundColor: g.color + '1F' }]}>
              <Text style={[styles.tagText, { color: g.color }]}>{t('mini_games.tag_2p')}</Text>
            </View>
          </View>
          <View style={[styles.playBtn, { backgroundColor: g.color }]}>
            <Text style={styles.playText}>{t('mini_games.play')}</Text>
          </View>
        </TouchableOpacity>
      ))}

      <View style={[styles.tipCard, isDarkMode && styles.tipCardDark]}>
        <Text style={[styles.tipText, { color: c.textSecondary }]}>{t('mini_games.friends_tip')}</Text>
        <Text style={[styles.tipText, styles.tipGap, { color: c.textSecondary }]}>{t('mini_games.badges_tip')}</Text>
      </View>

      <IceBreaker visible={openGame === 'ice'} onClose={close} />
      <DailyQuiz visible={openGame === 'quiz'} onClose={close} />
      <MemoryMatch visible={openGame === 'memory'} onClose={close} />
      <WordScramble visible={openGame === 'scramble'} onClose={close} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: 16, marginBottom: 6, padding: 16, borderRadius: 18,
    backgroundColor: '#6D28D9',
    backgroundImage: 'linear-gradient(135deg, #7C3AED 0%, #4F46E5 100%)',
  },
  heroIcon: { width: 52, height: 52 },
  heroTitle: { color: '#fff', fontSize: 19, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  sectionTitle: {
    fontSize: 13, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase',
    marginHorizontal: 16, marginTop: 16, marginBottom: 8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 10, paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: 16, borderWidth: 1,
  },
  tile: { width: 52, height: 52, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  tileIcon: { width: 44, height: 44 },
  name: { fontSize: 15, fontWeight: '800' },
  desc: { fontSize: 11.5, marginTop: 2, lineHeight: 15 },
  tag: { alignSelf: 'flex-start', marginTop: 6, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 10, fontWeight: '800' },
  playBtn: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  playText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  tipCard: {
    marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 14, borderWidth: 1,
    backgroundColor: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.25)',
  },
  tipCardDark: { backgroundColor: 'rgba(99,102,241,0.12)' },
  tipText: { fontSize: 11.5, lineHeight: 16 },
  tipGap: { marginTop: 6 },
});

export default GameHub;
