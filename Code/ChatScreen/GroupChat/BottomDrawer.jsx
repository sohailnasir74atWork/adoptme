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
import { banUserwithEmail, unbanUserWithEmail, checkBanStatus, makeModerator, removeModerator, setUserStrike } from '../utils';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

const REVIEWS_PAGE_SIZE = 3; // how many reviews per page

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
  } else {
    return value.toLocaleString();
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

const ProfileBottomDrawer = ({
  isVisible,
  toggleModal,
  startChat,
  selectedUser,
  isOnline,
  bannedUsers,
  fromPvtChat,
}) => {
  const { theme, firestoreDB, appdatabase, isAdmin, user } = useGlobalState();
  const { updateLocalState, localState } = useLocalState();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();

  const isDarkMode = theme === 'dark';
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const selectedUserId = selectedUser?.senderId || selectedUser?.id || null;
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

  // toggle details
  const [loadDetails, setLoadDetails] = useState(false);

  // ✅ State for fetched user data (roblox username, verified status, etc.)
  const [userData, setUserData] = useState(null);
  const [isBanned, setIsBanned] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  // ✅ Fetch user data from Firebase if roblox data is missing
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
          decodedEmailSnap
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
        ]);

        if (!isMounted) return;

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
          robloxUsername: robloxUsernameSnap?.exists() ? robloxUsernameSnap.val() : null,
          robloxUserId: robloxUserIdSnap?.exists() ? robloxUserIdSnap.val() : null,
          robloxUsernameVerified: robloxUsernameVerifiedSnap?.exists() ? robloxUsernameVerifiedSnap.val() : false,
          isPro: isProSnap?.exists() ? isProSnap.val() : false,
          lastGameWinAt: lastGameWinAtSnap?.exists() ? lastGameWinAtSnap.val() : null,
          isModerator: isModeratorSnap?.exists() ? isModeratorSnap.val() : false,
          isAdmin: isAdminSnap?.exists() ? isAdminSnap.val() : false,
          email: emailSnap?.exists() ? emailSnap.val() : null,
          decodedEmail: decodedEmailSnap?.exists() ? decodedEmailSnap.val() : null,
        };

        setUserData(newUserData);
      } catch (error) {
        console.error('Error fetching user data in BottomDrawer:', error);
        if (isMounted) setUserData(null);
      }
    };

    fetchUserData();

    return () => {
      isMounted = false;
    };
  }, [selectedUserId, selectedUser, appdatabase]);

  // ✅ Merge selectedUser with fetched userData
  const mergedUser = useMemo(() => {
    if (!userData) return selectedUser;
    return {
      ...selectedUser,
      displayName: selectedUser?.displayName || selectedUser?.sender || selectedUser?.userName || 'Unknown User', // ✅ Added displayName
      robloxUsername: selectedUser?.robloxUsername || userData.robloxUsername,
      robloxUserId: selectedUser?.robloxUserId || userData.robloxUserId,
      robloxUsernameVerified: selectedUser?.robloxUsernameVerified !== undefined
        ? selectedUser.robloxUsernameVerified
        : userData.robloxUsernameVerified,
      isPro: selectedUser?.isPro !== undefined ? selectedUser.isPro : userData.isPro,
      isModerator: selectedUser?.isModerator !== undefined ? selectedUser.isModerator : userData.isModerator,
      isAdmin: selectedUser?.isAdmin !== undefined ? selectedUser.isAdmin : userData.isAdmin,
      email: selectedUser?.email || selectedUser?.decodedEmail || selectedUser?.user?.email || userData.email || userData.decodedEmail,
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

  // ✅ Memoize formatCreatedAt
  const formatCreatedAt = useCallback((timestamp) => {
    if (!timestamp) return null;

    const now = Date.now();
    const diffMs = now - timestamp;

    if (diffMs < 0) return null;

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return t('settings.time.just_now');
    if (minutes < 60) return t(minutes === 1 ? 'settings.time.min_ago_one' : 'settings.time.min_ago_other', { count: minutes });

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t(hours === 1 ? 'settings.time.hour_ago_one' : 'settings.time.hour_ago_other', { count: hours });

    const days = Math.floor(hours / 24);
    if (days < 30) return t(days === 1 ? 'settings.time.day_ago_one' : 'settings.time.day_ago_other', { count: days });

    const months = Math.floor(days / 30);
    if (months < 12) return t(months === 1 ? 'settings.time.month_ago_one' : 'settings.time.month_ago_other', { count: months });

    const years = Math.floor(months / 12);
    return t(years === 1 ? 'settings.time.year_ago_one' : 'settings.time.year_ago_other', { count: years });
  }, [t]);

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
      Alert.alert("Error", "User email not found.");
      return;
    }

    const durationLabel = strikeCount === 1 ? '3 hours' : strikeCount === 2 ? '3 days' : 'Permanent';

    const confirm = await new Promise((resolve) => {
      Alert.alert(
        `Apply Strike ${strikeCount}`,
        `Are you sure you want to apply Strike ${strikeCount} (${durationLabel}) to ${userName}?`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Apply", style: "destructive", onPress: () => resolve(true) }
        ]
      );
    });

    if (!confirm) return;

    const currentUser = auth().currentUser;
    const success = await setUserStrike(mergedUser.email, strikeCount, currentUser?.uid, true, {
      id: currentUser?.uid,
      displayName: currentUser?.displayName || 'Admin',
      avatar: currentUser?.photoURL
    }, mergedUser);
    if (success) setIsBanned(true);
  };

  const handleBanUser = async () => {
    if (!mergedUser?.email) {
      Alert.alert("Error", "User email not found.");
      return;
    }

    const confirm = await new Promise((resolve) => {
      Alert.alert(
        "Ban User",
        `Are you sure you want to ban ${userName}? This will block them from the app.`,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Ban", style: "destructive", onPress: () => resolve(true) }
        ]
      );
    });

    if (!confirm) return;

    const currentUser = auth().currentUser;
    const success = await banUserwithEmail(mergedUser.email, isAdmin, selectedUserId, mergedUser, {
      id: currentUser?.uid,
      displayName: currentUser?.displayName || 'Admin',
      avatar: currentUser?.photoURL
    });

    if (success) setIsBanned(true);
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
      setCreatedAtText(null);
      setUserPoints(null);
      setGameWins(null);
      setUserData(null); // ✅ Clear fetched user data
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
        const [summaryDocSnap, createdSnap, rewardPointsSnap, reviewDocSnap, countSnapshot] = await Promise.all([
          getDoc(doc(firestoreDB, 'user_ratings_summary', selectedUserId)),
          get(ref(appdatabase, `users/${selectedUserId}/createdAt`)),
          get(ref(appdatabase, `users/${selectedUserId}/rewardPoints`)).catch(() => null),
          getDoc(doc(firestoreDB, 'reviews', selectedUserId)), // ✅ Load bio from Firestore
          // ✅ Load Follower Count (Efficient Aggregation)
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
        if (summaryDocSnap.exists) {
          const summaryData = summaryDocSnap.data();
          setRatingSummary({
            value: Number(summaryData.averageRating || 0),
            count: Number(summaryData.count || 0),
          });
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

        // ✅ Load bio from Firestore reviews/{userId}
        let bioValue = null;
        if (reviewDocSnap.exists) { // ✅ Firestore: exists is a property, not a function
          const reviewData = reviewDocSnap.data();
          if (reviewData.bio && typeof reviewData.bio === 'string' && reviewData.bio.trim()) {
            bioValue = reviewData.bio.trim();
          }
        }
        // ✅ Set bio value (use default if not found or empty)
        setUserBio(bioValue || t('profile.bio_default'));

        if (createdSnap.exists()) {
          const raw = createdSnap.val();
          let ts = typeof raw === 'number' ? raw : Date.parse(raw);
          if (!Number.isNaN(ts)) {
            setCreatedAtText(formatCreatedAt(ts));
          } else {
            setCreatedAtText(null);
          }
        } else {
          setCreatedAtText(null);
        }

        // ✅ Load user points (RTDB)
        // ✅ Use rewardPointsSnap instead of full user object
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
        const reviewDocSnap = await getDoc(
          doc(firestoreDB, 'reviews', selectedUserId),
        );

        if (!isMounted) return;

        if (reviewDocSnap.exists) {
          const data = reviewDocSnap.data() || {};
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

  const loadReviews = useCallback(async (reset = false) => {
    if (!firestoreDB || !selectedUserId) return;

    // ✅ Prevent duplicate calls using ref (avoids dependency issues)
    if (isLoadingRef.current) {
      console.log('🔄 [BottomDrawer] Already loading reviews, skipping...');
      return;
    }

    isLoadingRef.current = true;
    setLoadingReviews(true);
    try {
      // ✅ Fetch one extra document to check if there are more reviews
      // This prevents showing "load more" when there's exactly REVIEWS_PAGE_SIZE reviews
      let q;
      if (!reset && lastReviewDocRef.current) {
        q = query(
          collection(firestoreDB, 'reviews'),
          where('toUserId', '==', selectedUserId),
          orderBy('updatedAt', 'desc'),
          startAfter(lastReviewDocRef.current),
          limit(REVIEWS_PAGE_SIZE + 1), // ✅ Fetch one extra to check if more exist
        );
      } else {
        q = query(
          collection(firestoreDB, 'reviews'),
          where('toUserId', '==', selectedUserId),
          orderBy('updatedAt', 'desc'),
          limit(REVIEWS_PAGE_SIZE + 1), // ✅ Fetch one extra to check if more exist
        );
      }

      const snap = await getDocs(q);

      // ✅ Check if we got more than page size (means there are more reviews)
      const hasMoreResults = snap.docs.length > REVIEWS_PAGE_SIZE;

      // ✅ Only take REVIEWS_PAGE_SIZE documents (discard the extra one)
      const docsToUse = snap.docs.slice(0, REVIEWS_PAGE_SIZE);

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

      // ✅ Fix: hasMoreReviews is true only if we got more results than page size
      // This accurately detects if there are more reviews without false positives
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
    loadReviews(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, selectedUserId, loadDetails]); // ✅ Removed loadReviews from deps to prevent re-renders

  // ✅ Memoize handleLoadMoreReviews
  const handleLoadMoreReviews = useCallback(() => {
    if (!hasMoreReviews || loadingReviews) return;
    loadReviews(false);
  }, [hasMoreReviews, loadingReviews, loadReviews]);

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
      <Text style={{ color: '#FFD700', fontSize: 14, fontWeight: '600' }}>
        {full}
        <Text style={{ color: '#999' }}>{empty}</Text>
      </Text>
    );
  }, []);

  const renderPetBubble = useCallback((pet, index) => {
    // ✅ Safety checks
    if (!pet || typeof pet !== 'object') return null;

    const valueType = (pet.valueType || 'd').toLowerCase();
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
          backgroundColor: isDarkMode ? '#0f172a' : '#e5e7eb',
        }}
      >
        <Image
          source={{ uri: pet.imageUrl || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
          style={{ width: '100%', height: '100%' }}
        />
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
          backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
          borderRadius: 12,
          padding: 10,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
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
              <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#6b7280' }}>
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
            color: isDarkMode ? '#d1d5db' : '#4b5563',
            marginTop: 6,
            paddingTop: 6,
            borderTopWidth: 1,
            borderTopColor: isDarkMode ? '#1f2937' : '#e5e7eb',
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
    const imageUrl = Array.isArray(post.imageUrl) && post.imageUrl.length > 0 ? post.imageUrl[0] : (typeof post.imageUrl === 'string' ? post.imageUrl : null);

    return (
      <View
        key={post.id}
        style={{
          borderBottomWidth: 1,
          borderBottomColor: isDarkMode ? '#1f2937' : '#e5e7eb',
          paddingVertical: 8,
          flexDirection: 'row',
          alignItems: 'center'
        }}
      >
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={{ width: 50, height: 50, borderRadius: 8, backgroundColor: '#ddd' }}
            resizeMode="cover"
          />
        ) : (
          <View style={{ width: 50, height: 50, borderRadius: 8, backgroundColor: isDarkMode ? '#1f2937' : '#e5e7eb', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="image-outline" size={20} color={isDarkMode ? '#6b7280' : '#9ca3af'} />
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 10, justifyContent: 'center' }}>
          <Text
            style={{
              fontSize: 12,
              fontWeight: '500',
              color: isDarkMode ? '#f3f4f6' : '#111827',
              marginBottom: 4
            }}
            numberOfLines={2}
          >
            {post.desc || t('feed.no_description')}
          </Text>
          <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#6b7280' }}>
            {timeLabel}
          </Text>
        </View>
      </View>
    );
  }, [isDarkMode, t]);

  // ─────────────────────────────────────────────
  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={toggleModal}
    >
      {/* Overlay */}
      <Pressable style={styles.overlay} onPress={toggleModal} />

      {/* Drawer Content */}
      <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={styles.drawer}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: 480 }}
          >
            {/* HEADER: user row */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <View style={{ flexDirection: 'row', flex: 1, marginRight: 8 }}>
                {/* Avatar with Online Indicator - matches OnlineUsersList.jsx structure */}
                <View style={{ position: 'relative', marginRight: 12 }}>
                  <Image
                    source={{
                      uri: avatar
                        ? avatar
                        : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                    }}
                    style={styles.profileImage2}
                  />
                  {/* Online/Offline Indicator - attached to avatar bottom-right */}
                  <View
                    style={{
                      position: 'absolute',
                      bottom: 1,
                      right: 1,
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: isOnline ? '#10B981' : '#9CA3AF', // Green for online, gray for offline
                      borderWidth: 2,
                      borderColor: isDarkMode ? '#1F2937' : '#FFFFFF',
                      zIndex: 10, // Ensure it's above the image
                    }}
                  />
                </View>

                <View style={{ justifyContent: 'center', flex: 1, marginRight: 8 }}>
                  {/* Username Row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Text
                      style={[styles.drawerSubtitleUser, { flexShrink: 1 }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {userName}{' '}
                      {mergedUser?.isPro && (
                        <Image
                          source={require('../../../assets/pro.png')}
                          style={{ width: 10, height: 10 }}
                        />
                      )}{' '}
                      {selectedUser?.flage ? selectedUser.flage : ''}
                    </Text>

                    {/* Admin / Mod Badge */}
                    {mergedUser?.isAdmin && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#EF4444', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12, marginLeft: 6 }}>
                        <Icon name="shield" size={10} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', marginLeft: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('chat.admin')}</Text>
                      </View>
                    )}
                    {!mergedUser?.isAdmin && mergedUser?.isModerator && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#8B5CF6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12, marginLeft: 6 }}>
                        <Icon name="shield-checkmark" size={10} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', marginLeft: 2, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('chat.mod')}</Text>
                      </View>
                    )}
                    <Icon
                      name="copy-outline"
                      size={16}
                      color="#007BFF"
                      style={{ marginLeft: 8 }}
                      onPress={() => copyToClipboard(userName)}
                    />
                  </View>
                  <View style={{ alignItems: 'flex-start', justifyContent: 'center' }}>
                    {/* Roblox Badge */}
                    {mergedUser?.robloxUsername ? (
                      <View style={{
                        backgroundColor: mergedUser?.robloxUsernameVerified ? '#4CAF50' : '#FFA500',
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 4,
                        marginBottom: 4,
                        marginTop: 2,
                      }}>
                        <Text style={{
                          color: '#FFFFFF',
                          fontSize: 9,
                          fontWeight: '600'
                        }}>
                          {mergedUser?.robloxUsernameVerified ? '✓ Verified' : '⚠ Unverified'}
                        </Text>
                      </View>
                    ) : (
                      <View style={{
                        backgroundColor: '#9CA3AF',
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 4,
                        marginVertical: 4,
                      }}>
                        <Text style={{
                          color: '#FFFFFF',
                          fontSize: 9,
                          fontWeight: '600'
                        }}>
                          No Roblox ID
                        </Text>
                      </View>
                    )}
                  </View>
                  {/* Roblox Username Display */}
                  {/* {mergedUser?.robloxUsername && (
                    <Text
                      style={{
                        fontSize: 11,
                        color: '#00A8FF', // Nice blue color for Roblox
                        marginTop: 4,
                        fontWeight: '500',
                      }}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      @{mergedUser.robloxUsername}
                    </Text>
                    
                  )} */}


                </View>

                {/* Right Side: Badges */}

              </View>

              {/* Ban/Unban Icon */}
              <TouchableOpacity onPress={handleBanToggle}>
                <Icon
                  name={isBlock ? 'shield-checkmark-outline' : 'ban-outline'}
                  size={30}
                  color={
                    isBlock
                      ? config.colors.hasBlockGreen
                      : config.colors.wantBlockRed
                  }
                />
              </TouchableOpacity>
            </View>

            {/* ⭐ Rating summary - Below profile picture section */}
            {loadDetails && (
              <View style={{ marginBottom: 12, marginTop: 8 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginBottom: 8,
                  }}
                >
                  {loadingRating ? (
                    <ActivityIndicator
                      size="small"
                      color={config.colors.primary}
                    />
                  ) : ratingSummary ? (
                    <>
                      {renderStars(ratingSummary.value)}
                      <Text
                        style={{
                          marginLeft: 6,
                          fontSize: 12,
                          color: isDarkMode ? '#e5e7eb' : '#4b5563',
                        }}
                      >
                        {ratingSummary.value.toFixed(1)} / 5 ·{' '}
                        {t('reviews.rating_count', { count: ratingSummary.count })}
                      </Text>
                    </>
                  ) : (
                    <Text
                      style={{
                        fontSize: 12,
                        color: isDarkMode ? '#9ca3af' : '#6b7280',
                      }}
                    >
                      {t('settings.not_rated')}
                    </Text>
                  )}

                  {!loadingRating && createdAtText && (
                    <Text
                      style={{
                        fontSize: 10,
                        backgroundColor: '#16A34A',
                        paddingHorizontal: 5,
                        borderRadius: 4,
                        paddingVertical: 1,
                        color: 'white',
                        marginLeft: 5,
                      }}
                    >
                      {t('settings.joined', { time: createdAtText })}
                    </Text>
                  )}
                </View>

                {/* 💰 Points and Game Wins */}
                {!loadingRating && (userPoints !== null || gameWins !== null) && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    {userPoints !== null && userPoints > 0 && (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: isDarkMode ? '#1e293b' : '#f0f9ff',
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#334155' : '#bae6fd',
                        }}
                      >
                        <Icon name="diamond" size={14} color="#10B981" />
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: 'bold',
                            color: isDarkMode ? '#10B981' : '#059669',
                            marginLeft: 4,
                          }}
                        >
                          {Number(userPoints).toLocaleString()} {t('profile.pts')}
                        </Text>
                      </View>
                    )}
                    {gameWins !== null && gameWins > 0 && (
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          backgroundColor: isDarkMode ? '#1e293b' : '#fef3c7',
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#334155' : '#fde68a',
                        }}
                      >
                        <Icon name="trophy" size={12} color="#F59E0B" />
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: 'bold',
                            color: isDarkMode ? '#F59E0B' : '#D97706',
                            marginLeft: 4,
                          }}
                        >
                          {gameWins}x {t('profile.win_count')}
                        </Text>
                      </View>
                    )}
                    {/* ✅ Followers Count */}
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: isDarkMode ? '#1e293b' : '#e0e7ff',
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: isDarkMode ? '#334155' : '#c7d2fe',
                      }}
                    >
                      <Icon name="people" size={12} color="#6366f1" />
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: 'bold',
                          color: isDarkMode ? '#a5b4fc' : '#4f46e5',
                          marginLeft: 4,
                        }}
                      >
                        {followersCount || 0} Followers
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            )}
            {/* 📝 Bio Section */}
            {loadDetails && (
              <View
                style={{
                  borderRadius: 12,
                  padding: 12,
                  backgroundColor: isDarkMode ? '#0f172a' : '#f3f4f6',
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '500',
                    marginBottom: 6,
                    color: isDarkMode ? '#9ca3af' : '#6b7280',
                  }}
                >
                  {t('profile.bio')}
                </Text>
                <Text
                  style={{
                    fontSize: 13,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                    lineHeight: 18,
                  }}
                >
                  {userBio || 'Hi there, I am new here'}
                </Text>
              </View>
            )}
            {/* 🐾 Pets section */}
            {loadDetails && (
              <View
                style={{
                  borderRadius: 12,
                  padding: 10,
                  backgroundColor: isDarkMode ? '#0f172a' : '#f3f4f6',
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    marginBottom: 6,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                  }}
                >
                  {t('home.categories.pets')}
                </Text>

                {loadingPets ? (
                  <ActivityIndicator
                    size="small"
                    color={config.colors.primary}
                  />
                ) : (
                  <>
                    {/* Owned */}
                    <View style={{ marginBottom: 8 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '500',
                            color: isDarkMode ? '#e5e7eb' : '#111827',
                          }}
                        >
                          {t('profile.pets.owned_title')}
                        </Text>
                      </View>

                      {ownedPets.length === 0 ? (
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#9ca3af' : '#6b7280',
                          }}
                        >
                          {t('profile.no_pets_listed')}
                        </Text>
                      ) : (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ paddingRight: 6 }}
                        >
                          <View style={{ flexDirection: 'row' }}>
                            {ownedPets.map((pet, index) =>
                              renderPetBubble(pet, index),
                            )}
                          </View>
                        </ScrollView>
                      )}
                    </View>

                    {/* Wishlist */}
                    <View>
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          marginBottom: 4,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            fontWeight: '500',
                            color: isDarkMode ? '#e5e7eb' : '#111827',
                          }}
                        >
                          {t('profile.pets.wishlist_title')}
                        </Text>
                      </View>

                      {wishlistPets.length === 0 ? (
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#9ca3af' : '#6b7280',
                          }}
                        >
                          {t('profile.no_wishlist_pets')}
                        </Text>
                      ) : (
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={{ paddingRight: 6 }}
                        >
                          <View style={{ flexDirection: 'row' }}>
                            {wishlistPets.map((pet, index) =>
                              renderPetBubble(pet, index),
                            )}
                          </View>
                        </ScrollView>
                      )}
                    </View>
                  </>
                )}
              </View>
            )}

            {/* 📝 Reviews section */}
            {loadDetails && (
              <View
                style={{
                  borderRadius: 12,
                  padding: 10,
                  backgroundColor: isDarkMode ? '#020617' : '#f3f4f6',
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    marginBottom: 6,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                  }}
                >
                  {t('profile.recent_reviews')}
                </Text>

                {loadingReviews && reviews.length === 0 ? (
                  <ActivityIndicator
                    size="small"
                    color={config.colors.primary}
                  />
                ) : reviews.length === 0 ? (
                  <Text
                    style={{
                      fontSize: 11,
                      color: isDarkMode ? '#9ca3af' : '#6b7280',
                    }}
                  >
                    {t('profile.no_reviews_yet')}
                  </Text>
                ) : (
                  <>
                    {reviews.map((rev) => {
                      const tsMs = getTimestampMs(
                        rev.updatedAt || rev.createdAt,
                      );
                      const timeLabel = tsMs ? formatCreatedAt(tsMs) : null;

                      return (
                        <View
                          key={rev.id}
                          style={{
                            paddingVertical: 4,
                            paddingHorizontal: 4,
                            borderBottomWidth: 1,
                            borderBottomColor: isDarkMode
                              ? '#1f2937'
                              : '#e5e7eb',
                          }}
                        >
                          <View
                            style={{
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              alignItems: 'flex-start',
                              marginBottom: 4,
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontWeight: '600',
                                  color: isDarkMode ? '#e5e7eb' : '#111827',
                                  marginBottom: 2,
                                }}
                              >
                                {rev.userName || t('profile.anonymous')}
                              </Text>
                              {!!rev?.review && (
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: isDarkMode ? '#d1d5db' : '#4b5563',
                                    lineHeight: 16,
                                  }}
                                >
                                  {rev.review}
                                </Text>
                              )}
                              {rev?.edited && (
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: isDarkMode ? '#9ca3af' : '#9ca3af',
                                    marginTop: 2,
                                  }}
                                >
                                  {t('reviews.edited')}
                                </Text>
                              )}
                            </View>

                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              {timeLabel && (
                                <Text
                                  style={{
                                    fontSize: 10,
                                    color: isDarkMode ? '#9ca3af' : '#9ca3af',
                                  }}
                                >
                                  {timeLabel}
                                </Text>
                              )}
                              {renderStars(rev?.rating || 0)}
                            </View>
                          </View>
                        </View>
                      );
                    })}

                    {hasMoreReviews && !loadingReviews && (
                      <TouchableOpacity
                        onPress={handleLoadMoreReviews}
                        style={{
                          marginTop: 8,
                          alignSelf: 'center',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#e5e7eb' : '#111827',
                          }}
                        >
                          {t('profile.load_more_reviews')}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {loadingReviews && hasMoreReviews && (
                      <ActivityIndicator
                        size="small"
                        color={config.colors.primary}
                        style={{ marginTop: 6, alignSelf: 'center' }}
                      />
                    )}
                  </>
                )}
              </View>
            )}

            {/* 💼 Trades section */}
            {loadDetails && (
              <View
                style={{
                  borderRadius: 12,
                  padding: 10,
                  backgroundColor: isDarkMode ? '#020617' : '#f3f4f6',
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    marginBottom: 6,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                  }}
                >
                  {t('profile.recent_trades')}
                </Text>

                {loadingTrades && trades.length === 0 ? (
                  <ActivityIndicator
                    size="small"
                    color={config.colors.primary}
                  />
                ) : trades.length === 0 ? (
                  <Text
                    style={{
                      fontSize: 11,
                      color: isDarkMode ? '#9ca3af' : '#6b7280',
                    }}
                  >
                    {t('profile.no_trades_yet')}
                  </Text>
                ) : (
                  <>
                    {trades.map((trade) => renderTradeItem(trade))}

                    {hasMoreTrades && !loadingTrades && (
                      <TouchableOpacity
                        onPress={handleLoadMoreTrades}
                        style={{
                          marginTop: 8,
                          alignSelf: 'center',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#e5e7eb' : '#111827',
                          }}
                        >
                          {t('profile.load_more_trades')}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {loadingTrades && hasMoreTrades && (
                      <ActivityIndicator
                        size="small"
                        color={config.colors.primary}
                        style={{ marginTop: 6, alignSelf: 'center' }}
                      />
                    )}
                  </>
                )}
              </View>
            )}

            {/* 🖼️ Posts section */}
            {loadDetails && (
              <View
                style={{
                  borderRadius: 12,
                  padding: 10,
                  backgroundColor: isDarkMode ? '#020617' : '#f3f4f6',
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: '600',
                    marginBottom: 6,
                    color: isDarkMode ? '#e5e7eb' : '#111827',
                  }}
                >
                  {t('feed.recent_posts') || 'Recent Posts'}
                </Text>

                {loadingPosts && posts.length === 0 ? (
                  <ActivityIndicator
                    size="small"
                    color={config.colors.primary}
                  />
                ) : posts.length === 0 ? (
                  <Text
                    style={{
                      fontSize: 11,
                      color: isDarkMode ? '#9ca3af' : '#6b7280',
                    }}
                  >
                    {t('feed.no_posts_found') || 'No posts yet'}
                  </Text>
                ) : (
                  <>
                    {posts.map((post) => renderPostItem(post))}

                    {hasMorePosts && !loadingPosts && (
                      <TouchableOpacity
                        onPress={handleLoadMorePosts}
                        style={{
                          marginTop: 8,
                          alignSelf: 'center',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: isDarkMode ? '#4b5563' : '#d1d5db',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#e5e7eb' : '#111827',
                          }}
                        >
                          {t('feed.load_more') || 'Load More'}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {loadingPosts && hasMorePosts && (
                      <ActivityIndicator
                        size="small"
                        color={config.colors.primary}
                        style={{ marginTop: 6, alignSelf: 'center' }}
                      />
                    )}
                  </>
                )}
              </View>
            )}

            {/* View details button */}
            {!loadDetails && (
              <TouchableOpacity
                style={styles.saveButtonProfile}
                onPress={() => setLoadDetails(true)}
              >
                <Text
                  style={[
                    styles.saveButtonTextProfile,
                    { color: isDarkMode ? 'white' : 'black' },
                  ]}
                >
                  {t('profile.view_detail_profile')}
                </Text>
              </TouchableOpacity>
            )}

            {/* Roblox Profile Button */}
            {mergedUser?.robloxUsername && (
              <TouchableOpacity
                style={[styles.saveButton, {
                  backgroundColor: isDarkMode ? '#4A90E2' : '#007AFF',
                  marginBottom: 8,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                }]}
                onPress={handleOpenRobloxProfile}
              >
                <Icon
                  name="game-controller-outline"
                  size={16}
                  color="#FFFFFF"
                  style={{ marginRight: 6 }}
                />
                <Text style={[styles.saveButtonText, { color: '#FFFFFF' }]}>
                  {t('profile.view_roblox_profile')}
                </Text>
              </TouchableOpacity>
            )}

            {/* 🛡️ Moderator/Admin Actions */}
            {(isAdmin || user?.isModerator) && (
              <View style={{
                marginTop: 10,
                padding: 10,
                backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
                borderRadius: 8,
                marginBottom: 10,
                borderLeftWidth: 4,
                borderLeftColor: config.colors.wantBlockRed
              }}>
                <Text style={{
                  fontSize: 12,
                  fontWeight: 'bold',
                  color: isDarkMode ? '#94a3b8' : '#64748b',
                  marginBottom: 8
                }}>
                  {isAdmin ? "Admin Actions" : "Moderator Actions"}
                </Text>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {/* Strike Actions */}
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ fontSize: 11, color: isDarkMode ? '#94a3b8' : '#64748b', marginBottom: 4, fontWeight: '600' }}>
                      Server Strikes:
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                      {[1, 2, 3].map((strike) => (
                        <TouchableOpacity
                          key={strike}
                          onPress={() => handleApplyStrike(strike)}
                          style={{
                            backgroundColor: strike === 1 ? '#F97316' : strike === 2 ? '#DC2626' : '#991B1B', // Orange / Red / Dark Red
                            paddingVertical: 6,
                            paddingHorizontal: 10,
                            borderRadius: 6,
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 11 }}>
                            Strike {strike}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>

                  {/* Unban Button (Only if banned) */}
                  {isBanned && (
                    <TouchableOpacity
                      onPress={handleUnbanUser}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: '#10B981',
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                        borderRadius: 6,
                        alignSelf: 'flex-end',
                        marginBottom: 5
                      }}
                    >
                      <Icon name="checkmark-circle-outline" size={16} color="white" />
                      <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 12, marginLeft: 4 }}>
                        Unban User
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Promote/Demote Moderator (Admin Only) */}
                  {isAdmin && (
                    <TouchableOpacity
                      onPress={mergedUser?.isModerator ? handleDemoteModerator : handlePromoteModerator}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        // backgroundColor: mergedUser?.isModerator ? '#F59E0B' : '#3B82F6',
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderRadius: 6,
                        marginLeft: 8,
                        alignSelf: 'flex-end',
                      }}
                    >
                      <Icon name={mergedUser?.isModerator ? "arrow-down-circle-outline" : "shield-outline"} size={16} color="white" />
                      <Text style={{ color: mergedUser?.isModerator ? '#F59E0B' : '#3B82F6', fontWeight: 'bold', fontSize: 12, marginLeft: 4 }}>
                        {mergedUser?.isModerator ? "Remove Mod" : "Make Mod"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {/* Follow / Unfollow Button */}
            {!fromPvtChat && user?.id !== selectedUserId && (
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  {
                    backgroundColor: isFollowing ? '#8E8E93' : config.colors.primary,
                    marginBottom: 10,
                    flexDirection: 'row',
                    justifyContent: 'center',
                    alignItems: 'center'
                  }
                ]}
                onPress={handleFollowToggle}
                disabled={followLoading}
              >
                {followLoading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Icon name={isFollowing ? "person-remove-outline" : "person-add-outline"} size={18} color="#FFF" style={{ marginRight: 8 }} />
                    <Text style={styles.saveButtonText}>
                      {isFollowing ? t('social.unfollow') || 'Unfollow' : t('social.follow') || 'Follow'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Start chat button */}
            {!fromPvtChat && (
              <TouchableOpacity style={styles.saveButton} onPress={handleStartChat}>
                <Text style={styles.saveButtonText}>
                  {t('chat.start_chat')}
                </Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

export default ProfileBottomDrawer;
