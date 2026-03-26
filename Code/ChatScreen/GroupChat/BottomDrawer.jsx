import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Image,
  ActivityIndicator,
  ScrollView,
  Alert,
  Linking,
  Platform,
  Dimensions,
  Animated,
  TextInput,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import config from '../../Helper/Environment';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../../SettingScreen/settingstyle';
import { useLocalState } from '../../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { mixpanel } from '../../AppHelper/MixPenel';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import SwipeableBottomDrawer from '../../Helper/SwipeableBottomDrawer';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,           // ✅ moved here
  setDoc,
  deleteDoc,
  serverTimestamp,
  getCountFromServer, // ✅ Added for follower count
} from '@react-native-firebase/firestore';
import { ref, get, set } from '@react-native-firebase/database';
import auth from '@react-native-firebase/auth';
import dayjs from 'dayjs';
import { banUserwithEmail, unbanUserWithEmail, checkBanStatus, makeModerator, removeModerator, setUserStrike, muteUser, useOnlineStatus } from '../utils';
import relativeTime from 'dayjs/plugin/relativeTime';
import CompactPortfolio from './CompactPortfolio';
import ProfileAdminActions from './ProfileAdminActions';
import ProfileReviewsSection from './ProfileReviewsSection';
import ProfileTradesSection from './ProfileTradesSection';
import ProfilePostsSection from './ProfilePostsSection';
import BadgeShowcase from './BadgeShowcase';
import { computeBadges, checkInfluencerBadge } from './badgeUtils';
import XPBar from '../../Engagement/XPBar';
import { getUserXP } from '../../Engagement/xpUtils';
import FramedAvatar from './FramedAvatar';
import { getThemeColors } from '../../Helper/themeColors';

dayjs.extend(relativeTime);

const REVIEWS_PAGE_SIZE = 3; // how many reviews per page (unfiltered)
const FILTERED_REVIEWS_PAGE_SIZE = 5; // how many reviews per page when star filter is active

// ✅ Helper function to format fruit names for image URLs
const formatName = (name) => {
  if (!name || typeof name !== 'string') return '';
  return name.replace(/^\+/, '').replace(/\s+/g, '-');
};

// Helper function to format trade item names
const formatTradeName = (name) => {
  if (!name || typeof name !== 'string') return '';
  let formattedName = name.replace(/^\+/, '');
  formattedName = formattedName.replace(/\s+/g, '-');
  return formattedName;
};

// Helper function to format values
const formatTradeValue = (value) => {
  if (!value || typeof value !== 'number') return '0';
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  } else if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  } else if (value < 1) {
    return value.toFixed(2);
  } else {
    return value % 1 === 0 ? value.toLocaleString() : value.toFixed(2);
  }
};

// Helper function to group items
const groupTradeItems = (items) => {
  if (!Array.isArray(items)) return [];
  const grouped = {};
  items.forEach(({ name, type }) => {
    const key = `${name}-${type}`;
    if (grouped[key]) {
      grouped[key].count += 1;
    } else {
      grouped[key] = { name, type, count: 1 };
    }
  });
  return Object.values(grouped);
};

// Helper function to get trade deal
const getTradeDeal = (hasTotal, wantsTotal) => {
  // Handle both number and object formats
  const hasValue = typeof hasTotal === 'number' ? hasTotal : hasTotal?.value;
  const wantsValue = typeof wantsTotal === 'number' ? wantsTotal : wantsTotal?.value;

  if (!hasValue || hasValue <= 0) {
    return { deal: { label: "trade.unknown_deal", color: "#8E8E93" }, tradeRatio: 0 };
  }

  const tradeRatio = wantsValue ? wantsValue / hasValue : 0;
  let deal;

  if (tradeRatio >= 0.05 && tradeRatio <= 0.6) {
    deal = { label: "trade.best_deal", color: "#34C759" };
  } else if (tradeRatio > 0.6 && tradeRatio <= 0.75) {
    deal = { label: "trade.great_deal", color: "#32D74B" };
  } else if (tradeRatio > 0.75 && tradeRatio <= 1.25) {
    deal = { label: "trade.fair_deal", color: "#FFCC00" };
  } else if (tradeRatio > 1.25 && tradeRatio <= 1.4) {
    deal = { label: "trade.decent_deal", color: "#FF9F0A" };
  } else if (tradeRatio > 1.4 && tradeRatio <= 1.55) {
    deal = { label: "trade.weak_deal", color: "#D65A31" };
  } else {
    deal = { label: "trade.risky_deal", color: "#7D1128" };
  }

  return { deal, tradeRatio };
};

// ─── Standalone image carousel for post viewer ───────────────────────────────
const PostImageCarousel = React.memo(({ images, isDarkMode, screenWidth }) => {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const c = getThemeColors(isDarkMode);

  if (!images || images.length === 0) return null;

  const onScroll = (e) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    setActiveIndex(index);
  };

  return (
    <View style={{ marginVertical: 10 }}>
      {/* Horizontal paging scroll */}
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={{ width: screenWidth }}
      >
        {images.map((imgUrl, idx) => (
          <View
            key={idx}
            style={{
              width: screenWidth,
              paddingHorizontal: 16,
            }}
          >
            <Image
              source={{ uri: imgUrl }}
              style={{
                width: screenWidth - 32,
                height: (screenWidth - 32) * 0.65,
                borderRadius: 12,
                backgroundColor: c.border,
              }}
              resizeMode="cover"
            />
          </View>
        ))}
      </ScrollView>

      {/* Pagination: dots + counter badge */}
      {images.length > 1 && (
        <>
          {/* Dot indicators */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 8, gap: 5 }}>
            {images.map((_, idx) => (
              <View
                key={idx}
                style={{
                  width: idx === activeIndex ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: idx === activeIndex
                    ? (c.text)
                    : (isDarkMode ? '#374151' : '#d1d5db'),
                }}
              />
            ))}
          </View>
          {/* Counter badge */}
          <View style={{ position: 'absolute', top: 10, right: 24, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{activeIndex + 1}/{images.length}</Text>
          </View>
        </>
      )}
    </View>
  );
});

const ProfileBottomDrawer = ({
  isVisible,
  toggleModal,
  startChat,
  selectedUser,
  isOnline: isOnlineProp, // kept for backward compat, overridden by real-time hook
  bannedUsers,
  fromPvtChat,
}) => {
  const { theme, firestoreDB, appdatabase, isAdmin, user } = useGlobalState();
  const { updateLocalState, localState } = useLocalState();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();

  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const selectedUserId = selectedUser?.senderId || selectedUser?.id || null;

  // ✅ FIXED: Real-time online status listener instead of stale one-shot prop
  const isOnline = useOnlineStatus(isVisible ? selectedUserId : null);
  const userName = selectedUser?.sender || null;
  const avatar = selectedUser?.avatar || null;

  // 🔒 ban state - ✅ Safety check for array
  const isBlock = Array.isArray(bannedUsers) && bannedUsers.includes(selectedUserId);

  // ⭐ rating summary (from Firestore user_ratings_summary - single source of truth)
  const [ratingSummary, setRatingSummary] = useState(null);
  const [loadingRating, setLoadingRating] = useState(false);
  const [userBio, setUserBio] = useState(null);

  // 👥 Follower Count (New)
  const [followersCount, setFollowersCount] = useState(0);

  // joined text
  const [createdAtText, setCreatedAtText] = useState(null);

  // 💰 user points and game wins
  const [userPoints, setUserPoints] = useState(null);
  const [gameWins, setGameWins] = useState(null);

  // 📝 reviews list (from Firestore /reviews where toUserId == selectedUserId)
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [lastReviewDoc, setLastReviewDoc] = useState(null);
  const [hasMoreReviews, setHasMoreReviews] = useState(false);
  const [starFilter, setStarFilter] = useState(null); // null = All, 1-5 = specific star

  // 🐾 pets (owned + wishlist) from Firestore doc /reviews/{userId}
  const [ownedPets, setOwnedPets] = useState([]);
  const [wishlistPets, setWishlistPets] = useState([]);
  const [loadingPets, setLoadingPets] = useState(false);

  // 💼 trades list (from Firestore /trades_new where userId == selectedUserId)
  const [trades, setTrades] = useState([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [lastTradeDoc, setLastTradeDoc] = useState(null);
  const [hasMoreTrades, setHasMoreTrades] = useState(false);

  // 🖼️ Posts list (from Firestore /designPosts where userId == selectedUserId)
  const [posts, setPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [lastPostDoc, setLastPostDoc] = useState(null);
  const [hasMorePosts, setHasMorePosts] = useState(false);
  const [selectedPost, setSelectedPost] = useState(null);
  const [savedBadges, setSavedBadges] = useState({});
  const [userCreatedAtMs, setUserCreatedAtMs] = useState(0);

  // toggle details
  const [loadDetails, setLoadDetails] = useState(false);

  // ✅ State for fetched user data (roblox username, verified status, etc.)
  const [userData, setUserData] = useState(null);
  const [isBanned, setIsBanned] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [xpData, setXpData] = useState({ total: 0, level: 1 });
  const [showModTools, setShowModTools] = useState(false);
  const [activeCosmetics, setActiveCosmetics] = useState({ profileFrame: null, chatTextColor: null });

  // ✅ Admin Reason Modal States
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reasonActionType, setReasonActionType] = useState(null); 
  const [adminReason, setAdminReason] = useState('');

  // ✅ Reset all user-specific state when switching profiles to prevent stale data flash
  useEffect(() => {
    setRatingSummary(null);
    setLoadingRating(false);
    setUserBio(null);
    setFollowersCount(0);
    setCreatedAtText(null);
    setUserPoints(null);
    setGameWins(null);
    setReviews([]);
    setLastReviewDoc(null);
    setHasMoreReviews(false);
    setStarFilter(null);
    setOwnedPets([]);
    setWishlistPets([]);
    setTrades([]);
    setLastTradeDoc(null);
    setHasMoreTrades(false);
    setPosts([]);
    setLastPostDoc(null);
    setHasMorePosts(false);
    setSelectedPost(null);
    setSavedBadges({});
    setUserCreatedAtMs(0);
    setLoadDetails(false);
    setUserData(null);
    setIsBanned(false);
    setIsFollowing(false);
    setXpData({ total: 0, level: 1 });
    setShowModTools(false);
    setActiveCosmetics({ profileFrame: null, chatTextColor: null });
    setShowReasonModal(false);
    setReasonActionType(null);
    setAdminReason('');
  }, [selectedUserId]);

  // ✅ Fetch user data from Firebase
  useEffect(() => {
    if (!selectedUserId || !appdatabase) return;

    let isMounted = true;

    const fetchUserData = async () => {
      try {
        // ✅ OPTIMIZED: Fetch only specific fields instead of full user object
        // Added checks for isModerator and isAdmin
        const [
          robloxUsernameSnap,
          robloxUserIdSnap,
          robloxUsernameVerifiedSnap,
          isProSnap,
          lastGameWinAtSnap,
          isModeratorSnap,
          isAdminSnap,
          emailSnap,
          decodedEmailSnap,
          badgesSnap,
          avatarSnap,
          topBadgeSnap,
          isBabyModSnap,
          isTrustedSnap,
          isCMSRSnap
        ] = await Promise.all([
          get(ref(appdatabase, `users/${selectedUserId}/robloxUsername`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/robloxUserId`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/robloxUsernameVerified`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/isPro`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/lastGameWinAt`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/isModerator`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/admin`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/email`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/decodedEmail`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/badges`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/avatar`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/topBadge`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/isBabyMod`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/isTrusted`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/isCMSR`)).catch(() => null),
        ]);

        if (!isMounted) return;

        // ✅ Load saved badges
        if (badgesSnap?.exists()) {
          setSavedBadges(badgesSnap.val() || {});
        } else {
          setSavedBadges({});
        }

        // Check ban status if email is available from snapshot OR selectedUser
        const emailToCheck = emailSnap?.exists() ? emailSnap.val() : selectedUser?.email;
        if (emailToCheck) {
          const banStatus = await checkBanStatus(emailToCheck);
          if (isMounted) setIsBanned(banStatus.isBanned);
        } else {
          if (isMounted) setIsBanned(false);
        }

        // ✅ Extract values only if they exist
        const newUserData = {
          avatar: avatarSnap?.exists() ? avatarSnap.val() : null,
          robloxUsername: robloxUsernameSnap?.exists() ? robloxUsernameSnap.val() : null,
          robloxUserId: robloxUserIdSnap?.exists() ? robloxUserIdSnap.val() : null,
          robloxUsernameVerified: robloxUsernameVerifiedSnap?.exists() ? robloxUsernameVerifiedSnap.val() : false,
          isPro: isProSnap?.exists() ? isProSnap.val() : false,
          lastGameWinAt: lastGameWinAtSnap?.exists() ? lastGameWinAtSnap.val() : null,
          isModerator: isModeratorSnap?.exists() ? isModeratorSnap.val() : false,
          isAdmin: isAdminSnap?.exists() ? isAdminSnap.val() : false,
          email: emailSnap?.exists() ? emailSnap.val() : null,
          decodedEmail: decodedEmailSnap?.exists() ? decodedEmailSnap.val() : null,
          topBadge: topBadgeSnap?.exists() ? topBadgeSnap.val() : null,
          isBabyMod: isBabyModSnap?.exists() ? isBabyModSnap.val() : false,
          isTrusted: isTrustedSnap?.exists() ? isTrustedSnap.val() : false,
          isCMSR: isCMSRSnap?.exists() ? isCMSRSnap.val() : false,
        };

        setUserData(newUserData);
      } catch (error) {
        console.error('Error fetching user data in BottomDrawer:', error);
        if (isMounted) setUserData(null);
      }
    };

    fetchUserData();

    // ✅ Fetch XP data
    const fetchXP = async () => {
      if (!selectedUserId || !appdatabase) return;
      // Use user.id for own profile (consistent with MysteryEgg/shopUtils)
      const uid = (user?.id && (selectedUserId === user.id || selectedUserId === user.senderId)) ? user.id : selectedUserId;
      const data = await getUserXP(appdatabase, uid);
      setXpData(data);
    };
    fetchXP();



    // ✅ Fetch active cosmetics (profile frame + text color)
    // Reset immediately to prevent showing previous user's cosmetics
    const isOwnProfile = user?.id && (selectedUserId === user.id || selectedUserId === user.senderId);
    if (isOwnProfile) {
      const { getMyCosmetics } = require('../../Helper/cosmeticsCache');
      setActiveCosmetics(getMyCosmetics());
    } else {
      // ✅ Use embedded message data as instant preview (no flash)
      setActiveCosmetics({
        profileFrame: selectedUser?.profileFrame || null,
        chatTextColor: selectedUser?.chatTextColor || null,
        chatBubbleBg: selectedUser?.chatBubbleBg || null,
        tradeCardBg: null,
        profileBanner: null,
      });
      // Then fetch full cosmetics async (in case message data is stale)
      const fetchOtherCosmetics = async () => {
        try {
          const { getActiveCosmetics } = require('../../Engagement/shopUtils');
          const cosmetics = await getActiveCosmetics(appdatabase, selectedUserId);
          if (isMounted) setActiveCosmetics(cosmetics);
        } catch { /* graceful fallback */ }
      };
      fetchOtherCosmetics();
    }

    return () => {
      isMounted = false;
    };
  }, [selectedUserId, selectedUser, appdatabase]);

  // ✅ Merge selectedUser (message data) with fetched userData (RTDB)
  // userData wins for fresh data, selectedUser provides instant preview
  const mergedUser = useMemo(() => {
    if (!userData) return selectedUser;
    return {
      ...selectedUser,
      avatar: userData.avatar || selectedUser?.avatar,
      displayName: selectedUser?.displayName || selectedUser?.sender || selectedUser?.userName || 'Unknown User',
      robloxUsername: selectedUser?.robloxUsername || userData.robloxUsername,
      robloxUserId: selectedUser?.robloxUserId || userData.robloxUserId,
      robloxUsernameVerified: userData.robloxUsernameVerified ?? selectedUser?.robloxUsernameVerified ?? false,
      isPro: userData.isPro ?? selectedUser?.isPro ?? false,
      isModerator: userData.isModerator ?? selectedUser?.isModerator ?? false,
      isAdmin: userData.isAdmin ?? selectedUser?.isAdmin ?? false,
      email: selectedUser?.email || selectedUser?.decodedEmail || selectedUser?.user?.email || userData.email || userData.decodedEmail,
      topBadge: userData.topBadge || selectedUser?.topBadge || null,
      hasRecentGameWin: userData.lastGameWinAt
        ? (Date.now() - userData.lastGameWinAt <= 24 * 60 * 60 * 1000)
        : (selectedUser?.hasRecentGameWin ?? false),
      isBabyMod: userData.isBabyMod ?? selectedUser?.isBabyMod ?? false,
      isTrusted: userData.isTrusted ?? selectedUser?.isTrusted ?? false,
      isCMSR: userData.isCMSR ?? selectedUser?.isCMSR ?? false,
    };
  }, [selectedUser, userData]);

  // ✅ Check if current user is following this user (Firestore)
  useEffect(() => {
    if (!user?.id || !selectedUserId || !firestoreDB || user.id === selectedUserId) {
      setIsFollowing(false);
      return;
    }

    const checkFollowStatus = async () => {
      try {
        const followSnapshot = await getDocs(
          query(
            collection(firestoreDB, 'following'),
            where('followerId', '==', user.id),
            where('followingId', '==', selectedUserId)
          )
        );
        setIsFollowing(!followSnapshot.empty);
      } catch (err) {
        console.error('Error checking follow status:', err);
        setIsFollowing(false);
      }
    };

    checkFollowStatus();
  }, [user?.id, selectedUserId, firestoreDB]);

  // ✅ Follow / Unfollow toggle (Firestore)
  const handleFollowToggle = useCallback(async () => {
    if (!user?.id || !selectedUserId || !firestoreDB || user.id === selectedUserId) return;

    setFollowLoading(true);
    try {
      if (isFollowing) {
        // Unfollow - find and delete the document
        const followSnapshot = await getDocs(
          query(
            collection(firestoreDB, 'following'),
            where('followerId', '==', user.id),
            where('followingId', '==', selectedUserId)
          )
        );

        if (!followSnapshot.empty) {
          // Delete all matching docs (should be just one)
          const batch = firestoreDB.batch ? firestoreDB.batch() : null;
          if (batch) {
            followSnapshot.docs.forEach(docSnap => batch.delete(docSnap.ref));
            await batch.commit();
          } else {
            // Fallback if batch not available
            await Promise.all(followSnapshot.docs.map(docSnap =>
              deleteDoc(doc(firestoreDB, 'following', docSnap.id))
            ));
          }
        }
        setIsFollowing(false);
        triggerHapticFeedback('impactLight');
      } else {
        // Follow - create a new document
        await setDoc(doc(collection(firestoreDB, 'following')), {
          followerId: user.id,
          followingId: selectedUserId,
          createdAt: serverTimestamp(),
        });
        setIsFollowing(true);
        triggerHapticFeedback('notificationSuccess');
        // 🏅 Check Influencer badge for the followed user (fire-and-forget)
        checkInfluencerBadge(appdatabase, firestoreDB, selectedUserId);
      }
    } catch (err) {
      console.error('Error toggling follow:', err);
      Alert.alert('Error', 'Could not update follow status.');
    } finally {
      setFollowLoading(false);
    }
  }, [user?.id, selectedUserId, firestoreDB, isFollowing, triggerHapticFeedback]);

  // ─────────────────────────────────────────────
  // Clipboard
  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t('value.copy'), t('value.copy_success'));
    mixpanel.track('Code UserName', { UserName: code });
  };

  // ─────────────────────────────────────────────
  // Open Roblox Profile
  const handleOpenRobloxProfile = useCallback(async () => {
    const robloxUsername = mergedUser?.robloxUsername;
    const robloxUserId = mergedUser?.robloxUserId;

    if (!robloxUsername && !robloxUserId) {
      return;
    }

    triggerHapticFeedback('impactLight');

    try {
      // Construct URLs
      let robloxAppUrl = null;
      let robloxWebUrl = null;

      if (robloxUserId) {
        // Use userId for app deep link (most reliable)
        robloxAppUrl = `roblox://users/${robloxUserId}`;
        // Use search URL format for web (works with username)
        robloxWebUrl = robloxUsername
          ? `https://www.roblox.com/search/users?keyword=${encodeURIComponent(robloxUsername)}`
          : `https://www.roblox.com/users/${robloxUserId}`;
      } else if (robloxUsername) {
        // Use search URL format with username
        robloxWebUrl = `https://www.roblox.com/search/users?keyword=${encodeURIComponent(robloxUsername)}`;
      }

      if (!robloxWebUrl) {
        Alert.alert(t('home.alert.error'), t('profile.roblox_app_error'));
        return;
      }

      // Try to open in Roblox app first (only if we have userId)
      if (robloxAppUrl) {
        try {
          const canOpenApp = await Linking.canOpenURL(robloxAppUrl);
          if (canOpenApp) {
            await Linking.openURL(robloxAppUrl);
            return; // Successfully opened in app
          }
        } catch (appError) {
          console.log('Could not open in Roblox app, falling back to browser:', appError);
        }
      }

      // Fallback to browser with search URL
      await Linking.openURL(robloxWebUrl);
    } catch (error) {
      console.error('Error opening Roblox profile:', error);
      Alert.alert(t('home.alert.error'), t('profile.roblox_error'));
    }
  }, [mergedUser?.robloxUsername, mergedUser?.robloxUserId, triggerHapticFeedback, t]);

  // ✅ Memoize formatCreatedAt — shows readable date (e.g. "Jan 15, 2024")
  const formatCreatedAt = useCallback((timestamp) => {
    if (!timestamp) return null;

    const now = Date.now();
    if (timestamp > now + 86400000) return null; // more than 1 day in the future = invalid

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return null;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, []);

  // ✅ Memoize getTimestampMs
  const getTimestampMs = useCallback((ts) => {
    if (!ts) return null;

    // Firestore Timestamp instance
    if (typeof ts.toDate === 'function') {
      return ts.toDate().getTime();
    }

    // { seconds, nanoseconds }
    if (typeof ts.seconds === 'number') {
      return ts.seconds * 1000 + Math.floor((ts.nanoseconds || 0) / 1e6);
    }

    // already a number?
    if (typeof ts === 'number') return ts;

    return null;
  }, []);

  // ─────────────────────────────────────────────
  // Ban / Unban
  const handleBanToggle = async () => {
    if (!selectedUserId) return;

    const action = isBlock ? t('chat.unblock') : t('chat.block');

    Alert.alert(
      `${action}`,
      `${t('chat.are_you_sure')} ${action.toLowerCase()} ${userName}?`,
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: action,
          style: 'destructive',
          onPress: async () => {
            try {
              let updatedBannedUsers;

              // ✅ Safety check for array
              const currentBanned = Array.isArray(bannedUsers) ? bannedUsers : [];
              if (isBlock) {
                updatedBannedUsers = currentBanned.filter(
                  (id) => id !== selectedUserId,
                );
              } else {
                updatedBannedUsers = [...currentBanned, selectedUserId];
              }

              await updateLocalState('bannedUsers', updatedBannedUsers);

              // ✅ Sync to RTDB for server-side notification filtering
              if (user?.id && appdatabase) {
                const blockedRef = ref(appdatabase, `users/${user.id}/blocked_users/${selectedUserId}`);
                if (isBlock) {
                  // Unblocking — remove from DB
                  await set(blockedRef, null);
                } else {
                  // Blocking — add to DB
                  await set(blockedRef, true);
                }
              }

              setTimeout(() => {
                showSuccessMessage(
                  t('home.alert.success'),
                  isBlock
                    ? `${userName} ${t('chat.user_unblocked')}`
                    : `${userName} ${t('chat.user_blocked')}`,
                );
              }, 100);
            } catch (error) {
              console.error('❌ Error toggling ban status:', error);
            }
          },
        },
      ],
    );
  };
  // ─────────────────────────────────────────────
  // Moderator Actions
  const handleApplyStrike = async (strikeCount) => {
    if (!mergedUser?.email) {
      // Try to fetch email from RTDB as fallback
      if (selectedUserId && appdatabase) {
        try {
          const emailSnap = await get(ref(appdatabase, `users/${selectedUserId}/email`));
          if (emailSnap.exists() && emailSnap.val()) {
            // Update mergedUser isn't possible from here, so use it directly
            setReasonActionType({ type: 'strike', value: strikeCount, email: emailSnap.val() });
            setAdminReason('');
            setShowReasonModal(true);
            return;
          }
        } catch (e) {
          console.log('[MOD] Fallback email lookup failed:', e);
        }
      }
      Alert.alert("Error", "User email not found.");
      return;
    }
    setReasonActionType({ type: 'strike', value: strikeCount });
    setAdminReason('');
    setShowReasonModal(true);
  };

  const handleMuteUser = async (minutes) => {
    if (!mergedUser?.email) {
      if (selectedUserId && appdatabase) {
        try {
          const emailSnap = await get(ref(appdatabase, `users/${selectedUserId}/email`));
          if (emailSnap.exists() && emailSnap.val()) {
            setReasonActionType({ type: 'mute', value: minutes, email: emailSnap.val() });
            setAdminReason('');
            setShowReasonModal(true);
            return;
          }
        } catch (e) {
          console.log('[MOD] Fallback email lookup failed:', e);
        }
      }
      Alert.alert("Error", "User email not found.");
      return;
    }
    setReasonActionType({ type: 'mute', value: minutes });
    setAdminReason('');
    setShowReasonModal(true);
  };

  const handleBanUser = async () => {
    if (!mergedUser?.email) {
      if (selectedUserId && appdatabase) {
        try {
          const emailSnap = await get(ref(appdatabase, `users/${selectedUserId}/email`));
          if (emailSnap.exists() && emailSnap.val()) {
            setReasonActionType({ type: 'ban', email: emailSnap.val() });
            setAdminReason('');
            setShowReasonModal(true);
            return;
          }
        } catch (e) {
          console.log('[MOD] Fallback email lookup failed:', e);
        }
      }
      Alert.alert("Error", "User email not found.");
      return;
    }
    setReasonActionType({ type: 'ban' });
    setAdminReason('');
    setShowReasonModal(true);
  };

  const confirmAdminAction = async () => {
    if (!reasonActionType) return;
    setShowReasonModal(false);

    const currentUser = auth().currentUser;
    const bannerInfo = {
      id: currentUser?.uid,
      displayName: currentUser?.displayName || 'Admin',
      avatar: currentUser?.photoURL
    };
    
    // Use fallback email from reasonActionType if mergedUser.email is missing
    const actionEmail = mergedUser?.email || reasonActionType.email;
    if (!actionEmail) {
      Alert.alert('Error', 'User email not found.');
      setReasonActionType(null);
      return;
    }

    // Fallback default reason logic
    const finalReason = adminReason.trim() !== '' ? adminReason.trim() : undefined;

    if (reasonActionType.type === 'strike') {
      const strikeCount = reasonActionType.value;
      const success = await setUserStrike(
        actionEmail, 
        strikeCount, 
        currentUser?.uid, 
        true, 
        bannerInfo, 
        mergedUser, 
        finalReason
      );
      if (success) setIsBanned(true);
      
    } else if (reasonActionType.type === 'mute') {
      const minutes = reasonActionType.value;
      const success = await muteUser(
        actionEmail, 
        minutes, 
        mergedUser, 
        bannerInfo, 
        true, 
        finalReason
      );
      if (success) setIsBanned(true);
      
    } else if (reasonActionType.type === 'ban') {
      const success = await banUserwithEmail(
        actionEmail, 
        isAdmin, 
        selectedUserId, 
        mergedUser, 
        bannerInfo, 
        finalReason
      );
      if (success) setIsBanned(true);
    }
    
    setReasonActionType(null);
  };

  const handleUnbanUser = async () => {
    if (!mergedUser?.email) return;

    const confirm = await new Promise((resolve) => {
      Alert.alert(
        "Unban User",
        `Are you sure you want to unban ${userName}?`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Unban", onPress: () => resolve(true) }
        ]
      );
    });

    if (!confirm) return;

    const success = await unbanUserWithEmail(mergedUser.email);
    if (success) setIsBanned(false);
  };

  const handlePromoteModerator = async () => {
    const confirm = await new Promise((resolve) => {
      Alert.alert(
        "Promote to Moderator",
        `Are you sure you want to make ${userName} a Moderator?`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Promote", onPress: () => resolve(true) }
        ]
      );
    });

    if (!confirm) return;

    const success = await makeModerator(selectedUserId);
    if (success) {
      setUserData(prev => ({ ...prev, isModerator: true }));
    }
  };

  const handleDemoteModerator = async () => {
    const confirm = await new Promise((resolve) => {
      Alert.alert(
        "Remove Moderator",
        `Are you sure you want to remove Moderator status from ${userName}?`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Remove", style: "destructive", onPress: () => resolve(true) }
        ]
      );
    });

    if (!confirm) return;

    const success = await removeModerator(selectedUserId);
    if (success) {
      setUserData(prev => ({ ...prev, isModerator: false }));
    }
  };



  // ─────────────────────────────────────────────
  // Start chat
  const handleStartChat = () => {
    if (startChat) startChat();
  };

  // ── Junior Mod handlers ──
  const OWNER_ID = 'DNvBQC5ySWP8QiJNGpIvqd9DSWB2';
  const canManageBabyMod = isAdmin || user?.id === OWNER_ID;
  const canManageBadges = isAdmin || !!user?.isModerator;

  const handleMakeBabyMod = async () => {
    if (!selectedUserId || !appdatabase) return;
    const confirm = await new Promise((resolve) => {
      Alert.alert('Make Junior Mod', `Make ${userName} a Junior Mod? They can only mute users for up to 2 hours.`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirm', onPress: () => resolve(true) }
      ]);
    });
    if (!confirm) return;
    try {
      await set(ref(appdatabase, `users/${selectedUserId}/isBabyMod`), true);
      setUserData(prev => ({ ...prev, isBabyMod: true }));
      Alert.alert('Success', `${userName} is now a Junior Mod`);
    } catch (err) {
      Alert.alert('Error', 'Failed to set Junior Mod');
    }
  };

  const handleRemoveBabyMod = async () => {
    if (!selectedUserId || !appdatabase) return;
    const confirm = await new Promise((resolve) => {
      Alert.alert('Remove Junior Mod', `Remove Junior Mod role from ${userName}?`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Remove', style: 'destructive', onPress: () => resolve(true) }
      ]);
    });
    if (!confirm) return;
    try {
      await set(ref(appdatabase, `users/${selectedUserId}/isBabyMod`), null);
      setUserData(prev => ({ ...prev, isBabyMod: false }));
      Alert.alert('Success', `${userName} is no longer a Junior Mod`);
    } catch (err) {
      Alert.alert('Error', 'Failed to remove Junior Mod');
    }
  };

  // ── Trusted badge handlers ──
  const handleMakeTrusted = async () => {
    if (!selectedUserId || !appdatabase) return;
    const confirm = await new Promise((resolve) => {
      Alert.alert('Make Trusted', `Give ${userName} the Trusted badge?`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirm', onPress: () => resolve(true) }
      ]);
    });
    if (!confirm) return;
    try {
      await set(ref(appdatabase, `users/${selectedUserId}/isTrusted`), true);
      setUserData(prev => ({ ...prev, isTrusted: true }));
      Alert.alert('Success', `${userName} now has the Trusted badge`);
    } catch (err) {
      Alert.alert('Error', 'Failed to set Trusted badge');
    }
  };

  const handleRemoveTrusted = async () => {
    if (!selectedUserId || !appdatabase) return;
    const confirm = await new Promise((resolve) => {
      Alert.alert('Remove Trusted', `Remove the Trusted badge from ${userName}?`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Remove', style: 'destructive', onPress: () => resolve(true) }
      ]);
    });
    if (!confirm) return;
    try {
      await set(ref(appdatabase, `users/${selectedUserId}/isTrusted`), null);
      setUserData(prev => ({ ...prev, isTrusted: false }));
      Alert.alert('Success', `${userName} no longer has the Trusted badge`);
    } catch (err) {
      Alert.alert('Error', 'Failed to remove Trusted badge');
    }
  };

  // ── CMSR badge handlers ──
  const handleMakeCMSR = async () => {
    if (!selectedUserId || !appdatabase) return;
    const confirm = await new Promise((resolve) => {
      Alert.alert('Make Commissioner', `Give ${userName} the CMSR badge?`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirm', onPress: () => resolve(true) }
      ]);
    });
    if (!confirm) return;
    try {
      await set(ref(appdatabase, `users/${selectedUserId}/isCMSR`), true);
      setUserData(prev => ({ ...prev, isCMSR: true }));
      Alert.alert('Success', `${userName} now has the CMSR badge`);
    } catch (err) {
      Alert.alert('Error', 'Failed to set CMSR badge');
    }
  };

  const handleRemoveCMSR = async () => {
    if (!selectedUserId || !appdatabase) return;
    const confirm = await new Promise((resolve) => {
      Alert.alert('Remove Commissioner', `Remove the CMSR badge from ${userName}?`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Remove', style: 'destructive', onPress: () => resolve(true) }
      ]);
    });
    if (!confirm) return;
    try {
      await set(ref(appdatabase, `users/${selectedUserId}/isCMSR`), null);
      setUserData(prev => ({ ...prev, isCMSR: false }));
      Alert.alert('Success', `${userName} no longer has the CMSR badge`);
    } catch (err) {
      Alert.alert('Error', 'Failed to remove CMSR badge');
    }
  };

  // Reset when drawer closes
  useEffect(() => {
    if (!isVisible) {
      setLoadDetails(false);
      setRatingSummary(null);
      setUserBio(null);
      setFollowersCount(0); // ✅ Reset count
      setOwnedPets([]);
      setWishlistPets([]);
      setReviews([]);
      lastReviewDocRef.current = null;
      isLoadingRef.current = false;
      setLastReviewDoc(null);
      setHasMoreReviews(false);
      setStarFilter(null);
      setCreatedAtText(null);
      setUserPoints(null);
      setGameWins(null);
      setUserData(null); // ✅ Clear fetched user data
      setShowModTools(false); // ✅ Hide mod tools on close
      setTrades([]);
      setLastTradeDoc(null);
      setHasMoreTrades(false);
    }
  }, [isVisible]);

  // ─────────────────────────────────────────────
  // Load rating summary + joined
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;

    let isMounted = true;

    const loadRatingSummary = async () => {
      setLoadingRating(true);
      try {
        // ✅ OPTIMIZED: Fetch only specific fields instead of full user object
        // ✅ MIGRATED: Read rating summary from Firestore user_ratings_summary (single source of truth)
        // 📅 2026-03-13: bio/ownedPets/wishlistPets migrated from reviews/{userId} → user_profiles/{userId}.
        //    🔮 FUTURE CLEANUP: Once all users updated, remove the reviewDocSnap fetch and its fallback reads below.
        const [summaryDocSnap, createdSnap, rewardPointsSnap, profileDocSnap, reviewDocSnap, countSnapshot] = await Promise.all([
          getDoc(doc(firestoreDB, 'user_ratings_summary', selectedUserId)),
          get(ref(appdatabase, `users/${selectedUserId}/createdAt`)),
          get(ref(appdatabase, `users/${selectedUserId}/xp/total`)).catch(() => null),
          getDoc(doc(firestoreDB, 'user_profiles', selectedUserId)),
          // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this line once all users updated
          getDoc(doc(firestoreDB, 'reviews', selectedUserId)),
          getCountFromServer(
            query(collection(firestoreDB, 'following'), where('followingId', '==', selectedUserId))
          ).catch(err => { console.error("Error fetching followers:", err); return { data: () => ({ count: 0 }) }; }),
        ]);

        if (!isMounted) return;

        // ✅ Set Follower Count
        if (countSnapshot && typeof countSnapshot.data === 'function') {
          setFollowersCount(countSnapshot.data().count);
        } else if (countSnapshot && countSnapshot.data) {
          // fallback for catch return
          setFollowersCount(0);
        }


        // ✅ FIRESTORE ONLY: Load rating summary from user_ratings_summary
        if (summaryDocSnap.exists()) {
          const summaryData = summaryDocSnap.data();
          if (summaryData) {
            setRatingSummary({
              value: Number(summaryData.averageRating || 0),
              count: Number(summaryData.count || 0),
            });
          }
        } else {
          // ✅ COST-OPTIMIZED: Only recalculate if summary truly missing (one-time per user)
          // Check RTDB first (free) before expensive Firestore query
          const avgSnap = await get(ref(appdatabase, `averageRatings/${selectedUserId}`));
          if (avgSnap.exists()) {
            // ✅ RTDB has data - migrate it (cheap: 1 RTDB read + 1 Firestore write)
            const avgData = avgSnap.val();
            const avgValue = Number(avgData.value || 0);
            const avgCount = Number(avgData.count || 0);

            setRatingSummary({
              value: avgValue,
              count: avgCount,
            });

            if (avgValue > 0 || avgCount > 0) {
              setDoc(
                doc(firestoreDB, 'user_ratings_summary', selectedUserId),
                {
                  averageRating: avgValue,
                  count: avgCount,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              ).catch(err => console.error('Error migrating rating summary to Firestore:', err));
            }
          } else {
            // ✅ Only query Firestore reviews if RTDB also has no data (expensive operation)
            // This ensures we don't waste reads if RTDB migration is possible
            try {
              const reviewsQuery = query(
                collection(firestoreDB, 'reviews'),
                where('toUserId', '==', selectedUserId),
                limit(100) // ✅ COST LIMIT: Max 100 reviews per calculation (prevents huge reads)
              );
              const reviewsSnapshot = await getDocs(reviewsQuery);

              if (!reviewsSnapshot.empty) {
                let totalRating = 0;
                let ratingCount = 0;

                reviewsSnapshot.docs.forEach((doc) => {
                  const reviewData = doc.data();
                  if (reviewData.rating && typeof reviewData.rating === 'number') {
                    totalRating += reviewData.rating;
                    ratingCount += 1;
                  }
                });

                if (ratingCount > 0) {
                  const calculatedAverage = totalRating / ratingCount;

                  setRatingSummary({
                    value: parseFloat(calculatedAverage.toFixed(2)),
                    count: ratingCount,
                  });

                  // ✅ Create summary (prevents future recalculations)
                  await setDoc(
                    doc(firestoreDB, 'user_ratings_summary', selectedUserId),
                    {
                      averageRating: parseFloat(calculatedAverage.toFixed(2)),
                      count: ratingCount,
                      updatedAt: serverTimestamp(),
                    },
                    { merge: true }
                  );
                } else {
                  setRatingSummary(null);
                }
              } else {
                setRatingSummary(null);
              }
            } catch (error) {
              console.error('Error calculating summary from reviews:', error);
              setRatingSummary(null);
            }
          }
        }

        // 📅 2026-03-13: Bio migrated from reviews/{userId} → user_profiles/{userId}.
        //    🔮 FUTURE CLEANUP: Once all users updated, remove the reviewDocSnap fallback block below.
        let bioValue = null;
        if (profileDocSnap.exists()) {
          const profileData = profileDocSnap.data();
          if (profileData && profileData.bio && typeof profileData.bio === 'string' && profileData.bio.trim()) {
            bioValue = profileData.bio.trim();
          }
        }
        // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this block once all users updated
        if (!bioValue && reviewDocSnap.exists()) {
          const reviewData = reviewDocSnap.data();
          if (reviewData && reviewData.bio && typeof reviewData.bio === 'string' && reviewData.bio.trim()) {
            bioValue = reviewData.bio.trim();
          }
        }
        setUserBio(bioValue || t('profile.bio_default'));

        if (createdSnap.exists()) {
          const raw = createdSnap.val();
          let ts;
          if (typeof raw === 'number') {
            // Detect seconds vs milliseconds: timestamps < 1e12 are in seconds
            ts = raw < 1e12 ? raw * 1000 : raw;
          } else {
            ts = Date.parse(raw);
          }
          if (!Number.isNaN(ts)) {
            setCreatedAtText(formatCreatedAt(ts));
            setUserCreatedAtMs(ts);
          } else {
            setCreatedAtText(null);
          }
        } else {
          // ✅ Fallback: If createdAt is missing, try lastActivity as an approximation
          try {
            const lastActivitySnap = await get(ref(appdatabase, `users/${selectedUserId}/lastActivity`));
            if (lastActivitySnap.exists()) {
              const raw = lastActivitySnap.val();
              let ts = typeof raw === 'number'
                ? (raw < 1e12 ? raw * 1000 : raw)
                : Date.parse(raw);
              if (!Number.isNaN(ts)) {
                setCreatedAtText(formatCreatedAt(ts));
                setUserCreatedAtMs(ts);
              } else {
                setCreatedAtText(null);
              }
            } else {
              setCreatedAtText(null);
            }
          } catch {
            setCreatedAtText(null);
          }
        }

        // ✅ Load user XP (RTDB)
        if (rewardPointsSnap?.exists()) {
          setUserPoints(rewardPointsSnap.val() || 0);
        } else {
          setUserPoints(0);
        }

        // ✅ Load game wins (Firestore game_stats)
        if (firestoreDB && selectedUserId) {
          const statsDoc = await getDoc(doc(firestoreDB, 'game_stats', selectedUserId));
          if (statsDoc.exists) {
            const stats = statsDoc.data() || {};
            setGameWins(stats.petGameWins || 0);
          } else {
            setGameWins(0);
          }
        } else {
          setGameWins(0);
        }
      } catch (err) {
        console.log('Rating load error:', err);
        if (isMounted) {
          setRatingSummary(null);
          setCreatedAtText(null);
          setUserPoints(null);
          setGameWins(null);
        }
      } finally {
        if (isMounted) setLoadingRating(false);
      }
    };

    loadRatingSummary();

    return () => {
      isMounted = false;
    };
  }, [isVisible, selectedUserId, loadDetails, appdatabase, firestoreDB]);

  // ─────────────────────────────────────────────
  // Load pets
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;

    let isMounted = true;

    const loadPets = async () => {
      setLoadingPets(true);
      try {
        // 📅 2026-03-13: Pets migrated from reviews/{userId} → user_profiles/{userId}.
        //    🔮 FUTURE CLEANUP: Once all users updated, remove the reviews fallback read below.
        let docSnap = await getDoc(
          doc(firestoreDB, 'user_profiles', selectedUserId),
        );
        // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this fallback once all users updated
        if (!docSnap.exists) {
          docSnap = await getDoc(
            doc(firestoreDB, 'reviews', selectedUserId),
          );
        }

        if (!isMounted) return;

        if (docSnap.exists) {
          const data = docSnap.data() || {};
          setOwnedPets(Array.isArray(data.ownedPets) ? data.ownedPets : []);
          setWishlistPets(
            Array.isArray(data.wishlistPets) ? data.wishlistPets : [],
          );
        } else {
          setOwnedPets([]);
          setWishlistPets([]);
        }
      } catch (err) {
        console.log('Pets load error:', err);
        if (isMounted) {
          setOwnedPets([]);
          setWishlistPets([]);
        }
      } finally {
        if (isMounted) setLoadingPets(false);
      }
    };

    loadPets();

    return () => {
      isMounted = false;
    };
  }, [isVisible, selectedUserId, loadDetails, firestoreDB]);

  // ─────────────────────────────────────────────
  // Load reviews (paged) — ✅ Memoized with useCallback
  // ✅ Use refs to track state and avoid dependency issues
  const lastReviewDocRef = useRef(null);
  const isLoadingRef = useRef(false);

  const loadReviews = useCallback(async (reset = false, ratingFilter = null) => {
    if (!firestoreDB || !selectedUserId) return;

    // ✅ Prevent duplicate calls using ref (avoids dependency issues)
    if (isLoadingRef.current) {
      console.log('🔄 [BottomDrawer] Already loading reviews, skipping...');
      return;
    }

    isLoadingRef.current = true;
    setLoadingReviews(true);
    try {
      // ✅ Use larger page size when a star filter is active
      const pageSize = ratingFilter ? FILTERED_REVIEWS_PAGE_SIZE : REVIEWS_PAGE_SIZE;

      // ✅ Build query constraints based on filter
      const constraints = [
        collection(firestoreDB, 'reviews'),
        where('toUserId', '==', selectedUserId),
      ];

      // ⭐ Add rating filter if active
      if (ratingFilter) {
        constraints.push(where('rating', '==', ratingFilter));
      }

      constraints.push(orderBy('updatedAt', 'desc'));

      if (!reset && lastReviewDocRef.current) {
        constraints.push(startAfter(lastReviewDocRef.current));
      }

      constraints.push(limit(pageSize + 1)); // Fetch one extra to check if more exist

      const q = query(...constraints);
      const snap = await getDocs(q);

      // ✅ Check if we got more than page size (means there are more reviews)
      const hasMoreResults = snap.docs.length > pageSize;

      // ✅ Only take pageSize documents (discard the extra one)
      const docsToUse = snap.docs.slice(0, pageSize);

      const batch = docsToUse.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
        };
      });

      setReviews((prev) => (reset ? batch : [...prev, ...batch]));

      // ✅ Use the last document from the actual batch (not the extra one)
      const newLastDoc = docsToUse[docsToUse.length - 1] || null;
      lastReviewDocRef.current = newLastDoc;
      setLastReviewDoc(newLastDoc);

      // ✅ hasMoreReviews is true only if we got more results than page size
      setHasMoreReviews(hasMoreResults);
    } catch (err) {
      console.log('Reviews load error:', err);
      if (reset) setReviews([]);
      setHasMoreReviews(false);
    } finally {
      isLoadingRef.current = false;
      setLoadingReviews(false);
    }
  }, [firestoreDB, selectedUserId]); // ✅ Removed loadingReviews from deps to prevent re-renders

  // initial reviews load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    // reset pagination when details open
    lastReviewDocRef.current = null;
    setLastReviewDoc(null);
    setHasMoreReviews(false);
    loadReviews(true, starFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]); // ✅ Removed loadReviews from deps to prevent re-renders

  // ⭐ Re-fetch reviews when star filter changes
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    // Reset pagination and re-fetch with new filter
    lastReviewDocRef.current = null;
    setLastReviewDoc(null);
    setHasMoreReviews(false);
    setReviews([]);
    loadReviews(true, starFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starFilter]);

  // ✅ Memoize handleLoadMoreReviews
  const handleLoadMoreReviews = useCallback(() => {
    if (!hasMoreReviews || loadingReviews) return;
    loadReviews(false, starFilter);
  }, [hasMoreReviews, loadingReviews, loadReviews, starFilter]);

  // ─────────────────────────────────────────────
  // Load trades (paged) — ✅ Initially show 1, then load 2 by 2
  const INITIAL_TRADES_SIZE = 1; // Show 1 trade initially
  const LOAD_MORE_TRADES_SIZE = 2; // Load 2 trades at a time when loading more

  const loadTrades = useCallback(async (reset = false) => {
    if (!firestoreDB || !selectedUserId) return;
    if (loadingTrades) return;

    setLoadingTrades(true);
    try {
      // Determine the limit based on whether it's initial load or load more
      const limitSize = reset ? INITIAL_TRADES_SIZE : LOAD_MORE_TRADES_SIZE;

      let q;
      if (!reset && lastTradeDoc) {
        q = query(
          collection(firestoreDB, 'trades_new'),
          where('userId', '==', selectedUserId),
          orderBy('timestamp', 'desc'),
          startAfter(lastTradeDoc),
          limit(limitSize + 1), // Fetch one extra to check if more exist
        );
      } else {
        q = query(
          collection(firestoreDB, 'trades_new'),
          where('userId', '==', selectedUserId),
          orderBy('timestamp', 'desc'),
          limit(limitSize + 1), // Fetch one extra to check if more exist
        );
      }

      const snap = await getDocs(q);

      // Check if we got more than page size
      const hasMoreResults = snap.docs.length > limitSize;

      // Only take limitSize documents (discard the extra one)
      const docsToUse = snap.docs.slice(0, limitSize);

      const batch = docsToUse.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setTrades((prev) => (reset ? batch : [...prev, ...batch]));

      const newLastDoc = docsToUse[docsToUse.length - 1] || null;
      setLastTradeDoc(newLastDoc);
      setHasMoreTrades(hasMoreResults);
    } catch (err) {
      console.error('Trades load error:', err);
      if (reset) setTrades([]);
      setHasMoreTrades(false);
    } finally {
      setLoadingTrades(false);
    }
  }, [firestoreDB, selectedUserId, lastTradeDoc, loadingTrades]);

  // Initial trades load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    setLastTradeDoc(null);
    setHasMoreTrades(false);
    loadTrades(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]);

  // ✅ Memoize handleLoadMoreTrades
  const handleLoadMoreTrades = useCallback(() => {
    if (!hasMoreTrades || loadingTrades) return;
    loadTrades(false);
  }, [hasMoreTrades, loadingTrades, loadTrades]);

  // ─────────────────────────────────────────────
  // Load Posts (paged) — ✅ Initially show 3, then load 3 by 3
  const INITIAL_POSTS_SIZE = 3;
  const LOAD_MORE_POSTS_SIZE = 3;

  const loadPosts = useCallback(async (reset = false) => {
    if (!firestoreDB || !selectedUserId) return;
    if (loadingPosts) return;

    setLoadingPosts(true);
    try {
      const limitSize = reset ? INITIAL_POSTS_SIZE : LOAD_MORE_POSTS_SIZE;
      let q;

      if (!reset && lastPostDoc) {
        q = query(
          collection(firestoreDB, 'designPosts'),
          where('userId', '==', selectedUserId),
          orderBy('createdAt', 'desc'),
          startAfter(lastPostDoc),
          limit(limitSize + 1)
        );
      } else {
        q = query(
          collection(firestoreDB, 'designPosts'),
          where('userId', '==', selectedUserId),
          orderBy('createdAt', 'desc'),
          limit(limitSize + 1)
        );
      }

      const snap = await getDocs(q);
      const hasMoreResults = snap.docs.length > limitSize;
      const docsToUse = snap.docs.slice(0, limitSize);

      const batch = docsToUse.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      setPosts((prev) => (reset ? batch : [...prev, ...batch]));
      setLastPostDoc(docsToUse[docsToUse.length - 1] || null);
      setHasMorePosts(hasMoreResults);
    } catch (err) {
      console.error('Posts load error:', err);
      if (reset) setPosts([]);
      setHasMorePosts(false);
    } finally {
      setLoadingPosts(false);
    }
  }, [firestoreDB, selectedUserId, lastPostDoc, loadingPosts]);

  // Initial posts load when opening details
  useEffect(() => {
    if (!isVisible || !selectedUserId || !loadDetails) return;
    setLastPostDoc(null);
    setHasMorePosts(false);
    loadPosts(true);
  }, [isVisible, selectedUserId, loadDetails]);

  // Handle Load More Posts
  const handleLoadMorePosts = useCallback(() => {
    if (!hasMorePosts || loadingPosts) return;
    loadPosts(false);
  }, [hasMorePosts, loadingPosts, loadPosts]);

  // ─────────────────────────────────────────────
  // Helpers for rendering - ✅ Memoized

  const renderStars = useCallback((value) => {
    const rounded = Math.round(value || 0);
    const full = '★'.repeat(Math.min(rounded, 5));
    const empty = '☆'.repeat(Math.max(0, 5 - rounded));
    return (
      <Text style={{ color: '#ffb700be', fontSize: 14, fontWeight: '600' }}>
        {full}
        <Text style={{ color: '#999' }}>{empty}</Text>
      </Text>
    );
  }, []);

  const renderPetBubble = useCallback((pet, index) => {
    // ✅ Safety checks
    if (!pet || typeof pet !== 'object') return null;

    const valueType = (pet.valueType || 'd').toLowerCase();
    const NON_PET_TYPES = ['EGGS', 'VEHICLES', 'PET WEAR', 'OTHER', 'TOYS', 'FOOD', 'STROLLERS', 'GIFTS'];
    const isPet = !NON_PET_TYPES.includes((pet.category || '').toUpperCase());
    let rarityBg = '#FF6666';
    if (valueType === 'n') rarityBg = '#2ecc71';
    if (valueType === 'm') rarityBg = '#9b59b6';

    return (
      <View
        key={`${pet.id || pet.name || index}-${index}`}
        style={{
          width: 42,
          height: 42,
          marginRight: 6,
          borderRadius: 10,
          overflow: 'hidden',
          backgroundColor: c.bg,
        }}
      >
        <Image
          source={{ uri: resolvePetImageUrl(pet) }}
          style={{ width: '100%', height: '100%' }}
        />
        {isPet && (
          <View
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            {/* Rarity badge */}
            <View
              style={{
                paddingHorizontal: 3,
                paddingVertical: 1,
                borderRadius: 999,
                backgroundColor: rarityBg,
                marginLeft: 2,
              }}
            >
              <Text
                style={{
                  fontSize: 8,
                  fontWeight: '700',
                  color: '#fff',
                }}
              >
                {valueType.toUpperCase()}
              </Text>
            </View>

            {/* Fly badge */}
            {pet.isFly && (
              <View
                style={{
                  paddingHorizontal: 3,
                  paddingVertical: 1,
                  borderRadius: 999,
                  backgroundColor: '#3498db',
                  marginLeft: 2,
                }}
              >
                <Text
                  style={{ fontSize: 8, fontWeight: '700', color: '#fff' }}
                >
                  F
                </Text>
              </View>
            )}

            {/* Ride badge */}
            {pet.isRide && (
              <View
                style={{
                  paddingHorizontal: 3,
                  paddingVertical: 1,
                  borderRadius: 999,
                  backgroundColor: '#e74c3c',
                  marginLeft: 2,
                }}
              >
                <Text
                  style={{ fontSize: 8, fontWeight: '700', color: '#fff' }}
                >
                  R
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    );
  }, [isDarkMode]);

  // ✅ Parse values data for image lookup
  const parsedValuesData = useMemo(() => {
    try {
      const rawData = localState.data;
      if (!rawData) return [];

      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch (error) {
      console.error("❌ Error parsing data:", error);
      return [];
    }
  }, [localState.data]);

  // ── Resolve pet image URL (handles relative paths) ──
  const resolvePetImageUrl = useCallback((pet) => {
    const raw = pet?.imageUrl || pet?.image;
    if (!raw) {
      // Try finding image from values data by name
      if (pet?.name && parsedValuesData.length > 0) {
        const found = parsedValuesData.find(
          (i) => (i?.name || '').toLowerCase() === pet.name.toLowerCase()
        );
        if (found?.image) {
          const base = (localState.imgurl || '').replace(/"/g, '').replace(/\/$/, '');
          const path = found.image.startsWith('/') ? found.image : `/${found.image}`;
          return `${base}${path}`;
        }
      }
      return 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
    }
    if (raw.startsWith('http')) return raw;
    const base = (localState.imgurl || '').replace(/"/g, '').replace(/\/$/, '');
    const path = raw.startsWith('/') ? raw : `/${raw}`;
    return `${base}${path}`;
  }, [localState.imgurl, parsedValuesData]);

  // ── Real-time pet value lookup from RTDB data ──
  const lookupPetValue = useCallback((pet) => {
    if (!pet?.name || parsedValuesData.length === 0) return Number(pet?.value) || 0;
    const petName = (pet.name || '').toLowerCase().trim();
    const item = parsedValuesData.find(d => (d?.name || '').toLowerCase().trim() === petName);
    if (!item) return Number(pet?.value) || 0;

    const simpleCategories = ['eggs', 'vehicles', 'pet wear', 'other', 'toys', 'food', 'strollers', 'gifts'];
    if (simpleCategories.includes(item.type?.toLowerCase())) {
      return Number(item.type?.toLowerCase() === 'eggs' ? item.rvalue : item.value) || 0;
    }

    const vType = pet.valueType || 'd';
    const valueKey = vType === 'n' ? 'nvalue' : vType === 'm' ? 'mvalue' : 'rvalue';
    const isFly = pet.isFly || false;
    const isRide = pet.isRide || false;
    const suffix = isFly && isRide ? ' - fly&ride' :
      isFly ? ' - fly' : isRide ? ' - ride' : ' - nopotion';

    return Number(item[valueKey + suffix]) || Number(item.rvalue) || 0;
  }, [parsedValuesData]);

  // ✅ Render trade item
  const renderTradeItem = useCallback((trade) => {
    const { deal, tradeRatio } = getTradeDeal(trade.hasTotal, trade.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));
    const isProfit = tradeRatio > 1;
    const neutral = tradeRatio === 1;
    const formattedTime = trade.timestamp ? dayjs(trade.timestamp.toDate()).fromNow() : "Unknown";

    const groupedHasItems = groupTradeItems(trade.hasItems || []);
    const groupedWantsItems = groupTradeItems(trade.wantsItems || []);

    // Helper to get adoptme image URL (matching Trades.jsx getImageUrl)
    // Helper to get adoptme image URL (matching Trades.jsx getImageUrl)
    const getTradeItemImageUrl = (item) => {
      if (!item || !item.name) return '';

      const baseImgUrl = localState.imgurl;
      if (!baseImgUrl) return '';

      // Try to find item in parsedValuesData to get image path
      if (parsedValuesData.length > 0) {
        const foundItem = parsedValuesData.find(
          (i) => (i?.name || i?.Name || '').toLowerCase() === item.name.toLowerCase()
        );
        if (foundItem?.image) {
          const path = foundItem.image.startsWith('/') ? foundItem.image : `/${foundItem.image}`;
          return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}${path}`;
        }
      }

      // Fallback: try item.image if available
      if (item.image) {
        const path = item.image.startsWith('/') ? item.image : `/${item.image}`;
        return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}${path}`;
      }

      return '';
    };

    return (
      <View
        key={trade.id}
        style={{
          backgroundColor: c.bg,
          borderRadius: 12,
          padding: 10,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: c.border,
        }}
      >
        {/* Trade Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              {trade.isFeatured && (
                <View style={{
                  backgroundColor: config.colors.hasBlockGreen,
                  paddingVertical: 1,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  marginRight: 5,
                  flexShrink: 0,
                  flexGrow: 0,
                }}>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>{t('trade.featured_badge')}</Text>
                </View>
              )}
              <Text style={{ fontSize: 10, color: c.textSecondary }}>
                {formattedTime}
              </Text>
            </View>
            {/* Status and Mode Badges - Side by side like Trades.jsx */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 4,
              alignSelf: 'flex-start',
              flexShrink: 1,
              flexGrow: 0,
              flexWrap: 'nowrap',
              width: undefined,
            }}>
              {/* Status Badge (Win/Lose/Fair) - Only show if status field exists */}
              {trade.status && (
                <View style={{
                  backgroundColor: trade.status === 'w' ? '#10B981' : // Green for win
                    trade.status === 'f' ? config.colors.secondary : // Blue for fair
                      config.colors.primary, // Pink/red for lose
                  paddingVertical: 1,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  marginRight: 5,
                  flexShrink: 0,
                  flexGrow: 0,
                }}>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>
                    {trade.status === 'w' ? t('home.win') : trade.status === 'f' ? t('home.fair') : t('home.lose')}
                  </Text>
                </View>
              )}
              {trade.isSharkMode !== undefined && (
                <View style={{
                  backgroundColor: trade.isSharkMode === true ? config.colors.secondary : config.colors.hasBlockGreen,
                  paddingVertical: 1,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  flexShrink: 0,
                  flexGrow: 0,
                }}>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>
                    {trade.isSharkMode === true ? t('home.shark') : t('home.frost')}
                  </Text>
                </View>
              )}
            </View>
            {(groupedHasItems.length > 0 && groupedWantsItems.length > 0) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <View style={{
                  backgroundColor: deal.color,
                  paddingHorizontal: 4,
                  paddingVertical: 2,
                  borderRadius: 6,
                  marginRight: 8,
                }}>
                  <Text style={{ color: '#fff', fontSize: 8, fontWeight: '600' }}>
                    {t(deal.label) || deal.label}
                  </Text>
                </View>
                <Text style={{
                  fontSize: 11,
                  color: !isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed,
                  fontWeight: '600'
                }}>
                  {tradePercentage}% {!neutral && (
                    <Icon
                      name={isProfit ? 'arrow-down-outline' : 'arrow-up-outline'}
                      size={10}
                      color={isProfit ? config.colors.wantBlockRed : config.colors.hasBlockGreen}
                    />
                  )}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Trade Items - Matching Trades.jsx structure */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10 }}>
          {/* Has Items Grid */}
          {trade.hasItems && trade.hasItems.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: '48%' }}>
              {Array.from({
                length: Math.max(4, Math.ceil(trade.hasItems.length / 4) * 4)
              }).map((_, idx) => {
                const tradeItem = trade.hasItems[idx];
                return (
                  <View key={idx} style={{ width: '22%', height: 40, margin: 1, alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 10 }}>
                    {tradeItem ? (
                      <>
                        <Image
                          source={{ uri: getTradeItemImageUrl(tradeItem) || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                          style={{ width: 30, height: 30, borderRadius: 6 }}
                          resizeMode="contain"
                          defaultSource={{ uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                        />
                        <View style={{ position: 'absolute', bottom: -5, right: 0, flexDirection: 'row', gap: 1, padding: 1, alignItems: 'center', justifyContent: 'center' }}>
                          {tradeItem.isFly && (
                            <Text style={{ color: 'white', backgroundColor: '#3498db', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>F</Text>
                          )}
                          {tradeItem.isRide && (
                            <Text style={{ color: 'white', backgroundColor: '#e74c3c', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>R</Text>
                          )}
                          {tradeItem.valueType && tradeItem.valueType !== 'd' && (
                            <Text style={{
                              color: 'white',
                              backgroundColor: tradeItem.valueType === 'm' ? '#9b59b6' : '#2ecc71',
                              borderRadius: 10,
                              width: 10,
                              height: 10,
                              fontSize: 6,
                              textAlign: 'center',
                              lineHeight: 10,
                              fontWeight: '600',
                              overflow: 'hidden',
                              padding: 0,
                              margin: 0
                            }}>{tradeItem.valueType.toUpperCase()}</Text>
                          )}
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{ width: '48%', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{
                backgroundColor: 'black',
                paddingVertical: 1,
                paddingHorizontal: 6,
                borderRadius: 6,
                flexShrink: 0,
                flexGrow: 0,
              }}>
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>{t('trade.give_offer')}</Text>
              </View>
            </View>
          )}

          {/* Transfer Icon */}
          <View style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Image source={require('../../../assets/left-right.png')} style={{ width: 20, height: 20, borderRadius: 5 }} />
          </View>

          {/* Wants Items Grid */}
          {trade.wantsItems && trade.wantsItems.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: '48%' }}>
              {Array.from({
                length: Math.max(4, Math.ceil(trade.wantsItems.length / 4) * 4)
              }).map((_, idx) => {
                const tradeItem = trade.wantsItems[idx];
                return (
                  <View key={idx} style={{ width: '22%', height: 40, margin: 1, alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 10 }}>
                    {tradeItem ? (
                      <>
                        <Image
                          source={{ uri: getTradeItemImageUrl(tradeItem) || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                          style={{ width: 30, height: 30, borderRadius: 6 }}
                          resizeMode="contain"
                          defaultSource={{ uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                        />
                        <View style={{ position: 'absolute', bottom: -5, right: 0, flexDirection: 'row', gap: 1, padding: 1, alignItems: 'center', justifyContent: 'center' }}>
                          {tradeItem.isFly && (
                            <Text style={{ color: 'white', backgroundColor: '#3498db', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>F</Text>
                          )}
                          {tradeItem.isRide && (
                            <Text style={{ color: 'white', backgroundColor: '#e74c3c', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>R</Text>
                          )}
                          {tradeItem.valueType && tradeItem.valueType !== 'd' && (
                            <Text style={{
                              color: 'white',
                              backgroundColor: tradeItem.valueType === 'm' ? '#9b59b6' : '#2ecc71',
                              borderRadius: 10,
                              width: 10,
                              height: 10,
                              fontSize: 6,
                              textAlign: 'center',
                              lineHeight: 10,
                              fontWeight: '600',
                              overflow: 'hidden',
                              padding: 0,
                              margin: 0
                            }}>{tradeItem.valueType.toUpperCase()}</Text>
                          )}
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{ width: '48%', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{
                backgroundColor: 'black',
                paddingVertical: 1,
                paddingHorizontal: 6,
                borderRadius: 6,
                flexShrink: 0,
                flexGrow: 0,
              }}>
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>{t('trade.give_offer')}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Trade Totals - Matching Trades.jsx structure */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', width: '100%', marginTop: 10 }}>
          {trade.hasItems && trade.hasItems.length > 0 && (
            <Text style={{
              fontSize: 8,
              fontWeight: 'bold',
              color: 'white',
              textAlign: 'center',
              alignSelf: 'center',
              marginHorizontal: 'auto',
              paddingHorizontal: 4,
              paddingVertical: 2,
              borderRadius: 6,
              backgroundColor: config.colors.hasBlockGreen
            }}>
              {t('trade.me')}: {formatTradeValue(typeof trade.hasTotal === 'number' ? trade.hasTotal : trade.hasTotal?.value || 0)}
            </Text>
          )}
          <View style={{ justifyContent: 'center', alignItems: 'center', marginHorizontal: 8 }}>
            {(trade.hasItems && trade.hasItems.length > 0 && trade.wantsItems && trade.wantsItems.length > 0) && (
              <>
                {(() => {
                  const hasValue = typeof trade.hasTotal === 'number' ? trade.hasTotal : trade.hasTotal?.value || 0;
                  const wantsValue = typeof trade.wantsTotal === 'number' ? trade.wantsTotal : trade.wantsTotal?.value || 0;
                  if (hasValue > wantsValue) {
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="arrow-up-outline" size={12} color="green" />
                        <Text style={{ fontSize: 8, fontWeight: 'bold', color: 'green', textAlign: 'center', alignSelf: 'center', marginHorizontal: 'auto', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6 }}>
                          {formatTradeValue(hasValue - wantsValue)}
                        </Text>
                      </View>
                    );
                  } else if (hasValue < wantsValue) {
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="arrow-down-outline" size={12} color={config.colors.hasBlockGreen} />
                        <Text style={{ fontSize: 8, fontWeight: 'bold', color: config.colors.hasBlockGreen, textAlign: 'center', alignSelf: 'center', marginHorizontal: 'auto', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6 }}>
                          {formatTradeValue(wantsValue - hasValue)}
                        </Text>
                      </View>
                    );
                  } else {
                    return <Text style={{ fontSize: 8, fontWeight: 'bold', color: config.colors.primary, textAlign: 'center' }}>-</Text>;
                  }
                })()}
              </>
            )}
          </View>
          {trade.wantsItems && trade.wantsItems.length > 0 && (
            <Text style={{
              fontSize: 8,
              fontWeight: 'bold',
              color: 'white',
              textAlign: 'center',
              alignSelf: 'center',
              marginHorizontal: 'auto',
              paddingHorizontal: 4,
              paddingVertical: 2,
              borderRadius: 6,
              backgroundColor: config.colors.wantBlockRed
            }}>
              {t('trade.you')}: {formatTradeValue(typeof trade.wantsTotal === 'number' ? trade.wantsTotal : trade.wantsTotal?.value || 0)}
            </Text>
          )}
        </View>

        {/* Description */}
        {trade.description && (
          <Text style={{
            fontSize: 10,
            color: c.textSecondary,
            marginTop: 6,
            paddingTop: 6,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}>
            {trade.description}
          </Text>
        )}
      </View>
    );
  }, [isDarkMode, t, localState.imgurl, parsedValuesData]);

  // ✅ Render Post Item
  const renderPostItem = useCallback((post) => {
    const timeLabel = post.createdAt ? dayjs(post.createdAt.toDate ? post.createdAt.toDate() : post.createdAt).fromNow() : 'Just now';
    const images = Array.isArray(post.imageUrl) ? post.imageUrl : (post.imageUrl ? [post.imageUrl] : []);
    const likeCount = post.likes ? Object.keys(post.likes).length : 0;
    const tags = Array.isArray(post.selectedTags) ? post.selectedTags : [];

    const getTagColor = (tag) => {
      switch ((tag || '').toLowerCase()) {
        case 'scam alert': return '#FF3B30';
        case 'looking for trade': return '#34C759';
        case 'discussion': return '#5AC8FA';
        case 'real or fake': return '#AF52DE';
        case 'need help': return '#FF9500';
        case 'misc': case 'misc.': return '#8E8E93';
        default: return config.colors.primary;
      }
    };

    return (
      <TouchableOpacity
        key={post.id}
        activeOpacity={0.8}
        onPress={() => setSelectedPost(post)}
        style={{
          backgroundColor: c.bg,
          borderRadius: 12,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: isDarkMode ? '#1e293b' : '#e5e7eb',
          overflow: 'hidden',
        }}
      >
        {/* Post Image */}
        {images.length > 0 && (
          <Image
            source={{ uri: images[0] }}
            style={{ width: '100%', height: 140, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
            resizeMode="cover"
          />
        )}

        {/* Content */}
        <View style={{ padding: 10 }}>
          {/* Tags row */}
          {tags.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
              {tags.map((tag, idx) => (
                <View key={idx} style={{
                  paddingHorizontal: 7, paddingVertical: 2,
                  borderRadius: 999, backgroundColor: getTagColor(tag),
                }}>
                  <Text style={{ fontSize: 9, color: '#fff', fontWeight: '700' }}>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Description */}
          {!!post.desc && (
            <Text
              style={{
                fontSize: 12, lineHeight: 17,
                color: c.text,
                marginBottom: 6,
              }}
              numberOfLines={3}
            >
              {post.desc}
            </Text>
          )}

          {/* Footer: time + stats */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ fontSize: 10, color: c.textMuted }}>
              {timeLabel}
            </Text>
            {likeCount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="heart" size={10} color="#EF4444" />
                <Text style={{ fontSize: 10, fontWeight: '600', color: c.textSecondary }}>
                  {likeCount}
                </Text>
              </View>
            )}
            {post.commentCount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <Icon name="chatbubble-outline" size={10} color={c.textMuted} />
                <Text style={{ fontSize: 10, fontWeight: '600', color: c.textSecondary }}>
                  {post.commentCount}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }, [isDarkMode, t]);

  // ─────────────────────────────────────────────
  // Post Viewer Modal
  const screenWidth = Dimensions.get('window').width;

  const getTagColor = useCallback((tag) => {
    switch ((tag || '').toLowerCase()) {
      case 'scam alert': return '#FF3B30';
      case 'looking for trade': return '#34C759';
      case 'discussion': return '#5AC8FA';
      case 'real or fake': return '#AF52DE';
      case 'need help': return '#FF9500';
      case 'misc': case 'misc.': return '#8E8E93';
      default: return config.colors.primary;
    }
  }, []);

  const renderPostViewerModal = useMemo(() => {
    if (!selectedPost) return null;

    const post = selectedPost;
    const timeLabel = post.createdAt
      ? dayjs(post.createdAt.toDate ? post.createdAt.toDate() : post.createdAt).fromNow()
      : 'Just now';
    const images = Array.isArray(post.imageUrl) ? post.imageUrl : (post.imageUrl ? [post.imageUrl] : []);
    const likeCount = post.likes ? Object.keys(post.likes).length : 0;
    const tags = Array.isArray(post.selectedTags) ? post.selectedTags : [];

    return (
      <Modal
        animationType="slide"
        transparent={true}
        visible={!!selectedPost}
        onRequestClose={() => setSelectedPost(null)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          onPress={() => setSelectedPost(null)}
        >
          <Pressable
            onPress={() => { }}
            style={{
              backgroundColor: isDarkMode ? '#111827' : '#ffffff',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: '85%',
              paddingBottom: Platform.OS === 'ios' ? 34 : 20,
            }}
          >
            {/* Header */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              paddingHorizontal: 16, paddingVertical: 14,
              borderBottomWidth: 1, borderBottomColor: c.border,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                <Image
                  source={{ uri: post.avatar || avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                  style={{ width: 36, height: 36, borderRadius: 18, marginRight: 10 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: isDarkMode ? '#f3f4f6' : '#111827' }} numberOfLines={1}>
                    {post.displayName || userName || 'Anonymous'}
                  </Text>
                  <Text style={{ fontSize: 11, color: c.textSecondary }}>{timeLabel}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setSelectedPost(null)} style={{ padding: 4 }}>
                <Icon name="close" size={24} color={isDarkMode ? '#e5e7eb' : '#374151'} />
              </TouchableOpacity>
            </View>

            {/* Images carousel */}
            {images.length > 0 && (
              <PostImageCarousel images={images} isDarkMode={isDarkMode} screenWidth={screenWidth} />
            )}

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
              {/* Tags */}
              {tags.length > 0 && (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, marginBottom: 4 }}>
                  {tags.map((tag, idx) => (
                    <View key={idx} style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: getTagColor(tag) }}>
                      <Text style={{ fontSize: 11, color: '#fff', fontWeight: '600' }}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Description */}
              {post.desc ? (
                <Text style={{ fontSize: 14, color: c.text, lineHeight: 20, marginTop: 10, marginBottom: 10 }}>
                  {post.desc}
                </Text>
              ) : null}

              {/* Like count */}
              <View style={{
                flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                borderTopWidth: 1, borderTopColor: c.border, marginBottom: 10,
              }}>
                <Icon name="heart" size={16} color="#EF4444" />
                <Text style={{ fontSize: 12, fontWeight: '600', color: c.text, marginLeft: 6 }}>
                  {likeCount} {likeCount === 1 ? 'Like' : 'Likes'}
                </Text>
                {post.commentCount > 0 && (
                  <>
                    <Text style={{ color: isDarkMode ? '#4b5563' : '#d1d5db', marginHorizontal: 8 }}>•</Text>
                    <Icon name="chatbubble-outline" size={14} color={config.colors.primary} />
                    <Text style={{ fontSize: 12, fontWeight: '600', color: c.text, marginLeft: 4 }}>
                      {post.commentCount} {post.commentCount === 1 ? 'Comment' : 'Comments'}
                    </Text>
                  </>
                )}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }, [selectedPost, isDarkMode, avatar, userName, screenWidth, getTagColor]);

  // ── Default gradient — neutral gray so purchased banners pop ──
  const DEFAULT_BANNER = ['#64748b', '#94a3b8', '#cbd5e1'];
  // Override with active cosmetic banner if available
  const activeBannerGradient = activeCosmetics?.profileBanner?.gradient;
  const bannerColor = activeBannerGradient?.[0] || DEFAULT_BANNER[0];
  const bannerColorEnd = activeBannerGradient?.[2] || DEFAULT_BANNER[2];

  // ─────────────────────────────────────────────
  return (
    <>
      {renderPostViewerModal}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isVisible && !selectedPost}
        onRequestClose={toggleModal}
      >
        {/* Overlay */}
        <Pressable style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]} onPress={toggleModal} />

        {/* Drawer Content */}
        <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <SwipeableBottomDrawer onClose={toggleModal} showPill={false} style={[styles.drawer, { padding: 0, paddingBottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', shadowOpacity: 0, elevation: 0 }]}>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: loadDetails ? Dimensions.get('window').height * 0.85 : 500, backgroundColor: 'rgba(0,0,0,0.5)' }}
            >
              {/* ═══ GRADIENT BANNER ═══ */}
              <View style={{
                height: 90,
                backgroundColor: bannerColor,
                overflow: 'hidden',
                position: 'relative',
              }}>
                {/* Drag Handle — overlaid on banner */}
                <View style={{ alignItems: 'center', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
                  <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.4)', marginTop: 8 }} />
                </View>
                {/* Decorative gradient circles */}
                <View style={{
                  position: 'absolute', top: -20, right: -20,
                  width: 80, height: 80, borderRadius: 40,
                  backgroundColor: bannerColorEnd, opacity: 0.3,
                }} />
                <View style={{
                  position: 'absolute', bottom: -15, left: 30,
                  width: 50, height: 50, borderRadius: 25,
                  backgroundColor: '#ffffff', opacity: 0.1,
                }} />
                <View style={{
                  position: 'absolute', top: 10, left: -10,
                  width: 60, height: 60, borderRadius: 30,
                  backgroundColor: bannerColorEnd, opacity: 0.2,
                }} />

                {/* PRO badge on banner */}
                {mergedUser?.isPro && (
                  <View style={{
                    position: 'absolute', top: 12, right: 14,
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    paddingHorizontal: 10, paddingVertical: 4,
                    borderRadius: 999,
                  }}>
                    <Image source={require('../../../assets/pro.png')} style={{ width: 11, height: 11 }} />
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 }}>Pro</Text>
                  </View>
                )}

                {/* Ban/Block icon on banner */}
                <TouchableOpacity
                  onPress={handleBanToggle}
                  style={{
                    position: 'absolute', top: 12, left: 14,
                    padding: 6, borderRadius: 999,
                    backgroundColor: 'rgba(255,255,255,0.15)',
                  }}
                >
                  <Icon
                    name={isBlock ? 'shield-checkmark-outline' : 'ban-outline'}
                    size={16}
                    color="#fff"
                  />
                </TouchableOpacity>
              </View>

              {/* ═══ CONTENT AREA (white/dark bg below banner) ═══ */}
              <View style={{ backgroundColor: c.bg, paddingBottom: 12 }}>

                {/* ═══ CENTERED AVATAR (overlapping banner) ═══ */}
                <View style={{ alignItems: 'center', marginTop: -36, zIndex: 10 }}>
                  <FramedAvatar
                    avatarUri={mergedUser?.avatar || avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                    frame={activeCosmetics?.profileFrame}
                    isDarkMode={isDarkMode}
                    avatarSize={72}
                  />
                </View>

                {/* ═══ NAME + BADGES (centered) ═══ */}
                <View style={{ alignItems: 'center', marginTop: 8, paddingHorizontal: 12 }}>
                  {/* Name row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                    <Text
                      style={{
                        fontSize: 20, fontWeight: '800',
                        color: c.text,
                      }}
                      numberOfLines={1}
                    >
                      {userName}
                    </Text>
                    {selectedUser?.flage ? (
                      <Text style={{ fontSize: 18 }}>{selectedUser.flage}</Text>
                    ) : null}
                    <TouchableOpacity onPress={() => copyToClipboard(userName)} style={{ padding: 2 }}>
                      <Icon name="copy-outline" size={14} color={c.textMuted} />
                    </TouchableOpacity>
                  </View>

                  {/* Badge pills */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 5 }}>
                    {mergedUser?.isAdmin && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF4444', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, gap: 3 }}>
                        <Icon name="shield" size={10} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('chat.admin')}</Text>
                      </View>
                    )}
                    {!mergedUser?.isAdmin && mergedUser?.isModerator && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#8B5CF6', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, gap: 3 }}>
                        <Icon name="shield-checkmark" size={10} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('chat.mod')}</Text>
                      </View>
                    )}
                    {!mergedUser?.isAdmin && !mergedUser?.isModerator && mergedUser?.isBabyMod && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F59E0B', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, gap: 3 }}>
                        <Icon name="paw" size={10} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>JMD</Text>
                      </View>
                    )}
                    {mergedUser?.isTrusted && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#10B981', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, gap: 3 }}>
                        <Icon name="checkmark-circle" size={10} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>Trusted</Text>
                      </View>
                    )}
                    {mergedUser?.isCMSR && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F97316', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, gap: 3 }}>
                        <Icon name="briefcase" size={10} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>CMSR</Text>
                      </View>
                    )}
                    {mergedUser?.robloxUsernameVerified && (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                        backgroundColor: isDarkMode ? 'rgba(56,189,248,0.15)' : 'rgba(14,165,233,0.1)',
                        borderWidth: 1, borderColor: isDarkMode ? 'rgba(56,189,248,0.3)' : 'rgba(14,165,233,0.25)',
                        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                      }}>
                        <Icon name="checkmark-circle" size={10} color={isDarkMode ? '#38bdf8' : '#0ea5e9'} />
                        <Text style={{ fontSize: 9, fontWeight: '700', color: isDarkMode ? '#38bdf8' : '#0ea5e9' }}>Verified</Text>
                      </View>
                    )}
                    {mergedUser?.robloxUsername && !mergedUser?.robloxUsernameVerified && (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                        backgroundColor: isDarkMode ? 'rgba(251,191,36,0.15)' : 'rgba(217,119,6,0.1)',
                        borderWidth: 1, borderColor: isDarkMode ? 'rgba(251,191,36,0.3)' : 'rgba(217,119,6,0.25)',
                        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                      }}>
                        <Icon name="alert-circle-outline" size={10} color={isDarkMode ? '#fbbf24' : '#d97706'} />
                        <Text style={{ fontSize: 9, fontWeight: '700', color: isDarkMode ? '#fbbf24' : '#d97706' }}>Unverified</Text>
                      </View>
                    )}

                  </View>

                  {/* Roblox username subtitle */}
                  {mergedUser?.robloxUsername && (
                    <TouchableOpacity
                      onPress={handleOpenRobloxProfile}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                      activeOpacity={0.7}
                    >
                      <Icon name="game-controller" size={12} color={c.textMuted} />
                      <Text style={{ fontSize: 12, color: c.textSecondary, fontWeight: '600' }}>
                        {mergedUser.robloxUsername}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* User ID (copyable) */}
                  {selectedUserId && (
                    <TouchableOpacity
                      onPress={() => copyToClipboard(selectedUserId)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}
                      activeOpacity={0.7}
                    >
                      <Icon name="finger-print-outline" size={12} color={c.textMuted} />
                      <Text style={{ fontSize: 11, color: c.textMuted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>
                        {selectedUserId}
                      </Text>
                      <Icon name="copy-outline" size={11} color={c.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* ═══ STATS STRIP ═══ */}
                {loadDetails && !loadingRating && (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center',
                    marginTop: 14, marginHorizontal: 12,
                    paddingVertical: 10,
                    borderTopWidth: 1, borderBottomWidth: 1,
                    borderColor: isDarkMode ? '#1e293b' : '#f1f5f9',
                  }}>
                    {/* Rating */}
                    {ratingSummary && (
                      <View style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>Rating</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                          <Text style={{ fontSize: 12, color: '#fbbf24' }}>★</Text>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                            {ratingSummary.value.toFixed(1)}
                          </Text>
                          <Text style={{ fontSize: 10, fontWeight: '600', color: c.textMuted }}>({ratingSummary.count})</Text>
                        </View>
                      </View>
                    )}
                    {/* Followers */}
                    <View style={{
                      flex: 1, alignItems: 'center',
                      borderLeftWidth: ratingSummary ? 1 : 0,
                      borderColor: c.border,
                    }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>Followers</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                        <Icon name="people" size={12} color="#8b5cf6" />
                        <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                          {followersCount || 0}
                        </Text>
                      </View>
                    </View>
                    {/* XP */}
                    {userPoints !== null && userPoints > 0 && (
                      <View style={{
                        flex: 1, alignItems: 'center',
                        borderLeftWidth: 1, borderColor: c.border,
                      }}>
                        <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>XP</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                          <Text style={{ fontSize: 12 }}>⚡</Text>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                            {Number(userPoints).toLocaleString()}
                          </Text>
                        </View>
                      </View>
                    )}
                    {/* Wins */}
                    {gameWins !== null && gameWins > 0 && (
                      <View style={{
                        flex: 1, alignItems: 'center',
                        borderLeftWidth: 1, borderColor: c.border,
                      }}>
                        <Text style={{ fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: c.textMuted }}>Wins</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                          <Text style={{ fontSize: 12 }}>🏆</Text>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: c.text }}>
                            {gameWins}
                          </Text>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {/* ═══ JOINED DATE (under stats) ═══ */}
                {loadDetails && !loadingRating && createdAtText && (
                  <View style={{ alignItems: 'center', marginTop: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Icon name="calendar-outline" size={11} color={c.textMuted} />
                      <Text style={{ fontSize: 10, color: c.textMuted, fontWeight: '500' }}>
                        {t('settings.joined', { time: createdAtText })}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Loading indicator for details */}
                {loadDetails && loadingRating && (
                  <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                    <ActivityIndicator size="small" color={config.colors.primary} />
                  </View>
                )}



                {/* 📝 Bio Section */}
                {loadDetails && (
                  <View style={{
                    borderRadius: 14, padding: 12, marginHorizontal: 12,
                    backgroundColor: c.bgAlt,
                    marginTop: 8,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <View style={{
                        width: 24, height: 24, borderRadius: 8,
                        backgroundColor: isDarkMode ? 'rgba(96,165,250,0.15)' : 'rgba(96,165,250,0.1)',
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon name="person" size={12} color="#60a5fa" />
                      </View>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: c.text }}>
                        {t('profile.bio')}
                      </Text>
                    </View>
                    <Text style={{
                      fontSize: 13, lineHeight: 19,
                      color: c.text,
                    }}>
                      {userBio || 'Hi there, I am new here'}
                    </Text>
                  </View>
                )}

                {/* 🏅 Badge Showcase */}
                {loadDetails && (
                  <View style={{ marginHorizontal: 12, marginTop: 8 }}>
                    <BadgeShowcase
                      isDarkMode={isDarkMode}
                      t={t}
                      earnedBadges={computeBadges({ createdAt: userCreatedAtMs }, savedBadges)}
                    />
                  </View>
                )}

                {/* ⭐ XP & Level Progress */}
                {loadDetails && (
                  <View style={{ marginHorizontal: 12, marginTop: 8 }}>
                    <XPBar xp={xpData.total} isDarkMode={isDarkMode} />
                  </View>
                )}

                {/* 🐾 Pets & Portfolio */}
                {loadDetails && (
                  <View style={{ marginHorizontal: 12 }}>
                    <CompactPortfolio
                      ownedPets={ownedPets}
                      wishlistPets={wishlistPets}
                      isDarkMode={isDarkMode}
                      t={t}
                      loadingPets={loadingPets}
                      renderPetBubble={renderPetBubble}
                      lookupPetValue={lookupPetValue}
                    />
                  </View>
                )}

                {loadDetails && (
                  <View style={{ marginHorizontal: 12 }}>
                    <ProfileReviewsSection
                      isDarkMode={isDarkMode}
                      t={t}
                      reviews={reviews}
                      loadingReviews={loadingReviews}
                      hasMoreReviews={hasMoreReviews}
                      handleLoadMoreReviews={handleLoadMoreReviews}
                      renderStars={renderStars}
                      getTimestampMs={getTimestampMs}
                      formatCreatedAt={formatCreatedAt}
                      starFilter={starFilter}
                      setStarFilter={setStarFilter}
                    />
                  </View>
                )}

                {loadDetails && (
                  <View style={{ marginHorizontal: 12 }}>
                    <ProfileTradesSection
                      isDarkMode={isDarkMode}
                      t={t}
                      trades={trades}
                      loadingTrades={loadingTrades}
                      hasMoreTrades={hasMoreTrades}
                      handleLoadMoreTrades={handleLoadMoreTrades}
                      renderTradeItem={renderTradeItem}
                    />
                  </View>
                )}

                {loadDetails && (
                  <View style={{ marginHorizontal: 12 }}>
                    <ProfilePostsSection
                      isDarkMode={isDarkMode}
                      t={t}
                      posts={posts}
                      loadingPosts={loadingPosts}
                      hasMorePosts={hasMorePosts}
                      handleLoadMorePosts={handleLoadMorePosts}
                      renderPostItem={renderPostItem}
                    />
                  </View>
                )}

                {/* ═══ ACTION BUTTONS (Premium Pill Style) ═══ */}
                <View style={{
                  marginTop: 10, marginBottom: 10,
                  paddingHorizontal: 12,
                  gap: 7,
                }}>
                  {/* Top row: Chat + Follow (or Chat + Roblox if no follow) */}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {/* Chat Action */}
                    {!fromPvtChat && (
                      <TouchableOpacity
                        onPress={handleStartChat}
                        activeOpacity={0.85}
                        style={{
                          flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                          gap: 7, paddingVertical: 10, borderRadius: 12,
                          backgroundColor: bannerColor,
                          shadowColor: bannerColor, shadowOffset: { width: 0, height: 5 },
                          shadowOpacity: 0.35, shadowRadius: 10, elevation: 6,
                        }}
                      >
                        {/* Inner glow */}
                        <View style={{
                          position: 'absolute', top: 1.5, left: 1.5, right: 1.5, bottom: 1.5,
                          borderRadius: 13, borderWidth: 1,
                          borderColor: 'rgba(255,255,255,0.2)',
                        }} />
                        <Icon name="chatbubble" size={18} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                          {t('chat.start_chat')}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* Follow/Unfollow Action */}
                    {!fromPvtChat && user?.id !== selectedUserId && (
                      <TouchableOpacity
                        onPress={handleFollowToggle}
                        disabled={followLoading}
                        activeOpacity={0.85}
                        style={{
                          flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                          gap: 7, paddingVertical: 10, borderRadius: 12,
                          backgroundColor: isFollowing
                            ? (isDarkMode ? '#1e293b' : '#f1f5f9')
                            : (isDarkMode ? '#059669' : '#10b981'),
                          borderWidth: isFollowing ? 1.5 : 0,
                          borderColor: isFollowing
                            ? (c.border)
                            : 'transparent',
                          shadowColor: isFollowing ? (isDarkMode ? '#000' : '#94a3b8') : '#10b981',
                          shadowOffset: { width: 0, height: isFollowing ? 3 : 5 },
                          shadowOpacity: isFollowing ? 0.15 : 0.35,
                          shadowRadius: isFollowing ? 6 : 10,
                          elevation: isFollowing ? 3 : 6,
                        }}
                      >
                        {!isFollowing && (
                          <View style={{
                            position: 'absolute', top: 1.5, left: 1.5, right: 1.5, bottom: 1.5,
                            borderRadius: 13, borderWidth: 1,
                            borderColor: 'rgba(255,255,255,0.2)',
                          }} />
                        )}
                        {followLoading ? (
                          <ActivityIndicator size="small" color={isFollowing ? (c.textSecondary) : '#fff'} />
                        ) : (
                          <>
                            <Icon
                              name={isFollowing ? "person-remove" : "person-add"}
                              size={18}
                              color={isFollowing ? (c.textSecondary) : '#fff'}
                            />
                            <Text style={{
                              fontSize: 13, fontWeight: '700',
                              color: isFollowing ? (c.textSecondary) : '#fff',
                            }}>
                              {isFollowing ? t('social.unfollow') || 'Unfollow' : t('social.follow') || 'Follow'}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                  </View>

                  {/* Second row: Roblox + View Profile */}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    {/* Roblox Profile */}
                    {mergedUser?.robloxUsername && (
                      <TouchableOpacity
                        onPress={handleOpenRobloxProfile}
                        activeOpacity={0.85}
                        style={{
                          flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                          gap: 7, paddingVertical: 9, borderRadius: 12,
                          backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
                          borderWidth: 1.5,
                          borderColor: c.border,
                          shadowColor: isDarkMode ? '#000' : '#94a3b8',
                          shadowOffset: { width: 0, height: 3 },
                          shadowOpacity: 0.12, shadowRadius: 6, elevation: 3,
                        }}
                      >
                        <Icon name="game-controller" size={16} color={isDarkMode ? '#60a5fa' : '#2563eb'} />
                        <Text style={{
                          fontSize: 12, fontWeight: '700',
                          color: isDarkMode ? '#60a5fa' : '#2563eb',
                        }}>Roblox</Text>
                      </TouchableOpacity>
                    )}

                    {/* View Profile — only on initial view */}
                    {!loadDetails && (
                      <TouchableOpacity
                        onPress={() => setLoadDetails(true)}
                        activeOpacity={0.85}
                        style={{
                          flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                          gap: 7, paddingVertical: 9, borderRadius: 12,
                          backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
                          borderWidth: 1.5,
                          borderColor: c.border,
                          shadowColor: isDarkMode ? '#000' : '#94a3b8',
                          shadowOffset: { width: 0, height: 3 },
                          shadowOpacity: 0.12, shadowRadius: 6, elevation: 3,
                        }}
                      >
                        <Icon name="person" size={16} color={isDarkMode ? '#e2e8f0' : '#475569'} />
                        <Text style={{
                          fontSize: 12, fontWeight: '700',
                          color: isDarkMode ? '#e2e8f0' : '#475569',
                        }}>{t('profile.view_detail_profile')}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {!loadDetails && (isAdmin || user?.isModerator || user?.isBabyMod) && (
                  <View>
                    <TouchableOpacity
                      onPress={() => setShowModTools(prev => !prev)}
                      style={{
                        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                        paddingVertical: 8, marginTop: 8, gap: 6,
                        backgroundColor: showModTools
                          ? (isDarkMode ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)')
                          : (isDarkMode ? 'rgba(100,116,139,0.15)' : 'rgba(100,116,139,0.08)'),
                        borderRadius: 10,
                      }}
                    >
                      <Icon name={showModTools ? 'shield' : 'shield-outline'} size={16}
                        color={showModTools ? '#EF4444' : (c.textSecondary)} />
                      <Text style={{
                        fontSize: 12, fontWeight: '600',
                        color: showModTools ? '#EF4444' : (c.textSecondary),
                      }}>
                        {showModTools ? 'Hide Mod Tools' : 'Mod Tools'}
                      </Text>
                    </TouchableOpacity>
                    {showModTools && (
                      <ProfileAdminActions
                        isAdmin={isAdmin}
                        isDarkMode={isDarkMode}
                        isBanned={isBanned}
                        mergedUser={mergedUser}
                        handleApplyStrike={handleApplyStrike}
                        handleMuteUser={handleMuteUser}
                        handleUnbanUser={handleUnbanUser}
                        handlePromoteModerator={handlePromoteModerator}
                        handleDemoteModerator={handleDemoteModerator}
                        isBabyMod={!!user?.isBabyMod}
                        isModerator={!!user?.isModerator}
                        canManageBabyMod={canManageBabyMod}
                        targetIsBabyMod={!!mergedUser?.isBabyMod}
                        handleMakeBabyMod={handleMakeBabyMod}
                        handleRemoveBabyMod={handleRemoveBabyMod}
                        canManageBadges={canManageBadges}
                        targetIsTrusted={!!mergedUser?.isTrusted}
                        targetIsCMSR={!!mergedUser?.isCMSR}
                        handleMakeTrusted={handleMakeTrusted}
                        handleRemoveTrusted={handleRemoveTrusted}
                        handleMakeCMSR={handleMakeCMSR}
                        handleRemoveCMSR={handleRemoveCMSR}
                      />
                    )}
                  </View>
                )}
              </View>{/* end content area */}
            </ScrollView >
          </SwipeableBottomDrawer >

          {/* Admin Reason Modal - rendered inside drawer modal to avoid RN 0.83 stacking issue */}
          {showReasonModal && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20, zIndex: 9999 }}>
              <View style={{ width: '100%', backgroundColor: c.bg, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: c.border }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 10 }}>
                  {reasonActionType?.type === 'strike' && `Apply Strike ${reasonActionType.value}`}
                  {reasonActionType?.type === 'mute' && `Mute User for ${reasonActionType.value}m`}
                  {reasonActionType?.type === 'ban' && `Ban User`}
                </Text>
                <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 15 }}>
                  Please provide a reason for this action. This will be visible in the Admin Dashboard.
                </Text>
                <TextInput
                  style={{
                    backgroundColor: c.bgAlt,
                    color: c.text,
                    borderRadius: 10,
                    padding: 12,
                    minHeight: 80,
                    borderWidth: 1,
                    borderColor: c.border,
                    textAlignVertical: 'top'
                  }}
                  placeholder="e.g. Scammer, inappropriate language, spamming..."
                  placeholderTextColor={c.textMuted}
                  multiline
                  value={adminReason}
                  onChangeText={setAdminReason}
                  autoFocus
                />
                <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                  <TouchableOpacity onPress={() => setShowReasonModal(false)} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: isDarkMode ? '#334155' : '#e2e8f0' }}>
                    <Text style={{ color: c.text, fontWeight: '600' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={confirmAdminAction} style={{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#ef4444' }}>
                    <Text style={{ color: '#fff', fontWeight: '600' }}>Confirm</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

        </View >
      </Modal >

      {/* Admin Reason Modal */}

    </>
  );
};

export default ProfileBottomDrawer;
