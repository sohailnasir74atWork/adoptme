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
  serverTimestamp,
} from '@react-native-firebase/firestore';
import { ref, get } from '@react-native-firebase/database';
import dayjs from 'dayjs';
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
  const { theme, firestoreDB, appdatabase } = useGlobalState();
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

  // toggle details
  const [loadDetails, setLoadDetails] = useState(false);

  // ✅ State for fetched user data (roblox username, verified status, etc.)
  const [userData, setUserData] = useState(null);

  // ✅ Fetch user data from Firebase if roblox data is missing
  useEffect(() => {
    if (!selectedUserId || !appdatabase) return;
    
    // Only fetch if robloxUsername is not already in selectedUser
    if (selectedUser?.robloxUsername || selectedUser?.robloxUserId) {
      setUserData(null); // Clear fetched data if already in selectedUser
      return;
    }

    let isMounted = true;

    const fetchUserData = async () => {
      try {
        // ✅ OPTIMIZED: Fetch only specific fields instead of full user object
        const [robloxUsernameSnap, robloxUserIdSnap, robloxUsernameVerifiedSnap, 
               isProSnap, lastGameWinAtSnap] = await Promise.all([
          get(ref(appdatabase, `users/${selectedUserId}/robloxUsername`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/robloxUserId`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/robloxUsernameVerified`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/isPro`)).catch(() => null),
          get(ref(appdatabase, `users/${selectedUserId}/lastGameWinAt`)).catch(() => null),
        ]);
        
        if (!isMounted) return;
        
        // ✅ Extract values only if they exist
        setUserData({
          robloxUsername: robloxUsernameSnap?.exists() ? robloxUsernameSnap.val() : null,
          robloxUserId: robloxUserIdSnap?.exists() ? robloxUserIdSnap.val() : null,
          robloxUsernameVerified: robloxUsernameVerifiedSnap?.exists() ? robloxUsernameVerifiedSnap.val() : false,
          isPro: isProSnap?.exists() ? isProSnap.val() : false,
          lastGameWinAt: lastGameWinAtSnap?.exists() ? lastGameWinAtSnap.val() : null,
        });
      } catch (error) {
        console.error('Error fetching user data in BottomDrawer:', error);
        if (isMounted) setUserData(null);
      }
    };

    fetchUserData();

    return () => {
      isMounted = false;
    };
  }, [selectedUserId, selectedUser?.robloxUsername, selectedUser?.robloxUserId, appdatabase]);

  // ✅ Merge selectedUser with fetched userData
  const mergedUser = useMemo(() => {
    if (!userData) return selectedUser;
    return {
      ...selectedUser,
      robloxUsername: selectedUser?.robloxUsername || userData.robloxUsername,
      robloxUserId: selectedUser?.robloxUserId || userData.robloxUserId,
      robloxUsernameVerified: selectedUser?.robloxUsernameVerified !== undefined 
        ? selectedUser.robloxUsernameVerified 
        : userData.robloxUsernameVerified,
      isPro: selectedUser?.isPro !== undefined ? selectedUser.isPro : userData.isPro,
    };
  }, [selectedUser, userData]);

  // ─────────────────────────────────────────────
  // Clipboard
  const copyToClipboard = (code) => {
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t('value.copy'), 'Copied to Clipboard');
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
        Alert.alert('Error', 'Could not open Roblox profile. Missing username or user ID.');
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
      Alert.alert('Error', 'Could not open Roblox profile. Please try again.');
    }
  }, [mergedUser?.robloxUsername, mergedUser?.robloxUserId, triggerHapticFeedback]);

  // ✅ Memoize formatCreatedAt
  const formatCreatedAt = useCallback((timestamp) => {
    if (!timestamp) return null;

    const now = Date.now();
    const diffMs = now - timestamp;

    if (diffMs < 0) return null;

    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;

    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? '' : 's'} ago`;
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
        const [summaryDocSnap, createdSnap, rewardPointsSnap, reviewDocSnap] = await Promise.all([
          getDoc(doc(firestoreDB, 'user_ratings_summary', selectedUserId)),
          get(ref(appdatabase, `users/${selectedUserId}/createdAt`)),
          get(ref(appdatabase, `users/${selectedUserId}/rewardPoints`)).catch(() => null),
          getDoc(doc(firestoreDB, 'reviews', selectedUserId)), // ✅ Load bio from Firestore
        ]);

        if (!isMounted) return;

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
        setUserBio(bioValue || 'Hi there, I am new here');

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
      const rawData = localState.isGG ? localState.ggData : localState.data;
      if (!rawData) return [];

      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch (error) {
      console.error("❌ Error parsing data:", error);
      return [];
    }
  }, [localState.isGG, localState.data, localState.ggData]);

  // ✅ Render trade item
  const renderTradeItem = useCallback((trade) => {
    const { deal, tradeRatio } = getTradeDeal(trade.hasTotal, trade.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));
    const isProfit = tradeRatio > 1;
    const neutral = tradeRatio === 1;
    const formattedTime = trade.timestamp ? dayjs(trade.timestamp.toDate()).fromNow() : "Unknown";
    const isGG = trade.isSharkMode === 'GG';

    const groupedHasItems = groupTradeItems(trade.hasItems || []);
    const groupedWantsItems = groupTradeItems(trade.wantsItems || []);

    // Helper to get adoptme image URL (matching Trades.jsx getImageUrl)
    const getTradeItemImageUrl = (item) => {
      if (!item || !item.name) return '';
      
      const baseImgUrl = isGG ? localState.imgurlGG : localState.imgurl;
      if (!baseImgUrl) return '';
      
      if (isGG) {
        const encoded = encodeURIComponent(item.name);
        return `${baseImgUrl.replace(/"/g, '')}/items/${encoded}.webp`;
      }
      
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
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>FEATURED</Text>
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
                    {trade.status === 'w' ? 'Win' : trade.status === 'f' ? 'Fair' : 'Lose'}
                  </Text>
                </View>
              )}
              {/* Shark/Frost/GG Badge */}
              {trade.isSharkMode !== undefined && (
                <View style={{
                  backgroundColor: trade.isSharkMode == 'GG' ? '#5c4c49' : trade.isSharkMode === true ? config.colors.secondary : config.colors.hasBlockGreen,
                  paddingVertical: 1,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  flexShrink: 0,
                  flexGrow: 0,
                }}>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>
                    {trade.isSharkMode == 'GG' ? 'GG Values' : trade.isSharkMode === true ? 'Shark' : 'Frost'}
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
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>Give offer</Text>
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
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>Give offer</Text>
              </View>
            </View>
          )}
        </View>
        
        {/* Trade Totals - Matching Trades.jsx structure */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', width: '100%', marginTop: 10 }}>
          {trade.hasItems && trade.hasItems.length > 0 && (
            <Text style={{ 
              fontSize: 8, 
              fontFamily: 'Lato-Bold', 
              color: 'white', 
              textAlign: 'center', 
              alignSelf: 'center', 
              marginHorizontal: 'auto', 
              paddingHorizontal: 4, 
              paddingVertical: 2, 
              borderRadius: 6,
              backgroundColor: config.colors.hasBlockGreen
            }}>
              ME: {formatTradeValue(typeof trade.hasTotal === 'number' ? trade.hasTotal : trade.hasTotal?.value || 0)}
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
                        <Text style={{ fontSize: 8, fontFamily: 'Lato-Bold', color: 'green', textAlign: 'center', alignSelf: 'center', marginHorizontal: 'auto', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6 }}>
                          {formatTradeValue(hasValue - wantsValue)}
                        </Text>
                      </View>
                    );
                  } else if (hasValue < wantsValue) {
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="arrow-down-outline" size={12} color={config.colors.hasBlockGreen} />
                        <Text style={{ fontSize: 8, fontFamily: 'Lato-Bold', color: config.colors.hasBlockGreen, textAlign: 'center', alignSelf: 'center', marginHorizontal: 'auto', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6 }}>
                          {formatTradeValue(wantsValue - hasValue)}
                        </Text>
                      </View>
                    );
                  } else {
                    return <Text style={{ fontSize: 8, fontFamily: 'Lato-Bold', color: config.colors.primary, textAlign: 'center' }}>-</Text>;
                  }
                })()}
              </>
            )}
          </View>
          {trade.wantsItems && trade.wantsItems.length > 0 && (
            <Text style={{ 
              fontSize: 8, 
              fontFamily: 'Lato-Bold', 
              color: 'white', 
              textAlign: 'center', 
              alignSelf: 'center', 
              marginHorizontal: 'auto', 
              paddingHorizontal: 4, 
              paddingVertical: 2, 
              borderRadius: 6,
              backgroundColor: config.colors.wantBlockRed
            }}>
              YOU: {formatTradeValue(typeof trade.wantsTotal === 'number' ? trade.wantsTotal : trade.wantsTotal?.value || 0)}
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
  }, [isDarkMode, t, localState.isGG, localState.imgurl, localState.imgurlGG, parsedValuesData]);

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
                      marginBottom: 4,
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
                        {ratingSummary.count} rating
                        {ratingSummary.count === 1 ? '' : 's'}
                      </Text>
                    </>
                  ) : (
                    <Text
                      style={{
                        fontSize: 12,
                        color: isDarkMode ? '#9ca3af' : '#6b7280',
                      }}
                    >
                      Not rated yet
                    </Text>
                  )}

                  {!loadingRating && createdAtText && (
                    <Text
                      style={{
                        fontSize: 10,
                        backgroundColor:  '#16A34A',
                        paddingHorizontal: 5,
                        borderRadius: 4,
                        paddingVertical: 1,
                        color: 'white',
                        marginLeft: 5,
                      }}
                    >
                      Joined {createdAtText}
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
                            fontFamily: 'Lato-Bold',
                            color: isDarkMode ? '#10B981' : '#059669',
                            marginLeft: 4,
                          }}
                        >
                          {Number(userPoints).toLocaleString()} pts
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
                            fontFamily: 'Lato-Bold',
                            color: isDarkMode ? '#F59E0B' : '#D97706',
                            marginLeft: 4,
                          }}
                        >
                          {gameWins}x win
                        </Text>
                      </View>
                    )}
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
                  Bio
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
                  Pets
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
                          Owned Pets
                        </Text>
                      </View>

                      {ownedPets.length === 0 ? (
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#9ca3af' : '#6b7280',
                          }}
                        >
                          No pets listed.
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
                          Wishlist
                        </Text>
                      </View>

                      {wishlistPets.length === 0 ? (
                        <Text
                          style={{
                            fontSize: 11,
                            color: isDarkMode ? '#9ca3af' : '#6b7280',
                          }}
                        >
                          No wishlist pets yet.
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
                  Recent Reviews
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
                    No reviews yet.
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
                                {rev.userName || 'Anonymous'}
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
                                  Edited
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
                          Load more reviews
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
                  Recent Trades
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
                    No trades yet.
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
                          Load more trades
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
                  View Detail Profile
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
                  View Roblox Profile
                </Text>
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
