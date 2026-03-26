/**
 * GameHub.js
 * Central navigation screen for all mini games.
 * Solo games open as modals, multiplayer navigates to screens.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import DailyQuiz from './DailyQuiz';
import MemoryMatch from './MemoryMatch';
import IceBreaker from './IceBreaker';
import WordScramble from './WordScramble';


const GameHub = ({ navigation }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const [showQuiz, setShowQuiz] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [showIce, setShowIce] = useState(false);
  const [showScramble, setShowScramble] = useState(false);

  const c = getThemeColors(isDarkMode);
  const bg = c.bg;
  const cardBg = c.bgAlt;
  const txt = c.text;
  const sub = c.textSecondary;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: bg }}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={{ fontSize: 32 }}>🎮</Text>
        <View style={{ marginLeft: 12, flex: 1 }}>
          <Text style={[styles.h1, { color: txt }]}>Game Hub</Text>
          <Text style={[styles.sub, { color: sub }]}>Play games, earn XP & rewards!</Text>
        </View>
      </View>

      {/* ── DAILY GAMES (Solo — modals) ── */}
      <Text style={[styles.sectionTitle, { color: txt }]}>Daily Games ⭐</Text>
      <Text style={[styles.sectionSub, { color: sub }]}>Play once a day, earn XP</Text>

      <View style={styles.gameGrid}>
        <TouchableOpacity style={[styles.gameCard, { backgroundColor: '#0EA5E9' }]} onPress={() => setShowIce(true)} activeOpacity={0.85}>
          <Text style={styles.gameEmoji}>🧊</Text>
          <Text style={styles.gameName}>Ice Breaker</Text>
          <Text style={styles.gameInfo}>Crack ice, guess pets</Text>
          <View style={styles.gameTag}><Text style={styles.gameTagText}>1x / day</Text></View>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.gameCard, { backgroundColor: '#8B5CF6' }]} onPress={() => setShowQuiz(true)} activeOpacity={0.85}>
          <Text style={styles.gameEmoji}>🧠</Text>
          <Text style={styles.gameName}>Pet Quiz</Text>
          <Text style={styles.gameInfo}>5 trivia questions</Text>
          <View style={styles.gameTag}><Text style={styles.gameTagText}>1x / day</Text></View>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.gameCard, { backgroundColor: '#F59E0B' }]} onPress={() => setShowScramble(true)} activeOpacity={0.85}>
          <Text style={styles.gameEmoji}>🔤</Text>
          <Text style={styles.gameName}>Word Scramble</Text>
          <Text style={styles.gameInfo}>Unscramble pet names</Text>
          <View style={styles.gameTag}><Text style={styles.gameTagText}>1+ / day</Text></View>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.gameCard, { backgroundColor: '#10B981' }]} onPress={() => setShowMemory(true)} activeOpacity={0.85}>
          <Text style={styles.gameEmoji}>🃏</Text>
          <Text style={styles.gameName}>Memory Match</Text>
          <Text style={styles.gameInfo}>Find pet pairs</Text>
          <View style={styles.gameTag}><Text style={styles.gameTagText}>3x / day</Text></View>
        </TouchableOpacity>
      </View>



      {/* ── XP SHOP (spend XP on mystery eggs) ── */}
      <Text style={[styles.sectionTitle, { color: txt, marginTop: 24 }]}>XP Shop 🛒</Text>
      <Text style={[styles.sectionSub, { color: sub }]}>Spend XP, win cosmetics!</Text>

      <TouchableOpacity style={[styles.mpCard, { backgroundColor: cardBg }]} onPress={() => navigation.navigate('MysteryEggScreen')} activeOpacity={0.85}>
        <View style={[styles.mpIcon, { backgroundColor: '#EC489920' }]}>
          <Text style={{ fontSize: 28 }}>🥚</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.mpName, { color: txt }]}>Mystery Eggs</Text>
            <View style={[styles.liveBadge, { backgroundColor: '#EC4899' }]}><Text style={styles.liveBadgeText}>NEW</Text></View>
          </View>
          <Text style={[styles.mpDesc, { color: sub }]}>Hatch eggs to win profile frames & chat text colors!</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={sub} />
      </TouchableOpacity>

      {/* ── MULTIPLAYER GAMES (navigate to screens) ── */}
      <Text style={[styles.sectionTitle, { color: txt, marginTop: 24 }]}>Multiplayer ⚔️</Text>
      <Text style={[styles.sectionSub, { color: sub }]}>Challenge your friends!</Text>

      <TouchableOpacity style={[styles.mpCard, { backgroundColor: cardBg }]} onPress={() => navigation.navigate('QuizBattleScreen')} activeOpacity={0.85}>
        <View style={[styles.mpIcon, { backgroundColor: '#3B82F620' }]}>
          <Text style={{ fontSize: 28 }}>⚔️</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.mpName, { color: txt }]}>Quiz Battle</Text>
            <View style={styles.liveBadge}><Text style={styles.liveBadgeText}>2P LIVE</Text></View>
          </View>
          <Text style={[styles.mpDesc, { color: sub }]}>Real-time trivia vs a friend. Fastest correct wins bonus!</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={sub} />
      </TouchableOpacity>

      <TouchableOpacity style={[styles.mpCard, { backgroundColor: cardBg }]} onPress={() => navigation.navigate('TradeShowdownScreen')} activeOpacity={0.85}>
        <View style={[styles.mpIcon, { backgroundColor: '#F59E0B20' }]}>
          <Text style={{ fontSize: 28 }}>💰</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.mpName, { color: txt }]}>Trade Showdown</Text>
            <View style={[styles.liveBadge, { backgroundColor: '#F59E0B' }]}><Text style={styles.liveBadgeText}>NEW</Text></View>
          </View>
          <Text style={[styles.mpDesc, { color: sub }]}>2 pets, pick the more valuable one. Beat your friend!</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={sub} />
      </TouchableOpacity>

      <TouchableOpacity style={[styles.mpCard, { backgroundColor: cardBg }]} onPress={() => navigation.navigate('Home', { screen: 'Chat' })} activeOpacity={0.85}>
        <View style={[styles.mpIcon, { backgroundColor: '#F59E0B20' }]}>
          <Text style={{ fontSize: 28 }}>🎡</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[styles.mpName, { color: txt }]}>Pet Wheel Spin</Text>
            <View style={[styles.liveBadge, { backgroundColor: '#F59E0B' }]}><Text style={styles.liveBadgeText}>2P LIVE</Text></View>
          </View>
          <Text style={[styles.mpDesc, { color: sub }]}>Spin the wheel & collect values. Access from Chat → 🎮</Text>
        </View>
        <Icon name="chevron-forward" size={18} color={sub} />
      </TouchableOpacity>

      <View style={[styles.tipCard, { backgroundColor: isDarkMode ? '#1e293b' : '#EFF6FF' }]}>
        <Icon name="information-circle" size={18} color="#3B82F6" />
        <Text style={[styles.tipText, { color: sub }]}>
          Play daily games to earn XP and level up! 🚀
        </Text>
      </View>

      {/* Modals */}
      <DailyQuiz visible={showQuiz} onClose={() => setShowQuiz(false)} />
      <MemoryMatch visible={showMemory} onClose={() => setShowMemory(false)} />
      <IceBreaker visible={showIce} onClose={() => setShowIce(false)} />
      <WordScramble visible={showScramble} onClose={() => setShowScramble(false)} />

    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  h1: { fontSize: 26, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 2 },
  sectionSub: { fontSize: 11, marginBottom: 14 },
  gameGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gameCard: {
    width: '47%', borderRadius: 18, padding: 14, alignItems: 'center', minHeight: 120, justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 5,
  },
  gameEmoji: { fontSize: 32, marginBottom: 6 },
  gameName: { color: '#fff', fontSize: 13, fontWeight: '800', textAlign: 'center' },
  gameInfo: { color: 'rgba(255,255,255,0.75)', fontSize: 9, marginTop: 2, textAlign: 'center' },
  gameTag: { backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, marginTop: 8 },
  gameTagText: { color: '#fff', fontSize: 9, fontWeight: '700' },
  mpCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, marginBottom: 10,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6 },
      android: { elevation: 3 },
    }),
  },
  mpIcon: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  mpName: { fontSize: 15, fontWeight: '800' },
  mpDesc: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  liveBadge: { backgroundColor: '#3B82F6', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  liveBadgeText: { color: '#fff', fontSize: 8, fontWeight: '800' },
  tipCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderRadius: 14, marginTop: 16 },
  tipText: { fontSize: 11, flex: 1, lineHeight: 16 },
});

export default GameHub;
