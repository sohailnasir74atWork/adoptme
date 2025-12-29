import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { ScrollView } from 'react-native-gesture-handler';
import config from '../../Helper/Environment';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import ChatRulesModal from './ChatRuleModal';
import OnlineUsersList from './OnlineUsersList';
import PetGuessingGameScreen from '../../ValuesScreen/PetGuessingGame/PetGuessingGameScreen';

// ✅ Pre-compile regex for better performance
const URL_REGEX = /(https?:\/\/[^\s]+)/g;

const AdminHeader = ({
  selectedTheme,
  modalVisibleChatinfo,
  setModalVisibleChatinfo,
  triggerHapticFeedback,
  unreadcount,
  setunreadcount,
  pinnedMessages,
  onUnpinMessage,
}) => {
  const { theme, user, isAdmin } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [pinMessageOpen, setPinMessageOpen] = useState(false);
  const [onlineUsersVisible, setOnlineUsersVisible] = useState(false);
  const [gameModalVisible, setGameModalVisible] = useState(false);

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // ✅ Memoize function to detect and wrap URLs with clickable text
  const renderMessageWithLinks = useCallback((message) => {
    // ✅ Safety check
    if (!message || typeof message !== 'string') {
      return <Text style={styles.pinnedText}>Invalid message</Text>;
    }

    const parts = message.split(URL_REGEX);
    return parts.map((part, index) => {
      // ✅ Check if part matches URL pattern (more efficient than testing regex again)
      if (part && (part.startsWith('http://') || part.startsWith('https://'))) {
        // This part is a URL, make it clickable and underlined
        return (
          <Text
            key={index}
            style={[styles.pinnedText, { textDecorationLine: 'underline', color: 'blue' }]}
            onPress={() => {
              Linking.openURL(part).catch((error) => {
                console.error('Failed to open URL:', error);
                Alert.alert('Error', 'Could not open the link.');
              });
            }}
          >
            {part}
          </Text>
        );
      }
      return <Text key={index} style={styles.pinnedText}>{part}</Text>;
    });
  }, [styles.pinnedText]);

  // ✅ Memoize unique pinned messages
  const uniquePinnedMessages = useMemo(() => {
    if (!Array.isArray(pinnedMessages) || pinnedMessages.length === 0) {
      return [];
    }
    return Array.from(
      new Map(pinnedMessages.map((msg) => [msg?.firebaseKey, msg]).filter(([key]) => key)).values()
    );
  }, [pinnedMessages]);

  return (
    <View>
      <View style={styles.stackContainer}>
        <View style={{ paddingVertical: 10 }}>
          <Text style={styles.stackHeader}>Chat</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {user?.id && (
            <>
              {/* Online Users Button */}
              <TouchableOpacity
                onPress={() => {
                  setOnlineUsersVisible(true);
                  triggerHapticFeedback('impactLight');
                }}
                style={styles.iconContainer}
              >
                <Icon
                  name="people-outline"
                  size={24}
                  color={config.colors.primary}
                />
              </TouchableOpacity>

              {/* Pet Guessing Game Button */}
              <TouchableOpacity
                onPress={() => {
                  setGameModalVisible(true);
                  triggerHapticFeedback?.('impactLight');
                }}
                style={styles.iconContainer}
              >
                <Icon
                  name="game-controller-outline"
                  size={24}
                  color={config.colors.primary}
                />
              </TouchableOpacity>

              {/* Inbox Button */}
              <TouchableOpacity
                onPress={() => {
                  navigation.navigate('Inbox');
                  triggerHapticFeedback('impactLight');
                  setunreadcount(0);
                }}
                style={styles.iconContainer}
              >
                <Icon
                  name="chatbox-outline"
                  size={24}
                  color={selectedTheme.colors.text}
                  style={styles.icon2}
                />
                {unreadcount > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{unreadcount > 9 ? '9+' : unreadcount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </>
          )}
          {user?.id && (
            <Menu>
              <MenuTrigger>
                <Icon name="ellipsis-vertical-outline" size={24} color={config.colors.primary} />
              </MenuTrigger>
              <MenuOptions
                customStyles={{
                  optionsContainer: {
                    marginTop: 8,
                    borderRadius: 8,
                    width: 220,
                    padding: 5,
                    backgroundColor: config.colors.background || '#fff',
                  },
                }}
              >

                <MenuOption onSelect={() => navigation?.navigate('BlockedUsers')}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                    <Icon name="ban-outline" size={20} color={config.colors.primary} style={{ marginRight: 10 }} />
                    <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>
                      {t("chat.blocked_users")}
                    </Text>
                  </View>
                </MenuOption>
              </MenuOptions>
            </Menu>
          )}
        </View>
      </View>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between', padding: 10, alignItems: 'center', borderBottomWidth: .3, borderBottomColor: 'lightgrey',
      }}>
        <Text style={{ fontSize: 12, color: isDarkMode ? 'white' : 'black' }}>🚫 No Spamming ❌ No Abuse 🛑 Be Civil & Polite 😊
        </Text>
        <TouchableOpacity onPress={() => { setModalVisibleChatinfo(true); triggerHapticFeedback('impactLight'); }}>

          <Icon name="information-circle-outline" size={20} color={config.colors.primary} style={{ marginRight: 10 }} />
          {/* <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>
                      {t("chat.chat_rules")}
                    </Text> */}
        </TouchableOpacity>
      </View>

      {/* Displaying truncated pinned messages */}
      {uniquePinnedMessages.length > 0 && (
        <View style={styles.pinnedContainer}>
          {uniquePinnedMessages.slice(0, 1).map((msg) => {
            // ✅ Safety check and optimize string operations
            const msgText = msg?.text || '';
            const normalizedText = msgText.replace(/\n/g, ' ');
            const displayText = normalizedText.length > 40 
              ? normalizedText.substring(0, 40) + '...' 
              : normalizedText;

            return (
              <View key={msg?.firebaseKey || 'unknown'} style={styles.singlePinnedMessage}>
                <View>
                  <Text style={styles.pinnedTextheader}>Pin Message</Text>
                  <Text style={styles.pinnedText}>{displayText}</Text>
                </View>
                <TouchableOpacity onPress={() => setPinMessageOpen(true)} style={{ justifyContent: 'center' }}>
                  <Icon name="chevron-forward-outline" size={20} color={config.colors.primary} style={styles.pinIcon} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

      {/* Modal for showing all pinned messages */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={pinMessageOpen}
        onRequestClose={() => setPinMessageOpen(false)}
      >
        <View style={styles.modalContainer}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', minWidth: 320 }}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Pin Messages</Text>
              {uniquePinnedMessages.map((msg) => {
                // ✅ Safety check
                if (!msg || !msg.firebaseKey) return null;
                
                return (
                  <View key={msg.firebaseKey} style={styles.singlePinnedMessageModal}>
                    {renderMessageWithLinks(msg.text || '')}
                    {isAdmin && (
                      <TouchableOpacity 
                        onPress={() => {
                          if (onUnpinMessage && typeof onUnpinMessage === 'function') {
                            onUnpinMessage(msg.firebaseKey);
                          }
                        }} 
                        style={{ backgroundColor: config.colors.primary, marginVertical: 3 }}
                      >
                        <Text style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 5, color: 'white' }}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setPinMessageOpen(false)}
              >
                <Text style={styles.closeButtonText}>{t("chat.got_it")}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
      <ChatRulesModal
        visible={modalVisibleChatinfo}
        onClose={() => setModalVisibleChatinfo(false)}
        isDarkMode={isDarkMode}
      />
      <OnlineUsersList
        visible={onlineUsersVisible}
        onClose={() => setOnlineUsersVisible(false)}
        mode="view"
      />

      {/* Full-screen Pet Guessing Game Modal */}
     
    </View>
  );
};

export const getStyles = (isDarkMode) =>
  StyleSheet.create({
    stackContainer: {
      justifyContent: 'space-between',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingTop: Platform.OS === 'android' ? 60 : 60,


      // paddingVertical: 10,


      borderBottomWidth: 0.3,
      borderBottomColor: 'lightgrey',
    },
    stackHeader: {
      fontFamily: 'Lato-Bold',
      fontSize: 24,
      lineHeight: 24,
      color: isDarkMode ? 'white' : 'black',
    },
    pinnedContainer: {
      // paddingHorizontal: 10,
      // paddingVertical: 1,
      borderBottomWidth: 0.3,
      borderBottomColor: 'lightgrey',
    },
    singlePinnedMessage: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 5,
      borderBottomWidth: 0.2,
      paddingHorizontal: 10,

    },
    singlePinnedMessageModal: {
      justifyContent: 'space-between',
      lineHeight: 24,
      paddingVertical: 10,
      borderBottomWidth: 0.2,
    },
    pinnedTextheader: {
      fontSize: 12,
      paddingRight: 20,
      fontFamily: 'Lato-Regular',
      color: config.colors.primary,
    },
    pinnedText: {
      fontSize: 12,
      fontFamily: 'Lato-Regular',
      color: isDarkMode ? 'white' : 'black'
    },
    pinIcon: {
      marginLeft: 10,
      // alignItems:'center',
      // backgroundColor:'red'
    },
    modalContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      width: '100%',
    },
    modalContent: {
      width: '95%',
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      borderRadius: 10,
      padding: 20,
    },
    modalTitle: {
      fontSize: 20,
      fontFamily: 'Lato-Bold',
      marginBottom: 20,
      color: isDarkMode ? 'white' : 'black',
    },
    closeButton: {
      backgroundColor: config.colors.hasBlockGreen,
      padding: 10,
      borderRadius: 5,
      alignItems: 'center',
      marginTop: 20,
    },
    closeButtonText: {
      color: '#fff',
      fontSize: 16,
      fontFamily: 'Lato-Bold',
    },
    iconContainer: {
      position: 'relative',
      padding: 4,
    },
    icon2: {
      // Additional icon styling if needed
    },
    badge: {
      position: 'absolute',
      top: -4,
      right: -4,
      backgroundColor: 'red',
      borderRadius: 8,
      minWidth: 16,
      height: 16,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    badgeText: {
      color: '#fff',
      fontSize: 8,
      fontFamily: 'Lato-Bold',
    },
  });

export default AdminHeader;
