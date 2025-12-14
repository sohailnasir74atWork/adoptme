import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useGlobalState } from '../../GlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useTranslation } from 'react-i18next';
import database from '@react-native-firebase/database';
import { showSuccessMessage } from '../../Helper/MessageHelper';

const InboxScreen = ({ chats, setChats, loading, bannedUsers }) => {
  const navigation = useNavigation();
  // const { chats = [], setChats } = route.params || {}; // ✅ Prevents errors if `params` is missing  
  const { user, theme } = useGlobalState();
  const { t } = useTranslation();

// console.log(chats)

  // console.log('inbox', chats)
  // ✅ Safety check for bannedUsers array
  const filteredChats = useMemo(() => {
    if (!Array.isArray(chats)) return [];
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    return chats.filter(chat =>
      chat?.chatId && !banned.includes(chat.otherUserId)
    );
  }, [chats, bannedUsers]);
  
  // const [loading, setLoading] = useState(false);
  const isDarkMode = theme === 'dark';
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

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

            if (!Array.isArray(chats)) {
              console.error('❌ Chats array not available');
              return;
            }

            const chatToDelete = chats.find(chat => chat?.chatId === chatId);
            if (!chatToDelete) {
              console.error('❌ Chat not found');
              return;
            }

            const otherUserId = chatToDelete.otherUserId;
            if (!otherUserId) {
              console.error('❌ Other user ID not available');
              return;
            }

            // 1. Delete chat metadata for the current user
            const senderChatRef = database().ref(`chat_meta_data/${user.id}/${otherUserId}`);
            const snapshot = await senderChatRef.once('value');

            if (snapshot.exists()) {
              await senderChatRef.remove();
            }

            // 2. Delete full chat thread using chatId
            const fullChatRef = database().ref(`private_messages/${chatId}`);
            await fullChatRef.remove();

            // 3. Update local state - ✅ Validate setChats callback
            if (setChats && typeof setChats === 'function') {
              setChats((prevChats) => {
                if (!Array.isArray(prevChats)) return [];
                return prevChats.filter((chat) => chat?.chatId !== chatId);
              });
            }

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
}, [chats, user?.id, setChats, t]);



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
      // ✅ Update local state to reset unread count - ✅ Validate setChats callback
      if (setChats && typeof setChats === 'function') {
        setChats((prevChats) => {
          if (!Array.isArray(prevChats)) return prevChats;
          return prevChats.map((chat) =>
            chat?.chatId === chatId ? { ...chat, unreadCount: 0 } : chat
          );
        });
      }
  
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
  }, [user?.id, setChats, navigation]);
  






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
          <Image 
            source={{ 
              uri: otherUserId !== user?.id ? otherUserAvatar : userAvatar 
            }} 
            style={styles.avatar} 
          />
          <View style={styles.textContainer}>
            <Text style={styles.userName}>
              {otherUserName}
              {isOnline && !isBanned && (
                <Text style={{ color: config.colors.hasBlockGreen }}> - Online</Text>
              )}
            </Text>
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
          <MenuOptions>
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
      {loading ? (
        <ActivityIndicator size="large" color="#1E88E5" style={{ flex: 1 }} />
      ) : filteredChats.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}> {t("chat.no_chats_available")}</Text>
        </View>
      ) : (
        <FlatList
          data={filteredChats}
          keyExtractor={(item, index) => item?.chatId || `chat-${index}`} // ✅ Ensure a unique key with safety check
          renderItem={renderChatItem}
          removeClippedSubviews={true} // ✅ Performance optimization
          maxToRenderPerBatch={10} // ✅ Performance optimization
          windowSize={10} // ✅ Performance optimization
        />
      )}
    </View>
  );
};

// Styles
const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      padding: 10,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',

    },
    itemContainer: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: '#ccc',
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
      fontSize: 14,
      fontFamily: 'Lato-Bold',
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
      color: isDarkMode ? 'white' : 'black',
      textAlign: 'center'
    }
  });

export default InboxScreen;
