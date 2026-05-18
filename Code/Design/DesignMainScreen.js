import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  addDoc,
  writeBatch,
  deleteField,
} from '@react-native-firebase/firestore';
import { ref as dbRef, get } from '@react-native-firebase/database';

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
import { awardBadge, incrementAndCheckBadge, REACTION_BADGE_THRESHOLDS } from '../ChatScreen/GroupChat/badgeUtils';



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
  const [filterFollowing, setFilterFollowing] = useState(false);
  const [followingIds, setFollowingIds] = useState([]);
  const [followingPosts, setFollowingPosts] = useState([]);
  const [myPosts, setMyPosts] = useState([]);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [lastPostTime, setLastPostTime] = useState(null);
  const [isSubmittingPost, setIsSubmittingPost] = useState(false);
  const [activeSort, setActiveSort] = useState('latest');
  const [rankedPosts, setRankedPosts] = useState([]);
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

  // ── Fetch who I follow (same pattern as StatusFeed) ──
  useEffect(() => {
    if (!user?.id || !firestoreDB) return;
    (async () => {
      try {
        const q = query(
          collection(firestoreDB, 'following'),
          where('followerId', '==', user.id),
          limit(200),
        );
        const snap = await getDocs(q);
        const ids = snap.docs.map(d => d.data().followingId).filter(Boolean);
        setFollowingIds(ids);
      } catch (err) {
        console.warn('[Posts] Error fetching following list:', err?.message);
      }
    })();
  }, [user?.id, firestoreDB]);

  // ── Fetch posts from followed users (PAGINATED, 5 per page) ──
  const lastFollowingDocRef = useRef(null);
  const followingHasMoreRef = useRef(true);

  const fetchFollowingPosts = async (isLoadMore = false) => {
    if (!user?.id || followingIds.length === 0) {
      setFollowingPosts([]);
      setInitialLoading(false);
      return;
    }

    if (isLoadMore && !followingHasMoreRef.current) return;
    if (!isLoadMore) {
      setInitialLoading(true);
      lastFollowingDocRef.current = null;
      followingHasMoreRef.current = true;
    } else {
      setLoadingMore(true);
    }

    try {
      // Use first 30 IDs (Firestore 'in' limit)
      const chunk = followingIds.slice(0, 30);
      const PAGE = 5;

      let q;
      if (isLoadMore && lastFollowingDocRef.current) {
        q = query(
          collection(firestoreDB, 'designPosts'),
          where('userId', 'in', chunk),
          orderBy('createdAt', 'desc'),
          startAfter(lastFollowingDocRef.current),
          limit(PAGE),
        );
      } else {
        q = query(
          collection(firestoreDB, 'designPosts'),
          where('userId', 'in', chunk),
          orderBy('createdAt', 'desc'),
          limit(PAGE),
        );
      }

      const snap = await getDocs(q);
      const newPosts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      lastFollowingDocRef.current = snap.docs[snap.docs.length - 1] || null;
      followingHasMoreRef.current = snap.docs.length === PAGE;
      setHasMore(snap.docs.length === PAGE);

      if (isLoadMore) {
        setFollowingPosts(prev => [...prev, ...newPosts]);
      } else {
        setFollowingPosts(newPosts);
      }
    } catch (err) {
      console.error('[Posts] Error fetching following posts:', err);
    } finally {
      setInitialLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
    }
  };

  const deleteUsersLatestPosts = useCallback(async (userId, n = 15) => {
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
  }, [firestoreDB]);

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
  const handleDeletePost = useCallback(async (postId) => {
    try {
      await deleteDoc(doc(firestoreDB, 'designPosts', postId));
      setPosts(prev => prev.filter(p => p.id !== postId));
      showMessage({ message: t('feed.post_deleted'), type: 'success' });
    } catch (err) {
      showMessage({ message: t('feed.failed_delete_post'), type: 'danger' });
    }
  }, [firestoreDB, t]);




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
  // ── Fetch ranked posts (Hot / Trending) from RTDB ──
  const fetchRankedPosts = useCallback(async (sortKey) => {
    if (!appdatabase || !firestoreDB) return;
    setInitialLoading(true);
    try {
      // Read pre-computed ranking from RTDB
      const rankingRef = dbRef(appdatabase, `feedRanking/${sortKey}`);
      const snap = await get(rankingRef);

      if (!snap.exists()) {
        setRankedPosts([]);
        setInitialLoading(false);
        return;
      }

      const ranking = snap.val(); // Array of { postId, score, ... }
      if (!Array.isArray(ranking) || ranking.length === 0) {
        setRankedPosts([]);
        setInitialLoading(false);
        return;
      }

      // Batch fetch post documents by ID
      const postIds = ranking.map(r => r.postId).filter(Boolean);
      const postPromises = postIds.map(id =>
        getDoc(doc(firestoreDB, 'designPosts', id))
          .then(d => d.exists() ? { id: d.id, ...d.data() } : null)
          .catch(() => null)
      );

      const fetchedPosts = await Promise.all(postPromises);
      const validPosts = fetchedPosts.filter(Boolean);

      // Preserve the ranking order from RTDB
      const orderMap = new Map(postIds.map((id, idx) => [id, idx]));
      validPosts.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));

      setRankedPosts(validPosts);
      setHasMore(false); // No pagination for ranked lists
    } catch (err) {
      console.warn(`[Feed] Error fetching ${sortKey} posts:`, err?.message);
      setRankedPosts([]);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [appdatabase, firestoreDB]);

  // ── Handle sort mode changes ──
  const handleSortChange = useCallback((sortKey) => {
    setActiveSort(sortKey);
    if (sortKey === 'latest') {
      fetchInitialPosts();
    } else {
      fetchRankedPosts(sortKey);
    }
  }, [fetchInitialPosts, fetchRankedPosts]);

  useEffect(() => {
    fetchInitialPosts();
  }, []);

  // ✅ PERF FIX: Removed per-post onSnapshot listeners that leaked memory.
  // Reactions are now updated optimistically in handleReaction below.
  // Lightweight 30s periodic refresh to pick up other users' reactions.
  useEffect(() => {
    if (!firestoreDB || initialLoading) return;
    const interval = setInterval(async () => {
      try {
        const currentPosts = activeSort !== 'latest' ? rankedPosts : posts;
        if (currentPosts.length === 0) return;
        // Re-fetch the current batch of post IDs
        const ids = currentPosts.slice(0, 10).map(p => p.id).filter(Boolean);
        if (ids.length === 0) return;
        const snap = await getDocs(
          query(collection(firestoreDB, 'designPosts'), where('__name__', 'in', ids))
        );
        const freshMap = {};
        snap.docs.forEach(d => { freshMap[d.id] = d.data(); });
        // Merge only reactions/likes/commentCount into local state
        const merger = (p) => {
          const fresh = freshMap[p.id];
          if (!fresh) return p;
          if (
            p.reactions === fresh.reactions &&
            p.likes === fresh.likes &&
            p.commentCount === fresh.commentCount
          ) return p; // No change
          return { ...p, reactions: fresh.reactions || {}, likes: fresh.likes || {}, commentCount: fresh.commentCount || 0 };
        };
        if (activeSort !== 'latest') {
          setRankedPosts(prev => prev.map(merger));
        } else {
          setPosts(prev => prev.map(merger));
        }
      } catch (e) {
        // Silent fail — this is a background refresh
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [firestoreDB, initialLoading, activeSort, posts.length, rankedPosts.length]);



  const loadMorePosts = async () => {
    if (loadingMore) return;

    // Following filter has its own pagination
    if (filterFollowing) {
      fetchFollowingPosts(true);
      return;
    }

    if (!hasMore || !lastVisibleDoc || filterMyPosts || activeSort !== 'latest') return;

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

  const handleReaction = useCallback(async (post, emoji) => {
    // ✅ Ban check
    if (isMeBanned) {
      showMessage({
        message: t("chat.access_denied", { defaultValue: 'Access Denied' }),
        description: t("chat.banned_message_simple", { defaultValue: "You are banned." }),
        type: 'danger',
      });
      return;
    }

    const userId = user?.id;
    if (!userId) return;

    const postRef = doc(firestoreDB, 'designPosts', post.id);
    const currentReaction = post.reactions?.[userId];
    const hadOldLike = !!post.likes?.[userId];

    // ✅ PERF FIX: Optimistic local update — no need for per-post Firestore listeners
    const optimisticUpdate = (p) => {
      if (p.id !== post.id) return p;
      const updatedReactions = { ...(p.reactions || {}) };
      const updatedLikes = { ...(p.likes || {}) };
      if (currentReaction === emoji) {
        delete updatedReactions[userId];
      } else {
        updatedReactions[userId] = emoji;
        if (hadOldLike) delete updatedLikes[userId];
      }
      return { ...p, reactions: updatedReactions, likes: updatedLikes };
    };
    setPosts(prev => prev.map(optimisticUpdate));
    setRankedPosts(prev => prev.map(optimisticUpdate));

    // Fire-and-forget Firestore update
    try {
      if (currentReaction === emoji) {
        await updateDoc(postRef, {
          [`reactions.${userId}`]: deleteField(),
        });
      } else {
        const updates = {
          [`reactions.${userId}`]: emoji,
        };
        if (hadOldLike) {
          updates[`likes.${userId}`] = deleteField();
        }
        await updateDoc(postRef, updates);
        // 🏅 Track reaction count for post author & award loved badge
        if (post.userId && post.userId !== userId) {
          incrementAndCheckBadge(appdatabase, post.userId, 'reactionCount', REACTION_BADGE_THRESHOLDS);
        }
      }
    } catch (err) {
      // Revert optimistic update on failure
      console.warn('Reaction update failed:', err);
    }
  }, [firestoreDB, user?.id, isMeBanned, t]);

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

      // ✅ Get cosmetics for embedding
      const { getMyCosmetics } = require('../Helper/cosmeticsCache');
      const myCosmetics = getMyCosmetics();

      const post = {
        imageUrl: imageUrlArray.length > 0 ? imageUrlArray : [],
        desc: (desc && desc.trim()) || "",
        userId: user?.id || t('feed.guest_user'),
        displayName: user?.displayName || t('feed.guest_user'),
        createdAt: serverTimestamp(),
        likes: {},
        selectedTags: Array.isArray(selectedTags) && selectedTags.length > 0
          ? selectedTags
          : (selectedTags ? [selectedTags] : ['Discussion']),
        email: currentUserEmail || null,
        report: false,
        // ✅ Only include truthy profile fields (saves storage)
        ...(user?.avatar ? { avatar: user.avatar } : {}),
        ...(user?.flage ? { flage: user.flage } : {}),
        ...(user?.robloxUsername ? { robloxUsername: user.robloxUsername } : {}),
        ...(user?.robloxUsernameVerified ? { robloxUsernameVerified: true } : {}),
        ...(hasRecentWin ? { hasRecentGameWin: true } : {}),
        ...(user?.topBadge ? { topBadge: user.topBadge } : {}),
        ...(user?.isAdmin ? { isAdmin: true } : {}),
        ...(user?.isModerator ? { isModerator: true } : {}),
        ...(user?.isTrusted ? { isTrusted: true } : {}),
        ...(user?.isCMSR ? { isCMSR: true } : {}),
        ...(user?.isHelper ? { isHelper: true } : {}),
        ...(user?.isBabyMod ? { isBabyMod: true } : {}),
        ...(localState?.isPro ? { isPro: true } : {}),
        ...(myCosmetics?.profileFrame ? { profileFrame: myCosmetics.profileFrame } : {}),
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

      // 🏅 Award "First Post" badge (fire-and-forget)
      awardBadge(appdatabase, user.id, 'firstPost');

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

  const renderItem = useCallback(({ item, index }) => {
    if (initialLoading) {
      return <View style={[styles.skeletonPost, isDarkMode && { backgroundColor: '#444' }]} />;
    }

    return (
      <PostCard
        item={item}
        userId={user?.id}
        onReaction={handleReaction}
        localState={localState}
        appdatabase={appdatabase}
        onDelete={handleDeletePost}
        onDeleteAll={deleteUsersLatestPosts}
      />
    );
  }, [initialLoading, isDarkMode, user?.id, handleReaction, localState, appdatabase, handleDeletePost, deleteUsersLatestPosts]);

  // const dataToRender = initialLoading
  //   ? skeletonArray
  //   : filterMyPosts
  //     ? myPosts
  //     : posts;
  const baseList = initialLoading
    ? skeletonArray
    : filterFollowing
      ? followingPosts
      : filterMyPosts
        ? myPosts
        : (activeSort !== 'latest' ? rankedPosts : posts);

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

      {/* ── Filter Bar (outside FlatList to avoid touch conflicts) ── */}
      <PostsHeader
        selectedTag={selectedTag}
        filterMyPosts={filterMyPosts}
        setFilterMyPosts={setFilterMyPosts}
        filterFollowing={filterFollowing}
        setFilterFollowing={setFilterFollowing}
        setSelectedTag={setSelectedTag}
        fetchInitialPosts={fetchInitialPosts}
        fetchMyPosts={fetchMyPosts}
        fetchFollowingPosts={fetchFollowingPosts}
        fetchPostsByTag={fetchPostsByTag}
        activeSort={activeSort}
        onSortChange={handleSortChange}
      />

      <FlatList
        data={dataToRender}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={{ paddingBottom: 100 }}
        onEndReached={loadMorePosts}
        onEndReachedThreshold={0.5}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          if (activeSort !== 'latest') {
            fetchRankedPosts(activeSort);
          } else {
            fetchInitialPosts();
          }
          fetchActivePolls();
        }}
        ListFooterComponent={
          loadingMore && !initialLoading && !filterMyPosts ? (
            <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 16 }} />
          ) : null
        }
        ListEmptyComponent={
          !initialLoading && (
            <View style={styles.emptyState}>
              <FontAwesome name="newspaper" size={48} color={isDarkMode ? '#334155' : '#cbd5e1'} />
              <Text style={styles.emptyTitle}>
              {filterFollowing ? t('feed.no_following_posts', { defaultValue: 'No posts from people you follow yet' }) : filterMyPosts ? t('feed.no_my_posts') : t('feed.no_posts_found')}
              </Text>
              <Text style={styles.emptySubtitle}>Be the first to post!</Text>
            </View>
          )
        }
        ListHeaderComponent={
          <>
            {/* 📊 Active Polls */}
            {activePolls.length > 0 && (
              <View style={{ paddingHorizontal: 10, paddingTop: 8 }}>
                {activePolls.map((p) => (
                  <PollCard
                    key={p.id}
                    poll={p}
                    user={user}
                    firestoreDB={firestoreDB}
                    isDarkMode={isDarkMode}
                    onRequireSignIn={() => setSigninDrawerVisible(true)}
                  />
                ))}
              </View>
            )}
          </>
        }
      />

      {/* ── FAB ── */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => user?.id ? setModalVisible(true) : setSigninDrawerVisible(true)}
        activeOpacity={0.85}
      >
        <View style={styles.fabInner}>
          <FontAwesome name="plus" size={20} color={'#fff'} />
        </View>
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
  },
  darkContainer: {
    backgroundColor: '#0a0f1e',
  },
  fab: {
    position: 'absolute',
    bottom: 72,
    right: 16,
  },
  fabInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: config.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: config.colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  skeletonPost: {
    height: 180,
    marginHorizontal: 12,
    marginVertical: 6,
    backgroundColor: '#e0e0e0',
    borderRadius: 20,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#94a3b8',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748b',
  },
});

export default DesignFeedScreen;
