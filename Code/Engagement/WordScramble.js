/**
 * WordScramble.js
 * Pet Word Scramble — unscramble pet names with progressive hints.
 *
 * ✅ 1 free game, then watch ad to unlock 2 more (repeatable)
 * ✅ Hints: rarity, category, value — hidden, revealed one-by-one on tap
 * ✅ Pet image shown on correct answer with confetti celebration
 * ✅ Haptic feedback throughout
 * ✅ 5 rounds, 20s per round, tap letters in order
 *
 * XP: +20 per correct, +3 speed bonus per second remaining, +50 perfect bonus
 * State: Firestore games/{uid} → lastScrambleAt, scramblePlaysToday, scrambleBestScore
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import SafeLottieView from '../Helper/SafeLottieView';
import { useTranslation } from 'react-i18next';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import { addXP } from './xpUtils';
import RewardedAdManager from '../Ads/RewardedAdManager';
import { fetchAnalyticsData, normalizeName } from '../Helper/analyticsDataHelper';

const TOTAL_ROUNDS = 3;
const GLOBAL_TIMER_SECONDS = 120;
const XP_PER_CORRECT = 20;
const XP_SPEED_BONUS = 3; // max time bonus
const XP_PERFECT_BONUS = 50;
const FREE_PLAYS = 1;
const AD_UNLOCK_COUNT = 2;

const isSameDay = (timestamp) => {
  if (!timestamp) return false;
  const d = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
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

const scrambleWord = (word) => {
  const letters = word.split('');
  let scrambled;
  let attempts = 0;
  do {
    scrambled = shuffle(letters);
    attempts++;
  } while (scrambled.join('') === word && attempts < 10);
  return scrambled;
};

const formatValue = (v) => {
  if (!v || typeof v !== 'number') return '???';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (v < 1) return v.toFixed(2);
  return v % 1 === 0 ? v.toString() : v.toFixed(2);
};

const WordScramble = ({ visible, onClose }) => {
  const { firestoreDB, db, user, theme } = useGlobalState();
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

  const [phase, setPhase] = useState('loading');
  const [playsToday, setPlaysToday] = useState(0);
  const [maxPlays, setMaxPlays] = useState(FREE_PLAYS);
  const [petNames, setPetNames] = useState([]); // full pet objects
  const [currentRound, setCurrentRound] = useState(0);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [globalTimeLeft, setGlobalTimeLeft] = useState(GLOBAL_TIMER_SECONDS);
  const [adLoading, setAdLoading] = useState(false);

  // Current round state
  const [targetPet, setTargetPet] = useState(null);
  const [targetWord, setTargetWord] = useState('');
  const [scrambledLetters, setScrambledLetters] = useState([]);
  const [selectedLetters, setSelectedLetters] = useState([]);
  const [roundResult, setRoundResult] = useState(null);
  const [roundXP, setRoundXP] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  // Hints state
  const [hints, setHints] = useState([]); // all available hints for current pet
  const [revealedHints, setRevealedHints] = useState(0); // how many revealed

  const timerRef = useRef(null);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const revealScale = useRef(new Animated.Value(0)).current;

  // image URL builder
  const getImageUrl = useCallback((imageField) => {
    const base = (localState?.imgurl || '').replace(/"/g, '').replace(/\/$/, '');
    if (!base || !imageField) return '';
    return `${base}/${imageField.replace(/^\//, '')}`;
  }, [localState?.imgurl]);

  // Get pet pool with full data — filtered to only pets with demand
  const petPool = useMemo(() => {
    try {
      const rawData = localState.data;
      if (!rawData) return [];
      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      const allItems = typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
      const allPets = allItems.filter(item =>
        (item?.type?.toLowerCase() === 'pets' || item?.type?.toLowerCase() === 'pet') &&
        item?.name &&
        item?.image &&
        item.name.length >= 3 &&
        item.name.length <= 14
      );
      // Filter to only pets with demand score ≥ 1
      if (Object.keys(demandMap).length > 0) {
        const demanded = allPets.filter(p => demandMap[normalizeName(p.name)]);
        if (demanded.length >= TOTAL_ROUNDS) return demanded;
      }
      return allPets;
    } catch { return []; }
  }, [localState.data, demandMap]);

  // Build hints for a pet
  const buildHints = useCallback((pet) => {
    const h = [];
    if (pet.rarity) h.push({ icon: '💎', label: t('word_scramble.hint_rarity', { defaultValue: 'Rarity' }), value: pet.rarity });
    if (pet.category) h.push({ icon: '📂', label: t('word_scramble.hint_category', { defaultValue: 'Category' }), value: pet.category });
    const val = Number(pet.rvalue || pet.value || 0);
    if (val > 0) h.push({ icon: '💰', label: t('word_scramble.hint_value', { defaultValue: 'Value' }), value: formatValue(val) });
    // Letter count as a free hint
    h.push({ icon: '📏', label: t('word_scramble.hint_letters', { defaultValue: 'Letters' }), value: `${pet.name.length} letters` });
    // First letter as a paid hint
    h.push({ icon: '🔤', label: t('word_scramble.hint_first', { defaultValue: 'Starts with' }), value: pet.name[0].toUpperCase() });
    return h;
  }, [t]);

  // Watch ad for more plays
  const handleWatchAd = async () => {
    if (adLoading) return;
    setAdLoading(true);
    const earned = await RewardedAdManager.show();
    setAdLoading(false);
    if (earned) {
      triggerHapticFeedback('notificationSuccess');
      setMaxPlays(prev => prev + AD_UNLOCK_COUNT);
      setPhase('ready');
      if (firestoreDB && uid) {
        setDoc(doc(firestoreDB, 'games', uid), {
          scrambleMaxPlays: maxPlays + AD_UNLOCK_COUNT,
          lastScrambleAdAt: new Date(),
        }, { merge: true }).catch(() => {});
      }
    }
  };

  // Load state on open
  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists ? snap.data() : {};
        const today = isSameDay(data.lastScrambleAt);
        const plays = today ? (data.scramblePlaysToday || 0) : 0;
        const maxP = today ? (data.scrambleMaxPlays || FREE_PLAYS) : FREE_PLAYS;
        setPlaysToday(plays);
        setMaxPlays(maxP);
        setBestScore(data.scrambleBestScore || 0);
        setPhase(plays >= maxP ? 'result' : 'ready');
        setScore(today ? (data.lastScrambleScore || 0) : 0);
        setCorrectCount(0);
        setCurrentRound(0);
        setRoundResult(null);
        setSelectedLetters([]);
        setShowConfetti(false);
      } catch {
        setPhase('ready');
      }
    })();
  }, [visible, firestoreDB, uid]);

  // Start game
  const startGame = useCallback(() => {
    if (petPool.length < TOTAL_ROUNDS) return;
    const picked = shuffle(petPool).slice(0, TOTAL_ROUNDS);
    setPetNames(picked);
    setCurrentRound(0);
    setScore(0);
    setCorrectCount(0);
    setRoundResult(null);
    setShowConfetti(false);
    setGlobalTimeLeft(GLOBAL_TIMER_SECONDS);
    triggerHapticFeedback('impactMedium');
    setupRound(picked[0]);
    setPhase('playing');
  }, [petPool, triggerHapticFeedback]);

  // Setup a single round
  const setupRound = useCallback((pet) => {
    const upper = pet.name.toUpperCase();
    setTargetPet(pet);
    setTargetWord(upper);
    const letters = scrambleWord(upper).map((letter, i) => ({
      letter,
      id: `${letter}_${i}_${Date.now()}`,
      used: false,
    }));
    setScrambledLetters(letters);
    setSelectedLetters([]);
    setRoundResult(null);
    setRoundXP(0);
    setShowConfetti(false);
    setHints(buildHints(pet));
    setRevealedHints(0);
    shakeAnim.setValue(0);
    revealScale.setValue(0);
  }, [shakeAnim, revealScale, buildHints]);

  // Global countdown timer
  useEffect(() => {
    if (phase !== 'playing' || roundResult !== null) return;

    timerRef.current = setInterval(() => {
      setGlobalTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          handleGlobalTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [phase, roundResult]);

  const handleGlobalTimeout = useCallback(() => {
    setRoundResult('timeout');
    triggerHapticFeedback('notificationError');
    setTimeout(() => {
      // Game over
      finishGame(score);
    }, 2500);
  }, [score, triggerHapticFeedback]);



  // Reveal a hint
  const handleRevealHint = useCallback(() => {
    if (revealedHints >= hints.length || roundResult !== null) return;
    triggerHapticFeedback('impactLight');
    setRevealedHints(prev => prev + 1);
  }, [revealedHints, hints.length, roundResult, triggerHapticFeedback]);

  // Handle letter selection
  const handleLetterPress = useCallback((letterObj) => {
    if (roundResult !== null) return;
    triggerHapticFeedback('impactLight');

    const newSelected = [...selectedLetters, letterObj];
    setSelectedLetters(newSelected);
    setScrambledLetters(prev =>
      prev.map(l => l.id === letterObj.id ? { ...l, used: true } : l)
    );

    if (newSelected.length === targetWord.length) {
      clearInterval(timerRef.current);
      const guess = newSelected.map(l => l.letter).join('');

      if (guess === targetWord) {
        // More remaining time = more bonus. Max bonus ~360 if done instantly
        const speedBonus = Math.floor(globalTimeLeft * (XP_SPEED_BONUS / TOTAL_ROUNDS));
        const earned = XP_PER_CORRECT + speedBonus;
        setRoundXP(earned);
        setScore(prev => prev + earned);
        setCorrectCount(prev => prev + 1);
        setRoundResult('correct');
        setShowConfetti(true);
        triggerHapticFeedback('notificationSuccess');

        // Bounce reveal animation for pet image
        Animated.spring(revealScale, {
          toValue: 1,
          tension: 40,
          friction: 5,
          useNativeDriver: true,
        }).start();

        setTimeout(() => advanceRound(true, earned), 2500);
      } else {
        setRoundResult('wrong');
        triggerHapticFeedback('notificationError');
        Animated.sequence([
          Animated.timing(shakeAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -1, duration: 50, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
        ]).start();
        setTimeout(() => advanceRound(false, 0), 2000);
      }
    }
  }, [selectedLetters, targetWord, roundResult, globalTimeLeft, shakeAnim, revealScale, triggerHapticFeedback]);

  const handleRemoveLast = useCallback(() => {
    if (roundResult !== null || selectedLetters.length === 0) return;
    triggerHapticFeedback('impactLight');
    const lastLetter = selectedLetters[selectedLetters.length - 1];
    setSelectedLetters(prev => prev.slice(0, -1));
    setScrambledLetters(prev =>
      prev.map(l => l.id === lastLetter.id ? { ...l, used: false } : l)
    );
  }, [selectedLetters, roundResult, triggerHapticFeedback]);

  const handleClearAll = useCallback(() => {
    if (roundResult !== null || selectedLetters.length === 0) return;
    triggerHapticFeedback('impactLight');
    setSelectedLetters([]);
    setScrambledLetters(prev => prev.map(l => ({ ...l, used: false })));
  }, [selectedLetters, roundResult, triggerHapticFeedback]);

  const advanceRound = useCallback((wasCorrect, earned) => {
    const nextRound = currentRound + 1;
    if (nextRound >= TOTAL_ROUNDS) {
      finishGame(wasCorrect ? score + earned : score);
    } else {
      setCurrentRound(nextRound);
      setupRound(petNames[nextRound]);
    }
  }, [currentRound, petNames, score]);

  const finishGame = async (finalScore) => {
    setPhase('result');
    const newPlays = playsToday + 1;
    setPlaysToday(newPlays);

    const isPerfect = correctCount + 1 === TOTAL_ROUNDS;
    const totalXP = finalScore + (isPerfect ? XP_PERFECT_BONUS : 0);

    try {
      const newBest = Math.max(finalScore, bestScore);
      setBestScore(newBest);

      await setDoc(doc(firestoreDB, 'games', uid), {
        lastScrambleAt: new Date(),
        lastScrambleScore: finalScore,
        scrambleBestScore: newBest,
        scramblePlaysToday: newPlays,
        scrambleMaxPlays: maxPlays,
      }, { merge: true });

      if (db && totalXP > 0) await addXP(db, uid, totalXP);
    } catch (err) {
      console.warn('[WordScramble] save error:', err?.message);
    }
  };

  const canPlayMore = playsToday < maxPlays;
  const c = getThemeColors(isDarkMode);
  const cardBg = c.bgAlt;
  const textColor = c.text;
  const subtextColor = c.textSecondary;

  const shakeInterp = shakeAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-5deg', '0deg', '5deg'],
  });

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[s.overlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.92)' : 'rgba(0,0,0,0.7)' }]}>
        <SwipeableBottomDrawer onClose={onClose} isDarkMode={isDarkMode} style={[s.modal, { backgroundColor: cardBg }]}>
          {/* Header */}
          <View style={s.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[s.headerIcon, { backgroundColor: '#F59E0B20' }]}>
                <Text style={{ fontSize: 20 }}>🔤</Text>
              </View>
              <View>
                <Text style={[s.title, { color: textColor }]}>
                  {t('word_scramble.title', { defaultValue: 'Word Scramble' })}
                </Text>
                <Text style={[s.subtitle, { color: subtextColor }]}>
                  {t('word_scramble.subtitle', { defaultValue: 'Guess the pet!' })}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={[s.closeBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}>
              <Icon name="close" size={18} color={subtextColor} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>

          {/* ═══ LOADING ═══ */}
          {phase === 'loading' && (
            <View style={s.centerContent}>
              <ActivityIndicator size="large" color="#F59E0B" />
            </View>
          )}

          {/* ═══ READY ═══ */}
          {phase === 'ready' && (
            <View style={s.centerContent}>
              <View style={s.readyHero}>
                <View style={[s.readyIconWrap, { backgroundColor: isDarkMode ? '#422006' : '#FEF3C7' }]}>
                  <Text style={{ fontSize: 48 }}>🔤</Text>
                </View>
              </View>
              <Text style={[s.readyTitle, { color: textColor }]}>
                {t('word_scramble.pet_scramble', { defaultValue: 'Pet Name Scramble!' })}
              </Text>
              <Text style={[s.readySub, { color: subtextColor }]}>
                {t('word_scramble.instructions', {
                  defaultValue: `Unscramble ${TOTAL_ROUNDS} pet names!\nUse hints when stuck. Faster = more XP ⚡`,
                })}
              </Text>

              <View style={s.statsRow}>
                {bestScore > 0 && (
                  <View style={[s.statPill, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B30' }]}>
                    <Text style={[s.statPillText, { color: '#F59E0B' }]}>🏆 Best: {bestScore}</Text>
                  </View>
                )}
                <View style={[s.statPill, { backgroundColor: '#10B98115', borderColor: '#10B98130' }]}>
                  <Text style={[s.statPillText, { color: '#10B981' }]}>
                    {maxPlays - playsToday} {t('word_scramble.plays_left', { defaultValue: 'plays left' })}
                  </Text>
                </View>
              </View>

              {petPool.length < TOTAL_ROUNDS ? (
                <View style={[s.statPill, { backgroundColor: '#EF444415', borderColor: '#EF444430', marginTop: 12 }]}>
                  <Text style={[s.statPillText, { color: '#EF4444' }]}>
                    {t('word_scramble.no_data', { defaultValue: 'Loading pet data...' })}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity style={s.primaryBtn} onPress={startGame} activeOpacity={0.85}>
                  <Icon name="play-circle" size={20} color="#fff" />
                  <Text style={s.primaryBtnText}>
                    {t('word_scramble.start', { defaultValue: 'Start Scrambling! 🔤' })}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ═══ PLAYING ═══ */}
          {phase === 'playing' && (
            <View style={{ flex: 1 }}>
              {/* Progress dots + timer */}
              <View style={s.progressRow}>
                <View style={s.dotsRow}>
                  {Array.from({ length: TOTAL_ROUNDS }).map((_, i) => (
                    <View key={i} style={[s.dot, {
                      backgroundColor: i < currentRound ? '#10B981'
                        : i === currentRound ? '#F59E0B'
                        : (isDarkMode ? '#334155' : '#e2e8f0'),
                    }]} />
                  ))}
                </View>
                <Text style={[s.roundLabel, { color: subtextColor }]}>
                  {currentRound + 1}/{TOTAL_ROUNDS}
                </Text>
                <View style={[s.timerBadge, { backgroundColor: globalTimeLeft <= 10 ? '#FEE2E2' : '#e2e8f0' }]}>
                  <Text style={[s.timerText, { color: globalTimeLeft <= 10 ? '#EF4444' : '#475569' }]}>
                    {Math.floor(globalTimeLeft / 60)}:{(globalTimeLeft % 60).toString().padStart(2, '0')}
                  </Text>
                </View>
              </View>

              {/* No timer bar for count-up mode */}

              {/* ── HINTS SECTION ── */}
              <View style={[s.hintsContainer, { backgroundColor: isDarkMode ? '#1e293b' : '#FFFBEB' }]}>
                <View style={s.hintsHeader}>
                  <Text style={[s.hintsTitle, { color: textColor }]}>💡 Hints</Text>
                  {revealedHints < hints.length && roundResult === null && (
                    <TouchableOpacity
                      style={[s.revealHintBtn, { backgroundColor: isDarkMode ? '#334155' : '#FEF3C7' }]}
                      onPress={handleRevealHint}
                      activeOpacity={0.7}
                    >
                      <Icon name="eye-outline" size={12} color="#F59E0B" />
                      <Text style={{ fontSize: 10, fontWeight: '700', color: '#F59E0B' }}>
                        {t('word_scramble.show_hint', { defaultValue: 'Show Hint' })} ({hints.length - revealedHints})
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={s.hintsRow}>
                  {hints.map((hint, i) => (
                    <View key={i} style={[s.hintChip, {
                      backgroundColor: i < revealedHints
                        ? (isDarkMode ? '#334155' : '#fff')
                        : (isDarkMode ? '#0f172a' : '#f1f5f9'),
                      borderColor: i < revealedHints ? '#F59E0B40' : 'transparent',
                    }]}>
                      {i < revealedHints ? (
                        <>
                          <Text style={{ fontSize: 12 }}>{hint.icon}</Text>
                          <View>
                            <Text style={[s.hintLabel, { color: subtextColor }]}>{hint.label}</Text>
                            <Text style={[s.hintValue, { color: textColor }]}>{hint.value}</Text>
                          </View>
                        </>
                      ) : (
                        <>
                          <Text style={{ fontSize: 12 }}>🔒</Text>
                          <Text style={[s.hintLabel, { color: subtextColor }]}>{hint.label}</Text>
                        </>
                      )}
                    </View>
                  ))}
                </View>
              </View>

              {/* ── ANSWER SLOTS ── */}
              <Animated.View style={[s.answerRow, { transform: [{ rotate: shakeInterp }] }]}>
                {targetWord.split('').map((_, i) => {
                  const filled = selectedLetters[i];
                  const isCorrect = roundResult === 'correct';
                  const isWrong = roundResult === 'wrong' || roundResult === 'timeout';
                  return (
                    <View key={i} style={[s.answerSlot, {
                      backgroundColor: isCorrect ? '#10B98120' : isWrong ? '#EF444420'
                        : filled ? (isDarkMode ? '#334155' : '#E0E7FF') : (isDarkMode ? '#1e293b' : '#f1f5f9'),
                      borderColor: isCorrect ? '#10B981' : isWrong ? '#EF4444'
                        : filled ? '#F59E0B' : (isDarkMode ? '#475569' : '#cbd5e1'),
                    }]}>
                      <Text style={[s.answerLetter, {
                        color: isCorrect ? '#10B981' : isWrong ? '#EF4444' : textColor,
                      }]}>
                        {filled ? filled.letter : ''}
                      </Text>
                    </View>
                  );
                })}
              </Animated.View>

              {/* ── SUCCESS: Pet image + confetti ── */}
              {roundResult === 'correct' && targetPet && (
                <Animated.View style={[s.successReveal, { transform: [{ scale: revealScale }] }]}>
                  {showConfetti && (
                    <SafeLottieView
                      source={require('../../assets/lottie/confetti.json')}
                      autoPlay
                      loop={false}
                      style={s.confettiOverlay}
                    />
                  )}
                  <Image
                    source={{ uri: getImageUrl(targetPet.image) }}
                    style={s.petImage}
                    resizeMode="contain"
                  />
                  <Text style={[s.successName, { color: '#10B981' }]}>{targetPet.name}</Text>
                  <Text style={[s.successXP, { color: '#F59E0B' }]}>+{roundXP} XP ⚡</Text>
                </Animated.View>
              )}

              {/* ── WRONG feedback ── */}
              {roundResult === 'wrong' && targetPet && (
                <View style={s.failReveal}>
                  <Image
                    source={{ uri: getImageUrl(targetPet.image) }}
                    style={[s.petImage, { opacity: 0.5 }]}
                    resizeMode="contain"
                  />
                  <Text style={[s.failText, { color: '#EF4444' }]}>
                    ❌ {t('word_scramble.it_was', { defaultValue: 'It was' })} {targetPet.name}
                  </Text>
                </View>
              )}

              {/* ── ACTION BUTTONS ── */}
              {!roundResult && (
                <View style={s.actionRow}>
                  <TouchableOpacity
                    style={[s.actionBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9' }]}
                    onPress={handleRemoveLast}
                    disabled={selectedLetters.length === 0}
                    activeOpacity={0.7}
                  >
                    <Icon name="backspace-outline" size={20} color={selectedLetters.length > 0 ? '#F59E0B' : subtextColor} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.actionBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9' }]}
                    onPress={handleClearAll}
                    disabled={selectedLetters.length === 0}
                    activeOpacity={0.7}
                  >
                    <Icon name="refresh" size={20} color={selectedLetters.length > 0 ? '#EF4444' : subtextColor} />
                  </TouchableOpacity>
                </View>
              )}

              {/* ── SCRAMBLED LETTER TILES ── */}
              {!roundResult && (
                <View style={s.lettersWrap}>
                  {scrambledLetters.map((letterObj) => (
                    <TouchableOpacity
                      key={letterObj.id}
                      style={[s.letterTile, {
                        backgroundColor: letterObj.used
                          ? (isDarkMode ? '#0f172a' : '#f8fafc')
                          : (isDarkMode ? '#334155' : '#fff'),
                        borderColor: letterObj.used ? 'transparent' : '#F59E0B',
                        opacity: letterObj.used ? 0.25 : 1,
                        transform: [{ scale: letterObj.used ? 0.85 : 1 }],
                      }]}
                      onPress={() => !letterObj.used && handleLetterPress(letterObj)}
                      disabled={letterObj.used || roundResult !== null}
                      activeOpacity={0.7}
                    >
                      <Text style={[s.letterText, {
                        color: letterObj.used ? subtextColor : textColor,
                      }]}>
                        {letterObj.letter}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Live score */}
              <Text style={[s.scoreLive, { color: subtextColor }]}>
                Score: {score} XP
              </Text>

              {/* 🐞 DEBUG: pet name for testing — REMOVE BEFORE RELEASE */}
              {__DEV__ && (
                <Text style={{ fontSize: 9, color: '#EF4444', textAlign: 'center', marginTop: 6, fontWeight: '700' }}>
                  🐞 Answer: {targetPet?.name}
                </Text>
              )}
            </View>
          )}

          {/* ═══ RESULT ═══ */}
          {phase === 'result' && (
            <View style={s.centerContent}>
              <Text style={{ fontSize: 48 }}>
                {correctCount === TOTAL_ROUNDS ? '🏆' : correctCount >= 3 ? '🌟' : correctCount > 0 ? '⭐' : '📝'}
              </Text>
              <Text style={[s.readyTitle, { color: textColor }]}>
                {correctCount === TOTAL_ROUNDS
                  ? t('word_scramble.result_perfect', { defaultValue: 'Perfect!' })
                  : correctCount >= 3
                  ? t('word_scramble.result_great', { defaultValue: 'Great Job!' })
                  : correctCount > 0
                  ? t('word_scramble.result_nice', { defaultValue: 'Nice Try!' })
                  : t('word_scramble.result_try', { defaultValue: 'Keep Practicing!' })}
              </Text>
              <Text style={[s.resultScore, { color: '#F59E0B' }]}>{score} XP</Text>
              <Text style={[s.readySub, { color: subtextColor }]}>
                {correctCount}/{TOTAL_ROUNDS} {t('word_scramble.correct_label', { defaultValue: 'correct' })}
              </Text>
              {bestScore > 0 && (
                <View style={[s.statPill, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B30', marginTop: 8 }]}>
                  <Text style={[s.statPillText, { color: '#F59E0B' }]}>🏆 Best: {bestScore}</Text>
                </View>
              )}

              {canPlayMore ? (
                <TouchableOpacity style={s.primaryBtn} onPress={startGame} activeOpacity={0.85}>
                  <Icon name="play-circle" size={18} color="#fff" />
                  <Text style={s.primaryBtnText}>
                    {t('word_scramble.play_again', { defaultValue: `Play Again (${maxPlays - playsToday} left)` })}
                  </Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={[s.primaryBtn, { backgroundColor: isDarkMode ? '#334155' : '#94a3b8' }]}
                    onPress={onClose}
                    activeOpacity={0.85}
                  >
                    <Text style={s.primaryBtnText}>
                      {t('word_scramble.come_back', { defaultValue: 'Come Back Tomorrow!' })}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.primaryBtn, { backgroundColor: '#F59E0B', marginTop: 8 }]}
                    onPress={handleWatchAd}
                    disabled={adLoading}
                    activeOpacity={0.85}
                  >
                    <Icon name={adLoading ? 'hourglass' : 'videocam'} size={18} color="#fff" />
                    <Text style={s.primaryBtnText}>
                      {adLoading
                        ? t('word_scramble.loading_ad', { defaultValue: 'Loading...' })
                        : t('word_scramble.watch_ad', { defaultValue: `📺 Watch Ad for ${AD_UNLOCK_COUNT} More Games` })}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          </ScrollView>
        </SwipeableBottomDrawer>
      </View>
    </Modal>
  );
};

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  modal: {
    width: '100%', padding: 20, maxHeight: '92%',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.25, shadowRadius: 16 },
      android: { elevation: 16 },
    }),
  },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  headerIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  centerContent: { alignItems: 'center', paddingVertical: 16 },

  // Ready
  readyHero: { marginBottom: 12 },
  readyIconWrap: { width: 90, height: 90, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  readyTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  readySub: { fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18, paddingHorizontal: 16 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, justifyContent: 'center' },
  statPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1,
  },
  statPillText: { fontSize: 11, fontWeight: '700' },
  resultScore: { fontSize: 36, fontWeight: '800', marginTop: 4 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F59E0B', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 16, marginTop: 18,
    shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // Progress
  progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
  dotsRow: { flexDirection: 'row', gap: 5, flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  roundLabel: { fontSize: 11, fontWeight: '700' },
  timerBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  timerText: { fontSize: 13, fontWeight: '800' },
  timerBar: { height: 4, borderRadius: 2, marginBottom: 10 },

  // Hints
  hintsContainer: { borderRadius: 14, padding: 10, marginBottom: 12 },
  hintsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  hintsTitle: { fontSize: 13, fontWeight: '800' },
  revealHintBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  hintsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hintChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
  },
  hintLabel: { fontSize: 9, fontWeight: '600' },
  hintValue: { fontSize: 11, fontWeight: '800' },

  // Answer row
  answerRow: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 5,
    marginBottom: 10, paddingHorizontal: 4,
  },
  answerSlot: {
    width: 34, height: 42, borderRadius: 10, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  answerLetter: { fontSize: 17, fontWeight: '800' },

  // Success reveal
  successReveal: { alignItems: 'center', marginBottom: 10, position: 'relative' },
  petImage: { width: 80, height: 80, borderRadius: 16 },
  successName: { fontSize: 16, fontWeight: '800', marginTop: 6 },
  successXP: { fontSize: 14, fontWeight: '800', marginTop: 2 },
  confettiOverlay: {
    position: 'absolute', width: 250, height: 250, top: -80, zIndex: 10,
  },

  // Fail reveal
  failReveal: { alignItems: 'center', marginBottom: 10 },
  failText: { fontSize: 13, fontWeight: '700', marginTop: 6 },

  // Action buttons
  actionRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 12 },
  actionBtn: {
    width: 48, height: 48, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },

  // Letter tiles
  lettersWrap: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8,
    paddingHorizontal: 8, marginBottom: 12,
  },
  letterTile: {
    width: 46, height: 50, borderRadius: 14, borderWidth: 2.5,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 5, elevation: 3,
  },
  letterText: { fontSize: 20, fontWeight: '800' },

  scoreLive: { fontSize: 12, textAlign: 'center', fontWeight: '700', marginTop: 4 },
});

export default WordScramble;
