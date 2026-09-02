import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, TextInput, Alert, Platform, Animated, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
import { getThemeColors } from '../Helper/themeColors';
import UserBadgePill, { getFirstBadgeType } from '../Helper/UserBadgePill';
import { getFollowingIds } from '../Helper/followingCache';
import { useNavigation } from '@react-navigation/native';
import ReportTradePopup from './ReportTradePopUp';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useLocalState } from '../LocalGlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import NativeAdCard from '../Ads/NativeAdCard';
import { releaseByPrefix as releaseNativeAds } from '../Ads/NativeAdManager';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import ShareTradeModal from './ShareTradeModal';
import { useHaptic } from '../Helper/HepticFeedBack';
import { getCachedProfile, warmProfileCache } from '../Helper/profileCache';
import { BADGE_IMAGES, BADGE_DEFINITIONS } from '../ChatScreen/GroupChat/badgeUtils';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import { saveTrade, unsaveTrade, fetchSavedTradeRefs, variantFilterToken, tradeMatchesVariants, tradeMatchesSearchWithVariants } from './tradeHelpers';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  Timestamp,
  where,
  query,
  startAfter,
  updateDoc,
  deleteField,
} from '@react-native-firebase/firestore';

// Initialize dayjs plugins
dayjs.extend(relativeTime);

// ✅ Only show trades from the last 7 days — keeps feed fresh, prevents stale trades
const TRADE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const getSevenDaysAgo = () => Timestamp.fromMillis(Date.now() - TRADE_MAX_AGE_MS);

// Featured trades are fetched once per feed load: 3 shown immediately, the rest
// held back and drip-fed 3 at a time by load-more. 12 covers the initial batch
// plus three load-mores without a second query, and caps the read count if the
// number of featured trades grows.
const FEATURED_FETCH_LIMIT = 12;

// Variant tag filters — narrow the feed to trades containing a Neon / Mega / Fly /
// Ride pet. Selecting several means ONE pet has to satisfy all of them, so
// Neon + Fly + Ride is the "NFR" search players actually type. Neon and Mega are
// mutually exclusive because a pet carries exactly one value type.
//
// Filtering happens in Firestore against the denormalized `variantTags` array
// (see buildVariantTags in tradeHelpers) — one array-contains clause per query.
const VALUE_TYPE_VARIANTS = ['neon', 'mega'];
const VARIANT_FILTERS = [
  { key: 'neon', color: '#2ecc71', labelKey: 'value.variant_neon', fallback: 'Neon' },
  { key: 'mega', color: '#9b59b6', labelKey: 'value.variant_mega', fallback: 'Mega' },
  { key: 'fly', color: '#3498db', labelKey: 'value.variant_fly', fallback: 'Fly' },
  { key: 'ride', color: '#e74c3c', labelKey: 'value.variant_ride', fallback: 'Ride' },
];
const VARIANT_FILTER_KEYS = VARIANT_FILTERS.map((v) => v.key);

const TradeList = ({ route }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInHas, setSearchInHas] = useState(true); // ✅ Search in "ME" side (hasItems)
  const [searchInWants, setSearchInWants] = useState(true); // ✅ Search in "YOU" side (wantsItems)
  const [isSearching, setIsSearching] = useState(false); // ✅ Loading state for search
  const [isSearchMode, setIsSearchMode] = useState(false); // ✅ Track if we're in search mode
  const [searchLastDoc, setSearchLastDoc] = useState(null); // ✅ Pagination cursor for search
  const [searchHasMore, setSearchHasMore] = useState(true); // ✅ More results available for search
  const SEARCH_PAGE_SIZE = 5; // ✅ Fetch 5 items at a time for search
  // const [isAdVisible, setIsAdVisible] = useState(true);
  const { selectedTheme } = route.params
  const { user, analytics, updateLocalStateAndDatabase, appdatabase } = useGlobalState()
  const [trades, setTrades] = useState([]);
  const [filteredTrades, setFilteredTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [showofferwall, setShowofferwall] = useState(false);
  const [remainingFeaturedTrades, setRemainingFeaturedTrades] = useState([]);
  const [openShareModel, setOpenShareModel] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [bannedUsers, setBannedUsers] = useState([]);
  const [followingIds, setFollowingIds] = useState([]);
  const [savedTradeRefs, setSavedTradeRefs] = useState({});


  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isReportPopupVisible, setReportPopupVisible] = useState(false);
  const PAGE_SIZE = 20;
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const { localState, updateLocalState } = useLocalState()
  const navigation = useNavigation()
  const { theme, firestoreDB, isAdmin } = useGlobalState()
  const [isProStatus, setIsProStatus] = useState(localState.isPro);
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();
  const isDarkMode = theme === 'dark'
  const c = getThemeColors(isDarkMode);
  const isInitialMountRef = useRef(true); // ✅ Track initial mount to prevent double fetch
  // Set synchronously the moment a search is requested. isSearchMode only flips
  // once handleSearchTrades has awaited its queries, so without this the commit
  // of staged tags re-renders first and the refetch effect would fire
  // fetchInitialTrades() and clobber the search results mid-flight.
  const searchRequestedRef = useRef(false);
  const flatListRef = useRef(null);
  const scrollButtonOpacity = useMemo(() => new Animated.Value(0), []);
  const { triggerHapticFeedback } = useHaptic();
  const [isAtTop, setIsAtTop] = useState(true);
  const formatName = (name) => {
    let formattedName = name.replace(/^\+/, '');
    formattedName = formattedName.replace(/\s+/g, '-');
    return formattedName;
  };


  // console.log(trades, 'trades')

  const [selectedFilters, setSelectedFilters] = useState([]); // ✅ Default: no filters (show all)

  // Tag chips are STAGED, not live: tapping one only marks it. Nothing re-queries
  // until the search icon is pressed, so a tap never costs a read on its own.
  // `pendingVariants` is what the chips show; the committed copy lives in
  // selectedFilters and is what actually filters.
  const [pendingVariants, setPendingVariants] = useState([]);

  // Single token matched against each trade's `variantTags` array in Firestore.
  // Null when no variant chip is active, in which case the clause is left out.
  // Declared up here because every fetch callback below closes over it.
  const activeVariantToken = useMemo(
    () => variantFilterToken(selectedFilters.filter(f => VARIANT_FILTER_KEYS.includes(f))),
    [selectedFilters]
  );

  // Set when Firestore can't serve the variantTags query yet — the composite index
  // is still building, or missing in this environment. We refetch without the
  // clause and match tags on the client instead, so the chips keep working rather
  // than failing the whole feed. Reset whenever the selection changes, so a later
  // tap re-probes the server once the index is ready.
  const [variantIndexUnavailable, setVariantIndexUnavailable] = useState(false);

  const isMyTradesActive = selectedFilters.includes('myTrades');
  const isFollowingActive = selectedFilters.includes('following');
  const isSavedActive = selectedFilters.includes('saved');

  // ── Add "My Trades" button to the navigation header ──
  useEffect(() => {
    navigation.setOptions({
      // Title reflects the active filter (icon-only buttons carry no labels)
      title: isMyTradesActive
        ? t('trade.my_trades_title', { defaultValue: 'My Trades' })
        : isFollowingActive
          ? t('trade.following_trades_title', { defaultValue: 'Following Trades' })
          : isSavedActive
            ? t('trade.saved_trades_title', { defaultValue: 'Saved Trades' })
            : t('tabs.trade'),
      headerRight: () => {
        // Icon-only filter buttons — self-explanatory, no labels
        const iconBtnStyle = (active, color) => ({
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? color : (isDarkMode ? '#1e293b' : '#f1f5f9'),
          borderWidth: 1.5,
          borderColor: active ? color : (isDarkMode ? '#334155' : '#e2e8f0'),
        });
        const iconColor = (active) => active ? '#fff' : (isDarkMode ? '#94a3b8' : '#64748b');
        // Only one of the three filters can be active at a time
        const FILTER_KEYS = ['myTrades', 'following', 'saved'];
        const toggleFilter = (key) => {
          triggerHapticFeedback('impactLight');
          if (!user?.id) {
            setIsSigninDrawerVisible(true);
            return;
          }
          setSelectedFilters(prev =>
            prev.includes(key)
              ? prev.filter(f => f !== key)
              : [...prev.filter(f => !FILTER_KEYS.includes(f)), key]
          );
        };
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 4 }}>
            {/* My Trades */}
            <TouchableOpacity
              onPress={() => toggleFilter('myTrades')}
              activeOpacity={0.75}
              style={iconBtnStyle(isMyTradesActive, config.colors.primary)}
            >
              <Icon name={isMyTradesActive ? 'person' : 'person-outline'} size={16} color={iconColor(isMyTradesActive)} />
            </TouchableOpacity>
            {/* Following */}
            <TouchableOpacity
              onPress={() => toggleFilter('following')}
              activeOpacity={0.75}
              style={iconBtnStyle(isFollowingActive, '#8B5CF6')}
            >
              <Icon name={isFollowingActive ? 'people' : 'people-outline'} size={16} color={iconColor(isFollowingActive)} />
            </TouchableOpacity>
            {/* Saved */}
            <TouchableOpacity
              onPress={() => toggleFilter('saved')}
              activeOpacity={0.75}
              style={iconBtnStyle(isSavedActive, '#F59E0B')}
            >
              <Icon name={isSavedActive ? 'bookmark' : 'bookmark-outline'} size={16} color={iconColor(isSavedActive)} />
            </TouchableOpacity>
            {/* Trade notifications */}
            <TouchableOpacity
              onPress={() => navigation.navigate('Trade Notifier')}
              style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="notifications" size={22} color={config.colors.primary} />
            </TouchableOpacity>
          </View>
        );
      },
    });
  }, [navigation, isMyTradesActive, isFollowingActive, isSavedActive, isDarkMode, user?.id]);

  useEffect(() => {
    // console.log(localState.isPro, 'from trade model'); // ✅ Check if isPro is updated
    setIsProStatus(localState.isPro); // ✅ Force update state and trigger re-render
  }, [localState.isPro]);

  // ✅ Client-side filtering for non-search scenarios (filters, banned users, expiry)
  useEffect(() => {
    const bannedUsersList = Array.isArray(bannedUsers) ? bannedUsers : [];
    const cutoff = Date.now() - TRADE_MAX_AGE_MS;

    const hasSavedFilter = selectedFilters.includes('saved');

    setFilteredTrades(
      trades.filter((trade) => {
        // ✅ Filter out trades from blocked users
        if (bannedUsersList.includes(trade.userId)) {
          return false;
        }

        // ✅ Filter out trades older than 7 days (client-side safety net)
        // Saved trades are exempt — they stay viewable as long as the doc exists
        const tradeTime = trade.timestamp?.toMillis ? trade.timestamp.toMillis() : (trade.timestamp?.seconds ? trade.timestamp.seconds * 1000 : 0);
        if (tradeTime > 0 && tradeTime < cutoff && !trade.isFeatured && !hasSavedFilter) {
          return false;
        }

        // ✅ If no filters selected, show all trades
        if (selectedFilters.length === 0) {
          return true;
        }

        // ✅ Separate filter types
        const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
        const hasMyTradesFilter = selectedFilters.includes("myTrades");
        const hasFollowingFilter = selectedFilters.includes("following");

        // ✅ Check status filter match
        let matchesStatus = true;
        if (statusFilters.length > 0) {
          const statusMap = { win: 'w', lose: 'l', fair: 'f' };
          const statusValues = statusFilters.map(f => statusMap[f]);
          matchesStatus = trade.status && statusValues.includes(trade.status);
        }

        // ✅ Check myTrades filter match
        let matchesMyTrades = true;
        if (hasMyTradesFilter) {
          matchesMyTrades = trade.userId === user.id;
        }

        // ✅ Check following filter match
        let matchesFollowing = true;
        if (hasFollowingFilter) {
          matchesFollowing = followingIds.includes(trade.userId);
        }

        // ✅ Check saved filter match
        let matchesSaved = true;
        if (hasSavedFilter) {
          matchesSaved = !!savedTradeRefs[trade.id];
        }

        // Variant tags are filtered in Firestore via array-contains, so anything
        // reaching here already matches — except in the two cases below.
        let matchesVariants = true;
        const variantFilters = selectedFilters.filter(f => VARIANT_FILTER_KEYS.includes(f));
        if (isSearchMode) {
          // Search mode: the tags refine the search rather than standing alone, so
          // the pet that matched the typed name must carry them too, on the side
          // being searched. (Firestore's one array-contains slot is already spent
          // on hasItemNames/wantsItemNames here.)
          matchesVariants = tradeMatchesSearchWithVariants(
            trade,
            searchQuery.trim().toLowerCase(),
            variantFilters,
            { inHas: searchInHas, inWants: searchInWants }
          );
        } else if (variantIndexUnavailable) {
          matchesVariants = tradeMatchesVariants(trade, variantFilters);
        }

        // ✅ All selected filters must match (AND logic)
        return matchesStatus && matchesMyTrades && matchesFollowing && matchesSaved && matchesVariants;
      })
    );
  }, [trades, selectedFilters, user.id, bannedUsers, followingIds, savedTradeRefs, isSearchMode, variantIndexUnavailable, searchQuery, searchInHas, searchInWants]);

  // Variant tag chips. Neon and Mega can't both be true on one pet, so picking
  // one clears the other; Fly and Ride stack freely on top.
  const toggleVariantFilter = useCallback((key) => {
    triggerHapticFeedback('impactLight');
    setPendingVariants((prev) => {
      if (prev.includes(key)) return prev.filter((f) => f !== key);
      const cleared = VALUE_TYPE_VARIANTS.includes(key)
        ? prev.filter((f) => !VALUE_TYPE_VARIANTS.includes(f))
        : prev;
      return [...cleared, key];
    });
  }, [triggerHapticFeedback]);

  // A new tag selection re-probes Firestore — the index may have finished
  // building since the last failure.
  useEffect(() => { setVariantIndexUnavailable(false); }, [activeVariantToken]);

  // The tag chips only exist alongside a search, so clear any selection when the
  // search box empties. Without this a chip stays active but invisible and keeps
  // silently narrowing the feed with no way to see or undo it.
  useEffect(() => {
    if (searchQuery.length > 0) return;
    searchRequestedRef.current = false;
    setPendingVariants((prev) => (prev.length ? [] : prev));
    setSelectedFilters((prev) =>
      prev.some(f => VARIANT_FILTER_KEYS.includes(f))
        ? prev.filter(f => !VARIANT_FILTER_KEYS.includes(f))
        : prev // same reference when there's nothing to drop — avoids a render loop
    );
  }, [searchQuery]);

  // ✅ Auto-scroll to top when filters change
  useEffect(() => {
    if (selectedFilters.length > 0 && flatListRef.current) {
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  }, [selectedFilters]);

  useEffect(() => {
    if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [user?.id, localState.bannedUsers]);

  // ✅ Load saved trade refs on mount
  useEffect(() => {
    if (!user?.id || !appdatabase) return;
    fetchSavedTradeRefs(appdatabase, user.id).then(refs => {
      setSavedTradeRefs(refs || {});
    });
  }, [user?.id, appdatabase]);

  // ✅ Fetch who I follow (for Following filter)
  // Shared 1h MMKV cache with StatusFeed and DesignMainScreen — this used to
  // requery Firestore on every mount. See Code/Helper/followingCache.js.
  useEffect(() => {
    if (!user?.id || !firestoreDB) return;
    (async () => {
      const ids = await getFollowingIds(firestoreDB, user.id);
      setFollowingIds(ids);
    })();
  }, [user?.id, firestoreDB]);

  // ── Paginated fetch for following trades (server-side) ──
  const followingLastDocRef = useRef(null);
  const followingHasMoreRef = useRef(true);

  const fetchFollowingTrades = useCallback(async (isLoadMore = false) => {
    if (!user?.id || followingIds.length === 0) {
      if (!isLoadMore) setTrades([]);
      setLoading(false);
      return;
    }
    if (isLoadMore && !followingHasMoreRef.current) return;

    if (!isLoadMore) {
      setLoading(true);
      followingLastDocRef.current = null;
      followingHasMoreRef.current = true;
    }

    try {
      const chunk = followingIds.slice(0, 30); // Firestore 'in' limit
      const sevenDaysAgo = getSevenDaysAgo();
      let q;
      if (isLoadMore && followingLastDocRef.current) {
        q = query(
          collection(firestoreDB, 'trades_new'),
          where('userId', 'in', chunk),
          where('timestamp', '>', sevenDaysAgo),
          orderBy('timestamp', 'desc'),
          startAfter(followingLastDocRef.current),
          limit(PAGE_SIZE),
        );
      } else {
        q = query(
          collection(firestoreDB, 'trades_new'),
          where('userId', 'in', chunk),
          where('timestamp', '>', sevenDaysAgo),
          orderBy('timestamp', 'desc'),
          limit(PAGE_SIZE),
        );
      }

      const snap = await getDocs(q);
      const newTrades = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      followingLastDocRef.current = snap.docs[snap.docs.length - 1] || null;
      followingHasMoreRef.current = newTrades.length === PAGE_SIZE;
      setHasMore(newTrades.length === PAGE_SIZE);

      if (isLoadMore) {
        setTrades(prev => [...prev, ...newTrades]);
      } else {
        setTrades(newTrades);
      }
    } catch (err) {
      console.error('[Trades] Error fetching following trades:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, followingIds, firestoreDB]);

  // Trigger fetch when following filter is toggled on
  useEffect(() => {
    if (selectedFilters.includes('following') && followingIds.length > 0) {
      fetchFollowingTrades();
    }
  }, [selectedFilters.includes('following'), followingIds.length]);

  const handleDelete = useCallback((item) => {
    Alert.alert(
      t("trade.delete_confirmation_title"),
      t("trade.delete_confirmation_message"),
      [
        { text: t("trade.cancel"), style: "cancel" },
        {
          text: t("trade.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              const tradeId = item.id.startsWith("featured-") ? item.id.replace("featured-", "") : item.id;

              await deleteDoc(doc(firestoreDB, "trades_new", tradeId));


              if (item.isFeatured) {
                const currentFeaturedData = localState.featuredCount || { count: 0, time: null };
                const newFeaturedCount = Math.max(0, currentFeaturedData.count - 1);

                await updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: currentFeaturedData.time,
                });
              }

              setTrades((prev) => prev.filter((trade) => trade.id !== item.id));
              setFilteredTrades((prev) => prev.filter((trade) => trade.id !== item.id));

              showSuccessMessage(t("trade.delete_success"), t("trade.delete_success_message"));

            } catch (error) {
              console.error("🔥 [handleDelete] Error deleting trade:", error);
              showErrorMessage(t("trade.delete_error"), t("trade.delete_error_message"));
            }
          },
        },
      ]
    );
  }, [t, localState.featuredCount, firestoreDB]);

  // ✅ Mod-only: Delete all trades by a specific user
  const handleDeleteAllTrades = useCallback((targetUserId) => {
    Alert.alert(
      'Delete All Trades',
      'Are you sure you want to delete ALL trades by this user?',
      [
        { text: t('trade.cancel'), style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              const q = query(
                collection(firestoreDB, 'trades_new'),
                where('userId', '==', targetUserId),
              );
              const snap = await getDocs(q);
              const deletePromises = snap.docs.map((d) => deleteDoc(d.ref));
              await Promise.all(deletePromises);

              // Remove from local state
              setTrades((prev) => prev.filter((trade) => trade.userId !== targetUserId));
              setFilteredTrades((prev) => prev.filter((trade) => trade.userId !== targetUserId));

              showSuccessMessage('Deleted', `All trades by this user have been removed.`);
            } catch (error) {
              console.error('🔥 [handleDeleteAllTrades] Error:', error);
              showErrorMessage('Error', 'Failed to delete all trades.');
            }
          },
        },
      ]
    );
  }, [t, firestoreDB]);







  // console.log(isProStatus, 'from trade model')

  const handleMakeFeatureTrade = async (item) => {
    if (!isProStatus) {
      Alert.alert(
        t("trade.feature_pro_only_title"),
        t("trade.feature_pro_only_message"),
        [
          { text: t("trade.cancel"), style: "cancel" },
          {
            text: t("trade.upgrade"),
            onPress: () => setShowofferwall(true),
          },
        ]
      );
      return;
    }

    try {
      // 🔐 Check from Firestore how many featured trades user already has
      const oneDayAgo = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const featuredSnapshot = await getDocs(
        query(
          collection(firestoreDB, "trades_new"),
          where("userId", "==", user.id),
          where("isFeatured", "==", true),
          where("featuredUntil", ">", oneDayAgo)
        )
      );

      if (featuredSnapshot.size >= 2) {
        Alert.alert(
          t("trade.limit_reached_title"),
          t("trade.limit_reached_message")
        );
        return;
      }

      // ✅ Proceed with confirmation
      Alert.alert(
        t("trade.feature_confirmation_title"),
        t("trade.feature_confirmation_message"),
        [
          { text: t("trade.cancel"), style: "cancel" },
          {
            text: t("feature"),
            onPress: async () => {
              try {
                await updateDoc(
                  doc(firestoreDB, "trades_new", item.id),
                  {
                    isFeatured: true,
                    featuredUntil: Timestamp.fromDate(
                      new Date(Date.now() + 24 * 60 * 60 * 1000)
                    ),
                  }
                );

                const newFeaturedCount = (localState.featuredCount?.count || 0) + 1;
                updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: new Date().toISOString(),
                });

                setTrades((prev) =>
                  prev.map((trade) =>
                    trade.id === item.id ? { ...trade, isFeatured: true } : trade
                  )
                );
                setFilteredTrades((prev) =>
                  prev.map((trade) =>
                    trade.id === item.id ? { ...trade, isFeatured: true } : trade
                  )
                );

                showSuccessMessage(t("trade.feature_success"), t("trade.feature_success_message"));
              } catch (error) {
                console.error("🔥 Error making trade featured:", error);
                showErrorMessage(t("trade.feature_error"), t("trade.feature_error_message"));
              }
            },
          },
        ]
      );
    } catch (err) {
      console.error("❌ Error checking featured trades:", err);
      Alert.alert(t("home.alert.error"), t("trade.verify_error_message"));
    }
  };





  const formatValue = (value) => {
    if (value >= 1_000_000_000) {
      return `${(value / 1_000_000_000).toFixed(1)}${t("trade.num_b")}`; // Billions
    } else if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}${t("trade.num_m")}`; // Millions
    } else if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}${t("trade.num_k")}`; // Thousands
    } else if (value < 1 && value > 0) {
      return value.toFixed(2); // e.g. 0.38
    } else {
      return value?.toLocaleString(); // Default formatting
    }
  };
  const fetchMoreTrades = useCallback(async () => {
    if (!hasMore || !lastDoc) return;

    try {
      // ✅ Get status filters and map to status values
      const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
      const statusValues = statusFilters.length > 0
        ? statusFilters.map(f => ({ win: 'w', lose: 'l', fair: 'f' }[f]))
        : null;

      // ✅ Build query for more normal trades (only last 7 days)
      const sevenDaysAgo = getSevenDaysAgo();
      // Must mirror fetchInitialTrades exactly, or startAfter() paginates a
      // different result set than the one already on screen.
      const statusClause = (statusValues && statusValues.length > 0)
        ? [where('status', 'in', statusValues)] : [];
      const variantClause = (activeVariantToken && !variantIndexUnavailable)
        ? [where('variantTags', 'array-contains', activeVariantToken)] : [];

      const normalQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', false),
        ...statusClause,
        ...variantClause,
        where('timestamp', '>', sevenDaysAgo),
        orderBy('timestamp', 'desc'),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      const normalTradesQuerySnap = await getDocs(normalQuery);

      const newNormalTrades = normalTradesQuerySnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));

      if (newNormalTrades.length === 0) {
        setHasMore(false);
        return;
      }
      // ✅ Get **2 more** featured trades if available
      const newFeaturedTrades = remainingFeaturedTrades.splice(0, 3);
      setRemainingFeaturedTrades([...remainingFeaturedTrades]); // ✅ Update remaining featured

      // ✅ Merge & maintain balance
      const mergedTrades = mergeFeaturedWithNormal(newFeaturedTrades, newNormalTrades);

      setTrades((prevTrades) => [...prevTrades, ...mergedTrades]);
      setLastDoc(
        normalTradesQuerySnap.docs[normalTradesQuerySnap.docs.length - 1]
      );
      setHasMore(newNormalTrades.length === PAGE_SIZE);
    } catch (error) {
      console.error('❌ Error fetching more trades:', error);
      // ✅ If error is about missing index, log helpful message
      if (error.code === 'failed-precondition') {
        console.warn('⚠️ Firestore index required. Please create composite index for: status + timestamp');
      }
    }
  }, [lastDoc, hasMore, remainingFeaturedTrades, firestoreDB, selectedFilters, activeVariantToken, variantIndexUnavailable]);



  useEffect(() => {
    const resetFeaturedDataIfExpired = async () => {
      const currentFeaturedData = localState.featuredCount || { count: 0, time: null };

      if (!currentFeaturedData.time) return; // ✅ If no time exists, do nothing

      const featuredTime = new Date(currentFeaturedData.time).getTime();
      const currentTime = Date.now();
      const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      // console.log(currentTime, featuredTime, TWENTY_FOUR_HOURS);

      if (currentTime - featuredTime >= TWENTY_FOUR_HOURS) {
        // console.log("⏳ 24 hours passed! Resetting featuredCount and time...");

        await updateLocalState("featuredCount", { count: 0, time: null });

        // console.log("✅ Featured data reset successfully.");
      }
    };

    resetFeaturedDataIfExpired(); // ✅ Runs once on app load

  }, []); // ✅ Runs only on app load

  const selectedUser = {
    senderId: selectedTrade?.userId,
    sender: selectedTrade?.traderName,
    avatar: selectedTrade?.avatar,
    flage: selectedTrade?.flage ? selectedTrade.flage : null,
    robloxUsername: selectedTrade?.robloxUsername || null,
    robloxUsernameVerified: selectedTrade?.robloxUsernameVerified || false,
  }
  const handleChatNavigation2 = async () => {


    const callbackfunction = () => {
      mixpanel.track("Inbox Trade");
      navigation.navigate('PrivateChatTrade', {
        selectedUser: selectedUser,
        item: selectedTrade,

      });
    };

    // ✅ Removed navigation ad - exit ads are shown when leaving chat instead
    callbackfunction();
  };




  const handleEndReached = () => {
    if (loading || isSearching) return; // ✅ Prevents unnecessary calls

    // ✅ Handle search pagination
    if (isSearchMode && searchHasMore) {
      if (!user?.id) {
        setIsSigninDrawerVisible(true);
      } else {
        handleSearchTrades(true); // Load more search results
      }
      return;
    }

    // ✅ Handle following pagination
    if (selectedFilters.includes('following')) {
      fetchFollowingTrades(true);
      return;
    }

    // ✅ Saved filter is a fixed list — nothing more to load
    if (selectedFilters.includes('saved')) return;

    // ✅ Handle normal pagination
    if (!hasMore || loading) return;
    if (!user?.id) {
      setIsSigninDrawerVisible(true);
    } else {
      fetchMoreTrades();
    }
  };

  // console.log(trades)

  // import firestore from '@react-native-firebase/firestore'; // Ensure this import

  // ✅ Firestore search function - server-side filtering using indexed fields (hasItemNames/wantsItemNames)
  // ✅ Firestore search - uses indexed fields (hasItemNames/wantsItemNames) for new trades
  const handleSearchTrades = useCallback(async (isLoadMore = false) => {
    const searchTerm = searchQuery.trim();
    if (!searchTerm) {
      setIsSearchMode(false);
      setSearchLastDoc(null);
      setSearchHasMore(true);
      fetchInitialTrades();
      return;
    }

    if (!searchInHas && !searchInWants) {
      Alert.alert(t("trade.search_error_title"), t("trade.search_options_error"));
      return;
    }

    setIsSearching(true);
    try {
      const searchTermLower = searchTerm.toLowerCase().trim();

      // ✅ Get status filters
      const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
      const statusValues = statusFilters.length > 0
        ? statusFilters.map(f => ({ win: 'w', lose: 'l', fair: 'f' }[f]))
        : null;

      const allResults = new Map();
      let lastDocSnapshot = isLoadMore ? searchLastDoc : null;
      const sevenDaysAgo = getSevenDaysAgo();

      // ✅ Search in ME side (hasItemNames) - SERVER-SIDE filtering (last 7 days only)
      if (searchInHas) {
        try {
          const hasQuery = lastDocSnapshot
            ? query(
              collection(firestoreDB, 'trades_new'),
              where('hasItemNames', 'array-contains', searchTermLower),
              where('timestamp', '>', sevenDaysAgo),
              orderBy('timestamp', 'desc'),
              startAfter(lastDocSnapshot),
              limit(SEARCH_PAGE_SIZE)
            )
            : query(
              collection(firestoreDB, 'trades_new'),
              where('hasItemNames', 'array-contains', searchTermLower),
              where('timestamp', '>', sevenDaysAgo),
              orderBy('timestamp', 'desc'),
              limit(SEARCH_PAGE_SIZE)
            );

          const hasSnapshot = await getDocs(hasQuery);
          hasSnapshot.docs?.forEach((docSnap) => {
            if (!allResults.has(docSnap.id)) {
              allResults.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), _doc: docSnap });
            }
          });
        } catch (error) {
          console.error('❌ hasItemNames search error:', error.message);
          if (error.message?.includes('index')) {
            console.log('📌 Create index at:', error.message.match(/https:\/\/[^\s]+/)?.[0]);
          }
        }
      }

      // ✅ Search in YOU side (wantsItemNames) - SERVER-SIDE filtering (last 7 days only)
      if (searchInWants) {
        try {
          const wantsQuery = lastDocSnapshot
            ? query(
              collection(firestoreDB, 'trades_new'),
              where('wantsItemNames', 'array-contains', searchTermLower),
              where('timestamp', '>', sevenDaysAgo),
              orderBy('timestamp', 'desc'),
              startAfter(lastDocSnapshot),
              limit(SEARCH_PAGE_SIZE)
            )
            : query(
              collection(firestoreDB, 'trades_new'),
              where('wantsItemNames', 'array-contains', searchTermLower),
              where('timestamp', '>', sevenDaysAgo),
              orderBy('timestamp', 'desc'),
              limit(SEARCH_PAGE_SIZE)
            );

          const wantsSnapshot = await getDocs(wantsQuery);
          wantsSnapshot.docs?.forEach((docSnap) => {
            if (!allResults.has(docSnap.id)) {
              allResults.set(docSnap.id, { id: docSnap.id, ...docSnap.data(), _doc: docSnap });
            }
          });
        } catch (error) {
          console.error('❌ wantsItemNames search error:', error.message);
          if (error.message?.includes('index')) {
            console.log('📌 Create index at:', error.message.match(/https:\/\/[^\s]+/)?.[0]);
          }
        }
      }

      // ✅ Convert to array and sort by timestamp
      let searchedTrades = Array.from(allResults.values())
        .sort((a, b) => {
          const aTime = a.timestamp?.toMillis() || 0;
          const bTime = b.timestamp?.toMillis() || 0;
          return bTime - aTime;
        });

      // ✅ Apply status filter if needed
      if (statusValues && statusValues.length > 0) {
        searchedTrades = searchedTrades.filter(t => statusValues.includes(t.status));
      }

      // ✅ Get last doc for pagination
      if (searchedTrades.length > 0) {
        const lastTrade = searchedTrades[searchedTrades.length - 1];
        lastDocSnapshot = lastTrade._doc || null;
      }

      // ✅ Remove _doc from trades before setting state
      searchedTrades = searchedTrades.map(({ _doc, ...trade }) => trade);

      // ✅ Update state
      if (isLoadMore) {
        setTrades((prev) => {
          const combined = [...prev, ...searchedTrades];
          const unique = Array.from(new Map(combined.map(t => [t.id, t])).values());
          return unique.sort((a, b) => {
            const aTime = a.timestamp?.toMillis() || 0;
            const bTime = b.timestamp?.toMillis() || 0;
            return bTime - aTime;
          });
        });
      } else {
        setTrades(searchedTrades);
        setIsSearchMode(true);
        // Scroll to top for new search results
        if (flatListRef.current) flatListRef.current.scrollToOffset({ offset: 0, animated: true });
      }

      // ✅ Update pagination state
      setSearchLastDoc(lastDocSnapshot);
      setSearchHasMore(searchedTrades.length >= SEARCH_PAGE_SIZE);

    } catch (error) {
      console.error('❌ Error searching trades:', error);
      Alert.alert(t("trade.search_error_title"), t("trade.search_failed"));
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, searchInHas, searchInWants, selectedFilters, firestoreDB, searchLastDoc]);

  // The single entry point for running a search: commits the staged tags and
  // fires one query. Both the search icon and the keyboard's search key use it.
  const runSearch = useCallback(() => {
    searchRequestedRef.current = true;
    setSearchLastDoc(null);
    setSearchHasMore(true);
    setSelectedFilters((prev) => [
      ...prev.filter(f => !VARIANT_FILTER_KEYS.includes(f)),
      ...pendingVariants,
    ]);
    if (searchQuery.trim()) {
      handleSearchTrades(false);
    }
  }, [pendingVariants, searchQuery, handleSearchTrades]);

  const fetchInitialTrades = useCallback(async () => {
    setLoading(true);
    try {
      // ✅ Get status filters (win, lose, fair) and map to status values (w, l, f)
      const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
      const statusValues = statusFilters.length > 0
        ? statusFilters.map(f => ({ win: 'w', lose: 'l', fair: 'f' }[f]))
        : null;

      // ✅ Build query for normal trades (only last 7 days)
      const sevenDaysAgo = getSevenDaysAgo();
      // Optional clauses, spread in below so each combination stays one query.
      const statusClause = (statusValues && statusValues.length > 0)
        ? [where('status', 'in', statusValues)] : [];
      const variantClause = (activeVariantToken && !variantIndexUnavailable)
        ? [where('variantTags', 'array-contains', activeVariantToken)] : [];

      const normalQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', false),
        ...statusClause,
        ...variantClause,
        where('timestamp', '>', sevenDaysAgo),
        orderBy('timestamp', 'desc'),
        limit(PAGE_SIZE)
      );

      const normalTradesQuerySnap = await getDocs(normalQuery);

      const normalTrades = normalTradesQuerySnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));


      // ✅ Build query for featured trades — same optional clauses, so a variant
      // filter doesn't leak non-matching featured trades into the results.
      // Bounded: this runs on every feed load, and the UI shows 3 up front then
      // 3 per load-more from the reserve. Without a limit the read count grows
      // with however many trades happen to be featured at the time.
      const featuredQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', true),
        ...statusClause,
        ...variantClause,
        where('featuredUntil', '>', Timestamp.now()),
        orderBy('featuredUntil', 'desc'),
        limit(FEATURED_FETCH_LIMIT)
      );

      const featuredQuerySnapshot = await getDocs(featuredQuery);

      let featuredTrades = [];
      if (!featuredQuerySnapshot.empty) {
        featuredTrades = featuredQuerySnapshot.docs.map((docSnap) => ({
          id: `featured-${docSnap.id}`,
          ...docSnap.data(),
        }));
      }
      // console.log('✅ Featured trades:', featuredTrades[0]);

      // ✅ Keep some featured trades aside for future loadMore()
      setRemainingFeaturedTrades(featuredTrades);

      // ✅ Merge trades but **reserve** featured trades for later
      const mergedTrades = mergeFeaturedWithNormal(
        featuredTrades.splice(0, 3), // ✅ Only use first 2 featured
        normalTrades
      );

      // ✅ Update state
      setTrades(mergedTrades);
      setLastDoc(
        normalTradesQuerySnap.docs[normalTradesQuerySnap.docs.length - 1]
      );
      setHasMore(normalTrades.length === PAGE_SIZE);

      // Warm profile cache for trade poster cosmetics (tradeCardBg)
      const allUserIds = [...new Set([...normalTrades, ...featuredTrades].map(t => t.userId).filter(Boolean))];
      if (appdatabase && allUserIds.length > 0) {
        warmProfileCache(appdatabase, allUserIds);
      }
    } catch (error) {
      // ✅ If error is about missing index, log helpful message
      if (error.code === 'failed-precondition') {
        // The variantTags index isn't servable yet — retry without it and let the
        // client match tags, so the tag chips degrade instead of breaking the feed.
        if (activeVariantToken && !variantIndexUnavailable) {
          console.warn('⚠️ variantTags index not ready — filtering tags on the client for now');
          setVariantIndexUnavailable(true);
          return;
        }
        console.warn('⚠️ Firestore index required. Please create composite index for: status + timestamp');
      }
      console.error('❌ Error fetching trades:', error);
    } finally {
      setLoading(false);
    }
  }, [firestoreDB, selectedFilters, activeVariantToken, variantIndexUnavailable]);


  // const captureAndSave = async () => {
  //   if (!viewRef.current) {
  //     console.error('View reference is undefined.');
  //     return;
  //   }

  //   try {
  //     // Capture the view as an image
  //     const uri = await captureRef(viewRef.current, {
  //       format: 'png',
  //       quality: 0.8,
  //     });

  //     // Generate a unique file name
  //     const timestamp = new Date().getTime(); // Use the current timestamp
  //     const uniqueFileName = `screenshot_${timestamp}.png`;

  //     // Determine the path to save the screenshot
  //     const downloadDest = Platform.OS === 'android'
  //       ? `${RNFS.ExternalDirectoryPath}/${uniqueFileName}`
  //       : `${RNFS.DocumentDirectoryPath}/${uniqueFileName}`;

  //     // Save the captured image to the determined path
  //     await RNFS.copyFile(uri, downloadDest);

  //     // console.log(`Screenshot saved to: ${downloadDest}`);

  //     return downloadDest;
  //   } catch (error) {
  //     console.error('Error capturing screenshot:', error);
  //     // Alert.alert(t("home.alert.error"), t("home.screenshot_error"));
  //     showMessage({
  //       message: t("home.alert.error"),
  //       description: t("home.screenshot_error"),
  //       type: "danger",
  //     });
  //   }
  // };

  // const proceedWithScreenshotShare = async () => {
  //   triggerHapticFeedback('impactLight');
  //   try {
  //     const filePath = await captureAndSave();

  //     if (filePath) {
  //       const shareOptions = {
  //         title: t("home.screenshot_title"),
  //         url: `file://${filePath}`,
  //         type: 'image/png',
  //       };

  //       Share.open(shareOptions)
  //         .then((res) => console.log('Share Response:', res))
  //         .catch((err) => console.log('Share Error:', err));
  //     }
  //   } catch (error) {
  //     // console.log('Error sharing screenshot:', error);
  //   }
  // };

  const mergeFeaturedWithNormal = (featuredTrades, normalTrades) => {
    // Input validation
    if (!Array.isArray(featuredTrades) || !Array.isArray(normalTrades)) {
      console.warn('⚠️ Invalid input: featuredTrades or normalTrades is not an array');
      return [];
    }

    let result = [];
    let featuredIndex = 0;
    let normalIndex = 0;
    const featuredCount = featuredTrades.length;
    const normalCount = normalTrades.length;
    const MAX_ITERATIONS = 1000; // Safety limit
    let iterationCount = 0;

    // Add first 4 featured trades (if available)
    for (let i = 0; i < 4 && featuredIndex < featuredCount; i++) {
      result.push(featuredTrades[featuredIndex]);
      featuredIndex++;
    }

    // Merge in the format of 4 normal trades, then 4 featured trades
    while (normalIndex < normalCount && iterationCount < MAX_ITERATIONS) {
      iterationCount++;

      // Insert up to 4 normal trades
      for (let i = 0; i < 4 && normalIndex < normalCount; i++) {
        result.push(normalTrades[normalIndex]);
        normalIndex++;
      }

      // Insert up to 4 featured trades (if available)
      for (let i = 0; i < 4 && featuredIndex < featuredCount; i++) {
        result.push(featuredTrades[featuredIndex]);
        featuredIndex++;
      }
    }

    if (iterationCount >= MAX_ITERATIONS) {
      console.warn('⚠️ Maximum iterations reached in mergeFeaturedWithNormal');
    }

    return result;
  };

  // useEffect(() => {
  //   const unsubscribe = firestore()
  //     .collection('trades_new')
  //     .orderBy('timestamp', 'desc')
  //     .limit(PAGE_SIZE)
  //     .onSnapshot(snapshot => {
  //       const newTrades = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  //       setTrades(newTrades);
  //       setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
  //       setHasMore(snapshot.docs.length === PAGE_SIZE);
  //     }, error => console.error('🔥 Firestore error:', error));

  //   return () => unsubscribe(); // ✅ Unsubscribing on unmount
  // }, []);



  // ✅ Track status filters separately for refetch trigger
  const statusFiltersString = useMemo(() => {
    const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
    return statusFilters.sort().join(',');
  }, [selectedFilters]);

  // ── Fetch user's own trades from Firestore ──
  const fetchMyTrades = useCallback(async () => {
    if (!user?.id || !firestoreDB) return;
    setLoading(true);
    try {
      const myQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('userId', '==', user.id),
        orderBy('timestamp', 'desc'),
        limit(50)
      );
      const snap = await getDocs(myQuery);
      const myTrades = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTrades(myTrades);
      setHasMore(false); // Don't paginate in My Trades mode
    } catch (e) {
      console.warn('[Trades] fetchMyTrades error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, firestoreDB]);

  // ── Fetch saved trades (RTDB refs → Firestore trade docs) ──
  const fetchSavedTrades = useCallback(async () => {
    if (!user?.id || !appdatabase || !firestoreDB) return;
    setLoading(true);
    try {
      const refs = await fetchSavedTradeRefs(appdatabase, user.id);
      setSavedTradeRefs(refs || {});
      const ids = Object.keys(refs || {});
      if (ids.length === 0) {
        setTrades([]);
        setHasMore(false);
        return;
      }
      const results = await Promise.all(ids.map(async (tradeId) => {
        try {
          const snap = await getDoc(doc(firestoreDB, 'trades_new', tradeId));
          return snap.exists() ? { id: tradeId, ...snap.data() } : null; // deleted trades are skipped
        } catch {
          return null;
        }
      }));
      const valid = results.filter(Boolean).sort((a, b) => {
        const ta = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
        const tb = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
        return tb - ta;
      });
      setTrades(valid);
      setHasMore(false); // Fixed list — no pagination
    } catch (e) {
      console.warn('[Trades] fetchSavedTrades error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, appdatabase, firestoreDB]);

  // ✅ Refetch when user changes
  useEffect(() => {
    fetchInitialTrades();
    isInitialMountRef.current = false; // ✅ Mark initial mount as complete
    // updateLatest50TradesWithoutIsFeatured()

    if (!user?.id) {
      setTrades((prev) => prev.slice(0, PAGE_SIZE)); // Keep only 20 trades for logged-out users
    }
  }, [user?.id]);

  // ✅ Refetch when status filters change (for database-level filtering)
  useEffect(() => {
    // Skip refetch on initial mount (user?.id effect handles that)
    if (isInitialMountRef.current) return;

    // In search mode the tags refine the results already on screen — refetching
    // the normal feed here would discard the user's search.
    if (isSearchMode || searchRequestedRef.current) return;

    // Refetch when status filters change to apply database-level filtering
    if (user?.id) {
      // Fetch based on the single active filter (they're mutually exclusive)
      if (selectedFilters.includes('myTrades')) {
        fetchMyTrades();
      } else if (selectedFilters.includes('saved')) {
        fetchSavedTrades();
      } else if (selectedFilters.includes('following')) {
        // Following has its own fetch effect — nothing to do here
      } else {
        fetchInitialTrades();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFiltersString, activeVariantToken, variantIndexUnavailable, isMyTradesActive, isSavedActive, isFollowingActive, isSearchMode]); // ✅ Refetch when the active filter changes

  const closeProfileDrawer = async () => {
    setIsDrawerVisible(false);
  };
  const handleOpenProfile = async (item) => {
    if (!user?.id) {
      setIsSigninDrawerVisible(true);
      return;
    }
    setSelectedTrade(item)
    setIsDrawerVisible(true);
  }

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


  const renderTextWithUsername = (description) => {
    const parts = description.split(/(@\w+)/g); // Split text by @username pattern

    return parts.map((part, index) => {
      if (part.startsWith('@')) {
        const username = part.slice(1); // Remove @
        return (
          <TouchableOpacity
            style={styles.descriptionclick}
            key={index}
            onPress={() => {
              Clipboard.setString(username);
              // Alert.alert("Copied!", `Username "${username}" copied.`);
            }}
          >
            <Text style={styles.descriptionclick}>{part}</Text>
          </TouchableOpacity>
        );
      } else {
        return <Text key={index} style={styles.description}>{part}</Text>;
      }
    });
  };


  const styles = useMemo(() => getStyles(isDarkMode, c), [isDarkMode]);

  const getImageUrl = (item, baseImgUrl) => {

    if (!item || !item.name) return '';

    if (!item.image || !baseImgUrl) return '';
    return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}/${item.image.replace(/^\//, '')}`;
  };



  const handleRefresh = async () => {
    setRefreshing(true);
    // ✅ Reset search when refreshing
    if (searchQuery.trim()) {
      setSearchQuery('');
      setIsSearchMode(false);
      setSearchLastDoc(null);
      setSearchHasMore(true);
    }
    // ✅ Respect active filter mode when refreshing
    if (selectedFilters.includes('saved')) {
      await fetchSavedTrades();
    } else if (selectedFilters.includes('myTrades')) {
      await fetchMyTrades();
    } else if (selectedFilters.includes('following')) {
      await fetchFollowingTrades();
    } else {
      await fetchInitialTrades();
    }
    setRefreshing(false);
  };

  // ✅ Scroll to top handler
  const handleScrollToTop = useCallback(() => {
    if (!flatListRef?.current) return;

    triggerHapticFeedback('impactLight');

    try {
      // Scroll to index 0 (top of list)
      flatListRef.current.scrollToIndex({
        index: 0,
        animated: true,
        viewPosition: 0,
      });
      setIsAtTop(true);
    } catch (error) {
      // Fallback: scroll to offset 0
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
      setIsAtTop(true);
    }
  }, [flatListRef, triggerHapticFeedback]);

  // ✅ Animate scroll button visibility
  useEffect(() => {
    Animated.timing(scrollButtonOpacity, {
      toValue: isAtTop ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isAtTop, scrollButtonOpacity]);

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };

  // Interleave a native ad every Nth trade for non-Pro users. Keys are
  // `trade-ad-*` so they don't collide with the design feed's `ad-*` slots in
  // the shared NativeAdManager cache.
  const TRADE_AD_FREQUENCY = 8;
  const tradesWithAds = useMemo(() => {
    if (isProStatus || !Array.isArray(filteredTrades) || filteredTrades.length === 0) {
      return filteredTrades;
    }
    const out = [];
    let count = 0;
    for (let i = 0; i < filteredTrades.length; i++) {
      out.push(filteredTrades[i]);
      count++;
      if (count % TRADE_AD_FREQUENCY === 0) {
        out.push({ __type: 'ad', id: `trade-ad-${i}` });
      }
    }
    return out;
  }, [filteredTrades, isProStatus]);

  // Free this screen's native ad handles on unmount.
  useEffect(() => () => releaseNativeAds('trade-ad-'), []);

  const renderTrade = ({ item, index }) => {
    // Native ad row (interleaved into the data below for non-Pro users).
    if (item?.__type === 'ad') {
      return <NativeAdCard adKey={item.id} isDarkMode={isDarkMode} />;
    }
    const formattedTime = item.timestamp ? dayjs(item.timestamp.toDate()).fromNow() : "Unknown";
    // Function to group items and count duplicates
    const groupItems = (items) => {
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

    // Group and count duplicate items
    const groupedHasItems = groupItems(item.hasItems || []);
    const groupedWantsItems = groupItems(item.wantsItems || []);
    const selectedUser = {
      senderId: item.userId,
      sender: item.traderName,
      avatar: item.avatar,
      flage: item.flage ? item.flage : null,
      robloxUsername: item?.robloxUsername || null,
      robloxUsernameVerified: item?.robloxUsernameVerified || false,
    }
    const handleChatNavigation = async () => {

      const callbackfunction = () => {
        if (!user?.id) {
          setIsSigninDrawerVisible(true);
          return;
        }
        mixpanel.track("Inbox Trade");
        navigation.navigate('PrivateChatTrade', {
          selectedUser: selectedUser,
          item,
        });
      };

      // ✅ Removed navigation ad - exit ads are shown when leaving chat instead
      callbackfunction();
    };
    return (
      <View style={[styles.tradeItem, (() => {
        const posterProfile = getCachedProfile(item.userId);
        const bg = posterProfile?.tradeCardBg;
        if (bg) {
          return { backgroundColor: isDarkMode ? (bg.darkColor || bg.color) : bg.color, borderWidth: 1, borderColor: isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' };
        }
        return null;
      })(), item.isFeatured && styles.featuredCard]}>
        {item.isFeatured && <View style={styles.tag}><Text style={styles.tagTextFeatured}>Featured</Text></View>}

        {/* ✅ Header — Feed-style */}
        <View style={styles.cardHeader}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => handleOpenProfile(item)}>
            {(() => {
              const posterProfile = getCachedProfile(item.userId);
              const frame = posterProfile?.profileFrame;
              return (
                <FramedAvatar
                  avatarUri={item.avatar}
                  frame={frame}
                  isDarkMode={isDarkMode}
                  avatarSize={40}
                />
              );
            })()}
            <View style={{ marginLeft: 10, flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <Text style={styles.cardName} numberOfLines={1}>{item.traderName}</Text>
                {item.isPro && <Image source={require('../../assets/pro.png')} style={badgeStyles.inlineIcon} />}
                {item.robloxUsernameVerified && <Image source={require('../../assets/verification.png')} style={badgeStyles.inlineIcon} />}
                {(() => {
                  const hasRecentWin = !!item?.hasRecentGameWin || (typeof item?.lastGameWinAt === 'number' && Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);
                  return hasRecentWin ? <Image source={require('../../assets/trophy.webp')} style={badgeStyles.inlineIcon} /> : null;
                })()}
                {item.rating ? (
                  <View style={badgeStyles.ratingBadge}>
                    <Icon name="star" size={7} color="white" />
                    <Text style={badgeStyles.ratingText}>{parseFloat(item.rating).toFixed(1)}({item.ratingCount})</Text>
                  </View>
                ) : (
                  <View style={[badgeStyles.ratingBadge, { backgroundColor: '#888' }]}>
                    <Icon name="star-outline" size={7} color="white" />
                    <Text style={badgeStyles.ratingText}>N/A</Text>
                  </View>
                )}
                {(() => {
                  const p = getCachedProfile(item.userId) || {};
                  const pIsAdmin = p.isAdmin ?? item.isAdmin;
                  const pIsMod = p.isModerator ?? item.isModerator;
                  const pIsTrusted = p.isTrusted ?? item.isTrusted;
                  const pIsCMSR = p.isCMSR ?? item.isCMSR;
                  const pIsHelper = p.isHelper ?? item.isHelper;
                  const firstBadge = getFirstBadgeType({
                    isAdmin: pIsAdmin, isModerator: pIsMod, isBabyMod: item.isBabyMod,
                    isTrusted: pIsTrusted, isCMSR: pIsCMSR, isHelper: pIsHelper,
                  });
                  return (
                    <>
                      {pIsAdmin && <UserBadgePill type="admin" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'admin'} />}
                      {!pIsAdmin && pIsMod && <UserBadgePill type="mod" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'mod'} />}
                      {!pIsAdmin && !pIsMod && item.isBabyMod && <UserBadgePill type="jmd" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'jmd'} />}
                      {pIsTrusted && <UserBadgePill type="trusted" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'trusted'} />}
                      {pIsCMSR && <UserBadgePill type="cmsr" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'cmsr'} />}
                      {pIsHelper && <UserBadgePill type="helper" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'helper'} />}
                    </>
                  );
                })()}
              </View>
              <Text style={styles.cardTime}>{formattedTime}</Text>
            </View>
          </TouchableOpacity>

        </View>
        {/* Trade Items */}
        <View style={styles.tradeDetails}>
          {/* Has Items Grid or Give Offer */}
          {item.hasItems && item.hasItems.length > 0 ? (
            <View style={styles.itemGrid}>
              {Array.from({
                length: Math.max(4, Math.ceil(item.hasItems.length / 4) * 4)
              }).map((_, idx) => {
                const tradeItem = item.hasItems[idx];
                // console.log(`${localState?.imgurl?.replace(/"/g, "").replace(/\/$/, "")}/${item.image?.replace(/^\//, "")}`)
                return (
                  <View key={idx} style={styles.gridCell}>
                    {tradeItem ? (
                      <>
                        {/* ✅ Badges above image */}
                        <View style={styles.itemBadgesContainer}>
                          {tradeItem.isFly && (
                            <Text style={[styles.itemBadge, styles.itemBadgeFly]}>F</Text>
                          )}
                          {tradeItem.isRide && (
                            <Text style={[styles.itemBadge, styles.itemBadgeRide]}>R</Text>
                          )}
                          {tradeItem.valueType && tradeItem.valueType !== 'd' && (
                            <Text style={[
                              styles.itemBadge,
                              tradeItem.valueType === 'm' && styles.itemBadgeMega,
                              tradeItem.valueType === 'n' && styles.itemBadgeNeon,
                            ]}>{tradeItem.valueType.toUpperCase()}</Text>
                          )}
                        </View>
                        {/* ✅ Image */}
                        <Image
                          source={{ uri: getImageUrl(tradeItem, localState.imgurl) }}
                          style={styles.gridItemImage}
                        />
                        {/* ✅ Item name below image */}
                        <Text style={styles.itemName} numberOfLines={1}>
                          {tradeItem.name && tradeItem.name.length > 8
                            ? `${tradeItem.name.substring(0, 8)}...`
                            : tradeItem.name || ''}
                        </Text>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <TouchableOpacity style={styles.dealContainerSingle} onPress={() => handleOpenProfile(item)}>
              <Text style={styles.dealText}>{t('trade.give_offer')}</Text>
            </TouchableOpacity>
          )}
          {/* Transfer Icon */}
          <View style={styles.transfer}>
            <Image source={require('../../assets/left-right.png')} style={styles.transferImage} />
          </View>
          {/* Wants Items Grid or Give Offer */}
          {item.wantsItems && item.wantsItems.length > 0 ? (
            <View style={styles.itemGrid}>
              {Array.from({
                length: Math.max(4, Math.ceil(item.wantsItems.length / 4) * 4)
              }).map((_, idx) => {
                const tradeItem = item.wantsItems[idx];
                return (
                  <View key={idx} style={styles.gridCell}>
                    {tradeItem ? (
                      <>
                        {/* ✅ Badges above image */}
                        <View style={styles.itemBadgesContainer}>
                          {tradeItem.isFly && (
                            <Text style={[styles.itemBadge, styles.itemBadgeFly]}>F</Text>
                          )}
                          {tradeItem.isRide && (
                            <Text style={[styles.itemBadge, styles.itemBadgeRide]}>R</Text>
                          )}
                          {tradeItem.valueType && tradeItem.valueType !== 'd' && (
                            <Text style={[
                              styles.itemBadge,
                              tradeItem.valueType === 'm' && styles.itemBadgeMega,
                              tradeItem.valueType === 'n' && styles.itemBadgeNeon,
                            ]}>{tradeItem.valueType.toUpperCase()}</Text>
                          )}
                        </View>
                        {/* ✅ Image */}
                        <Image
                          source={{ uri: getImageUrl(tradeItem, localState.imgurl) }}
                          style={styles.gridItemImage}
                        />
                        {/* ✅ Item name below image */}
                        <Text style={styles.itemName} numberOfLines={1}>
                          {tradeItem.name && tradeItem.name.length > 8
                            ? `${tradeItem.name.substring(0, 8)}...`
                            : tradeItem.name || ''}
                        </Text>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <TouchableOpacity style={styles.dealContainerSingle} onPress={() => handleOpenProfile(item)}>
              <Text style={styles.dealText}>{t('trade.give_offer')}</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.tradeTotals}>
          {item.hasItems && item.hasItems.length > 0 && (
            <Text style={[styles.priceText, styles.hasBackground]}>
              {t('trade.me')}: {formatValue(item.hasTotal)}
            </Text>
          )}
          <View style={styles.transfer}>
            {(item.hasItems && item.hasItems.length > 0 && item.wantsItems && item.wantsItems.length > 0) && (() => {
                const diff = item.hasTotal - item.wantsTotal;
                if (diff > 0) {
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e' }} />
                      <Text style={[styles.priceText, { color: '#22c55e', backgroundColor: 'transparent' }]}>
                        +{formatValue(diff)}
                      </Text>
                    </View>
                  );
                } else if (diff < 0) {
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444' }} />
                      <Text style={[styles.priceText, { color: '#ef4444', backgroundColor: 'transparent' }]}>
                        -{formatValue(Math.abs(diff))}
                      </Text>
                    </View>
                  );
                } else {
                  return (
                    <Text style={{ fontSize: 10 }}>⚖️</Text>
                  );
                }
              })()}
          </View>
          {item.wantsItems && item.wantsItems.length > 0 && (
            <Text style={[styles.priceText, styles.wantBackground]}>
              {t('trade.you')}: {formatValue(item.wantsTotal)}
            </Text>
          )}
        </View>

        {/* Description */}
        {item.description && <Text style={styles.description}>{renderTextWithUsername(item.description)}</Text>}

        {/* ✅ Social Actions Row — Feed-style */}
        <View style={styles.socialActionsRow}>
          {/* ✅ Left side: Owner / Mod Actions */}
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {/* Owner actions (boost/delete) */}
            {item.userId === user.id && (
              <>
                {!item.isFeatured &&
                  <TouchableOpacity onPress={() => handleMakeFeatureTrade(item)} style={[styles.ownerBtn, { backgroundColor: '#8B5CF6' }]}>
                    <Icon name="rocket-outline" size={12} color="white" />
                    <Text style={styles.ownerBtnText}>{t('trade.boost_it')}</Text>
                  </TouchableOpacity>}
                <TouchableOpacity onPress={() => handleDelete(item)} style={[styles.ownerBtn, { backgroundColor: '#EF4444' }]}>
                  <Icon name="trash-outline" size={12} color="white" />
                  <Text style={styles.ownerBtnText}>{t('trade.delete_it')}</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Mod-only actions (delete this trade / delete all trades by user) */}
            {(isAdmin || user?.isModerator) && item.userId !== user.id && (
              <>
                <TouchableOpacity
                  onPress={() => handleDelete(item)}
                  style={[styles.ownerBtn, { backgroundColor: '#EF4444' }]}
                >
                  <Icon name="trash-outline" size={9} color="white" />
                  <Text style={styles.ownerBtnText}>Delete</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDeleteAllTrades(item.userId)}
                  style={[styles.ownerBtn, { backgroundColor: '#991B1B' }]}
                >
                  <Icon name="trash" size={9} color="white" />
                  <Text style={styles.ownerBtnText}>Delete All</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {/* Share */}
            <TouchableOpacity
              onPress={() => {
                setSelectedTrade(item);
                setOpenShareModel(true);
              }}
              style={styles.socialBtn}
            >
              <Icon name="share-social-outline" size={16} color={config.colors.primary} />
            </TouchableOpacity>

            {/* Save — only for other users' trades */}
            {item.userId !== user?.id && (
              <TouchableOpacity
                onPress={async () => {
                  if (!user?.id) { setIsSigninDrawerVisible(true); return; }
                  triggerHapticFeedback('impactLight');
                  const tradeId = item.id;
                  if (savedTradeRefs[tradeId]) {
                    // Unsave
                    try {
                      await unsaveTrade(appdatabase, user.id, tradeId);
                      setSavedTradeRefs(prev => { const n = { ...prev }; delete n[tradeId]; return n; });
                      showSuccessMessage(t('trade.removed', { defaultValue: 'Removed' }), t('trade.trade_unsaved', { defaultValue: 'Trade removed from saved' }));
                    } catch (e) {
                      showErrorMessage(t('home.alert.error'), e?.message || 'Error');
                    }
                  } else {
                    try {
                      await saveTrade(appdatabase, user.id, item);
                      setSavedTradeRefs(prev => ({ ...prev, [tradeId]: { type: 'saved' } }));
                      showSuccessMessage(
                        '🔖 ' + t('trade.saved', { defaultValue: 'Trade Saved!' }),
                        t('trade.saved_guide', { defaultValue: 'Tap the Saved filter at the top to view your saved trades anytime.' })
                      );
                    } catch (e) {
                      showErrorMessage(t('home.alert.error'), e?.message || 'Error');
                    }
                  }
                }}
                style={[styles.socialBtn, savedTradeRefs[item.id]?.type === 'saved' && { backgroundColor: '#3B82F620' }]}
              >
                <Icon name={savedTradeRefs[item.id] ? 'bookmark' : 'bookmark-outline'} size={16} color={'#3B82F6'} />
              </TouchableOpacity>
            )}

            <TouchableOpacity onPress={handleChatNavigation} style={styles.chatBtn}>
              <Icon name="chatbubble" size={13} color="#fff" />
              <Text style={styles.chatBtnText}>{t('feed.chat', { defaultValue: 'Chat' })}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {openShareModel && selectedTrade?.id === item.id && (
          <ShareTradeModal
            visible={openShareModel}
            onClose={() => setOpenShareModel(false)}
            hasItems={selectedTrade?.hasItems || []}
            wantsItems={selectedTrade?.wantsItems || []}
            hasTotal={selectedTrade?.hasTotal || 0}
            wantsTotal={selectedTrade?.wantsTotal || 0}
            description={selectedTrade?.description || ''}
          />
        )}

        <ProfileBottomDrawer
          isVisible={isDrawerVisible && selectedTrade?.id === item.id}
          toggleModal={() => setIsDrawerVisible(false)}
          startChat={handleChatNavigation}
          selectedUser={selectedUser}
          isOnline={false}
          bannedUsers={bannedUsers}
        />
      </View>
    );
  };

  if (loading) {
    return <ActivityIndicator style={styles.loader} size="large" color="#007BFF" />;
  }


  return (
    <View style={styles.container}>
      {/* ✅ Modern Search Container */}
      {/* ✅ Modern Search Container (Compact) */}
      <View style={{ flexDirection: 'row', marginBottom: 10, marginTop: 10 }}>
        <TextInput
          style={{
            flex: 1,
            height: 44,
            borderRadius: 10,
            paddingHorizontal: 12,
            fontSize: 16,
            backgroundColor: isDarkMode ? '#1e293b' : '#FFF',
            color: isDarkMode ? '#FFF' : '#000',
            borderWidth: 1,
            borderColor: isDarkMode ? '#475569' : '#E5E5EA'
          }}
          placeholder={t("trade.search_placeholder") || "Search items..."}
          placeholderTextColor={isDarkMode ? '#888' : '#666'}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={runSearch}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={{
            width: 44,
            height: 44,
            backgroundColor: config.colors.primary,
            borderRadius: 10,
            marginLeft: 8,
            justifyContent: 'center',
            alignItems: 'center'
          }}
          onPress={runSearch}
          disabled={isSearching}
        >
          {isSearching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Icon name="search" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* ✅ Search Options — Compact single row */}
      {(searchQuery.length > 0) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginBottom: 8, gap: 6 }}>
          <TouchableOpacity
            style={[styles.checkboxContainer, !searchInHas && styles.checkboxUnchecked]}
            onPress={() => {
              triggerHapticFeedback('impactLight');
              if (!searchInHas && !searchInWants) {
                setSearchInWants(true);
              }
              setSearchInHas(!searchInHas);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, searchInHas && styles.checkboxChecked]}>
              {searchInHas && <Icon name="checkmark" size={12} color="#fff" />}
            </View>
            <Text style={[styles.checkboxLabel, { color: isDarkMode ? '#fff' : '#000' }]}>
              {t("trade.search_in_me") || "Me"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.checkboxContainer, !searchInWants && styles.checkboxUnchecked]}
            onPress={() => {
              triggerHapticFeedback('impactLight');
              if (!searchInHas && !searchInWants) {
                setSearchInHas(true);
              }
              setSearchInWants(!searchInWants);
            }}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, searchInWants && styles.checkboxChecked]}>
              {searchInWants && <Icon name="checkmark" size={12} color="#fff" />}
            </View>
            <Text style={[styles.checkboxLabel, { color: isDarkMode ? '#fff' : '#000' }]}>
              {t("trade.search_in_you") || "You"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              // State only — no fetch here. Clearing changes isSearchMode and drops
              // the committed tags in the same batch, and the refetch effect below
              // reloads the feed once off the fresh state. Fetching inline instead
              // fired twice: once through this callback's stale closure (still
              // carrying the tag filter) and again when the tags cleared.
              setSearchQuery('');
              setIsSearchMode(false);
              setSearchLastDoc(null);
              setSearchHasMore(true);
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 'auto',
              paddingVertical: 5,
              paddingHorizontal: 10,
              borderRadius: 8,
              backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
            }}
          >
            <Icon name="close-circle" size={14} color={config.colors.primary} style={{ marginRight: 4 }} />
            <Text style={{ color: config.colors.primary, fontSize: 11, fontWeight: '600' }}>Clear</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Variant tags — part of the search flow, so they only appear once something
          is typed: name -> Me/You -> tags. They narrow the results to the searched
          pet carrying these tags on the chosen side. */}
      {(searchQuery.length > 0) && (
        <View style={styles.variantFilterRow}>
          {VARIANT_FILTERS.map(({ key, color, labelKey, fallback }) => {
            const active = pendingVariants.includes(key);
            return (
              <TouchableOpacity
                key={key}
                onPress={() => toggleVariantFilter(key)}
                activeOpacity={0.75}
                style={[styles.variantFilterChip, active && { backgroundColor: color, borderColor: color }]}
              >
                <Text style={[styles.variantFilterText, active && styles.variantFilterTextActive]}>
                  {t(labelKey, { defaultValue: fallback })}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}



      <FlatList
        ref={flatListRef}
        data={tradesWithAds}
        renderItem={renderTrade}
        keyExtractor={(item) => item.__type === 'ad' ? item.id : item.isFeatured ? `featured-${item.id}` : item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={filteredTrades.length === 0 ? { flexGrow: 1, paddingBottom: 20 } : { paddingBottom: 20 }}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.2}
        removeClippedSubviews={true}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={50}
        windowSize={5}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onScroll={({ nativeEvent }) => {
          const { contentOffset } = nativeEvent;
          const atTop = contentOffset.y <= 60;
          setIsAtTop(atTop);
        }}
        scrollEventThrottle={16}
        ListEmptyComponent={!loading && !isSearching ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30, paddingTop: 60 }}>
            <Text style={{ fontSize: 36, marginBottom: 10 }}>{isSearchMode ? '🔍' : '📭'}</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: isDarkMode ? '#fff' : '#1e293b', textAlign: 'center' }}>
              {isSearchMode
                ? t('trade.no_search_results', { defaultValue: 'No trades found' })
                : t('trade.no_trades', { defaultValue: 'No trades yet' })}
            </Text>
            <Text style={{ fontSize: 13, color: isDarkMode ? '#94a3b8' : '#64748b', textAlign: 'center', marginTop: 6, lineHeight: 18 }}>
              {isSearchMode
                ? t('trade.no_search_results_sub', { defaultValue: 'Try a different item name or adjust your filters.' })
                : t('trade.no_trades_sub', { defaultValue: 'Pull down to refresh or check back later.' })}
            </Text>
          </View>
        ) : null}
      />




      <ReportTradePopup
        visible={isReportPopupVisible}
        trade={selectedTrade}
        onClose={() => setReportPopupVisible(false)}
      />

      <SignInDrawer
        visible={isSigninDrawerVisible}
        onClose={handleLoginSuccess}
        selectedTheme={selectedTheme}
        message={t("trade.signin_required_message")}
        screen='Trade'

      />

      {!localState.isPro && <BannerAdComponent collapsible />}

      {/* {!isProStatus && <View style={{ alignSelf: 'center' }}>
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
      <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} track='Trade' />

      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={closeProfileDrawer}
        startChat={handleChatNavigation2}
        selectedUser={selectedUser}
        isOnline={false}
        bannedUsers={bannedUsers}
      />

      {/* ✅ Scroll to Top Button */}
      {!isAtTop && (
        <Animated.View
          style={[
            styles.scrollToTopButton,
            {
              opacity: scrollButtonOpacity,
              transform: [
                {
                  scale: scrollButtonOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleScrollToTop}
            activeOpacity={0.8}
            style={styles.scrollToTopTouchable}
          >
            <Icon
              name="chevron-up-circle"
              size={48}
              color={'#3b82f6'}
            />
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
};
const getStyles = (isDarkMode, c) => {
  return StyleSheet.create({
    container: {
      paddingHorizontal: 8,
      backgroundColor: c.bg,
      flex: 1,
    },
    tradeItem: {
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginHorizontal: 4,
      marginVertical: 6,
      backgroundColor: c.bgAlt,
      borderRadius: 18,
      shadowColor: c.shadow,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: c.shadowOpacity,
      shadowRadius: 8,
      elevation: isDarkMode ? 4 : 3,
    },
    featuredCard: {
      borderWidth: 2,
      borderColor: '#F59E0B',
    },

    searchContainer: {
      padding: 12,
      borderRadius: 12,
      marginVertical: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    },
    searchInputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.bgAlt,
      borderRadius: 10,
      paddingHorizontal: 6,
      borderWidth: 1.5,
      borderColor: c.borderAccent,
    },
    searchIcon: {
      marginRight: 8,
    },
    searchInput: {
      height: 40,
      borderColor: 'transparent',
      backgroundColor: 'transparent',
      borderWidth: 0,
      marginVertical: 8,
      paddingHorizontal: 10,
      flex: 1,
    },
    clearSearchButton: {
      padding: 4,
      marginLeft: 8,
    },
    searchOptionsContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginBottom: 10,
      paddingVertical: 8,
    },
    checkboxContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: c.bgAlt,
      borderWidth: isDarkMode ? 0 : 1,
      borderColor: c.border,
    },
    // Trade feed: Neon / Mega / Fly / Ride tag filters
    variantFilterRow: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 10,
    },
    variantFilterChip: {
      flex: 1,
      paddingVertical: 7,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    variantFilterText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textSecondary,
    },
    variantFilterTextActive: {
      color: '#fff',
    },
    checkboxUnchecked: {
      opacity: 0.6,
    },
    checkbox: {
      width: 18,
      height: 18,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: config.colors.primary,
      marginRight: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    checkboxChecked: {
      backgroundColor: config.colors.primary,
      borderColor: config.colors.primary,
    },
    checkboxLabel: {
      fontSize: 11,
    },
    searchButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: 10,
      marginTop: 4,
    },
    searchButtonInline: {
      width: 40,
      height: 40,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: 8,
    },
    searchButtonText: {
      color: '#fff',
      fontSize: 15,
      fontWeight: 'bold',
    },
    tradeHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      // marginBottom: 10,
      // paddingBottom: 10,
      // borderBottomWidth: 1,
      borderColor: 'lightgrey',
      color: c.text,
    },
    traderName: {
      fontWeight: 'bold',
      fontSize: 8,
      color: c.text,

    },
    tradeTime: {
      fontSize: 8,
      color: c.textMuted,
      // color: 'lightgrey'

    },
    tradeDetails: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      color: c.text,
      marginVertical: 10


    },
    itemGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      width: '48%',
      // alignItems: 'center',
      // justifyContent: 'center',
      // marginVertical: 6,
    },
    gridCell: {
      width: '22%',
      alignItems: 'center',
      justifyContent: 'flex-start',
      position: 'relative',
      marginBottom: 10,
      minHeight: 55, // Increased to accommodate badges, image, and name
    },
    gridItemImage: {
      width: 30,
      height: 30,
      borderRadius: 6,
      marginTop: 12, // Space for badges above
    },
    itemBadgesContainer: {
      position: 'absolute',
      top: 0,
      right: 0,
      flexDirection: 'row',
      gap: 1,
      padding: 1,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
    },
    itemName: {
      fontSize: 7,

      color: c.textSecondary,
      marginTop: 2,
      textAlign: 'center',
      width: '100%',
      paddingHorizontal: 2,
    },
    itemBadge: {
      color: 'white',
      backgroundColor: '#888',
      borderRadius: 10, // Make it perfectly round
      width: 10, // Fixed width
      height: 10, // Fixed height
      fontSize: 6,
      textAlign: 'center',
      lineHeight: 10, // Center text vertically
      fontWeight: '600',
      overflow: 'hidden',
      padding: 0,
      margin: 0,
    },
    itemBadgeFly: {
      backgroundColor: '#3498db',
    },
    itemBadgeRide: {
      backgroundColor: '#e74c3c',
    },
    itemBadgeMega: {
      backgroundColor: '#9b59b6',
    },
    itemBadgeNeon: {
      backgroundColor: '#2ecc71',
    },
    itemImage: {
      width: 30,
      height: 30,
      // marginRight: 5,
      // borderRadius: 25,
      marginVertical: 5,
      borderRadius: 5
      // padding:10

    },
    itemImageUser: {
      width: 20,
      height: 20,
      // marginRight: 5,
      borderRadius: 15,
      marginRight: 5,
      backgroundColor: 'white'
    },
    transferImage: {
      width: 20,
      height: 20,
      // marginRight: 5,
      borderRadius: 5,
      // width:'4%',
    },
    tradeTotals: {
      flexDirection: 'row',
      justifyContent: 'center',
      // marginTop: 10,
      width: '100%'

    },
    priceText: {
      fontSize: 8,
      fontWeight: 'bold',
      color: '#007BFF',
      // width: '40%',
      textAlign: 'center', // Centers text within its own width
      alignSelf: 'center', // Centers within the parent container
      color: isDarkMode ? 'white' : "white",
      marginHorizontal: 'auto',
      paddingHorizontal: 4,
      paddingVertical: 2,
      borderRadius: 6
    },
    priceTextProfit: {
      fontSize: 10,
      lineHeight: 14,

      // color: '#007BFF',
      // width: '40%',
      textAlign: 'center', // Centers text within its own width
      alignSelf: 'center', // Centers within the parent container
      // color: isDarkMode ? 'white' : "grey",
      // marginHorizontal: 'auto',
      // paddingHorizontal: 4,
      // paddingVertical: 2,
      // borderRadius: 6
    },
    hasBackground: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    wantBackground: {
      backgroundColor: config.colors.wantBlockRed,
    },
    tradeActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },

    transfer: {
      // width: '10%',
      justifyContent: 'center',
      alignItems: 'center'
    },
    actionButtons: {
      flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
      borderColor: 'lightgrey', marginTop: 10, paddingTop: 10
    },
    description: {
      color: c.textMuted,

      fontSize: 10,
      marginTop: 5,
      lineHeight: 12
    },
    descriptionclick: {
      color: config.colors.secondary,

      fontSize: 10,
      // marginTop: 5,
      // lineHeight:12

    },
    loader: {
      flex: 1
    },
    dealContainer: {
      paddingVertical: 1,
      paddingHorizontal: 6,
      borderRadius: 6,
      alignSelf: 'center',
      marginRight: 10
    },
    dealContainerSingle: {
      paddingVertical: 5,
      paddingHorizontal: 6,
      borderRadius: 6,
      alignSelf: 'center',
      // height:30,
      // marginRight: 10,
      backgroundColor: 'black',
      // justifyContent: 'center',
      alignItems: 'center',
      marginHorizontal: 'auto'
      // flexD1
    },
    dealText: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 8,
      textAlign: 'center',
      // alignItems: 'center',
      // justifyContent: 'center'
      // backgroundColor:'black'

    },
    names: {
      fontWeight: 'bold',
      fontSize: 8,
      color: c.text,
      marginTop: -3
    },
    tagcount: {
      position: 'absolute',
      backgroundColor: 'purple',
      top: -1,
      left: -1,
      borderRadius: 50,
      paddingHorizontal: 3,
      paddingBottom: 2

    },
    tagcounttext: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 10
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      borderTopWidth: 1,
      backgroundColor: '#F5A327',
      paddingTop: 5,
      marginTop: 10,
      borderTopColor: config.colors.hasBlockGreen
    },
    // ✅ New feed-style card styles
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
    },
    cardAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 2,
      borderColor: c.border,
    },
    cardName: {
      fontWeight: '700',
      fontSize: 13,
      color: c.text,
      flexShrink: 1,
    },
    cardTime: {
      fontSize: 11,
      color: c.textMuted,
      marginTop: 1,
    },
    statusBadge: {
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 8,
    },
    statusBadgeText: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 10,
    },
    tagTextFeatured: {
      color: '#fff',
      fontSize: 7,
      fontWeight: 'bold',
    },
    ownerActions: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 8,
    },
    ownerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingVertical: 2,
      paddingHorizontal: 3,
      borderRadius: 3,
    },
    ownerBtnText: {
      color: 'white',
      fontSize: 9,
      fontWeight: '600',
    },
    socialActionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
      paddingTop: 8,
      borderTopWidth: 1,
      borderTopColor: c.divider,
    },
    socialBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 6,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: c.bg,
      gap: 4,
    },
    socialBtnText: {
      fontSize: 12,
      color: config.colors.primary,
      fontWeight: '600',
    },
    chatBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: config.colors.hasBlockGreen,
      gap: 4,
      shadowColor: config.colors.primary,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.2,
      shadowRadius: 3,
      elevation: 2,
    },
    chatBtnText: {
      color: '#ffffff',
      fontWeight: '700',
      fontSize: 9,
    },
    tag: {
      backgroundColor: config.colors.hasBlockGreen,
      position: 'absolute',
      top: 0,
      left: 0,
      paddingHorizontal: 12,
      paddingVertical: 1,
      borderTopLeftRadius: 12,
      borderBottomRightRadius: 10,
      zIndex: 10,
    },
    tagText: {
      color: '#fff',
      fontSize: 7,
      fontWeight: 'bold',
    },
    icon: {
      // marginRight: 1,
      fontSize: 12,
    },
    boost: {
      justifyContent: 'flex-start', paddingVertical: 2, paddingHorizontal: 5, borderRadius: 3, alignItems: 'center', margin: 4
    },
    scrollToTopButton: {
      position: 'absolute',
      bottom: 60, // Position above the bottom ad banner
      right: 8,
      zIndex: 1000,
      elevation: 8, // For Android shadow
      shadowColor: '#000', // For iOS shadow
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
    },
    scrollToTopTouchable: {
      borderRadius: 28,
      // backgroundColor: isDarkMode ? 'rgba(30, 30, 30, 0.9)' : 'rgba(255, 255, 255, 0.9)',
      // padding: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },

  });
};

const badgeStyles = StyleSheet.create({
  inlineIcon: {
    width: 11,
    height: 11,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 5,
    gap: 2,
  },
  roleBadgeText: {
    color: '#fff',
    fontSize: 7,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffb700be',
    borderRadius: 5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    gap: 2,
  },
  ratingText: {
    fontSize: 7,
    color: 'white',
    fontWeight: '600',
  },
});

export default TradeList;