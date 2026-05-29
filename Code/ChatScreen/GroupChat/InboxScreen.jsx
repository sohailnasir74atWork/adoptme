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
import { useNavigation } from '@react-navigation/native';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import BannerAdComponent from '../../Ads/bannerAds';
import { getThemeColors } from '../../Helper/themeColors';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage as showError } from '../../Helper/MessageHelper';
import { getMyStreaks } from '../../Helper/StreakHelper';
import FramedAvatar from '../GroupChat/FramedAvatar';
import { getCachedProfile } from '../../Helper/profileCache';
import {
  subscribeToChatMeta,
  resetUnreadCount,
  setChatMuted,
  deleteChatMeta,
} from '../../Supabase/chatMetaBackend';
import { ChatListSkeleton, SyncBanner } from './ChatListSkeleton';

// ✅ Constants for pagination (moved outside component to avoid recreation)
const INITIAL_LOAD = 15; // ✅ Initial chats to display
const LOAD_MORE = 10; // ✅ Load 10 more on scroll

const InboxScreen = ({ bannedUsers }) => {
  const navigation = useNavigation();
  const { user, theme, appdatabase, firestoreDB } = useGlobalState();
  const { localState } = useLocalState();
  const { t } = useTranslation();
  const [localLoading, setLocalLoading] = useState(false);
  const [localChats, setLocalChats] = useState([]);
  const [displayedChatsCount, setDisplayedChatsCount] = useState(INITIAL_LOAD); // ✅ Start with 15 chats
  const debounceTimerRef = useRef(null); // ✅ Debounce updateChatsList
  const [streaks, setStreaks] = useState(new Map());
  const [mutedChats, setMutedChats] = useState({}); // { otherUserId: boolean }
  const hasLoadedOnce = useRef(false); // ✅ Track if initial load is done
  // Realtime channel health — debounced so a quick blip doesn't flash
  // the "Reconnecting…" banner. Only shown if degraded for >1.5s.
  const [reconnecting, setReconnecting] = useState(false);
  const reconnectTimerRef = useRef(null);

  // Phase 5 clean-cut: this screen is Supabase-only for chat_meta_data
  // — reads via subscribeToChatMeta, writes via setChatMuted / resetUnreadCount
  // / deleteChatMeta. Mirrors PrivateChat's behaviour. Old-app builds
  // still write RTDB and the mirror CF replays those rows into Supabase,
  // so cross-version inbox state stays consistent during rollout.
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setLocalChats([]);
      setLocalLoading(false);
      return;
    }

    if (!hasLoadedOnce.current) setLocalLoading(true);

    const chatsMap = new Map();
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];

    const updateChatsList = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        InteractionManager.runAfterInteractions(() => {
          const updatedChats = Array.from(chatsMap.values())
            .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
          setLocalChats(updatedChats);
          setDisplayedChatsCount(INITIAL_LOAD);
          if (!hasLoadedOnce.current) {
            hasLoadedOnce.current = true;
            setLocalLoading(false);
          }
        });
      }, 500);
    };

    const handleUpsert = (chatData) => {
      if (!chatData || !chatData.partnerId) return;

      const chatPartnerId = chatData.partnerId;
      const isBlocked = banned.includes(chatPartnerId);
      const rawUnread = chatData.unreadCount || 0;

      // Block-user safety reset: zero the badge in Supabase directly so
      // a blocked contact's row never shows unread. Fire-and-forget —
      // the realtime channel will reconcile on the resulting UPDATE.
      if (isBlocked && rawUnread > 0) {
        resetUnreadCount(user.id, chatPartnerId).catch((error) => {
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

      // Derive mute state from the same row — avoids a second read.
      setMutedChats(prev => {
        const wasMuted = !!prev[chatPartnerId];
        const isMuted = !!chatData.muted;
        if (wasMuted === isMuted) return prev;
        const next = { ...prev };
        if (isMuted) next[chatPartnerId] = true; else delete next[chatPartnerId];
        return next;
      });

      updateChatsList();
    };

    const handleRemove = (partnerId) => {
      chatsMap.delete(partnerId);
      setMutedChats(prev => {
        if (!prev[partnerId]) return prev;
        const next = { ...prev };
        delete next[partnerId];
        return next;
      });
      updateChatsList();
    };

    const unsubscribe = subscribeToChatMeta(user.id, {
      onUpsert: handleUpsert,
      onRemove: handleRemove,
      // Empty-list path: subscribeToChatMeta still fires onReady once
      // initial load + SUBSCRIBED both land, so we drop the spinner
      // even when the user has zero chats.
      onReady: () => {
        if (!hasLoadedOnce.current) {
          hasLoadedOnce.current = true;
          setLocalLoading(false);
        }
      },
      onStatus: (status) => {
        // Show the reconnecting pill only after the channel has been
        // degraded for >1.5s — a momentary handshake flicker shouldn't
        // toggle UI. Once SUBSCRIBED, clear immediately.
        if (status === 'SUBSCRIBED') {
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          setReconnecting(false);
          return;
        }
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            setReconnecting(true);
            reconnectTimerRef.current = null;
          }, 1500);
        }
      },
    });

    const loadingFallback = setTimeout(() => {
      if (!hasLoadedOnce.current) {
        hasLoadedOnce.current = true;
        setLocalLoading(false);
      }
    }, 2000);

    return () => {
      unsubscribe();
      clearTimeout(loadingFallback);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setReconnecting(false);
    };
  }, [user?.id, appdatabase, bannedUsers]);

  // 🔥 Fetch streaks on mount
  useEffect(() => {
    if (!user?.id || !firestoreDB) return;
    getMyStreaks(firestoreDB, user.id)
      .then(map => setStreaks(map))
      .catch(() => { });
  }, [user?.id, firestoreDB]);

  // 🔔 Toggle mute for a private chat
  const handleToggleMute = useCallback(async (otherUserId, otherUserName) => {
    if (!user?.id || !otherUserId) return;
    const currentMuted = mutedChats[otherUserId] || false;
    const newMuted = !currentMuted;
    try {
      await setChatMuted(user.id, otherUserId, newMuted);
      setMutedChats(prev => ({ ...prev, [otherUserId]: newMuted }));
      showSuccessMessage(
        'Success',
        newMuted
          ? `Notifications muted for "${otherUserName}"`
          : `Notifications enabled for "${otherUserName}"`
      );
    } catch (error) {
      console.warn('[Inbox] toggle mute error:', error?.message);
      showError('Error', 'Failed to update notification settings.');
    }
  }, [user?.id, mutedChats]);

  const allChats = localChats;
  const displayLoading = localLoading;

  // Safety: ban-filter + dedup-by-chatId so the FlatList never sees two rows
  // with the same key (can happen if upstream meta delivery double-fires
  // during reconnect / chat-meta sync churn).
  const filteredChats = useMemo(() => {
    if (!Array.isArray(allChats)) return [];
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    const seen = new Set();
    const out = [];
    for (const chat of allChats) {
      if (!chat?.chatId) continue;
      if (banned.includes(chat.otherUserId)) continue;
      if (seen.has(chat.chatId)) continue;
      seen.add(chat.chatId);
      out.push(chat);
    }
    return out;
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
              await deleteChatMeta(user.id, otherUserId);

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
      // Reset unread immediately in both local state and Supabase so the
      // badge clears without waiting for the mirror CF (which can lag
      // 100–500ms, more under disk IO pressure).
      setLocalChats((prevChats) => {
        if (!Array.isArray(prevChats)) return prevChats;
        return prevChats.map((chat) =>
          chat?.chatId === chatId ? { ...chat, unreadCount: 0 } : chat
        );
      });
      resetUnreadCount(user.id, otherUserId); // fire-and-forget

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
        <TouchableOpacity
          onPress={() => handleToggleMute(otherUserId, otherUserName)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ paddingHorizontal: 6 }}
        >
          <Icon
            name={mutedChats[otherUserId] ? 'notifications-off' : 'notifications-outline'}
            size={20}
            color={mutedChats[otherUserId] ? '#EF4444' : (isDarkMode ? '#94A3B8' : '#64748B')}
          />
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
  }, [styles, user, handleOpenChat, handleDelete, handleToggleMute, mutedChats, isDarkMode, t]);

  return (
    <View style={styles.container}>
      <SyncBanner visible={reconnecting && !displayLoading} isDarkMode={isDarkMode} />
      {displayLoading ? (
        <ChatListSkeleton count={6} isDarkMode={isDarkMode} />
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
      {!localState.isPro && <BannerAdComponent />}
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
