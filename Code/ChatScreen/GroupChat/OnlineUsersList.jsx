import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  FlatList,
  Image,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { ref, onChildAdded, onChildRemoved, get } from '@react-native-firebase/database';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { isUserOnline } from '../utils';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import { mixpanel } from '../../AppHelper/MixPenel';
import config from '../../Helper/Environment';

const OnlineUsersList = ({ visible, onClose }) => {
  const { theme, user, appdatabase } = useGlobalState();
  const { localState } = useLocalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';
  
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const userDetailsRef = useRef({}); // ✅ Use ref to cache user details (prevents re-renders)

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Fetch user details from Firebase - optimized with ref to prevent re-renders
  const fetchUserDetails = useCallback(async (userId) => {
    if (!userId) {
      return {
        id: userId,
        displayName: 'Anonymous',
        avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
      };
    }

    // ✅ Check cache first (using ref - no re-renders)
    if (userDetailsRef.current[userId]) {
      return userDetailsRef.current[userId];
    }

    try {
      const userRef = ref(appdatabase, `users/${userId}`);
      const snapshot = await get(userRef);
      
      if (snapshot.exists()) {
        const data = snapshot.val();
        const userInfo = {
          id: userId,
          displayName: data?.displayName || 'Anonymous',
          avatar: data?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        };
        
        // ✅ Cache in ref (no state update = no re-render)
        userDetailsRef.current[userId] = userInfo;
        return userInfo;
      }
    } catch (error) {
      console.error(`Error fetching user ${userId}:`, error);
    }
    
    // ✅ Default user and cache it
    const defaultUser = {
      id: userId,
      displayName: 'Anonymous',
      avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
    };

    userDetailsRef.current[userId] = defaultUser;
    return defaultUser;
  }, [appdatabase]);

  // ✅ Listen to online users - OPTIMIZED: Incremental updates (Solution 1)
  useEffect(() => {
    if (!visible || !appdatabase) {
      // Reset when modal closes
      setOnlineUsers([]);
      setLoading(true);
      userDetailsRef.current = {}; // Clear cache when modal closes
      return;
    }

    let isMounted = true;
    let isInitialLoad = true;
    let initialLoadTimeout;
    setLoading(true);
    const onlineUsersRef = ref(appdatabase, 'online_users');
    
    // ✅ Helper: Update user in list (add or update)
    // ✅ OPTIMIZED: New users added to bottom, no sorting = stable list
    const addOrUpdateUser = async (userId) => {
      if (!isMounted || !userId) return;
      
      try {
        const userInfo = await fetchUserDetails(userId);
        if (!userInfo || !isMounted) return;
        
        // ✅ Add timestamp for tracking (optional, for future features)
        const userInfoWithTime = {
          ...userInfo,
          joinedAt: Date.now(), // Track when user was added to list
        };
        
        setOnlineUsers(prev => {
          // Check if user already exists
          const existingIndex = prev.findIndex(u => u?.id === userId);
          if (existingIndex >= 0) {
            // ✅ Update existing user in place (maintains position)
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              ...userInfoWithTime,
              // Preserve original position and joinedAt
              joinedAt: updated[existingIndex].joinedAt || userInfoWithTime.joinedAt,
            };
            return updated;
          } else {
            // ✅ Add new user to BOTTOM (no sorting = stable list)
            // This keeps the list stable - existing users stay in place
            return [...prev, userInfoWithTime];
          }
        });
      } catch (error) {
        console.error(`Error adding/updating user ${userId}:`, error);
      }
    };

    // ✅ Helper: Remove user from list
    const removeUser = (userId) => {
      if (!isMounted || !userId) return;
      
      setOnlineUsers(prev => prev.filter(u => u?.id !== userId));
    };

    // ✅ Listen for new users joining (child_added)
    const unsubscribeAdded = onChildAdded(onlineUsersRef, async (snapshot) => {
      if (!isMounted) return;
      
      const userId = snapshot.key;
      if (!userId) return;

      // Fetch user details only for the NEW user (cost-optimized!)
      await addOrUpdateUser(userId);
      
      // Mark initial load as complete after first user or timeout
      if (isInitialLoad) {
        clearTimeout(initialLoadTimeout);
        initialLoadTimeout = setTimeout(() => {
          if (isMounted && isInitialLoad) {
            setLoading(false);
            isInitialLoad = false;
          }
        }, 1000); // Wait 1 second for initial users to load
      }
    }, (error) => {
      console.error('Error listening to child_added:', error);
      if (isMounted && isInitialLoad) {
        setLoading(false);
        isInitialLoad = false;
      }
    });

    // ✅ Listen for users leaving (child_removed)
    const unsubscribeRemoved = onChildRemoved(onlineUsersRef, (snapshot) => {
      if (!isMounted) return;
      
      const userId = snapshot.key;
      if (userId) {
        removeUser(userId);
      }
    }, (error) => {
      console.error('Error listening to child_removed:', error);
    });

    // ✅ Initial load timeout (in case no users are online)
    initialLoadTimeout = setTimeout(() => {
      if (isMounted && isInitialLoad) {
        setLoading(false);
        isInitialLoad = false;
      }
    }, 2000);

    return () => {
      isMounted = false;
      clearTimeout(initialLoadTimeout);
      unsubscribeAdded();
      unsubscribeRemoved();
    };
  }, [visible, appdatabase, fetchUserDetails]);

  // ✅ Filter users based on search query
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return onlineUsers;
    
    const query = searchQuery.toLowerCase();
    return onlineUsers.filter(user => 
      user?.displayName?.toLowerCase().includes(query)
    );
  }, [onlineUsers, searchQuery]);

  // ✅ Handle start private chat
  const handleStartChat = useCallback((selectedUser) => {
    const callbackFunction = () => {
      onClose();
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('PrivateChat', {
          selectedUser: {
            senderId: selectedUser.id,
            sender: selectedUser.displayName,
            avatar: selectedUser.avatar,
          },
        });
      }
      mixpanel.track("Online Users Chat");
    };

    if (!localState?.isPro) {
      InterstitialAdManager.showAd(callbackFunction);
    } else {
      callbackFunction();
    }
  }, [onClose, navigation, localState?.isPro]);

  // ✅ Memoize render user item
  const renderUserItem = useCallback(({ item }) => {
    if (!item || !item.id) return null;

    return (
      <TouchableOpacity
        style={styles.userItem}
        onPress={() => handleStartChat(item)}
        activeOpacity={0.7}
      >
        <View style={styles.userItemLeft}>
          <Image
            source={{ uri: item.avatar }}
            style={styles.avatar}
            defaultSource={{ uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
          />
          <View style={styles.onlineIndicator} />
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>
            {item.displayName || 'Anonymous'}
          </Text>
        </View>
        <Icon name="chatbubble-outline" size={20} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
      </TouchableOpacity>
    );
  }, [styles, handleStartChat, isDarkMode]);

  // ✅ Memoize key extractor
  const keyExtractor = useCallback((item) => item?.id || Math.random().toString(), []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={styles.modalOverlay} 
        activeOpacity={1}
        onPress={onClose}
      >
        <View 
          style={styles.modalContent}
          onStartShouldSetResponder={() => true}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Online Users</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close" size={24} color={isDarkMode ? '#FFFFFF' : '#000000'} />
            </TouchableOpacity>
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <Icon name="search" size={20} color={isDarkMode ? '#9CA3AF' : '#6B7280'} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search users..."
              placeholderTextColor={isDarkMode ? '#9CA3AF' : '#6B7280'}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
                <Icon name="close-circle" size={20} color={isDarkMode ? '#9CA3AF' : '#6B7280'} />
              </TouchableOpacity>
            )}
          </View>

          {/* Users List */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={config.colors.primary} />
            </View>
          ) : filteredUsers.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Icon 
                name="people-outline" 
                size={64} 
                color={isDarkMode ? '#4B5563' : '#D1D5DB'} 
              />
              <Text style={styles.emptyText}>
                {searchQuery ? 'No users found' : 'No online users'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredUsers}
              renderItem={renderUserItem}
              keyExtractor={keyExtractor}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={true}
              maxToRenderPerBatch={10}
              windowSize={10}
              initialNumToRender={15}
              // ✅ Maintain scroll position when items are added/removed (keeps list stable)
              maintainVisibleContentPosition={{
                minIndexForVisible: 0,
              }}
            />
          )}

          {/* Footer Info */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {filteredUsers.length} {filteredUsers.length === 1 ? 'user' : 'users'} online
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '90%',
      minHeight: '60%',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 20,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? '#374151' : '#E5E7EB',
    },
    headerTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: isDark ? '#FFFFFF' : '#111827',
      fontFamily: 'Lato-Bold',
    },
    closeButton: {
      padding: 4,
    },
    searchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      margin: 16,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: isDark ? '#374151' : '#F3F4F6',
      borderRadius: 12,
    },
    searchIcon: {
      marginRight: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 16,
      color: isDark ? '#FFFFFF' : '#111827',
      fontFamily: 'Lato-Regular',
    },
    clearButton: {
      marginLeft: 8,
      padding: 4,
    },
    list: {
      flex: 1,
    },
    listContent: {
      padding: 8,
    },
    userItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      marginVertical: 4,
      marginHorizontal: 8,
      backgroundColor: isDark ? '#374151' : '#F9FAFB',
      borderRadius: 12,
    },
    userItemLeft: {
      position: 'relative',
      marginRight: 12,
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: isDark ? '#4B5563' : '#E5E7EB',
    },
    onlineIndicator: {
      position: 'absolute',
      bottom: 2,
      right: 2,
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: '#10B981',
      borderWidth: 2,
      borderColor: isDark ? '#1F2937' : '#FFFFFF',
    },
    userInfo: {
      flex: 1,
      marginRight: 8,
    },
    userName: {
      fontSize: 16,
      fontWeight: '600',
      color: isDark ? '#FFFFFF' : '#111827',
      fontFamily: 'Lato-SemiBold',
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 40,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 60,
    },
    emptyText: {
      marginTop: 16,
      fontSize: 16,
      color: isDark ? '#9CA3AF' : '#6B7280',
      fontFamily: 'Lato-Regular',
    },
    footer: {
      padding: 16,
      borderTopWidth: 1,
      borderTopColor: isDark ? '#374151' : '#E5E7EB',
      alignItems: 'center',
    },
    footerText: {
      fontSize: 14,
      color: isDark ? '#9CA3AF' : '#6B7280',
      fontFamily: 'Lato-Regular',
    },
  });

export default OnlineUsersList;

