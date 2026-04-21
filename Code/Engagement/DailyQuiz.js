/**
 * DailyQuiz.js
 * Daily pet trivia quiz — 5 questions, 10s timer, XP rewards.
 *
 * State: Firestore games/{uid} → lastQuizAt, quizBestScore, quizStreak
 * XP: +20 per correct, +50 bonus for 5/5 perfect
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { initGameSounds, releaseGameSounds, playPop, playWoosh, isSoundEnabled, setSoundEnabled } from '../Helper/GameSoundService';
import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import { addXP } from './xpUtils';
import RewardedAdManager from '../Ads/RewardedAdManager';
import { incrementAndCheckBadge, QUIZ_BADGE_THRESHOLDS } from '../ChatScreen/GroupChat/badgeUtils';

// ── Question bank (shuffled + pick 5 each time) ──
const QUESTION_BANK = [
  { q: 'Which egg is the Shadow Dragon from?', a: 'Halloween Egg', opts: ['Halloween Egg', 'Ocean Egg', 'Safari Egg', 'Royal Egg'] },
  { q: 'What rarity is the Frost Dragon?', a: 'Legendary', opts: ['Legendary', 'Ultra-Rare', 'Rare', 'Common'] },
  { q: 'Which pet comes from the Aussie Egg?', a: 'Kangaroo', opts: ['Kangaroo', 'Monkey', 'Giraffe', 'Parrot'] },
  { q: 'What type of pet is a Neon pet?', a: 'A pet with glowing parts', opts: ['A pet with glowing parts', 'A flying pet', 'A rare egg pet', 'A robotic pet'] },
  { q: 'How many pets do you need to make a Mega Neon?', a: '4 Neon pets', opts: ['4 Neon pets', '2 Neon pets', '6 Neon pets', '8 Neon pets'] },
  { q: 'Which egg had the Owl?', a: 'Farm Egg', opts: ['Farm Egg', 'Jungle Egg', 'Safari Egg', 'Christmas Egg'] },
  { q: 'What is the rarest pet type in Adopt Me?', a: 'Mega Neon Legendary', opts: ['Mega Neon Legendary', 'Neon Ultra-Rare', 'Fly Ride Common', 'Mega Neon Rare'] },
  { q: 'Which egg costs the most Bucks?', a: 'Royal Egg', opts: ['Royal Egg', 'Pet Egg', 'Cracked Egg', 'Safari Egg'] },
  { q: 'What does "FR" stand for?', a: 'Fly Ride', opts: ['Fly Ride', 'Frost Rare', 'Free Roam', 'Full Rarity'] },
  { q: 'Where was the Monkey King from?', a: 'Monkey Fairground', opts: ['Monkey Fairground', 'Star Rewards', 'Robux Shop', 'Halloween Event'] },
  { q: 'Which pet has the highest demand in 2024?', a: 'Shadow Dragon', opts: ['Shadow Dragon', 'Unicorn', 'Dragon', 'Griffin'] },
  { q: 'How many tasks to grow a pet to Full Grown?', a: '6 stages', opts: ['6 stages', '4 stages', '8 stages', '3 stages'] },
  { q: 'What can you do with 4 Full Grown pets?', a: 'Make a Neon', opts: ['Make a Neon', 'Trade for Legendary', 'Unlock new egg', 'Get Fly potion'] },
  { q: 'Which egg had the Giraffe?', a: 'Safari Egg', opts: ['Safari Egg', 'Jungle Egg', 'Farm Egg', 'Aussie Egg'] },
  { q: 'What does "NFR" mean?', a: 'Neon Fly Ride', opts: ['Neon Fly Ride', 'Not For Resale', 'New Frost Rare', 'Neon Full Rarity'] },
  { q: 'Which event gave the Evil Unicorn?', a: 'Halloween 2019', opts: ['Halloween 2019', 'Christmas 2020', 'Easter 2021', 'Summer 2022'] },
  { q: 'What pet comes from the Christmas Egg?', a: 'Arctic Reindeer', opts: ['Arctic Reindeer', 'Snow Owl', 'Frost Dragon', 'Penguin'] },
  { q: 'How do you get a Diamond pet?', a: 'Golden/Diamond Egg from Star Rewards', opts: ['Golden/Diamond Egg from Star Rewards', 'Buy with Robux', 'Trade only', 'Special event'] },
  { q: 'What is the "Bat Dragon" from?', a: 'Halloween 2019', opts: ['Halloween 2019', 'Halloween 2020', 'Candy store', 'Star Rewards'] },
  { q: 'Which pet is considered the best common?', a: 'Cat', opts: ['Cat', 'Dog', 'Buffalo', 'Otter'] },
];

const TIMER_SECONDS = 12;
const XP_PER_CORRECT = 20;
const XP_PERFECT_BONUS = 50;

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

const DailyQuiz = ({ visible, onClose }) => {
  const { firestoreDB, db, user, theme } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';
  const uid = user?.id;

  const [phase, setPhase] = useState('loading'); // loading | ready | playing | result
  const [hasPlayedToday, setHasPlayedToday] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState(null);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS);
  const [bestScore, setBestScore] = useState(0);
  const timerRef = useRef(null);
  const progressAnim = useRef(new Animated.Value(1)).current;
  const [adLoading, setAdLoading] = useState(false);
  const [hasWatchedAd, setHasWatchedAd] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled('quiz'));

  useEffect(() => {
    if (!visible) return;
    initGameSounds();
    return () => releaseGameSounds();
  }, [visible]);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEnabled('quiz', next);
    triggerHapticFeedback('selection');
  };

  // Watch ad for extra quiz play
  const handleWatchAd = async () => {
    if (adLoading) return;
    setAdLoading(true);
    const earned = await RewardedAdManager.show();
    setAdLoading(false);
    if (earned) {
      setHasPlayedToday(false);
      setPhase('ready');
      setScore(0);
      setCurrentQ(0);
      setSelected(null);
      setHasWatchedAd(true);
      // Persist to Firestore
      if (firestoreDB && uid) {
        setDoc(doc(firestoreDB, 'games', uid), { lastQuizAdAt: new Date() }, { merge: true }).catch(() => {});
      }
    }
  };

  // Load state on open
  useEffect(() => {
    if (!visible || !firestoreDB || !uid) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', uid));
        const data = snap.exists() ? snap.data() : {};
        const played = isSameDay(data.lastQuizAt);
        setHasPlayedToday(played);
        setBestScore(data.quizBestScore || 0);
        setHasWatchedAd(isSameDay(data.lastQuizAdAt)); // persist ad limit per day
        setPhase(played ? 'result' : 'ready');
        setScore(played ? (data.lastQuizScore || 0) : 0);
        setCurrentQ(0);
        setSelected(null);
      } catch {
        setPhase('ready');
      }
    })();
  }, [visible, firestoreDB, uid]);

  // Start quiz
  const startQuiz = () => {
    const picked = shuffle(QUESTION_BANK).slice(0, 5).map(q => ({
      ...q,
      opts: shuffle(q.opts),
    }));
    setQuestions(picked);
    setCurrentQ(0);
    setScore(0);
    setSelected(null);
    setTimeLeft(TIMER_SECONDS);
    setPhase('playing');
    triggerHapticFeedback('impactLight');
    playWoosh('quiz');
  };

  // Timer countdown
  useEffect(() => {
    if (phase !== 'playing' || selected !== null) return;

    progressAnim.setValue(1);
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: TIMER_SECONDS * 1000,
      useNativeDriver: false,
    }).start();

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          handleAnswer(null); // Time's up
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [phase, currentQ, selected]);

  const handleAnswer = useCallback((answer) => {
    if (selected !== null) return;
    clearInterval(timerRef.current);

    const correct = answer === questions[currentQ]?.a;
    setSelected(answer || '__timeout__');
    if (correct) {
      setScore(prev => prev + 1);
      triggerHapticFeedback('notificationSuccess');
      playWoosh('quiz');
    } else {
      triggerHapticFeedback('notificationError');
      playPop('quiz');
    }

    // Move to next question after 1.5s
    setTimeout(() => {
      if (currentQ < questions.length - 1) {
        setCurrentQ(prev => prev + 1);
        setSelected(null);
        setTimeLeft(TIMER_SECONDS);
      } else {
        finishQuiz(correct ? score + 1 : score);
      }
    }, 1200);
  }, [selected, currentQ, questions, score]);

  const finishQuiz = async (finalScore) => {
    setPhase('result');
    setHasPlayedToday(true);

    const xpEarned = (finalScore * XP_PER_CORRECT) + (finalScore === 5 ? XP_PERFECT_BONUS : 0);

    try {
      const newBest = Math.max(finalScore, bestScore);
      setBestScore(newBest);

      await setDoc(doc(firestoreDB, 'games', uid), {
        lastQuizAt: new Date(),
        lastQuizScore: finalScore,
        quizBestScore: newBest,
      }, { merge: true });

      if (db && xpEarned > 0) await addXP(db, uid, xpEarned);

      // 🏅 Track correct answers for quizMaster badge (50+ correct)
      if (db && uid && finalScore > 0) {
        for (let i = 0; i < finalScore; i++) {
          incrementAndCheckBadge(db, uid, 'quizCorrectCount', QUIZ_BADGE_THRESHOLDS);
        }
      }
    } catch (err) {
      console.warn('[DailyQuiz] save error:', err?.message);
    }
  };

  const q = questions[currentQ];
  const c = getThemeColors(isDarkMode);
  const bgColor = c.bg;
  const cardBg = c.bgAlt;
  const textColor = c.text;
  const subtextColor = c.textSecondary;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={[styles.overlay, { backgroundColor: isDarkMode ? 'rgba(0,0,0,0.92)' : 'rgba(0,0,0,0.7)' }]}>
        <SwipeableBottomDrawer onClose={onClose} isDarkMode={isDarkMode} style={[styles.modal, { backgroundColor: cardBg }]}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: textColor }]}>{t('daily_quiz.title')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TouchableOpacity onPress={toggleSound} style={styles.closeBtn}>
                <Icon name={soundOn ? 'volume-high' : 'volume-mute'} size={20} color={subtextColor} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Icon name="close" size={22} color={subtextColor} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>

          {/* Loading state */}
          {phase === 'loading' && (
            <View style={styles.centerContent}>
              <ActivityIndicator size="large" color="#8B5CF6" />
              <Text style={[styles.readySub, { color: subtextColor, marginTop: 12 }]}>{t('daily_quiz.loading')}</Text>
            </View>
          )}

          {/* Ready state */}
          {phase === 'ready' && (
            <View style={styles.centerContent}>
              <Text style={{ fontSize: 48 }}>🧠</Text>
              <Text style={[styles.readyTitle, { color: textColor }]}>{t('daily_quiz.pet_trivia')}</Text>
              <Text style={[styles.readySub, { color: subtextColor }]}>
                {t('daily_quiz.instructions', { seconds: TIMER_SECONDS, xp: XP_PER_CORRECT })}
              </Text>
              {bestScore > 0 && (
                <Text style={[styles.bestScore, { color: '#F59E0B' }]}>{t('daily_quiz.best_score', { score: bestScore })}</Text>
              )}
              <TouchableOpacity style={styles.startBtn} onPress={startQuiz}>
                <Icon name="play-circle" size={22} color="#fff" />
                <Text style={styles.startBtnText}>{t('daily_quiz.start')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Playing state */}
          {phase === 'playing' && q && (
            <View style={{ flex: 1 }}>
              {/* Progress */}
              <View style={styles.progressRow}>
                <Text style={[styles.qNum, { color: subtextColor }]}>Q{currentQ + 1}/5</Text>
                <View style={{ flex: 1, marginHorizontal: 10 }}>
                  {[0, 1, 2, 3, 4].map(i => (
                    <View key={i} style={[styles.dot, {
                      backgroundColor: i < currentQ ? '#10B981' : i === currentQ ? '#3B82F6' : (isDarkMode ? '#334155' : '#e2e8f0'),
                      position: 'absolute', left: `${i * 22}%`,
                    }]} />
                  ))}
                </View>
                <View style={styles.timerBadge}>
                  <Text style={[styles.timerText, { color: timeLeft <= 3 ? '#EF4444' : '#F59E0B' }]}>
                    {timeLeft}s
                  </Text>
                </View>
              </View>

              {/* Timer bar */}
              <Animated.View style={[styles.timerBar, {
                width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                backgroundColor: timeLeft <= 3 ? '#EF4444' : '#3B82F6',
              }]} />

              {/* Question */}
              <Text style={[styles.question, { color: textColor }]}>{q.q}</Text>

              {/* Options */}
              <View style={styles.optsWrap}>
                {q.opts.map((opt, i) => {
                  const isCorrect = opt === q.a;
                  const isSelected = selected === opt;
                  const showResult = selected !== null;
                  const optBg = showResult
                    ? isCorrect ? '#10B981' : isSelected ? '#EF4444' : (isDarkMode ? '#1e293b' : '#f1f5f9')
                    : isDarkMode ? '#1e293b' : '#f1f5f9';
                  const optTextColor = showResult && (isCorrect || isSelected) ? '#fff' : textColor;

                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.optBtn, { backgroundColor: optBg, borderColor: showResult && isCorrect ? '#10B981' : 'transparent' }]}
                      onPress={() => handleAnswer(opt)}
                      disabled={selected !== null}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.optLetter, { color: optTextColor }]}>
                        {String.fromCharCode(65 + i)}
                      </Text>
                      <Text style={[styles.optText, { color: optTextColor }]}>{opt}</Text>
                      {showResult && isCorrect && <Icon name="checkmark-circle" size={18} color="#fff" />}
                      {showResult && isSelected && !isCorrect && <Icon name="close-circle" size={18} color="#fff" />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Score */}
              <Text style={[styles.scoreLive, { color: subtextColor }]}>{t('daily_quiz.score', { current: score, total: currentQ + (selected ? 1 : 0) })}</Text>
            </View>
          )}

          {/* Result state */}
          {phase === 'result' && (
            <View style={styles.centerContent}>
              <Text style={{ fontSize: 48 }}>{score === 5 ? '🏆' : score >= 3 ? '🌟' : '📝'}</Text>
              <Text style={[styles.readyTitle, { color: textColor }]}>
                {score === 5 ? t('daily_quiz.result_perfect') : score >= 3 ? t('daily_quiz.result_great') : t('daily_quiz.result_nice')}
              </Text>
              <Text style={[styles.resultScore, { color: '#3B82F6' }]}>{t('daily_quiz.correct_count', { count: score })}</Text>
              <Text style={[styles.readySub, { color: subtextColor }]}>
                {score === 5 ? t('daily_quiz.xp_earned_bonus', { xp: score * XP_PER_CORRECT, bonus: XP_PERFECT_BONUS }) : t('daily_quiz.xp_earned', { xp: score * XP_PER_CORRECT })}
              </Text>
              {bestScore > 0 && (
                <Text style={[styles.bestScore, { color: '#F59E0B' }]}>{t('daily_quiz.best_score', { score: bestScore })}</Text>
              )}
              <TouchableOpacity style={[styles.startBtn, { backgroundColor: '#94a3b8' }]} onPress={onClose}>
                <Text style={styles.startBtnText}>
                  {hasPlayedToday ? t('daily_quiz.come_back') : t('daily_quiz.done')}
                </Text>
              </TouchableOpacity>
              {hasPlayedToday && !hasWatchedAd && (
                <TouchableOpacity
                  style={[styles.startBtn, { backgroundColor: '#F59E0B', marginTop: 10 }]}
                  onPress={handleWatchAd}
                  disabled={adLoading}
                >
                  <Icon name={adLoading ? 'hourglass' : 'videocam'} size={20} color="#fff" />
                  <Text style={styles.startBtnText}>
                    {adLoading ? t('daily_quiz.loading_ad') : t('daily_quiz.watch_ad')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          </ScrollView>
        </SwipeableBottomDrawer>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  modal: {
    width: '100%', padding: 20, maxHeight: '85%',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.2, shadowRadius: 12 },
      android: { elevation: 12 },
    }),
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800' },
  closeBtn: { padding: 8 },

  centerContent: { alignItems: 'center', paddingVertical: 24 },
  readyTitle: { fontSize: 24, fontWeight: '800', marginTop: 8 },
  readySub: { fontSize: 12, textAlign: 'center', marginTop: 6 },
  bestScore: { fontSize: 13, fontWeight: '700', marginTop: 8 },
  resultScore: { fontSize: 32, fontWeight: '800', marginTop: 4 },

  startBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#8B5CF6', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 16, marginTop: 20,
    shadowColor: '#8B5CF6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  progressRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  qNum: { fontSize: 12, fontWeight: '700' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  timerBadge: { backgroundColor: '#FEF3C7', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  timerText: { fontSize: 13, fontWeight: '800' },
  timerBar: { height: 4, borderRadius: 2, marginBottom: 16 },

  question: { fontSize: 16, fontWeight: '700', marginBottom: 16, lineHeight: 22 },

  optsWrap: { gap: 10 },
  optBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: 14, borderWidth: 2,
  },
  optLetter: { fontSize: 14, fontWeight: '800', width: 22, textAlign: 'center' },
  optText: { fontSize: 13, fontWeight: '600', flex: 1 },

  scoreLive: { fontSize: 12, textAlign: 'center', marginTop: 12, fontWeight: '600' },
});

export default DailyQuiz;
