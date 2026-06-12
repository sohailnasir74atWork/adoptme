import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  Alert,
  Text,
  Image,
  TouchableOpacity, TextInput,
  Platform,
} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { getStyles } from '../Style';
import PrivateMessageInput from './PrivateMessageInput';
import PrivateMessageList from './PrivateMessageList';
import { useGlobalState } from '../../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { clearActiveChat, useOnlineStatus, setActiveChat, updateLastRead, flushLastRead, useOtherLastRead } from '../utils';
import { resetUnreadCount } from '../../Supabase/chatMetaBackend';
import {
  loadPrivateMessages,
  sendPrivateMessage,
  sendPrivateChatMeta,
  subscribeToPrivateMessages,
  softDeletePrivateMessage,
  newClientMsgId,
} from '../../Supabase/privateMessagesBackend';
import { useLocalState } from '../../LocalGlobelStats';
// RTDB imports still needed for trade/post/ban subtrees, /activeChats, and
// per-user side data — chat metadata + message bodies are now on Supabase.
import { get, ref, update, set, onValue } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import { showMessage } from 'react-native-flash-message';
import BannerAdComponent from '../../Ads/bannerAds';
import InterstitialAdManager from '../../Ads/IntAd';
import config from '../../Helper/Environment';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import PetModal from './PetsModel';
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from '@react-native-firebase/firestore';
import ProfileBottomDrawer from '../GroupChat/BottomDrawer';
import { updateStreak } from '../../Helper/StreakHelper';




const INITIAL_PAGE_SIZE = 10; // ✅ Initial load: 10 messages
const PAGE_SIZE = 10; // ✅ Pagination: load 10 messages per batch
// Cap the live in-memory list so a long session can't grow it unbounded
// (every insert re-sorts the whole array → JS-thread freeze over time).
// Scrolling past this re-fetches older pages from Supabase.
const MAX_LIVE = 150;

const PrivateChatScreen = ({ route, bannedUsers, isDrawerVisible, setIsDrawerVisible, noTabBar }) => {
  const { selectedUser, selectedTheme, item } = route.params || {};

  const { user, theme, appdatabase, updateLocalStateAndDatabase, firestoreDB, isRTDBConnected, isUserBlocked, deviceBanInfo } = useGlobalState();
  const [trade, setTrade] = useState(null)
  const [post, setPost] = useState(null)
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isPaginating, setIsPaginating] = useState(false);
  // Supabase pagination cursor: { createdAt: ISO, id: uuid } of the oldest
  // message in the current `messages` array. null = no older page known yet
  // OR end-of-history reached (handleLoadMore returns early when null).
  const oldestCursorRef = useRef(null);
  const previousChatKeyRef = useRef(null); // ✅ Track previous chatKey to prevent unnecessary resets
  const [replyTo, setReplyTo] = useState(null);
  const [input, setInput] = useState('');
  const { localState } = useLocalState()
  const selectedUserId = selectedUser?.senderId;
  const myUserId = user?.id;
  const { t } = useTranslation();
  const [canRate, setCanRate] = useState(false);
  const [hasRated, setHasRated] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [rating, setRating] = useState(0);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [selectedFruits, setSelectedFruits] = useState([]);
  const [reviewText, setReviewText] = useState('');   // 👈 new
  const [startRating, setStartRating] = useState(false)
  // ✅ FIXED: Real-time online status via listener instead of one-shot get()
  const isOnline = useOnlineStatus(selectedUserId);
  const [strikeInfo, setStrikeInfo] = useState(null); // ✅ Track strike/ban info
  const hasSentMessageRef = useRef(0); // ✅ Track number of messages sent (for exit ad)
  // ✅ Cost opt: write receiverName/receiverAvatar into chat_meta_data only once per session
  const metaIdentityWrittenRef = useRef(new Set());
  const chatEnterTimeRef = useRef(null); // ✅ Track when user entered chat (for exit ad)
  // Set true when a partner message lands while this chat is focused. The
  // sender's send_private_chat_meta bumps our unread_count server-side even
  // though we're reading the message live, so we reset once on blur — but
  // only if something actually arrived, to avoid a wasted write per visit.
  const unreadWhileFocusedRef = useRef(false);

  const closeProfileDrawer = () => {
    setIsDrawerVisible(false);
  };

  // ✅ Check if current user is banned — global gate covers email + device
  const isMeBanned = isUserBlocked;
  const myBanDetails = strikeInfo || deviceBanInfo;

  // ✅ Load strike/ban info from Firebase (temporal bans with timeouts)
  // Uses useFocusEffect to detach listener when navigating away
  useFocusEffect(
    useCallback(() => {
      if (!user?.email || !appdatabase) return;

      const encodeEmail = (email) => email.replace(/\./g, '(dot)');
      const banRef = ref(appdatabase, `banned_users_by_email/${encodeEmail(user.email)}`);

      const unsubscribe = onValue(banRef, (snapshot) => {
        const banData = snapshot.val();
        setStrikeInfo(banData && typeof banData === 'object' ? banData : null);
      });

      return () => unsubscribe();
    }, [user?.email, appdatabase])
  );


  // ✅ Detect if item is a trade or a post
  useEffect(() => {
    if (item) {
      if (item.hasItems || item.wantsItems) {
        setTrade(item);
        setPost(null);
      } else if (item.desc !== undefined || item.imageUrl) {
        setPost(item);
        setTrade(null);
      } else {
        setTrade(item);
        setPost(null);
      }
    }
  }, [item]);

  useEffect(() => {
    if (!Array.isArray(messages) || messages.length === 0) return;
    if (!myUserId || !selectedUserId) return;

    const myMsgs = messages.filter(m => m?.senderId === myUserId);
    const theirMsgs = messages.filter(m => m?.senderId === selectedUserId);

    if (myMsgs.length > 1 && theirMsgs.length > 1) {
      setCanRate(true);
    } else {
      setCanRate(false);
    }
  }, [messages, myUserId, selectedUserId]);

  // ✅ FIRESTORE ONLY: Check if user already rated
  useEffect(() => {
    if (!selectedUserId || !myUserId || !firestoreDB) return;

    const reviewDocId = `${selectedUserId}_${myUserId}`; // toUser_fromUser
    const reviewRef = doc(firestoreDB, "reviews", reviewDocId);

    getDoc(reviewRef)
      .then(snapshot => {
        if (snapshot.exists() && snapshot.data()?.rating) {
          setHasRated(true);
        } else {
          setHasRated(false);
        }
      })
      .catch(error => {
        console.error("Error checking existing rating:", error);
        setHasRated(false);
      });
  }, [selectedUserId, myUserId, firestoreDB]);


  // ✅ Safety check for bannedUsers array
  const isBanned = useMemo(() => {
    if (!selectedUserId) return false;
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    return banned.includes(selectedUserId);
  }, [bannedUsers, selectedUserId]);
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // Generate a unique chat key
  const chatKey = useMemo(
    () =>
      myUserId < selectedUserId
        ? `${myUserId}_${selectedUserId}`
        : `${selectedUserId}_${myUserId}`,
    [myUserId, selectedUserId]
  );

  // ✅ Track other user's last-read timestamp for blue tick read receipts
  const otherLastRead = useOtherLastRead(myUserId, selectedUserId);

  // ✅ Memoize getUserPoints
  const getUserPoints = useCallback(async (userId) => {
    if (!userId || !appdatabase) return 0;
    try {
      const snapshot = await get(ref(appdatabase, `/users/${userId}/rewardPoints`));
      return snapshot.exists() ? Number(snapshot.val()) || 0 : 0;
    } catch (error) {
      console.error('Error getting user points:', error);
      return 0;
    }
  }, [appdatabase]);

  // ✅ Memoize updateUserPoints
  const updateUserPoints = useCallback(async (userId, pointsToAdd) => {
    if (!userId || !appdatabase) return;
    if (typeof pointsToAdd !== 'number' || isNaN(pointsToAdd)) {
      console.error('Invalid pointsToAdd value');
      return;
    }
    try {
      const latestPoints = await getUserPoints(userId);
      const newPoints = Number(latestPoints) + Number(pointsToAdd);
      await update(ref(appdatabase, `/users/${userId}`), { rewardPoints: newPoints });
      if (updateLocalStateAndDatabase && typeof updateLocalStateAndDatabase === 'function') {
        updateLocalStateAndDatabase('rewardPoints', newPoints);
      }
    } catch (error) {
      console.error('Error updating user points:', error);
    }
  }, [getUserPoints, appdatabase, updateLocalStateAndDatabase]);
  // const navigation = useNavigation();
  useFocusEffect(
    useCallback(() => {
      // Screen is focused
      // console.log('Screen is focused');

      return () => {
        // Screen is unfocused
        if (user?.id) {
          clearActiveChat(user.id);
          // console.log('Triggered clearActiveChat for user:', user.id);
        }
      };
    }, [user?.id])
  );
  // ✅ Memoize handleRating - FIRESTORE ONLY (no RTDB)
  const handleRating = useCallback(async () => {
    if (!rating || rating < 1 || rating > 5) {
      showErrorMessage(t('chat.error'), t('chat.rating_select_first'));
      return;
    }

    // ✅ Safety checks
    if (!selectedUserId || !myUserId || !firestoreDB) {
      showErrorMessage(t('chat.error'), t('chat.rating_missing_data'));
      return;
    }

    try {
      setStartRating(true);

      // ✅ FIRESTORE ONLY: Read existing rating from reviews collection
      const reviewDocId = `${selectedUserId}_${myUserId}`; // toUser_fromUser
      const reviewRef = doc(firestoreDB, "reviews", reviewDocId);
      const existingReviewSnap = await getDoc(reviewRef);
      const oldRating = existingReviewSnap.exists() ? existingReviewSnap.data()?.rating : undefined;

      // ✅ FIRESTORE ONLY: Read current summary from user_ratings_summary
      const summaryRef = doc(firestoreDB, 'user_ratings_summary', selectedUserId);
      const summarySnap = await getDoc(summaryRef);
      const summaryData = summarySnap.exists() ? summarySnap.data() : null;
      const oldAverage = summaryData?.averageRating || 0;
      const oldCount = summaryData?.count || 0;

      let newAverage = 0;
      let newCount = oldCount;

      if (oldRating !== undefined && oldRating !== null) {
        // 🔁 Updating existing rating
        newAverage = ((oldAverage * oldCount) - oldRating + rating) / oldCount;
      } else {
        // 🆕 New rating
        newCount = oldCount + 1;
        newAverage = ((oldAverage * oldCount) + rating) / newCount;
      }

      // ✅ FIRESTORE ONLY: Update user_ratings_summary (single source of truth)
      await setDoc(
        summaryRef,
        {
          averageRating: parseFloat(newAverage.toFixed(2)),
          count: newCount,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // ✅ FIRESTORE ONLY: Save/update rating in reviews collection (even without text review)
      // This ensures we track who rated whom, even if they didn't write a review
      const now = serverTimestamp();
      const isUpdate = existingReviewSnap.exists();

      await setDoc(
        reviewRef,
        {
          fromUserId: myUserId,
          toUserId: selectedUserId,
          rating,
          userName: user?.displayName || user?.displayname || null,
          createdAt: isUpdate ? existingReviewSnap.data()?.createdAt ?? now : now,
          updatedAt: now,
          edited: isUpdate,
        },
        { merge: true }
      );

      // ✅ Optional review text in Firestore
      const trimmedReview = (reviewText || "").trim();
      let reviewWasSaved = false;
      let reviewWasUpdated = false;

      if (trimmedReview) {
        // Update review with text
        await setDoc(
          reviewRef,
          {
            review: trimmedReview,
            updatedAt: now,
            edited: isUpdate,
          },
          { merge: true }
        );

        reviewWasSaved = true;
        reviewWasUpdated = isUpdate;
      }

      // 🎉 feedback based on whether we actually saved a text review
      showSuccessMessage(
        t('chat.success'),
        reviewWasSaved
          ? reviewWasUpdated
            ? t('chat.rating_review_updated')
            : t('chat.rating_thanks_review')
          : t('chat.rating_thanks_rating')
      );

      setShowRatingModal(false);
      setHasRated(true);
      setReviewText('');
      if (user?.id) {
        await updateUserPoints(user.id, 100);
      }
      setStartRating(false);

      // ✅ Show interstitial ad after review/rating submission (non-Pro only)
      if (!localState?.isPro) {
        InterstitialAdManager.showAd();
      }

    } catch (error) {
      console.error("Rating error:", error);
      showErrorMessage(t('chat.error'), t('chat.rating_submit_error'));
      setStartRating(false);
    }
  }, [rating, selectedUserId, myUserId, firestoreDB, reviewText, user?.id, user?.displayName, updateUserPoints, localState?.isPro]);






  // Load messages with pagination. Supabase composite cursor on
  // (created_at desc, id desc); returns newest-first already, matching
  // the inverted-FlatList render order.
  const loadMessages = useCallback(
    async (reset = false) => {
      if (!chatKey) return;

      if (reset) {
        setLoading(true);
        setMessages([]);
        oldestCursorRef.current = null;
      } else {
        setIsPaginating(true);
      }

      try {
        const limitSize = reset ? INITIAL_PAGE_SIZE : PAGE_SIZE;
        const before = reset ? null : oldestCursorRef.current;

        const parsedMessages = await loadPrivateMessages(chatKey, { limit: limitSize, before });

        if (parsedMessages.length === 0) {
          if (!reset) {
            // No more older messages — disable further pagination.
            oldestCursorRef.current = null;
          }
          return;
        }

        setMessages(prev => {
          if (!Array.isArray(prev)) return parsedMessages;
          const existingIds = new Set(prev.map(m => String(m?.id)));
          const onlyNew = parsedMessages.filter(m => !existingIds.has(String(m?.id)));

          if (reset) {
            return parsedMessages;
          }
          // Append older page; resort to keep descending invariant.
          const combined = [...prev, ...onlyNew];
          return combined.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
        });

        // Cursor = oldest row in this page (last element after descending sort).
        const oldest = parsedMessages[parsedMessages.length - 1];
        if (oldest) {
          oldestCursorRef.current = {
            createdAt: new Date(oldest.timestamp).toISOString(),
            id: oldest.id,
          };
        }
      } catch (err) {
        console.warn('Error loading messages:', err);
      } finally {
        if (reset) setLoading(false);
        setIsPaginating(false);
      }
    },
    [chatKey],
  );




  // ✅ Only load messages when chatKey actually changes (not when loadMessages reference changes)
  useEffect(() => {
    if (!chatKey) return;

    // Only reset if chatKey actually changed
    const currentChatKey = chatKey;
    const previousChatKey = previousChatKeyRef.current;

    if (currentChatKey !== previousChatKey) {
      // Chat changed - reset and load messages
      previousChatKeyRef.current = currentChatKey;
      loadMessages(true);
    } else if (previousChatKey === null) {
      // Initial load
      previousChatKeyRef.current = currentChatKey;
      loadMessages(true);
    }
    // If chatKey hasn't changed, don't reload (preserves existing messages)
  }, [chatKey, loadMessages]);

  const handleDeleteMessage = useCallback(async (messageId) => {
    if (!messageId) return;
    try {
      await softDeletePrivateMessage(messageId, myUserId);
      setMessages(prev => prev.filter(m => m.id !== messageId));
    } catch (e) {
      Alert.alert('Error', 'Failed to delete message.');
    }
  }, [myUserId]);

  const handleLoadMore = useCallback(() => {
    // ✅ Prevent loading if already paginating or no more messages
    if (isPaginating || !oldestCursorRef.current) {
      return;
    }
    // explicitly say "this is NOT a reset"
    loadMessages(false);
  }, [loadMessages, isPaginating]);
  // ✅ Memoize groupItems
  const groupItems = useCallback((items) => {
    if (!Array.isArray(items)) return [];
    const grouped = {};
    items.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const key = `${item.name || ''}-${item.type || ''}`;
      if (grouped[key]) {
        grouped[key].count = (grouped[key].count || 0) + 1;
      } else {
        grouped[key] = {
          ...item,
          count: 1
        };
      }
    });
    return Object.values(grouped);
  }, []);

  // ✅ Memoize formatName
  const formatName = useCallback((name) => {
    if (!name || typeof name !== 'string') return '';
    let formattedName = name.replace(/^\+/, '');
    formattedName = formattedName.replace(/\s+/g, '-');
    return formattedName;
  }, []);

  useEffect(() => {
    if (!myUserId || !selectedUserId || !appdatabase) return;

    const chatId = [myUserId, selectedUserId].sort().join('_');
    const tradeRef = ref(appdatabase, `private_messages/${chatId}/trade`);
    const postRef = ref(appdatabase, `private_messages/${chatId}/post`);

    if (item && typeof item === 'object') {
      if (item.hasItems || item.wantsItems) {
        // ✅ Trade item — persist to trade ref
        setTrade(item);
        setPost(null);
        set(tradeRef, item).catch((error) => {
          console.error("Error updating trade in Firebase:", error);
        });
      } else if (item.desc !== undefined || item.imageUrl) {
        // ✅ Post item — persist to post ref
        setPost(item);
        setTrade(null);
        set(postRef, {
          desc: item.desc || '',
          imageUrl: Array.isArray(item.imageUrl) ? item.imageUrl.slice(0, 1) : [],
          displayName: item.displayName || '',
          selectedTags: item.selectedTags || [],
        }).catch((error) => {
          console.error("Error updating post in Firebase:", error);
        });
      } else {
        setTrade(item);
        setPost(null);
        set(tradeRef, item).catch((error) => {
          console.error("Error updating trade in Firebase:", error);
        });
      }
    } else {
      // ✅ No item in props — check Firebase for trade or post
      get(tradeRef)
        .then((snapshot) => {
          if (snapshot.exists()) {
            const tradeData = snapshot.val();
            if (tradeData && typeof tradeData === 'object') {
              setTrade(tradeData);
            }
          }
        })
        .catch((error) => {
          console.error("Error fetching trade from Firebase:", error);
        });
      get(postRef)
        .then((snapshot) => {
          if (snapshot.exists()) {
            const postData = snapshot.val();
            if (postData && typeof postData === 'object') {
              setPost(postData);
            }
          }
        })
        .catch((error) => {
          console.error("Error fetching post from Firebase:", error);
        });
    }
  }, [item, myUserId, selectedUserId, appdatabase]);

  // ✅ Memoize grouped items
  const groupedHasItems = useMemo(() => {
    if (!trade || !trade.hasItems || !Array.isArray(trade.hasItems)) return [];
    return groupItems(trade.hasItems);
  }, [trade?.hasItems, groupItems]);

  const groupedWantsItems = useMemo(() => {
    if (!trade || !trade.wantsItems || !Array.isArray(trade.wantsItems)) return [];
    return groupItems(trade.wantsItems);
  }, [trade?.wantsItems, groupItems]);


  // ✅ Memoize sendMessage
  const sendMessage = useCallback(async (text, image, fruits, replyToMsg) => {
    const trimmedText = (text || '').trim(); // safe guard
    // Handle both single image (string) and multiple images (array)
    const hasImage = !!image && (typeof image === 'string' || (Array.isArray(image) && image.length > 0));
    const hasFruits = Array.isArray(fruits) && fruits.length > 0;

    // ✅ Validate fruits count - maximum 18 fruits allowed
    if (hasFruits && fruits.length > 9) {
      showErrorMessage(t("home.alert.error"), t('chat.max_pets_allowed'));
      return;
    }

    // Block only if there's no text, no image AND no fruits
    if (!trimmedText && !hasImage && !hasFruits) {
      showErrorMessage(t("home.alert.error"), t("chat.cannot_empty"));
      return;
    }

    // ✅ Ban check
    if (isMeBanned) {
      const reason = myBanDetails?.reason || 'Access Denied';
      showErrorMessage(t("chat.access_denied", { defaultValue: 'Access Denied' }), t("chat.banned_message", { defaultValue: `You are banned: ${reason}` }));
      return;
    }

    // ✅ Strike/Temporal Ban Check
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
        const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        showMessage({
          message: `⚠️ Strike ${strikeCount}`,
          description: `You are banned from chatting for ${timeLeftText} more minute(s).`,
          type: 'warning',
          duration: 5000,
        });
        return;
      }
    }

    // ✅ Safety checks
    if (!myUserId || !selectedUserId || !appdatabase) {
      showErrorMessage(t("home.alert.error"), t('chat.rating_missing_data'));
      return;
    }

    // Connection check — catches WiFi networks that block Firebase WebSocket connections.
    // Without this, the message silently queues in the local RTDB buffer, appears sent
    // to the sender, but never reaches Firebase servers or the other user.
    if (!isRTDBConnected) {
      showErrorMessage('No Connection', 'Unable to reach chat server. Try switching to mobile data or a different network.');
      return;
    }

    // ⚠️ NOTE: Block prevention check is missing here
    // Currently, blocked users can still send messages (they're just filtered on receiver's side)
    // See BLOCK_FUNCTIONALITY_ANALYSIS.md for details and recommended solution

    setInput(''); // clear input, image & fruits already cleared in PrivateMessageInput

    const timestamp = Date.now();
    const chatId = [myUserId, selectedUserId].sort().join('_');

    // Normalize image input to single + array form. Supabase stores both;
    // the legacy single-image field stays for old-app fallback, the array
    // is the new canonical form for multi-image sends.
    let imageUrl = null;
    let imageUrls = null;
    if (hasImage) {
      if (Array.isArray(image)) {
        imageUrls = image;
        imageUrl = image[0] ?? null;
      } else {
        imageUrl = image;
      }
    }

    const replyToPayload = replyToMsg ? {
      id: replyToMsg.id,
      text: replyToMsg.text || '',
      senderId: replyToMsg.senderId,
      imageUrl: replyToMsg.imageUrl || null,
      imageUrls: replyToMsg.imageUrls || null,
      hasFruits: replyToMsg.fruits && replyToMsg.fruits.length > 0,
      fruitsCount: replyToMsg.fruits ? replyToMsg.fruits.length : 0,
    } : null;

    // What to show as last message in the inbox row.
    const imageCount = Array.isArray(image) ? image.length : (image ? 1 : 0);
    const lastMessagePreview =
      trimmedText ||
      (hasImage ? (imageCount > 1 ? t('chat.message_preview_photos', { count: imageCount }) : t('chat.message_preview_photo')) : hasFruits ? t('chat.message_preview_pets', { count: fruits.length }) : '');

    // Identity fields written only on first message per session — saves
    // ~200 bytes per subsequent send. RPC coalesces NULL → preserves
    // existing values, so passing null on subsequent sends is correct.
    const senderKey = `${myUserId}_${selectedUserId}`;
    const receiverKey = `${selectedUserId}_${myUserId}`;
    const writeSenderIdentity = !metaIdentityWrittenRef.current.has(senderKey);
    const writeReceiverIdentity = !metaIdentityWrittenRef.current.has(receiverKey);

    try {
      // Insert the message body. Realtime listener will feed it back into
      // the messages array; we don't optimistic-render (matches prior RTDB
      // behaviour — wait for server-side commit before reflecting).
      await sendPrivateMessage({
        chatId,
        senderId: myUserId,
        recipientId: selectedUserId,
        text: trimmedText || null,
        imageUrl,
        imageUrls,
        fruits: hasFruits ? fruits : [],
        replyTo: replyToPayload,
        OS: Platform.OS,
        clientMsgId: newClientMsgId(),
      });

      // Atomic two-sided chat_meta_data upsert. Replaces the prior
      // RTDB multi-path update. Sender stays at unread=0; receiver
      // unread bumps by 1. muted preserved on existing rows.
      // Fire-and-forget — meta lag is acceptable; mirror CF won't run for
      // new-app sends anyway since we no longer write RTDB chat_meta_data.
      sendPrivateChatMeta({
        partnerUid: selectedUserId,
        lastMessage: lastMessagePreview,
        timestampMs: timestamp,
        senderName: writeReceiverIdentity ? (user?.displayName || t('chat.anonymous')) : null,
        senderAvatar: writeReceiverIdentity
          ? (user?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png')
          : null,
        receiverName: writeSenderIdentity ? (selectedUser?.sender || t('chat.anonymous')) : null,
        receiverAvatar: writeSenderIdentity
          ? (selectedUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png')
          : null,
      }).catch((err) => console.warn('[PrivateChat] sendPrivateChatMeta failed:', err?.message));

      if (writeSenderIdentity) metaIdentityWrittenRef.current.add(senderKey);
      if (writeReceiverIdentity) metaIdentityWrittenRef.current.add(receiverKey);

      setReplyTo(null);
      hasSentMessageRef.current += 1; // ✅ Track message count (for exit ad)

      // 🔥 Update streak (fire-and-forget, non-blocking)
      updateStreak(firestoreDB, myUserId, selectedUserId).catch(() => { });
    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert(t('chat.error'), t('chat.send_error'));
    }
  }, [myUserId, selectedUserId, selectedUser, user, t, strikeInfo, isMeBanned, myBanDetails, isRTDBConnected, firestoreDB]);



  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !selectedUserId) return;

      // Set activeChats FIRST so the notifyNewMessage HTTPS CF sees the
      // user as active before we reset unread_count — prevents the race
      // where a message arrives in the gap and sends a spurious push to
      // someone already in the chat. Then clear the badge in Supabase.
      // (We no longer write RTDB chat_meta_data — clean-cut: new app is
      // Supabase-only for chat metadata.)
      setActiveChat(user.id, chatKey).then(() => {
        resetUnreadCount(user.id, selectedUserId); // fire-and-forget
      });

      // ✅ Mark messages as read — but only if the user has read receipts ON.
      // Otherwise the other side would see a blue tick on their messages
      // even though we're hiding it locally — that's the user-visible bug
      // ("I turned off read receipts but they still see I read it").
      if (localState?.showReadReceipts !== false) {
        updateLastRead(selectedUserId);
      }

      // ✅ Reset refs when entering chat (for exit ad logic)
      hasSentMessageRef.current = 0;
      chatEnterTimeRef.current = Date.now();
      unreadWhileFocusedRef.current = false;

      return () => {
        clearActiveChat(user.id);
        // Land any debounced read receipt now instead of waiting out the window.
        flushLastRead(selectedUserId);
        // Phantom-badge fix: messages received while we were viewing bumped
        // our unread_count server-side. Clear it once on blur, but only if a
        // partner message actually arrived — keeps this to ~1 extra write per
        // visit (and zero for quiet visits).
        if (unreadWhileFocusedRef.current) {
          unreadWhileFocusedRef.current = false;
          resetUnreadCount(user.id, selectedUserId); // fire-and-forget
        }
      };
    }, [user?.id, selectedUserId, chatKey, localState?.isPro, localState?.showReadReceipts])
  );
  // console.log(selectedUser.senderId)

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
  }, [loadMessages]);




  // ✅ Supabase realtime stream for INSERT / UPDATE / DELETE on this chat.
  // INSERTs feed new messages into state (own + partner's). UPDATEs cover
  // soft-deletes — we treat `deleted=true` as a removal. Hard DELETE is
  // rare (mod path) and removes by id. Uses useFocusEffect to detach the
  // channel when navigating away (prevents stale subscriptions piling up
  // on rapid nav).
  useFocusEffect(
    useCallback(() => {
      if (!chatKey) return undefined;

      const unsubscribe = subscribeToPrivateMessages(chatKey, {
        onInsert: (newMessage) => {
          if (!newMessage) return;

          // Update lastRead when a partner message arrives while we're viewing.
          // Gated on the read-receipts toggle so a recipient with read
          // receipts off doesn't accidentally signal a blue tick.
          if (newMessage.senderId && newMessage.senderId !== myUserId) {
            // Mark that our unread_count was bumped while focused so the
            // blur cleanup clears it (see useFocusEffect above).
            unreadWhileFocusedRef.current = true;
            if (localState?.showReadReceipts !== false) {
              updateLastRead(selectedUserId);
            }
          }

          setMessages(prev => {
            if (!Array.isArray(prev)) return [newMessage];
            // Idempotency: client_msg_id or id collision means we already have it.
            const exists = prev.some(m =>
              String(m?.id) === String(newMessage.id)
              || (newMessage.clientMsgId && String(m?.clientMsgId) === String(newMessage.clientMsgId)),
            );
            if (exists) return prev;
            // Keep DESCENDING (newest first for inverted FlatList).
            const sorted = [newMessage, ...prev].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
            // Cap the live list (newest-first, so trim the oldest tail).
            return sorted.length > MAX_LIVE ? sorted.slice(0, MAX_LIVE) : sorted;
          });
        },
        onUpdate: (updated) => {
          if (!updated) return;
          setMessages(prev => {
            if (!Array.isArray(prev)) return prev;
            if (updated.deleted) {
              // Soft-delete propagates to all clients as deleted=true.
              return prev.filter(m => String(m?.id) !== String(updated.id));
            }
            return prev.map(m => (String(m?.id) === String(updated.id) ? updated : m));
          });
        },
        onDelete: (id) => {
          if (!id) return;
          setMessages(prev =>
            Array.isArray(prev) ? prev.filter(m => String(m?.id) !== String(id)) : prev,
          );
        },
      });

      return () => unsubscribe();
    }, [chatKey, myUserId, localState?.showReadReceipts])
  );





  return (
    <>

      <GestureHandlerRootView>


        <View style={[styles.container, noTabBar && { paddingBottom: Platform.OS === 'ios' ? 34 : 48 }]}>

          <ConditionalKeyboardWrapper style={{ flex: 1 }} privatechatscreen={true}>
            {/* <View style={{ flex: 1 }}> */}
            {trade && (
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4, borderBottomColor: isDarkMode ? '#333' : '#e5e7eb', borderBottomWidth: 0.5 }}>
                <View style={{ flex: 1, flexWrap: 'wrap', flexDirection: 'row', gap: 3 }}>
                  {groupedHasItems?.map((hasItem) => (
                    <View key={`${hasItem.name}-${hasItem.type}`} style={{ width: 28, alignItems: 'center' }}>
                      <Image
                        source={{ uri: `${localState?.imgurl?.replace(/"/g, "").replace(/\/$/, "")}/${hasItem.image?.replace(/^\//, "")}` }}
                        style={{ width: 24, height: 24 }}
                      />
                      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 1, marginTop: 1 }}>
                        {hasItem.isFly && (
                          <View style={{ backgroundColor: '#3498db', paddingHorizontal: 1, borderRadius: 3 }}>
                            <Text style={{ color: 'white', fontSize: 5 }}>F</Text>
                          </View>
                        )}
                        {hasItem.isRide && (
                          <View style={{ backgroundColor: '#e74c3c', paddingHorizontal: 1, borderRadius: 3 }}>
                            <Text style={{ color: 'white', fontSize: 5 }}>R</Text>
                          </View>
                        )}
                        {hasItem.valueType === 'm' && (
                          <View style={{ backgroundColor: '#9b59b6', paddingHorizontal: 1, borderRadius: 3 }}>
                            <Text style={{ color: 'white', fontSize: 5 }}>M</Text>
                          </View>
                        )}
                        {hasItem.valueType === 'n' && (
                          <View style={{ backgroundColor: '#2ecc71', paddingHorizontal: 1, borderRadius: 3 }}>
                            <Text style={{ color: 'white', fontSize: 5 }}>N</Text>
                          </View>
                        )}
                      </View>
                      {hasItem.count > 1 && (
                        <View style={{ position: 'absolute', top: -2, right: -2, backgroundColor: '#e74c3c', borderRadius: 6, paddingHorizontal: 2 }}>
                          <Text style={{ color: 'white', fontSize: 6 }}>{hasItem.count}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
                <Image source={require('../../../assets/transfer.png')} style={{ width: 8, height: 8, marginHorizontal: 4 }} />
                <View style={{ flex: 1, flexWrap: 'wrap', flexDirection: 'row', gap: 3 }}>
                  {groupedWantsItems?.map((wantitem) => (
                    <View key={`${wantitem.name}-${wantitem.type}`} style={{ width: 28, alignItems: 'center' }}>
                      <Image
                        source={{ uri: `${localState?.imgurl?.replace(/"/g, "").replace(/\/$/, "")}/${wantitem.image?.replace(/^\//, "")}` }}
                        style={{ width: 24, height: 24 }}
                      />
                      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 1, marginTop: 1 }}>
                        {wantitem.isFly && (
                          <View style={{ backgroundColor: '#3498db', paddingHorizontal: 1, borderRadius: 3 }}>
                            <Text style={{ color: 'white', fontSize: 5 }}>F</Text>
                          </View>
                        )}
                        {wantitem.isRide && (
                          <View style={{ backgroundColor: '#e74c3c', paddingHorizontal: 1, borderRadius: 3 }}>
                            <Text style={{ color: 'white', fontSize: 5 }}>R</Text>
                          </View>
                        )}
                        {wantitem.valueType === 'm' && (
                          <View style={{ backgroundColor: '#9b59b6', paddingHorizontal: 1, borderRadius: 3 }}>
                            <Text style={{ color: 'white', fontSize: 5 }}>M</Text>
                          </View>
                        )}
                        {wantitem.valueType === 'n' && (
                          <View style={{ backgroundColor: '#2ecc71', paddingHorizontal: 1, borderRadius: 3 }}>
                            <Text style={{ color: 'white', fontSize: 5 }}>N</Text>
                          </View>
                        )}
                      </View>
                      {wantitem.count > 1 && (
                        <View style={{ position: 'absolute', top: -2, right: -2, backgroundColor: '#e74c3c', borderRadius: 6, paddingHorizontal: 2 }}>
                          <Text style={{ color: 'white', fontSize: 6 }}>{wantitem.count}</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ✅ Mini post reminder when coming from a post */}
            {!trade && post && (
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 6,
                paddingVertical: 4,
                borderBottomColor: isDarkMode ? '#333' : '#e5e7eb',
                borderBottomWidth: 0.5,
                backgroundColor: isDarkMode ? '#1a1a2e' : '#F0F4FF',
                gap: 6,
              }}>
                {Array.isArray(post.imageUrl) && post.imageUrl.length > 0 && (
                  <Image
                    source={{ uri: post.imageUrl[0] }}
                    style={{ width: 28, height: 28, borderRadius: 4 }}
                  />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 9, color: isDarkMode ? '#8B9DC3' : '#6B7280', fontWeight: '600' }}>
                    {t('feed.about_post') || 'About a post'}
                  </Text>
                  {post.desc ? (
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 11, color: isDarkMode ? '#ddd' : '#333' }}
                    >
                      {post.desc}
                    </Text>
                  ) : null}
                  {post.selectedTags?.length > 0 && (
                    <View style={{ flexDirection: 'row', gap: 3, marginTop: 1 }}>
                      {post.selectedTags.slice(0, 3).map((tag, idx) => (
                        <View key={idx} style={{ backgroundColor: isDarkMode ? '#333' : '#E5E7EB', paddingHorizontal: 3, borderRadius: 3 }}>
                          <Text style={{ fontSize: 8, color: isDarkMode ? '#aaa' : '#666' }}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}

            {messages.length === 0 ? (
              // No messages yet
              loading ? (
                // Still checking / loading
                <ActivityIndicator
                  size="large"
                  color="#1E88E5"
                  style={{ flex: 1, justifyContent: 'center' }}
                />
              ) : (
                // Finished loading, still empty
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>{t('chat.no_messages_yet')}</Text>
                </View>
              )
            ) : (
              // We have messages → always render the list, no matter what `loading` is
              <PrivateMessageList
                messages={messages}
                userId={myUserId}
                handleLoadMore={handleLoadMore}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                isBanned={isBanned}
                selectedUser={selectedUser}
                user={user}
                onReply={(message) => setReplyTo(message)}
                onDeleteMessage={handleDeleteMessage}
                canRate={canRate}
                hasRated={hasRated}
                setShowRatingModal={setShowRatingModal}
                chatKey={chatKey}
                otherLastRead={otherLastRead}
              />
            )}

            {!localState.isPro && <BannerAdComponent />}

            <PrivateMessageInput
              onSend={sendMessage}
              isBanned={isBanned}
              bannedUsers={bannedUsers}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              input={input}
              setInput={setInput}
              selectedTheme={selectedTheme}
              petModalVisible={petModalVisible}
              setPetModalVisible={setPetModalVisible}
              selectedFruits={selectedFruits}
              setSelectedFruits={setSelectedFruits}
            />
            <PetModal
              fromChat={true}
              visible={petModalVisible}
              onClose={() => setPetModalVisible(false)}
              selectedFruits={selectedFruits}
              setSelectedFruits={setSelectedFruits}




            />
            {/* </View>  */}
          </ConditionalKeyboardWrapper>
        </View>
      </GestureHandlerRootView>
      {showRatingModal && (
        <View
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
          }}
        >
          <View
            style={{
              backgroundColor: isDarkMode ? '#1E293B' : '#FFFFFF',
              padding: 20,
              borderRadius: 16,
              width: '82%',
              alignItems: 'center',
              position: 'relative',
              borderWidth: 1,
              borderColor: isDarkMode ? 'rgba(71,85,105,0.5)' : 'rgba(0,0,0,0.08)',
            }}
          >
            {/* ❌ Close Button */}
            <TouchableOpacity
              onPress={() => setShowRatingModal(false)}
              style={{
                position: 'absolute',
                top: 6,
                right: 8,
                zIndex: 100,
                padding: 5,
              }}
            >
              <Text style={{ fontSize: 16, color: isDarkMode ? '#94A3B8' : '#9CA3AF' }}>✕</Text>
            </TouchableOpacity>

            {/* Title */}
            <Text style={{
              fontSize: 15,
              marginBottom: 12,
              textAlign: 'center',
              fontWeight: '700',
              color: isDarkMode ? '#F1F5F9' : '#1F2937',
            }}>
              {t('chat.rating_title')}
            </Text>

            {/* Stars */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 14 }}>
              {[1, 2, 3, 4, 5].map((num) => (
                <TouchableOpacity key={num} onPress={() => setRating(num)}>
                  <Text style={{
                    fontSize: 30,
                    color: num <= rating
                      ? '#FBBF24'
                      : isDarkMode ? '#475569' : '#D1D5DB',
                    marginHorizontal: 3,
                  }}>
                    ★
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Review input */}
            <TextInput
              style={{
                width: '100%',
                minHeight: 60,
                borderWidth: 1,
                borderColor: isDarkMode ? '#334155' : '#E5E7EB',
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 8,
                marginBottom: 14,
                textAlignVertical: 'top',
                fontSize: 13,
                color: isDarkMode ? '#E2E8F0' : '#1F2937',
                backgroundColor: isDarkMode ? '#0F172A' : '#F9FAFB',
              }}
              placeholder={t('chat.rating_placeholder')}
              placeholderTextColor={isDarkMode ? '#64748B' : '#9CA3AF'}
              multiline
              value={reviewText}
              onChangeText={setReviewText}
            />

            {/* Submit Button */}
            <TouchableOpacity
              style={{
                backgroundColor: isDarkMode ? '#6366F1' : config.colors.primary,
                paddingVertical: 10,
                paddingHorizontal: 20,
                borderRadius: 10,
                width: '100%',
              }}
              onPress={handleRating}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '600', textAlign: 'center' }}>
                {!startRating ? t('chat.rating_submit') : t('chat.rating_submitting')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}


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
      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={closeProfileDrawer}
        startChat={() => { }}
        selectedUser={selectedUser}
        isOnline={isOnline}
        bannedUsers={bannedUsers}
        fromPvtChat={true}
      />
    </>
  );
};

export default PrivateChatScreen;
