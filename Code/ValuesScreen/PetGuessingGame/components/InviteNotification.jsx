// InviteNotification.jsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';
import { acceptGameInvite, declineGameInvite, listenToUserInvites } from '../utils/gameInviteSystem';
import { showSuccessMessage } from '../../../Helper/MessageHelper';

const InviteNotification = ({ currentUser, onAccept }) => {
  const { appdatabase, firestoreDB, theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const [pendingInvites, setPendingInvites] = useState([]);
  const [currentInvite, setCurrentInvite] = useState(null);
  const slideY = useRef(new Animated.Value(200)).current;

  useEffect(() => {
    if (!firestoreDB || !currentUser?.id) return;

    const unsubscribe = listenToUserInvites(firestoreDB, currentUser.id, (invites) => {
      setPendingInvites(invites);
      if (invites.length > 0 && !currentInvite) {
        setCurrentInvite(invites[0]);
        Animated.spring(slideY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 50,
          friction: 7,
        }).start();
      }
    });

    return () => unsubscribe();
  }, [firestoreDB, currentUser?.id]);

  useEffect(() => {
    if (currentInvite) {
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 7,
      }).start();
    } else {
      Animated.timing(slideY, {
        toValue: 200,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [currentInvite]);

  const handleAccept = async () => {
    if (!currentInvite) return;

    const success = await acceptGameInvite(
      firestoreDB,
      currentInvite.roomId,
      currentUser.id,
      {
        displayName: currentUser.displayName,
        avatar: currentUser.avatar,
      }
    );

    if (success) {
      showSuccessMessage('Joined!', 'You joined the game room!');
      setCurrentInvite(null);
      if (onAccept) {
        onAccept(currentInvite.roomId);
      }
    }
  };

  const handleDecline = async () => {
    if (!currentInvite) return;

    await declineGameInvite(firestoreDB, currentInvite.roomId, currentUser.id);
    setCurrentInvite(null);

    // Show next invite if available
    if (pendingInvites.length > 1) {
      setCurrentInvite(pendingInvites[1]);
    }
  };

  if (!currentInvite) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateY: slideY }],
        },
      ]}
    >
      <View
        style={[
          styles.notification,
          { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' },
        ]}
      >
        <Image
          source={{
            uri:
              currentInvite.fromUserAvatar ||
              'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          }}
          style={styles.avatar}
        />
        <View style={styles.content}>
          <Text
            style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}
          >
            Game Invite! 🎮
          </Text>
          <Text
            style={[styles.message, { color: isDarkMode ? '#999' : '#666' }]}
          >
            {currentInvite.fromUserName} invited you to play Pet Guessing!
          </Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.acceptButton, { backgroundColor: '#10B981' }]}
            onPress={handleAccept}
          >
            <Icon name="checkmark" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.declineButton, { backgroundColor: '#EF4444' }]}
            onPress={handleDecline}
          >
            <Icon name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingHorizontal: 16,
  },
  notification: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 1,
    borderColor: 'rgba(139, 92, 246, 0.3)',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontFamily: 'Lato-Bold',
    marginBottom: 4,
  },
  message: {
    fontSize: 12,
    fontFamily: 'Lato-Regular',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  acceptButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  declineButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default InviteNotification;
