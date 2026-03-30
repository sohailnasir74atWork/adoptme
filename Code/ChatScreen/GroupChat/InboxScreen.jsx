import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
  InteractionManager,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useTranslation } from 'react-i18next';
import { ref, get, update, remove, onChildAdded, onChildChanged, onChildRemoved } from '@react-native-firebase/database';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { getMyStreaks } from '../../Helper/StreakHelper';
import FramedAvatar from '../GroupChat/FramedAvatar';
import { getCachedProfile } from '../../Helper/profileCache';

// ✅ Constants for pagination (moved outside component to avoid recreation)
const INITIAL_LOAD = 15; // ✅ Initial chats to display
const LOAD_MORE = 10; // ✅ Load 10 more on scroll

const InboxScreen = ({ bannedUsers }) => {
  const navigation = useNavigation();
  const { user, theme, appdatabase, firestoreDB } = useGlobalState();
  const { t } = useTranslation();
  const [localLoading, setLocalLoading] = useState(false);
  const [localChats, setLocalChats] = useState([]);
  const [displayedChatsCount, setDisplayedChatsCount] = useState(INITIAL_LOAD); // ✅ Start with 15 chats
  const debounceTimerRef = useRef(null); // ✅ Debounce updateChatsList
  const [streaks, setStreaks] = useState(new Map());
  const hasLoadedOnce = useRef(false); // ✅ Track if initial load is done

  // ✅ OPTIMIZED: Use get() for initial load + child listeners for updates
  // This prevents re-downloading entire chat_meta_data on every change
  // Only downloads changed chats instead of all chats
  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !appdatabase) {
        setLocalChats([]);
        setLocalLoading(false);
        return;
      }

      // ✅ Only show loading spinner on first load, not when returning from a chat
      if (!hasLoadedOnce.current) {
        setLocalLoading(true);
      }
      const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);
      const chatsMap = new Map(); // Track chats locally
      const banned = Array.isArray(bannedUsers) ? bannedUsers : [];

      // ✅ OPTIMIZED: Use child listeners from start instead of initial get()
      // This prevents downloading all chat metadata at once (11.35 KB per user)
      // Child listeners only download individual chats as they're added (~200-500 bytes each)
      // This reduces Firebase RTDB download costs significantly for users with many chats
      const loadInitialChats = async () => {
        try {
          const snapshot = await get(ref(appdatabase, `chat_meta_data/${user.id}`));
          if (snapshot.exists()) {
            const data = snapshot.val();
            if (data && typeof data === 'object') {
              Object.entries(data).forEach(([chatPartnerId, chatData]) => {
                if (!chatData || typeof chatData !== 'object') return;
                const isBlocked = banned.includes(chatPartnerId);
                const rawUnread = chatData?.unreadCount || 0;
                chatsMap.set(chatPartnerId, {
                  chatId: chatData.chatId,
                  otherUserId: chatPartnerId,
                  lastMessage: chatData.lastMessage || 'No messages yet',
                  lastMessageTimestamp: chatData.timestamp || 0,
                  unreadCount: isBlocked ? 0 : rawUnread,
                  otherUserAvatar: chatData.receiverAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                  otherUserName: chatData.receiverName || 'Anonymous',
                });
              });
              const sorted = Array.from(chatsMap.values())
                .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
              setLocalChats(sorted);
            }
          }
        } catch (error) {
          console.error('Error loading initial chats:', error);
        }
        setLocalLoading(false);
        hasLoadedOnce.current = true;
      };

      // ✅ FIXED: Debounced helper to batch rapid child_changed events
      // Without this, every single message in any chat triggers sort + 2x setState
      const updateChatsList = () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          // ✅ Run sort + setState after animations/interactions finish
          InteractionManager.runAfterInteractions(() => {
            const updatedChats = Array.from(chatsMap.values())
              .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
            setLocalChats(updatedChats);
            setDisplayedChatsCount(INITIAL_LOAD);
          });
        }, 500); // 500ms debounce — batches rapid updates to prevent freeze
      };

      // ✅ OPTIMIZED: Use child listeners for updates (only downloads changed chats)
      const handleChildChange = (snapshot) => {
        if (!snapshot || !snapshot.key) return;
        const chatData = snapshot.val();
        if (!chatData || typeof chatData !== 'object') return;

        const chatPartnerId = snapshot.key;
        const isBlocked = banned.includes(chatPartnerId);
        const rawUnread = chatData?.unreadCount || 0;

        if (isBlocked && rawUnread > 0) {
          const blockedChatRef = ref(appdatabase, `chat_meta_data/${user.id}/${chatPartnerId}`);
          update(blockedChatRef, { unreadCount: 0 }).catch((error) => {
            console.error("Error resetting unread count:", error);
          });
        }

        chatsMap.set(chatPartnerId, {
          chatId: chatData.chatId,
          otherUserId: chatPartnerId,
          lastMessage: chatData.lastMessage || 'No messages yet',
          lastMessageTimestamp: chatData.timestamp || 0,
          unreadCount: isBlocked ? 0 : rawUnread,
          otherUserAvatar: chatData.receiverAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          otherUserName: chatData.receiverName || 'Anonymous',
        });

        updateChatsList();
      };

      const handleChildRemoved = (snapshot) => {
        if (!snapshot || !snapshot.key) return;
        chatsMap.delete(snapshot.key);
        updateChatsList();
      };

      // Load initial data
      loadInitialChats();

      // Listen to individual chat changes (only downloads changed chats, not all)
      const unsubAdded = onChildAdded(userChatsRef, handleChildChange);
      const unsubChanged = onChildChanged(userChatsRef, handleChildChange);
      const unsubRemoved = onChildRemoved(userChatsRef, handleChildRemoved);

      // ✅ Cleanup listeners + debounce timer when screen loses focus
      return () => {
        unsubAdded();
        unsubChanged();
        unsubRemoved();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        setDisplayedChatsCount(INITIAL_LOAD);
      };
    }, [user?.id, appdatabase, bannedUsers])
  );

  // 🔥 Fetch streaks on mount
  useEffect(() => {
    if (!user?.id || !firestoreDB) return;
    getMyStreaks(firestoreDB, user.id)
      .then(map => setStreaks(map))
      .catch(() => { });
  }, [user?.id, firestoreDB]);

  const allChats = localChats;
  const displayLoading = localLoading;

  // ✅ Safety check for bannedUsers array and filter
  const filteredChats = useMemo(() => {
    if (!Array.isArray(allChats)) return [];
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    return allChats.filter(chat =>
      chat?.chatId && !banned.includes(chat.otherUserId)
    );
  }, [allChats, bannedUsers]);

  // ✅ OPTIMIZED: Only display paginated chats (15 initially, then 10 more on scroll)
  const displayedChats = useMemo(() => {
    return filteredChats.slice(0, displayedChatsCount);
  }, [filteredChats, displayedChatsCount]);

  // ✅ Handle load more on scroll
  const handleLoadMore = useCallback(() => {
    if (displayedChatsCount < filteredChats.length) {
      setDisplayedChatsCount(prev => Math.min(prev + LOAD_MORE, filteredChats.length));
    }
  }, [displayedChatsCount, filteredChats.length]);

  // const [loading, setLoading] = useState(false);
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode, c), [isDarkMode]);


  // ✅ Memoize handleDelete with useCallback
  const handleDelete = useCallback((chatId) => {
    // ✅ Safety check
    if (!chatId) {
      console.error('❌ Invalid chatId for handleDelete');
      return;
    }

    Alert.alert(
      t("chat.delete_chat"),
      t("chat.delete_chat_confirmation"),
      [
        { text: t("chat.cancel"), style: 'cancel' },
        {
          text: t("chat.delete"),
          style: 'destructive',
          onPress: async () => {
            try {
              // ✅ Safety checks
              if (!user?.id) {
                console.error('❌ User ID not available');
                return;
              }

              if (!Array.isArray(allChats) || allChats.length === 0) {
                console.error('❌ Chats array not available');
                return;
              }

              const chatToDelete = allChats.find(chat => chat?.chatId === chatId);
              if (!chatToDelete) {
                console.error('❌ Chat not found');
                return;
              }

              const otherUserId = chatToDelete.otherUserId;
              if (!otherUserId) {
                console.error('❌ Other user ID not available');
                return;
              }

              // Delete chat metadata for the current user only (other user keeps their chat)
              const senderChatRef = ref(appdatabase, `chat_meta_data/${user.id}/${otherUserId}`);
              await remove(senderChatRef);

              // 3. Update local state - ✅ Validate setChats callback
              setLocalChats((prevChats) => {
                if (!Array.isArray(prevChats)) return [];
                return prevChats.filter((chat) => chat?.chatId !== chatId);
              });

              showSuccessMessage(t("home.alert.success"), t("chat.chat_success_message"));
            } catch (error) {
              console.error('❌ Error deleting chat:', error);
              Alert.alert('Error', 'Failed to delete chat. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  }, [allChats, user?.id, t]);



  // ✅ Memoize handleOpenChat with useCallback
  const handleOpenChat = useCallback(async (chatId, otherUserId, otherUserName, otherUserAvatar) => {
    // ✅ Safety checks
    if (!user?.id) {
      console.error('❌ User ID not available');
      return;
    }

    if (!chatId || !otherUserId) {
      console.error('❌ Invalid chat parameters');
      return;
    }

    try {
      // ✅ Update local state to reset unread count
      setLocalChats((prevChats) => {
        if (!Array.isArray(prevChats)) return prevChats;
        return prevChats.map((chat) =>
          chat?.chatId === chatId ? { ...chat, unreadCount: 0 } : chat
        );
      });

      // ✅ Navigate to PrivateChat with isOnline status
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('PrivateChat', {
          selectedUser: {
            senderId: otherUserId,
            sender: otherUserName || 'Anonymous',
            avatar: otherUserAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          },
        });
      }

    } catch (error) {
      console.error("Error opening chat:", error);
      Alert.alert('Error', 'Failed to open chat. Please try again.');
    }
  }, [user?.id, navigation]);







  // ✅ Memoize renderChatItem with useCallback
  const renderChatItem = useCallback(({ item }) => {
    // ✅ Safety checks
    if (!item || typeof item !== 'object') return null;

    const chatId = item.chatId;
    const otherUserId = item.otherUserId;
    const otherUserName = item.otherUserName || 'Anonymous';
    const otherUserAvatar = item.otherUserAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
    const userAvatar = user?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
    const lastMessage = item.lastMessage || 'No messages yet';
    const unreadCount = item.unreadCount || 0;
    const isOnline = item.isOnline || false;
    const isBanned = item.isBanned || false;

    return (
      <View style={styles.itemContainer}>
        <TouchableOpacity
          style={styles.chatItem}
          onPress={() => handleOpenChat(chatId, otherUserId, otherUserName, otherUserAvatar)}
        >
          {(() => {
            const profile = getCachedProfile(otherUserId);
            return (
              <View style={{ marginRight: 10 }}>
                <FramedAvatar
                  avatarUri={otherUserId !== user?.id ? otherUserAvatar : userAvatar}
                  frame={profile?.profileFrame || null}
                  isDarkMode={isDarkMode}
                  avatarSize={46}
                />
              </View>
            );
          })()}
          <View style={styles.textContainer}>
            <Text style={styles.userName}>
              {otherUserName}
              {isOnline && !isBanned && (
                <Text style={{ color: '#22c55e' }}> - Online</Text>
              )}
            </Text>
            {streaks.get(otherUserId) >= 2 && (
              <Text style={{ fontSize: 12, marginTop: 2, color: isDarkMode ? '#fff' : '#000' }}>🔥 {streaks.get(otherUserId)}</Text>
            )}
            <Text style={styles.lastMessage} numberOfLines={1}>
              {lastMessage}
            </Text>
          </View>
          {unreadCount > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <Menu>
          <MenuTrigger>
            <Icon
              name="ellipsis-vertical-outline"
              size={20}
              color={config.colors.primary}
              style={{ paddingLeft: 10 }}
            />
          </MenuTrigger>
          <MenuOptions customStyles={{
            optionsContainer: {
              borderRadius: 8,
              padding: 4,
              backgroundColor: isDarkMode ? '#1e293b' : '#fff',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.15,
              shadowRadius: 4,
              elevation: 5,
              width: 150,
            },
          }}>
            <MenuOption onSelect={() => handleDelete(chatId)}>
              <Text style={{ color: 'red', fontSize: 16, padding: 10 }}> {t("chat.delete")}</Text>
            </MenuOption>
          </MenuOptions>
        </Menu>
      </View>
    );
  }, [styles, user, handleOpenChat, handleDelete, t]);

  return (
    <View style={styles.container}>
      {displayLoading ? (
        <ActivityIndicator size="large" color="#1E88E5" style={{ flex: 1 }} />
      ) : filteredChats.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}> {t("chat.no_chats_available")}</Text>
        </View>
      ) : (
        <FlatList
          data={displayedChats}
          keyExtractor={(item, index) => item?.chatId || `chat-${index}`}
          renderItem={renderChatItem}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={10}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            displayedChatsCount < filteredChats.length ? (
              <View style={styles.loadMoreContainer}>
                <ActivityIndicator size="small" color="#1E88E5" />
                <Text style={styles.loadMoreText}>
                  Loading more chats... ({displayedChatsCount} of {filteredChats.length})
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
};

// Styles
const getStyles = (isDarkMode, c) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0f172a' : '#f2f2f7',
    },
    itemContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: isDarkMode ? '#333' : '#e5e7eb',
      paddingHorizontal: 10,
    },
    chatItem: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 15,
      justifyContent: 'space-between'
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      marginRight: 10,
      backgroundColor: 'white'
    },
    textContainer: {
      flex: 1,
    },
    userName: {
      fontSize: 15,
      fontWeight: 'bold',
      color: isDarkMode ? '#fff' : '#333',
    },
    lastMessage: {
      fontSize: 14,
      color: '#555',
    },
    unreadBadge: {
      backgroundColor: config.colors.hasBlockGreen,
      borderRadius: 12,
      minWidth: 24,
      height: 24,
      justifyContent: 'center',
      alignItems: 'center',
    },
    unreadBadgeText: {
      color: '#fff',
      fontSize: 12,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyText: {
      color: c.text,
      textAlign: 'center'
    },
    loadMoreContainer: {
      paddingVertical: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadMoreText: {
      marginTop: 8,
      fontSize: 12,
      color: c.textSecondary,

    }
  });

export default React.memo(InboxScreen);
