import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Platform,
  ScrollView,
  StyleSheet as RNStyleSheet,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import SignInDrawer from '../../Firebase/SigninDrawer';
import ChatHeaderContent from './ChatHeaderContent';
import MessagesList from './MessagesList';
import MessageInput from './MessageInput';
import { getStyles } from '../Style';
import { banUser, handleDeleteLast300Messages, unbanUser } from '../utils';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import ProfileBottomDrawer from './BottomDrawer';
import leoProfanity from 'leo-profanity';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useLocalState } from '../../LocalGlobelStats';
import database, { onValue, ref, remove } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../../AppHelper/MixPenel';
import BannerAdComponent from '../../Ads/bannerAds';
import { showMessage } from 'react-native-flash-message';
import PetModal from '../PrivateChat/PetsModel';
import { MMKV } from 'react-native-mmkv';
const storage = new MMKV();
leoProfanity.add(['hell', 'shit']);
leoProfanity.loadDictionary('en');

const CHANNELS = [
  { id: 'en', label: 'English', flag: '🇺🇸', path: 'chat_new' },
  { id: 'es', label: 'Español', flag: '🇪🇸', path: 'chat_es' },
  { id: 'pt', label: 'Português', flag: '🇧🇷', path: 'chat_pt' },
  { id: 'fr', label: 'Français', flag: '🇫🇷', path: 'chat_fr' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪', path: 'chat_de' },
  { id: 'tr', label: 'Türkçe', flag: '🇹🇷', path: 'chat_tr' },
  { id: 'ar', label: 'العربية', flag: '🇸🇦', path: 'chat_ar' },
  { id: 'ja', label: '日本語', flag: '🇯🇵', path: 'chat_ja' },
  { id: 'ko', label: '한국어', flag: '🇰🇷', path: 'chat_ko' },
  { id: 'ru', label: 'Русский', flag: '🇷🇺', path: 'chat_ru' },
];

const ChatScreen = ({ selectedTheme, bannedUsers, modalVisibleChatinfo, setChatFocused,
  setModalVisibleChatinfo, unreadcount, setunreadcount, onlineUsersVisible, setOnlineUsersVisible }) => {
  const { user, theme, appdatabase, setUser, isAdmin, currentUserEmail } = useGlobalState();
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
  const [isCooldown, setIsCooldown] = useState(false);
  const [signinMessage, setSigninMessage] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const { t, i18n } = useTranslation();
  const [pendingMessages, setPendingMessages] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isFocused = useIsFocused();
  const [strikeInfo, setStrikeInfo] = useState(null);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [selectedFruits, setSelectedFruits] = useState([]);
  const [device, setDevice] = useState(null)

  const [selectedEmoji, setSelectedEmoji] = useState(null);
  // ✅ Remember user's preferred chat language (persisted in MMKV)
  const [activeChannel, setActiveChannel] = useState(() => {
    const savedId = storage.getString('preferred_chat_lang');
    if (savedId) {
      const found = CHANNELS.find(c => c.id === savedId);
      if (found) return found;
    }
    // Fallback: match app language, then English
    const lang = (i18n.language || 'en').split('-')[0];
    return CHANNELS.find(c => c.id === lang) || CHANNELS[0];
  });

  // ✅ Reorder channels: put user's preferred language first
  const orderedChannels = useMemo(() => {
    const idx = CHANNELS.findIndex(c => c.id === activeChannel.id);
    if (idx <= 0) return CHANNELS;
    return [CHANNELS[idx], ...CHANNELS.slice(0, idx), ...CHANNELS.slice(idx + 1)];
  }, [activeChannel.id]);

  // ✅ Track last sent message to prevent duplicates (session-based, no Firebase cost)
  const lastSentMessageRef = useRef(null);
  // ✅ OPTIMIZED: Track newest message to skip initial download in listener
  const newestMessageIdRef = useRef(null);
  const hasInitializedRef = useRef(false);
  const initialLoadDoneRef = useRef(false); // ✅ Track if initial load is complete (prevents duplicate messages)

  const flatListRef = useRef();

  // ✅ Ref to track isAtBottom without triggering re-renders in listener
  const isAtBottomRef = useRef(isAtBottom);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
    if (isAtBottom && pendingMessages.length > 0) {
      setMessages((prev) => [...pendingMessages, ...prev]);
      setPendingMessages([]);
    }
  }, [isAtBottom, pendingMessages]);


  const INITIAL_PAGE_SIZE = 5; // ✅ Initial load: 5 messages
  const PAGE_SIZE = 10; // ✅ Pagination: load 10 messages per batch

  const navigation = useNavigation()
  // ✅ Memoize openProfileDrawer
  const openProfileDrawer = useCallback(async (userData) => {
    if (!userData || !userData.senderId) return;

    setSelectedUser(userData);
    setIsDrawerVisible(true);
  }, []);

  // ✅ Memoize closeProfileDrawer
  const closeProfileDrawer = useCallback(() => {
    setIsDrawerVisible(false);
  }, []);

  // ✅ Memoize toggleDrawer
  const toggleDrawer = useCallback(async (userData = null) => {
    setSelectedUser(userData);
    setIsDrawerVisible((prev) => !prev);
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
    // ✅ Removed navigation ad - exit ads are shown when leaving chat instead
    callbackfunction();
  }, [selectedUser, selectedTheme, closeProfileDrawer]);

  const chatRef = useMemo(() => ref(appdatabase, activeChannel.path), [activeChannel.path]);
  const pinnedMessagesRef = useMemo(() => ref(appdatabase, 'pin_messages'), []);

  const styles = useMemo(() => getStyles(theme === 'dark'), [theme]);




  const validateMessage = useCallback((message) => {
    const text = (message?.text ?? "").toString();
    const trimmed = text.trim();

    const hasFruits = Array.isArray(message?.fruits) && message.fruits.length > 0;
    const hasGif = !!message?.gif;

    const hasContent = trimmed.length > 0 || hasFruits || hasGif;

    return {
      ...message,
      sender: (message?.sender ?? t("chat.anonymous")).toString().trim() || t("chat.anonymous"),
      text: trimmed, // keep trimmed text, but don't force empty for fruits-only
      // ✅ do NOT invent fake timestamps
      timestamp:
        typeof message?.timestamp === "number"
          ? message.timestamp
          : Date.now(), // fallback only if missing
      // Optional: if message is truly empty (shouldn't exist), mark it
      _invalid: !hasContent,
    };
  }, []);


  const loadMessages = useCallback(
    async (reset = false) => {
      try {
        if (reset) {

          setLoading(true);
          setLastLoadedKey(null); // Reset pagination key
        }



        // ✅ Use INITIAL_PAGE_SIZE for first load, PAGE_SIZE for pagination
        const limitSize = reset ? INITIAL_PAGE_SIZE : PAGE_SIZE;
        const messageQuery = reset
          ? chatRef.orderByKey().limitToLast(limitSize)
          : chatRef.orderByKey().endAt(lastLoadedKey).limitToLast(limitSize);

        const snapshot = await messageQuery.once('value');
        const data = snapshot.val() || {};





        // ✅ Safety check for bannedUsers array
        const bannedIds = Array.isArray(bannedUsers)
          ? bannedUsers.map(u => (typeof u === "string" ? u : u?.id)).filter(Boolean)
          : [];
        const parsedMessages = Object.entries(data)
          .map(([key, value]) => {
            if (!key || !value || typeof value !== 'object') return null;
            return validateMessage({ id: key, ...value });
          })
          .filter(Boolean)
          .filter(msg => msg?.senderId && !bannedIds.includes(msg.senderId)).sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));



        if (parsedMessages.length === 0 && !reset) {

          setLastLoadedKey(null);
          return;
        }

        if (reset) {
          setMessages(parsedMessages);
        } else {
          setMessages((prev) => [...prev, ...parsedMessages]);
        }

        if (parsedMessages.length > 0) {
          // Use the last key from the newly fetched messages
          setLastLoadedKey(parsedMessages[parsedMessages.length - 1].id);

        }
      } catch (error) {
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

  // ✅ Channel switch handler — resets state for new channel
  const handleChannelSwitch = useCallback((channel) => {
    if (channel.id === activeChannel.id) return;
    // ✅ Save preference to MMKV
    storage.set('preferred_chat_lang', channel.id);
    setActiveChannel(channel);
    setMessages([]);
    setPendingMessages([]);
    setLastLoadedKey(null);
    setReplyTo(null);
    setInput('');
    newestMessageIdRef.current = null;
    hasInitializedRef.current = false;
    initialLoadDoneRef.current = false;
    lastSentMessageRef.current = null;
  }, [activeChannel.id]);

  // ✅ Initial setup (runs once on mount)
  useEffect(() => {
    if (setChatFocused && typeof setChatFocused === 'function') {
      setChatFocused(false);
    }
    setDevice(Platform.OS);
  }, [setChatFocused]);

  // ✅ Load messages when channel changes (covers initial mount + every switch)
  useEffect(() => {
    if (!appdatabase || !activeChannel?.path) return;
    let cancelled = false;
    const currentRef = ref(appdatabase, activeChannel.path);

    const load = async () => {
      try {
        setLoading(true);
        setLastLoadedKey(null);

        const snapshot = await currentRef.orderByKey().limitToLast(INITIAL_PAGE_SIZE).once('value');
        if (cancelled) return;

        const data = snapshot.val() || {};
        const bannedIds = Array.isArray(bannedUsers)
          ? bannedUsers.map(u => (typeof u === 'string' ? u : u?.id)).filter(Boolean)
          : [];

        const parsed = Object.entries(data)
          .map(([key, value]) => {
            if (!key || !value || typeof value !== 'object') return null;
            return validateMessage({ id: key, ...value });
          })
          .filter(Boolean)
          .filter(msg => msg?.senderId && !bannedIds.includes(msg.senderId))
          .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));

        if (cancelled) return;

        setMessages(parsed);
        const newLastKey = parsed.length > 0 ? parsed[parsed.length - 1]?.id : null;
        setLastLoadedKey(newLastKey);
      } catch (error) {
        if (!cancelled) console.error('[channel load] Error:', error);
      } finally {
        if (!cancelled) {
          setLoading(false);
          initialLoadDoneRef.current = true; // ✅ Mark initial load as done
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [activeChannel.path, appdatabase, bannedUsers, validateMessage]);

  // ✅ Real-time listener — creates its own ref from activeChannel.path
  useEffect(() => {
    if (!isFocused || !appdatabase || !activeChannel?.path) return;

    let cancelled = false;
    const currentRef = ref(appdatabase, activeChannel.path);
    let listenerQueryRef = null;
    let listener = null;
    let initialLoadQuery = null;

    const initializeListener = async () => {
      try {
        // Step 1: Get only the latest message KEY (minimal download)
        initialLoadQuery = currentRef.orderByKey().limitToLast(1);
        const initialSnapshot = await initialLoadQuery.once('value');
        if (cancelled) return;

        if (initialSnapshot.exists()) {
          const data = initialSnapshot.val();
          const keys = Object.keys(data);
          if (keys.length > 0) {
            newestMessageIdRef.current = keys[0];
          }
        }

        hasInitializedRef.current = true;

        // Step 2: Listen for NEW messages only (skips initial data)
        listenerQueryRef = currentRef.orderByKey().limitToLast(1);

        listener = listenerQueryRef.on('child_added', (snapshot) => {
          if (cancelled || !snapshot || !snapshot.key) return;

          // ✅ Skip messages until initial load is complete to prevent duplicates
          if (!initialLoadDoneRef.current) return;

          // Skip if this is the message we already loaded during initialization
          if (hasInitializedRef.current && snapshot.key === newestMessageIdRef.current) {
            return;
          }

          newestMessageIdRef.current = snapshot.key;

          const data = snapshot.val();
          if (!data || typeof data !== 'object') return;

          const newMessage = validateMessage({ id: snapshot.key, ...data });
          if (!newMessage || !newMessage.id) return;

          const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
          if (banned.includes(newMessage.senderId)) return;

          setMessages((prev) => {
            if (!Array.isArray(prev)) return [newMessage];
            const seenKeys = new Set(prev.map((msg) => msg?.id).filter(Boolean));
            if (seenKeys.has(newMessage.id)) return prev;

            if (isAtBottomRef.current) {
              return [newMessage, ...prev];
            } else {
              setPendingMessages((prevPending) => {
                const pendingIds = new Set(prevPending.map((msg) => msg?.id).filter(Boolean));
                if (pendingIds.has(newMessage.id)) return prevPending;
                return [newMessage, ...prevPending];
              });
              return prev;
            }
          });
        });
      } catch (error) {
        if (cancelled) return;
        console.error('Error initializing chat listener:', error);
        // Fallback listener
        listenerQueryRef = currentRef.limitToLast(1);
        listener = listenerQueryRef.on('child_added', (snapshot) => {
          if (cancelled || !snapshot || !snapshot.key) return;
          const data = snapshot.val();
          if (!data || typeof data !== 'object') return;
          const newMessage = validateMessage({ id: snapshot.key, ...data });
          if (!newMessage || !newMessage.id) return;
          const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
          if (banned.includes(newMessage.senderId)) return;
          setMessages((prev) => {
            if (!Array.isArray(prev)) return [newMessage];
            const seenKeys = new Set(prev.map((msg) => msg?.id).filter(Boolean));
            if (seenKeys.has(newMessage.id)) return prev;
            if (isAtBottomRef.current) {
              return [newMessage, ...prev];
            } else {
              setPendingMessages((prevPending) => {
                const pendingIds = new Set(prevPending.map((msg) => msg?.id).filter(Boolean));
                if (pendingIds.has(newMessage.id)) return prevPending;
                return [newMessage, ...prevPending];
              });
              return prev;
            }
          });
        });
      }
    };

    initializeListener();

    return () => {
      cancelled = true;
      if (listener && listenerQueryRef) {
        listenerQueryRef.off('child_added', listener);
      }
      currentRef.off();
      if (initialLoadQuery) {
        initialLoadQuery.off('value');
      }
      hasInitializedRef.current = false;
    };
  }, [activeChannel.path, appdatabase, validateMessage, isFocused, bannedUsers]);





  const handleLoadMore = useCallback(async () => {
    // ✅ Fixed: use && instead of &
    if (!user?.id && !signinMessage) {
      Alert.alert(
        t('misc.loginToStartChat'),
        t('misc.loginRequired'),
        [{ text: t('chat.ok'), onPress: () => setIsSigninDrawerVisible(true) }]
      );
      setSigninMessage(true);
      return;
    }

    if (!loading && lastLoadedKey) {
      await loadMessages(false);
    } else {

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
      Alert.alert(t('home.alert.error'), t('chat.pin_error'));
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
      Alert.alert(t('home.alert.error'), t('chat.unpin_error'));
    }
  };





  const clearAllPinnedMessages = async () => {
    try {
      await pinnedMessagesRef.remove();
      setPinnedMessages([]);
    } catch (error) {
      console.error('Error clearing pinned messages:', error);
      Alert.alert(t('home.alert.error'), t('chat.clear_pins_error'));
    }
  };

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };



  useEffect(() => {
    if (!currentUserEmail || !appdatabase) return;

    const encodedEmail = currentUserEmail.toLowerCase().trim().replace(/\./g, '(dot)');
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
  };

  // Handle reaction to a message
  const handleReaction = useCallback(async (messageId, emoji) => {
    if (!chatRef || !messageId || !user?.id) return;

    try {
      const reactionRef = chatRef.child(`${messageId}/reactions/${user.id}`);
      const snapshot = await reactionRef.once('value');
      const currentReaction = snapshot.val();

      if (currentReaction === emoji) {
        // Same emoji → remove reaction
        await reactionRef.remove();
        setMessages(prev => prev.map(m => {
          if (String(m.id) !== String(messageId)) return m;
          const newReactions = { ...(m.reactions || {}) };
          delete newReactions[user.id];
          return { ...m, reactions: newReactions };
        }));
      } else {
        // New or different emoji → set reaction
        await reactionRef.set(emoji);
        setMessages(prev => prev.map(m => {
          if (String(m.id) !== String(messageId)) return m;
          return {
            ...m,
            reactions: { ...(m.reactions || {}), [user.id]: emoji },
          };
        }));
      }
    } catch (error) {
      console.error('Error toggling reaction:', error);
    }
  }, [chatRef, user?.id]);

  // expects to be called like:


  const handleSendMessage = async (replyToArg, trimmedInputArg, fruits, emojiUrl) => {
    const hasEmoji = !!emojiUrl;
    const hasFruits = Array.isArray(fruits) && fruits.length > 0;

    const MAX_CHARACTERS = 250;
    const MESSAGE_COOLDOWN = 100; // ms
    const LINK_REGEX = /(https?:\/\/[^\s]+)/i; // no "g" flag

    // Must be logged in
    if (!user?.id || !currentUserEmail) {
      showMessage({
        message: t('chat.not_logged_in'),
        description: t('chat.must_be_logged_in_to_send'),
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
          message: t('chat.permanently_banned_title'),
          description: t('chat.permanently_banned_message'),
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
          message: t('chat.strike_title', { count: strikeCount }),
          description: t('chat.strike_message', { time: timeLeftText }),
          type: 'warning',
          duration: 5000,
        });
        return;
      }
    }

    // Use the argument, not external state
    const trimmedInput = (trimmedInputArg || '').trim();

    // ✅ Validate fruits count - maximum 18 fruits allowed
    if (hasFruits && fruits.length > 9) {
      Alert.alert(t('home.alert.error'), t('chat.max_pets_error'));
      return;
    }

    // Disallow empty text + no fruits
    if (!trimmedInput && !hasFruits && !emojiUrl) {
      Alert.alert(t('home.alert.error'), t('chat.cannot_empty'));
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
          t('chat.cannot_send_duplicate'),
        );
        return;
      }
    }

    // Link check (only for non-pro & non-admin)
    const containsLink = trimmedInput ? LINK_REGEX.test(trimmedInput) : false;


    try {
      // ✅ Use chatRef instead of creating new ref
      if (!chatRef) {
        console.error('❌ Chat ref not available');
        return;
      }

      // Push to Firebase Realtime Database
      const now = Date.now();
      const hasRecentWin =
        typeof user?.lastGameWinAt === 'number' &&
        now - user.lastGameWinAt <= 24 * 60 * 60 * 1000; // last win within 24h

      await chatRef.push({
        text: trimmedInput || null, // allow fruits-only messages
        timestamp: database.ServerValue.TIMESTAMP,
        sender: user.displayName || t('chat.anonymous'),
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
        isModerator: !!user?.isModerator,
        strikeCount: strikeInfo?.strikeCount ?? null,
        fruits: hasFruits ? fruits : [],
        gif: hasEmoji ? emojiUrl : null,
        flage: user.flage ? user.flage : null,
        OS: Platform.OS, // ✅ Store platform (Android/iOS) - only visible to admins
        robloxUsername: user?.robloxUsername || null,
        robloxUsernameVerified: user?.robloxUsernameVerified || false,
        robloxUserId: user?.robloxUserId || null, // ✅ Store userId for profile link
        hasRecentGameWin: hasRecentWin,
        lastGameWinAt: user?.lastGameWinAt || null,
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
        t('chat.send_error'),
      );
    }
  };



  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          {/* ✅ Channel Pill Switcher */}
          <ScrollView
            horizontal
            maxHeight={Platform.OS === 'ios' ? 50 : 35}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={channelTabStyles.scrollContent}
          >
            {orderedChannels.map((channel) => {
              const isActive = channel.id === activeChannel.id;
              return (
                <TouchableOpacity
                  key={channel.id}
                  style={[
                    channelTabStyles.pill,
                    isActive
                      ? { backgroundColor: config.colors.primary, borderColor: config.colors.primary }
                      : { backgroundColor: 'transparent', borderColor: theme === 'dark' ? '#444' : '#ccc' },
                  ]}
                  onPress={() => handleChannelSwitch(channel)}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 14, marginRight: 5 }}>{channel.flag}</Text>
                  <Text
                    style={[
                      channelTabStyles.pillText,
                      { color: isActive ? '#fff' : (theme === 'dark' ? '#aaa' : '#666') },
                      isActive && channelTabStyles.pillTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {channel.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ChatHeaderContent
            pinnedMessages={pinnedMessages}
            onUnpinMessage={unpinSingleMessage}
            selectedTheme={selectedTheme}
            modalVisibleChatinfo={modalVisibleChatinfo}
            setModalVisibleChatinfo={setModalVisibleChatinfo}
            triggerHapticFeedback={triggerHapticFeedback}
            onlineUsersVisible={onlineUsersVisible}
            setOnlineUsersVisible={setOnlineUsersVisible}
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
                onDeleteMessage={(messageId) => chatRef.child(messageId.replace(`${activeChannel.path}-`, '')).remove()}
                // isAdmin={isAdmin}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                onDeleteAllMessage={(senderId) => handleDeleteLast300Messages(senderId, false, activeChannel.path)}
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
                onReaction={handleReaction}

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
                activeChannelId={activeChannel.id}
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
          isOnline={false}
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

const channelTabStyles = RNStyleSheet.create({
  scrollContent: {
    paddingHorizontal: 12,
    // paddingVertical: 3,
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 2,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '500',
  },
  pillTextActive: {
    fontWeight: '700',
  },
});

export default ChatScreen;
