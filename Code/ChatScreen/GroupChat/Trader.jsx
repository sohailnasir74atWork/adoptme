import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Platform,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useGlobalState } from '../../GlobelStats';
import SignInDrawer from '../../Firebase/SigninDrawer';
import AdminHeader from './AdminHeader';
import MessagesList from './MessagesList';
import MessageInput from './MessageInput';
import { getStyles } from '../Style';
import { banUser, handleDeleteLast300Messages, isUserOnline, unbanUser } from '../utils';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import ProfileBottomDrawer from './BottomDrawer';
import leoProfanity from 'leo-profanity';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useLocalState } from '../../LocalGlobelStats';
import database, { onValue, ref, remove } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../../AppHelper/MixPenel';
import InterstitialAdManager from '../../Ads/IntAd';
import BannerAdComponent from '../../Ads/bannerAds';
import { logoutUser } from '../../Firebase/UserLogics';
import { showMessage } from 'react-native-flash-message';
import PetModal from '../PrivateChat/PetsModel';
leoProfanity.add(['hell', 'shit']);
leoProfanity.loadDictionary('en');




const ChatScreen = ({ selectedTheme, bannedUsers, modalVisibleChatinfo, setChatFocused,
  setModalVisibleChatinfo, unreadMessagesCount, fetchChats, unreadcount, setunreadcount }) => {
  const { user, theme, onlineMembersCount, appdatabase, setUser, isAdmin, currentUserEmail } = useGlobalState();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null); // Store the selected user's details
  const [isOnline, setIsOnline] = useState(false);
  const [isCooldown, setIsCooldown] = useState(false);
  const [signinMessage, setSigninMessage] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const { t } = useTranslation();
  const [pendingMessages, setPendingMessages] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isFocused = useIsFocused();
  const [strikeInfo, setStrikeInfo] = useState(null);
  const [petModalVisible, setPetModalVisible] = useState(false);
const [selectedFruits, setSelectedFruits] = useState([]); 
const [device, setDevice] = useState(null)

const [selectedEmoji, setSelectedEmoji] = useState(null);

  // ✅ Track last sent message to prevent duplicates (session-based, no Firebase cost)
  const lastSentMessageRef = useRef(null);

  const flatListRef = useRef();

  // console.log(selectedUser)

  useEffect(() => {
    if (isAtBottom && pendingMessages.length > 0) {
      // console.log("✅ User scrolled to bottom. Releasing held messages...");
      setMessages((prev) => [...pendingMessages, ...prev]);
      setPendingMessages([]); // Clear the queue
    }
  }, [isAtBottom, pendingMessages]);


  const PAGE_SIZE = 20;

  const navigation = useNavigation()
// ✅ Memoize openProfileDrawer
const openProfileDrawer = useCallback(async (userData) => {
  if (!userData || !userData.senderId) return;

  setSelectedUser(userData);
  setIsDrawerVisible(true);

  try {
    const online = await isUserOnline(userData.senderId);
    setIsOnline(online);
  } catch (error) {
    console.error('🔥 Error checking online status:', error);
    setIsOnline(false);
  }
}, []);

// ✅ Memoize closeProfileDrawer
const closeProfileDrawer = useCallback(() => {
  setIsDrawerVisible(false);
}, []);

// ✅ Memoize toggleDrawer
const toggleDrawer = useCallback(async (userData = null) => {
  setSelectedUser(userData);
  setIsDrawerVisible((prev) => !prev);

  if (userData?.senderId) {
    try {
      const online = await isUserOnline(userData.senderId);
      setIsOnline(online);
    } catch (error) {
      console.error("🔥 Error checking online status:", error);
      setIsOnline(false);
    }
  } else {
    setIsOnline(false);
  }
}, []);

// ✅ Memoize startPrivateChat
const startPrivateChat = useCallback(() => {
  const callbackfunction = () => {
    closeProfileDrawer();
    if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('PrivateChat', { selectedUser, selectedTheme });
    }
    mixpanel.track("Inbox Chat");
  };
  if (!localState?.isPro) {
    InterstitialAdManager.showAd(callbackfunction);
  } else {
    callbackfunction();
  }
}, [selectedUser, selectedTheme,  closeProfileDrawer]);

  const chatRef = useMemo(() => ref(appdatabase, 'chat_new'), []);
  const pinnedMessagesRef = useMemo(() => ref(appdatabase, 'pin_messages'), []);

  // const isAdmin = user?.admin || false;
  // const isOwner = user?.owner || false;
  const styles = useMemo(() => getStyles(theme === 'dark'), [theme]);




  const validateMessage = useCallback((message) => {
    const hasText = message?.text?.trim();
    return {
      ...message,
      sender: message.sender?.trim() || 'Anonymous',
      text: hasText || '',
      timestamp: hasText ? message.timestamp || Date.now() : Date.now() - 60 * 1000,
    };
  }, []);

  const loadMessages = useCallback(
    async (reset = false) => {
      try {
        if (reset) {
          // console.log('Resetting messages and loading the latest ones.');
          setLoading(true);
          setLastLoadedKey(null); // Reset pagination key
        }

        // console.log(`Fetching messages. Reset: ${reset}, LastLoadedKey: ${lastLoadedKey}`);

        const messageQuery = reset
          ? chatRef.orderByKey().limitToLast(PAGE_SIZE)
          : chatRef.orderByKey().endAt(lastLoadedKey).limitToLast(PAGE_SIZE);

        const snapshot = await messageQuery.once('value');
        const data = snapshot.val() || {};

        // if (developmentMode) {
        //   const dataSize = JSON.stringify(data).length / 1024;
        //   console.log(`🚀 Downloaded group chat data: ${dataSize.toFixed(2)} KB from load messages`);
        // }

        // console.log(`Fetched ${Object.keys(data).length} messages from Firebase.`);

        // const bannedUserIds = bannedUsers?.map((user) => user.id) || [];
        // console.log('Banned User IDs:', bannedUserIds);

        // ✅ Safety check for bannedUsers array
        const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
        const parsedMessages = Object.entries(data)
          .map(([key, value]) => {
            if (!key || !value || typeof value !== 'object') return null;
            return validateMessage({ id: key, ...value });
          })
          .filter(Boolean)
          .filter((msg) => msg?.senderId && !banned.includes(msg.senderId))
          .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
  
        // console.log('Parsed Messages:', parsedMessages);

        if (parsedMessages.length === 0 && !reset) {
          // console.log('No more messages to load.');
          setLastLoadedKey(null);
          return;
        }

        if (reset) {
          setMessages(parsedMessages);
          // console.log('Resetting messages:', parsedMessages);
        } else {
          setMessages((prev) => [...prev, ...parsedMessages]);
          // console.log('Appending messages:', parsedMessages);
        }

        if (parsedMessages.length > 0) {
          // Use the last key from the newly fetched messages
          setLastLoadedKey(parsedMessages[parsedMessages.length - 1].id);
          // console.log('Updated LastLoadedKey:', parsedMessages[parsedMessages.length - 1].id);
        }
      } catch (error) {
        // console.error('Error loading messages:', error);
      } finally {
        if (reset) setLoading(false);
      }
    },
    [chatRef, lastLoadedKey, validateMessage, bannedUsers, appdatabase]
  );
  useEffect(() => {
    if (!pinnedMessagesRef) return;

    const fetchPinnedMessages = async () => {
      try {
        const snapshot = await pinnedMessagesRef.once('value');
        const pinnedMessagesData = snapshot.val() || {};
  
        // ✅ Safety check and transform data into an array
        const pinnedMessagesArray = Object.entries(pinnedMessagesData)
          .map(([key, value]) => {
            if (!key || !value || typeof value !== 'object') return null;
            return {
              firebaseKey: key,
              ...value,
            };
          })
          .filter(Boolean);
  
        setPinnedMessages(pinnedMessagesArray);
      } catch (error) {
        console.error('Error loading pinned messages:', error);
      }
    };
  
    fetchPinnedMessages();  // Fetch pinned messages initially
  
    // Listen to real-time updates on pinned messages
    const listener = pinnedMessagesRef.on('child_added', (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const data = snapshot.val();
      if (!data || typeof data !== 'object') return;
      const newPinnedMessage = { firebaseKey: snapshot.key, ...data };
      setPinnedMessages((prev) => {
        // ✅ Prevent duplicates
        const exists = prev.some(msg => msg.firebaseKey === snapshot.key);
        return exists ? prev : [...prev, newPinnedMessage];
      });
    });
  
    return () => {
      if (pinnedMessagesRef) {
        pinnedMessagesRef.off('child_added', listener);
      }
    };
  }, []);
  
  useEffect(() => {
    const platform = Platform.OS; // "ios" or "android"
  
    // console.log('Initial loading of messages.');
    loadMessages(true); // Reset and load the latest messages
    if (setChatFocused && typeof setChatFocused === 'function') {
      setChatFocused(false);
    }
    setDevice(platform);
  }, [ setChatFocused]);

  // const bannedUserIds = bannedUsers.map((user) => user.id); // Extract IDs from bannedUsers

  useEffect(() => {
    if (!isFocused || !chatRef) return;

    const listener = chatRef.limitToLast(1).on('child_added', (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const data = snapshot.val();
      if (!data || typeof data !== 'object') return;

      const newMessage = validateMessage({ id: snapshot.key, ...data });
      if (!newMessage || !newMessage.id) return;

      // ✅ Check if message is from banned user
      const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
      if (banned.includes(newMessage.senderId)) return;

      setMessages((prev) => {
        if (!Array.isArray(prev)) return [newMessage];
        const seenKeys = new Set(prev.map((msg) => msg?.id).filter(Boolean));
        if (seenKeys.has(newMessage.id)) return prev;

        if (isAtBottom) {
          // Insert immediately
          // console.log("📥 User is at bottom, adding message now");
          return [newMessage, ...prev];
        } else {
          // Hold in pending
          // console.log("⏳ Holding new message, user not at bottom");
          setPendingMessages((prevPending) => {
            const pendingIds = new Set(prevPending.map((msg) => msg?.id).filter(Boolean));
            if (pendingIds.has(newMessage.id)) return prevPending;
            return [newMessage, ...prevPending];
          });
          return prev;
        }
      });
    });

    return () => {
      if (chatRef) {
        chatRef.off('child_added', listener);
      }
    };
  }, [chatRef, validateMessage, isAtBottom, isFocused, bannedUsers]);





  const handleLoadMore = useCallback(async () => {
    // ✅ Fixed: use && instead of &
    if (!user?.id && !signinMessage) {
      Alert.alert(
        t('misc.loginToStartChat'),
        t('misc.loginRequired'),
        [{ text: 'OK', onPress: () => setIsSigninDrawerVisible(true) }]
      );
      setSigninMessage(true);
      return;
    }

    if (!loading && lastLoadedKey) {
      await loadMessages(false);
    } else {
      // console.log('No more messages to load or currently loading.');
    }
  }, [user?.id, signinMessage, loading, lastLoadedKey, loadMessages, t]);




  const handlePinMessage = async (message) => {
    try {
      const pinnedMessage = { ...message, pinnedAt: Date.now() };
      const newRef = await pinnedMessagesRef.push(pinnedMessage);
  
      // Use the Firebase key for tracking the message
      setPinnedMessages((prev) => [
        ...prev,
        { firebaseKey: newRef.key, ...pinnedMessage },
      ]);
    } catch (error) {
      console.error('Error pinning message:', error);
      Alert.alert(t('home.alert.error'), 'Could not pin the message. Please try again.');
    }
  };
  


  const unpinSingleMessage = async (firebaseKey) => {
    try {
      const messageRef = pinnedMessagesRef.child(firebaseKey);
      await messageRef.remove();  // Remove from Firebase
  
      // Update local state by filtering out the removed message
      setPinnedMessages((prev) => {
        const updatedMessages = prev.filter((msg) => msg.firebaseKey !== firebaseKey);
        return updatedMessages;
      });
    } catch (error) {
      console.error('Error unpinning message:', error);
      Alert.alert(t('home.alert.error'), 'Could not unpin the message. Please try again.');
    }
  };
  




  const clearAllPinnedMessages = async () => {
    try {
      await pinnedMessagesRef.remove();
      setPinnedMessages([]);
    } catch (error) {
      console.error('Error clearing pinned messages:', error);
      Alert.alert(t('home.alert.error'), 'Could not clear pinned messages. Please try again.');
    }
  };

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };



  useEffect(() => {
    if (!currentUserEmail || !appdatabase) return;

    const encodedEmail = currentUserEmail.replace(/\./g, '(dot)');
    const banRef = ref(appdatabase, `banned_users_by_email/${encodedEmail}`);

    const unsubscribe = onValue(banRef, (snapshot) => {
      const banData = snapshot.val();
      setStrikeInfo(banData && typeof banData === 'object' ? banData : null);
    });

    return () => unsubscribe();
  }, [currentUserEmail, appdatabase]);


  const handleRefresh = async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
    // fetchChats()
  };

  // expects to be called like:
// await handleSendMessage(replyTo, trimmedInput, fruits);

const handleSendMessage = async (replyToArg, trimmedInputArg, fruits, emojiUrl) => {
  const hasEmoji  = !!emojiUrl;

  // console.log(emojiUrl)
  const hasFruits = Array.isArray(fruits) && fruits.length > 0;

  const MAX_CHARACTERS = 250;
  const MESSAGE_COOLDOWN = 100; // ms
  const LINK_REGEX = /(https?:\/\/[^\s]+)/i; // no "g" flag

  // Must be logged in
  if (!user?.id || !currentUserEmail) {
    showMessage({
      message: 'You are not loggedin',
      description: 'You must be logged in to send Messages',
      type: 'danger',
    });
    return;
  }

  // ---- Strike / ban checks ----
  if (strikeInfo) {
    const { strikeCount, bannedUntil } = strikeInfo;
    const now = Date.now();

    // Permanent ban
    if (bannedUntil === 'permanent') {
      showMessage({
        message: '⛔ Permanently Banned',
        description: 'You are permanently banned from sending messages.',
        type: 'danger',
      });
      return;
    }

    // Temporary ban (timestamp in ms)
    if (typeof bannedUntil === 'number' && now < bannedUntil) {
      const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      const timeLeftText =
        hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

      showMessage({
        message: `⚠️ Strike ${strikeCount}`,
        description: `You are banned from chatting for ${timeLeftText} more minute(s).`,
        type: 'warning',
        duration: 5000,
      });
      return;
    }
  }

  // Use the argument, not external state
  const trimmedInput = (trimmedInputArg || '').trim();

  // Disallow empty text + no fruits
  if (!trimmedInput && !hasFruits && !emojiUrl) {
    Alert.alert(t('home.alert.error'), 'Message cannot be empty.');
    return;
  }

  // Profanity check
  if (trimmedInput && leoProfanity.check(trimmedInput)) {
    Alert.alert(t('home.alert.error'), t('misc.inappropriateLanguage'));
    return;
  }

  // Length check
  if (trimmedInput.length > MAX_CHARACTERS) {
    Alert.alert(t('home.alert.error'), t('misc.messageTooLong'));
    return;
  }

  // Cooldown check
  if (isCooldown) {
    Alert.alert(t('home.alert.error'), t('misc.sendingTooQuickly'));
    return;
  }

  // ✅ Duplicate message check - prevent copy-paste spam (no Firebase cost, client-side only)
  const currentMessage = {
    text: trimmedInput,
    fruits: hasFruits ? JSON.stringify(fruits.sort((a, b) => (a?.id || '').localeCompare(b?.id || ''))) : null,
    emoji: emojiUrl || null,
  };
  
  if (lastSentMessageRef.current) {
    const lastMessage = lastSentMessageRef.current;
    const isDuplicate = 
      lastMessage.text === currentMessage.text &&
      lastMessage.fruits === currentMessage.fruits &&
      lastMessage.emoji === currentMessage.emoji;
    
    if (isDuplicate) {
      Alert.alert(
        t('home.alert.error'),
        'You cannot send the same message twice. Please modify your message.',
      );
      return;
    }
  }

  // Link check (only for non-pro & non-admin)
  const containsLink = trimmedInput ? LINK_REGEX.test(trimmedInput) : false;
  if (containsLink && !localState?.isPro && !isAdmin) {
    Alert.alert(t('home.alert.error'), t('misc.proUsersOnlyLinks'));
    return;
  }

  try {
    // ✅ Use chatRef instead of creating new ref
    if (!chatRef) {
      console.error('❌ Chat ref not available');
      return;
    }

    // Push to Firebase Realtime Database
    await chatRef.push({
      text: trimmedInput || null, // allow fruits-only messages
      timestamp: database.ServerValue.TIMESTAMP,
      sender: user.displayName || 'Anonymous',
      senderId: user.id,
      avatar:
        user.avatar ||
        'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
      replyTo: replyToArg
        ? { id: replyToArg.id, text: replyToArg.text }
        : null,
      reportCount: 0,
      containsLink,
      isPro: !!localState?.isPro,
      isAdmin: !!isAdmin,
      strikeCount: strikeInfo?.strikeCount ?? null,
      currentUserEmail,
      fruits: hasFruits ? fruits : [],
      gif: hasEmoji ? emojiUrl : null,
      flage: user.flage ? user.flage : null,
      OS: Platform.OS, // ✅ Store platform (Android/iOS) - only visible to admins
      robloxUsername: user?.robloxUsername || null,
      robloxUsernameVerified: user?.robloxUsernameVerified || false,
      robloxUserId: user?.robloxUserId || null, // ✅ Store userId for profile link
    });

    // ✅ Store last sent message to prevent duplicates (session-based, no Firebase cost)
    lastSentMessageRef.current = currentMessage;

    // Reset local input state
    setInput('');
    setReplyTo(null);

    // Start cooldown
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), MESSAGE_COOLDOWN);
  } catch (error) {
    console.error('Error sending message:', error);
    Alert.alert(
      t('home.alert.error'),
      'Could not send your message. Please try again.',
    );
  }
};


  // console.log(isPro)
  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          <AdminHeader
            pinnedMessages={pinnedMessages}
            onClearPin={clearAllPinnedMessages}
            onUnpinMessage={unpinSingleMessage}
            // isAdmin={isAdmin}
            selectedTheme={selectedTheme}
            onlineMembersCount={onlineMembersCount}
            // isOwner={isOwner}
            modalVisibleChatinfo={modalVisibleChatinfo}
            setModalVisibleChatinfo={setModalVisibleChatinfo}
            triggerHapticFeedback={triggerHapticFeedback}
            unreadMessagesCount={unreadMessagesCount}
            unreadcount={unreadcount}
            setunreadcount={setunreadcount}
            pinnedMessage={pinnedMessages}
            // unpinSingleMessage={unpinSingleMessage}
          />

          <ConditionalKeyboardWrapper style={{ flex: 1 }} chatscreen={true}>
            {loading ? (
              <ActivityIndicator size="large" color="#1E88E5" style={{ flex: 1 }} />
            ) : (
              <MessagesList
                messages={messages}
                user={user}
                flatListRef={flatListRef}
                isDarkMode={theme === 'dark'}
                onPinMessage={handlePinMessage}
                onDeleteMessage={(messageId) => chatRef.child(messageId.replace('chat_new-', '')).remove()}
                // isAdmin={isAdmin}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                onDeleteAllMessage={(senderId) => handleDeleteLast300Messages(senderId)}
                handleLoadMore={handleLoadMore}
                onReply={(message) => { setReplyTo(message); triggerHapticFeedback('impactLight'); }} // Pass selected message to MessageInput
                banUser={banUser}
                // makeadmin={makeAdmin}
                // onReport={onReport}
                // removeAdmin={removeAdmin}
                unbanUser={unbanUser}
                // isOwner={isOwner}
                isAtBottom={isAtBottom}
                setIsAtBottom={setIsAtBottom}
                // toggleDrawer={toggleDrawer}
                setMessages={setMessages}
                isAdmin={isAdmin}
                toggleDrawer={openProfileDrawer}
                
              />
            )}
            {!localState.isPro && <BannerAdComponent />}
            {user.id ? (
              <MessageInput
                input={input}
                setInput={setInput}
                handleSendMessage={handleSendMessage}
                selectedTheme={selectedTheme}
                replyTo={replyTo} // Pass reply context to MessageInput
                onCancelReply={() => setReplyTo(null)} // Clear reply context
                petModalVisible={petModalVisible}
                setPetModalVisible={setPetModalVisible}
                selectedFruits={selectedFruits}
                setSelectedFruits={setSelectedFruits}
                selectedEmoji={selectedEmoji}
                setSelectedEmoji={setSelectedEmoji}
              />
            ) : (
              <TouchableOpacity
                style={styles.login}
                onPress={() => {
                  setIsSigninDrawerVisible(true); triggerHapticFeedback('impactLight');
                }}
              >
                <Text style={styles.loginText}>{t('misc.loginToStartChat')}</Text>
              </TouchableOpacity>
              
            )}
             <PetModal
               fromChat={true}
      visible={petModalVisible}
      onClose={() => setPetModalVisible(false)}
        selectedFruits={selectedFruits}
        setSelectedFruits={setSelectedFruits}



      
    />
          </ConditionalKeyboardWrapper>

          <SignInDrawer
            visible={isSigninDrawerVisible}
            onClose={handleLoginSuccess}
            selectedTheme={selectedTheme}
            message={t('misc.loginRequired')}
            screen='Chat'

          />
        </View>
        <ProfileBottomDrawer
          isVisible={isDrawerVisible}
          toggleModal={closeProfileDrawer}  
          startChat={startPrivateChat}
          selectedUser={selectedUser}
          isOnline={isOnline}
          bannedUsers={bannedUsers}
        />
      </GestureHandlerRootView>
      

      {/* {!localState.isPro && <View style={{ alignSelf: 'center' }}>
        {isAdVisible && (
          <BannerAd
            unitId={bannerAdUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdLoaded={() => setIsAdVisible(true)}
            onAdFailedToLoad={() => setIsAdVisible(false)}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
          />
        )}
      </View>} */}
    </>
  );
};

export default ChatScreen;
