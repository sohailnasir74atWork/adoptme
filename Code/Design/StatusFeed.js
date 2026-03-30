/**
 * StatusFeed.js
 * Instagram/WhatsApp Stories-style horizontal status bubbles.
 *
 * Features:
 * - Horizontal scrollable avatar bubbles with gradient ring for unviewed
 * - Create status: text + image (uploaded to Bunny CDN)
 * - View status: fullscreen stories-style viewer with auto-play
 * - Background themes for text statuses
 * - Polls with live voting
 * - Instant chat/DM button
 * - Delete own statuses
 * - 24h auto-expiry via Firestore expiresAt
 *
 * ── Cost Optimizations ──
 * - MMKV cache for statuses (5-min TTL) and following list (30-min TTL)
 * - Paginated following statuses (chunks of 30 IDs, load more on scroll)
 * - Random seed for global statuses (10 max, fair rotation)
 * - Local-first post/delete (no Firestore re-fetch)
 * - Skip duplicate markViewed writes
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, Image, Animated,
  StyleSheet, Dimensions, Modal, TextInput, Alert, ScrollView, ActivityIndicator,
  PanResponder, StatusBar, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  collection, query, where, orderBy, limit, getDocs, startAfter,
  addDoc, serverTimestamp, Timestamp, doc, updateDoc, arrayUnion, arrayRemove, deleteDoc,
} from '@react-native-firebase/firestore';
import { launchImageLibrary } from 'react-native-image-picker';
import { Image as CompressorImage } from 'react-native-compressor';
import RNFS from 'react-native-fs';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import { addXP, XP_ACTIONS } from '../Engagement/xpUtils';
import InterstitialAdManager from '../Ads/IntAd';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';
import { useLocalState } from '../LocalGlobelStats';
import { useGlobalState } from '../GlobelStats';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';


const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BUBBLE_SIZE = 64;
const STATUS_EXPIRY_MS = 24 * 60 * 60 * 1000;

// ── Cache config ──
let statusCache;
try {
  const { createMMKV } = require('react-native-mmkv');
  statusCache = createMMKV({ id: 'status-feed-cache' });
} catch (e) {
  console.warn('[StatusFeed] MMKV init failed, using fallback:', e?.message);
  // Fallback no-op cache so the rest of the code doesn't break
  statusCache = {
    getString: () => undefined,
    set: () => {},
    getNumber: () => undefined,
    delete: () => {},
  };
}
const STATUS_CACHE_TTL = 5 * 60 * 1000;       // 5 minutes
const FOLLOWING_CACHE_TTL = 30 * 60 * 1000;    // 30 minutes
const FOLLOWING_CHUNK_SIZE = 30;               // Firestore 'in' limit
const GLOBAL_STATUS_LIMIT = 10;                // Max global (non-following) statuses

// ── Cache helpers ──
const getCachedJSON = (key) => {
  try {
    const raw = statusCache.getString(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};
const setCachedJSON = (key, val) => {
  try { statusCache.set(key, JSON.stringify(val)); } catch {}
};
const isCacheValid = (key, ttl) => {
  const ts = statusCache.getNumber(`${key}_ts`);
  return ts && (Date.now() - ts) < ttl;
};
const setCacheTimestamp = (key) => {
  statusCache.set(`${key}_ts`, Date.now());
};

// ── Ring colors for status states ──
const RING_UNSEEN = ['#F59E0B', '#EC4899', '#8B5CF6'];
const RING_SEEN = '#94A3B8';

// ── Story auto-play duration (ms) ──
const STORY_DURATION = 5000;

// ── Background themes for text-only statuses ──
const STATUS_THEMES = [
  { id: 'none', label: 'None', colors: null, textColor: null },
  { id: 'sunset', label: '🌅', colors: ['#F97316', '#EC4899'], textColor: '#fff' },
  { id: 'ocean', label: '🌊', colors: ['#0EA5E9', '#6366F1'], textColor: '#fff' },
  { id: 'forest', label: '🌲', colors: ['#10B981', '#065F46'], textColor: '#fff' },
  { id: 'galaxy', label: '🌌', colors: ['#7C3AED', '#1E1B4B'], textColor: '#fff' },
  { id: 'candy', label: '🍬', colors: ['#F472B6', '#A78BFA'], textColor: '#fff' },
  { id: 'midnight', label: '🌙', colors: ['#1E293B', '#0F172A'], textColor: '#E2E8F0' },
  { id: 'fire', label: '🔥', colors: ['#EF4444', '#F59E0B'], textColor: '#fff' },
  { id: 'neon', label: '💜', colors: ['#A855F7', '#06B6D4'], textColor: '#fff' },
];

// ── Shimmer Placeholder for loading images ──
const ShimmerPlaceholder = ({ style }) => {
  const shimmerAnim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={[
        { backgroundColor: '#CBD5E1', justifyContent: 'center', alignItems: 'center' },
        style,
        { opacity: shimmerAnim },
      ]}
    >
      <ActivityIndicator size="small" color="#94A3B8" />
    </Animated.View>
  );
};

// ── Image with loading shimmer ──
const LoadingImage = ({ source, style, resizeMode = 'cover', borderRadius }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <View style={[style, { overflow: 'hidden', borderRadius: borderRadius || style?.borderRadius || 0 }]}>
      {!loaded && (
        <ShimmerPlaceholder
          style={[StyleSheet.absoluteFill, { borderRadius: borderRadius || style?.borderRadius || 0 }]}
        />
      )}
      <Image
        source={source}
        style={[style, { position: loaded ? 'relative' : 'absolute', opacity: loaded ? 1 : 0 }]}
        resizeMode={resizeMode}
        onLoad={() => setLoaded(true)}
      />
    </View>
  );
};

// Bunny CDN config (same as rest of app)
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

// Base64 decoder (no atob in RN)
const base64ToBytes = (base64) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/[\r\n]+/g, '');
  let output = [];
  let i = 0;
  while (i < str.length) {
    const enc1 = chars.indexOf(str.charAt(i++));
    const enc2 = chars.indexOf(str.charAt(i++));
    const enc3 = chars.indexOf(str.charAt(i++));
    const enc4 = chars.indexOf(str.charAt(i++));
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    output.push(chr1);
    if (enc3 !== 64) output.push(chr2);
    if (enc4 !== 64) output.push(chr3);
  }
  return Uint8Array.from(output);
};

// ── Helper: group raw status docs by userId ──
const groupStatuses = (rawStatuses, myId, tAnon) => {
  const grouped = {};
  rawStatuses.forEach(s => {
    if (!grouped[s.userId]) {
      grouped[s.userId] = {
        userId: s.userId,
        userName: s.userName || tAnon,
        userAvatar: s.userAvatar || null,
        statuses: [],
        hasUnviewed: false,
      };
    }
    grouped[s.userId].statuses.push(s);
    if (!s.viewedBy?.includes(myId)) {
      grouped[s.userId].hasUnviewed = true;
    }
  });
  return grouped;
};

// ── Serialize Firestore Timestamps for MMKV cache ──
const serializeStatus = (s) => ({
  ...s,
  createdAt: s.createdAt?.toDate ? { _seconds: Math.floor(s.createdAt.toDate().getTime() / 1000) } : s.createdAt,
  expiresAt: s.expiresAt?.toDate ? { _seconds: Math.floor(s.expiresAt.toDate().getTime() / 1000) } : s.expiresAt,
});

const deserializeTimestamp = (ts) => {
  if (!ts) return null;
  if (ts._seconds) return { toDate: () => new Date(ts._seconds * 1000) };
  return ts;
};

const deserializeStatus = (s) => ({
  ...s,
  createdAt: deserializeTimestamp(s.createdAt),
  expiresAt: deserializeTimestamp(s.expiresAt),
});


const StatusFeed = ({ user, firestoreDB, appdatabase, isDarkMode, onRequireSignIn }) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { isAdmin } = useGlobalState();
  const isAdminOrMod = isAdmin || !!user?.isModerator;
  const insets = useSafeAreaInsets();
  const [statuses, setStatuses] = useState(() => {
    // Instant load from cache on mount
    const cached = getCachedJSON('statuses_grouped');
    return cached ? cached.map(g => ({ ...g, statuses: g.statuses.map(deserializeStatus) })) : [];
  });
  const [followingIds, setFollowingIds] = useState(() => getCachedJSON('following_ids') || []);
  const [viewingStatus, setViewingStatus] = useState(null);
  const [drawerUser, setDrawerUser] = useState(null);  // user for BottomDrawer profile
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [showCreator, setShowCreator] = useState(false);
  const [caption, setCaption] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  // ── New: Theme selection for text statuses ──
  const [selectedThemeId, setSelectedThemeId] = useState('none');
  // ── New: Poll creator state ──
  const [isPollMode, setIsPollMode] = useState(false);
  const [pollOptions, setPollOptions] = useState(['', '']);
  // ── New: Stories viewer state ──
  const [storyIndex, setStoryIndex] = useState(0);
  const storyTimerRef = useRef(null);
  const pressTimestampRef = useRef(0);
  const storyProgressAnim = useRef(new Animated.Value(0)).current;

  // Track which chunk of followingIds we've loaded
  const followingChunkRef = useRef(0);
  const allFollowingLoadedRef = useRef(false);
  // Track locally viewed status IDs to skip duplicate writes
  const viewedLocallyRef = useRef(new Set());

  // ── Fetch who I follow (with MMKV cache, 30-min TTL) ──
  useEffect(() => {
    if (!user?.id || !firestoreDB) return;

    // If cache is valid, skip Firestore read
    if (isCacheValid('following_ids', FOLLOWING_CACHE_TTL) && followingIds.length > 0) {
      return;
    }

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
        setCachedJSON('following_ids', ids);
        setCacheTimestamp('following_ids');

      } catch (err) {
        console.warn('[StatusFeed] Error fetching following list:', err?.message);
      }
    })();
  }, [user?.id, firestoreDB]);

  // ── Upload image to Bunny CDN ──
  const uploadToBunny = useCallback(async (imagePath) => {
    try {
      const localPath = imagePath.startsWith('file://') ? imagePath.replace('file://', '') : imagePath;
      const base64 = await RNFS.readFile(localPath, 'base64');
      const bytes = base64ToBytes(base64);
      const fileName = `status_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      const remotePath = `statuses/${fileName}`;

      const response = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`, {
        method: 'PUT',
        headers: {
          AccessKey: BUNNY_ACCESS_KEY,
          'Content-Type': 'image/jpeg',
        },
        body: bytes,
      });

      if (!response.ok) {
        const txt = await response.text();
        console.warn('[StatusFeed] Bunny upload failed:', response.status, txt?.slice(0, 200));
        throw new Error('Upload failed');
      }
      return `${BUNNY_CDN_BASE}/${remotePath}`;
    } catch (err) {
      console.warn('[StatusFeed] Bunny upload error:', err?.message);
      return null;
    }
  }, []);

  // ── Fetch global random statuses (10 max, randomSeed-based) ──
  const fetchGlobalRandom = useCallback(async () => {
    if (!firestoreDB) return [];
    try {
      const rand = Math.random();
      const now = Timestamp.now();
      const nowMillis = now.toMillis();

      // Query 1: randomSeed >= rand
      // We check for 15 since the DB is kept clean by the cloud function, 
      // preventing wasted reads on expired posts.
      const q1 = query(
        collection(firestoreDB, 'statuses'),
        where('randomSeed', '>=', rand),
        orderBy('randomSeed', 'asc'),
        limit(15),
      );
      let snap = await getDocs(q1);
      
      let results = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.expiresAt?.toMillis() > nowMillis); // Local filter

      // Wraparound: if < 10 active results (e.g. at the edge of the index), fetch the missing amount
      if (results.length < 10) {
        const q2 = query(
          collection(firestoreDB, 'statuses'),
          where('randomSeed', '<', rand),
          orderBy('randomSeed', 'desc'),
          limit(15 - results.length),
        );
        const snap2 = await getDocs(q2);
        const moreResults = snap2.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(s => s.expiresAt?.toMillis() > nowMillis);
          
        results = results.concat(moreResults);
      }

      // Fallback if randomSeed indexing fails / hasn't propagated
      if (results.length === 0) {
        const fallbackQ = query(
          collection(firestoreDB, 'statuses'),
          where('expiresAt', '>', now),
          orderBy('expiresAt', 'desc'),
          limit(15),
        );
        const fbSnap = await getDocs(fallbackQ);
        results = fbSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Local shuffle for fallback
        for (let i = results.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [results[i], results[j]] = [results[j], results[i]];
        }
      }

      return results.slice(0, 15);
    } catch (err) {
      console.warn('[StatusFeed] Global random fetch error:', err?.message);
      return [];
    }
  }, [firestoreDB]);

  // ── Fetch following statuses (paginated by followingIds chunks) ──
  const fetchFollowingChunk = useCallback(async (chunkIndex) => {
    if (!firestoreDB || !user?.id || followingIds.length === 0) return [];

    const idsToQuery = [user.id]; // Always include self
    const start = chunkIndex * FOLLOWING_CHUNK_SIZE;
    const chunk = followingIds.slice(start, start + FOLLOWING_CHUNK_SIZE);

    if (chunkIndex > 0 && chunk.length === 0) {
      allFollowingLoadedRef.current = true;
      return [];
    }

    // Merge: self + following chunk (max 30 for Firestore 'in')
    const combined = [...new Set([...idsToQuery, ...chunk])].slice(0, 30);

    try {
      const now = Timestamp.now();
      const q = query(
        collection(firestoreDB, 'statuses'),
        where('userId', 'in', combined),
        where('expiresAt', '>', now),
      );
      const snap = await getDocs(q);
      const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));


      if (chunk.length < FOLLOWING_CHUNK_SIZE) {
        allFollowingLoadedRef.current = true;
      }
      return results;
    } catch (err) {
      console.warn('[StatusFeed] Following chunk fetch error:', err?.message);
      return [];
    }
  }, [firestoreDB, user?.id, followingIds]);

  // ── Main fetch: combines following + global ──
  const fetchStatuses = useCallback(async (force = false) => {
    if (!firestoreDB) return;

    // Check cache (skip if force refresh)
    if (!force && isCacheValid('statuses_grouped', STATUS_CACHE_TTL) && statuses.length > 0) {

      return;
    }

    try {
      // Reset pagination
      followingChunkRef.current = 0;
      allFollowingLoadedRef.current = false;

      // Fetch first chunk of following + my statuses
      const followingResults = await fetchFollowingChunk(0);
      followingChunkRef.current = 1;

      // Fetch global random statuses
      const globalResults = await fetchGlobalRandom();

      // Separate: me + following vs global
      const followingSet = new Set([user?.id, ...followingIds]);
      const myAndFollowing = followingResults;
      const globalOnly = globalResults
        .filter(s => !followingSet.has(s.userId))
        .slice(0, GLOBAL_STATUS_LIMIT);

      // Group all statuses
      const allRaw = [...myAndFollowing, ...globalOnly];
      const grouped = groupStatuses(allRaw, user?.id, t('status_feed.anonymous'));

      // Sort: Me first → following → global
      const arr = Object.values(grouped);
      arr.sort((a, b) => {
        const aIsMe = a.userId === user?.id;
        const bIsMe = b.userId === user?.id;
        if (aIsMe) return -1;
        if (bIsMe) return 1;
        const aIsFollowing = followingIds.includes(a.userId);
        const bIsFollowing = followingIds.includes(b.userId);
        if (aIsFollowing && !bIsFollowing) return -1;
        if (!aIsFollowing && bIsFollowing) return 1;
        return 0;
      });

      setStatuses(arr);

      // Cache to MMKV
      const serialized = arr.map(g => ({
        ...g,
        statuses: g.statuses.map(serializeStatus),
      }));
      setCachedJSON('statuses_grouped', serialized);
      setCacheTimestamp('statuses_grouped');


    } catch (err) {
      console.warn('[StatusFeed] fetch error:', err?.message);
    }
  }, [firestoreDB, user?.id, followingIds, fetchFollowingChunk, fetchGlobalRandom, statuses.length]);

  useEffect(() => { fetchStatuses(); }, [fetchStatuses]);

  // ── Load more following statuses (on scroll end) ──
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || allFollowingLoadedRef.current || !firestoreDB) return;

    setLoadingMore(true);
    try {
      const moreResults = await fetchFollowingChunk(followingChunkRef.current);
      followingChunkRef.current += 1;

      if (moreResults.length > 0) {
        const moreGrouped = groupStatuses(moreResults, user?.id, t('status_feed.anonymous'));

        setStatuses(prev => {
          // Merge new groups into existing, avoiding duplicates
          const existingMap = {};
          prev.forEach(g => { existingMap[g.userId] = g; });

          Object.values(moreGrouped).forEach(g => {
            if (existingMap[g.userId]) {
              // Merge statuses into existing group
              const existingIds = new Set(existingMap[g.userId].statuses.map(s => s.id));
              const newStatuses = g.statuses.filter(s => !existingIds.has(s.id));
              existingMap[g.userId] = {
                ...existingMap[g.userId],
                statuses: [...existingMap[g.userId].statuses, ...newStatuses],
                hasUnviewed: existingMap[g.userId].hasUnviewed || g.hasUnviewed,
              };
            } else {
              existingMap[g.userId] = g;
            }
          });

          const merged = Object.values(existingMap);
          // Re-sort
          merged.sort((a, b) => {
            if (a.userId === user?.id) return -1;
            if (b.userId === user?.id) return 1;
            const aF = followingIds.includes(a.userId);
            const bF = followingIds.includes(b.userId);
            if (aF && !bF) return -1;
            if (!aF && bF) return 1;
            return 0;
          });

          // Update cache
          const serialized = merged.map(g => ({
            ...g,
            statuses: g.statuses.map(serializeStatus),
          }));
          setCachedJSON('statuses_grouped', serialized);
          setCacheTimestamp('statuses_grouped');

          return merged;
        });
      }
    } catch (err) {
      console.warn('[StatusFeed] Load more error:', err?.message);
    }
    setLoadingMore(false);
  }, [loadingMore, firestoreDB, fetchFollowingChunk, user?.id, followingIds]);

  // ── Pick image ──
  const handlePickImage = useCallback(async () => {
    if (!user?.id) { onRequireSignIn?.(); return; }

    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        selectionLimit: 1,
        maxWidth: 1920,
        maxHeight: 1920,
      });

      if (result.didCancel) return;
      if (result.errorCode) {
        console.warn('[StatusFeed] Picker error:', result.errorMessage);
        Alert.alert(t('status_feed.error'), result.errorMessage || t('status_feed.pick_image_error'));
        return;
      }

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      // Try compression with a 5s timeout — if it fails/hangs, use picker's output
      let finalUri = asset.uri;
      try {
        const compressPromise = CompressorImage.compress(asset.uri, {
          maxWidth: 1200,
          quality: 0.7,
          returnableOutputType: 'uri',
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Compression timeout')), 5000)
        );
        finalUri = await Promise.race([compressPromise, timeoutPromise]);
      } catch (compErr) {
        console.warn('[StatusFeed] Compression skipped:', compErr?.message);
      }

      setSelectedImage({ ...asset, uri: finalUri });
      setShowCreator(true);
    } catch (err) {
      console.error('[StatusFeed] Image picker crash:', err);
      Alert.alert(t('status_feed.error'), t('status_feed.pick_failed'));
    }
  }, [user?.id, onRequireSignIn]);

  // ── Post status (local-first, no re-fetch) ──
  const { localState } = useLocalState();

  const handlePostStatus = useCallback(async () => {
    if (!user?.id || !firestoreDB) return;
    // Validate: need caption, image, or poll options
    const hasContent = caption.trim() || selectedImage;
    const hasValidPoll = isPollMode && pollOptions.filter(o => o.trim()).length >= 2;
    if (!hasContent && !hasValidPoll) {
      Alert.alert(t('status_feed.empty_status_title'), t('status_feed.empty_status_msg'));
      return;
    }

    const doUpload = async () => {
      setUploading(true);
      try {
        let imageUrl = null;

        if (selectedImage?.uri) {

          imageUrl = await uploadToBunny(selectedImage.uri);


          if (!imageUrl) {
            Alert.alert(t('status_feed.upload_failed_title'), t('status_feed.upload_failed_msg'));
            setUploading(false);
            return;
          }
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + STATUS_EXPIRY_MS);

        // Determine status type
        const selectedTheme = STATUS_THEMES.find(th => th.id === selectedThemeId);
        const hasTheme = !imageUrl && selectedTheme?.colors;
        const validPollOpts = isPollMode ? pollOptions.filter(o => o.trim()) : [];
        const isPoll = validPollOpts.length >= 2;
        let statusType = 'text';
        if (imageUrl) statusType = 'image';
        else if (isPoll) statusType = 'poll';
        else if (hasTheme) statusType = 'themed_text';

        const docData = {
          userId: user.id,
          userName: user.displayName || t('status_feed.anonymous'),
          caption: caption.trim() || '',
          imageUrl: imageUrl || null,
          createdAt: serverTimestamp(),
          expiresAt: Timestamp.fromDate(expiresAt),
          viewedBy: [],
          type: statusType,
          randomSeed: Math.random(),
          ...(user.avatar ? { userAvatar: user.avatar } : {}),
          // Theme data
          ...(hasTheme ? { themeId: selectedThemeId } : {}),
          // Poll data
          ...(isPoll ? {
            pollOptions: validPollOpts,
            pollVotes: validPollOpts.reduce((acc, _, i) => ({ ...acc, [i]: [] }), {}),
          } : {}),
        };

        const docRef = await addDoc(collection(firestoreDB, 'statuses'), docData);

        addXP(appdatabase, user.id, XP_ACTIONS.POST_STATUS);

        // ✅ Local-first: inject into state without re-fetching
        const newStatus = {
          ...docData,
          id: docRef.id,
          createdAt: { toDate: () => now },
          expiresAt: { toDate: () => expiresAt },
        };
        setStatuses(prev => {
          const updated = [...prev];
          const myGroupIdx = updated.findIndex(g => g.userId === user.id);
          if (myGroupIdx >= 0) {
            updated[myGroupIdx] = {
              ...updated[myGroupIdx],
              statuses: [...updated[myGroupIdx].statuses, newStatus],
            };
          } else {
            updated.unshift({
              userId: user.id,
              userName: user.displayName || t('status_feed.anonymous'),
              userAvatar: user.avatar || null,
              statuses: [newStatus],
              hasUnviewed: false,
            });
          }
          // Update cache
          const serialized = updated.map(g => ({
            ...g,
            statuses: g.statuses.map(serializeStatus),
          }));
          setCachedJSON('statuses_grouped', serialized);
          setCacheTimestamp('statuses_grouped');
          return updated;
        });

        setCaption('');
        setSelectedImage(null);
        setSelectedThemeId('none');
        setIsPollMode(false);
        setPollOptions(['', '']);
        setShowCreator(false);
      } catch (err) {
        console.warn('[StatusFeed] post error:', err?.message);
        Alert.alert(t('status_feed.error'), t('status_feed.post_error'));
      }
      setUploading(false);
    };

    await doUpload();

    // Show ad AFTER upload completes (non-blocking, for non-Pro users)
    if (!localState.isPro) {
      requestAnimationFrame(() => {
        setTimeout(() => {
          try {
            InterstitialAdManager.showAd(() => {});
          } catch (err) {
            console.warn('[StatusFeed] Ad failed:', err);
          }
        }, 400);
      });
    }
  }, [user, firestoreDB, appdatabase, caption, selectedImage, uploadToBunny, localState.isPro]);

  // ── Delete status (local-first, no re-fetch) ──
  const handleDeleteStatus = useCallback(async (statusId) => {
    if (!firestoreDB || !statusId) return;
    Alert.alert(t('status_feed.delete_title'), t('status_feed.delete_confirm'), [
      { text: t('status_feed.cancel'), style: 'cancel' },
      {
        text: t('status_feed.delete'), style: 'destructive',
        onPress: async () => {
          try {
            await deleteDoc(doc(firestoreDB, 'statuses', statusId));
            setViewingStatus(null);

            // ✅ Local-first: remove from state without re-fetching
            setStatuses(prev => {
              const updated = prev.map(g => ({
                ...g,
                statuses: g.statuses.filter(s => s.id !== statusId),
              })).filter(g => g.statuses.length > 0 || g.userId === user?.id);

              // Update cache
              const serialized = updated.map(g => ({
                ...g,
                statuses: g.statuses.map(serializeStatus),
              }));
              setCachedJSON('statuses_grouped', serialized);
              setCacheTimestamp('statuses_grouped');
              return updated;
            });
          } catch (err) {
            Alert.alert(t('status_feed.error'), t('status_feed.delete_error'));
          }
        },
      },
    ]);
  }, [firestoreDB, user?.id]);

  // ── Mark viewed (skip duplicates) ──
  const markViewed = useCallback(async (statusId) => {
    if (!user?.id || !firestoreDB) return;
    // ✅ Skip if already marked locally
    if (viewedLocallyRef.current.has(statusId)) return;
    viewedLocallyRef.current.add(statusId);
    try {
      await updateDoc(doc(firestoreDB, 'statuses', statusId), {
        viewedBy: arrayUnion(user.id),
      });
    } catch {} // fire-and-forget
  }, [user?.id, firestoreDB]);

  const handleViewStatus = useCallback((group) => {
    setStoryIndex(0);
    setViewingStatus(group);
    // Mark ALL statuses in this group as viewed (not just the first)
    if (group.statuses?.length > 0 && user?.id) {
      group.statuses.forEach(s => {
        if (!s.viewedBy?.includes(user.id)) {
          markViewed(s.id);
        }
      });
      // Immediately update local state so bubble ring flips to "seen"
      setStatuses(prev => {
        const updated = prev.map(g => {
          if (g.userId !== group.userId) return g;
          return {
            ...g,
            hasUnviewed: false,
            statuses: g.statuses.map(s => ({
              ...s,
              viewedBy: s.viewedBy?.includes(user.id) ? s.viewedBy : [...(s.viewedBy || []), user.id],
            })),
          };
        });
        // ✅ Persist updated viewedBy to MMKV cache so reload preserves "read" state
        const serialized = updated.map(g => ({
          ...g,
          statuses: g.statuses.map(serializeStatus),
        }));
        setCachedJSON('statuses_grouped', serialized);
        return updated;
      });
    }
  }, [markViewed, user?.id]);

  const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🔥', '👏'];

  // ── React to a status ──
  const handleReaction = useCallback(async (statusId, emoji) => {
    if (!user?.id) {
      stopStoryTimer();
      setViewingStatus(null);
      setTimeout(() => onRequireSignIn?.(), 2300);
      return;
    }
    if (!firestoreDB) return;
    try {
      const statusRef = doc(firestoreDB, 'statuses', statusId);
      await updateDoc(statusRef, {
        [`reactions.${user.id}`]: emoji,
      });
      // Optimistic local update
      setViewingStatus(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          statuses: prev.statuses.map(s => {
            if (s.id !== statusId) return s;
            return { ...s, reactions: { ...(s.reactions || {}), [user.id]: emoji } };
          }),
        };
      });
    } catch (err) {
      console.warn('[StatusFeed] reaction error:', err?.message);
    }
  }, [user?.id, firestoreDB]);

  // ── Follow / Unfollow toggle ──
  const handleFollowToggle = useCallback(async (targetUserId) => {
    if (!user?.id) {
      stopStoryTimer();
      setViewingStatus(null);
      setTimeout(() => onRequireSignIn?.(), 2300);
      return;
    }
    if (!firestoreDB || !targetUserId || user.id === targetUserId) return;

    setFollowLoading(true);
    const isCurrentlyFollowing = followingIds.includes(targetUserId);

    try {
      if (isCurrentlyFollowing) {
        // Unfollow — find and delete the document
        const followSnap = await getDocs(
          query(
            collection(firestoreDB, 'following'),
            where('followerId', '==', user.id),
            where('followingId', '==', targetUserId),
          )
        );
        await Promise.all(followSnap.docs.map(d => deleteDoc(doc(firestoreDB, 'following', d.id))));

        // Update local state + cache
        const updated = followingIds.filter(id => id !== targetUserId);
        setFollowingIds(updated);
        setCachedJSON('following_ids', updated);
        setCacheTimestamp('following_ids');
      } else {
        // Follow — create a new document
        await addDoc(collection(firestoreDB, 'following'), {
          followerId: user.id,
          followingId: targetUserId,
          createdAt: serverTimestamp(),
        });

        // Update local state + cache
        const updated = [...followingIds, targetUserId];
        setFollowingIds(updated);
        setCachedJSON('following_ids', updated);
        setCacheTimestamp('following_ids');
      }
    } catch (err) {
      console.warn('[StatusFeed] follow toggle error:', err?.message);
    }
    setFollowLoading(false);
  }, [user?.id, firestoreDB, followingIds]);

  // Colors
  const textColor = isDarkMode ? '#e2e8f0' : '#1e293b';
  const subtextColor = isDarkMode ? '#94a3b8' : '#64748b';

  // ── Poll vote handler ──
  const handlePollVote = useCallback(async (statusId, optionIndex) => {
    if (!user?.id) {
      stopStoryTimer();
      setViewingStatus(null);
      setTimeout(() => onRequireSignIn?.(), 2300);
      return;
    }
    if (!firestoreDB) return;
    try {
      const statusRef = doc(firestoreDB, 'statuses', statusId);
      // Remove from all options first, then add to chosen one
      const updates = {};
      // We just set our vote on the chosen option
      updates[`pollVotes.${optionIndex}`] = arrayUnion(user.id);
      await updateDoc(statusRef, updates);
      // Optimistic local update
      setViewingStatus(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          statuses: prev.statuses.map(s => {
            if (s.id !== statusId) return s;
            const updatedVotes = { ...(s.pollVotes || {}) };
            // Remove from other options
            Object.keys(updatedVotes).forEach(k => {
              if (Array.isArray(updatedVotes[k])) {
                updatedVotes[k] = updatedVotes[k].filter(uid => uid !== user.id);
              }
            });
            // Add to chosen
            updatedVotes[optionIndex] = [...(updatedVotes[optionIndex] || []), user.id];
            return { ...s, pollVotes: updatedVotes };
          }),
        };
      });
    } catch (err) {
      console.warn('[StatusFeed] poll vote error:', err?.message);
    }
  }, [user?.id, firestoreDB]);

  // ── Story auto-play controls ──
  const startStoryTimer = useCallback((index, total) => {
    if (storyTimerRef.current) clearTimeout(storyTimerRef.current);
    storyProgressAnim.setValue(0);
    Animated.timing(storyProgressAnim, {
      toValue: 1,
      duration: STORY_DURATION,
      useNativeDriver: false,
    }).start();
    storyTimerRef.current = setTimeout(() => {
      if (index < total - 1) {
        setStoryIndex(index + 1);
      } else {
        setViewingStatus(null);
      }
    }, STORY_DURATION);
  }, [storyProgressAnim]);

  const stopStoryTimer = useCallback(() => {
    if (storyTimerRef.current) clearTimeout(storyTimerRef.current);
    storyProgressAnim.stopAnimation();
  }, [storyProgressAnim]);

  // Start timer when storyIndex or viewingStatus changes
  useEffect(() => {
    if (viewingStatus?.statuses?.length > 0) {
      startStoryTimer(storyIndex, viewingStatus.statuses.length);
    }
    return () => { if (storyTimerRef.current) clearTimeout(storyTimerRef.current); };
  }, [storyIndex, viewingStatus?.userId]);

  // ── Open profile drawer from status (same BottomDrawer pattern used everywhere) ──
  const handleChatFromStatus = useCallback(() => {
    if (!user?.id) {
      stopStoryTimer();
      setViewingStatus(null);
      setTimeout(() => onRequireSignIn?.(), 2300);
      return;
    }
    if (!viewingStatus?.userId) return;
    stopStoryTimer();
    // Build the user object for BottomDrawer
    const profileUser = {
      senderId: viewingStatus.userId,
      sender: viewingStatus.userName || 'User',
      avatar: viewingStatus.userAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
    };
    setDrawerUser(profileUser);
    setViewingStatus(null);
    // Open drawer after modal closes
    setTimeout(() => setIsDrawerVisible(true), 400);
  }, [user?.id, viewingStatus]);

  // ── startChat callback for BottomDrawer → navigates to root-level PrivateChatRoot ──
  const handleStartChatFromDrawer = useCallback(() => {
    if (!drawerUser) return;
    setIsDrawerVisible(false);
    // Small delay so drawer close animation finishes before navigation
    setTimeout(() => {
      try {
        // Navigate to root-level PrivateChatRoot (outside bottom tabs, has back button)
        // StatusFeed is in Home tab → Tab.Navigator → root Stack
        const rootNav = navigation.getParent() || navigation;
        rootNav.navigate('PrivateChatRoot', {
          selectedUser: {
            senderId: drawerUser.senderId,
            sender: drawerUser.sender,
            avatar: drawerUser.avatar,
          },
        });
      } catch (e) {
        console.warn('[StatusFeed] Chat navigation failed:', e?.message);
      }
    }, 300);
  }, [drawerUser, navigation]);

  // ── Themed background renderer ──
  const renderThemedBg = (themeId, children, style) => {
    const theme = STATUS_THEMES.find(th => th.id === themeId);
    if (!theme?.colors) return children;
    return (
      <View style={[{ borderRadius: 12, overflow: 'hidden', position: 'relative' }, style]}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: '50%', backgroundColor: theme.colors[0] }} />
        <View style={{ position: 'absolute', top: '50%', left: 0, right: 0, bottom: 0, backgroundColor: theme.colors[1] }} />
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.1)' }} />
        <View style={{ position: 'relative', zIndex: 1 }}>
          {children}
        </View>
      </View>
    );
  };

  // ── Render bubble ──
  const renderBubble = useCallback(({ item }) => {
    const isMe = item.userId === user?.id;
    const hasUnviewed = item.hasUnviewed;
    const hasStatuses = item.statuses.length > 0;
    const ringStyle = hasUnviewed
      ? styles.bubbleRingUnseen
      : hasStatuses
        ? [styles.bubbleRingSeen, { borderColor: isDarkMode ? '#475569' : RING_SEEN }]
        : { borderColor: isDarkMode ? '#334155' : '#e2e8f0' };

    return (
      <TouchableOpacity
        style={styles.bubbleWrap}
        onPress={() => isMe && item.statuses.length === 0 ? setShowCreator(true) : handleViewStatus(item)}
        activeOpacity={0.7}
      >
        {hasUnviewed ? (
          <View style={styles.gradientRingOuter}>
            <View style={styles.gradientRingMiddle}>
              <View style={[styles.gradientRingInner, { backgroundColor: isDarkMode ? '#0f172a' : '#fff' }]}>
                <LoadingImage
                  source={{ uri: item.userAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                  style={styles.bubbleAvatar}
                  borderRadius={(BUBBLE_SIZE - 4) / 2}
                />
              </View>
            </View>
          </View>
        ) : (
          <View style={[styles.bubbleRing, ringStyle]}>
            <LoadingImage
              source={{ uri: item.userAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
              style={styles.bubbleAvatar}
              borderRadius={(BUBBLE_SIZE - 4) / 2}
            />
          </View>
        )}
        {isMe && (
          <View style={styles.addBadge}>
            <FontAwesome name="plus" size={8} color="#FFF" solid />
          </View>
        )}
        <Text style={[styles.bubbleName, { color: subtextColor }]} numberOfLines={1}>
          {isMe ? t('status_feed.you') : (item.userName || '').split(' ')[0]}
        </Text>
      </TouchableOpacity>
    );
  }, [user?.id, isDarkMode, handleViewStatus, subtextColor]);

  // Build data: always ensure current user is first
  const feedData = useMemo(() => {
    if (!user?.id) return statuses;
    const myIndex = statuses.findIndex(s => s.userId === user.id);
    if (myIndex === -1) {
      // No status yet — add placeholder at front
      return [
        { userId: user.id, userName: t('status_feed.you'), userAvatar: user.avatar, statuses: [], hasUnviewed: false },
        ...statuses,
      ];
    }
    if (myIndex === 0) return statuses;
    // Move my status to front
    const reordered = [...statuses];
    const [myGroup] = reordered.splice(myIndex, 1);
    reordered.unshift(myGroup);
    return reordered;
  }, [statuses, user]);

  // Reserve space even when empty to prevent layout shift
  if (feedData.length === 0) {
    return (
      <View style={[styles.container, { borderBottomColor: isDarkMode ? '#1e293b' : 'rgba(0,0,0,0.05)' }]}>
        <View style={styles.listContent}>
          <View style={{ height: BUBBLE_SIZE + 24 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderBottomColor: isDarkMode ? '#1e293b' : 'rgba(0,0,0,0.05)' }]}>
      <FlatList
        data={feedData}
        horizontal
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.userId}
        renderItem={renderBubble}
        contentContainerStyle={styles.listContent}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loadingMore ? (
          <View style={{ width: 50, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="small" color={isDarkMode ? '#94A3B8' : '#64748B'} />
          </View>
        ) : null}
      />

      {/* ── Stories-Style Viewer Modal ── */}
      {viewingStatus && (() => {
        const currentStatus = viewingStatus.statuses[storyIndex] || viewingStatus.statuses[0];
        if (!currentStatus) return null;
        const isMyStatus = currentStatus.userId === user?.id;
        const totalStatuses = viewingStatus.statuses.length;
        const reactionEntries = Object.entries(currentStatus.reactions || {});
        const myReaction = currentStatus.reactions?.[user?.id];
        const reactionCounts = {};
        reactionEntries.forEach(([, emoji]) => {
          reactionCounts[emoji] = (reactionCounts[emoji] || 0) + 1;
        });
        const statusTheme = STATUS_THEMES.find(th => th.id === currentStatus.themeId);
        const isThemedText = currentStatus.type === 'themed_text' && statusTheme?.colors;
        const isPollType = currentStatus.type === 'poll' && currentStatus.pollOptions;

        // Calculate total poll votes
        const pollTotalVotes = isPollType
          ? Object.values(currentStatus.pollVotes || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
          : 0;
        const myVoteIndex = isPollType
          ? Object.entries(currentStatus.pollVotes || {}).findIndex(([, arr]) => Array.isArray(arr) && arr.includes(user?.id))
          : -1;

        return (
        <Modal visible={true} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { stopStoryTimer(); setViewingStatus(null); }}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            {/* Progress bars */}
            <View style={{ flexDirection: 'row', gap: 3, paddingHorizontal: 10, paddingTop: 50, zIndex: 20 }}>
              {viewingStatus.statuses.map((_, i) => (
                <View key={i} style={{ flex: 1, height: 2.5, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, overflow: 'hidden' }}>
                  {i < storyIndex ? (
                    <View style={{ width: '100%', height: '100%', backgroundColor: '#fff' }} />
                  ) : i === storyIndex ? (
                    <Animated.View style={{
                      height: '100%', backgroundColor: '#fff', borderRadius: 2,
                      width: storyProgressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                    }} />
                  ) : null}
                </View>
              ))}
            </View>

            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, zIndex: 20 }}>
              <Image
                source={{ uri: viewingStatus.userAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)' }}
              />
              <Text style={{ flex: 1, color: '#fff', fontSize: 14, fontWeight: '700', marginLeft: 10 }} numberOfLines={1}>
                {viewingStatus.userName}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginRight: 10 }}>
                {currentStatus.createdAt?.toDate ? getTimeAgo(currentStatus.createdAt.toDate(), t) : ''}
              </Text>
              {/* Follow button */}
              {user?.id && viewingStatus.userId !== user.id && (
                <TouchableOpacity
                  onPress={() => handleFollowToggle(viewingStatus.userId)}
                  disabled={followLoading}
                  activeOpacity={0.7}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, marginRight: 8,
                    ...(followingIds.includes(viewingStatus.userId)
                      ? { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)' }
                      : { backgroundColor: '#3B82F6' }),
                    ...(followLoading ? { opacity: 0.5 } : {}),
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#fff' }}>
                    {followingIds.includes(viewingStatus.userId)
                      ? t('status_feed.following', { defaultValue: 'Following' })
                      : t('status_feed.follow', { defaultValue: 'Follow' })}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => { stopStoryTimer(); setViewingStatus(null); }} style={{ padding: 6 }}>
                <Text style={{ fontSize: 20, color: '#fff', fontWeight: '300' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Content area — tap left/right to navigate */}
            <TouchableOpacity
              activeOpacity={1}
              onPressIn={() => { stopStoryTimer(); pressTimestampRef.current = Date.now(); }}
              onPressOut={() => {
                // Only restart timer if it was a long press (hold-to-pause), not a quick tap
                if (Date.now() - (pressTimestampRef.current || 0) > 300) {
                  startStoryTimer(storyIndex, totalStatuses);
                }
              }}
              onPress={(e) => {
                const x = e.nativeEvent.locationX;
                if (x < SCREEN_WIDTH * 0.3) {
                  // Tap left — go back
                  if (storyIndex > 0) setStoryIndex(storyIndex - 1);
                  else startStoryTimer(storyIndex, totalStatuses);
                } else if (x > SCREEN_WIDTH * 0.7) {
                  // Tap right — go forward
                  if (storyIndex < totalStatuses - 1) setStoryIndex(storyIndex + 1);
                  else { stopStoryTimer(); setViewingStatus(null); }
                } else {
                  // Tap middle — resume timer
                  startStoryTimer(storyIndex, totalStatuses);
                }
              }}
              style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 16 }}
            >
              {/* Image status */}
              {currentStatus.imageUrl && (
                <LoadingImage
                  source={{ uri: currentStatus.imageUrl }}
                  style={{ width: SCREEN_WIDTH - 32, height: SCREEN_HEIGHT * 0.5, borderRadius: 16 }}
                  resizeMode="cover"
                  borderRadius={16}
                />
              )}

              {/* Themed text status */}
              {isThemedText && !currentStatus.imageUrl && renderThemedBg(
                currentStatus.themeId,
                <View style={{ paddingVertical: 50, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
                  <Text style={{ fontSize: 22, fontWeight: '700', color: statusTheme.textColor, textAlign: 'center', lineHeight: 32 }}>
                    {currentStatus.caption}
                  </Text>
                </View>,
                { width: SCREEN_WIDTH - 32 }
              )}

              {/* Poll status */}
              {isPollType && (
                <View style={{ width: SCREEN_WIDTH - 32, padding: 20, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                  {currentStatus.caption ? (
                    <Text style={{ fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 16, textAlign: 'center' }}>
                      {currentStatus.caption}
                    </Text>
                  ) : null}
                  {currentStatus.pollOptions.map((opt, i) => {
                    const votes = Array.isArray(currentStatus.pollVotes?.[i]) ? currentStatus.pollVotes[i].length : 0;
                    const pct = pollTotalVotes > 0 ? Math.round((votes / pollTotalVotes) * 100) : 0;
                    const isMyVote = myVoteIndex === i;
                    const hasVoted = myVoteIndex >= 0;
                    return (
                      <TouchableOpacity
                        key={i}
                        onPress={() => !hasVoted && handlePollVote(currentStatus.id, i)}
                        activeOpacity={hasVoted ? 1 : 0.7}
                        style={{
                          marginBottom: 8, borderRadius: 12, overflow: 'hidden',
                          borderWidth: isMyVote ? 2 : 1,
                          borderColor: isMyVote ? '#3B82F6' : 'rgba(255,255,255,0.15)',
                          backgroundColor: 'rgba(255,255,255,0.05)',
                        }}
                      >
                        {/* Fill bar */}
                        {hasVoted && (
                          <View style={{
                            position: 'absolute', top: 0, left: 0, bottom: 0,
                            width: `${pct}%`, backgroundColor: isMyVote ? '#3B82F620' : 'rgba(255,255,255,0.08)',
                            borderRadius: 12,
                          }} />
                        )}
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 }}>
                          <Text style={{ flex: 1, fontSize: 14, fontWeight: isMyVote ? '700' : '500', color: '#fff' }}>
                            {opt}
                          </Text>
                          {hasVoted && (
                            <Text style={{ fontSize: 13, fontWeight: '700', color: isMyVote ? '#3B82F6' : 'rgba(255,255,255,0.6)' }}>
                              {pct}%
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {pollTotalVotes > 0 && (
                    <Text style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                      {pollTotalVotes} {pollTotalVotes === 1 ? 'vote' : 'votes'}
                    </Text>
                  )}
                </View>
              )}

              {/* Plain text status */}
              {!currentStatus.imageUrl && !isThemedText && !isPollType && currentStatus.caption ? (
                <Text style={{ fontSize: 20, fontWeight: '600', color: '#fff', textAlign: 'center', lineHeight: 30, paddingHorizontal: 20 }}>
                  {currentStatus.caption}
                </Text>
              ) : null}

              {/* Caption below image (if image + caption) */}
              {currentStatus.imageUrl && currentStatus.caption ? (
                <Text style={{ fontSize: 15, color: '#fff', marginTop: 12, textAlign: 'center', lineHeight: 22 }}>
                  {currentStatus.caption}
                </Text>
              ) : null}
            </TouchableOpacity>

            {/* Bottom bar: reactions, views, chat, delete */}
            <View style={{ paddingHorizontal: 16, paddingBottom: Math.max(insets.bottom, 20) + 20, zIndex: 20 }}>
              {/* View count + reaction summary */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {currentStatus.viewedBy?.length > 0 && (
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                      👁 {currentStatus.viewedBy.length}
                    </Text>
                  )}
                  {reactionEntries.length > 0 && (
                    <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                      {Object.keys(reactionCounts).map(e => `${e}${reactionCounts[e] > 1 ? reactionCounts[e] : ''}`).join(' ')}
                    </Text>
                  )}
                </View>
                {/* Page indicator */}
                {totalStatuses > 1 && (
                  <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                    {storyIndex + 1}/{totalStatuses}
                  </Text>
                )}
              </View>

              {/* Reaction bar + Chat button row */}
              {!isMyStatus && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {/* Reactions */}
                  <View style={{ flexDirection: 'row', flex: 1, gap: 4 }}>
                    {REACTION_EMOJIS.map(emoji => (
                      <TouchableOpacity
                        key={emoji}
                        onPress={() => { stopStoryTimer(); handleReaction(currentStatus.id, emoji); setTimeout(() => startStoryTimer(storyIndex, totalStatuses), 400); }}
                        style={{
                          paddingHorizontal: 8, paddingVertical: 6, borderRadius: 20,
                          backgroundColor: myReaction === emoji ? '#3B82F630' : 'rgba(255,255,255,0.1)',
                          borderWidth: myReaction === emoji ? 1.5 : 0,
                          borderColor: '#3B82F6',
                        }}
                      >
                        <Text style={{ fontSize: 16 }}>{emoji}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {/* Chat / DM button */}
                  <TouchableOpacity
                    onPress={() => { stopStoryTimer(); handleChatFromStatus(); }}
                    activeOpacity={0.8}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      backgroundColor: '#3B82F6', paddingHorizontal: 16, paddingVertical: 10,
                      borderRadius: 24,
                    }}
                  >
                    <FontAwesome name="paper-plane" size={12} color="#fff" solid />
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>Chat</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Own status: views + add new + delete */}
              {isMyStatus && (
                <View style={{ gap: 8 }}>
                  {(currentStatus.viewedBy?.length > 0 || reactionEntries.length > 0) && (
                    <Text style={{ fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.5)' }}>
                      👁 {t('status_feed.views_count', { count: currentStatus.viewedBy?.length || 0 })}  •  {t('status_feed.reactions_count', { count: reactionEntries.length })}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                    <TouchableOpacity
                      onPress={() => { stopStoryTimer(); setViewingStatus(null); setShowCreator(true); }}
                      style={[styles.deleteBtn, { backgroundColor: 'rgba(59,130,246,0.2)' }]}
                    >
                      <FontAwesome name="plus" size={12} color="#3B82F6" solid />
                      <Text style={[styles.deleteText, { color: '#3B82F6' }]}>{t('status_feed.new_status')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => { stopStoryTimer(); handleDeleteStatus(currentStatus.id); }}
                      style={styles.deleteBtn}
                    >
                      <FontAwesome name="trash" size={12} color="#EF4444" />
                      <Text style={styles.deleteText}>{t('status_feed.delete')}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Mod/Admin delete button on other people's statuses */}
              {!isMyStatus && isAdminOrMod && (
                <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
                  <TouchableOpacity
                    onPress={() => { stopStoryTimer(); handleDeleteStatus(currentStatus.id); }}
                    style={[styles.deleteBtn, { backgroundColor: '#FEE2E230' }]}
                  >
                    <FontAwesome name="shield" size={10} color="#F59E0B" solid />
                    <FontAwesome name="trash" size={12} color="#EF4444" />
                    <Text style={styles.deleteText}>Mod Delete</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </Modal>
        );
      })()}

      {/* ── Status Creator Modal ── */}
      <Modal visible={showCreator} transparent animationType="slide" onRequestClose={() => setShowCreator(false)}>
        <KeyboardAvoidingView 
          style={styles.creatorOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <SwipeableBottomDrawer onClose={() => { setShowCreator(false); setCaption(''); setSelectedImage(null); setSelectedThemeId('none'); setIsPollMode(false); setPollOptions(['', '']); }} isDarkMode={isDarkMode} style={[styles.creatorCard, { backgroundColor: isDarkMode ? '#1e293b' : '#FFF', paddingBottom: Math.max(insets.bottom, 20) + 10 }]}>
            <View style={styles.creatorHeader}>
              <Text style={[styles.creatorTitle, { color: textColor }]}>{t('status_feed.new_status')}</Text>
              <TouchableOpacity onPress={() => { setShowCreator(false); setCaption(''); setSelectedImage(null); setSelectedThemeId('none'); setIsPollMode(false); setPollOptions(['', '']); }}>
                <Text style={{ fontSize: 18, color: subtextColor }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Image preview */}
            {selectedImage?.uri && (
              <View style={styles.imagePreviewWrap}>
                <Image source={{ uri: selectedImage.uri }} style={styles.imagePreview} resizeMode="cover" />
                <TouchableOpacity
                  style={styles.removeImageBtn}
                  onPress={() => setSelectedImage(null)}
                >
                  <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Add image / Poll mode toggle buttons */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {!selectedImage && !isPollMode && (
                <TouchableOpacity
                  style={[styles.addImageBtn, { flex: 1, height: 50, backgroundColor: isDarkMode ? '#0f172a' : '#f1f5f9' }]}
                  onPress={handlePickImage}
                >
                  <FontAwesome name="image" size={16} color={subtextColor} />
                  <Text style={{ color: subtextColor, fontSize: 12, marginLeft: 6 }}>{t('status_feed.add_photo')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.addImageBtn, {
                  flex: 1, height: 50,
                  backgroundColor: isPollMode ? '#3B82F615' : (isDarkMode ? '#0f172a' : '#f1f5f9'),
                  borderColor: isPollMode ? '#3B82F6' : (isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),
                }]}
                onPress={() => { setIsPollMode(!isPollMode); if (!isPollMode) { setSelectedImage(null); setSelectedThemeId('none'); } }}
              >
                <Text style={{ fontSize: 16 }}>📊</Text>
                <Text style={{ color: isPollMode ? '#3B82F6' : subtextColor, fontSize: 12, fontWeight: isPollMode ? '700' : '500', marginLeft: 6 }}>Poll</Text>
              </TouchableOpacity>
            </View>

            {/* Poll options */}
            {isPollMode && (
              <View style={{ marginBottom: 12 }}>
                {pollOptions.map((opt, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                    <TextInput
                      style={[styles.creatorInput, {
                        flex: 1, minHeight: 40, marginBottom: 0,
                        color: textColor,
                        backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
                        borderColor: isDarkMode ? '#334155' : '#e2e8f0',
                      }]}
                      placeholder={`Option ${i + 1}`}
                      placeholderTextColor={subtextColor}
                      maxLength={60}
                      value={opt}
                      onChangeText={(text) => {
                        const updated = [...pollOptions];
                        updated[i] = text;
                        setPollOptions(updated);
                      }}
                    />
                    {pollOptions.length > 2 && (
                      <TouchableOpacity
                        onPress={() => setPollOptions(pollOptions.filter((_, j) => j !== i))}
                        style={{ padding: 8, marginLeft: 4 }}
                      >
                        <Text style={{ color: '#EF4444', fontSize: 14, fontWeight: '700' }}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                {pollOptions.length < 4 && (
                  <TouchableOpacity
                    onPress={() => setPollOptions([...pollOptions, ''])}
                    style={{ alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: isDarkMode ? '#0f172a' : '#f1f5f9', borderWidth: 1, borderColor: isDarkMode ? '#334155' : '#e2e8f0' }}
                  >
                    <Text style={{ color: subtextColor, fontSize: 12, fontWeight: '600' }}>+ Add Option</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Theme selector (only for text-only statuses, no image or poll) */}
            {!selectedImage && !isPollMode && (
              <View style={{ marginBottom: 12 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: subtextColor, marginBottom: 8 }}>Background Theme</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {STATUS_THEMES.map((theme) => (
                    <TouchableOpacity
                      key={theme.id}
                      onPress={() => setSelectedThemeId(theme.id)}
                      style={{
                        width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
                        borderWidth: selectedThemeId === theme.id ? 2.5 : 1,
                        borderColor: selectedThemeId === theme.id ? '#3B82F6' : (isDarkMode ? '#334155' : '#e2e8f0'),
                        ...(theme.colors
                          ? { backgroundColor: theme.colors[0] }
                          : { backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc' }),
                      }}
                    >
                      <Text style={{ fontSize: theme.colors ? 16 : 11, color: theme.colors ? '#fff' : subtextColor }}>
                        {theme.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Theme preview */}
            {!selectedImage && !isPollMode && selectedThemeId !== 'none' && (() => {
              const previewTheme = STATUS_THEMES.find(th => th.id === selectedThemeId);
              if (!previewTheme?.colors) return null;
              return renderThemedBg(
                selectedThemeId,
                <View style={{ paddingVertical: 24, paddingHorizontal: 16, alignItems: 'center' }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: previewTheme.textColor, textAlign: 'center' }}>
                    {caption.trim() || t('status_feed.placeholder')}
                  </Text>
                </View>,
                { marginBottom: 12 }
              );
            })()}

            <TextInput
              style={[styles.creatorInput, {
                color: textColor,
                backgroundColor: isDarkMode ? '#0f172a' : '#f8fafc',
                borderColor: isDarkMode ? '#334155' : '#e2e8f0',
              }]}
              placeholder={isPollMode ? 'Ask a question...' : t('status_feed.placeholder')}
              placeholderTextColor={subtextColor}
              multiline
              maxLength={200}
              value={caption}
              onChangeText={setCaption}
            />

            <TouchableOpacity
              style={[styles.creatorPostBtn, uploading && { opacity: 0.5 }]}
              onPress={handlePostStatus}
              disabled={uploading}
            >
              {uploading ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator size="small" color="#FFF" />
                  <Text style={styles.creatorPostText}>{t('status_feed.uploading')}</Text>
                </View>
              ) : (
                <Text style={styles.creatorPostText}>{t('status_feed.post_status')}</Text>
              )}
            </TouchableOpacity>
          </SwipeableBottomDrawer>
        </KeyboardAvoidingView>
      </Modal>
      {/* ── Profile BottomDrawer (for status chat) ── */}
      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={handleStartChatFromDrawer}
        selectedUser={drawerUser}
        bannedUsers={[]}
      />
    </View>
  );
};

const getTimeAgo = (date, t) => {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return t('status_feed.time_just_now');
  if (mins < 60) return t('status_feed.time_min_ago', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('status_feed.time_hour_ago', { count: hrs });
  return t('status_feed.time_day_ago', { count: Math.floor(hrs / 24) });
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    gap: 4,
  },
  bubbleWrap: { alignItems: 'center', width: 72 },
  bubbleRing: {
    width: BUBBLE_SIZE + 4, height: BUBBLE_SIZE + 4,
    borderRadius: (BUBBLE_SIZE + 4) / 2,
    borderWidth: 2.5, borderColor: '#e2e8f0',
    alignItems: 'center', justifyContent: 'center',
  },
  bubbleRingUnseen: { borderColor: '#F59E0B', borderWidth: 2.5 },
  bubbleRingSeen: { borderColor: '#94A3B8', borderWidth: 2 },
  gradientRingOuter: {
    width: BUBBLE_SIZE + 6, height: BUBBLE_SIZE + 6,
    borderRadius: (BUBBLE_SIZE + 6) / 2,
    backgroundColor: '#EC4899',
    alignItems: 'center', justifyContent: 'center',
  },
  gradientRingMiddle: {
    width: BUBBLE_SIZE + 4, height: BUBBLE_SIZE + 4,
    borderRadius: (BUBBLE_SIZE + 4) / 2,
    backgroundColor: '#F59E0B',
    alignItems: 'center', justifyContent: 'center',
  },
  gradientRingInner: {
    width: BUBBLE_SIZE, height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#fff',
  },
  bubbleAvatar: {
    width: BUBBLE_SIZE - 4, height: BUBBLE_SIZE - 4,
    borderRadius: (BUBBLE_SIZE - 4) / 2,
  },
  addBadge: {
    position: 'absolute', bottom: 18, right: 8,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: '#3B82F6',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFF',
  },
  bubbleName: { fontSize: 10, fontWeight: '500', marginTop: 3, textAlign: 'center' },
  // Viewer
  viewerOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 20,
  },
  viewerCard: { width: '100%', borderRadius: 16, padding: 16, maxHeight: '85%' },
  viewerHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  viewerAvatar: { width: 36, height: 36, borderRadius: 18 },
  viewerName: { flex: 1, fontSize: 15, fontWeight: '700' },
  // Follow button
  followBtn: {
    paddingHorizontal: 14, paddingVertical: 5,
    borderRadius: 20, marginRight: 6,
  },
  followBtnFollow: {
    backgroundColor: '#3B82F6',
  },
  followBtnFollowing: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  followBtnText: {
    fontSize: 12, fontWeight: '700',
  },
  viewerContent: { marginBottom: 16, borderBottomWidth: 0.5, borderBottomColor: 'rgba(0,0,0,0.1)', paddingBottom: 12 },
  viewerCaption: { fontSize: 16, fontWeight: '500', lineHeight: 24, marginBottom: 6 },
  viewerImage: { width: '100%', height: 280, borderRadius: 12, marginBottom: 8 },
  viewerFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  viewerTime: { fontSize: 11 },
  viewerViews: { fontSize: 11 },
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 8, alignSelf: 'flex-end',
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 6, backgroundColor: '#FEE2E2',
  },
  deleteText: { color: '#EF4444', fontSize: 11, fontWeight: '600' },
  // Creator
  creatorOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  creatorCard: { padding: 20 },
  creatorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  creatorTitle: { fontSize: 18, fontWeight: '700' },
  imagePreviewWrap: { position: 'relative', marginBottom: 12 },
  imagePreview: { width: '100%', height: 200, borderRadius: 12 },
  removeImageBtn: {
    position: 'absolute', top: 8, right: 8,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  addImageBtn: {
    height: 80, borderRadius: 12, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)', borderStyle: 'dashed',
  },
  creatorInput: {
    borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15,
    minHeight: 80, textAlignVertical: 'top', marginBottom: 16,
  },
  creatorPostBtn: {
    backgroundColor: '#3B82F6', paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 12, alignItems: 'center',
  },
  creatorPostText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
});

export default React.memo(StatusFeed);
