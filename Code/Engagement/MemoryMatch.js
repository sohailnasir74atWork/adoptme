/**
 * MemoryMatch.js
 * Pet card memory match game — 2×3 grid (3 pairs).
 *
 * Uses pet images from CDN. Flip 2 cards → match? Keep. No? Flip back.
 * Scoring: ≤ 4 moves = 3⭐, ≤ 6 = 2⭐, else 1⭐
 * Limits: 1 free game/day
 * State: Firestore games/{uid} → lastMemoryAt, memoryPlaysToday, memoryBestMoves
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Image,
  Dimensions,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { initGameSounds, releaseGameSounds, playPop, playWoosh, isSoundEnabled, setSoundEnabled } from '../Helper/GameSoundService';
import { doc, getDoc, setDoc, serverTimestamp } from '@react-native-firebase/firestore';
import { addXP } from './xpUtils';
import RewardedAdManager from '../Ads/RewardedAdManager';
import { fetchAnalyticsData, normalizeName } from '../Helper/analyticsDataHelper';
import { incrementAndCheckBadge, MEMORY_BADGE_THRESHOLDS } from '../ChatScreen/GroupChat/badgeUtils';
import { getServerTime } from '../Helper/serverTime';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_GAP = 8;
const COLS = 4;
const NUM_PAIRS = 4;
const CARD_W = Math.floor((SCREEN_WIDTH - 60 - CARD_GAP * (COLS - 1)) / COLS);
const CARD_H = CARD_W * 1.2;

// Fallback pet emojis if no real data
const FALLBACK_PETS = [
  { name: 'Shadow Dragon', emoji: '🐉' },
  { name: 'Frost Dragon', emoji: '❄️' },
  { name: 'Owl', emoji: '🦉' },
  { name: 'Parrot', emoji: '🦜' },
  { name: 'Giraffe', emoji: '🦒' },
  { name: 'Bat Dragon', emoji: '🦇' },
  { name: 'Crow', emoji: '🐦‍⬛' },
  { name: 'Unicorn', emoji: '🦄' },
  { name: 'Kangaroo', emoji: '🦘' },
  { name: 'Turtle', emoji: '🐢' },
  { name: 'Cat', emoji: '🐱' },
  { name: 'Dog', emoji: '🐶' },
];

const CARD_COLORS = ['#8B5CF6', '#10B981', '#F59E0B', '#EC4899'];

// `now` is an authoritative server-time Date (see getServerTime) so a user
// can't roll their device clock to fake a new day. Day boundary is the
// device's local calendar day on top of the server epoch.
const isSameDay = (timestamp, now) => {
  if (!timestamp || !now) return false;
  const d = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const MemoryMatch = ({ visible, onClose }) => {
  const { firestoreDB, appdatabase, user, theme } = useGlobalState();
  const { localState } = useLocalState();
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;

  // Demand map for filtering pets to only those with demand
  const [demandMap, setDemandMap] = useState({});
  useEffect(() => {
    fetchAnalyticsData().then(maps => {
      if (maps?.demandMap) setDemandMap(maps.demandMap);
    }).catch(() => {});
  }, []);

  // Get real pet data with images — filtered to only pets with demand
  const petPool = useMemo(() => {
    try {
      const rawData = localState.data;
      if (!rawData) return [];
      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      const allItems = typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
      const pets = allItems.filter(item =>
        (item?.type?.toLowerCase() === 'pets' || item?.type?.toLowerCase() === 'pet') && item?.image
      );
      // Filter to only pets with demand score ≥ 1
      if (Object.keys(demandMap).length > 0) {
        const demanded = pets.filter(p => demandMap[normalizeName(p.name)]);
        if (demanded.length >= NUM_PAIRS) return demanded;
      }
      return pets.length >= NUM_PAIRS ? pets : [];
    } catch { return []; }
  }, [localState.data, demandMap]);

  const getImageUrl = useCallback((imageField) => {
    const base = (localState?.imgurl || '').replace(/"/g, '').replace(/\/$/, '');
    if (!base || !imageField) return '';
    return `${base}/${imageField.replace(/^\//, '')}`;
  }, [localState?.imgurl]);

  const [phase, setPhase] = useState('loading'); // loading | ready | peeking | shuffling | playing | result
  const [cards, setCards] = useState([]);
  const [flipped, setFlipped] = useState([]);
  const [matched, setMatched] = useState([]);
  const [moves, setMoves] = useState(0);
  const [playsToday, setPlaysToday] = useState(0);
  const [bestMoves, setBestMoves] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [peekCountdown, setPeekCountdown] = useState(0);
  const flipAnims = useRef([]);
  const posXAnims = useRef([]);
  const posYAnims = useRef([]);
  const scaleAnims = useRef([]);

  const MAX_PLAYS = 1;
  const [adLoading, setAdLoading] = useState(false);
  const [hasWatchedAd, setHasWatchedAd] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled('memory'));

  useEffect(() => {
    if (!visible) return;
    initGameSounds();
    return () => releaseGameSounds();
  }, [visible]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled('memory', next);
    triggerHapticFeedback('selection');
  };

  // Watch ad for extra games
  const handleWatchAd = async () => {
    if (adLoading) return;
    setAdLoading(true);
    const earned = await RewardedAdManager.show();
    setAdLoading(false);
    if (earned) {
      setPlaysToday(prev => Math.max(0, prev - 2)); // grant 2 extra plays
      setPhase('ready');
      setHasWatchedAd(true);
      // Persist to Firestore — serverTimestamp so the stored time is
      // server-authoritative, not the device clock.
      if (firestoreDB && uid) {
        setDoc(doc(firestoreDB, 'games', uid), { lastMemoryAdAt: serverTimestamp() }, { merge: true }).catch(() => {});
      }
    }
  };

  // Load state
  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists() ? snap.data() : {};
        const serverNow = await getServerTime(appdatabase, uid);
        const today = isSameDay(data.lastMemoryAt, serverNow);
        const plays = today ? (data.memoryPlaysToday || 0) : 0;
        setPlaysToday(plays);
        setBestMoves(data.memoryBestMoves || 0);
        setHasWatchedAd(isSameDay(data.lastMemoryAdAt, serverNow)); // persist ad limit per day
        setPhase(plays >= MAX_PLAYS ? 'result' : 'ready');
      } catch {
        setPhase('ready');
      }
    })();
  }, [visible, firestoreDB, appdatabase, uid]);

  // Setup new game
  const startGame = () => {
    let pairs;

    if (petPool.length >= NUM_PAIRS) {
      // Use real pet data with actual images
      const picked = shuffle(petPool).slice(0, NUM_PAIRS);
      pairs = shuffle([...picked, ...picked].map((pet, i) => ({
        id: i,
        pairId: pet.name,
        img: pet.image, // real image path
        name: pet.name,
        useRealImg: true,
        color: CARD_COLORS[i % CARD_COLORS.length],
      })));
    } else {
      // Fallback to emojis
      const picked = shuffle(FALLBACK_PETS).slice(0, NUM_PAIRS);
      pairs = shuffle([...picked, ...picked].map((pet, i) => ({
        id: i,
        pairId: pet.name,
        name: pet.name,
        emoji: pet.emoji,
        useRealImg: false,
        color: CARD_COLORS[i % CARD_COLORS.length],
      })));
    }

    // Init flip animations — start at 1 (face-up for peek)
    flipAnims.current = pairs.map(() => new Animated.Value(1));
    posXAnims.current = pairs.map(() => new Animated.Value(0));
    posYAnims.current = pairs.map(() => new Animated.Value(0));
    scaleAnims.current = pairs.map(() => new Animated.Value(1));

    setCards(pairs);
    setFlipped([]);
    setMatched([]);
    setMoves(0);
    setIsChecking(false);
    setPeekCountdown(4);
    setPhase('peeking');
    triggerHapticFeedback('impactLight');
    playWoosh('memory');
  };

  // ── Peek phase: show cards for 3 seconds then flip face-down, then shuffle ──
  useEffect(() => {
    if (phase !== 'peeking') return;

    const interval = setInterval(() => {
      setPeekCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          // Flip all cards face-down
          flipAnims.current.forEach((anim) => {
            Animated.timing(anim, {
              toValue: 0,
              duration: 400,
              useNativeDriver: true,
            }).start();
          });
          // Go to shuffling after flip
          setTimeout(() => setPhase('shuffling'), 500);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase]);

  // ── Shuffling phase: animate cards moving around ──
  useEffect(() => {
    if (phase !== 'shuffling') return;

    const runShuffle = async () => {
      const count = cards.length;
      if (!count) return;

      // 3 rounds of shuffle animation
      for (let round = 0; round < 3; round++) {
        // Shrink + scatter to random positions
        const scatterAnims = [];
        for (let i = 0; i < count; i++) {
          const randX = (Math.random() - 0.5) * (CARD_W * 2);
          const randY = (Math.random() - 0.5) * (CARD_H * 1.5);
          scatterAnims.push(
            Animated.parallel([
              Animated.timing(posXAnims.current[i], {
                toValue: randX,
                duration: 200,
                useNativeDriver: true,
              }),
              Animated.timing(posYAnims.current[i], {
                toValue: randY,
                duration: 200,
                useNativeDriver: true,
              }),
              Animated.timing(scaleAnims.current[i], {
                toValue: 0.7,
                duration: 200,
                useNativeDriver: true,
              }),
            ])
          );
        }
        await new Promise(resolve =>
          Animated.stagger(30, scatterAnims).start(resolve)
        );

        // Snap back to grid positions
        const returnAnims = [];
        for (let i = 0; i < count; i++) {
          returnAnims.push(
            Animated.parallel([
              Animated.spring(posXAnims.current[i], {
                toValue: 0,
                useNativeDriver: true,
                tension: 120,
                friction: 8,
              }),
              Animated.spring(posYAnims.current[i], {
                toValue: 0,
                useNativeDriver: true,
                tension: 120,
                friction: 8,
              }),
              Animated.spring(scaleAnims.current[i], {
                toValue: 1,
                useNativeDriver: true,
                tension: 120,
                friction: 8,
              }),
            ])
          );
        }
        await new Promise(resolve =>
          Animated.stagger(20, returnAnims).start(resolve)
        );
      }

      // Done shuffling → start playing
      setPhase('playing');
    };

    runShuffle();
  }, [phase, cards.length]);

  const flipCard = (index) => {
    Animated.spring(flipAnims.current[index], {
      toValue: 1,
      useNativeDriver: true,
      tension: 80,
      friction: 8,
    }).start();
  };

  const unflipCard = (index) => {
    Animated.timing(flipAnims.current[index], {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const handleCardPress = useCallback((index) => {
    if (phase !== 'playing') return; // Block during peek
    if (isChecking || flipped.includes(index) || matched.includes(cards[index]?.pairId)) return;

    flipCard(index);
    const newFlipped = [...flipped, index];
    setFlipped(newFlipped);
    triggerHapticFeedback('impactLight');
    playPop('memory');

    if (newFlipped.length === 2) {
      setMoves(prev => prev + 1);
      setIsChecking(true);

      const [a, b] = newFlipped;
      if (cards[a].pairId === cards[b].pairId) {
        // Match!
        triggerHapticFeedback('notificationSuccess');
        playWoosh('memory');
        const newMatched = [...matched, cards[a].pairId];
        setMatched(newMatched);
        setFlipped([]);
        setIsChecking(false);

        // Check win
        if (newMatched.length === NUM_PAIRS) {
          setTimeout(() => finishGame(moves + 1), 500);
        }
      } else {
        // No match — flip back
        triggerHapticFeedback('notificationWarning');
        playPop('memory');
        setTimeout(() => {
          unflipCard(a);
          unflipCard(b);
          setFlipped([]);
          setIsChecking(false);
        }, 800);
      }
    }
  }, [flipped, matched, cards, isChecking, moves, phase]);

  const finishGame = async (finalMoves) => {
    setPhase('result');
    playWoosh('memory');
    const newPlays = playsToday + 1;
    setPlaysToday(newPlays);

    const stars = finalMoves <= 6 ? 3 : finalMoves <= 9 ? 2 : 1;
    const xpEarned = 22 + (stars * 14); // 36-64 XP

    try {
      const newBest = bestMoves === 0 ? finalMoves : Math.min(finalMoves, bestMoves);
      setBestMoves(newBest);

      await setDoc(doc(firestoreDB, 'games', uid), {
        lastMemoryAt: serverTimestamp(),
        memoryPlaysToday: newPlays,
        memoryBestMoves: newBest,
      }, { merge: true });

      if (appdatabase) await addXP(appdatabase, uid, xpEarned);

      // 🏅 Track memory game wins for memoryKing badge (10+ wins)
      if (appdatabase && uid) incrementAndCheckBadge(appdatabase, uid, 'memoryWinCount', MEMORY_BADGE_THRESHOLDS);
    } catch (err) {
      console.warn('[MemoryMatch] save error:', err?.message);
    }
  };

  const stars = moves <= 6 ? 3 : moves <= 9 ? 2 : 1;
  const canPlayMore = playsToday < MAX_PLAYS;
  const c = getThemeColors(isDarkMode);
  const bgColor = c.bg;
  const cardBg = c.bgAlt;
  const textColor = c.text;
  const subtextColor = c.textSecondary;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.overlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.9)' : 'rgba(0,0,0,0.5)' }]}>
        <SwipeableBottomDrawer onClose={onClose} isDarkMode={isDarkMode} style={[styles.modal, { backgroundColor: cardBg }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: textColor }]}>{t('memory_match.title')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={toggleSound} style={styles.closeBtn}>
                <Icon name={soundOn ? 'volume-high' : 'volume-mute'} size={20} color={subtextColor} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => {
                // Reset state on close
                setPhase('loading');
                setCards([]);
                setFlipped([]);
                setMatched([]);
                setMoves(0);
                onClose();
              }} style={styles.closeBtn}>
                <Icon name="close" size={22} color={subtextColor} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Ready */}
          {phase === 'ready' && (
            <View style={styles.centerContent}>
              <Text style={{ fontSize: 48 }}>🃏</Text>
              <Text style={[styles.readyTitle, { color: textColor }]}>{t('memory_match.pet_memory')}</Text>
              <Text style={[styles.readySub, { color: subtextColor }]}>
                {t('memory_match.instructions', { count: NUM_PAIRS })}
              </Text>
              <Text style={[styles.playsLeft, { color: '#3B82F6' }]}>
                {t('memory_match.plays_left', { count: MAX_PLAYS - playsToday })}
              </Text>
              {bestMoves > 0 && (
                <Text style={[styles.bestScore, { color: '#F59E0B' }]}>{t('memory_match.best_moves', { count: bestMoves })}</Text>
              )}
              <TouchableOpacity style={styles.startBtn} onPress={startGame}>
                <Icon name="play-circle" size={22} color="#fff" />
                <Text style={styles.startBtnText}>{t('memory_match.play')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Playing + Peeking + Shuffling (all show the grid) */}
          {(phase === 'playing' || phase === 'peeking' || phase === 'shuffling') && (
            <View>
              {/* Peek countdown banner */}
              {phase === 'peeking' && (
                <View style={{ backgroundColor: '#3B82F6', borderRadius: 12, padding: 10, marginBottom: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>
                    {t('memory_match.memorize', { count: peekCountdown })}
                  </Text>
                </View>
              )}

              {/* Shuffle banner */}
              {phase === 'shuffling' && (
                <View style={{ backgroundColor: '#8B5CF6', borderRadius: 12, padding: 10, marginBottom: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>
                    {t('memory_match.shuffling')}
                  </Text>
                </View>
              )}

              {/* Stats row — only during playing */}
              {phase === 'playing' && (
              <View style={styles.statsRow}>
                <Text style={[styles.statText, { color: subtextColor }]}>{t('memory_match.moves', { count: moves })}</Text>
                <Text style={[styles.statText, { color: subtextColor }]}>{t('memory_match.matched', { current: matched.length, total: NUM_PAIRS })}</Text>
              </View>
              )}

              {/* Grid */}
              <View style={styles.grid}>
                {cards.map((card, i) => {
                  const isMatched = matched.includes(card.pairId);
                  const anim = flipAnims.current[i];
                  const frontOpacity = anim ? anim.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [0, 0, 1],
                  }) : 0;
                  const backOpacity = anim ? anim.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [1, 0, 0],
                  }) : 1;

                  return (
                    <TouchableOpacity
                      key={i}
                      activeOpacity={0.7}
                      onPress={() => handleCardPress(i)}
                      disabled={isMatched || phase !== 'playing'}
                      style={[styles.cardWrap, { width: CARD_W, height: CARD_H }]}
                    >
                      <Animated.View style={{
                        width: '100%',
                        height: '100%',
                        transform: [
                          { translateX: posXAnims.current[i] || new Animated.Value(0) },
                          { translateY: posYAnims.current[i] || new Animated.Value(0) },
                          { scale: scaleAnims.current[i] || new Animated.Value(1) },
                        ],
                      }}>
                      {/* Back (hidden) */}
                      <Animated.View style={[styles.cardFace, styles.cardBack, {
                        width: CARD_W, height: CARD_H,
                        backgroundColor: isDarkMode ? '#334155' : '#e2e8f0',
                        opacity: backOpacity,
                      }]}>
                        <Text style={{ fontSize: 24 }}>❓</Text>
                      </Animated.View>

                      {/* Front (pet) */}
                      <Animated.View style={[styles.cardFace, styles.cardFront, {
                        width: CARD_W, height: CARD_H,
                        backgroundColor: isMatched ? '#10B98120' : card.color + '15',
                        borderColor: isMatched ? '#10B981' : card.color,
                        opacity: frontOpacity,
                      }]}>
                        {card.useRealImg ? (
                          <Image
                            source={{ uri: getImageUrl(card.img) }}
                            style={{ width: CARD_W * 0.6, height: CARD_W * 0.6, borderRadius: 8 }}
                            resizeMode="contain"
                          />
                        ) : (
                          <Text style={{ fontSize: CARD_W * 0.35 }}>{card.emoji}</Text>
                        )}
                        <Text style={[styles.cardName, { color: textColor }]} numberOfLines={1}>
                          {card.name}
                        </Text>
                        {isMatched && <Text style={{ fontSize: 10, color: '#10B981' }}>✓</Text>}
                      </Animated.View>
                      </Animated.View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Result */}
          {phase === 'result' && (
            <View style={styles.centerContent}>
              <Text style={{ fontSize: 48 }}>{stars === 3 ? '🏆' : stars === 2 ? '🌟' : '⭐'}</Text>
              <Text style={[styles.readyTitle, { color: textColor }]}>
                {matched.length === NUM_PAIRS ? (stars === 3 ? t('memory_match.result_amazing') : stars === 2 ? t('memory_match.result_great') : t('memory_match.result_good')) : t('memory_match.game_over')}
              </Text>
              {matched.length === NUM_PAIRS && (
                <>
                  <Text style={[styles.resultMoves, { color: '#3B82F6' }]}>{t('memory_match.total_moves', { count: moves })}</Text>
                  <Text style={{ fontSize: 20, marginTop: 4 }}>{'⭐'.repeat(stars)}</Text>
                  <Text style={[styles.readySub, { color: subtextColor }]}>
                    {t('memory_match.xp_earned', { xp: 22 + stars * 14 })}
                  </Text>
                </>
              )}
              {bestMoves > 0 && (
                <Text style={[styles.bestScore, { color: '#F59E0B' }]}>{t('memory_match.best_moves', { count: bestMoves })}</Text>
              )}
              {canPlayMore ? (
                <TouchableOpacity style={styles.startBtn} onPress={startGame}>
                  <Text style={styles.startBtnText}>{t('memory_match.play_again', { count: MAX_PLAYS - playsToday })}</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity style={[styles.startBtn, { backgroundColor: '#94a3b8' }]} onPress={onClose}>
                    <Text style={styles.startBtnText}>{t('memory_match.come_back')}</Text>
                  </TouchableOpacity>
                  {!hasWatchedAd && (
                    <TouchableOpacity
                      style={[styles.startBtn, { backgroundColor: '#F59E0B', marginTop: 10 }]}
                      onPress={handleWatchAd}
                      disabled={adLoading}
                    >
                      <Icon name={adLoading ? 'hourglass' : 'videocam'} size={20} color="#fff" />
                      <Text style={styles.startBtnText}>
                        {adLoading ? t('memory_match.loading_ad') : t('memory_match.watch_ad')}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </View>
          )}
        </SwipeableBottomDrawer>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  modal: {
    width: '100%', padding: 16, maxHeight: '92%',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.2, shadowRadius: 12 },
      android: { elevation: 12 },
    }),
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '800' },
  closeBtn: { padding: 8 },

  centerContent: { alignItems: 'center', paddingVertical: 20 },
  readyTitle: { fontSize: 24, fontWeight: '800', marginTop: 8 },
  readySub: { fontSize: 12, textAlign: 'center', marginTop: 6 },
  playsLeft: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  bestScore: { fontSize: 13, fontWeight: '700', marginTop: 8 },
  resultMoves: { fontSize: 32, fontWeight: '800', marginTop: 4 },

  startBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#10B981', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 16, marginTop: 20,
    shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  statText: { fontSize: 12, fontWeight: '700' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: CARD_GAP, justifyContent: 'center' },
  cardWrap: { position: 'relative' },
  cardFace: { position: 'absolute', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBack: { zIndex: 1 },
  cardFront: { zIndex: 2, borderWidth: 2, padding: 4 },
  cardName: { fontSize: 8, fontWeight: '700', marginTop: 2, textAlign: 'center' },
});

export default MemoryMatch;
