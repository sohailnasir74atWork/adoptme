import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  Alert,
  Text,
  Image,
  TouchableOpacity,  TextInput,  

} from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { getStyles } from '../Style';
import PrivateMessageInput from './PrivateMessageInput';
import PrivateMessageList from './PrivateMessageList';
import { useGlobalState } from '../../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { clearActiveChat, isUserOnline, setActiveChat } from '../utils';
import { useLocalState } from '../../LocalGlobelStats';
import  { get, increment, ref, update } from '@react-native-firebase/database';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
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




const INITIAL_PAGE_SIZE = 10; // ✅ Initial load: 10 messages
const PAGE_SIZE = 10; // ✅ Pagination: load 10 messages per batch

const PrivateChatScreen = ({route, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { selectedUser, selectedTheme, item } = route.params || {};

  const { user, theme, appdatabase, updateLocalStateAndDatabase, firestoreDB } = useGlobalState();
  const [trade, setTrade] = useState(null)
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isPaginating, setIsPaginating] = useState(false);
  const lastLoadedKeyRef = useRef(null);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
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
const [startRating,setStartRating] = useState(false)
const [isOnline, setIsOnline] = useState(false);
const hasSentMessageRef = useRef(false); // ✅ Track if user sent a message (for exit ad)
const chatEnterTimeRef = useRef(null); // ✅ Track when user entered chat (for exit ad)

  const closeProfileDrawer = () => {
    setIsDrawerVisible(false);
  };


  // ✅ Fix useEffect dependency
  useEffect(() => {
    if (item) {
      setTrade(item);
    }
  }, [item]);
  useEffect(() => {
    if (selectedUserId) {
      isUserOnline(selectedUserId).then(setIsOnline).catch(() => setIsOnline(false));
    }
  }, [selectedUserId]);

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
        if (snapshot.exists && snapshot.data()?.rating) {
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
      showErrorMessage("Error", "Please select a rating first.");
      return;
    }

    // ✅ Safety checks
    if (!selectedUserId || !myUserId || !firestoreDB) {
      showErrorMessage("Error", "Missing required data. Please try again.");
      return;
    }
  
    try {
      setStartRating(true);
      
      // ✅ FIRESTORE ONLY: Read existing rating from reviews collection
      const reviewDocId = `${selectedUserId}_${myUserId}`; // toUser_fromUser
      const reviewRef = doc(firestoreDB, "reviews", reviewDocId);
      const existingReviewSnap = await getDoc(reviewRef);
      const oldRating = existingReviewSnap.exists ? existingReviewSnap.data()?.rating : undefined;
      
      // ✅ FIRESTORE ONLY: Read current summary from user_ratings_summary
      const summaryRef = doc(firestoreDB, 'user_ratings_summary', selectedUserId);
      const summarySnap = await getDoc(summaryRef);
      const summaryData = summarySnap.exists ? summarySnap.data() : null;
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
      const isUpdate = existingReviewSnap.exists;
      
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
  "Success",
  reviewWasSaved
    ? reviewWasUpdated
      ? "Your review was updated."
      : "Thanks for your review!"
    : "Thanks for your rating!"
);

      setShowRatingModal(false);
      setHasRated(true);
      setReviewText('');
      if (user?.id) {
        await updateUserPoints(user.id, 100);
      }
      setStartRating(false);
  
    } catch (error) {
      console.error("Rating error:", error);
      showErrorMessage("Error", "Error submitting rating. Try again!");
      setStartRating(false);
    }
  }, [rating, selectedUserId, myUserId, firestoreDB, reviewText, user?.id, user?.displayName, updateUserPoints]);
  
  




  const messagesRef = useMemo(
    () => (chatKey ? ref(appdatabase, `private_messages/${chatKey}/messages`) : null),
    [chatKey, appdatabase],
  );
  
    // console.log(selecte÷dUser)

  // Load messages with pagination
  const loadMessages = useCallback(
    async (reset = false) => {
      if (!messagesRef) return;
  
      if (reset) {
        setLoading(true);
        // ✅ Only clear messages if we're actually resetting (chat changed or manual refresh)
        setMessages([]);
        lastLoadedKeyRef.current = null;
      } else {
        setIsPaginating(true);
      }
  
      try {
        let query = messagesRef.orderByKey();
  
        const lastKey = lastLoadedKeyRef.current;
        if (!reset && lastKey) {
          // get older messages including lastKey – we'll filter overlap
          query = query.endAt(lastKey);
        }
  
        // ✅ Apply limit ONLY ONCE, at the end
        // Use INITIAL_PAGE_SIZE for first load, PAGE_SIZE for pagination
        const limitSize = reset ? INITIAL_PAGE_SIZE : PAGE_SIZE;
        query = query.limitToLast(limitSize);

  
        const snapshot = await query.once('value');
        const data = snapshot.val() || {};
  
        let parsedMessages = Object.entries(data)
          .map(([key, value]) => ({ id: key, ...value }))
          .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0)); // ✅ DESCENDING: newest -> oldest (for inverted FlatList to show newest at bottom)

        // ✅ If reset and no messages found, keep loading state but don't clear existing messages unnecessarily
        if (parsedMessages.length === 0) {
          if (reset) {
            // Only clear if we explicitly reset (manual refresh or chat change)
            // This prevents accidental clearing
          } else {
            // ✅ No more messages to load - set ref to null to prevent further pagination
            lastLoadedKeyRef.current = null;
          }
          return;
        }

        // console.log(parsedMessages.length)
  
        setMessages(prev => {
          if (!Array.isArray(prev)) return parsedMessages;
          const existingIds = new Set(prev.map(m => String(m?.id)));
          const onlyNew = parsedMessages.filter(m => !existingIds.has(String(m?.id)));
          
          if (reset) {
            // Initial load: use parsed messages as-is (already sorted descending)
            return parsedMessages;
          } else {
            // Load more (older messages): append and maintain descending order
            const combined = [...prev, ...onlyNew];
            return combined.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
          }
        });
  
        lastLoadedKeyRef.current = parsedMessages[parsedMessages.length - 1]?.id; // ✅ oldest in this batch (last item in descending array)
      } catch (err) {
        console.warn('Error loading messages:', err);
      } finally {
        if (reset) setLoading(false);
        setIsPaginating(false);
      }
    },
    [messagesRef],
  );
  
  
  

  // ✅ Only load messages when chatKey actually changes (not when loadMessages reference changes)
  useEffect(() => {
    if (!messagesRef) return;
    
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
  }, [chatKey, messagesRef, loadMessages]);
  
  const handleLoadMore = useCallback(() => {
    // ✅ Prevent loading if already paginating or no more messages
    if (isPaginating || !lastLoadedKeyRef.current) {
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
  
    if (item && typeof item === 'object') {
      // ✅ If trade comes from props, set it and update Firebase
      setTrade(item);
      tradeRef.set(item).catch((error) => {
        console.error("Error updating trade in Firebase:", error);
      });
    } else {
      // ✅ If no trade in props, check Firebase
      tradeRef.once('value')
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
  const sendMessage = useCallback(async (text, image, fruits) => {
    const trimmedText = (text || '').trim(); // safe guard
    // Handle both single image (string) and multiple images (array)
    const hasImage = !!image && (typeof image === 'string' || (Array.isArray(image) && image.length > 0));
    const hasFruits = Array.isArray(fruits) && fruits.length > 0;
  
    // ✅ Validate fruits count - maximum 18 fruits allowed
    if (hasFruits && fruits.length > 18) {
      showErrorMessage(t("home.alert.error"), "You can only send up to 18 pets in a message.");
      return;
    }
  
    // Block only if there's no text, no image AND no fruits
    if (!trimmedText && !hasImage && !hasFruits) {
      showErrorMessage(t("home.alert.error"), t("chat.cannot_empty"));
      return;
    }
  
    // ✅ Safety checks
    if (!myUserId || !selectedUserId || !appdatabase) {
      showErrorMessage(t("home.alert.error"), "Missing required data. Please try again.");
      return;
    }

    // ⚠️ NOTE: Block prevention check is missing here
    // Currently, blocked users can still send messages (they're just filtered on receiver's side)
    // See BLOCK_FUNCTIONALITY_ANALYSIS.md for details and recommended solution

    setInput(''); // clear input, image & fruits already cleared in PrivateMessageInput
  
    const timestamp = Date.now();
    const chatId = [myUserId, selectedUserId].sort().join('_');
  
    // References
    const messageRef = ref(appdatabase, `private_messages/${chatId}/messages/${timestamp}`);
    const senderChatRef = ref(appdatabase, `chat_meta_data/${myUserId}/${selectedUserId}`);
    const receiverChatRef = ref(appdatabase, `chat_meta_data/${selectedUserId}/${myUserId}`);
    const receiverStatusRef = ref(appdatabase, `users/${selectedUserId}/activeChat`);
  
    // Build message payload
    const messageData = {
      text: trimmedText,
      senderId: myUserId,
      timestamp,
      // flage: user.flage ? user.flage : null,
    };
  
    if (hasImage) {
      // Store as array if multiple images, single string if one image
      if (Array.isArray(image)) {
        messageData.imageUrls = image; // Array of image URLs
        messageData.imageUrl = image[0]; // Keep first for backward compatibility
      } else {
        messageData.imageUrl = image; // Single image URL
      }
    }
  
    if (hasFruits) {
      messageData.fruits = fruits;       // 👈 your array of selected fruits
    }
  
    // What to show as last message in chat list
    const imageCount = Array.isArray(image) ? image.length : (image ? 1 : 0);
    const lastMessagePreview =
      trimmedText ||
      (hasImage ? (imageCount > 1 ? `📷 ${imageCount} Photos` : '📷 Photo') : hasFruits ? `🐾 ${fruits.length} pet(s)` : '');
  
    try {
      // Save the message
      await messageRef.set(messageData);
  
      // Check if receiver is currently in the chat
      const snapshot = await receiverStatusRef.once('value');
      const isReceiverInChat = snapshot.val() === chatId;
  
      // Update sender's chat metadata
      await senderChatRef.update({
        chatId,
        receiverId: selectedUserId,
        receiverName: selectedUser?.sender || "Anonymous",
        receiverAvatar: selectedUser?.avatar || "https://example.com/default-avatar.jpg",
        lastMessage: lastMessagePreview,
        timestamp,
        unreadCount: 0,
      });
  
      // Update receiver's chat metadata
      await receiverChatRef.update({
        chatId,
        receiverId: myUserId,
        receiverName: user?.displayName || "Anonymous",
        receiverAvatar: user?.avatar || "https://example.com/default-avatar.jpg",
        lastMessage: lastMessagePreview,
        timestamp,
        unreadCount: isReceiverInChat ? 0 : increment(1),
      });
  
      setReplyTo(null);
      hasSentMessageRef.current = true; // ✅ Track that user sent a message (for exit ad)
    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert("Error", "Could not send your message. Please try again.");
    }
  }, [myUserId, selectedUserId, appdatabase, selectedUser, user, t]);
  
  

  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !selectedUserId) return;

      const chatMetaRef = ref(appdatabase, `chat_meta_data/${user.id}/${selectedUserId}`);

      // ✅ Reset unreadCount when entering chat
      chatMetaRef.update({ unreadCount: 0 });

      setActiveChat(user.id, chatKey);

      // ✅ Reset refs when entering chat (for exit ad logic)
      hasSentMessageRef.current = false;
      chatEnterTimeRef.current = Date.now();

      return () => {
        clearActiveChat(user.id);
        // ✅ Show ad when leaving if: 10+ seconds spent AND message sent AND not Pro
        const timeSpent = Date.now() - (chatEnterTimeRef.current || Date.now());
        if (timeSpent >= 20000 && hasSentMessageRef.current && !localState?.isPro) {
          InterstitialAdManager.showAd();
        }
      };
    }, [user?.id, selectedUserId, chatKey, localState?.isPro])
  );
  // console.log(selectedUser.senderId)

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
  }, [loadMessages]);

  useEffect(() => {
    if (user?.id && chatKey) {
      setActiveChat(user.id, chatKey);
    }
  }, [user?.id, chatKey]);



// ✅ OPTIMIZED: Only listen to the newest message to avoid duplicate reads
// This prevents child_added from firing for all existing messages when listener is attached
useEffect(() => {
  if (!messagesRef) return;

  // ✅ Use limitToLast(1) to only listen to the newest message
  // This ensures we only get NEW messages, not all existing ones
  const limitedRef = messagesRef.limitToLast(1);
  
  const handleChildAdded = snapshot => {
    if (!snapshot || !snapshot.key) return;
    const data = snapshot.val();
    if (!data || typeof data !== 'object') return;

    const newMessage = { id: snapshot.key, ...data };
    if (!newMessage.timestamp) {
      newMessage.timestamp = Date.now();
    }

    setMessages(prev => {
      if (!Array.isArray(prev)) return [newMessage];
      const exists = prev.some(m => String(m?.id) === String(newMessage.id));
      if (exists) return prev; // don't duplicate

      // ✅ Keep DESCENDING order: add to the beginning (newest first for inverted FlatList)
      return [newMessage, ...prev].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
    });
  };

  const listener = limitedRef.on('child_added', handleChildAdded);

  return () => {
    if (limitedRef) {
      limitedRef.off('child_added', listener);
    }
  };
}, [messagesRef]);





  return (
    <>

      <GestureHandlerRootView>


        <View style={[styles.container,]}>

          <ConditionalKeyboardWrapper style={{ flex: 1 }} privatechatscreen={true}>
            {/* <View style={{ flex: 1 }}> */}
              {trade && (
                <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 8, borderBottomColor:!isDarkMode ? 'lightgrey' : 'grey', borderBottomWidth:1 }}>
                  <View style={{ width: '48%', flexWrap: 'wrap', flexDirection: 'row', gap: 4 }}>
                    {groupedHasItems?.map((hasItem, index) => (
                      <View key={`${hasItem.name}-${hasItem.type}`} style={{ width: '19%', alignItems: 'center' }}>
                        <Image
                          source={{ uri: `${localState?.imgurl?.replace(/"/g, "").replace(/\/$/, "")}/${hasItem.image?.replace(/^\//, "")}` }}
                          style={{ width: 30, height: 30}}
                        />
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 2, marginTop: 2 }}>
                          {hasItem.isFly && (
                            <View style={{ backgroundColor: '#3498db', paddingHorizontal: 1, paddingVertical: 1, borderRadius: 8 }}>
                              <Text style={{ color: 'white', fontSize: 6, textAlign: 'center' }}>F</Text>
                            </View>
                          )}
                          {hasItem.isRide && (
                            <View style={{ backgroundColor: '#e74c3c', paddingHorizontal: 1, paddingVertical: 1, borderRadius: 8 }}>
                              <Text style={{ color: 'white', fontSize: 6, textAlign: 'center' }}>R</Text>
                            </View>
                          )}
                          {hasItem.valueType === 'm' && (
                            <View style={{ backgroundColor: '#9b59b6', paddingHorizontal: 1, paddingVertical: 1, borderRadius: 8 }}>
                              <Text style={{ color: 'white', fontSize: 6, textAlign: 'center' }}>M</Text>
                            </View>
                          )}
                          {hasItem.valueType === 'n' && (
                            <View style={{ backgroundColor: '#2ecc71', paddingHorizontal: 1, paddingVertical: 1, borderRadius: 8 }}>
                              <Text style={{ color: 'white', fontSize: 7, textAlign: 'center' }}>N</Text>
                            </View>
                          )}
                        </View>
                        {hasItem.count > 1 && (
                          <View style={{ position: 'absolute', top: 0, right: 0, backgroundColor: '#e74c3c', borderRadius: 8, paddingHorizontal: 1, paddingVertical: 1 }}>
                            <Text style={{ color: 'white', fontSize: 7}}>{hasItem.count}</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                  <View style={{ width: '2%', justifyContent: 'center', alignItems: 'center' }}>
                    <Image source={require('../../../assets/transfer.png')} style={{ width: 10, height: 10 }} />
                  </View>
                  <View style={{ width: '48%', flexWrap: 'wrap', flexDirection: 'row', gap: 4 }}>
                    {groupedWantsItems?.map((wantitem, index) => (
                      <View key={`${wantitem.name}-${wantitem.type}`} style={{ width: '19%', alignItems: 'center' }}>
                        <Image
                          source={{ uri: `${localState?.imgurl?.replace(/"/g, "").replace(/\/$/, "")}/${wantitem.image?.replace(/^\//, "")}` }}
                          style={{ width: 35, height: 35 }}
                        />
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 2, marginTop: 2 }}>
                          {wantitem.isFly && (
                            <View style={{ backgroundColor: '#3498db', paddingHorizontal: 1, paddingVertical: 1, borderRadius: 8 }}>
                              <Text style={{ color: 'white', fontSize: 7, textAlign: 'center' }}>F</Text>
                            </View>
                          )}
                          {wantitem.isRide && (
                            <View style={{ backgroundColor: '#e74c3c', paddingHorizontal: 1, paddingVertical: 1, borderRadius: 8 }}>
                              <Text style={{ color: 'white', fontSize: 6, textAlign: 'center' }}>R</Text>
                            </View>
                          )}
                          {wantitem.valueType === 'm' && (
                            <View style={{ backgroundColor: '#9b59b6', paddingHorizontal: 1, paddingVertical: 1, borderRadius: 8 }}>
                              <Text style={{ color: 'white', fontSize: 6, textAlign: 'center' }}>M</Text>
                            </View>
                          )}
                          {wantitem.valueType === 'n' && (
                            <View style={{ backgroundColor: '#2ecc71', paddingHorizontal: 1, paddingVertical: 1, borderRadius: 8 }}>
                              <Text style={{ color: 'white', fontSize: 6, textAlign: 'center' }}>N</Text>
                            </View>
                          )}
                        </View>
                        {wantitem.count > 1 && (
                          <View style={{ position: 'absolute', top: 0, right: 0, backgroundColor: '#e74c3c', borderRadius: 8, paddingHorizontal: 1, paddingVertical: 1 }}>
                            <Text style={{ color: 'white', fontSize: 6 }}>{wantitem.count}</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
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
    canRate={canRate}
    hasRated={hasRated}
    setShowRatingModal={setShowRatingModal}
    chatKey={chatKey}
  />
)}

      {!localState.isPro && <BannerAdComponent/>}

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
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 9999,
    }}
  >
    <View
      style={{
        backgroundColor: 'white',
        padding: 20,
        borderRadius: 10,
        width: '80%',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      {/* ❌ Close Button */}
      <TouchableOpacity
        onPress={() => setShowRatingModal(false)}
        style={{
          position: 'absolute',
          top: -5,
          right: 1,
          zIndex: 100,
          padding: 5,
        }}
      >
        <Text style={{ fontSize: 18, color: '#888' }}>✖</Text>
      </TouchableOpacity>

      {/* Title */}
      <Text style={{ fontSize: 16, marginBottom: 10, textAlign: 'center', fontWeight:'600' }}>
        Rate this Trader
      </Text>

      {/* Stars */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 15 }}>
        {[1, 2, 3, 4, 5].map((num) => (
          <TouchableOpacity key={num} onPress={() => setRating(num)}>
            <Text style={{ fontSize: 32, color: num <= rating ? '#FFD700' : '#ccc', marginHorizontal: 4 }}>
              ★
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {/* Review input (optional) */}
<TextInput
  style={{
    width: '100%',
    minHeight: 60,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    textAlignVertical: 'top',
    fontSize: 14,
  }}
  placeholder="Write an optional review..."
  placeholderTextColor="#999"
  multiline
  value={reviewText}
  onChangeText={setReviewText}
/>


      {/* Submit Button */}
      <TouchableOpacity
        style={{
          backgroundColor: config.colors.primary,
          paddingVertical: 10,
          paddingHorizontal: 20,
          borderRadius: 8,
          width: '100%',
        }}
        onPress={handleRating}
      >
        <Text style={{ color: 'white', fontSize: 14, textAlign: 'center' }}>
       { !startRating ?'Submit Rating' : 'Submitting'}
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
          startChat={()=>{}}
          selectedUser={selectedUser}
          isOnline={isOnline}
          bannedUsers={bannedUsers}
          fromPvtChat={true}
        />
    </>
  );
};

export default PrivateChatScreen;
