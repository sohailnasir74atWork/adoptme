import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Text,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  onSnapshot,
  addDoc,
  writeBatch,
  deleteField,

} from '@react-native-firebase/firestore';

import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import PostCard from './componenets/PostCard';
import UploadModal from './componenets/UploadModal';
import SignInDrawer from '../Firebase/SigninDrawer';
import config from '../Helper/Environment';
import { Platform } from 'react-native';
import { showMessage } from 'react-native-flash-message';
// import { nativeAdPool } from '../Ads/NativeAdPool';
// import SingleNativeAd from '../Ads/SingleNative';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import PostsHeader from './componenets/PostsHeader';
import { useBanStatus } from '../ChatScreen/utils';
import PollCard from '../Trades/PollCard';


const DesignFeedScreen = ({ route }) => {
  const { selectedTheme } = route.params;
  const { appdatabase, user, theme, firestoreDB } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';
  const navigation = useNavigation();
  const { t } = useTranslation();

  // ✅ Check if current user is banned
  const { isBanned: isMeBanned } = useBanStatus(user?.email);

  const [modalVisible, setModalVisible] = useState(false);
  const [isSigninDrawerVisible, setSigninDrawerVisible] = useState(false);
  const [posts, setPosts] = useState([]);
  const [lastVisibleDoc, setLastVisibleDoc] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterMyPosts, setFilterMyPosts] = useState(false);
  const [myPosts, setMyPosts] = useState([]);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [lastPostTime, setLastPostTime] = useState(null);
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const AD_FREQUENCY = 5;

  // Polls
  const [activePolls, setActivePolls] = useState([]);

  const fetchActivePolls = useCallback(async () => {
    try {
      const pollsRef = collection(firestoreDB, 'polls');
      const q = query(pollsRef, where('active', '==', true), limit(3));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        setActivePolls(list);
      } else {
        setActivePolls([]);
      }
    } catch (err) {
      console.error('[Poll] Fetch polls error:', err);
    }
  }, [firestoreDB]);

  useEffect(() => {
    fetchActivePolls();
  }, [fetchActivePolls]);

  useEffect(() => {
    // if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [localState.bannedUsers]);

  function interleaveAds(items, showAds) {
    if (!showAds) return items;
    const out = [];
    let real = 0;
    for (let i = 0; i < items.length; i++) {
      out.push(items[i]);
      real++;
      if (real > 0 && real % AD_FREQUENCY === 0) {
        out.push({ __type: 'ad', id: `ad-${i}` });
      }
    }
    return out;
  }
  // console.log('mainscreen')
  const fetchMyPosts = async (tag = null) => {
    if (!user?.id) return;
    // console.log('📦 Fetching My Posts...');
    setInitialLoading(true);
    try {
      let q = query(
        collection(firestoreDB, 'designPosts'),
        where('userId', '==', user.id),
        orderBy('createdAt', 'desc')
      );


      if (tag) {
        q = query(
          collection(firestoreDB, 'designPosts'),
          where('userId', '==', user.id),
          where('selectedTags', 'array-contains', tag),
          orderBy('createdAt', 'desc')
        );

      }

      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // console.log('✅ My Posts fetched:', data.length);
      setMyPosts(data);
      setHasMore(snapshot.docs.length > 0);
    } catch (err) {
      console.error('❌ Error fetching my posts:', err);
      showMessage({ message: t('feed.failed_fetch_my_posts'), type: 'danger' });
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };

  const deleteUsersLatestPosts = async (userId, n = 15) => {
    if (!userId) throw new Error('userId is required');

    const q = query(
      collection(firestoreDB, 'designPosts'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(n)
    );

    const snap = await getDocs(q);
    if (snap.empty) return [];

    const batch = writeBatch(firestoreDB);
    const ids = [];

    snap.docs.forEach(d => {
      batch.delete(d.ref);
      ids.push(d.id);
    });

    await batch.commit();
    return ids;
  };

  // useEffect(() => {
  //   nativeAdPool.fillIfNeeded();
  //   return () => nativeAdPool.destroyAll();
  // }, []);


  const fetchPostsByTag = async (tag) => {
    try {
      setInitialLoading(true);

      const q = query(
        collection(firestoreDB, 'designPosts'),
        where('selectedTags', 'array-contains', tag),
        orderBy('createdAt', 'desc'),
        limit(5)
      );

      const snapshot = await getDocs(q);


      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(data);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 5);
    } catch (err) {
      console.error('Error fetching posts by tag:', err);
      showMessage({ message: t('feed.failed_fetch_posts'), type: 'danger' });
    } finally {
      setInitialLoading(false);
    }
  };


  const skeletonArray = useMemo(() => Array.from({ length: 5 }), []);
  const handleDeletePost = async (postId) => {
    try {
      await deleteDoc(doc(firestoreDB, 'designPosts', postId));
      setPosts(prev => prev.filter(p => p.id !== postId));
      showMessage({ message: t('feed.post_deleted'), type: 'success' });
    } catch (err) {
      showMessage({ message: t('feed.failed_delete_post'), type: 'danger' });
    }
  };




  const fetchInitialPosts = async () => {
    try {
      const q = query(
        collection(firestoreDB, 'designPosts'),
        orderBy('createdAt', 'desc'),
        limit(5)
      );

      const snapshot = await getDocs(q);


      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(data);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 5);
    } catch (err) {
      console.error('Initial load error:', err);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };
  // console.log(posts)
  useEffect(() => {
    fetchInitialPosts();
  }, []);

  // Update header when filter state changes
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <PostsHeader
          selectedTag={selectedTag}
          filterMyPosts={filterMyPosts}
          setFilterMyPosts={setFilterMyPosts}
          setSelectedTag={setSelectedTag}
          fetchInitialPosts={fetchInitialPosts}
          fetchMyPosts={fetchMyPosts}
          fetchPostsByTag={fetchPostsByTag}
        />
      ),
    });
  }, [navigation, selectedTag, filterMyPosts, fetchInitialPosts, fetchMyPosts, fetchPostsByTag]);
  useEffect(() => {
    if (posts.length === 0) return;

    const unsubscribers = posts.map(post =>
      onSnapshot(doc(firestoreDB, 'designPosts', post.id), snap => {
        if (!snap.exists) return;   // 👈 modular API uses exists()

        const updatedPost = { id: snap.id, ...snap.data() };
        setPosts(prev =>
          prev.map(p => (p.id === updatedPost.id ? updatedPost : p))
        );
      })
    );

    return () => {
      unsubscribers.forEach(unsub => {
        if (typeof unsub === 'function') {
          unsub();
        }
      });
    };
  }, [JSON.stringify(posts.map(p => p.id))]);



  const loadMorePosts = async () => {
    if (loadingMore || !hasMore || !lastVisibleDoc) return;

    setLoadingMore(true);
    try {
      let q;

      if (selectedTag) {
        // with tag filter
        q = query(
          collection(firestoreDB, 'designPosts'),
          where('selectedTags', 'array-contains', selectedTag),
          orderBy('createdAt', 'desc'),
          startAfter(lastVisibleDoc),
          limit(10)
        );
      } else {
        // without tag filter
        q = query(
          collection(firestoreDB, 'designPosts'),
          orderBy('createdAt', 'desc'),
          startAfter(lastVisibleDoc),
          limit(10)
        );
      }

      const snapshot = await getDocs(q);
      const newPosts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPosts(prev => [...prev, ...newPosts]);
      setLastVisibleDoc(snapshot.docs[snapshot.docs.length - 1]);
      setHasMore(snapshot.docs.length === 10);
    } catch (err) {
      console.error('Pagination load error:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleLike = async (post) => {
    // ✅ Ban check
    if (isMeBanned) {
      // Optional: Show alert or just return silently. 
      // User didn't explicitly ask for alert on like, but consistent with other actions.
      // But for likes, often silent failure or simple toast is better to avoid spamming alerts.
      // Given other implementations use Alert/showMessage, let's use showMessage for less intrusion than Alert.
      showMessage({
        message: t("chat.access_denied", { defaultValue: 'Access Denied' }),
        description: t("chat.banned_message_simple", { defaultValue: "You are banned." }),
        type: 'danger',
      });
      return;
    }

    const postRef = doc(firestoreDB, 'designPosts', post.id);
    const alreadyLiked = !!post.likes?.[user.id];

    await updateDoc(postRef, {
      [`likes.${user.id}`]: alreadyLiked ? deleteField() : true
    });
  };

  const handleUploadPost = async (desc, imageUrls, selectedTags, currentUserEmail) => {
    // ✅ Prevent multiple submissions - check if already submitting
    if (isSubmittingPost) {
      return;
    }

    if (!user?.id) return;

    // ✅ Set submitting state IMMEDIATELY to prevent duplicate submissions
    setIsSubmittingPost(true);

    try {
      // ✅ 2-minute cooldown check (using Date.now() for accurate comparison)
      const now = Date.now();
      const COOLDOWN_MS = 120000; // 2 minutes
      if (lastPostTime && (now - lastPostTime) < COOLDOWN_MS) {
        const secondsLeft = Math.ceil((COOLDOWN_MS - (now - lastPostTime)) / 1000);
        const minutesLeft = Math.floor(secondsLeft / 60);
        const remainingSeconds = secondsLeft % 60;
        const timeMessage = minutesLeft > 0
          ? `${minutesLeft} ${t('value.num_m')} and ${remainingSeconds} ${t('value.num_s', { defaultValue: 's' })}`
          : `${secondsLeft} ${t('value.num_s', { defaultValue: 's' })}`;
        showMessage({
          message: t('feed.cooldown_message', { time: timeMessage }),
          type: 'danger',
          duration: 3000
        });
        setIsSubmittingPost(false);
        throw new Error('Cooldown period not elapsed'); // ✅ Throw error to prevent clearing form
      }
      // ✅ Tags are mandatory
      if (!selectedTags || (Array.isArray(selectedTags) && selectedTags.length === 0)) {
        showMessage({
          message: t('feed.missing_tag'),
          description: t('feed.select_tag_instruction'),
          type: 'danger',
        });
        setIsSubmittingPost(false);
        throw new Error('Missing tags'); // ✅ Throw error to prevent clearing form
      }

      // Ensure imageUrls is an array (PostCard expects imageUrl as array)
      const imageUrlArray = Array.isArray(imageUrls)
        ? imageUrls.filter(url => url && typeof url === 'string' && url.trim().length > 0)
        : (imageUrls && typeof imageUrls === 'string' && imageUrls.trim().length > 0 ? [imageUrls] : []);

      // ✅ Calculate hasRecentGameWin (similar to Trader.jsx)
      const hasRecentWin =
        typeof user?.lastGameWinAt === 'number' &&
        now - user.lastGameWinAt <= 24 * 60 * 60 * 1000; // last win within 24h

      // ✅ Images are optional - posts can have text only, images only, or both
      // ✅ Tags are always required and must be saved to database
      const post = {
        imageUrl: imageUrlArray.length > 0 ? imageUrlArray : [], // PostCard expects imageUrl as array
        desc: (desc && desc.trim()) || "",
        userId: user?.id || t('feed.guest_user'),
        displayName: user?.displayName || t('feed.guest_user'),
        avatar: user?.avatar || null,
        createdAt: serverTimestamp(),
        likes: {},
        selectedTags: Array.isArray(selectedTags) && selectedTags.length > 0
          ? selectedTags
          : (selectedTags ? [selectedTags] : ['Discussion']), // ✅ Always ensure tags exist
        email: currentUserEmail || null,
        report: false,
        flage: user?.flage || null,
        robloxUsername: user?.robloxUsername || null,
        robloxUsernameVerified: user?.robloxUsernameVerified || false,
        hasRecentGameWin: hasRecentWin, // ✅ Game win info
        lastGameWinAt: user?.lastGameWinAt || null, // ✅ Game win timestamp
      };

      const postRef = await addDoc(collection(firestoreDB, 'designPosts'), post);

      // ✅ Track activity for followers' feed
      try {
        await addDoc(collection(firestoreDB, 'user_activity'), {
          userId: user.id,
          type: 'design_post',
          referenceId: postRef.id,
          displayName: user?.displayName || 'Unknown',
          avatar: user?.avatar || null,
          preview: (desc && desc.trim()) ? desc.substring(0, 100) : 'New design post',
          imagePreview: imageUrlArray.length > 0 ? imageUrlArray[0] : null,
          createdAt: serverTimestamp(),
        });
      } catch (activityError) {
        console.warn('Failed to track activity:', activityError);
        // Don't fail the post creation if activity tracking fails
      }

      // ✅ Update last post time after successful upload
      setLastPostTime(now);

      // ✅ Refresh feed after posting
      setRefreshing(true);
      await fetchInitialPosts();

      showMessage({
        message: t('chat.success'),
        description: t('feed.post_created_success'),
        type: 'success',
      });
    } catch (error) {
      console.error('Error uploading post:', error);
      // ✅ Only show error message if it's not a validation error (cooldown/tags)
      if (!error.message || (!error.message.includes('Cooldown') && !error.message.includes('tags'))) {
        showMessage({
          message: t('feed.upload_failed'),
          description: t('feed.failed_submit_report'),
          type: 'danger',
        });
      }
      // ✅ Re-throw error so UploadModal can handle it and prevent form clearing
      throw error;
    } finally {
      // ✅ Always reset submitting state, even if there was an error
      setIsSubmittingPost(false);
    }
  };

  const renderItem = ({ item, index }) => {
    if (initialLoading) {
      return <View style={[styles.skeletonPost, isDarkMode && { backgroundColor: '#444' }]} />;
    }
    // if (item?.__type === 'ad') {
    //    return <NativeFeedAd mediaHeight={220} />;
    //  }
    //  if (item?.__type === 'ad') {
    //    return <View style={{flex:1}}><SingleNativeAd  /></View>;
    //  }

    return (
      <PostCard
        item={item}
        userId={user?.id}
        onLike={handleLike}
        localState={localState}
        appdatabase={appdatabase}
        onDelete={handleDeletePost}
        onDeleteAll={deleteUsersLatestPosts}


      />
    );
  };

  // const dataToRender = initialLoading
  //   ? skeletonArray
  //   : filterMyPosts
  //     ? myPosts
  //     : posts;
  const baseList = initialLoading ? skeletonArray : (filterMyPosts ? myPosts : posts);

  // keep ads; drop banned users' posts
  const filteredBase = useMemo(() => {
    if (initialLoading) return skeletonArray;
    if (!Array.isArray(bannedUsers) || bannedUsers.length === 0) return baseList;
    return baseList.filter(item =>
      item?.__type === 'ad' || !bannedUsers.includes(item?.userId)
    );
  }, [initialLoading, baseList, bannedUsers, skeletonArray]);

  const dataToRender = initialLoading
    ? skeletonArray
    : interleaveAds(filteredBase, false);

  const keyExtractor = (item, index) =>
    // initialLoading ? `skeleton-${index}` : item?.id || `post-${index}`;
    initialLoading
      ? `skeleton-${index}`
      : item?.__type === 'ad'
        ? item.id
        : `${item?.id}_${index}}` || `post-${index}`;

  return (
    <View style={[styles.container, isDarkMode && styles.darkContainer]}>
      <FlatList
        data={dataToRender}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onEndReached={loadMorePosts}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          fetchInitialPosts();
          fetchActivePolls();
        }}
        ListFooterComponent={
          loadingMore && !initialLoading ? (
            <ActivityIndicator size="small" color={config.colors.primary} />
          ) : null
        }
        ListEmptyComponent={
          !initialLoading && (
            <Text style={{ textAlign: 'center', padding: 20, color: isDarkMode ? '#ccc' : '#666' }}>
              {filterMyPosts
                ? t('feed.no_my_posts')
                : t('feed.no_posts_found')}
            </Text>
          )
        }
        ListHeaderComponent={
          activePolls.length > 0 ? (
            <View style={{ paddingHorizontal: 10, paddingTop: 8 }}>
              {activePolls.map((p) => (
                <PollCard
                  key={p.id}
                  poll={p}
                  user={user}
                  firestoreDB={firestoreDB}
                  isDarkMode={isDarkMode}
                />
              ))}
            </View>
          ) : null
        }

      />

      {/* <TouchableOpacity
        style={styles.fab}
        onPress={() =>
          user?.id ? setModalVisible(true) : setSigninDrawerVisible(true)
        }
      >
        <Icon name="plus" size={24} color="white" />
      </TouchableOpacity> */}
      <TouchableOpacity style={styles.fab} onPress={() =>
        user?.id ? setModalVisible(true) : setSigninDrawerVisible(true)
      }>
        <FontAwesome name="circle-plus" size={44} color={config.colors.primary} />
      </TouchableOpacity>

      <UploadModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onUpload={handleUploadPost}
        user={user}
      />

      <SignInDrawer
        visible={isSigninDrawerVisible}
        onClose={() => setSigninDrawerVisible(false)}
        selectedTheme={selectedTheme}
        screen="Design"
        message={t('feed.signin_upload')}
      />
      {!localState.isPro && <BannerAdComponent />}

    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    // backgroundColor: '#fff',
  },
  darkContainer: {
    backgroundColor: '#121212',
  },
  fab: {
    position: 'absolute',
    bottom: 65,
    right: 10,
    // backgroundColor: config.colors.primary,
    width: 60,
    height: 60,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    // backgroundColor:'white'
    // elevation: 4,
  },
  skeletonPost: {
    height: 250,
    margin: 10,
    backgroundColor: '#e0e0e0',
    borderRadius: 10,
  },



});

export default DesignFeedScreen;
