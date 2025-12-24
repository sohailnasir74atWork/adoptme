// gameInviteSystem.js
import { ref, set, update, remove, get, onValue, push, query as dbQuery, orderByKey, limitToFirst } from '@react-native-firebase/database';
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
 *
 * - Points are still stored in RTDB under `users/{uid}/rewardPoints`
 *   (to keep existing reward system working)
 * - Win count is stored only in Firestore (not RTDB) under `game_stats/{uid}`
 * - Last win timestamp is stored in RTDB (`lastGameWinAt`) for chat badge
 */
export const awardGameWin = async (appdatabase, firestoreDB, userId) => {
  if (!appdatabase || !firestoreDB || !userId) return false;

  try {
    // ✅ Update reward points in RTDB (existing behaviour)
    const userRef = ref(appdatabase, `users/${userId}`);
    const userSnap = await get(userRef);
    const existing = userSnap.exists() ? userSnap.val() || {} : {};
    const currentPoints = existing.rewardPoints ? Number(existing.rewardPoints) : 0;

    const newPoints = currentPoints + 100;
    const now = Date.now();

    await update(userRef, {
      rewardPoints: newPoints,
      lastGameWinAt: now, // ✅ store last win timestamp in RTDB for chat badge
    });

    // ✅ Track total wins only in Firestore (not RTDB)
    const statsRef = doc(firestoreDB, 'game_stats', userId);
    const statsSnap = await getDoc(statsRef);
    const statsData = statsSnap.exists ? statsSnap.data() || {} : {};
    const currentWins = statsData.petGameWins ? Number(statsData.petGameWins) : 0;
    const newWins = currentWins + 1;

    await setDoc(
      statsRef,
      { petGameWins: newWins },
      { merge: true },
    );

    return { points: newPoints, wins: newWins, lastGameWinAt: now };
  } catch (error) {
    console.error('Error awarding game win:', error);
    return false;
  }
};

/**
 * Select 8 random pets from pet data within the same value slab
 * Value slabs: 0-1, 1-20, 20-50, 50-100, 100+
 */
export const selectRandomPets = (petData, count = 8) => {
  if (!petData || petData.length === 0) return [];
  
  // Filter only PETS type (not eggs, vehicles, etc.)
  const petsOnly = petData.filter(item => 
    item?.type?.toLowerCase() === 'pets' || item?.type?.toLowerCase() === 'pet'
  );
  
  if (petsOnly.length === 0) return [];
  
  // Define value slabs
  const valueSlabs = [
    { min: 0, max: 1, name: '0-1' },
    { min: 1, max: 20, name: '1-20' },
    { min: 20, max: 50, name: '20-50' },
    { min: 50, max: 100, name: '50-100' },
    { min: 100, max: Infinity, name: '100+' },
  ];
  
  // Group pets by value slabs
  const petsBySlab = {};
  petsOnly.forEach(pet => {
    const value = Number(pet.rvalue || pet.value || 0);
    
    // Find which slab this pet belongs to
    // Slabs: 0-1, 1-20, 20-50, 50-100, 100+
    // Handle boundaries: 0-1 includes [0, 1], others use (min, max] to avoid overlap
    for (const slab of valueSlabs) {
      let belongsToSlab = false;
      
      if (slab.max === Infinity) {
        // For 100+ slab, include values > 100 (exclude exactly 100, it's in 50-100)
        belongsToSlab = value > 100;
      } else if (slab.min === 0 && slab.max === 1) {
        // For 0-1 slab, include values >= 0 and <= 1
        belongsToSlab = value >= 0 && value <= 1;
      } else {
        // For other slabs (1-20, 20-50, 50-100), use > min and <= max
        // 1-20: (1, 20], 20-50: (20, 50], 50-100: (50, 100]
        belongsToSlab = value > slab.min && value <= slab.max;
      }
      
      if (belongsToSlab) {
        if (!petsBySlab[slab.name]) {
          petsBySlab[slab.name] = [];
        }
        petsBySlab[slab.name].push({
          id: pet.id || pet.name,
          name: pet.name,
          image: pet.image || null,
          value: value,
          rarity: pet.rarity || 'Common',
        });
        break;
      }
    }
  });
  
  // Find slabs that have at least 'count' pets
  const validSlabs = Object.keys(petsBySlab).filter(
    slabName => petsBySlab[slabName].length >= count
  );
  
  if (validSlabs.length === 0) {
    // If no slab has enough pets, use the slab with the most pets
    const slabWithMostPets = Object.keys(petsBySlab).reduce((a, b) => 
      petsBySlab[a].length > petsBySlab[b].length ? a : b
    );
    const selectedSlab = petsBySlab[slabWithMostPets] || [];
    const shuffled = [...selectedSlab].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }
  
  // Randomly select one slab that has enough pets
  const randomSlabName = validSlabs[Math.floor(Math.random() * validSlabs.length)];
  const selectedSlab = petsBySlab[randomSlabName];
  
  // Shuffle and pick 'count' pets from the selected slab
  const shuffled = [...selectedSlab].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
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
    // ✅ Check if invited user is in an active game
    const isInActiveGame = await isUserInActiveGame(firestoreDB, invitedUserId);
    if (isInActiveGame) {
      return false; // User is already playing, don't send invite
    }

    // ✅ Invitation expires after 1 minute if not received (for testing)
    const INVITE_EXPIRY_MS = 60000; // 1 minute (for testing)
    const expiresAt = Date.now() + INVITE_EXPIRY_MS;

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
      expiresAt: expiresAt, // ✅ Expiration timestamp
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
      expiresAt: expiresAt, // ✅ Expiration timestamp
    });

    // ✅ Schedule cleanup of expired invite after expiry time
    setTimeout(async () => {
      try {
        // Check if invite is still pending (not accepted/declined)
        const checkRoomSnap = await getDoc(roomRef);
        if (checkRoomSnap.exists) {
          const checkRoomData = checkRoomSnap.data();
          const checkInvites = checkRoomData.invites || {};
          if (checkInvites[invitedUserId]?.status === 'pending') {
            // Invite expired and not received - delete it
            delete checkInvites[invitedUserId];
            await updateDoc(roomRef, { invites: checkInvites });
          }
        }

        // Also delete from user's invite list
        const checkUserInviteRef = doc(
          firestoreDB,
          'petGuessingGame_userInvites',
          invitedUserId,
          'invites',
          roomId
        );
        const checkUserInviteSnap = await getDoc(checkUserInviteRef);
        if (checkUserInviteSnap.exists) {
          const checkUserInviteData = checkUserInviteSnap.data();
          if (checkUserInviteData.status === 'pending') {
            await deleteDoc(checkUserInviteRef);
          }
        }
      } catch (error) {
        console.error('Error cleaning up expired invite:', error);
      }
    }, INVITE_EXPIRY_MS);

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
  if (!firestoreDB || !roomId || !userId) {
    return { success: false, error: 'Invalid parameters' };
  }

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);

    if (!roomSnap.exists) {
      return { success: false, error: 'Room does not exist' };
    }

    const roomData = roomSnap.data();

    // Check if user is already in the room
    if (roomData.players && roomData.players[userId]) {
      return { success: false, error: 'You are already in this game' };
    }

    if (roomData.status !== 'waiting') {
      return { success: false, error: 'This game has already started or finished' };
    }

    if (roomData.currentPlayers >= roomData.maxPlayers) {
      return { success: false, error: 'This game is full. Another player already joined and the game is starting.' };
    }

    // ✅ Check if invite exists and is not expired
    const invites = roomData.invites || {};
    const invite = invites[userId];
    if (invite) {
      const now = Date.now();
      const inviteTimestamp = invite.timestamp?.toMillis?.() || invite.timestamp || Date.now();
      const expiresAt = invite.expiresAt || (inviteTimestamp + 60000); // 1 minute default (for testing)
      
      if (now > expiresAt && invite.status === 'pending') {
        // Invite expired - remove it
        delete invites[userId];
        await updateDoc(roomRef, { invites });
        
        // Also delete from user's invite list
        const userInviteRef = doc(
          firestoreDB,
          'petGuessingGame_userInvites',
          userId,
          'invites',
          roomId
        );
        await deleteDoc(userInviteRef).catch(err => 
          console.error('Error deleting expired user invite:', err)
        );
        
        return { success: false, error: 'This invitation has expired. Please ask for a new invite.' };
      }
    }

    // Add player to room
    const players = roomData.players || {};
    // invites already declared above
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

    // Auto-start game if 2 players have joined
    const newPlayerCount = roomData.currentPlayers + 1;
    if (newPlayerCount >= roomData.maxPlayers && roomData.hostId) {
      // Auto-start the game
      await startGame(firestoreDB, roomId, roomData.hostId);
    }

    return { success: true };
  } catch (error) {
    console.error('Error accepting invite:', error);
    return { success: false, error: 'Failed to join game. Please try again.' };
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
    async (snapshot) => {
      const invites = [];
      const now = Date.now();
      const expiredInviteIds = [];
      
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const timestamp = data.timestamp?.toMillis?.() || data.timestamp || Date.now();
        const expiresAt = data.expiresAt || (timestamp + 60000); // Default 1 minute if not set (for testing)
        
        // ✅ Filter out expired invites (not received within time limit)
        if (now > expiresAt && data.status === 'pending') {
          // Mark for deletion
          expiredInviteIds.push(docSnap.id);
          return; // Skip this invite
        }
        
        invites.push({
          roomId: docSnap.id,
          ...data,
          timestamp: timestamp,
          expiresAt: expiresAt,
        });
      });

      // ✅ Delete expired invites
      if (expiredInviteIds.length > 0) {
        expiredInviteIds.forEach(async (inviteId) => {
          try {
            const inviteRef = doc(
              firestoreDB,
              'petGuessingGame_userInvites',
              userId,
              'invites',
              inviteId
            );
            await deleteDoc(inviteRef);
          } catch (error) {
            console.error('Error deleting expired invite:', error);
          }
        });
      }

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
 * Clean up expired invites from a room
 */
export const cleanupExpiredInvites = async (firestoreDB, roomId) => {
  if (!firestoreDB || !roomId) return false;

  try {
    const roomRef = doc(firestoreDB, 'petGuessingGame_rooms', roomId);
    const roomSnap = await getDoc(roomRef);
    
    if (!roomSnap.exists) return false;

    const roomData = roomSnap.data();
    const invites = roomData.invites || {};
    const now = Date.now();
    let hasExpired = false;

    // Check each invite for expiration
    Object.keys(invites).forEach((userId) => {
      const invite = invites[userId];
      if (invite.status === 'pending') {
        const expiresAt = invite.expiresAt || (invite.timestamp?.toMillis?.() || Date.now()) + 60000; // 1 minute (for testing)
        if (now > expiresAt) {
          // Invite expired - remove it
          delete invites[userId];
          hasExpired = true;
          
          // Also delete from user's invite list
          const userInviteRef = doc(
            firestoreDB,
            'petGuessingGame_userInvites',
            userId,
            'invites',
            roomId
          );
          deleteDoc(userInviteRef).catch(err => 
            console.error('Error deleting expired user invite:', err)
          );
        }
      }
    });

    // Update room if any invites expired
    if (hasExpired) {
      await updateDoc(roomRef, { invites });
    }

    return hasExpired;
  } catch (error) {
    console.error('Error cleaning up expired invites:', error);
    return false;
  }
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
 * Get ALL online user IDs from Firestore (optimized - only IDs, no details)
 * Returns all user IDs (filtered to exclude current user)
 * Same pattern as OnlineUsersList.jsx - fetch all IDs once, then batch load details
 */
export const getOnlineUserIdsForInvite = async (firestoreDB, currentUserId) => {
  if (!firestoreDB || !currentUserId) return [];

  try {
    // ✅ One-time fetch from Firestore (same pattern as OnlineUsersList.jsx)
    const onlineUsersDocRef = doc(firestoreDB, 'online_users', 'list');
    const docSnapshot = await getDoc(onlineUsersDocRef);

    if (!docSnapshot.exists) return [];

    const data = docSnapshot.data();
    const allUserIds = Array.isArray(data?.userIds) ? data.userIds : [];

    // Filter out current user and return ALL IDs (not just first N)
    const filteredIds = allUserIds.filter((id) => id !== currentUserId);
    return filteredIds;
  } catch (error) {
    console.error('Error getting online user IDs from Firestore:', error);
    return [];
  }
};

/**
 * Get more online user IDs from Firestore (for pagination - load next batch)
 * @deprecated Use getOnlineUserIdsForInvite to get all IDs, then slice client-side
 */
export const getMoreOnlineUserIds = async (firestoreDB, currentUserId, currentCount, batchSize = 6) => {
  if (!firestoreDB || !currentUserId) return [];

  try {
    // ✅ Fetch from Firestore online_users/list document
    const onlineUsersDocRef = doc(firestoreDB, 'online_users', 'list');
    const docSnapshot = await getDoc(onlineUsersDocRef);

    if (!docSnapshot.exists) return [];

    const data = docSnapshot.data();
    const allUserIds = Array.isArray(data?.userIds) ? data.userIds : [];

    // Filter out current user
    const filteredIds = allUserIds.filter((id) => id !== currentUserId);

    // Return only the new IDs (those beyond currentCount)
    if (filteredIds.length > currentCount) {
      return filteredIds.slice(currentCount, currentCount + batchSize);
    }

    return [];
  } catch (error) {
    console.error('Error getting more online user IDs from Firestore:', error);
    return [];
  }
};

/**
 * Fetch user details for specific user IDs (from Firestore only)
 * Same pattern as OnlineUsersList.jsx – read from `online_users/list.users`
 *
 * NOTE:
 * - RTDB is no longer used here (keeps this fast and cheap)
 * - `isPlaying` comes from Firestore if you later add it to `online_users/list.users[id]`
 */
export const fetchUserDetailsForInvite = async (appdatabase, firestoreDB, userIds) => {
  if (!firestoreDB || !userIds || !Array.isArray(userIds) || userIds.length === 0) return {};

  try {
    // ✅ Read once from Firestore `online_users/list` (same as OnlineUsersList.jsx)
    const onlineUsersDocRef = doc(firestoreDB, 'online_users', 'list');
    const docSnapshot = await getDoc(onlineUsersDocRef);

    if (!docSnapshot.exists) return {};

    const data = docSnapshot.data() || {};
    const usersMap =
      typeof data.users === 'object' && data.users !== null ? data.users : {};

    const userDetails = {};

    userIds.forEach((userId) => {
      const u = usersMap[userId] || {};
      userDetails[userId] = {
        id: userId,
        displayName: u.displayName || 'Anonymous',
        avatar:
          u.avatar ||
          'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        // If you later store isPlaying in Firestore, we can read it here:
        isPlaying: !!u.isPlaying,
      };
    });

    return userDetails;
  } catch (error) {
    console.error('Error fetching user details:', error);
    return {};
  }
};

/**
 * Get online users for inviting with their game status (optimized version)
 * Fetches ALL user IDs from Firestore, then fetches details for initial batch
 * Same pattern as OnlineUsersList.jsx - fetch all IDs once, batch load details
 * @deprecated Use getOnlineUserIdsForInvite + fetchUserDetailsForInvite for better performance
 */
export const getOnlineUsersForInvite = async (appdatabase, firestoreDB, currentUserId) => {
  if (!appdatabase || !firestoreDB || !currentUserId) return [];

  try {
    // ✅ Get ALL user IDs from Firestore (same pattern as OnlineUsersList.jsx)
    const allUserIds = await getOnlineUserIdsForInvite(firestoreDB, currentUserId);
    
    // ✅ Fetch details only for first 6 users from RTDB (initial batch)
    const initialBatch = allUserIds.slice(0, 6);
    const userDetails = await fetchUserDetailsForInvite(appdatabase, firestoreDB, initialBatch);
    
    return Object.values(userDetails);
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
    
    // If game has started or finished, preserve player data (don't delete from players object)
    // Only remove player if game is still waiting
    const players = { ...roomData.players };
    if (roomData.status === 'waiting') {
      delete players[userId];
    }
    // If game is playing or finished, keep player data for display

    // If host leaves and room is empty, delete room
    if (roomData.hostId === userId && roomData.currentPlayers <= 1) {
      await deleteDoc(roomRef);
    } else {
      const updateData = {
        currentPlayers: Math.max(0, roomData.currentPlayers - 1),
      };
      
      // Only update players object if game is waiting (we removed the player)
      if (roomData.status === 'waiting') {
        updateData.players = players;
      }
      
      await updateDoc(roomRef, updateData);
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

    // Verify host (allow auto-start when 2 players join)
    if (roomData.hostId !== hostId) {
      // Allow auto-start if 2 players have joined
      if (roomData.currentPlayers >= 2 && roomData.status === 'waiting') {
        // Continue with auto-start
      } else {
        return false; // Only host can start manually
      }
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


