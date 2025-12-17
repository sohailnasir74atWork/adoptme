// WheelSpin.jsx - Optimized for performance
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';

const { width } = Dimensions.get('window');
const WHEEL_SIZE = Math.min(width * 0.75, 300);

const WheelSpin = ({ roomData, currentUser, onSpinComplete, getImageUrl, onStartSpin }) => {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';

  const [isSpinning, setIsSpinning] = useState(false);
  const [winner, setWinner] = useState(null);
  const [wheelEvent, setWheelEvent] = useState(null);
  const [hasStarted, setHasStarted] = useState(false);
  const spinValue = useRef(new Animated.Value(0)).current;
  const confettiAnim = useRef(new Animated.Value(0)).current;

  const picks = roomData?.gameData?.picks || {};
  const eventType = roomData?.gameData?.wheelEvent || null;
  const roundData = {
    allPicked: roomData?.gameData?.allPicked || false,
  };

  // Helper function for slice colors
  const getSliceColor = (index) => {
    const colors = [
      '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#3B82F6',
      '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
    ];
    return colors[index % colors.length];
  };

  // Convert picks to wheel slices - with player names
  const wheelSlices = useMemo(() => {
    if (!picks || Object.keys(picks).length === 0) return [];
    
    return Object.entries(picks).map(([playerId, pick], index) => ({
      playerId,
      playerName: roomData?.players?.[playerId]?.displayName || 'Anonymous',
      playerAvatar: roomData?.players?.[playerId]?.avatar || null,
      petName: pick.petName,
      petImage: pick.petImage,
      color: getSliceColor(index),
      index,
    }));
  }, [picks, roomData?.players]);

  // Wheel events
  useEffect(() => {
    if (eventType) {
      setWheelEvent(eventType);
      setTimeout(() => setWheelEvent(null), 2000);
    }
  }, [eventType]);

  const startSpin = () => {
    if (isSpinning || wheelSlices.length === 0) return;

    setIsSpinning(true);
    setWinner(null);

    // Determine winner
    const randomIndex = Math.floor(Math.random() * wheelSlices.length);
    const selectedWinner = wheelSlices[randomIndex];

    // Calculate smooth spin - fortune wheel style
    const sliceAngle = 360 / wheelSlices.length;
    const targetSlice = selectedWinner.index;
    
    // Multiple full rotations (6-8) for dramatic effect
    const fullRotations = 6 + Math.random() * 2; // 6-8 rotations
    const finalAngle = 360 - (targetSlice * sliceAngle) - (sliceAngle / 2);
    const totalRotation = fullRotations * 360 + finalAngle;

    // Smooth deceleration - fortune wheel style
    let spinDuration = 6000; // 6 seconds base
    if (eventType === 'slowMo') {
      spinDuration = 8000;
    } else if (eventType === 'doubleSpin') {
      spinDuration = 4000;
    }

    // Reset and start smooth spin
    spinValue.setValue(0);
    
    Animated.timing(spinValue, {
      toValue: totalRotation,
      duration: spinDuration,
      easing: (t) => {
        // Custom easing for smooth deceleration (fortune wheel effect)
        return 1 - Math.pow(1 - t, 3);
      },
      useNativeDriver: true,
    }).start(() => {
      handleSpinComplete(selectedWinner);
    });
  };

  const handleSpinComplete = (selectedWinner) => {
    setIsSpinning(false);
    setWinner(selectedWinner);

    // Simple confetti animation
    Animated.sequence([
      Animated.timing(confettiAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(1500),
    ]).start();

    if (onSpinComplete) {
      onSpinComplete(selectedWinner);
    }
  };

  // Expose startSpin function to parent
  useEffect(() => {
    if (onStartSpin && roundData.allPicked && !hasStarted && !isSpinning) {
      onStartSpin(() => {
        if (!isSpinning && wheelSlices.length > 0) {
          setHasStarted(true);
          setTimeout(() => {
            startSpin();
          }, eventType ? 2500 : 500);
        }
      });
    }
  }, [roundData.allPicked, hasStarted, isSpinning, wheelSlices.length, eventType, onStartSpin]);

  // Interpolate rotation
  const spinRotation = spinValue.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  // Render wheel slices - simplified approach
  const renderWheelSlices = () => {
    if (wheelSlices.length === 0) return null;
    
    const sliceAngle = 360 / wheelSlices.length;
    
    return wheelSlices.map((slice, index) => {
      const rotation = index * sliceAngle;
      const isEven = index % 2 === 0;
      
      return (
        <View
          key={slice.playerId}
          style={[
            styles.slice,
            {
              backgroundColor: slice.color,
              transform: [{ rotate: `${rotation}deg` }],
            },
          ]}
        >
          <View style={styles.sliceInner}>
            {slice.petImage ? (
              <Image
                source={{ uri: slice.petImage }}
                style={styles.sliceImage}
                resizeMode="contain"
              />
            ) : (
              <View style={[styles.slicePlaceholder, { backgroundColor: 'rgba(255,255,255,0.3)' }]} />
            )}
            <Text style={styles.sliceText} numberOfLines={1}>
              {slice.playerName}
            </Text>
            <Text style={styles.slicePetText} numberOfLines={1}>
              {slice.petName}
            </Text>
          </View>
        </View>
      );
    });
  };

  return (
    <View style={styles.container}>
      {/* Wheel Event Banner */}
      {wheelEvent && (
        <View style={[styles.eventBanner, { backgroundColor: getEventColor(wheelEvent) }]}>
          <Text style={styles.eventText}>{getEventText(wheelEvent)}</Text>
        </View>
      )}

      {/* Wheel Container */}
      <View style={styles.wheelContainer}>
        <Animated.View
          style={[
            styles.wheel,
            {
              transform: [{ rotate: spinRotation }],
            },
          ]}
        >
          {renderWheelSlices()}
        </Animated.View>

        {/* Center pointer */}
        <View style={styles.pointer}>
          <View style={styles.pointerTriangle} />
        </View>
        
        {/* Center circle */}
        <View style={styles.centerCircle}>
          <Icon name="trophy" size={24} color="#F59E0B" />
        </View>
      </View>

      {/* Winner Display */}
      {winner && (
        <Animated.View
          style={[
            styles.winnerContainer,
            {
              opacity: confettiAnim,
            },
          ]}
        >
          <Text style={[styles.winnerText, { color: isDarkMode ? '#fff' : '#000' }]}>
            🎉 Winner! 🎉
          </Text>
          <Text style={[styles.winnerName, { color: isDarkMode ? '#fff' : '#000' }]}>
            {winner.playerName}'s {winner.petName}
          </Text>
        </Animated.View>
      )}

      {/* Status */}
      {!isSpinning && !winner && (
        <Text style={[styles.statusText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
          {roundData.allPicked 
            ? 'Waiting for host to spin the wheel...' 
            : 'Waiting for all picks...'}
        </Text>
      )}
      {isSpinning && (
        <Text style={[styles.statusText, { color: isDarkMode ? '#9ca3af' : '#6b7280' }]}>
          Spinning...
        </Text>
      )}
    </View>
  );
};

const getEventColor = (event) => {
  const colors = {
    doubleSpin: '#8B5CF6',
    reverse: '#EF4444',
    slowMo: '#3B82F6',
    confetti: '#F59E0B',
  };
  return colors[event] || '#8B5CF6';
};

const getEventText = (event) => {
  const texts = {
    doubleSpin: '🔄 Double Spin!',
    reverse: '↩️ Reverse Wheel!',
    slowMo: '🐌 Slow-Mo Finish!',
    confetti: '🎊 Confetti Storm!',
  };
  return texts[event] || '🎉 Special Event!';
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  eventBanner: {
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  eventText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    textAlign: 'center',
  },
  wheelContainer: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    position: 'relative',
    marginBottom: 16,
  },
  wheel: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    borderRadius: WHEEL_SIZE / 2,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#fff',
    backgroundColor: '#f3f4f6',
  },
  slice: {
    position: 'absolute',
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    left: 0,
    top: 0,
    transformOrigin: 'center center',
  },
  sliceInner: {
    position: 'absolute',
    left: WHEEL_SIZE / 2 - 35,
    top: 12,
    width: 70,
    alignItems: 'center',
  },
  sliceImage: {
    width: 36,
    height: 36,
    marginBottom: 3,
  },
  slicePlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginBottom: 3,
  },
  sliceText: {
    fontSize: 9,
    fontFamily: 'Lato-Bold',
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    marginBottom: 1,
  },
  slicePetText: {
    fontSize: 8,
    fontFamily: 'Lato-Regular',
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  pointer: {
    position: 'absolute',
    top: -12,
    left: WHEEL_SIZE / 2 - 12,
    zIndex: 10,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pointerTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 20,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#EF4444',
  },
  centerCircle: {
    position: 'absolute',
    top: WHEEL_SIZE / 2 - 20,
    left: WHEEL_SIZE / 2 - 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#8B5CF6',
    zIndex: 5,
  },
  winnerContainer: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f3f4f6',
    marginTop: 8,
  },
  winnerText: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
    marginBottom: 4,
  },
  winnerName: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
  },
  statusText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
    textAlign: 'center',
    marginTop: 8,
  },
});

export default WheelSpin;
