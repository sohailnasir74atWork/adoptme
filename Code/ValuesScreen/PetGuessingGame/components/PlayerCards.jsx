// PlayerCards.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';

const PlayerCards = ({ roomData, currentUser }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  const [timeLeft, setTimeLeft] = useState(60);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const picks = roomData?.gameData?.picks || {};
  const countdownEnd = roomData?.gameData?.countdownEnd || null;
  const allPicked = roomData?.gameData?.allPicked || false;
  const players = roomData?.players || {};

  // Countdown timer
  useEffect(() => {
    if (!countdownEnd || allPicked) {
      setTimeLeft(0);
      return;
    }

    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((countdownEnd - Date.now()) / 1000));
      setTimeLeft(remaining);
    }, 100);

    return () => clearInterval(interval);
  }, [countdownEnd, allPicked]);

  // Pulse animation for urgent countdown
  useEffect(() => {
    if (timeLeft <= 10 && timeLeft > 0 && !allPicked) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [timeLeft, allPicked, pulseAnim]);

  // Get player cards data
  const playerCards = useMemo(() => {
    return Object.entries(players).map(([playerId, playerData]) => {
      const pick = picks[playerId];
      const hasPicked = !!pick;
      const isCurrentUser = playerId === currentUser?.id;
      const isHost = playerId === roomData?.hostId;

      return {
        playerId,
        playerName: playerData.displayName || 'Anonymous',
        avatar: playerData.avatar,
        hasPicked,
        pick,
        isCurrentUser,
        isHost,
      };
    });
  }, [players, picks, currentUser?.id, roomData?.hostId]);

  if (playerCards.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* Timer Display */}
      {!allPicked && countdownEnd && (
        <View style={styles.timerContainer}>
          <Animated.View
            style={[
              styles.timerCircle,
              {
                transform: [{ scale: pulseAnim }],
                backgroundColor: timeLeft <= 10 ? '#EF4444' : timeLeft <= 30 ? '#F59E0B' : '#10B981',
              },
            ]}
          >
            <Text style={styles.timerText}>{timeLeft}</Text>
          </Animated.View>
          <Text style={[styles.timerLabel, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
            {allPicked ? 'All Locked!' : 'Time Remaining'}
          </Text>
        </View>
      )}

      {allPicked && (
        <View style={styles.allLockedBanner}>
          <Icon name="lock-closed" size={20} color="#10B981" />
          <Text style={styles.allLockedText}>All Players Locked! 🎉</Text>
        </View>
      )}

      {/* Player Cards Grid */}
      <View style={styles.cardsGrid}>
        {playerCards.map((card) => (
          <View
            key={card.playerId}
            style={[
              styles.playerCard,
              {
                backgroundColor: card.hasPicked
                  ? isDarkMode ? '#1e3a1e' : '#d1fae5'
                  : isDarkMode ? '#1e1e1e' : '#ffffff',
                borderColor: card.hasPicked ? '#10B981' : isDarkMode ? '#333333' : '#e5e7eb',
                borderWidth: card.isCurrentUser ? 2 : 1,
              },
            ]}
          >
            {/* Player Avatar & Name */}
            <View style={styles.cardHeader}>
              <Image
                source={{
                  uri:
                    card.avatar ||
                    'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                }}
                style={styles.cardAvatar}
              />
              <View style={styles.cardNameContainer}>
                <Text style={[styles.cardPlayerName, { color: isDarkMode ? '#fff' : '#000' }]} numberOfLines={1}>
                  {card.playerName}
                  {card.isHost && ' 👑'}
                </Text>
                {card.isCurrentUser && (
                  <Text style={[styles.youLabel, { color: '#8B5CF6' }]}>You</Text>
                )}
              </View>
            </View>

            {/* Status */}
            {card.hasPicked ? (
              <View style={styles.lockedContainer}>
                <Icon name="checkmark-circle" size={24} color="#10B981" />
                <Text style={[styles.lockedText, { color: '#10B981' }]}>Locked</Text>
                {card.pick.petImage && (
                  <Image
                    source={{ uri: card.pick.petImage }}
                    style={styles.lockedPetImage}
                    resizeMode="contain"
                  />
                )}
                <Text style={[styles.lockedPetName, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]} numberOfLines={1}>
                  {card.pick.petName}
                  {card.pick.isRandom && ' (Random)'}
                </Text>
              </View>
            ) : (
              <View style={styles.selectingContainer}>
                <View style={styles.selectingIndicator}>
                  <View style={[styles.selectingDot, { backgroundColor: '#8B5CF6' }]} />
                  <View style={[styles.selectingDot, { backgroundColor: '#8B5CF6' }]} />
                  <View style={[styles.selectingDot, { backgroundColor: '#8B5CF6' }]} />
                </View>
                <Text style={[styles.selectingText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
                  Selecting...
                </Text>
                {!allPicked && countdownEnd && (
                  <Text style={[styles.timeRemaining, { color: timeLeft <= 10 ? '#EF4444' : '#F59E0B' }]}>
                    {timeLeft}s left
                  </Text>
                )}
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 12,
  },
  timerContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  timerCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  timerText: {
    fontSize: 24,
    fontFamily: 'Lato-Bold',
    color: '#fff',
  },
  timerLabel: {
    fontSize: 12,
    fontFamily: 'Lato-Regular',
  },
  allLockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d1fae5',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    gap: 8,
  },
  allLockedText: {
    fontSize: 14,
    fontFamily: 'Lato-Bold',
    color: '#065f46',
  },
  cardsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  playerCard: {
    width: '48%',
    minWidth: 140,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
  },
  cardNameContainer: {
    flex: 1,
  },
  cardPlayerName: {
    fontSize: 12,
    fontFamily: 'Lato-Bold',
  },
  youLabel: {
    fontSize: 10,
    fontFamily: 'Lato-Regular',
  },
  lockedContainer: {
    alignItems: 'center',
    paddingTop: 4,
  },
  lockedText: {
    fontSize: 12,
    fontFamily: 'Lato-Bold',
    marginTop: 4,
    marginBottom: 6,
  },
  lockedPetImage: {
    width: 50,
    height: 50,
    marginBottom: 4,
  },
  lockedPetName: {
    fontSize: 10,
    fontFamily: 'Lato-Regular',
    textAlign: 'center',
  },
  selectingContainer: {
    alignItems: 'center',
    paddingTop: 8,
  },
  selectingIndicator: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
  selectingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  selectingText: {
    fontSize: 11,
    fontFamily: 'Lato-Regular',
  },
  timeRemaining: {
    fontSize: 10,
    fontFamily: 'Lato-Bold',
    marginTop: 4,
  },
});

export default PlayerCards;

