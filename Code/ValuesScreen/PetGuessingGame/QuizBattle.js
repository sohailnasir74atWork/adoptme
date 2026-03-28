/**
 * QuizBattle.js
 * 2-player real-time quiz battle.
 *
 * - Uses existing gameInviteSystem.js room lifecycle, invite system, listener
 * - Reuses OnlineUsersList for inviting, InviteNotification for receiving
 * - Host generates 5 questions, both answer simultaneously
 * - Fastest correct answer gets +10 bonus
 * - Winner determined after 5 rounds
 *
 * Firestore: petGuessingGame_rooms/{roomId} (same collection, gameType: 'quiz')
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import OnlineUsersList from '../../ChatScreen/GroupChat/OnlineUsersList';
import {
  listenToGameRoom,
  leaveGameRoom,
  awardGameWin,
  setGameWinner,
  sendGameInvite,
} from './utils/gameInviteSystem';
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  increment,
  collection,
  query,
  where,
} from '@react-native-firebase/firestore';
import RewardedAdManager from '../../Ads/RewardedAdManager';
import { addXP } from '../../Engagement/xpUtils';

// ── Question Bank ──
const ALL_QUESTIONS = [
  // Eggs & Origins
  { q: 'Which egg is the Shadow Dragon from?', a: 'Halloween Egg', opts: ['Halloween Egg', 'Ocean Egg', 'Safari Egg', 'Royal Egg'] },
  { q: 'Which pet comes from the Aussie Egg?', a: 'Kangaroo', opts: ['Kangaroo', 'Monkey', 'Giraffe', 'Parrot'] },
  { q: 'Which egg had the Owl?', a: 'Farm Egg', opts: ['Farm Egg', 'Jungle Egg', 'Safari Egg', 'Christmas Egg'] },
  { q: 'Which egg had the Giraffe?', a: 'Safari Egg', opts: ['Safari Egg', 'Jungle Egg', 'Farm Egg', 'Aussie Egg'] },
  { q: 'What pet comes from the Christmas Egg?', a: 'Arctic Reindeer', opts: ['Arctic Reindeer', 'Snow Owl', 'Frost Dragon', 'Penguin'] },
  { q: 'What is the "Bat Dragon" from?', a: 'Halloween 2019', opts: ['Halloween 2019', 'Halloween 2020', 'Candy store', 'Star Rewards'] },
  { q: 'Which event gave the Evil Unicorn?', a: 'Halloween 2019', opts: ['Halloween 2019', 'Christmas 2020', 'Easter 2021', 'Summer 2022'] },
  { q: 'Where was the Monkey King from?', a: 'Monkey Fairground', opts: ['Monkey Fairground', 'Star Rewards', 'Robux Shop', 'Halloween Event'] },
  { q: 'Which egg had the Turtle?', a: 'Aussie Egg', opts: ['Aussie Egg', 'Ocean Egg', 'Farm Egg', 'Fossil Egg'] },
  { q: 'Which egg had the Parrot?', a: 'Jungle Egg', opts: ['Jungle Egg', 'Safari Egg', 'Farm Egg', 'Aussie Egg'] },
  { q: 'Which egg had the Crow?', a: 'Farm Egg', opts: ['Farm Egg', 'Jungle Egg', 'Halloween Egg', 'Safari Egg'] },
  { q: 'Where does the Frost Dragon come from?', a: 'Christmas 2019', opts: ['Christmas 2019', 'Christmas 2020', 'Winter Egg', 'Star Rewards'] },
  { q: 'Which egg had the Blue Dog?', a: 'Blue Egg', opts: ['Blue Egg', 'Royal Egg', 'Starter Egg', 'Pet Egg'] },
  { q: 'Where is the Golden Unicorn from?', a: 'Golden Egg', opts: ['Golden Egg', 'Royal Egg', 'Star Rewards', 'Robux Shop'] },
  // Rarity & Value
  { q: 'What rarity is the Frost Dragon?', a: 'Legendary', opts: ['Legendary', 'Ultra-Rare', 'Rare', 'Common'] },
  { q: 'What is the rarest pet type?', a: 'Mega Neon Legendary', opts: ['Mega Neon Legendary', 'Neon Ultra-Rare', 'Fly Ride Common', 'Mega Neon Rare'] },
  { q: 'Which egg costs the most Bucks?', a: 'Royal Egg', opts: ['Royal Egg', 'Pet Egg', 'Cracked Egg', 'Safari Egg'] },
  { q: 'What rarity is the Unicorn?', a: 'Legendary', opts: ['Legendary', 'Ultra-Rare', 'Rare', 'Epic'] },
  { q: 'What rarity is the Beaver?', a: 'Rare', opts: ['Rare', 'Common', 'Ultra-Rare', 'Uncommon'] },
  { q: 'Which is worth more?', a: 'Shadow Dragon', opts: ['Shadow Dragon', 'Frost Dragon', 'Owl', 'Parrot'] },
  { q: 'Which pet is NOT legendary?', a: 'Flamingo', opts: ['Flamingo', 'Owl', 'Crow', 'Frost Dragon'] },
  // Mechanics
  { q: 'How many pets to make a Mega Neon?', a: '4 Neon pets', opts: ['4 Neon pets', '2 Neon pets', '6 Neon pets', '8 Neon pets'] },
  { q: 'How many tasks to grow a pet to Full Grown?', a: '6 stages', opts: ['6 stages', '4 stages', '8 stages', '3 stages'] },
  { q: 'What can you do with 4 Full Grown pets?', a: 'Make a Neon', opts: ['Make a Neon', 'Trade for Legendary', 'Unlock new egg', 'Get Fly potion'] },
  { q: 'How do you get a Diamond pet?', a: 'Star Rewards egg', opts: ['Star Rewards egg', 'Buy with Robux', 'Trade only', 'Special event'] },
  { q: 'What type is a Neon pet?', a: 'A pet with glowing parts', opts: ['A pet with glowing parts', 'A flying pet', 'A rare egg pet', 'A robotic pet'] },
  { q: 'How many pets total for a Mega Neon?', a: '16', opts: ['16', '12', '8', '20'] },
  { q: 'What age comes after Teen?', a: 'Post-Teen', opts: ['Post-Teen', 'Adult', 'Full Grown', 'Pre-Teen'] },
  { q: 'What is the first pet age stage?', a: 'Newborn', opts: ['Newborn', 'Junior', 'Baby', 'Infant'] },
  // Abbreviations
  { q: 'What does "FR" stand for?', a: 'Fly Ride', opts: ['Fly Ride', 'Frost Rare', 'Free Roam', 'Full Rarity'] },
  { q: 'What does "NFR" mean?', a: 'Neon Fly Ride', opts: ['Neon Fly Ride', 'Not For Resale', 'New Frost Rare', 'Neon Full Rarity'] },
  { q: 'What does "MFR" stand for?', a: 'Mega Fly Ride', opts: ['Mega Fly Ride', 'Most Frost Rare', 'Mega Full Rarity', 'Max Fly Range'] },
  { q: 'What does "CC" mean in trading?', a: 'Candy Cannon', opts: ['Candy Cannon', 'Common Cat', 'Cross Currency', 'Credit Card'] },
  { q: 'What does "NLF" mean?', a: 'Not Looking For', opts: ['Not Looking For', 'Neon Legendary Fly', 'New Limited Free', 'No Low Fakes'] },
  // Locations & Features
  { q: 'Where can you buy potions?', a: 'Sky Castle', opts: ['Sky Castle', 'Pet Shop', 'Nursery', 'Hospital'] },
  { q: 'Where do you hatch eggs?', a: 'Nursery', opts: ['Nursery', 'Pet Shop', 'Your House', 'Hospital'] },
  { q: 'How many rooms can your house have?', a: 'Unlimited (buy more)', opts: ['Unlimited (buy more)', '5', '10', '3'] },
  { q: 'What vehicle is from the Gifts rotation?', a: 'Rocket Sled', opts: ['Rocket Sled', 'Sports Car', 'Helicopter', 'Taxi'] },
  { q: 'Where is the Lemonade Stand?', a: 'Near the bridge', opts: ['Near the bridge', 'In the pet shop', 'At the school', 'By the hospital'] },
  // Tricky / Fun
  { q: 'Which pet can NOT fly by default?', a: 'All pets need Fly Potion', opts: ['All pets need Fly Potion', 'Dragon', 'Griffin', 'Bat'] },
  { q: 'What happens if you leave a trade?', a: 'Trade is cancelled', opts: ['Trade is cancelled', 'You lose items', 'Auto-accept', 'Cooldown penalty'] },
  { q: 'Can you trade Robux items?', a: 'No, only in-game items', opts: ['No, only in-game items', 'Yes always', 'Only legendaries', 'Only potions'] },
  { q: 'How many trade slots are there?', a: '9 slots', opts: ['9 slots', '6 slots', '4 slots', '12 slots'] },
  { q: 'What is the Nursery used for?', a: 'Hatching and aging pets', opts: ['Hatching and aging pets', 'Trading pets', 'Buying eggs', 'Making Neons'] },
  { q: 'Which is NOT a pet age?', a: 'Adult', opts: ['Adult', 'Junior', 'Pre-Teen', 'Post-Teen'] },
  { q: 'How do you get a Ride pet?', a: 'Use a Ride Potion', opts: ['Use a Ride Potion', 'Max level pet', 'Trade only', 'Buy from shop'] },
  { q: 'What color does a Mega Neon cycle?', a: 'Rainbow colors', opts: ['Rainbow colors', 'Only gold', 'Only white', 'Red and blue'] },
  { q: 'Can you un-neon a pet?', a: 'No', opts: ['No', 'Yes with potion', 'Yes in nursery', 'Yes by trading'] },
  { q: 'What is the max number of pets you can equip?', a: '3 at a time', opts: ['3 at a time', '1 at a time', '5 at a time', 'Unlimited'] },
  { q: 'Which is the oldest egg in the game?', a: 'Blue Egg', opts: ['Blue Egg', 'Safari Egg', 'Royal Egg', 'Christmas Egg'] },
];

const TIMER_SEC = 12;
const TOTAL_ROUNDS = 5;
const PTS_CORRECT = 20;
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

const QuizBattle = () => {
  const { firestoreDB, appdatabase, theme, user, acceptedInviteRoom, setAcceptedInviteRoom } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';

  const [roomId, setRoomId] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [loading, setLoading] = useState(false);
  const [myAnswer, setMyAnswer] = useState(null);
  const [timeLeft, setTimeLeft] = useState(TIMER_SEC);
  const [pendingInvites, setPendingInvites] = useState([]);
  const [roundTransition, setRoundTransition] = useState(0); // countdown between rounds
  const [autoStartCount, setAutoStartCount] = useState(0);   // pre-game countdown
  const timerRef = useRef(null);
  const timerBarAnim = useRef(new Animated.Value(1)).current;
  const processedRef = useRef(new Set());
  const lastOpponentRef = useRef(null); // for rematch
  const [adBonusClaimed, setAdBonusClaimed] = useState(false);
  const [adBonusLoading, setAdBonusLoading] = useState(false);

  // Check if ad bonus already claimed today
  useEffect(() => {
    if (!firestoreDB || !user?.id) return;
    (async () => {
      try {
        const snap = await getDoc(doc(firestoreDB, 'games', user.id));
        const data = snap.exists() ? snap.data() : {};
        if (data.lastQuizBattleAdAt) {
          const d = data.lastQuizBattleAdAt?.toDate ? data.lastQuizBattleAdAt.toDate() : new Date(data.lastQuizBattleAdAt);
          const now = new Date();
          if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
            setAdBonusClaimed(true);
          }
        }
      } catch {}
    })();
  }, [firestoreDB, user?.id]);

  const MAX_PENDING = 3; // Allow up to 3 pending invites at a time
  const INVITE_EXPIRY_MS = 30000; // 30 seconds

  // ── Auto-join from global toast accept ──
  useEffect(() => {
    if (acceptedInviteRoom?.gameType === 'quiz' && acceptedInviteRoom?.roomId) {
      setRoomId(acceptedInviteRoom.roomId);
      setAcceptedInviteRoom(null); // consume it
    }
  }, [acceptedInviteRoom]);

  // ── Listen to room changes ──
  useEffect(() => {
    if (!roomId || !firestoreDB) return;
    const unsub = listenToGameRoom(firestoreDB, roomId, (data) => {
      setRoomData(data);
      // Clear pending invites when opponent joins
      if (data && data.currentPlayers >= 2 && pendingInvites.length > 0) {
        setPendingInvites([]);
      }
      // Detect declined invites → clear from pending list & notify sender
      if (data?.invites && pendingInvites.length > 0) {
        const declined = pendingInvites.filter(inv => data.invites[inv.userId]?.status === 'declined');
        if (declined.length > 0) {
          setPendingInvites(prev => prev.filter(inv => !declined.some(d => d.userId === inv.userId)));
          declined.forEach(d => showErrorMessage('Declined', `${d.displayName} declined your invite`));
        }
      }
      // Track opponent for rematch
      if (data?.players && user?.id) {
        const opId = Object.keys(data.players).find(id => id !== user.id);
        if (opId) lastOpponentRef.current = { id: opId, ...data.players[opId] };
      }
      if (!data) {
        setRoomId(null);
        setRoomData(null);
        setPendingInvites([]);
      }
      // Auto-start countdown when 2nd player joins
      if (data && data.status === 'waiting' && data.currentPlayers >= 2) {
        setAutoStartCount(AUTO_START_DELAY);
      }
      // Handle opponent leaving mid-game — auto-win
      if (data && data.status === 'playing' && data.currentPlayers < 2 && user?.id) {
        const remainingPlayers = Object.keys(data.players || {});
        if (remainingPlayers.includes(user.id) && remainingPlayers.length >= 2) {
          const scores = data.gameData?.scores || {};
          const winnerName = data.players?.[user.id]?.displayName || 'Player';
          const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
          updateDoc(roomRef, {
            status: 'finished',
            'gameData.scores': scores,
            'gameData.winner': { playerId: user.id, playerName: winnerName, score: scores[user.id] || 0, forfeit: true },
            'gameData.endedAt': serverTimestamp(),
          }).catch(() => {});
          if (appdatabase) {
            awardGameWin(appdatabase, firestoreDB, user.id).catch(() => {});
          }
        }
      }
    });
    return () => unsub();
  }, [roomId, firestoreDB, pendingInvites.length, user?.id]);

  // ── Auto-start countdown (3...2...1...GO) ──
  useEffect(() => {
    if (autoStartCount <= 0) return;
    const interval = setInterval(() => {
      setAutoStartCount(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          // Auto-start the game!
          if (roomId && firestoreDB && roomData?.hostId === user?.id) {
            updateDoc(doc(firestoreDB, 'petGuessingGame_rooms', roomId), {
              status: 'playing',
              'gameData.startedAt': serverTimestamp(),
            }).catch(() => {});
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [autoStartCount, roomId, firestoreDB]);

  // ── Round transition countdown (3...2...1) ──
  useEffect(() => {
    if (roundTransition <= 0) return;
    const interval = setInterval(() => {
      setRoundTransition(prev => {
        if (prev <= 1) { clearInterval(interval); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [roundTransition]);

  // ── Clean up expired invites (tick every second for progress bars) ──
  useEffect(() => {
    if (pendingInvites.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setPendingInvites(prev => prev.filter(inv => now < inv.expiresAt));
    }, 1000);
    return () => clearInterval(interval);
  }, [pendingInvites.length]);

  // ── Handle invite sent callback ──
  const handleInviteSent = useCallback((invitedUser) => {
    if (!invitedUser?.id) return;
    setPendingInvites(prev => {
      if (prev.length >= MAX_PENDING) return prev;
      if (prev.some(inv => inv.userId === invitedUser.id)) return prev;
      return [...prev, {
        userId: invitedUser.id,
        displayName: invitedUser.displayName || 'Anonymous',
        avatar: invitedUser.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        sentAt: Date.now(),
        expiresAt: Date.now() + INVITE_EXPIRY_MS,
      }];
    });
    setShowInvite(false); // Close modal after sending
  }, []);

  // ── Timer per round ──
  useEffect(() => {
    if (!roomData || roomData.status !== 'playing' || myAnswer !== null) return;

    const roundKey = `round_${roomData.gameData?.currentRound}`;
    const answers = roomData.gameData?.answers?.[roundKey] || {};
    if (answers[user?.id]) return; // Already answered

    setTimeLeft(TIMER_SEC);
    timerBarAnim.setValue(1);
    Animated.timing(timerBarAnim, { toValue: 0, duration: TIMER_SEC * 1000, useNativeDriver: false }).start();

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
  }, [roomData?.gameData?.currentRound, roomData?.status, myAnswer]);

  // ── Reset answer on new round ──
  useEffect(() => {
    setMyAnswer(null);
  }, [roomData?.gameData?.currentRound]);

  // ── Auto-advance when both answered ──
  useEffect(() => {
    if (!roomData || roomData.status !== 'playing' || !user?.id) return;
    // Either player can advance (fixes host-disconnect freeze)
    // Use a lock so only one player actually writes

    const round = roomData.gameData?.currentRound || 1;
    const roundKey = `round_${round}`;
    const answers = roomData.gameData?.answers?.[roundKey] || {};
    const playerCount = roomData.currentPlayers || 2;
    const answeredCount = Object.keys(answers).length;

    const advanceKey = `advance_${round}`;
    if (answeredCount >= playerCount && !processedRef.current.has(advanceKey)) {
      processedRef.current.add(advanceKey);

      // ── Compute scores from scratch across ALL rounds (single source of truth) ──
      const allAnswers = roomData.gameData?.answers || {};
      const questions = roomData.gameData?.questions || [];
      const scores = {};
      // Initialize scores for all players
      Object.keys(roomData.players || {}).forEach(pid => { scores[pid] = 0; });

      for (let r = 1; r <= round; r++) {
        const rKey = `round_${r}`;
        const rAnswers = allAnswers[rKey] || {};
        const q = questions[r - 1];

        // Add PTS_CORRECT for correct answers
        let speedBonusPlayer = null;
        let earliest = Infinity;
        Object.entries(rAnswers).forEach(([pid, ans]) => {
          if (ans.isCorrect) {
            scores[pid] = (scores[pid] || 0) + PTS_CORRECT;
            if (ans.timestamp < earliest) {
              earliest = ans.timestamp;
              speedBonusPlayer = pid;
            }
          }
        });

        // Speed bonus: only if multiple correct answers in the round
        const correctCount = Object.values(rAnswers).filter(a => a.isCorrect).length;
        if (speedBonusPlayer && correctCount >= 2) {
          scores[speedBonusPlayer] = (scores[speedBonusPlayer] || 0) + PTS_SPEED_BONUS;
        }
      }

      // Show round transition countdown
      setRoundTransition(3);
      setTimeout(async () => {
        try {
          const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
          if (round >= TOTAL_ROUNDS) {
            setRoundTransition(0);
            // Determine winner
            const playerIds = Object.keys(scores);
            const sorted = playerIds.sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
            const topScore = scores[sorted[0]] || 0;
            const isTie = sorted.length >= 2 && (scores[sorted[1]] || 0) === topScore;
            const winnerId = sorted[0];
            const winnerName = isTie ? 'Draw' : (roomData.players?.[winnerId]?.displayName || 'Player');

            await updateDoc(roomRef, {
              status: 'finished',
              'gameData.scores': scores,
              'gameData.winner': { playerId: winnerId, playerName: winnerName, score: topScore, isTie },
              'gameData.endedAt': serverTimestamp(),
            });

            // Award points to winner (skip if tie)
            if (appdatabase && !isTie) {
              awardGameWin(appdatabase, firestoreDB, winnerId).catch(() => {});
            }
          } else {
            setRoundTransition(0);
            await updateDoc(roomRef, {
              'gameData.currentRound': round + 1,
              'gameData.scores': scores,
            });
          }
        } catch (err) {
          console.warn('[QuizBattle] advance error:', err?.message);
        }
      }, 3000); // 3s pause for round transition countdown
    }
  }, [roomData]);

  // ── Create room ──
  const handleCreate = useCallback(async () => {
    if (!user?.id || !firestoreDB) return;
    setLoading(true);
    triggerHapticFeedback('impactLight');

    try {
      // Clean up old abandoned quiz rooms by this user
      try {
        const roomsRef = collection(firestoreDB, 'petGuessingGame_rooms');
        const oldRoomsQuery = query(roomsRef, where('hostId', '==', user.id), where('gameType', '==', 'quiz'));
        const oldSnap = await getDocs(oldRoomsQuery);
        const TEN_MIN = 10 * 60 * 1000;
        oldSnap.forEach(async (d) => {
          const rd = d.data();
          const created = rd.createdAt?.toMillis?.() || rd.createdAt || 0;
          if ((rd.status === 'waiting' || rd.status === 'finished') && (Date.now() - created > TEN_MIN)) {
            await deleteDoc(doc(firestoreDB, 'petGuessingGame_rooms', d.id)).catch(() => {});
          }
        });
      } catch {}

      const id = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const questions = shuffle(ALL_QUESTIONS).slice(0, TOTAL_ROUNDS).map(q => ({
        ...q,
        opts: shuffle(q.opts),
      }));

      await setDoc(doc(firestoreDB, 'petGuessingGame_rooms', id), {
        hostId: user.id,
        hostName: user.displayName || 'Anonymous',
        hostAvatar: user.avatar || null,
        gameType: 'quiz',
        status: 'waiting',
        maxPlayers: 2,
        currentPlayers: 1,
        createdAt: serverTimestamp(),
        players: {
          [user.id]: {
            displayName: user.displayName || 'Anonymous',
            avatar: user.avatar || null,
            joinedAt: serverTimestamp(),
            score: 0,
          },
        },
        invites: {},
        gameData: {
          questions,
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
      showErrorMessage('Error', 'Failed to create quiz room');
    } finally {
      setLoading(false);
    }
  }, [user, firestoreDB, triggerHapticFeedback]);

  // ── Answer a question ──
  const handleAnswer = useCallback(async (answer) => {
    if (myAnswer !== null || !roomData || !firestoreDB || !user?.id) return;
    clearInterval(timerRef.current);

    const round = roomData.gameData?.currentRound || 1;
    const q = roomData.gameData?.questions?.[round - 1];
    const isCorrect = answer === q?.a;
    setMyAnswer(answer || '__timeout__');

    if (isCorrect) triggerHapticFeedback('notificationSuccess');

    try {
      const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
      const roundKey = `round_${round}`;

      // ── Atomic per-player write using dot-notation (no race condition) ──
      await updateDoc(roomRef, {
        [`gameData.answers.${roundKey}.${user.id}`]: {
          selectedAnswer: answer,
          isCorrect,
          timestamp: Date.now(),
        },
      });
    } catch (err) {
      console.warn('[QuizBattle] answer error:', err?.message);
    }
  }, [myAnswer, roomData, firestoreDB, user?.id, roomId, triggerHapticFeedback]);

  // ── Leave room ──
  const handleLeave = useCallback(async () => {
    if (!roomId || !user?.id) return;

    // If game is in progress, forfeit — award win to opponent
    if (roomData?.status === 'playing') {
      try {
        const opId = Object.keys(roomData.players || {}).find(id => id !== user.id);
        if (opId) {
          const scores = roomData.gameData?.scores || {};
          const winnerName = roomData.players?.[opId]?.displayName || 'Player';
          const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
          await updateDoc(roomRef, {
            status: 'finished',
            'gameData.winner': { playerId: opId, playerName: winnerName, score: scores[opId] || 0, forfeit: true },
            'gameData.endedAt': serverTimestamp(),
          });
          if (appdatabase) {
            awardGameWin(appdatabase, firestoreDB, opId).catch(() => {});
          }
        }
      } catch {}
    }

    await leaveGameRoom(firestoreDB, roomId, user.id);
    setRoomId(null);
    setRoomData(null);
    setPendingInvites([]);
    processedRef.current.clear();
  }, [roomId, user?.id, firestoreDB, roomData, appdatabase]);

  // ── Rematch: leave old room, create new, auto-invite opponent ──
  const handleRematch = useCallback(async () => {
    if (!user?.id || !firestoreDB) return;
    const opponent = lastOpponentRef.current;
    if (!opponent?.id) { showErrorMessage('Error', 'No opponent to rematch'); return; }

    setLoading(true);
    triggerHapticFeedback('impactLight');

    try {
      if (roomId) {
        await leaveGameRoom(firestoreDB, roomId, user.id).catch(() => {});
      }
      setRoomId(null); setRoomData(null); setPendingInvites([]); processedRef.current.clear();

      const id = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const questions = shuffle(ALL_QUESTIONS).slice(0, TOTAL_ROUNDS).map(q => ({
        ...q,
        opts: shuffle(q.opts),
      }));

      await setDoc(doc(firestoreDB, 'petGuessingGame_rooms', id), {
        hostId: user.id,
        hostName: user.displayName || 'Anonymous',
        hostAvatar: user.avatar || null,
        gameType: 'quiz',
        status: 'waiting',
        maxPlayers: 2,
        currentPlayers: 1,
        createdAt: serverTimestamp(),
        players: { [user.id]: { displayName: user.displayName || 'Anonymous', avatar: user.avatar || null, joinedAt: serverTimestamp(), score: 0 } },
        invites: {},
        gameData: {
          questions,
          currentRound: 1,
          totalRounds: TOTAL_ROUNDS,
          scores: { [user.id]: 0 },
          playerOrder: [user.id],
          answers: {},
        },
      });

      setRoomId(id);
      await sendGameInvite(firestoreDB, id, user, opponent.id);
      showSuccessMessage('Rematch!', `Invite sent to ${opponent.displayName || 'opponent'}`);
    } catch (err) {
      showErrorMessage('Error', 'Failed to create rematch');
    } finally {
      setLoading(false);
    }
  }, [user, firestoreDB, triggerHapticFeedback, roomId]);

  // ── Derived state ──
  const round = roomData?.gameData?.currentRound || 1;
  const question = roomData?.gameData?.questions?.[round - 1];
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

  // ── No room: Create screen ──
  if (!roomId) {
    return (
      <ScrollView style={[s.wrap, { backgroundColor: bg }]} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <View style={s.headerRow}>
          <Text style={{ fontSize: 28 }}>🧠</Text>
          <View style={{ marginLeft: 10, flex: 1 }}>
            <Text style={[s.h1, { color: txt }]}>Quiz Battle</Text>
            <Text style={[s.sub, { color: sub }]}>Challenge a friend to pet trivia!</Text>
          </View>
        </View>

        <TouchableOpacity style={s.createBtn} onPress={handleCreate} disabled={loading || !user?.id}>
          {loading ? <ActivityIndicator color="#fff" /> : (
            <>
              <Icon name="flash" size={22} color="#fff" />
              <Text style={s.createBtnTxt}>{user?.id ? 'Create Quiz Battle' : 'Login to Play'}</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={[s.card, { backgroundColor: cardBg }]}> 
          <Text style={[s.cardTitle, { color: txt }]}>🎮 How it Works</Text>
          <Text style={[s.cardBody, { color: sub }]}>
            {'• Create a room & invite a friend\n• Both see the same question\n• 12 seconds to answer each\n• +20 XP per correct answer\n• +10 bonus for fastest correct\n• 5 rounds, highest score wins!\n\n🏆 Winner gets 100 XP!'}
          </Text>
        </View>
      </ScrollView>
    );
  }

  // ── Waiting for players ──
  if (roomData?.status === 'waiting') {
    return (
      <ScrollView style={[s.wrap, { backgroundColor: bg }]} contentContainerStyle={{ padding: 20, alignItems: 'center' }}>
        <Text style={[s.h1, { color: txt }]}>🧠 Quiz Battle</Text>

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

  // ── Playing ──
  if (roomData?.status === 'playing' && question) {
    const myAnswered = myAnswer !== null;
    const opAnswered = !!roundAnswers[opponentId];
    const showResults = bothAnswered || myAnswer !== null;
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

        {/* Header: Round + Scores */}
        <View style={s.gameHeader}>
          <Text style={[s.roundLabel, { color: sub }]}>Round {round}/{TOTAL_ROUNDS}</Text>
          <View style={s.scoresRow}>
            {playerIds.map(pid => {
              const isMe = pid === user?.id;
              const name = roomData.players[pid]?.displayName?.split(' ')[0]?.slice(0, 8) || 'P';
              return (
                <View key={pid} style={[s.scoreChip, { backgroundColor: isMe ? '#8B5CF618' : '#10B98118' }]}>
                  <Text numberOfLines={1} style={[s.scoreChipName, { color: isMe ? '#8B5CF6' : '#10B981' }]}>{name}</Text>
                  <Text style={[s.scoreChipVal, { color: isMe ? '#8B5CF6' : '#10B981' }]}>{scores[pid] || 0}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* Timer */}
        <View style={s.timerWrap}>
          <Animated.View style={[s.timerBar, {
            width: timerBarAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            backgroundColor: timeLeft <= 4 ? '#EF4444' : '#8B5CF6',
          }]} />
        </View>
        <Text style={[s.timerText, { color: timeLeft <= 4 ? '#EF4444' : '#8B5CF6', alignSelf: 'flex-end' }]}>{timeLeft}s</Text>

        {/* Question */}
        <View style={[s.qCard, { backgroundColor: cardBg }]}>
          <Text style={[s.qText, { color: txt }]}>{question.q}</Text>
        </View>

        {/* Options (FIXED HEIGHT) */}
        <View style={{ gap: 10, marginTop: 12 }}>
          {question.opts.map((opt, i) => {
            const isCorrect = opt === question.a;
            const isMine = myAnswer === opt;
            const optColor = showResults
              ? isCorrect ? '#10B981' : isMine ? '#EF4444' : (isDarkMode ? '#1e293b' : '#f1f5f9')
              : isDarkMode ? '#1e293b' : '#f1f5f9';
            const optTxt = showResults && (isCorrect || isMine) ? '#fff' : txt;

            return (
              <TouchableOpacity
                key={i}
                style={[s.optBtn, { backgroundColor: optColor, borderColor: showResults && isCorrect ? '#10B981' : 'transparent' }]}
                onPress={() => handleAnswer(opt)}
                disabled={myAnswer !== null}
                activeOpacity={0.7}
              >
                <Text style={[s.optLetter, { color: optTxt }]}>{String.fromCharCode(65 + i)}</Text>
                <Text style={[s.optText, { color: optTxt }]} numberOfLines={2}>{opt}</Text>
                {showResults && isCorrect && <Icon name="checkmark-circle" size={18} color="#fff" />}
                {showResults && isMine && !isCorrect && <Icon name="close-circle" size={18} color="#fff" />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Opponent result after both answered */}
        {bothAnswered && opponentAnswer && (
          <View style={[s.opponentResult, { backgroundColor: cardBg }]}>
            <Image source={{ uri: roomData.players[opponentId]?.avatar || '' }} style={s.miniAvatar} />
            <Text style={{ color: txt, fontWeight: '600', fontSize: 13 }} numberOfLines={1}>
              {roomData.players[opponentId]?.displayName?.split(' ')[0]} {opponentAnswer.isCorrect ? '✅ Correct' : '❌ Wrong'}
            </Text>
          </View>
        )}
      </ScrollView>
    );
  }

  // ── Finished ──
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
            <Icon name="people" size={18} color="#8B5CF6" />
            <Text style={s.rematchBtnTxt}>{loading ? 'Creating...' : `Rematch ${lastOpponentRef.current?.displayName?.split(' ')[0] || 'Opponent'}`}</Text>
          </TouchableOpacity>
        )}

        {/* Watch Ad for bonus XP */}
        {!adBonusClaimed && (
          <TouchableOpacity
            style={[s.createBtn, { marginTop: 10, backgroundColor: '#F59E0B' }]}
            onPress={async () => {
              if (adBonusLoading) return;
              setAdBonusLoading(true);
              const earned = await RewardedAdManager.show();
              setAdBonusLoading(false);
              if (earned) {
                setAdBonusClaimed(true);
                if (appdatabase && user?.id) addXP(appdatabase, user.id, 50).catch(() => {});
                showSuccessMessage('Bonus!', '+50 XP earned! 🎉');
                // Persist to Firestore
                if (firestoreDB && user?.id) {
                  setDoc(doc(firestoreDB, 'games', user.id), { lastQuizBattleAdAt: new Date() }, { merge: true }).catch(() => {});
                }
              }
            }}
            disabled={adBonusLoading}
          >
            <Icon name={adBonusLoading ? 'hourglass' : 'videocam'} size={20} color="#fff" />
            <Text style={s.createBtnTxt}>{adBonusLoading ? 'Loading...' : '🎬 Watch Ad for +50 XP!'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  }

  // ── Loading ──
  return (
    <View style={[s.wrap, { backgroundColor: bg, justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator size="large" color="#8B5CF6" />
      <Text style={[s.sub, { color: sub, marginTop: 8 }]}>Loading...</Text>
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
    backgroundColor: '#8B5CF6', paddingVertical: 16, paddingHorizontal: 28, borderRadius: 18, marginTop: 16,
    shadowColor: '#8B5CF6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  createBtnTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  inviteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#3B82F6', paddingVertical: 14, paddingHorizontal: 28, borderRadius: 16, marginTop: 16,
  },
  inviteBtnTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  rematchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, paddingHorizontal: 24, borderRadius: 16, borderWidth: 2, borderColor: '#8B5CF6',
  },
  rematchBtnTxt: { color: '#8B5CF6', fontSize: 15, fontWeight: '800' },

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
  qCard: {
    borderRadius: 18, padding: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 6 },
      android: { elevation: 3 },
    }),
  },
  qText: { fontSize: 16, fontWeight: '700', lineHeight: 22 },

  // ── Options (fixed min height) ──
  optBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16, paddingHorizontal: 14, borderRadius: 14, borderWidth: 2, minHeight: 56 },
  optLetter: { fontSize: 14, fontWeight: '800', width: 22, textAlign: 'center' },
  optText: { fontSize: 13, fontWeight: '600', flex: 1 },

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
  finalScore: { color: '#8B5CF6', fontWeight: '800', fontSize: 20 },

  // ── Status banner (FIXED HEIGHT — no glitching) ──
  statusBanner: {
    backgroundColor: 'rgba(139, 92, 246, 0.92)', borderRadius: 14,
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

export default QuizBattle;
