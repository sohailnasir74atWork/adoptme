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




const PAGE_SIZE = 15;

const PrivateChatScreen = ({route, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { selectedUser, selectedTheme, item } = route.params || {};

  const { user, theme, appdatabase, updateLocalStateAndDatabase, firestoreDB } = useGlobalState();
  const [trade, setTrade] = useState(null)
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const lastLoadedKeyRef = useRef(null);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
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



  const closeProfileDrawer = () => {
    setIsDrawerVisible(false);
  };


  // console.log(item)
  
  useEffect(()=>{setTrade(item)}, [])
  useEffect(() => {
    if (selectedUserId) {
      isUserOnline(selectedUserId).then(setIsOnline).catch(() => setIsOnline(false));
    }
  }, [selectedUserId]);

  useEffect(() => {
    if (messages.length === 0) return;
  
    const myMsgs = messages.filter(m => m.senderId === myUserId);
    const theirMsgs = messages.filter(m => m.senderId === selectedUserId);
  
    if (myMsgs.length > 1 && theirMsgs.length > 1) {
      setCanRate(true);
    }
  }, [messages]);
  
  useEffect(() => {
    if (!selectedUserId || !myUserId) return;
  
    const ratingRef = ref(appdatabase, `ratings/${selectedUserId}/${myUserId}`);
    ratingRef.once('value').then(snapshot => {
      if (snapshot.exists()) {
        setHasRated(true);
      }
    }).catch(error => {
      console.error("Error checking existing rating:", error);
    });
  }, [selectedUserId, myUserId]);
  
  
  const isBanned = useMemo(() => {
    // const bannedUserIds = bannedUsers?.map((user) => user.id) || [];
    return bannedUsers.includes(selectedUserId);
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

  const getUserPoints = async (userId) => {
    if (!userId) return 0;
    try {
      const snapshot = await get(ref(appdatabase, `/users/${userId}/rewardPoints`));
      return snapshot.exists() ? snapshot.val() : 0;
    } catch (error) {
      return error;
    }
  };

  const updateUserPoints = async (userId, pointsToAdd) => {
    if (!userId) return;
    try {
      const latestPoints = await getUserPoints(userId);
      // console.log(latestPoints)

      const newPoints = latestPoints + pointsToAdd;
      await update(ref(appdatabase, `/users/${userId}`), { rewardPoints: newPoints });
      updateLocalStateAndDatabase('rewardPoints', newPoints);
    } catch (error) {}
  };
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
  const handleRating = async () => {
    if (!rating) {
      showErrorMessage("Error", "Please select a rating first.");
      return;
    }
  
    try {
      // 🔹 Realtime Database part (same as before)
      setStartRating(true)
      const ratingRef = ref(appdatabase, `ratings/${selectedUserId}/${myUserId}`);
      const avgRef = ref(appdatabase, `averageRatings/${selectedUserId}`);
  
      const [oldRatingSnap, avgSnap] = await Promise.all([
        ratingRef.once('value'),
        avgRef.once('value'),
      ]);
  
      const oldRating = oldRatingSnap.val()?.rating;
      const avgData = avgSnap.val();
      const oldAverage = avgData?.value || 0;
      const oldCount = avgData?.count || 0;
  
      let newAverage = 0;
      let newCount = oldCount;
  
      if (oldRating !== undefined) {
        // 🔁 Updating existing rating
        newAverage = ((oldAverage * oldCount) - oldRating + rating) / oldCount;
      } else {
        // 🆕 New rating
        newCount = oldCount + 1;
        newAverage = ((oldAverage * oldCount) + rating) / newCount;
      }
  
      // ✅ Save rating in Realtime Database
      await ratingRef.set({
        rating,
        timestamp: Date.now(),
      });
  
      // ✅ Update average in Realtime Database
      await avgRef.set({
        value: parseFloat(newAverage.toFixed(2)),
        count: newCount,
        updatedAt: Date.now(),
      });
  
      // ✅ Optional review in Firestore (using app Firestore: firestoreDB)
// ✅ Optional review in Firestore (using app Firestore: firestoreDB)
const trimmedReview = (reviewText || "").trim();

let reviewWasSaved = false;
let reviewWasUpdated = false;

if (trimmedReview) {
  // one doc per (fromUser, toUser)
  const reviewDocId = `${selectedUserId}_${myUserId}`; // toUser_fromUser
  const reviewRef = doc(firestoreDB, "reviews", reviewDocId);

  const now = serverTimestamp();

  // 🔍 check if this user already reviewed this trader
  const existingSnap = await getDoc(reviewRef);
  const isUpdate = existingSnap.exists;

  await setDoc(
    reviewRef,
    {
      fromUserId: myUserId,
      toUserId: selectedUserId,
      rating,
      userName: user?.displayName || user?.displayname || null,
      review: trimmedReview, // guaranteed non-empty here
      createdAt: isUpdate ? existingSnap.data()?.createdAt ?? now : now,
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
      await updateUserPoints(user?.id, 100);
      setStartRating(false)
  
    } catch (error) {
      console.error("Rating error:", error);
      showErrorMessage("Error", "Error submitting rating. Try again!");
    }
  };
  
  




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
        setMessages([]);
        lastLoadedKeyRef.current = null;
      }
  
      try {
        let query = messagesRef.orderByKey();
  
        const lastKey = lastLoadedKeyRef.current;
        if (!reset && lastKey) {
          // get older messages including lastKey – we’ll filter overlap
          query = query.endAt(lastKey);
        }
  
        // ✅ apply limit ONLY ONCE, at the end
        query = query.limitToLast(PAGE_SIZE);

  
        const snapshot = await query.once('value');
        const data = snapshot.val() || {};
  
        let parsedMessages = Object.entries(data)
          .map(([key, value]) => ({ id: key, ...value }))
          .sort((a, b) => b.timestamp - a.timestamp); // oldest -> newest
  
        if (parsedMessages.length === 0) return;

        // console.log(parsedMessages.length)
  
        setMessages(prev => {
          const existingIds = new Set(prev.map(m => String(m.id)));
          const onlyNew = parsedMessages.filter(m => !existingIds.has(String(m.id)));
          return reset ? parsedMessages : [...onlyNew, ...prev];
        });
  
        lastLoadedKeyRef.current = parsedMessages[0].id; // oldest in this batch
      } catch (err) {
        console.warn('Error loading messages:', err);
      } finally {
        if (reset) setLoading(false);
      }
    },
    [messagesRef],
  );
  
  
  

  useEffect(() => {
    if (!messagesRef) return;
    loadMessages(true);
  }, [messagesRef, loadMessages]);
  
  const handleLoadMore = useCallback(() => {
    // explicitly say "this is NOT a reset"
    loadMessages(false);
  }, [loadMessages]);
  // console.log(selectedUser.sender)
  const groupItems = (items) => {
    const grouped = {};
    items.forEach((item) => {
      const key = `${item.name}-${item.type}`;
      if (grouped[key]) {
        grouped[key].count += 1;
      } else {
        grouped[key] = { 
          ...item,
          count: 1
        };
      }
    });
    return Object.values(grouped);
  };
  const formatName = (name) => {
    let formattedName = name.replace(/^\+/, '');
    formattedName = formattedName.replace(/\s+/g, '-');
    return formattedName;
  };

  useEffect(() => {
    const chatId = [myUserId, selectedUserId].sort().join('_');
    const tradeRef = ref(appdatabase, `private_messages/${chatId}/trade`);
  
    if (item) {
      // ✅ If trade comes from props, set it and update Firebase
      setTrade(item);
      tradeRef.set(item).catch((error) => console.error("Error updating trade in Firebase:", error));
    } else {
      // ✅ If no trade in props, check Firebase
      tradeRef.once('value')
        .then((snapshot) => {
          const tradeData = snapshot.val();
          if (tradeData) {
            setTrade(tradeData);
          }
        })
        .catch((error) => console.error("Error fetching trade from Firebase:", error));
    }
  }, []);
  
// console.log(trade)
  const groupedHasItems = groupItems(trade?.hasItems || []);
  const groupedWantsItems = groupItems(trade?.wantsItems || []);


  // Send message

  const sendMessage = async (text, image, fruits) => {
    const trimmedText = (text || '').trim(); // safe guard
    const hasImage = !!image;
    const hasFruits = Array.isArray(fruits) && fruits.length > 0;
  
    // Block only if there's no text, no image AND no fruits
    if (!trimmedText && !hasImage && !hasFruits) {
      showErrorMessage(t("home.alert.error"), t("chat.cannot_empty"));
      return;
    }
  
    setInput(''); // clear input, image & fruits already cleared in PrivateMessageInput
  
    const timestamp = Date.now();
    const chatId = [myUserId, selectedUserId].sort().join('_');
  
    // References
    const messageRef       = ref(appdatabase, `private_messages/${chatId}/messages/${timestamp}`);
    const senderChatRef    = ref(appdatabase, `chat_meta_data/${myUserId}/${selectedUserId}`);
    const receiverChatRef  = ref(appdatabase, `chat_meta_data/${selectedUserId}/${myUserId}`);
    const receiverStatusRef = ref(appdatabase, `users/${selectedUserId}/activeChat`);
  
    // Build message payload
    const messageData = {
      text: trimmedText,
      senderId: myUserId,
      timestamp,
    };
  
    if (hasImage) {
      messageData.imageUrl = image;      // 👈 used in PrivateMessageList
    }
  
    if (hasFruits) {
      messageData.fruits = fruits;       // 👈 your array of selected fruits
    }
  
    // What to show as last message in chat list
    const lastMessagePreview =
      trimmedText ||
      (hasImage ? '📷 Photo' : hasFruits ? `🐾 ${fruits.length} pet(s)` : '');
  
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
    } catch (error) {
      console.error("Error sending message:", error);
      Alert.alert("Error", "Could not send your message. Please try again.");
    }
  };
  
  

  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !selectedUserId) return;

      const chatMetaRef = ref(appdatabase, `chat_meta_data/${user.id}/${selectedUserId}`);

      // ✅ Reset unreadCount when entering chat
      chatMetaRef.update({ unreadCount: 0 });

      setActiveChat(user.id, chatKey);

      return () => {
        clearActiveChat(user.id);
      };
    }, [user?.id, selectedUserId, chatKey])
  );
  // console.log(selectedUser.senderId)

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
  }, [loadMessages]);

  useEffect(() => {
    setActiveChat(user.id, chatKey)
  }, [user.id, chatKey]);



useEffect(() => {
  if (!messagesRef) return;

  const handleChildAdded = snapshot => {
    const newMessage = { id: snapshot.key, ...snapshot.val() };

    setMessages(prev => {
      const exists = prev.some(m => String(m.id) === String(newMessage.id));
      if (exists) return prev; // don’t duplicate

      // keep ASC order: add to the end
      return [...prev, newMessage].sort((a, b) => a.timestamp - b.timestamp);
    });
  };

  messagesRef.on('child_added', handleChildAdded);

  return () => {
    messagesRef.off('child_added', handleChildAdded);
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
