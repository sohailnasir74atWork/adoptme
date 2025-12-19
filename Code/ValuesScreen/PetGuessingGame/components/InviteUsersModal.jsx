// InviteUsersModal.jsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../../GlobelStats';
import { getOnlineUsersForInvite, sendGameInvite } from '../utils/gameInviteSystem';
import { showSuccessMessage, showErrorMessage } from '../../../Helper/MessageHelper';

const InviteUsersModal = ({ visible, onClose, roomId, currentUser }) => {
  const { appdatabase, firestoreDB, theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [invitingIds, setInvitingIds] = useState(new Set());
  const [invitedIds, setInvitedIds] = useState(new Set());

  useEffect(() => {
    if (visible && appdatabase && currentUser?.id) {
      loadOnlineUsers();
    } else {
      setOnlineUsers([]);
      setSearchQuery('');
      setInvitingIds(new Set());
      setInvitedIds(new Set());
    }
  }, [visible, appdatabase, currentUser?.id]);

  const loadOnlineUsers = async () => {
    setLoading(true);
    try {
      const users = await getOnlineUsersForInvite(appdatabase, firestoreDB, currentUser.id);
      setOnlineUsers(users);
    } catch (error) {
      console.error('Error loading online users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (user) => {
    if (!roomId || invitingIds.has(user.id) || invitedIds.has(user.id) || user.isPlaying) return;

    setInvitingIds((prev) => new Set([...prev, user.id]));

    try {
      const success = await sendGameInvite(firestoreDB, roomId, currentUser, user.id);
      
      if (success) {
        setInvitedIds((prev) => new Set([...prev, user.id]));
        showSuccessMessage('Invite Sent', `Invited ${user.displayName} to play!`);
      } else {
        showErrorMessage('Error', 'Failed to send invite. Please try again.');
      }
    } catch (error) {
      console.error('Error inviting user:', error);
      showErrorMessage('Error', 'Failed to send invite.');
    } finally {
      setInvitingIds((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
    }
  };

  const filteredUsers = onlineUsers.filter((user) =>
    user.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: isDarkMode ? '#1a1a1a' : '#fff' }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: isDarkMode ? '#fff' : '#000' }]}>
              Invite Friends to Play
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={[
              styles.searchInput,
              {
                backgroundColor: isDarkMode ? '#2a2a2a' : '#f5f5f5',
                color: isDarkMode ? '#fff' : '#000',
              },
            ]}
            placeholder="Search online users..."
            placeholderTextColor={isDarkMode ? '#999' : '#666'}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#8B5CF6" />
            </View>
          ) : filteredUsers.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon
                name="people-outline"
                size={64}
                color={isDarkMode ? '#666' : '#999'}
              />
              <Text style={[styles.emptyText, { color: isDarkMode ? '#999' : '#666' }]}>
                {searchQuery ? 'No users found' : 'No online users available'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredUsers}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => {
                const isInviting = invitingIds.has(item.id);
                const isInvited = invitedIds.has(item.id);
                const isPlaying = item.isPlaying;

                return (
                  <TouchableOpacity
                    style={[
                      styles.userItem,
                      { backgroundColor: isDarkMode ? '#2a2a2a' : '#f9f9f9' },
                    ]}
                    onPress={() => !isInvited && !isPlaying && handleInvite(item)}
                    disabled={isInviting || isInvited || isPlaying}
                  >
                    <Image
                      source={{
                        uri:
                          item.avatar ||
                          'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                      }}
                      style={styles.avatar}
                    />
                    <View style={styles.userInfo}>
                      <Text
                        style={[styles.userName, { color: isDarkMode ? '#fff' : '#000' }]}
                      >
                        {item.displayName}
                      </Text>
                      <View style={styles.onlineIndicator}>
                        <View style={styles.onlineDot} />
                        <Text style={[styles.onlineText, { color: isDarkMode ? '#999' : '#666' }]}>
                          {isPlaying ? 'Currently Playing' : 'Online'}
                        </Text>
                      </View>
                    </View>
                    {isInviting ? (
                      <ActivityIndicator size="small" color="#8B5CF6" />
                    ) : isInvited ? (
                      <View style={styles.invitedBadge}>
                        <Icon name="checkmark-circle" size={24} color="#10B981" />
                      </View>
                    ) : isPlaying ? (
                      <View style={styles.playingBadge}>
                        <Icon name="game-controller-outline" size={20} color="#F59E0B" />
                      </View>
                    ) : (
                      <TouchableOpacity
                        style={styles.inviteButton}
                        onPress={() => handleInvite(item)}
                      >
                        <Icon name="person-add-outline" size={20} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Lato-Bold',
  },
  closeButton: {
    padding: 8,
  },
  searchInput: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 16,
    fontSize: 14,
    fontFamily: 'Lato-Regular',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    marginTop: 16,
    fontSize: 16,
    fontFamily: 'Lato-Regular',
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
    marginBottom: 4,
  },
  onlineIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  onlineText: {
    fontSize: 12,
    fontFamily: 'Lato-Regular',
  },
  inviteButton: {
    backgroundColor: '#8B5CF6',
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  invitedBadge: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playingBadge: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 20,
  },
});

export default InviteUsersModal;
