// PetGuessingGameScreen.jsx - Turn-based wheel spin game
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  AppState,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import InviteUsersModal from './components/InviteUsersModal';
import InviteNotification from './components/InviteNotification';
import PlayerCards from './components/PlayerCards';
import FortuneWheel from './components/FortuneWheel';
import GameResults from './components/GameResults';
import {
  createGameRoom,
  listenToGameRoom,
  leaveGameRoom,
  startGame,
  selectRandomPets,
  recordSpinResult,
  setSpinningState,
  startWheelSpin,
  awardGameWin,
  endGameDueToTimeout,
  setTurnStartTime,
} from './utils/gameInviteSystem';

const PetGuessingGameScreen = () => {
  const { appdatabase, firestoreDB, theme, user } = useGlobalState();
  const { localState } = useLocalState();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';

  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const processedGameFinishRef = useRef(new Set()); // Track processed game finishes
  const timeoutCheckIntervalRef = useRef(null); // For timeout checking
  const TURN_TIMEOUT_MS = 60000; // 60 seconds timeout per turn

  // Get pet data from localState (only PETS type)
  const petData = useMemo(() => {
    try {
      const rawData = localState.isGG ? localState.ggData : localState.data;
      if (!rawData) return [];

      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      const allItems = typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
      
      // Filter only pets
      return allItems.filter(item => 
        item?.type?.toLowerCase() === 'pets' || item?.type?.toLowerCase() === 'pet'
      );
    } catch (error) {
      console.error('Error parsing pet data:', error);
      return [];
    }
  }, [localState.isGG, localState.data, localState.ggData]);

  // Get image URL helper
  const getImageUrl = useCallback((item) => {
    if (!item || !item.name) return '';
    
    const baseImgUrl = localState.isGG ? localState.imgurlGG : localState.imgurl;
    
    if (localState.isGG) {
      const encoded = encodeURIComponent(item.name);
      return `${baseImgUrl?.replace(/"/g, '')}/items/${encoded}.webp`;
    }
    
    if (!item.image || !baseImgUrl) return '';
    return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}/${item.image.replace(/^\//, '')}`;
  }, [localState.isGG, localState.imgurl, localState.imgurlGG]);

  // Listen to room updates
  useEffect(() => {
    if (!currentRoomId || !firestoreDB) return;

    const unsubscribe = listenToGameRoom(firestoreDB, currentRoomId, (data) => {
      setRoomData(data);
      if (!data) {
        // Room was deleted
        setCurrentRoomId(null);
        setRoomData(null);
        return;
      }

      // Handle game finished due to timeout or player leaving
      if (data.status === 'finished' && data.gameData?.timeoutReason) {
        const gameId = data.id || currentRoomId;
        
        // Only process once per timeout finish
        if (!processedGameFinishRef.current.has(`timeout-${gameId}`)) {
          processedGameFinishRef.current.add(`timeout-${gameId}`);
          
          // Show timeout message
          const timeoutReason = data.gameData.timeoutReason;
          showErrorMessage(
            'Game Ended',
            timeoutReason || 'A player timed out or left the game'
          );
          
          // Clear room and return to create game screen after 2 seconds
          setTimeout(() => {
            setCurrentRoomId(null);
            setRoomData(null);
          }, 2000);
        }
        return;
      }

      // Award points when game finishes normally and user is winner
      if (data.status === 'finished' && data.gameData?.winner && user?.id && appdatabase) {
        const winnerId = data.gameData.winner.playerId;
        const gameId = data.id || currentRoomId;
        
        // Only process once per game finish
        if (winnerId === user.id && !processedGameFinishRef.current.has(gameId)) {
          processedGameFinishRef.current.add(gameId);
          
          awardGameWin(appdatabase, user.id)
            .then((result) => {
              if (result) {
                showSuccessMessage(
                  'Victory! 🎉',
                  `You won! +100 points! Total: ${result.points} points, Wins: ${result.wins}`
                );
              }
            })
            .catch((error) => {
              console.error('Error awarding game win:', error);
            });
        }
      }
    });

    return () => unsubscribe();
  }, [currentRoomId, firestoreDB, user?.id, appdatabase]);

  // Handle creating a new room with 10 random pets
  const handleCreateRoom = useCallback(async () => {
    if (!user?.id) {
      showErrorMessage('Error', 'Please login to create a game room');
      return;
    }

    if (petData.length < 10) {
      showErrorMessage('Error', 'Not enough pets available. Need at least 10 pets.');
      return;
    }

    setLoading(true);
    triggerHapticFeedback('impactLight');

    try {
      // Select 10 random pets with images
      const selectedPets = selectRandomPets(petData, 10).map(pet => ({
        ...pet,
        image: getImageUrl(pet),
      }));

      if (selectedPets.length < 10) {
        showErrorMessage('Error', 'Could not select enough pets');
        setLoading(false);
        return;
      }

      const roomId = await createGameRoom(
        firestoreDB,
        {
          id: user.id,
          displayName: user.displayName || 'Anonymous',
          avatar: user.avatar || null,
        },
        selectedPets,
        2 // max 2 players
      );

      if (roomId) {
        setCurrentRoomId(roomId);
        // showSuccessMessage('Room Created!', '8 random pets selected. Invite a friend to play!');
        setShowInviteModal(true);
      } else {
        showErrorMessage('Error', 'Failed to create room');
      }
    } catch (error) {
      console.error('Error creating room:', error);
      showErrorMessage('Error', 'Failed to create room');
    } finally {
      setLoading(false);
    }
  }, [user, firestoreDB, petData, getImageUrl, triggerHapticFeedback]);

  // Handle leaving room
  const handleLeaveRoom = useCallback(async () => {
    if (!currentRoomId || !user?.id) return;

    triggerHapticFeedback('impactLight');
    const success = await leaveGameRoom(firestoreDB, currentRoomId, user.id);
    
    if (success) {
      setCurrentRoomId(null);
      setRoomData(null);
      // showSuccessMessage('Left Room', 'You left the game room');
    }
  }, [currentRoomId, user?.id, firestoreDB, triggerHapticFeedback]);

  // Handle joining room from invite
  const handleJoinRoom = useCallback((roomId) => {
    setCurrentRoomId(roomId);
    setShowInviteModal(false);
  }, []);

  // Handle starting the game
  const handleStartGame = useCallback(async () => {
    if (!currentRoomId || !user?.id || !roomData) return;

    if (roomData.hostId !== user.id) {
      showErrorMessage('Error', 'Only the host can start the game');
      return;
    }

    if (roomData.currentPlayers < 2) {
      showErrorMessage('Error', 'Need 2 players to start');
      return;
    }

    setLoading(true);
    triggerHapticFeedback('impactMedium');

    try {
      const success = await startGame(firestoreDB, currentRoomId, user.id);
      
      if (success) {
        showSuccessMessage('Game Started!', 'Take turns spinning the wheel!');
      } else {
        showErrorMessage('Error', 'Failed to start game');
      }
    } catch (error) {
      console.error('Error starting game:', error);
      showErrorMessage('Error', 'Failed to start game');
    } finally {
      setLoading(false);
    }
  }, [currentRoomId, user?.id, roomData, firestoreDB, triggerHapticFeedback]);

  // Handle wheel spin completion
  const handleSpinEnd = useCallback(async (result) => {
    if (!currentRoomId || !user?.id) return;

    triggerHapticFeedback('notificationSuccess');

    try {
      const success = await recordSpinResult(firestoreDB, currentRoomId, user.id, result);
      
      if (!success) {
        showErrorMessage('Error', 'Failed to record spin result');
      }
    } catch (error) {
      console.error('Error recording spin:', error);
    }
  }, [currentRoomId, user?.id, firestoreDB, triggerHapticFeedback]);

  // Check if it's current user's turn
  const isMyTurn = useMemo(() => {
    if (!roomData || roomData.status !== 'playing' || !user?.id) return false;
    
    const playerOrder = roomData.gameData?.playerOrder || [];
    const currentTurnIndex = roomData.gameData?.currentTurnIndex || 0;
    
    return playerOrder[currentTurnIndex] === user.id;
  }, [roomData, user?.id]);

  // Get current player name for display
  const currentPlayerName = useMemo(() => {
    if (!roomData || roomData.status !== 'playing') return '';
    
    const playerOrder = roomData.gameData?.playerOrder || [];
    const currentTurnIndex = roomData.gameData?.currentTurnIndex || 0;
    const currentPlayerId = playerOrder[currentTurnIndex];
    
    return roomData.players?.[currentPlayerId]?.displayName || 'Player';
  }, [roomData]);

  // Check for turn timeout and skip if needed
  const checkTurnTimeout = useCallback(async () => {
    if (!roomData || roomData.status !== 'playing' || !firestoreDB || !currentRoomId) return;

    const gameData = roomData.gameData || {};
    const playerOrder = gameData.playerOrder || [];
    const currentTurnIndex = gameData.currentTurnIndex || 0;
    const currentPlayerId = playerOrder[currentTurnIndex];
    const turnStartTime = gameData.turnStartTime;

    if (!currentPlayerId || !turnStartTime) return;

    // Convert Firestore timestamp to milliseconds
    let turnStartMs = 0;
    if (turnStartTime?.toDate) {
      turnStartMs = turnStartTime.toDate().getTime();
    } else if (turnStartTime?.seconds) {
      turnStartMs = turnStartTime.seconds * 1000 + Math.floor((turnStartTime.nanoseconds || 0) / 1e6);
    } else if (typeof turnStartTime === 'number') {
      turnStartMs = turnStartTime;
    }

    if (turnStartMs === 0) return;

    const now = Date.now();
    const elapsed = now - turnStartMs;

    // If timeout exceeded, end the game
    if (elapsed > TURN_TIMEOUT_MS) {
      console.log(`Turn timeout exceeded for player ${currentPlayerId}, ending game...`);
      await endGameDueToTimeout(firestoreDB, currentRoomId, currentPlayerId, 'timeout');
    }
  }, [roomData, firestoreDB, currentRoomId]);

  // Set up timeout checking interval
  useEffect(() => {
    if (roomData?.status === 'playing' && !roomData.gameData?.isSpinning) {
      // Check timeout every 5 seconds
      timeoutCheckIntervalRef.current = setInterval(() => {
        checkTurnTimeout();
      }, 5000);

      return () => {
        if (timeoutCheckIntervalRef.current) {
          clearInterval(timeoutCheckIntervalRef.current);
          timeoutCheckIntervalRef.current = null;
        }
      };
    } else {
      if (timeoutCheckIntervalRef.current) {
        clearInterval(timeoutCheckIntervalRef.current);
        timeoutCheckIntervalRef.current = null;
      }
    }
  }, [roomData?.status, roomData?.gameData?.isSpinning, checkTurnTimeout]);

  // Handle app state changes (background/foreground)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState) => {
      // If app goes to background and it's the user's turn, end the game
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (isMyTurn && roomData?.status === 'playing' && firestoreDB && currentRoomId && user?.id) {
          console.log('App went to background during user turn, ending game...');
          await endGameDueToTimeout(firestoreDB, currentRoomId, user.id, 'left');
        }
      }
    });

    return () => {
      subscription?.remove();
    };
  }, [isMyTurn, roomData?.status, firestoreDB, currentRoomId, user?.id]);

  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>🎡 Pet Wheel Spin</Text>
          <Text style={styles.subtitle}>
            Spin the wheel and collect pet values! 3 rounds, highest score wins!
          </Text>
        </View>

        {!currentRoomId ? (
          // No room - Show create button and instructions
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.button}
              onPress={handleCreateRoom}
              disabled={loading || !user?.id}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Icon name="add-circle-outline" size={24} color="#fff" />
                  <Text style={styles.buttonText}>
                    {user?.id ? 'Create Game' : 'Login to Play'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>🎮 How to Play</Text>
              <Text style={styles.cardText}>
                • Create a room (10 random pets are selected){'\n'}
                • Invite 1 friend to join{'\n'}
                • Take turns spinning the wheel{'\n'}
                • The pet's value = your points{'\n'}
                • 3 rounds each, highest total wins!
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>🏆 Game Rules</Text>
              <Text style={styles.cardText}>
                • 2 players only{'\n'}
                • Each player spins once per round{'\n'}
                • Pet value is added to your score{'\n'}
                • After 3 rounds, highest score wins!
              </Text>
            </View>
          </View>
        ) : roomData ? (
          // In a room
          <View style={styles.section}>
            {/* Action buttons - Top Right */}
            <View style={styles.actionRow}>
              {roomData.status === 'waiting' && (
                <TouchableOpacity
                  style={styles.iconButton}
                  onPress={() => setShowInviteModal(true)}
                >
                  <Icon name="person-add-outline" size={16} color="#fff" />
                </TouchableOpacity>
              )}
              {roomData.status !== 'playing' && (
                  <TouchableOpacity
                  style={[styles.iconButton, styles.leaveButton]}
                    onPress={handleLeaveRoom}
                  >
                  <Icon name="exit-outline" size={16} color="#fff" />
                  </TouchableOpacity>
              )}
            </View>

            {/* Player Cards - Always show */}
            <PlayerCards
              roomData={roomData}
              currentUserId={user?.id}
            />

            {/* Game states */}
            {roomData.status === 'waiting' && (
              <View style={styles.waitingCard}>
                {roomData.currentPlayers < 2 ? (
                  <>
                    <Text style={styles.waitingText}>
                      ⏳ Waiting for 1 more player...
                    </Text>
                    <Text style={styles.waitingSubtext}>
                      Players: {roomData.currentPlayers}/2
                    </Text>
                  </>
                ) : roomData.hostId === user?.id ? (
                  <>
                    <Text style={styles.waitingText}>
                      ✅ Ready to start!
                    </Text>
                    <Text style={styles.waitingSubtext}>
                      Players: {roomData.currentPlayers}/2
                    </Text>
                    <TouchableOpacity
                      style={styles.startGameButton}
                      onPress={handleStartGame}
                      disabled={loading}
                    >
                      {loading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Icon name="play-circle" size={24} color="#fff" />
                          <Text style={styles.startGameButtonText}>
                            Start
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Text style={styles.waitingText}>
                      ⏳ Waiting for host to start...
                    </Text>
                    <Text style={styles.waitingSubtext}>
                      Players: {roomData.currentPlayers}/2
                      </Text>
                  </>
                )}
                  </View>
                )}

            {roomData.status === 'playing' && roomData.wheelPets && (
              <FortuneWheel
                wheelPets={roomData.wheelPets}
                onSpinEnd={handleSpinEnd}
                isMyTurn={isMyTurn}
                isSpinning={roomData.gameData?.isSpinning || false}
                currentPlayerName={currentPlayerName}
                disabled={false}
              />
            )}

            {roomData.status === 'finished' && (
              <View style={styles.finishedCard}>
                <Text style={styles.finishedTitle}>🏆 Game Over!</Text>
                    <GameResults
                      roomData={roomData}
                      currentUser={{
                        id: user?.id,
                        displayName: user?.displayName || 'Anonymous',
                  }}
                />
                <TouchableOpacity
                  style={[styles.button, { marginTop: 16 }]}
                  onPress={handleLeaveRoom}
                >
                  <Icon name="refresh-outline" size={20} color="#fff" />
                  <Text style={styles.buttonText}>Play Again</Text>
                </TouchableOpacity>
                    </View>
                  )}
                </View>
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#8B5CF6" />
            <Text style={styles.loadingText}>Loading room...</Text>
          </View>
        )}
      </ScrollView>

      {/* Invite Modal */}
      {currentRoomId && (
        <InviteUsersModal
          visible={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          roomId={currentRoomId}
          currentUser={{
            id: user?.id,
            displayName: user?.displayName || 'Anonymous',
            avatar: user?.avatar || null,
          }}
        />
      )}

      {/* Incoming Invite Notifications */}
      {user?.id && (
        <InviteNotification
          currentUser={{
            id: user.id,
            displayName: user.displayName || 'Anonymous',
            avatar: user.avatar || null,
          }}
          onAccept={handleJoinRoom}
        />
      )}
    </View>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
    },
    scrollContent: {
      padding: 8,
    },
    header: {
      marginBottom: 20,
    },
    title: {
      fontSize: 28,
      fontFamily: 'Lato-Bold',
      color: isDarkMode ? '#fff' : '#000',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? '#9ca3af' : '#6b7280',
    },
    section: {
      marginBottom: 20,
      justifyContent:'center'
    },
    button: {
      backgroundColor: '#8B5CF6',
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: 'Lato-Bold',
      marginLeft: 8,
    },
    card: {
      backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: isDarkMode ? '#333' : '#e5e7eb',
    },
    cardTitle: {
      fontSize: 16,
      fontFamily: 'Lato-Bold',
      color: isDarkMode ? '#fff' : '#000',
      marginBottom: 8,
    },
    cardText: {
      fontSize: 14,
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? '#9ca3af' : '#6b7280',
      lineHeight: 22,
    },
    actionRow: {
      // position: 'absolute',
      // top: 8,
      // right: 8,
      flexDirection: 'row',
      gap: 8,
      // zIndex: 10,
      justifyContent:'flex-end'
    },
    iconButton: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: '#8B5CF6',
      alignItems: 'center',
      justifyContent: 'center',
    },
    leaveButton: {
      backgroundColor: '#EF4444',
    },
    startButton: {
      backgroundColor: '#10B981',
    },
    waitingCard: {
      backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
      borderRadius: 12,
      padding: 24,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: isDarkMode ? '#333' : '#e5e7eb',
      marginTop: 8,
    },
    waitingText: {
      fontSize: 16,
      fontFamily: 'Lato-Bold',
      color: isDarkMode ? '#fff' : '#000',
      textAlign: 'center',
      marginBottom: 8,
    },
    waitingSubtext: {
      fontSize: 14,
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? '#9ca3af' : '#6b7280',
      marginBottom: 12,
    },
    startGameButton: {
      backgroundColor: '#10B981',
      paddingVertical: 12,
      paddingHorizontal: 32,
      borderRadius: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    startGameButtonText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: 'Lato-Bold',
      marginLeft: 8,
    },
    finishedCard: {
      backgroundColor: isDarkMode ? '#1e1e1e' : '#fff',
      borderRadius: 12,
      padding: 24,
      alignItems: 'center',
      borderWidth: 2,
      borderColor: '#F59E0B',
      marginTop: 8,
    },
    finishedTitle: {
      fontSize: 24,
      fontFamily: 'Lato-Bold',
      color: '#F59E0B',
      marginBottom: 16,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 60,
    },
    loadingText: {
      marginTop: 12,
      fontSize: 14,
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? '#9ca3af' : '#6b7280',
    },
  });

export default PetGuessingGameScreen;
