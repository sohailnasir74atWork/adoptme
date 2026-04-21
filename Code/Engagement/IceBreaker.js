/**
 * IceBreaker.js
 * "Who's That Pet?" — Frozen pet reveal game.
 *
 * A pet image is "frozen" (heavily blurred). Tap rapidly to crack the ice
 * and reveal the pet. Then guess the name from 4 options.
 *
 * Scoring: Speed × Correct answer = XP reward
 * Limits: 2 free games/day (watch ad for extra)
 * State: Firestore games/{uid} → lastIceBreakerAt, iceBreakerPlaysToday, iceBreakerBestTime
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
import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import { addXP } from './xpUtils';
import RewardedAdManager from '../Ads/RewardedAdManager';
import { fetchAnalyticsData, normalizeName } from '../Helper/analyticsDataHelper';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const ICE_SIZE = Math.min(SCREEN_WIDTH - 80, 220);
const TAPS_TO_REVEAL = 18;

// ── Ice crack stages ──
const CRACK_STAGES = [
  { label: '🧊 Frozen Solid', color: '#93C5FD' },
  { label: '💧 Hairline Crack', color: '#60A5FA' },
  { label: '🔨 Cracking...', color: '#3B82F6' },
  { label: '💥 Breaking!', color: '#2563EB' },
  { label: '✨ Almost There!', color: '#10B981' },
  { label: '🎉 Revealed!', color: '#10B981' },
];

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

// ── Floating ice chip particles ──
const IceChip = ({ x, y }) => {
  const anim = useRef(new Animated.Value(0)).current;
  const dx = useRef((Math.random() - 0.5) * 60).current;
  const dy = useRef(-20 - Math.random() * 40).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();
  }, []);

  const emoji = ['❄️', '🧊', '💎', '✨', '💠'][Math.floor(Math.random() * 5)];

  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left: x, top: y,
        fontSize: 14,
        opacity: anim.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0.7, 0] }),
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
          { translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
          { rotate: anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${(Math.random() - 0.5) * 180}deg`] }) },
          { scale: anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.5, 1.2, 0.3] }) },
        ],
      }}
    >
      {emoji}
    </Animated.Text>
  );
};

// ── Pulsing ring behind the ice block ──
const PulsingRing = ({ size, color }) => {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{
      position: 'absolute',
      width: size + 20, height: size + 20,
      borderRadius: (size + 20) / 2,
      borderWidth: 2,
      borderColor: color,
      opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.5] }),
      transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] }) }],
    }} />
  );
};

const IceBreaker = ({ visible, onClose }) => {
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
        if (demanded.length >= 4) return demanded;
      }
      return pets.length >= 4 ? pets : [];
    } catch { return []; }
  }, [localState.data, demandMap]);

  const getImageUrl = useCallback((imageField) => {
    const base = (localState?.imgurl || '').replace(/"/g, '').replace(/\/$/, '');
    if (!base || !imageField) return '';
    return `${base}/${imageField.replace(/^\//, '')}`;
  }, [localState?.imgurl]);

  // State
  const [phase, setPhase] = useState('loading');
  const [targetPet, setTargetPet] = useState(null);
  const [options, setOptions] = useState([]);
  const [tapCount, setTapCount] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [revealTime, setRevealTime] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [isCorrect, setIsCorrect] = useState(false);
  const [playsToday, setPlaysToday] = useState(0);
  const [bestTime, setBestTime] = useState(0);
  const [streak, setStreak] = useState(0);
  const [chips, setChips] = useState([]);
  const [adLoading, setAdLoading] = useState(false);
  const [hasWatchedAd, setHasWatchedAd] = useState(false);
  const [round, setRound] = useState(0);

  // Animations
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const revealGlow = useRef(new Animated.Value(0)).current;
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;
  const optionAnims = useRef([0, 1, 2, 3].map(() => new Animated.Value(0))).current;

  const MAX_PLAYS = 1;
  const c = getThemeColors(isDarkMode);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled('icebreaker'));

  useEffect(() => {
    if (!visible) return;
    initGameSounds();
    return () => releaseGameSounds();
  }, [visible]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled('icebreaker', next);
    triggerHapticFeedback('selection');
  };

  // Current crack stage
  const crackStage = useMemo(() => {
    const progress = Math.min(tapCount / TAPS_TO_REVEAL, 1);
    const idx = Math.min(Math.floor(progress * (CRACK_STAGES.length - 1)), CRACK_STAGES.length - 1);
    return CRACK_STAGES[idx];
  }, [tapCount]);

  const currentBlur = useMemo(() => {
    const progress = Math.min(tapCount / TAPS_TO_REVEAL, 1);
    return Math.round(20 * (1 - progress));
  }, [tapCount]);

  // Load state
  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists() ? snap.data() : {};
        const today = isSameDay(data.lastIceBreakerAt);
        const plays = today ? (data.iceBreakerPlaysToday || 0) : 0;
        setPlaysToday(plays);
        setBestTime(data.iceBreakerBestTime || 0);
        setStreak(data.iceBreakerStreak || 0);
        setHasWatchedAd(isSameDay(data.lastIceBreakerAdAt));
        setPhase(plays >= MAX_PLAYS ? 'result' : 'ready');
      } catch {
        setPhase('ready');
      }
    })();
  }, [visible, firestoreDB, uid]);

  const handleWatchAd = async () => {
    if (adLoading) return;
    setAdLoading(true);
    const earned = await RewardedAdManager.show();
    setAdLoading(false);
    if (earned) {
      setPlaysToday(prev => Math.max(0, prev - 2));
      setPhase('ready');
      setHasWatchedAd(true);
      if (firestoreDB && uid) {
        setDoc(doc(firestoreDB, 'games', uid), { lastIceBreakerAdAt: new Date() }, { merge: true }).catch(() => {});
      }
    }
  };

  // Start new round
  const startGame = useCallback(() => {
    if (petPool.length < 4) return;

    const shuffled = shuffle(petPool);
    const target = shuffled[0];
    const wrongs = shuffled.slice(1, 4);
    const allOptions = shuffle([target, ...wrongs]);

    setTargetPet(target);
    setOptions(allOptions);
    setTapCount(0);
    setSelectedAnswer(null);
    setIsCorrect(false);
    setChips([]);
    shakeAnim.setValue(0);
    scaleAnim.setValue(1);
    progressAnim.setValue(0);
    revealGlow.setValue(0);
    bounceAnim.setValue(0);
    fadeIn.setValue(0);
    optionAnims.forEach(a => a.setValue(0));
    setStartTime(Date.now());
    setRevealTime(0);
    setRound(prev => prev + 1);
    setPhase('tapping');

    // Fade in entrance
    Animated.spring(fadeIn, {
      toValue: 1,
      tension: 50,
      friction: 8,
      useNativeDriver: true,
    }).start();
  }, [petPool]);

  // Handle tapping
  const handleTap = useCallback(() => {
    if (phase !== 'tapping') return;

    const newCount = tapCount + 1;
    setTapCount(newCount);

    // Haptic
    triggerHapticFeedback('impactLight');
    playPop('icebreaker');

    // Shake animation — more dramatic as we get closer
    const intensity = 2 + (newCount / TAPS_TO_REVEAL) * 6;
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 1, duration: 25, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -1, duration: 25, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 25, useNativeDriver: true }),
    ]).start();

    // Scale pulse — gets bigger as closer to reveal
    const pulseScale = 0.95 - (newCount / TAPS_TO_REVEAL) * 0.03;
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: pulseScale, duration: 40, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 200, friction: 5, useNativeDriver: true }),
    ]).start();

    // Progress bar
    Animated.timing(progressAnim, {
      toValue: Math.min(newCount / TAPS_TO_REVEAL, 1),
      duration: 100,
      useNativeDriver: false,
    }).start();

    // Ice chips — every 2 taps
    if (newCount % 2 === 0) {
      setChips(prev => [...prev, {
        id: Date.now() + Math.random(),
        x: Math.random() * (ICE_SIZE - 20),
        y: Math.random() * (ICE_SIZE - 20),
      }]);
    }

    // Fully revealed
    if (newCount >= TAPS_TO_REVEAL) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      setRevealTime(parseFloat(elapsed));
      triggerHapticFeedback('notificationSuccess');
      playWoosh('icebreaker');
      setPhase('guessing');

      // Glow reveal
      Animated.spring(revealGlow, {
        toValue: 1,
        tension: 40,
        friction: 6,
        useNativeDriver: true,
      }).start();

      // Stagger in answer options
      Animated.stagger(80, optionAnims.map(a =>
        Animated.spring(a, { toValue: 1, tension: 80, friction: 8, useNativeDriver: true })
      )).start();
    }
  }, [phase, tapCount, startTime, shakeAnim, scaleAnim, progressAnim, revealGlow, optionAnims]);

  // Handle answer
  const handleAnswer = useCallback(async (pet) => {
    if (selectedAnswer) return;
    setSelectedAnswer(pet.name);
    const correct = pet.name === targetPet.name;
    setIsCorrect(correct);

    Animated.spring(bounceAnim, {
      toValue: 1,
      tension: 50,
      friction: 5,
      useNativeDriver: true,
    }).start();

    if (correct) {
      triggerHapticFeedback('notificationSuccess');
      playWoosh('icebreaker');
    } else {
      triggerHapticFeedback('notificationError');
      playPop('icebreaker');
    }

    setTimeout(() => finishGame(correct), 1200);
  }, [selectedAnswer, targetPet]);

  const finishGame = async (correct) => {
    setPhase('result');
    const newPlays = playsToday + 1;
    setPlaysToday(newPlays);

    const newStreak = correct ? streak + 1 : 0;
    setStreak(newStreak);

    const speedBonus = Math.max(0, Math.floor((10 - revealTime) * 3));
    const xpEarned = correct
      ? 15 + speedBonus + 20 + Math.min(newStreak * 5, 25)
      : 10;

    try {
      const newBest = correct
        ? (bestTime === 0 ? revealTime : Math.min(revealTime, bestTime))
        : bestTime;
      setBestTime(newBest);

      await setDoc(doc(firestoreDB, 'games', uid), {
        lastIceBreakerAt: new Date(),
        iceBreakerPlaysToday: newPlays,
        iceBreakerBestTime: newBest,
        iceBreakerStreak: newStreak,
      }, { merge: true });

      if (appdatabase) await addXP(appdatabase, uid, xpEarned);
    } catch (err) {
      console.warn('[IceBreaker] save error:', err?.message);
    }
  };

  const canPlayMore = playsToday < MAX_PLAYS;

  const shakeInterp = shakeAnim.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ['-5deg', '0deg', '5deg'],
  });

  const xpEarned = isCorrect
    ? 15 + Math.max(0, Math.floor((10 - revealTime) * 3)) + 20 + Math.min(streak * 5, 25)
    : 10;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[s.overlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.92)' : 'rgba(0,0,0,0.5)' }]}>
        <SwipeableBottomDrawer onClose={onClose} isDarkMode={isDarkMode} style={[s.modal, { backgroundColor: isDarkMode ? '#0f172a' : '#f0f9ff' }]}>
          {/* ═══ HEADER ═══ */}
          <View style={s.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[s.headerIcon, { backgroundColor: '#0EA5E920' }]}>
                <Text style={{ fontSize: 20 }}>🧊</Text>
              </View>
              <View>
                <Text style={[s.title, { color: c.text }]}>Ice Breaker</Text>
                <Text style={[s.subtitle, { color: c.textSecondary }]}>Who's That Pet?</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <TouchableOpacity onPress={toggleSound} style={[s.closeBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}>
                <Icon name={soundOn ? 'volume-high' : 'volume-mute'} size={16} color={c.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => {
                setPhase('loading');
                setTargetPet(null);
                setChips([]);
                onClose();
              }} style={[s.closeBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}>
                <Icon name="close" size={18} color={c.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ═══ READY PHASE ═══ */}
          {phase === 'ready' && (
            <View style={s.centerContent}>
              {/* Hero visual */}
              <View style={s.readyHero}>
                <View style={[s.readyIceWrap, { backgroundColor: isDarkMode ? '#1e3a5f' : '#dbeafe' }]}>
                  <Text style={{ fontSize: 56 }}>🧊</Text>
                  <View style={s.readyQuestionMark}>
                    <Text style={{ fontSize: 20, color: '#fff', fontWeight: '900' }}>?</Text>
                  </View>
                </View>
              </View>

              <Text style={[s.readyTitle, { color: c.text }]}>Crack the Ice!</Text>
              <Text style={[s.readySub, { color: c.textSecondary }]}>
                Tap rapidly to break the ice and reveal{'\n'}the hidden pet. Then guess its name!
              </Text>

              {/* Stats row */}
              <View style={s.statsRow}>
                {streak > 0 && (
                  <View style={[s.statPill, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B30' }]}>
                    <Text style={[s.statPillText, { color: '#F59E0B' }]}>🔥 {streak} streak</Text>
                  </View>
                )}
                {bestTime > 0 && (
                  <View style={[s.statPill, { backgroundColor: '#3B82F615', borderColor: '#3B82F630' }]}>
                    <Text style={[s.statPillText, { color: '#3B82F6' }]}>⚡ Best: {bestTime}s</Text>
                  </View>
                )}
                <View style={[s.statPill, { backgroundColor: '#10B98115', borderColor: '#10B98130' }]}>
                  <Text style={[s.statPillText, { color: '#10B981' }]}>{MAX_PLAYS - playsToday} plays left</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[s.primaryBtn, petPool.length < 4 && { opacity: 0.5 }]}
                onPress={startGame}
                disabled={petPool.length < 4}
                activeOpacity={0.85}
              >
                <Icon name="snow" size={18} color="#fff" />
                <Text style={s.primaryBtnText}>
                  {petPool.length < 4 ? 'Loading Pets...' : 'Start Breaking! 🔨'}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ═══ TAPPING + GUESSING PHASE ═══ */}
          {(phase === 'tapping' || phase === 'guessing') && targetPet && (
            <Animated.View style={[s.centerContent, {
              opacity: fadeIn,
              transform: [{ translateY: fadeIn.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }],
            }]}>
              {/* Progress bar */}
              <View style={s.progressWrap}>
                <View style={s.progressLabelRow}>
                  <Text style={[s.progressLabel, { color: crackStage.color }]}>
                    {crackStage.label}
                  </Text>
                  <Text style={[s.tapCount, { color: c.textSecondary }]}>
                    {Math.min(tapCount, TAPS_TO_REVEAL)}/{TAPS_TO_REVEAL}
                  </Text>
                </View>
                <View style={[s.progressBar, { backgroundColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}>
                  <Animated.View style={[
                    s.progressFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                      backgroundColor: crackStage.color,
                    },
                  ]} />
                </View>
              </View>

              {/* Ice block */}
              <TouchableOpacity
                activeOpacity={0.95}
                onPress={handleTap}
                disabled={phase !== 'tapping'}
                style={{ alignItems: 'center', justifyContent: 'center' }}
              >
                {/* Pulsing ring behind */}
                <PulsingRing size={ICE_SIZE} color={crackStage.color} />

                <Animated.View style={[
                  s.iceBlock,
                  {
                    backgroundColor: isDarkMode ? '#0c2d4a' : '#bfdbfe',
                    borderColor: phase === 'guessing' ? '#10B981' : crackStage.color,
                    shadowColor: crackStage.color,
                    transform: [
                      { rotate: shakeInterp },
                      { scale: scaleAnim },
                    ],
                  },
                ]}>
                  {/* Pet image */}
                  <Image
                    source={{ uri: getImageUrl(targetPet.image) }}
                    style={s.petImage}
                    blurRadius={phase === 'guessing' ? 0 : currentBlur}
                    resizeMode="contain"
                  />

                  {/* Ice overlay */}
                  {phase === 'tapping' && (
                    <View style={[s.iceOverlay, {
                      opacity: 1 - (tapCount / TAPS_TO_REVEAL) * 0.9,
                      backgroundColor: isDarkMode ? 'rgba(30, 58, 95, 0.4)' : 'rgba(147, 197, 253, 0.35)',
                    }]}>
                      <Text style={s.frostText}>
                        {tapCount < 6 ? '❄️❄️❄️' : tapCount < 12 ? '💧❄️💧' : '✨💧✨'}
                      </Text>
                    </View>
                  )}

                  {/* Ice chips */}
                  {chips.slice(-8).map(chip => (
                    <IceChip key={chip.id} x={chip.x} y={chip.y} />
                  ))}

                  {/* Reveal glow */}
                  {phase === 'guessing' && (
                    <Animated.View style={[s.revealGlow, {
                      opacity: revealGlow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.15] }),
                      backgroundColor: '#10B981',
                    }]} />
                  )}
                </Animated.View>
              </TouchableOpacity>

              {/* Tap instruction */}
              {phase === 'tapping' && (
                <View style={s.tapHintWrap}>
                  <Text style={[s.tapHint, { color: c.textSecondary }]}>👆 Tap to crack!</Text>
                </View>
              )}

              {/* Timer badge after reveal */}
              {phase === 'guessing' && (
                <View style={s.timerBadge}>
                  <Icon name="timer-outline" size={14} color="#10B981" />
                  <Text style={s.timerText}>{revealTime}s</Text>
                </View>
              )}

              {/* Answer options */}
              {phase === 'guessing' && (
                <View style={s.optionsWrap}>
                  <Text style={[s.guessLabel, { color: c.text }]}>Who's this pet? 🤔</Text>
                  <View style={s.optionsGrid}>
                  {options.map((pet, i) => {
                    const isSelected = selectedAnswer === pet.name;
                    const isRight = pet.name === targetPet.name;
                    const showResult = selectedAnswer !== null;
                    const letters = ['A', 'B', 'C', 'D'];

                    let bg = isDarkMode ? '#1e293b' : '#fff';
                    let border = isDarkMode ? '#334155' : '#e2e8f0';
                    let textCol = c.text;

                    if (showResult && isRight) {
                      bg = '#10B98118';
                      border = '#10B981';
                      textCol = '#10B981';
                    } else if (showResult && isSelected && !isRight) {
                      bg = '#EF444418';
                      border = '#EF4444';
                      textCol = '#EF4444';
                    }

                    return (
                      <Animated.View
                        key={`${round}-${i}`}
                        style={[s.optionGridItem, {
                          opacity: optionAnims[i],
                          transform: [{ translateY: optionAnims[i].interpolate({ inputRange: [0, 1], outputRange: [15, 0] }) }],
                        }]}
                      >
                        <TouchableOpacity
                          style={[s.optionBtn, { backgroundColor: bg, borderColor: border }]}
                          onPress={() => handleAnswer(pet)}
                          disabled={selectedAnswer !== null}
                          activeOpacity={0.85}
                        >
                          <View style={[s.optionLetter, { backgroundColor: border + '30' }]}>
                            <Text style={[s.optionLetterText, { color: textCol }]}>
                              {showResult && isRight ? '✓' : showResult && isSelected ? '✗' : letters[i]}
                            </Text>
                          </View>
                          <Text style={[s.optionText, { color: textCol }]} numberOfLines={2}>
                            {pet.name}
                          </Text>
                        </TouchableOpacity>
                      </Animated.View>
                    );
                  })}
                  </View>
                </View>
              )}
            </Animated.View>
          )}

          {/* ═══ RESULT PHASE ═══ */}
          {phase === 'result' && (
            <View style={s.centerContent}>
              <Animated.View style={{
                transform: [{
                  scale: bounceAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
                }],
              }}>
                <View style={[s.resultEmoji, {
                  backgroundColor: isCorrect ? '#10B98115' : selectedAnswer ? '#EF444415' : '#0EA5E915',
                }]}>
                  <Text style={{ fontSize: 44 }}>
                    {isCorrect ? '🎉' : selectedAnswer ? '😅' : '🧊'}
                  </Text>
                </View>
              </Animated.View>

              <Text style={[s.readyTitle, { color: c.text }]}>
                {isCorrect ? 'Correct!' : selectedAnswer ? 'Not Quite!' : 'Ice Breaker'}
              </Text>

              {selectedAnswer && (
                <View style={{ alignItems: 'center', gap: 6, marginTop: 4 }}>
                  {isCorrect && (
                    <>
                      <View style={[s.statPill, { backgroundColor: '#3B82F615', borderColor: '#3B82F630' }]}>
                        <Text style={[s.statPillText, { color: '#3B82F6' }]}>⚡ {revealTime}s reveal</Text>
                      </View>
                      {streak > 1 && (
                        <View style={[s.statPill, { backgroundColor: '#F59E0B15', borderColor: '#F59E0B30' }]}>
                          <Text style={[s.statPillText, { color: '#F59E0B' }]}>🔥 {streak} streak!</Text>
                        </View>
                      )}
                    </>
                  )}
                  {!isCorrect && targetPet && (
                    <Text style={[s.readySub, { color: c.textSecondary }]}>
                      It was <Text style={{ fontWeight: '800', color: c.text }}>{targetPet.name}</Text>!
                    </Text>
                  )}
                  <View style={[s.xpBadge, { backgroundColor: '#10B98115' }]}>
                    <Text style={{ fontSize: 10 }}>⭐</Text>
                    <Text style={[s.xpBadgeText, { color: '#10B981' }]}>+{xpEarned} XP</Text>
                  </View>
                </View>
              )}

              {bestTime > 0 && (
                <Text style={[s.bestText, { color: '#F59E0B' }]}>
                  ⚡ Personal best: {bestTime}s
                </Text>
              )}

              {canPlayMore ? (
                <TouchableOpacity style={s.primaryBtn} onPress={startGame} activeOpacity={0.85}>
                  <Icon name="snow" size={16} color="#fff" />
                  <Text style={s.primaryBtnText}>
                    Play Again ({MAX_PLAYS - playsToday} left)
                  </Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={[s.primaryBtn, { backgroundColor: isDarkMode ? '#334155' : '#94a3b8' }]}
                    onPress={onClose}
                    activeOpacity={0.85}
                  >
                    <Text style={s.primaryBtnText}>Come Back Tomorrow!</Text>
                  </TouchableOpacity>
                  {!hasWatchedAd && (
                    <TouchableOpacity
                      style={[s.primaryBtn, { backgroundColor: '#F59E0B', marginTop: 8 }]}
                      onPress={handleWatchAd}
                      disabled={adLoading}
                      activeOpacity={0.85}
                    >
                      <Icon name={adLoading ? 'hourglass' : 'videocam'} size={18} color="#fff" />
                      <Text style={s.primaryBtnText}>
                        {adLoading ? 'Loading...' : '📺 Watch Ad for 2 More'}
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

  centerContent: { alignItems: 'center', paddingVertical: 8 },

  // Ready phase
  readyHero: { marginBottom: 16 },
  readyIceWrap: {
    width: 100, height: 100, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
  },
  readyQuestionMark: {
    position: 'absolute', bottom: -4, right: -4,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: '#f0f9ff',
  },
  readyTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  readySub: { fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 18, paddingHorizontal: 16 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, justifyContent: 'center' },
  statPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
    borderWidth: 1,
  },
  statPillText: { fontSize: 11, fontWeight: '700' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0EA5E9', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 16, marginTop: 18,
    shadowColor: '#0EA5E9', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // Tapping phase
  progressWrap: { width: '100%', marginBottom: 14, paddingHorizontal: 4 },
  progressLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  progressLabel: { fontSize: 12, fontWeight: '800' },
  tapCount: { fontSize: 11, fontWeight: '600' },
  progressBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },

  iceBlock: {
    width: ICE_SIZE, height: ICE_SIZE,
    borderRadius: 28, borderWidth: 3,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', position: 'relative',
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  petImage: {
    width: ICE_SIZE - 24, height: ICE_SIZE - 24,
  },
  iceOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 28,
  },
  frostText: { fontSize: 24, opacity: 0.5 },
  revealGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
  },

  tapHintWrap: { marginTop: 10 },
  tapHint: { fontSize: 13, fontWeight: '700' },

  timerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#10B98112', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5, marginTop: 10,
    borderWidth: 1, borderColor: '#10B98125',
  },
  timerText: { color: '#10B981', fontSize: 14, fontWeight: '800' },

  // Options — 2×2 grid
  optionsWrap: { width: '100%', marginTop: 14 },
  guessLabel: { fontSize: 15, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionGridItem: { width: '48%' },
  optionBtn: {
    flexDirection: 'column', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 8, borderRadius: 14,
    borderWidth: 2, minHeight: 70, justifyContent: 'center',
  },
  optionLetter: {
    width: 24, height: 24, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  optionLetterText: { fontSize: 11, fontWeight: '800' },
  optionText: { fontSize: 12, fontWeight: '700', textAlign: 'center' },

  // Result
  resultEmoji: {
    width: 80, height: 80, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  xpBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
  },
  xpBadgeText: { fontSize: 12, fontWeight: '800' },
  bestText: { fontSize: 12, fontWeight: '700', marginTop: 8 },
});

export default IceBreaker;
