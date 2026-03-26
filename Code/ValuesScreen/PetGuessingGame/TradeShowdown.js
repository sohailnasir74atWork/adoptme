/**
 * TradeShowdown.js
 * 2-player game: both see 2 pets, pick which is worth more.
 * Uses real pet data & values from localState.
 * Same invite system / room lifecycle as QuizBattle.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, Image,
  ActivityIndicator, Animated, Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import OnlineUsersList from '../../ChatScreen/GroupChat/OnlineUsersList';
import {
  listenToGameRoom,
  leaveGameRoom,
  awardGameWin,
  sendGameInvite,
} from './utils/gameInviteSystem';
import {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc,
  serverTimestamp, increment, collection, query, where,
} from '@react-native-firebase/firestore';
import RewardedAdManager from '../../Ads/RewardedAdManager';
import { addXP } from '../../Engagement/xpUtils';

// ── Config ──
const TIMER_SEC = 12;
const TOTAL_ROUNDS = 7;
const PTS_CORRECT = 15;
const PTS_SPEED_BONUS = 10;
const AUTO_START_DELAY = 6;

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ── Generate rounds from pet data ──
const generateRounds = (petData, imgurl, count = TOTAL_ROUNDS) => {
  if (!petData || petData.length < 10) return [];

  const petsOnly = petData.filter(p =>
    (p?.type?.toLowerCase() === 'pets' || p?.type?.toLowerCase() === 'pet') &&
    p?.name && p?.image &&
    Number(p?.rvalue || p?.value || 0) > 0
  );
  if (petsOnly.length < count * 2) return [];

  const baseUrl = (imgurl || '').replace(/"/g, '').replace(/\/$/, '');
  const getImg = (pet) => pet.image ? `${baseUrl}/${pet.image.replace(/^\//, '')}` : '';

  // Create rounds: pick 2 pets per round with different values
  const rounds = [];
  const used = new Set();
  const shuffled = shuffle(petsOnly);

  for (let i = 0; i < shuffled.length - 1 && rounds.length < count; i++) {
    const petA = shuffled[i];
    if (used.has(petA.name)) continue;

    // Find a pet with a DIFFERENT value
    for (let j = i + 1; j < shuffled.length && rounds.length < count; j++) {
      const petB = shuffled[j];
      if (used.has(petB.name)) continue;

      const valA = Number(petA.rvalue || petA.value || 0);
      const valB = Number(petB.rvalue || petB.value || 0);
      if (valA === valB) continue; // skip same value — no clear answer

      used.add(petA.name);
      used.add(petB.name);

      // Randomly order the two pets so the answer isn't always left/right
      const swap = Math.random() > 0.5;
      const left = swap ? petB : petA;
      const right = swap ? petA : petB;
      const leftVal = Number(left.rvalue || left.value || 0);
      const rightVal = Number(right.rvalue || right.value || 0);

      rounds.push({
        left: { name: left.name, image: getImg(left), value: leftVal },
        right: { name: right.name, image: getImg(right), value: rightVal },
        answer: leftVal > rightVal ? 'left' : 'right', // correct answer
      });
      break;
    }
  }
  return rounds;
};

const TradeShowdown = () => {
  const { firestoreDB, appdatabase, theme, user, acceptedInviteRoom, setAcceptedInviteRoom } = useGlobalState();
  const { localState } = useLocalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';

  const [roomId, setRoomId] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [myAnswer, setMyAnswer] = useState(null);
  const [timeLeft, setTimeLeft] = useState(TIMER_SEC);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [roundTransition, setRoundTransition] = useState(0);
  const [autoStartCount, setAutoStartCount] = useState(0);
  const timerRef = useRef(null);
  const timerBarAnim = useRef(new Animated.Value(1)).current;
  const processedRef = useRef(new Set());
  const lastOpponentRef = useRef(null);
  const [adBonusClaimed, setAdBonusClaimed] = useState(false);
  const [adLoading, setAdLoading] = useState(false);

  // Check if ad bonus already claimed today
  useEffect(() => {
    if (!firestoreDB || !user?.id) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', user.id));
        const data = snap.exists ? snap.data() : {};
        if (data.lastTradeShowdownAdAt) {
          const d = data.lastTradeShowdownAdAt?.toDate ? data.lastTradeShowdownAdAt.toDate() : new Date(data.lastTradeShowdownAdAt);
          const now = new Date();
          if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
            setAdBonusClaimed(true);
          }
        }
      } catch {}
    })();
  }, [firestoreDB, user?.id]);

  const MAX_PENDING = 3; // Allow up to 3 pending invites at a time
  const INVITE_EXPIRY_MS = 30000;

  // Get pet data
  const petData = useMemo(() => {
    try {
      const raw = localState.data;
      if (!raw) return [];
      const all = typeof raw === 'string' ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
      return all.filter(i => i?.type?.toLowerCase() === 'pets' || i?.type?.toLowerCase() === 'pet');
    } catch { return []; }
  }, [localState.data]);

  // ── Auto-join from global toast accept ──
  useEffect(() => {
    if (acceptedInviteRoom?.gameType === 'tradeShowdown' && acceptedInviteRoom?.roomId) {
      setRoomId(acceptedInviteRoom.roomId);
      setAcceptedInviteRoom(null);
    }
  }, [acceptedInviteRoom]);

  // ── Listen to room changes ──
  useEffect(() => {
    if (!roomId || !firestoreDB) return;
    const unsub = listenToGameRoom(firestoreDB, roomId, (data) => {
      setRoomData(data);
      if (data && data.currentPlayers >= 2 && pendingInvites.length > 0) setPendingInvites([]);
      // Detect declined invites → clear from pending list & notify sender
      if (data?.invites && pendingInvites.length > 0) {
        const declined = pendingInvites.filter(inv => data.invites[inv.userId]?.status === 'declined');
        if (declined.length > 0) {
          setPendingInvites(prev => prev.filter(inv => !declined.some(d => d.userId === inv.userId)));
          declined.forEach(d => showErrorMessage('Declined', `${d.displayName} declined your invite`));
        }
      }
      if (data?.players && user?.id) {
        const opId = Object.keys(data.players).find(id => id !== user.id);
        if (opId) lastOpponentRef.current = { id: opId, ...data.players[opId] };
      }
      if (!data) { setRoomId(null); setRoomData(null); setPendingInvites([]); }
      if (data && data.status === 'waiting' && data.currentPlayers >= 2) {
        setAutoStartCount(AUTO_START_DELAY);
      }
      // Opponent left mid-game → auto-win
      if (data && data.status === 'playing' && data.currentPlayers < 2 && user?.id) {
        const remaining = Object.keys(data.players || {});
        if (remaining.includes(user.id) && remaining.length >= 2) {
          const scores = data.gameData?.scores || {};
          const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
          updateDoc(roomRef, {
            status: 'finished',
            'gameData.winner': { playerId: user.id, playerName: data.players?.[user.id]?.displayName || 'Player', score: scores[user.id] || 0, forfeit: true },
            'gameData.endedAt': serverTimestamp(),
          }).catch(() => {});
          if (appdatabase) awardGameWin(appdatabase, firestoreDB, user.id).catch(() => {});
        }
      }
    });
    return () => unsub();
  }, [roomId, firestoreDB, pendingInvites.length, user?.id]);

  // ── Auto-start countdown ──
  useEffect(() => {
    if (autoStartCount <= 0) return;
    const iv = setInterval(() => {
      setAutoStartCount(prev => {
        if (prev <= 1) {
          clearInterval(iv);
          // Only host writes to Firestore (both players see the countdown UI)
          if (roomId && firestoreDB && roomData?.hostId === user?.id) {
            updateDoc(doc(firestoreDB, 'petGuessingGame_rooms', roomId), {
              status: 'playing', 'gameData.startedAt': serverTimestamp(),
            }).catch(() => {});
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [autoStartCount, roomId, firestoreDB]);

  // ── Round transition countdown ──
  useEffect(() => {
    if (roundTransition <= 0) return;
    const iv = setInterval(() => {
      setRoundTransition(prev => { if (prev <= 1) { clearInterval(iv); return 0; } return prev - 1; });
    }, 1000);
    return () => clearInterval(iv);
  }, [roundTransition]);

  // ── Invite expiry cleanup ──
  useEffect(() => {
    if (pendingInvites.length === 0) return;
    const iv = setInterval(() => {
      setPendingInvites(prev => prev.filter(i => Date.now() < i.expiresAt));
    }, 1000);
    return () => clearInterval(iv);
  }, [pendingInvites.length]);

  // ── Timer ──
  useEffect(() => {
    if (roomData?.status !== 'playing' || myAnswer !== null) return;
    setTimeLeft(TIMER_SEC);
    timerBarAnim.setValue(1);
    Animated.timing(timerBarAnim, { toValue: 0, duration: TIMER_SEC * 1000, useNativeDriver: false }).start();
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); handleAnswer(null); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [roomData?.gameData?.currentRound, roomData?.status, myAnswer]);

  // ── Reset answer on new round ──
  useEffect(() => { setMyAnswer(null); }, [roomData?.gameData?.currentRound]);

  // ── Auto-advance when both answered ──
  useEffect(() => {
    if (!roomData || roomData.status !== 'playing' || !user?.id) return;
    const round = roomData.gameData?.currentRound || 1;
    const roundKey = `round_${round}`;
    const answers = roomData.gameData?.answers?.[roundKey] || {};
    const playerCount = roomData.currentPlayers || 2;
    if (Object.keys(answers).length < playerCount) return;
    if (processedRef.current.has(roundKey)) return;
    processedRef.current.add(roundKey);

    // ── Compute scores from scratch across ALL rounds (single source of truth) ──
    const allAnswers = roomData.gameData?.answers || {};
    const rounds = roomData.gameData?.rounds || [];
    const scores = {};
    // Initialize scores for all players
    Object.keys(roomData.players || {}).forEach(pid => { scores[pid] = 0; });

    for (let r = 1; r <= round; r++) {
      const rKey = `round_${r}`;
      const rAnswers = allAnswers[rKey] || {};
      const correctAnswer = rounds[r - 1]?.answer;
      const correctPlayers = [];

      Object.entries(rAnswers).forEach(([pid, ans]) => {
        if (ans.choice === correctAnswer) {
          scores[pid] = (scores[pid] || 0) + PTS_CORRECT;
          correctPlayers.push({ id: pid, ts: ans.timestamp || 0 });
        }
      });

      // Speed bonus for the round
      if (correctPlayers.length >= 2) {
        correctPlayers.sort((a, b) => a.ts - b.ts);
        scores[correctPlayers[0].id] = (scores[correctPlayers[0].id] || 0) + PTS_SPEED_BONUS;
      }
    }

    setRoundTransition(3);
    setTimeout(async () => {
      try {
        const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
        if (round >= TOTAL_ROUNDS) {
          setRoundTransition(0);
          const pids = Object.keys(scores);
          const sorted = pids.sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
          const top = scores[sorted[0]] || 0;
          const second = scores[sorted[1]] || 0;
          const isTie = top === second;

          await updateDoc(roomRef, {
            status: 'finished',
            'gameData.scores': scores,
            'gameData.winner': isTie
              ? { isTie: true, score: top }
              : { playerId: sorted[0], playerName: roomData.players?.[sorted[0]]?.displayName || 'Player', score: top },
            'gameData.endedAt': serverTimestamp(),
          });
          if (!isTie && appdatabase) awardGameWin(appdatabase, firestoreDB, sorted[0]).catch(() => {});
        } else {
          setRoundTransition(0);
          await updateDoc(roomRef, { 'gameData.currentRound': round + 1, 'gameData.scores': scores });
        }
      } catch (err) { console.warn('[TradeShowdown] advance error:', err?.message); }
    }, 3000);
  }, [roomData]);

  // ── Handle answer ──
  const handleAnswer = useCallback(async (choice) => {
    if (myAnswer !== null || !roomData || roomData.status !== 'playing' || !user?.id || !roomId) return;
    clearInterval(timerRef.current);
    setMyAnswer(choice);
    triggerHapticFeedback(choice ? 'impactMedium' : 'notificationWarning');

    try {
      const round = roomData.gameData?.currentRound || 1;
      const roundKey = `round_${round}`;
      const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
      const isCorrect = choice === roomData.gameData?.rounds?.[round - 1]?.answer;

      // ── Atomic per-player write using dot-notation (no race condition) ──
      await updateDoc(roomRef, {
        [`gameData.answers.${roundKey}.${user.id}`]: {
          choice,
          timestamp: Date.now(),
          isCorrect,
        },
      });
    } catch (err) { console.warn('[TradeShowdown] answer error:', err?.message); }
  }, [myAnswer, roomData, firestoreDB, user?.id, roomId, triggerHapticFeedback]);

  // ── Create room ──
  const handleCreate = useCallback(async () => {
    if (!user?.id || !firestoreDB || petData.length < 20) {
      if (petData.length < 20) showErrorMessage('Error', 'Not enough pet data loaded yet');
      return;
    }
    setLoading(true);
    triggerHapticFeedback('impactLight');

    try {
      // Cleanup old rooms
      try {
        const roomsRef = collection(firestoreDB, 'petGuessingGame_rooms');
        const oldQ = query(roomsRef, where('hostId', '==', user.id), where('gameType', '==', 'tradeShowdown'));
        const oldSnap = await getDocs(oldQ);
        const TEN_MIN = 10 * 60 * 1000;
        oldSnap.forEach(async (d) => {
          const rd = d.data();
          const created = rd.createdAt?.toMillis?.() || rd.createdAt || 0;
          if ((rd.status === 'waiting' || rd.status === 'finished') && (Date.now() - created > TEN_MIN)) {
            await deleteDoc(doc(firestoreDB, 'petGuessingGame_rooms', d.id)).catch(() => {});
          }
        });
      } catch {}

      const rounds = generateRounds(petData, localState.imgurl, TOTAL_ROUNDS);
      if (rounds.length < TOTAL_ROUNDS) {
        showErrorMessage('Error', 'Could not generate enough rounds');
        setLoading(false);
        return;
      }

      const id = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await setDoc(doc(firestoreDB, 'petGuessingGame_rooms', id), {
        hostId: user.id,
        hostName: user.displayName || 'Anonymous',
        hostAvatar: user.avatar || null,
        gameType: 'tradeShowdown',
        status: 'waiting',
        maxPlayers: 2,
        currentPlayers: 1,
        createdAt: serverTimestamp(),
        players: { [user.id]: { displayName: user.displayName || 'Anonymous', avatar: user.avatar || null, joinedAt: serverTimestamp(), score: 0 } },
        invites: {},
        gameData: {
          rounds, // has { left, right, answer } — no plain-text value stored
          currentRound: 1,
          totalRounds: TOTAL_ROUNDS,
          scores: { [user.id]: 0 },
          playerOrder: [user.id],
          answers: {},
        },
      });

      setRoomId(id);
      setShowInvite(true);
    } catch (err) {
      showErrorMessage('Error', 'Failed to create room');
    } finally {
      setLoading(false);
    }
  }, [user, firestoreDB, petData, localState.imgurl, triggerHapticFeedback]);

  // ── Leave ──
  const handleLeave = useCallback(async () => {
    if (!roomId || !user?.id) return;
    if (roomData?.status === 'playing') {
      try {
        const opId = Object.keys(roomData.players || {}).find(id => id !== user.id);
        if (opId) {
          const scores = roomData.gameData?.scores || {};
          await updateDoc(doc(firestoreDB, 'petGuessingGame_rooms', roomId), {
            status: 'finished',
            'gameData.winner': { playerId: opId, playerName: roomData.players?.[opId]?.displayName || 'Player', score: scores[opId] || 0, forfeit: true },
            'gameData.endedAt': serverTimestamp(),
          });
          if (appdatabase) awardGameWin(appdatabase, firestoreDB, opId).catch(() => {});
        }
      } catch {}
    }
    await leaveGameRoom(firestoreDB, roomId, user.id);
    setRoomId(null); setRoomData(null); setPendingInvites([]); processedRef.current.clear();
  }, [roomId, user?.id, firestoreDB, roomData, appdatabase]);

  // ── Rematch: leave old room, create new, auto-invite opponent ──
  const handleRematch = useCallback(async () => {
    if (!user?.id || !firestoreDB || petData.length < 20) return;
    const opponent = lastOpponentRef.current;
    if (!opponent?.id) { showErrorMessage('Error', 'No opponent to rematch'); return; }

    setLoading(true);
    triggerHapticFeedback('impactLight');

    try {
      // 1. Leave old room first
      if (roomId) {
        await leaveGameRoom(firestoreDB, roomId, user.id).catch(() => {});
      }
      // Reset state
      setRoomId(null); setRoomData(null); setPendingInvites([]); processedRef.current.clear();

      // 2. Generate fresh rounds
      const rounds = generateRounds(petData, localState.imgurl, TOTAL_ROUNDS);
      if (rounds.length < TOTAL_ROUNDS) {
        showErrorMessage('Error', 'Could not generate enough rounds');
        setLoading(false);
        return;
      }

      // 3. Create new room
      const id = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      await setDoc(doc(firestoreDB, 'petGuessingGame_rooms', id), {
        hostId: user.id,
        hostName: user.displayName || 'Anonymous',
        hostAvatar: user.avatar || null,
        gameType: 'tradeShowdown',
        status: 'waiting',
        maxPlayers: 2,
        currentPlayers: 1,
        createdAt: serverTimestamp(),
        players: { [user.id]: { displayName: user.displayName || 'Anonymous', avatar: user.avatar || null, joinedAt: serverTimestamp(), score: 0 } },
        invites: {},
        gameData: {
          rounds,
          currentRound: 1,
          totalRounds: TOTAL_ROUNDS,
          scores: { [user.id]: 0 },
          playerOrder: [user.id],
          answers: {},
        },
      });

      // 4. Set room and auto-invite opponent
      setRoomId(id);
      await sendGameInvite(firestoreDB, id, user, opponent.id);
      showSuccessMessage('Rematch!', `Invite sent to ${opponent.displayName || 'opponent'}`);
    } catch (err) {
      showErrorMessage('Error', 'Failed to create rematch');
    } finally {
      setLoading(false);
    }
  }, [user, firestoreDB, petData, localState.imgurl, triggerHapticFeedback, roomId]);

  // ── Invite sent callback ──
  const handleInviteSent = useCallback((invitedUser) => {
    if (!invitedUser?.id || pendingInvites.length >= MAX_PENDING) return;
    setPendingInvites(prev => {
      if (prev.some(i => i.userId === invitedUser.id)) return prev;
      return [...prev, {
        userId: invitedUser.id,
        displayName: invitedUser.displayName || 'Anonymous',
        avatar: invitedUser.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        sentAt: Date.now(),
        expiresAt: Date.now() + INVITE_EXPIRY_MS,
      }];
    });
    setShowInvite(false); // Close modal after sending
  }, [pendingInvites.length]);

  // ── Derived state ──
  const round = roomData?.gameData?.currentRound || 1;
  const roundData = roomData?.gameData?.rounds?.[round - 1];
  const roundKey = `round_${round}`;
  const roundAnswers = roomData?.gameData?.answers?.[roundKey] || {};
  const playerIds = Object.keys(roomData?.players || {});
  const opponentId = playerIds.find(id => id !== user?.id);
  const opponentAnswer = roundAnswers[opponentId];
  const bothAnswered = Object.keys(roundAnswers).length >= (roomData?.currentPlayers || 2);
  const scores = roomData?.gameData?.scores || {};

  const bg = isDarkMode ? '#0f172a' : '#f8fafc';
  const cardBg = isDarkMode ? '#1e293b' : '#fff';
  const txt = isDarkMode ? '#f1f5f9' : '#111';
  const sub = isDarkMode ? '#94a3b8' : '#64748b';

  // ═══════════════════════════════════════════════
  // RENDER: No room → Create screen
  // ═══════════════════════════════════════════════
  if (!roomId) {
    return (
      <ScrollView style={[s.wrap, { backgroundColor: bg }]} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={s.headerRow}>
          <Text style={{ fontSize: 28 }}>💰</Text>
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text style={[s.h1, { color: txt }]}>Trade Showdown</Text>
            <Text style={[s.sub, { color: sub }]}>Who knows pet values better?</Text>
          </View>
        </View>

        <TouchableOpacity style={s.createBtn} onPress={handleCreate} disabled={loading || !user?.id}>
          {loading ? <ActivityIndicator color="#fff" /> : (
            <>
              <Icon name="flash" size={22} color="#fff" />
              <Text style={s.createBtnTxt}>{user?.id ? 'Create Showdown' : 'Login to Play'}</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={[s.card, { backgroundColor: cardBg }]}>
          <Text style={[s.cardTitle, { color: txt }]}>🎮 How it Works</Text>
          <Text style={[s.cardBody, { color: sub }]}>
            {'• Two pets shown side by side\n• Pick which one is worth MORE\n• 12 seconds to answer\n• +15 XP per correct answer\n• +10 bonus for fastest correct\n• 7 rounds, highest score wins!\n\n🏆 Winner gets 100 XP!'}
          </Text>
        </View>
      </ScrollView>
    );
  }

  // ═══════════════════════════════════════════════
  // RENDER: Waiting room
  // ═══════════════════════════════════════════════
  if (roomData?.status === 'waiting') {
    return (
      <ScrollView style={[s.wrap, { backgroundColor: bg }]} contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
        <Text style={[s.h1, { color: txt }]}>💰 Trade Showdown</Text>

        <View style={s.playersRow}>
          {playerIds.map(pid => (
            <View key={pid} style={[s.playerChip, { backgroundColor: cardBg }]}>
              <Image source={{ uri: roomData.players[pid]?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }} style={s.waitAvatar} />
              <Text style={[s.playerName, { color: txt }]} numberOfLines={1}>{roomData.players[pid]?.displayName}</Text>
            </View>
          ))}
          {roomData.currentPlayers < 2 && (
            <View style={[s.playerChip, { backgroundColor: cardBg, borderStyle: 'dashed', borderWidth: 2, borderColor: sub }]}>
              <View style={[s.waitAvatar, { justifyContent: 'center', alignItems: 'center' }]}>
                <Icon name="person-add" size={22} color={sub} />
              </View>
              <Text style={[s.playerName, { color: sub }]}>Waiting...</Text>
            </View>
          )}
        </View>

        {roomData.currentPlayers < 2 && pendingInvites.length < MAX_PENDING && (
          <TouchableOpacity
            style={s.inviteBtn}
            onPress={() => setShowInvite(true)}
          >
            <Icon name="person-add" size={18} color="#fff" />
            <Text style={s.inviteBtnTxt}>Invite Friend</Text>
          </TouchableOpacity>
        )}

        {/* Pending invites */}
        {pendingInvites.length > 0 && (
          <View style={[s.pendingWrap, { backgroundColor: cardBg }]}>
            <Text style={[s.pendingTitle, { color: txt }]}>Pending Invites ({pendingInvites.length})</Text>
            {pendingInvites.map(invite => {
              const remaining = Math.max(0, invite.expiresAt - Date.now());
              const progress = Math.max(0, Math.min(1, remaining / INVITE_EXPIRY_MS));
              const secs = Math.ceil(remaining / 1000);
              return (
                <View key={invite.userId} style={s.pendingItem}>
                  <Image source={{ uri: invite.avatar }} style={s.pendingAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={[s.pendingName, { color: txt }]} numberOfLines={1}>{invite.displayName}</Text>
                    <View style={s.progressBarWrap}>
                      <View style={[s.progressBarFill, { width: `${progress * 100}%`, backgroundColor: progress > 0.4 ? '#10B981' : progress > 0.15 ? '#F59E0B' : '#EF4444' }]} />
                    </View>
                    <Text style={[s.progressText, { color: sub }]}>{secs > 0 ? `${secs}s remaining` : 'Expired'}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Auto-start countdown */}
        {roomData.currentPlayers >= 2 && autoStartCount > 0 && (
          <View style={s.countdownBanner}>
            <Text style={{ fontSize: 36 }}>🎮</Text>
            <Text style={s.countdownText}>Get Ready!</Text>
            <Text style={s.countdownSub}>Starting in {autoStartCount}...</Text>
            <View style={s.countdownBar}>
              <View style={[s.countdownBarFill, { width: `${(autoStartCount / AUTO_START_DELAY) * 100}%` }]} />
            </View>
          </View>
        )}

        <TouchableOpacity style={s.leaveBtn} onPress={handleLeave}>
          <Text style={[s.leaveTxt, { color: '#EF4444' }]}>Leave Room</Text>
        </TouchableOpacity>

        {roomId && (
          <OnlineUsersList visible={showInvite} onClose={() => setShowInvite(false)} mode="gameInvite" roomId={roomId} onInviteSent={handleInviteSent} maxInvites={MAX_PENDING} pendingInviteCount={pendingInvites.length} />
        )}
      </ScrollView>
    );
  }

  // ═══════════════════════════════════════════════
  // RENDER: Playing
  // ═══════════════════════════════════════════════
  if (roomData?.status === 'playing' && roundData) {
    const correctAnswer = roundData.answer;
    const showResults = bothAnswered || myAnswer !== null;

    // Player status for the always-visible banner
    const myAnswered = myAnswer !== null;
    const opAnswered = !!roundAnswers[opponentId];
    const myName = user?.displayName?.split(' ')[0]?.slice(0, 10) || 'You';
    const opName = roomData.players?.[opponentId]?.displayName?.split(' ')[0]?.slice(0, 10) || 'Opponent';

    return (
      <ScrollView style={[s.wrap, { backgroundColor: bg }]} contentContainerStyle={{ padding: 16 }}>

        {/* ── Always-visible status banner (FIXED HEIGHT) ── */}
        <View style={s.statusBanner}>
          {roundTransition > 0 ? (
            <View style={s.statusBannerContent}>
              <Text style={s.statusBannerTitle}>⚡ Next round in {roundTransition}...</Text>
            </View>
          ) : (
            <View style={s.statusBannerContent}>
              <View style={s.statusBannerPlayers}>
                <View style={s.statusPlayer}>
                  <View style={[s.statusDot, { backgroundColor: myAnswered ? '#10B981' : '#fff' }]} />
                  <Text style={s.statusPlayerName} numberOfLines={1}>{myName}</Text>
                </View>
                <Text style={s.statusVs}>•</Text>
                <View style={s.statusPlayer}>
                  <View style={[s.statusDot, { backgroundColor: opAnswered ? '#10B981' : '#fff' }]} />
                  <Text style={s.statusPlayerName} numberOfLines={1}>{opName}</Text>
                </View>
              </View>
            </View>
          )}
        </View>

        {/* Header row: round + scores */}
        <View style={s.gameHeader}>
          <Text style={[s.roundLabel, { color: sub }]}>Round {round}/{TOTAL_ROUNDS}</Text>
          <View style={s.scoresRow}>
            {playerIds.map(pid => {
              const isMe = pid === user?.id;
              const name = roomData.players[pid]?.displayName?.split(' ')[0]?.slice(0, 8) || 'P';
              return (
                <View key={pid} style={[s.scoreChip, { backgroundColor: isMe ? '#F59E0B18' : '#10B98118' }]}>
                  <Text numberOfLines={1} style={[s.scoreChipName, { color: isMe ? '#F59E0B' : '#10B981' }]}>{name}</Text>
                  <Text style={[s.scoreChipVal, { color: isMe ? '#F59E0B' : '#10B981' }]}>{scores[pid] || 0}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Timer bar */}
        <View style={s.timerWrap}>
          <Animated.View style={[s.timerBar, {
            width: timerBarAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            backgroundColor: timeLeft <= 4 ? '#EF4444' : '#F59E0B',
          }]} />
        </View>
        <Text style={[s.timerText, { color: timeLeft <= 4 ? '#EF4444' : '#F59E0B', alignSelf: 'flex-end' }]}>{timeLeft}s</Text>

        {/* Question */}
        <Text style={[s.qText, { color: txt }]}>Which pet is worth MORE? 💰</Text>

        {/* Two pet cards side by side — FIXED HEIGHT, names truncated */}
        <View style={s.petsRow}>
          {['left', 'right'].map(side => {
            const pet = roundData[side];
            const isSelected = myAnswer === side;
            const isCorrect = side === correctAnswer;
            const borderColor = showResults
              ? (isCorrect ? '#10B981' : isSelected ? '#EF4444' : isDarkMode ? '#334155' : '#e2e8f0')
              : (isSelected ? '#8B5CF6' : isDarkMode ? '#334155' : '#e2e8f0');

            return (
              <TouchableOpacity
                key={side}
                style={[s.petCard, {
                  backgroundColor: cardBg,
                  borderColor,
                  borderWidth: isSelected || (showResults && isCorrect) ? 2.5 : 1,
                }]}
                onPress={() => handleAnswer(side)}
                disabled={myAnswer !== null}
                activeOpacity={0.75}
              >
                {showResults && isCorrect && <View style={s.resultBadge}><Icon name="checkmark-circle" size={22} color="#10B981" /></View>}
                {showResults && isSelected && !isCorrect && <View style={s.resultBadge}><Icon name="close-circle" size={22} color="#EF4444" /></View>}
                <View style={s.petImageWrap}>
                  <Image source={{ uri: pet.image }} style={s.petImage} resizeMode="contain" />
                </View>
                <Text style={[s.petName, { color: txt }]} numberOfLines={1}>{pet.name}</Text>
                <View style={[s.valueBadge, { backgroundColor: showResults ? (isCorrect ? '#10B981' : '#64748b') : (isDarkMode ? '#334155' : '#e2e8f0') }]}>
                  <Text style={[s.valueText, !showResults && { color: isDarkMode ? '#64748b' : '#94a3b8' }]}>{showResults ? pet.value : '???'}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Opponent result after both answered */}
        {bothAnswered && opponentAnswer && (
          <View style={[s.opponentResult, { backgroundColor: cardBg }]}>
            <Image source={{ uri: roomData.players[opponentId]?.avatar || '' }} style={s.miniAvatar} />
            <Text style={{ color: txt, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
              {roomData.players[opponentId]?.displayName?.split(' ')[0]} picked {opponentAnswer.choice === 'left' ? roundData.left.name : roundData.right.name} {opponentAnswer.isCorrect ? '✅' : '❌'}
            </Text>
          </View>
        )}
      </ScrollView>
    );
  }

  // ═══════════════════════════════════════════════
  // RENDER: Finished
  // ═══════════════════════════════════════════════
  if (roomData?.status === 'finished') {
    const winner = roomData.gameData?.winner;
    const isWinner = winner?.playerId === user?.id;
    const isTie = winner?.isTie;
    const isForfeit = winner?.forfeit;

    return (
      <ScrollView style={[s.wrap, { backgroundColor: bg }]} contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
        <Text style={{ fontSize: 48 }}>{isTie ? '🤝' : isWinner ? '🏆' : '😢'}</Text>
        <Text style={[s.h1, { color: txt, marginTop: 8 }]}>
          {isTie ? "It's a Draw!" : isWinner ? 'You Won!' : 'You Lost!'}
        </Text>
        <Text style={[s.sub, { color: sub }]}>
          {isTie ? `Both scored ${winner?.score} XP!`
            : isForfeit ? `${winner?.playerName} wins by forfeit!`
            : `${winner?.playerName} wins with ${winner?.score} XP!`}
        </Text>

        <View style={s.finalScores}>
          {playerIds.sort((a, b) => (scores[b] || 0) - (scores[a] || 0)).map((pid, i) => (
            <View key={pid} style={[s.finalScoreRow, { backgroundColor: cardBg }]}>
              <Text style={{ fontSize: 22 }}>{i === 0 ? '🥇' : '🥈'}</Text>
              <Image source={{ uri: roomData.players[pid]?.avatar || '' }} style={s.finalAvatar} />
              <Text style={[s.finalName, { color: txt }]} numberOfLines={1}>{roomData.players[pid]?.displayName}</Text>
              <Text style={s.finalScore}>{scores[pid] || 0}</Text>
            </View>
          ))}
        </View>

        <TouchableOpacity style={[s.createBtn, { marginTop: 24 }]} onPress={handleLeave}>
          <Icon name="refresh" size={20} color="#fff" />
          <Text style={s.createBtnTxt}>Play Again</Text>
        </TouchableOpacity>

        {lastOpponentRef.current && (
          <TouchableOpacity style={[s.rematchBtn, { marginTop: 12 }]} onPress={handleRematch} disabled={loading}>
            <Icon name="people" size={18} color="#F59E0B" />
            <Text style={s.rematchBtnTxt}>{loading ? 'Creating...' : `Rematch ${lastOpponentRef.current?.displayName?.split(' ')[0] || 'Opponent'}`}</Text>
          </TouchableOpacity>
        )}

        {/* Watch Ad for bonus XP */}
        {!adBonusClaimed && (
          <TouchableOpacity
            style={[s.createBtn, { marginTop: 10, backgroundColor: '#F59E0B' }]}
            onPress={async () => {
              if (adLoading) return;
              setAdLoading(true);
              const earned = await RewardedAdManager.show();
              setAdLoading(false);
              if (earned) {
                setAdBonusClaimed(true);
                if (appdatabase && user?.id) addXP(appdatabase, user.id, 50).catch(() => {});
                showSuccessMessage('Bonus!', '+50 XP earned! 🎉');
                // Persist to Firestore
                if (firestoreDB && user?.id) {
                  setDoc(doc(firestoreDB, 'games', user.id), { lastTradeShowdownAdAt: new Date() }, { merge: true }).catch(() => {});
                }
              }
            }}
            disabled={adLoading}
          >
            <Icon name={adLoading ? 'hourglass' : 'videocam'} size={20} color="#fff" />
            <Text style={s.createBtnTxt}>{adLoading ? 'Loading...' : '🎬 Watch Ad for +50 XP!'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  // ── Loading ──
  return (
    <View style={[s.wrap, { backgroundColor: bg, justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator size="large" color="#F59E0B" />
      <Text style={[s.sub, { color: sub, marginTop: 12 }]}>Loading game...</Text>
    </View>
  );
};

const s = StyleSheet.create({
  wrap: { flex: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  h1: { fontSize: 24, fontWeight: '800' },
  sub: { fontSize: 13, marginTop: 4 },

  // ── Buttons ──
  createBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#F59E0B', paddingVertical: 16, paddingHorizontal: 28, borderRadius: 18, marginTop: 16,
    shadowColor: '#F59E0B', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  createBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#3B82F6', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 16, marginTop: 16,
  },
  inviteBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  rematchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, paddingHorizontal: 24, borderRadius: 16, borderWidth: 2, borderColor: '#F59E0B',
  },
  rematchBtnTxt: { color: '#F59E0B', fontSize: 15, fontWeight: '800' },

  // ── Pending invites ──
  pendingWrap: { width: '100%', borderRadius: 16, padding: 14, marginTop: 16 },
  pendingTitle: { fontSize: 13, fontWeight: '800', marginBottom: 10 },
  pendingItem: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  pendingAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#e2e8f0' },
  pendingName: { fontSize: 12, fontWeight: '700' },
  progressBarWrap: { height: 4, borderRadius: 2, backgroundColor: '#e2e8f0', marginTop: 4, width: '100%' },
  progressBarFill: { height: 4, borderRadius: 2 },
  progressText: { fontSize: 9, marginTop: 2 },

  // ── Info card ──
  card: {
    borderRadius: 18, padding: 18, marginTop: 16,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6 },
      android: { elevation: 3 },
    }),
  },
  cardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 8 },
  cardBody: { fontSize: 13, lineHeight: 20 },

  // ── Waiting room ──
  playersRow: { flexDirection: 'row', gap: 14, marginTop: 24 },
  playerChip: { alignItems: 'center', padding: 16, borderRadius: 18, width: 130 },
  waitAvatar: { width: 48, height: 48, borderRadius: 24, marginBottom: 8, backgroundColor: '#e2e8f0' },
  playerName: { fontSize: 12, fontWeight: '700', textAlign: 'center', maxWidth: 100 },
  leaveBtn: { marginTop: 24, padding: 14 },
  leaveTxt: { fontWeight: '700', fontSize: 14, textAlign: 'center' },

  // ── Get Ready countdown ──
  countdownBanner: {
    width: '100%', backgroundColor: '#10B981', borderRadius: 20,
    paddingVertical: 24, paddingHorizontal: 28, alignItems: 'center', marginTop: 20,
  },
  countdownText: { color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 6 },
  countdownSub: { color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600', marginTop: 4 },
  countdownBar: { width: '100%', height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', marginTop: 12 },
  countdownBarFill: { height: 6, borderRadius: 3, backgroundColor: '#fff' },

  // ── Game header ──
  gameHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  roundLabel: { fontSize: 13, fontWeight: '800' },
  scoresRow: { flexDirection: 'row', gap: 6 },
  scoreChip: { flex: 1, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, alignItems: 'center' },
  scoreChipName: { fontSize: 11, fontWeight: '700' },
  scoreChipVal: { fontSize: 16, fontWeight: '800' },

  // ── Timer ──
  timerWrap: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden', marginBottom: 4 },
  timerBar: { height: 5, borderRadius: 3 },
  timerText: { fontSize: 14, fontWeight: '800', marginBottom: 6 },

  // ── Question ──
  qText: { fontSize: 18, fontWeight: '800', lineHeight: 24, textAlign: 'center', marginBottom: 14 },

  // ── Pet cards (FIXED HEIGHT — both same size) ──
  petsRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 2 },
  petCard: {
    flex: 1, borderRadius: 20, paddingVertical: 16, paddingHorizontal: 10,
    alignItems: 'center', justifyContent: 'center', height: 200, overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 8 },
      android: { elevation: 4 },
    }),
  },
  petImageWrap: {
    width: 96, height: 96, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  petImage: { width: 82, height: 82 },
  petName: { fontSize: 14, fontWeight: '700', textAlign: 'center', maxWidth: '95%' },
  valueBadge: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4, marginTop: 6 },
  valueText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  resultBadge: { position: 'absolute', top: 10, right: 10, zIndex: 2 },

  // ── Opponent result ──
  opponentResult: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, marginTop: 14 },
  miniAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#e2e8f0' },

  // ── Final scores ──
  finalScores: { gap: 12, marginTop: 24, width: '100%' },
  finalScoreRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16, paddingHorizontal: 18, borderRadius: 16,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  finalAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#e2e8f0' },
  finalName: { flex: 1, fontWeight: '700', fontSize: 15 },
  finalScore: { color: '#F59E0B', fontWeight: '800', fontSize: 20 },

  // ── Status banner (FIXED HEIGHT — no glitching) ──
  statusBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.92)', borderRadius: 14,
    height: 52, justifyContent: 'center', alignItems: 'center',
    marginBottom: 10, paddingHorizontal: 16, overflow: 'hidden',
  },
  statusBannerContent: { alignItems: 'center', justifyContent: 'center' },
  statusBannerTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  statusBannerPlayers: {
    flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'center',
  },
  statusPlayer: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' },
  statusPlayerName: { color: '#fff', fontSize: 14, fontWeight: '800', maxWidth: 90 },
  statusVs: { color: 'rgba(255,255,255,0.4)', fontWeight: '800', fontSize: 16 },
});

export default TradeShowdown;
