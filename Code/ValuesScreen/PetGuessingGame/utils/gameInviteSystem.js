// gameInviteSystem.js
import { ref, set, update, remove, get, onValue, push } from '@react-native-firebase/database';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  increment,
  query,
  where,
  orderBy,
} from '@react-native-firebase/firestore';

/**
 * Award points and track win for game winner
 */
export const awardGameWin = async (appdatabase, userId) => {
  if (!appdatabase || !userId) return false;

  try {
    const userRef = ref(appdatabase, `users/${userId}`);
    
    // Get current points and wins
    const userSnap = await get(userRef);
    const currentPoints = userSnap.exists() && userSnap.val().rewardPoints 
      ? Number(userSnap.val().rewardPoints) 
      : 0;
    const currentWins = userSnap.exists() && userSnap.val().petGameWins 
      ? Number(userSnap.val().petGameWins) 
      : 0;

    // Award 100 points and increment wins
    const newPoints = currentPoints + 100;
    const newWins = currentWins + 1;

    await update(userRef, {
      rewardPoints: newPoints,
      petGameWins: newWins,
    });

    return { points: newPoints, wins: newWins };
  } catch (error) {
    console.error('Error awarding game win:', error);
    return false;
  }
};

/**
 * Select 8 random pets from pet data
 */
export const selectRandomPets = (petData, count = 8) => {
  if (!petData || petData.length === 0) return [];
  
  // Filter only PETS type (not eggs, vehicles, etc.)
  const petsOnly = petData.filter(item => 
    item?.type?.toLowerCase() === 'pets' || item?.type?.toLowerCase() === 'pet'
  );
  
  if (petsOnly.length === 0) return [];
  
  // Shuffle and pick random pets
  const shuffled = [...petsOnly].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length)).map(pet => ({
    id: pet.id || pet.name,
    name: pet.name,
    image: pet.image || null,
    value: Number(pet.rvalue || pet.value || 0),
    rarity: pet.rarity || 'Common',
  }));
};

/**
 * Create a new game room with 8 random pets
 */
export const createGameRoom = async (firestoreDB, hostUser, selectedPets = [], maxPlayers = 2) => {
  if (!firestoreDB || !hostUser?.id) return null;

  try {
    const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);

    // Get player order (host is first)
    const playerOrder = [hostUser.id];

    const roomData = {
      hostId: hostUser.id,
      hostName: hostUser.displayName || 'Anonymous',
      hostAvatar: hostUser.avatar || null,
      status: 'waiting',
      maxPlayers,
      currentPlayers: 1,
      createdAt: serverTimestamp(),
      players: {
        [hostUser.id]: {
          displayName: hostUser.displayName || 'Anonymous',
          avatar: hostUser.avatar || null,
          joinedAt: serverTimestamp(),
          score: 0,
        },
      },
      invites: {},
      // Store the 8 random pets for the wheel
      wheelPets: selectedPets,
      gameData: {
        currentRound: 1,
        totalRounds: 3,
        scores: {
          [hostUser.id]: 0,
        },
        currentTurnIndex: 0, // Index in playerOrder
        playerOrder: playerOrder,
        roundScores: {}, // { round1: { odyer3gj: 500, user2: 300 }, ... }
        spinHistory: [], // Track all spins
        startedAt: null,
        isSpinning: false,
      },
    };

    await setDoc(roomRef, roomData);
    return roomId;
  } catch (error) {
    console.error('Error creating game room:', error);
    return null;
  }
};

/**
 * Send invite to a user
 */
export const sendGameInvite = async (
  firestoreDB,
  roomId,
  fromUser,
  invitedUserId
) => {
  if (!firestoreDB || !roomId || !fromUser?.id || !invitedUserId) return false;

  try {
    // Add to room invites in Firestore
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);
    
    if (!roomSnap.exists) {
      return false; // Room doesn't exist
    }

    const roomData = roomSnap.data();
    const invites = roomData.invites || {};
    
    invites[invitedUserId] = {
      fromUserId: fromUser.id,
      fromUserName: fromUser.displayName || 'Anonymous',
      fromUserAvatar: fromUser.avatar || null,
      status: 'pending',
      timestamp: serverTimestamp(),
    };

    await updateDoc(roomRef, {
      invites,
    });

    // Add to user's invite list in Firestore (for real-time notifications)
    const userInviteRef = doc(
      firestoreDB,
      'petGuessingGame_userInvites',
      invitedUserId,
      'invites',
      roomId
    );
    await setDoc(userInviteRef, {
      roomId,
      fromUserId: fromUser.id,
      fromUserName: fromUser.displayName || 'Anonymous',
      fromUserAvatar: fromUser.avatar || null,
      status: 'pending',
      timestamp: serverTimestamp(),
    });

    return true;
  } catch (error) {
    console.error('Error sending invite:', error);
    return false;
  }
};

/**
 * Accept an invite
 */
export const acceptGameInvite = async (
  firestoreDB,
  roomId,
  userId,
  userData
) => {
  if (!firestoreDB || !roomId || !userId) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) {
      return false; // Room doesn't exist
    }

    const roomData = roomSnap.data();

    if (roomData.status !== 'waiting') {
      return false; // Room already started
    }

    if (roomData.currentPlayers >= roomData.maxPlayers) {
      return false; // Room is full
    }

    // Add player to room
    const players = roomData.players || {};
    const invites = roomData.invites || {};
    const playerOrder = roomData.gameData?.playerOrder || [roomData.hostId];
    const scores = roomData.gameData?.scores || {};
    
    players[userId] = {
      displayName: userData?.displayName || 'Anonymous',
      avatar: userData?.avatar || null,
      joinedAt: serverTimestamp(),
      score: 0,
    };

    // Add to player order
    if (!playerOrder.includes(userId)) {
      playerOrder.push(userId);
    }

    // Initialize score
    scores[userId] = 0;

    if (invites[userId]) {
      invites[userId].status = 'accepted';
    }

    await updateDoc(roomRef, {
      players,
      invites,
      currentPlayers: increment(1),
      'gameData.playerOrder': playerOrder,
      'gameData.scores': scores,
    });

    // Update user invite status in Firestore
    const userInviteRef = doc(
      firestoreDB,
      'petGuessingGame_userInvites',
      userId,
      'invites',
      roomId
    );
    await updateDoc(userInviteRef, { status: 'accepted' });

    return true;
  } catch (error) {
    console.error('Error accepting invite:', error);
    return false;
  }
};

/**
 * Decline an invite
 */
export const declineGameInvite = async (firestoreDB, roomId, userId) => {
  if (!firestoreDB || !roomId || !userId) return false;

  try {
    // Update room invite status in Firestore
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);
    
    if (roomSnap.exists) {
      const roomData = roomSnap.data();
      const invites = roomData.invites || {};
      
      if (invites[userId]) {
        invites[userId].status = 'declined';
        await updateDoc(roomRef, { invites });
      }
    }

    // Update user invite status in Firestore
    const userInviteRef = doc(
      firestoreDB,
      'petGuessingGame_userInvites',
      userId,
      'invites',
      roomId
    );
    await updateDoc(userInviteRef, { status: 'declined' });

    return true;
  } catch (error) {
    console.error('Error declining invite:', error);
    return false;
  }
};

/**
 * Listen to user's pending invites
 */
export const listenToUserInvites = (firestoreDB, userId, callback) => {
  if (!firestoreDB || !userId) return () => {};

  const invitesCollectionRef = collection(
    firestoreDB,
    'petGuessingGame_userInvites',
    userId,
    'invites'
  );
  
  const q = query(
    invitesCollectionRef,
    where('status', '==', 'pending'),
    orderBy('timestamp', 'desc')
  );
  
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const invites = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        invites.push({
          roomId: doc.id,
          ...data,
          timestamp: data.timestamp?.toMillis?.() || data.timestamp || Date.now(),
        });
      });

      callback(invites);
    },
    (error) => {
      console.error('Error listening to invites:', error);
      callback([]);
    }
  );

  return unsubscribe;
};

/**
 * Check if a user is currently in an active game (status 'playing')
 */
export const isUserInActiveGame = async (firestoreDB, userId) => {
  if (!firestoreDB || !userId) return false;

  try {
    const roomsRef = collection(firestoreDB, 'petGuessingGame_rooms');
    const q = query(
      roomsRef,
      where('status', '==', 'playing')
    );
    
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      // Check if user is in any of these active rooms
      for (const docSnap of snapshot.docs) {
        const roomData = docSnap.data();
        if (roomData.players && roomData.players[userId]) {
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error('Error checking user game status:', error);
    return false;
  }
};

/**
 * Get online users for inviting with their game status
 */
export const getOnlineUsersForInvite = async (appdatabase, firestoreDB, currentUserId) => {
  if (!appdatabase || !currentUserId) return [];

  try {
    const onlineUsersRef = ref(appdatabase, 'online_users');
    const snapshot = await get(onlineUsersRef);

    if (!snapshot.exists()) return [];

    const onlineUserIds = Object.keys(snapshot.val()).filter(
      (id) => id !== currentUserId
    );

    // Fetch user details and check game status
    const userPromises = onlineUserIds.map(async (userId) => {
      try {
        const userRef = ref(appdatabase, `users/${userId}`);
        const userSnap = await get(userRef);
        
        if (userSnap.exists()) {
          const userData = userSnap.val();
          const isPlaying =  false;
          
          return {
            id: userId,
            displayName: userData?.displayName || 'Anonymous',
            avatar: userData?.avatar || null,
            isPlaying,
          };
        }
        return null;
      } catch (error) {
        return null;
      }
    });

    const users = await Promise.all(userPromises);
    return users.filter(Boolean);
  } catch (error) {
    console.error('Error getting online users:', error);
    return [];
  }
};

/**
 * Listen to room updates
 */
export const listenToGameRoom = (firestoreDB, roomId, callback) => {
  if (!firestoreDB || !roomId) return () => {};

  const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
  
  const unsubscribe = onSnapshot(
    roomRef,
    (snapshot) => {
      if (!snapshot.exists) {
        callback(null);
        return;
      }

      const roomData = snapshot.data();
      // Convert Firestore timestamps to numbers for compatibility
      const processedData = {
        ...roomData,
        id: snapshot.id,
        createdAt: roomData.createdAt?.toMillis?.() || roomData.createdAt || Date.now(),
        players: Object.entries(roomData.players || {}).reduce((acc, [key, value]) => {
          acc[key] = {
            ...value,
            joinedAt: value.joinedAt?.toMillis?.() || value.joinedAt || Date.now(),
          };
          return acc;
        }, {}),
        invites: Object.entries(roomData.invites || {}).reduce((acc, [key, value]) => {
          acc[key] = {
            ...value,
            timestamp: value.timestamp?.toMillis?.() || value.timestamp || Date.now(),
          };
          return acc;
        }, {}),
      };
      
      callback(processedData);
    },
    (error) => {
      console.error('Error listening to room:', error);
      callback(null);
    }
  );

  return unsubscribe;
};

/**
 * Leave a game room
 */
export const leaveGameRoom = async (firestoreDB, roomId, userId) => {
  if (!firestoreDB || !roomId || !userId) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();
    const players = { ...roomData.players };
    delete players[userId];

    // If host leaves and room is empty, delete room
    if (roomData.hostId === userId && roomData.currentPlayers <= 1) {
      await deleteDoc(roomRef);
    } else {
      await updateDoc(roomRef, {
        players,
        currentPlayers: Math.max(0, roomData.currentPlayers - 1),
      });
    }

    // Remove user invite from Firestore
    const userInviteRef = doc(
      firestoreDB,
      'petGuessingGame_userInvites',
      userId,
      'invites',
      roomId
    );
    await deleteDoc(userInviteRef);

    return true;
  } catch (error) {
    console.error('Error leaving room:', error);
    return false;
  }
};

/**
 * Start the game (host only, requires at least 2 players)
 */
export const startGame = async (firestoreDB, roomId, hostId) => {
  if (!firestoreDB || !roomId || !hostId) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();

    // Verify host
    if (roomData.hostId !== hostId) {
      return false; // Only host can start
    }

    // Check minimum players (2)
    if (roomData.currentPlayers < 2) {
      return false; // Need at least 2 players
    }

    // Check if already started
    if (roomData.status !== 'waiting') {
      return false; // Game already started
    }

    // Initialize scores for all players
    const scores = {};
    const playerOrder = roomData.gameData?.playerOrder || Object.keys(roomData.players);
    playerOrder.forEach(playerId => {
      scores[playerId] = 0;
    });

    // Start the game - turn based, 3 rounds
    await updateDoc(roomRef, {
      status: 'playing',
      'gameData.startedAt': serverTimestamp(),
      'gameData.currentRound': 1,
      'gameData.totalRounds': 3,
      'gameData.currentTurnIndex': 0, // First player's turn
      'gameData.playerOrder': playerOrder,
      'gameData.scores': scores,
      'gameData.roundScores': {},
      'gameData.spinHistory': [],
      'gameData.isSpinning': false,
      'gameData.lastSpinResult': null,
      'gameData.turnStartTime': serverTimestamp(), // Set initial turn start time
    });

    return true;
  } catch (error) {
    console.error('Error starting game:', error);
    return false;
  }
};

/**
 * Submit an answer for a challenge
 */
export const submitAnswer = async (firestoreDB, roomId, userId, answerData) => {
  if (!firestoreDB || !roomId || !userId || !answerData) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();

    // Check if game is playing
    if (roomData.status !== 'playing') {
      return false;
    }

    const round = answerData.round;
    const currentAnswers = roomData.gameData?.answers || {};
    const currentScores = roomData.gameData?.scores || {};

    // Initialize round answers if needed
    if (!currentAnswers[round]) {
      currentAnswers[round] = {};
    }

    // Check if already answered
    if (currentAnswers[round][userId]) {
      return false; // Already answered
    }

    // Save answer
    currentAnswers[round][userId] = {
      selectedAnswer: answerData.answer,
      isCorrect: answerData.isCorrect,
      timestamp: answerData.timestamp || Date.now(),
    };

    // Update score
    if (!currentScores[userId]) {
      currentScores[userId] = 0;
    }
    if (answerData.isCorrect) {
      currentScores[userId] = (currentScores[userId] || 0) + 1;
    }

    await updateDoc(roomRef, {
      'gameData.answers': currentAnswers,
      'gameData.scores': currentScores,
    });

    return true;
  } catch (error) {
    console.error('Error submitting answer:', error);
    return false;
  }
};

/**
 * Generate and save a challenge for a round (host only)
 */
export const generateChallengeForRound = async (
  firestoreDB,
  roomId,
  hostId,
  round,
  challengeData
) => {
  if (!firestoreDB || !roomId || !hostId || !round || !challengeData) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();

    // Verify host
    if (roomData.hostId !== hostId) {
      return false;
    }

    const challenges = roomData.gameData?.challenges || {};
    challenges[round] = challengeData;

    await updateDoc(roomRef, {
      'gameData.challenges': challenges,
    });

    return true;
  } catch (error) {
    console.error('Error generating challenge:', error);
    return false;
  }
};

/**
 * Advance to next round (host only, requires all players to have answered)
 */
export const advanceToNextRound = async (firestoreDB, roomId, hostId) => {
  if (!firestoreDB || !roomId || !hostId) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();

    // Verify host
    if (roomData.hostId !== hostId) {
      return false;
    }

    // Check if game is playing
    if (roomData.status !== 'playing') {
      return false;
    }

    const currentRound = roomData.gameData?.currentRound || 1;
    const totalRounds = roomData.gameData?.totalRounds || 5;
    const currentAnswers = roomData.gameData?.answers?.[currentRound] || {};
    const playerCount = roomData.currentPlayers || 0;

    // Check if all players have answered
    const answeredCount = Object.keys(currentAnswers).length;
    if (answeredCount < playerCount) {
      return false; // Not all players have answered
    }

    // Check if this is the last round
    if (currentRound >= totalRounds) {
      // End the game
      await updateDoc(roomRef, {
        status: 'finished',
        'gameData.endedAt': serverTimestamp(),
      });
    } else {
      // Advance to next round
      await updateDoc(roomRef, {
        'gameData.currentRound': currentRound + 1,
      });
    }

    return true;
  } catch (error) {
    console.error('Error advancing to next round:', error);
    return false;
  }
};

/**
 * Submit pet pick for current round
 */
export const submitPetPick = async (firestoreDB, roomId, userId, pickData) => {
  if (!firestoreDB || !roomId || !userId || !pickData) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();

    // Check if already picked
    if (roomData.gameData?.picks?.[userId]) {
      return false; // Already picked
    }

    // Check if countdown ended
    if (roomData.gameData?.countdownEnd && Date.now() > roomData.gameData.countdownEnd) {
      return false; // Too late
    }

    // Add pick
    const picks = roomData.gameData?.picks || {};
    picks[userId] = {
      ...pickData,
      timestamp: Date.now(),
    };

    // Check if all players picked
    const playerCount = roomData.currentPlayers || 0;
    const allPicked = Object.keys(picks).length >= playerCount;

    await updateDoc(roomRef, {
      'gameData.picks': picks,
      'gameData.allPicked': allPicked,
    });

    return true;
  } catch (error) {
    console.error('Error submitting pet pick:', error);
    return false;
  }
};

/**
 * Set round winner (after wheel spin)
 */
export const setGameWinner = async (firestoreDB, roomId, winnerData) => {
  if (!firestoreDB || !roomId || !winnerData) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    await updateDoc(roomRef, {
      'gameData.winner': winnerData,
      status: 'finished',
      'gameData.endedAt': serverTimestamp(),
    });

    return true;
  } catch (error) {
    console.error('Error setting game winner:', error);
    return false;
  }
};

/**
 * Record a wheel spin result and advance to next turn
 */
export const recordSpinResult = async (firestoreDB, roomId, userId, spinResult) => {
  if (!firestoreDB || !roomId || !userId || !spinResult) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();
    const gameData = roomData.gameData || {};
    const playerOrder = gameData.playerOrder || [];
    const currentTurnIndex = gameData.currentTurnIndex || 0;
    const currentRound = gameData.currentRound || 1;
    const totalRounds = gameData.totalRounds || 3;
    const scores = gameData.scores || {};
    const spinHistory = gameData.spinHistory || [];

    // Verify it's this user's turn
    if (playerOrder[currentTurnIndex] !== userId) {
      return false; // Not your turn
    }

    // Add spin to history
    const spinRecord = {
      playerId: userId,
      round: currentRound,
      petName: spinResult.petName,
      petValue: spinResult.petValue,
      petImage: spinResult.petImage || null,
      timestamp: Date.now(),
    };
    spinHistory.push(spinRecord);

    // Update score
    scores[userId] = (scores[userId] || 0) + spinResult.petValue;

    // Calculate next turn
    let nextTurnIndex = currentTurnIndex + 1;
    let nextRound = currentRound;
    let isGameFinished = false;

    // If we've gone through all players, advance to next round
    if (nextTurnIndex >= playerOrder.length) {
      nextTurnIndex = 0;
      nextRound = currentRound + 1;

      // Check if game is finished
      if (nextRound > totalRounds) {
        isGameFinished = true;
      }
    }

    const updateData = {
      'gameData.scores': scores,
      'gameData.spinHistory': spinHistory,
      'gameData.isSpinning': false,
      'gameData.lastSpinResult': spinResult,
    };

    if (isGameFinished) {
      // Game is finished - determine winner
      let winnerId = null;
      let maxScore = -1;
      Object.entries(scores).forEach(([playerId, score]) => {
        if (score > maxScore) {
          maxScore = score;
          winnerId = playerId;
        }
      });

      updateData['status'] = 'finished';
      updateData['gameData.endedAt'] = serverTimestamp();
      updateData['gameData.winner'] = {
        playerId: winnerId,
        score: maxScore,
      };
      
      // Note: Points and wins will be awarded by the client when they see the game finished
      // This prevents duplicate awards if multiple clients process the finish event
    } else {
      // Advance to next turn
      updateData['gameData.currentTurnIndex'] = nextTurnIndex;
      updateData['gameData.currentRound'] = nextRound;
      updateData['gameData.turnStartTime'] = serverTimestamp(); // Set new turn start time
    }

    await updateDoc(roomRef, updateData);
    return true;
  } catch (error) {
    console.error('Error recording spin result:', error);
    return false;
  }
};

/**
 * Set spinning state
 */
export const setSpinningState = async (firestoreDB, roomId, isSpinning) => {
  if (!firestoreDB || !roomId) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    await updateDoc(roomRef, {
      'gameData.isSpinning': isSpinning,
    });
    return true;
  } catch (error) {
    console.error('Error setting spinning state:', error);
    return false;
  }
};

/**
 * End game due to timeout or player leaving
 * This ends the game immediately and determines winner based on current scores
 */
export const endGameDueToTimeout = async (firestoreDB, roomId, timeoutUserId, reason = 'timeout') => {
  if (!firestoreDB || !roomId || !timeoutUserId) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();
    const gameData = roomData.gameData || {};
    const scores = gameData.scores || {};
    const spinHistory = gameData.spinHistory || [];

    // Get player name for the message
    const timeoutPlayerName = roomData.players?.[timeoutUserId]?.displayName || 'Player';

    // Add timeout record to history
    const timeoutRecord = {
      playerId: timeoutUserId,
      round: gameData.currentRound || 1,
      petName: reason === 'timeout' ? 'Game Ended (Timeout)' : 'Game Ended (Player Left)',
      petValue: 0,
      petImage: null,
      timestamp: Date.now(),
      timeout: true,
      reason: reason,
    };
    spinHistory.push(timeoutRecord);

    // Determine winner based on current scores
    let winnerId = null;
    let maxScore = -1;
    Object.entries(scores).forEach(([playerId, score]) => {
      if (score > maxScore) {
        maxScore = score;
        winnerId = playerId;
      }
    });

    // If scores are equal or no winner, set to null
    if (maxScore === 0 || !winnerId) {
      winnerId = null;
    }

    // End the game
    const updateData = {
      status: 'finished',
      'gameData.endedAt': serverTimestamp(),
      'gameData.scores': scores,
      'gameData.spinHistory': spinHistory,
      'gameData.isSpinning': false,
      'gameData.turnStartTime': null,
      'gameData.timeoutReason': reason === 'timeout' 
        ? `${timeoutPlayerName} timed out` 
        : `${timeoutPlayerName} left the game`,
      'gameData.winner': winnerId ? {
        playerId: winnerId,
        score: maxScore,
      } : null,
    };

    await updateDoc(roomRef, updateData);
    return true;
  } catch (error) {
    console.error('Error ending game due to timeout:', error);
    return false;
  }
};

/**
 * Set turn start time when a turn begins
 */
export const setTurnStartTime = async (firestoreDB, roomId) => {
  if (!firestoreDB || !roomId) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    await updateDoc(roomRef, {
      'gameData.turnStartTime': serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error('Error setting turn start time:', error);
    return false;
  }
};


