// PetGuessingGameScreen.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import InviteUsersModal from './components/InviteUsersModal';
import InviteNotification from './components/InviteNotification';
import PetSelectionRound from './components/PetSelectionRound';
import WheelSpin from './components/WheelSpin';
import CelebrationScreen from './components/CelebrationScreen';
import GameResults from './components/GameResults';
import PlayerCards from './components/PlayerCards';
import {
  createGameRoom,
  listenToGameRoom,
  leaveGameRoom,
  startGame,
  submitPetPick,
  setGameWinner,
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
  const [showPlayersList, setShowPlayersList] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [currentWinner, setCurrentWinner] = useState(null);
  const wheelSpinRef = useRef(null);

  // Get pet data from localState
  const petData = useMemo(() => {
    try {
      const rawData = localState.isGG ? localState.ggData : localState.data;
      if (!rawData) return [];

      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch (error) {
      console.error('Error parsing pet data:', error);
      return [];
    }
  }, [localState.isGG, localState.data, localState.ggData]);

  // Listen to room updates
  useEffect(() => {
    if (!currentRoomId || !firestoreDB) return;

    const unsubscribe = listenToGameRoom(firestoreDB, currentRoomId, (data) => {
      setRoomData(data);
      if (!data) {
        // Room was deleted
        setCurrentRoomId(null);
        setRoomData(null);
      }
    });

    return () => unsubscribe();
  }, [currentRoomId, firestoreDB]);

  const handleCreateRoom = useCallback(async () => {
    if (!user?.id) {
      showErrorMessage('Error', 'Please login to create a game room');
      return;
    }

    setLoading(true);
    triggerHapticFeedback('impactLight');

    try {
      const roomId = await createGameRoom(
        firestoreDB,
        {
          id: user.id,
          displayName: user.displayName || 'Anonymous',
          avatar: user.avatar || null,
        },
        10 // max players
      );

      if (roomId) {
        setCurrentRoomId(roomId);
        showSuccessMessage('Room Created', 'Invite friends to join!');
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
  }, [user, firestoreDB, triggerHapticFeedback]);

  const handleLeaveRoom = useCallback(async () => {
    if (!currentRoomId || !user?.id) return;

    triggerHapticFeedback('impactLight');
    const success = await leaveGameRoom(firestoreDB, currentRoomId, user.id);
    
    if (success) {
      setCurrentRoomId(null);
      setRoomData(null);
      showSuccessMessage('Left Room', 'You left the game room');
    }
  }, [currentRoomId, user?.id, firestoreDB, triggerHapticFeedback]);

  const handleJoinRoom = useCallback((roomId) => {
    setCurrentRoomId(roomId);
    setShowInviteModal(false);
  }, []);

  const handleStartGame = useCallback(async () => {
    if (!currentRoomId || !user?.id || !roomData) return;

    // Check if user is host
    if (roomData.hostId !== user.id) {
      showErrorMessage('Error', 'Only the host can start the game');
      return;
    }

    // Check minimum players
    if (roomData.currentPlayers < 2) {
      showErrorMessage('Error', 'Need at least 2 players to start');
      return;
    }

    setLoading(true);
    triggerHapticFeedback('impactMedium');

    try {
      const success = await startGame(firestoreDB, currentRoomId, user.id);
      
      if (success) {
        showSuccessMessage('Game Started!', 'Let the challenge begin!');
        // Generate first challenge (host generates it)
        // The GameChallenge component will handle displaying it
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

  // Get image URL helper for wheel
  const getImageUrl = useMemo(() => {
    const baseImgUrl = localState.isGG ? localState.imgurlGG : localState.imgurl;
    return (item) => {
      if (!item || !item.name) return '';
      
      if (localState.isGG) {
        const encoded = encodeURIComponent(item.name);
        return `${baseImgUrl?.replace(/"/g, '')}/items/${encoded}.webp`;
      }
      
      if (!item.image || !baseImgUrl) return '';
      return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}/${item.image.replace(/^\//, '')}`;
    };
  }, [localState.isGG, localState.imgurl, localState.imgurlGG]);

  const handlePetPick = useCallback(async (pickData) => {
    if (!currentRoomId || !user?.id) return;

    try {
      const success = await submitPetPick(firestoreDB, currentRoomId, user.id, pickData);
      
      if (success) {
        triggerHapticFeedback('notificationSuccess');
        showSuccessMessage('Pet Selected!', 'Waiting for others...');
      } else {
        showErrorMessage('Error', 'Failed to select pet');
      }
    } catch (error) {
      console.error('Error submitting pet pick:', error);
      showErrorMessage('Error', 'Failed to select pet');
    }
  }, [currentRoomId, user?.id, firestoreDB, triggerHapticFeedback]);

  const handleSpinComplete = useCallback(async (winner) => {
    if (!currentRoomId || !roomData) return;

    try {
      await setGameWinner(firestoreDB, currentRoomId, {
        playerId: winner.playerId,
        playerName: winner.playerName,
        petName: winner.petName,
        petImage: winner.petImage,
      });

      setCurrentWinner(winner);
      setShowCelebration(true);
      triggerHapticFeedback('notificationSuccess');
    } catch (error) {
      console.error('Error setting winner:', error);
    }
  }, [currentRoomId, roomData, firestoreDB, triggerHapticFeedback]);

  const handlePlayAgain = useCallback(() => {
    setShowCelebration(false);
    setCurrentWinner(null);
    // Reset room state - host can start a new game
    showSuccessMessage('Game Complete!', 'Host can create a new room to play again!');
  }, []);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
        },
        scrollContent: {
          padding: 16,
        },
        header: {
          marginBottom: 24,
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
          marginBottom: 24,
        },
        sectionTitle: {
          fontSize: 18,
          fontFamily: 'Lato-Bold',
          color: isDarkMode ? '#fff' : '#000',
          marginBottom: 12,
        },
        card: {
          backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
          borderRadius: 12,
          padding: 16,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: isDarkMode ? '#333333' : '#e5e7eb',
        },
        button: {
          backgroundColor: '#8B5CF6',
          paddingVertical: 14,
          paddingHorizontal: 24,
          borderRadius: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        },
        buttonText: {
          color: '#fff',
          fontSize: 16,
          fontFamily: 'Lato-Bold',
          marginLeft: 8,
        },
        leaveButton: {
          backgroundColor: '#EF4444',
        },
        actionButtonsRow: {
          flexDirection: 'row',
          gap: 8,
          marginBottom: 12,
          justifyContent: 'center',
        },
        compactButton: {
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: '#8B5CF6',
          justifyContent: 'center',
          alignItems: 'center',
        },
        compactInfoRow: {
          flexDirection: 'row',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
          justifyContent: 'center',
        },
        compactInfoItem: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 20,
          backgroundColor: isDarkMode ? '#1e1e1e' : '#f3f4f6',
          borderWidth: 1,
          borderColor: isDarkMode ? '#333333' : '#e5e7eb',
        },
        compactInfoText: {
          fontSize: 12,
          fontFamily: 'Lato-Regular',
        },
        compactCard: {
          padding: 12,
          marginBottom: 12,
        },
        compactPlayerItem: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 6,
          paddingHorizontal: 4,
          borderBottomWidth: 1,
          borderBottomColor: isDarkMode ? '#333333' : '#e5e7eb',
        },
        compactAvatar: {
          width: 32,
          height: 32,
          borderRadius: 16,
          marginRight: 8,
        },
        compactPlayerName: {
          fontSize: 13,
          fontFamily: 'Lato-Regular',
          flex: 1,
        },
        compactScore: {
          fontSize: 12,
          fontFamily: 'Lato-Bold',
        },
        mainGameArea: {
          marginTop: 8,
          marginBottom: 12,
        },
        waitingCard: {
          padding: 24,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
        },
        waitingText: {
          fontSize: 16,
          fontFamily: 'Lato-Regular',
          textAlign: 'center',
        },
        finishedCard: {
          padding: 24,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200,
          backgroundColor: isDarkMode ? '#2a1e3a' : '#e9d5ff',
          borderColor: '#8B5CF6',
        },
        finishedText: {
          fontSize: 18,
          fontFamily: 'Lato-Bold',
          textAlign: 'center',
        },
        roomInfo: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        },
        roomText: {
          fontSize: 14,
          fontFamily: 'Lato-Regular',
          color: isDarkMode ? '#9ca3af' : '#6b7280',
        },
        playersList: {
          marginTop: 12,
        },
        playerItem: {
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: isDarkMode ? '#333333' : '#e5e7eb',
        },
        playerAvatar: {
          width: 40,
          height: 40,
          borderRadius: 20,
          marginRight: 12,
        },
        playerName: {
          fontSize: 14,
          fontFamily: 'Lato-Regular',
          color: isDarkMode ? '#fff' : '#000',
          flex: 1,
        },
        playerScore: {
          fontSize: 12,
          fontFamily: 'Lato-Bold',
          marginLeft: 8,
        },
        emptyState: {
          paddingVertical: 40,
          alignItems: 'center',
        },
        emptyText: {
          fontSize: 16,
          fontFamily: 'Lato-Regular',
          color: isDarkMode ? '#9ca3af' : '#6b7280',
          textAlign: 'center',
          marginTop: 16,
        },
      }),
    [isDarkMode]
  );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>🎡 Pet Wheel Spin</Text>
          <Text style={styles.subtitle}>
            Pick your pet, spin the wheel, and see who wins! Fast-paced fun with friends.
          </Text>
        </View>

        {!currentRoomId ? (
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
                    {user?.id ? 'Create Game Room' : 'Login to Play'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.card}>
              <Text style={[styles.sectionTitle, { marginBottom: 8 }]}>How to Play</Text>
              <Text style={[styles.roomText, { marginBottom: 8 }]}>
                • Create a room and invite at least 1 friend{'\n'}
                • Start the game with 2+ players{'\n'}
                • Each round shows a pet challenge{'\n'}
                • Guess correctly to earn points{'\n'}
                • Fastest correct answer wins bonus!{'\n'}
                • Compete on the leaderboard
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={[styles.sectionTitle, { marginBottom: 8 }]}>Game Features</Text>
              <Text style={[styles.roomText, { marginBottom: 8 }]}>
                • 5 rounds per day{'\n'}
                • Multiple challenge types{'\n'}
                • Real-time multiplayer{'\n'}
                • Daily & weekly leaderboards{'\n'}
                • Streak bonuses
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.section}>
            {roomData && (
              <>
                {/* Compact Action Buttons Row */}
                <View style={styles.actionButtonsRow}>
                  <TouchableOpacity
                    style={[styles.compactButton, styles.leaveButton]}
                    onPress={handleLeaveRoom}
                  >
                    <Icon name="exit-outline" size={18} color="#fff" />
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    style={[styles.compactButton, { backgroundColor: '#8B5CF6' }]}
                    onPress={() => setShowInviteModal(true)}
                  >
                    <Icon name="person-add-outline" size={18} color="#fff" />
                  </TouchableOpacity>

                  {roomData.status === 'waiting' && roomData.hostId === user?.id && roomData.currentPlayers >= 2 && (
                    <TouchableOpacity
                      style={[styles.compactButton, { backgroundColor: '#10B981' }]}
                      onPress={handleStartGame}
                      disabled={loading}
                    >
                      {loading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Icon name="play-circle-outline" size={18} color="#fff" />
                      )}
                    </TouchableOpacity>
                  )}

                  {roomData.status === 'playing' && 
                   roomData.hostId === user?.id && 
                   roomData.gameData?.answers && 
                   roomData.gameData?.currentRound && (() => {
                    const currentRound = roomData.gameData.currentRound;
                    const roundAnswers = roomData.gameData.answers[currentRound] || {};
                    const answeredCount = Object.keys(roundAnswers).length;
                    const allAnswered = answeredCount >= roomData.currentPlayers;
                    const isLastRound = currentRound >= (roomData.gameData.totalRounds || 5);

                    return allAnswered ? (
                      <TouchableOpacity
                        style={[styles.compactButton, { backgroundColor: isLastRound ? '#8B5CF6' : '#10B981' }]}
                        onPress={handleNextRound}
                        disabled={loading}
                      >
                        {loading ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Icon 
                            name={isLastRound ? "trophy-outline" : "arrow-forward-circle-outline"} 
                            size={18} 
                            color="#fff" 
                          />
                        )}
                      </TouchableOpacity>
                    ) : null;
                  })()}
                </View>

                {/* Compact Status & Players Row */}
                <View style={styles.compactInfoRow}>
                  <TouchableOpacity
                    style={styles.compactInfoItem}
                    onPress={() => setShowPlayersList(!showPlayersList)}
                  >
                    <Icon name="people-outline" size={16} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
                    <Text style={[styles.compactInfoText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                      {roomData.currentPlayers} players
                    </Text>
                    <Icon 
                      name={showPlayersList ? "chevron-up" : "chevron-down"} 
                      size={14} 
                      color={isDarkMode ? '#9ca3af' : '#6b7280'} 
                    />
                  </TouchableOpacity>

                  {(roomData.status === 'playing' || roomData.status === 'finished') && (
                    <TouchableOpacity
                      style={styles.compactInfoItem}
                      onPress={() => setShowLeaderboard(!showLeaderboard)}
                    >
                      <Icon name="trophy-outline" size={16} color={isDarkMode ? '#9ca3af' : '#6b7280'} />
                      <Text style={[styles.compactInfoText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                        Leaderboard
                      </Text>
                      <Icon 
                        name={showLeaderboard ? "chevron-up" : "chevron-down"} 
                        size={14} 
                        color={isDarkMode ? '#9ca3af' : '#6b7280'} 
                      />
                    </TouchableOpacity>
                  )}

                </View>

                {/* Collapsible Players List */}
                {showPlayersList && (
                  <View style={[styles.card, styles.compactCard]}>
                    {roomData.players &&
                      Object.entries(roomData.players).map(([playerId, player]) => (
                        <View key={playerId} style={styles.compactPlayerItem}>
                          <Image
                            source={{
                              uri:
                                player.avatar ||
                                'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                            }}
                            style={styles.compactAvatar}
                          />
                          <Text style={[styles.compactPlayerName, { color: isDarkMode ? '#fff' : '#000' }]}>
                            {player.displayName}
                            {playerId === roomData.hostId && ' 👑'}
                          </Text>
                          {roomData.status === 'playing' && roomData.gameData?.scores && (
                            <Text style={[styles.compactScore, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                              {roomData.gameData.scores[playerId] || 0}
                            </Text>
                          )}
                        </View>
                      ))}
                  </View>
                )}

                {/* Player Cards - Show status of all players */}
                {roomData.status === 'playing' && (
                  <View style={[styles.card, styles.compactCard]}>
                    <PlayerCards
                      roomData={roomData}
                      currentUser={{
                        id: user?.id,
                        displayName: user?.displayName || 'Anonymous',
                        avatar: user?.avatar || null,
                      }}
                    />
                  </View>
                )}

                {/* Start Wheel Button - Host only when all locked */}
                {roomData.status === 'playing' && 
                 roomData.gameData?.allPicked && 
                 !roomData.gameData?.winner &&
                 roomData.hostId === user?.id && (
                  <TouchableOpacity
                    style={[styles.button, { 
                      marginBottom: 12,
                      backgroundColor: '#8B5CF6',
                    }]}
                    onPress={() => {
                      if (wheelSpinRef.current) {
                        wheelSpinRef.current();
                        triggerHapticFeedback('impactMedium');
                      }
                    }}
                  >
                    <Icon name="play-circle" size={20} color="#fff" />
                    <Text style={styles.buttonText}>Spin the Wheel!</Text>
                  </TouchableOpacity>
                )}

                {/* Collapsible Leaderboard */}
                {showLeaderboard && (roomData.status === 'playing' || roomData.status === 'finished') && (
                  <View style={[styles.card, styles.compactCard]}>
                    <GameResults
                      roomData={roomData}
                      currentUser={{
                        id: user?.id,
                        displayName: user?.displayName || 'Anonymous',
                        avatar: user?.avatar || null,
                      }}
                    />
                  </View>
                )}

                {/* Main Game Area - Centered and Big */}
                <View style={styles.mainGameArea}>
                  {roomData.status === 'playing' && (() => {
                    const allPicked = roomData.gameData?.allPicked || false;
                    const hasWinner = roomData.gameData?.winner !== null;

                    // Show wheel if all picked and no winner yet
                    if (allPicked && !hasWinner) {
                      return (
                        <WheelSpin
                          roomData={roomData}
                          currentUser={{
                            id: user?.id,
                            displayName: user?.displayName || 'Anonymous',
                            avatar: user?.avatar || null,
                          }}
                          onSpinComplete={handleSpinComplete}
                          getImageUrl={getImageUrl}
                          onStartSpin={(startFn) => {
                            wheelSpinRef.current = startFn;
                          }}
                        />
                      );
                    }

                    // Show pet selection if not all picked
                    if (!allPicked) {
                      return (
                        <PetSelectionRound
                          roomData={roomData}
                          currentUser={{
                            id: user?.id,
                            displayName: user?.displayName || 'Anonymous',
                            avatar: user?.avatar || null,
                          }}
                          onSelectPet={handlePetPick}
                          roomId={currentRoomId}
                        />
                      );
                    }

                    // Show winner
                    return (
                      <View style={[styles.card, styles.waitingCard]}>
                        <Text style={[styles.waitingText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                          Game complete! Check celebration screen.
                        </Text>
                      </View>
                    );
                  })()}

                  {roomData.status === 'waiting' && (
                    <View style={[styles.card, styles.waitingCard]}>
                      <Text style={[styles.waitingText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                        {roomData.currentPlayers >= 2 
                          ? roomData.hostId === user?.id
                            ? 'Ready to start! Click the play button above.'
                            : 'Waiting for host to start...'
                          : 'Need at least 2 players to start'}
                      </Text>
                    </View>
                  )}

                  {roomData.status === 'finished' && (
                    <View style={[styles.card, styles.finishedCard]}>
                      <Text style={[styles.finishedText, { color: isDarkMode ? '#c4b5fd' : '#6b21a8' }]}>
                        🏆 Game Finished! Check leaderboard above.
                      </Text>
                    </View>
                  )}
                </View>
              </>
            )}
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

      {/* Celebration Screen */}
      {showCelebration && currentWinner && (
        <CelebrationScreen
          winner={currentWinner}
          onPlayAgain={handlePlayAgain}
          onClose={() => {
            setShowCelebration(false);
            setCurrentWinner(null);
          }}
        />
      )}
    </View>
  );
};

export default PetGuessingGameScreen;

