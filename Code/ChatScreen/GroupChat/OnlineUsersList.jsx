import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { doc, getDoc } from '@react-native-firebase/firestore';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import { mixpanel } from '../../AppHelper/MixPenel';
import config from '../../Helper/Environment';

const BATCH_SIZE = 5; // Fetch 5 users at a time

const OnlineUsersList = ({ visible, onClose }) => {
  const { theme, user, firestoreDB } = useGlobalState();
  const { localState } = useLocalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';
  
  // ✅ Store all online users from Firestore (id, displayName, avatar, index)
  const [allOnlineUsers, setAllOnlineUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const [displayedCount, setDisplayedCount] = useState(BATCH_SIZE); // How many users are shown

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Fetch ALL online users (IDs + details) from Firestore ONCE when modal opens
  useEffect(() => {
    if (!visible || !firestoreDB) {
      // Reset when modal closes
      setAllOnlineUsers([]);
      setLoading(true);
      setSearchQuery('');
      setDisplayedCount(BATCH_SIZE);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const fetchOnlineUsers = async () => {
      try {
        // ✅ One-time fetch from Firestore (online_users/list)
        const onlineUsersDocRef = doc(firestoreDB, 'online_users', 'list');
        const docSnapshot = await getDoc(onlineUsersDocRef);

        if (!isMounted) return;

        if (!docSnapshot.exists) {
          setAllOnlineUsers([]);
          setLoading(false);
          return;
        }

        const data = docSnapshot.data() || {};
        const userIds = Array.isArray(data.userIds) ? data.userIds : [];
        const usersMap =
          typeof data.users === 'object' && data.users !== null ? data.users : {};

        // ✅ Build ordered array of users (filter out current user)
        const users = userIds
          .filter((id) => id !== user?.id)
          .map((id, index) => {
            const u = usersMap[id] || {};
            return {
              id,
              displayName: u.displayName || 'Anonymous',
              avatar:
                u.avatar ||
                'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
              index: index + 1, // 1-based index for display/search
            };
          });

        setAllOnlineUsers(users);
        setDisplayedCount(Math.min(BATCH_SIZE, users.length));

        if (isMounted) {
          setLoading(false);
        }
      } catch (error) {
        console.error('Error fetching online users from Firestore:', error);
        if (isMounted) {
          setAllOnlineUsers([]);
          setLoading(false);
        }
      }
    };

    fetchOnlineUsers();

    return () => {
      isMounted = false;
    };
  }, [visible, firestoreDB, user?.id]);

  // ✅ Load more users on scroll (5 by 5) - client-side paging only
  const handleLoadMore = useCallback(() => {
    if (loadingMore || searchQuery.trim()) return;
    if (displayedCount >= allOnlineUsers.length) return;

    setLoadingMore(true);
    const next = Math.min(displayedCount + BATCH_SIZE, allOnlineUsers.length);
    setDisplayedCount(next);
    setLoadingMore(false);
  }, [loadingMore, searchQuery, displayedCount, allOnlineUsers.length]);

  // ✅ Compute visible users (with search + pagination)
  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      // No search: show first `displayedCount` users
      return allOnlineUsers.slice(0, displayedCount);
    }

    // Search by displayName or index (as string)
    return allOnlineUsers.filter((u) => {
      const name = (u.displayName || '').toLowerCase();
      const indexStr = String(u.index || '');
      return name.includes(query) || indexStr.includes(query);
    });
  }, [allOnlineUsers, displayedCount, searchQuery]);

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
            {/* Include index in name for easier identification/search */}
            {`${item.displayName || 'Anonymous'}`}
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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1, justifyContent: 'flex-end' }}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
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
              <TouchableOpacity 
                onPress={() => setSearchQuery('')} 
                style={styles.clearButton}
              >
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
              maxToRenderPerBatch={5}
              windowSize={5}
              initialNumToRender={5}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.5}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListFooterComponent={
                !searchQuery.trim() && displayedCount < allOnlineUsers.length ? (
                  <View style={styles.loadMoreContainer}>
                    <ActivityIndicator size="small" color={config.colors.primary} />
                  </View>
                ) : null
              }
            />
          )}

          {/* Footer Info */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>
              {searchQuery.trim() 
                ? `${filteredUsers.length} ${filteredUsers.length === 1 ? 'user' : 'users'} found`
                : `${allOnlineUsers.length} ${allOnlineUsers.length === 1 ? 'user' : 'users'} online${displayedCount < allOnlineUsers.length ? ` (showing ${displayedCount})` : ''}`
              }
            </Text>
          </View>
        </View>
        </KeyboardAvoidingView>
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
      maxHeight: '100%',
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
    loadMoreContainer: {
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

export default OnlineUsersList;
