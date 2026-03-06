import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet, Image, ActivityIndicator, TextInput, Alert, Platform, Animated } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';
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
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import { useHaptic } from '../Helper/HepticFeedBack';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  Timestamp,
  where,
  query,
  startAfter,
  updateDoc,
} from '@react-native-firebase/firestore';

// Initialize dayjs plugins
dayjs.extend(relativeTime);


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
  // const [openShareModel, setOpenShareModel] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [bannedUsers, setBannedUsers] = useState([]);


  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isReportPopupVisible, setReportPopupVisible] = useState(false);
  const PAGE_SIZE = 20;
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const { localState, updateLocalState } = useLocalState()
  const navigation = useNavigation()
  const { theme, firestoreDB } = useGlobalState()
  const [isProStatus, setIsProStatus] = useState(localState.isPro);
  const { t } = useTranslation();
  const platform = Platform.OS.toLowerCase();
  const isDarkMode = theme === 'dark'
  const isInitialMountRef = useRef(true); // ✅ Track initial mount to prevent double fetch
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

  useEffect(() => {
    // console.log(localState.isPro, 'from trade model'); // ✅ Check if isPro is updated
    setIsProStatus(localState.isPro); // ✅ Force update state and trigger re-render
  }, [localState.isPro]);

  // ✅ Client-side filtering for non-search scenarios (filters, banned users)
  useEffect(() => {
    const bannedUsersList = Array.isArray(bannedUsers) ? bannedUsers : [];

    setFilteredTrades(
      trades.filter((trade) => {
        // ✅ Filter out trades from blocked users
        if (bannedUsersList.includes(trade.userId)) {
          return false;
        }

        // ✅ If no filters selected, show all trades
        if (selectedFilters.length === 0) {
          return true;
        }

        // ✅ Separate filter types
        const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
        const hasMyTradesFilter = selectedFilters.includes("myTrades");

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

        // ✅ All selected filters must match (AND logic)
        return matchesStatus && matchesMyTrades;
      })
    );
  }, [trades, selectedFilters, user.id, bannedUsers]);

  useEffect(() => {
    if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [user?.id, localState.bannedUsers]);

  // const getTradeDeal = (hasTotal, wantsTotal) => {
  //   if (hasTotal.value <= 0) {
  //     return { label: "trade.unknown_deal", color: "#8E8E93" }; // ⚠️ Unknown deal (invalid input)
  //   }

  //   const tradeRatio = wantsTotal.value / hasTotal.value;
  //   let deal;

  //   if (tradeRatio >= 0.05 && tradeRatio <= 0.6) {
  //     deal = { label: "trade.best_deal", color: "#34C759" }; // ✅ Best Deal
  //   } else if (tradeRatio > 0.6 && tradeRatio <= 0.75) {
  //     deal = { label: "trade.great_deal", color: "#32D74B" }; // 🟢 Great Deal
  //   } else if (tradeRatio > 0.75 && tradeRatio <= 1.25) {
  //     deal = { label: "trade.fair_deal", color: "#FFCC00" }; // ⚖️ Fair Deal
  //   } else if (tradeRatio > 1.25 && tradeRatio <= 1.4) {
  //     deal = { label: "trade.decent_deal", color: "#FF9F0A" }; // 🟠 Decent Deal
  //   } else if (tradeRatio > 1.4 && tradeRatio <= 1.55) {
  //     deal = { label: "trade.weak_deal", color: "#D65A31" }; // 🔴 Weak Deal
  //   } else {
  //     deal = { label: "trade.risky_deal", color: "#7D1128" }; // ❌ Risky Deal (Missing in your original code)
  //   }

  //   return { deal, tradeRatio };
  // };
  // console.log(localState.featuredCount, 'featu')
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

      // ✅ Build query for more normal trades
      let normalQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', false),
        orderBy('timestamp', 'desc'),
        startAfter(lastDoc),
        limit(PAGE_SIZE)
      );

      // ✅ Add status filter if status filters are selected
      if (statusValues && statusValues.length > 0) {
        normalQuery = query(
          collection(firestoreDB, 'trades_new'),
          where('isFeatured', '==', false),
          where('status', 'in', statusValues),
          orderBy('timestamp', 'desc'),
          startAfter(lastDoc),
          limit(PAGE_SIZE)
        );
      }

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
  }, [lastDoc, hasMore, remainingFeaturedTrades, firestoreDB, selectedFilters]);



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

      // ✅ Search in ME side (hasItemNames) - SERVER-SIDE filtering
      // Requires composite index: hasItemNames (array-contains) + timestamp (desc)
      if (searchInHas) {
        try {
          const hasQuery = lastDocSnapshot
            ? query(
              collection(firestoreDB, 'trades_new'),
              where('hasItemNames', 'array-contains', searchTermLower),
              orderBy('timestamp', 'desc'),
              startAfter(lastDocSnapshot),
              limit(SEARCH_PAGE_SIZE)
            )
            : query(
              collection(firestoreDB, 'trades_new'),
              where('hasItemNames', 'array-contains', searchTermLower),
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
          // If index missing, show link to create it
          if (error.message?.includes('index')) {
            console.log('📌 Create index at:', error.message.match(/https:\/\/[^\s]+/)?.[0]);
          }
        }
      }

      // ✅ Search in YOU side (wantsItemNames) - SERVER-SIDE filtering
      // Requires composite index: wantsItemNames (array-contains) + timestamp (desc)
      if (searchInWants) {
        try {
          const wantsQuery = lastDocSnapshot
            ? query(
              collection(firestoreDB, 'trades_new'),
              where('wantsItemNames', 'array-contains', searchTermLower),
              orderBy('timestamp', 'desc'),
              startAfter(lastDocSnapshot),
              limit(SEARCH_PAGE_SIZE)
            )
            : query(
              collection(firestoreDB, 'trades_new'),
              where('wantsItemNames', 'array-contains', searchTermLower),
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

  const fetchInitialTrades = useCallback(async () => {
    setLoading(true);
    try {
      // ✅ Get status filters (win, lose, fair) and map to status values (w, l, f)
      const statusFilters = selectedFilters.filter(f => ['win', 'lose', 'fair'].includes(f));
      const statusValues = statusFilters.length > 0
        ? statusFilters.map(f => ({ win: 'w', lose: 'l', fair: 'f' }[f]))
        : null;

      // ✅ Build query for normal trades
      let normalQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', false),
        orderBy('timestamp', 'desc'),
        limit(PAGE_SIZE)
      );

      // ✅ Add status filter if status filters are selected
      if (statusValues && statusValues.length > 0) {
        normalQuery = query(
          collection(firestoreDB, 'trades_new'),
          where('isFeatured', '==', false),
          where('status', 'in', statusValues),
          orderBy('timestamp', 'desc'),
          limit(PAGE_SIZE)
        );
      }

      const normalTradesQuerySnap = await getDocs(normalQuery);

      const normalTrades = normalTradesQuerySnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      }));


      // ✅ Build query for featured trades
      let featuredQuery = query(
        collection(firestoreDB, 'trades_new'),
        where('isFeatured', '==', true),
        where('featuredUntil', '>', Timestamp.now()),
        orderBy('featuredUntil', 'desc')
      );

      // ✅ Add status filter to featured trades if status filters are selected
      if (statusValues && statusValues.length > 0) {
        featuredQuery = query(
          collection(firestoreDB, 'trades_new'),
          where('isFeatured', '==', true),
          where('featuredUntil', '>', Timestamp.now()),
          where('status', 'in', statusValues),
          orderBy('featuredUntil', 'desc')
        );
      }

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
    } catch (error) {
      console.error('❌ Error fetching trades:', error);
      // ✅ If error is about missing index, log helpful message
      if (error.code === 'failed-precondition') {
        console.warn('⚠️ Firestore index required. Please create composite index for: status + timestamp');
      }
    } finally {
      setLoading(false);
    }
  }, [firestoreDB, selectedFilters]);


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

    // Refetch when status filters change to apply database-level filtering
    if (user?.id) {
      fetchInitialTrades();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFiltersString]); // ✅ Only refetch when status filters change

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


  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

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
    await fetchInitialTrades();
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


  const renderTrade = ({ item, index }) => {
    // const { deal } = getTradeDeal(item.hasTotal, item.wantsTotal);

    const isProfit = item.hasTotal > item.wantsTotal; // Profit if trade ratio > 1
    const neutral = item.hasTotal === item.wantsTotal // Exactly 1:1 trade
    const formattedTime = item.timestamp ? dayjs(item.timestamp.toDate()).fromNow() : "Unknown";
    // if ((index + 1) % 10 === 0 && !isProStatus) {
    //   return <MyNativeAdComponent />;
    // }
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
      <View style={[styles.tradeItem, item.isFeatured && { backgroundColor: isDarkMode ? '#34495E' : 'rgba(245, 222, 179, 0.6)' }]}>
        {item.isFeatured && <View style={styles.tag}><Text style={styles.tagText}>Featured</Text></View>}


        <View style={styles.tradeHeader}>
          <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }} onPress={() => handleOpenProfile(item)}>
            <Image source={{ uri: item.avatar }} style={styles.itemImageUser} />

            <View style={{ justifyContent: 'center', marginLeft: 10 }}>
              <Text style={styles.traderName}>
                {item.traderName}{' '}
                {item.isPro && (
                  <Image
                    source={require('../../assets/pro.png')}
                    style={{ width: 10, height: 10 }}
                  />
                )}{' '}
                {item.robloxUsernameVerified && (
                  <Image
                    source={require('../../assets/verification.png')}
                    style={{ width: 10, height: 10 }}
                  />
                )}{' '}
                {(() => {
                  const hasRecentWin =
                    !!item?.hasRecentGameWin ||
                    (typeof item?.lastGameWinAt === 'number' &&
                      Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);
                  return hasRecentWin ? (
                    <Image
                      source={require('../../assets/trophy.webp')}
                      style={{ width: 10, height: 10 }}
                    />
                  ) : null;
                })()}{' '}
                {item.rating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, backgroundColor: '#ffb700be', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 2, marginLeft: 5 }}>
                    <Icon name="star" size={8} color="white" style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 8, color: 'white' }}>{parseFloat(item.rating).toFixed(1)}({item.ratingCount})</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, backgroundColor: '#888', borderRadius: 5, paddingHorizontal: 2, paddingVertical: 1, marginLeft: 5 }}>
                    <Icon name="star-outline" size={8} color="white" style={{ marginRight: 4 }} />
                    <Text style={{ fontSize: 8, color: 'white' }}>N/A</Text>
                  </View>
                )}


              </Text>

              {/* Rating Info */}


              <Text style={styles.tradeTime}>{formattedTime}</Text>
            </View>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row' }}>
            {/* Status Badge (Win/Lose/Fair) - Only show if status field exists */}
            {item.status && (
              <View style={[
                styles.dealContainer,
                {
                  backgroundColor: item.status === 'w' ? '#10B981' : // Green for win
                    item.status === 'f' ? config.colors.secondary : // Blue for fair
                      config.colors.primary, // Pink/red for lose
                  marginRight: 5,
                }
              ]}>
                <Text style={styles.dealText}>
                  {item.status === 'w' ? t('trade.status_win') : item.status === 'f' ? t('trade.status_fair') : t('trade.status_lose')}
                </Text>
              </View>
            )}

            <FontAwesome
              name='message'
              size={18}
              color={config.colors.primary}
              onPress={() => handleOpenProfile(item)}
              solid={false}
            />
            {/* <Icon
              name="chatbox-outline"
              size={18}
              color={config.colors.secondary}
              onPress={handleChatNavigation}
            /> */}
          </View>
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
            {(item.hasItems && item.hasItems.length > 0 && item.wantsItems && item.wantsItems.length > 0) && (
              <>
                {item.hasTotal > item.wantsTotal && (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon
                      name="arrow-up-outline"
                      size={12}
                      color={'green'}
                      style={styles.icon}
                    />
                    <Text style={[styles.priceText, { color: 'green', }]}>
                      {formatValue(item.hasTotal - item.wantsTotal)}
                    </Text>
                  </View>
                )}
                {item.hasTotal < item.wantsTotal && (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon
                      name="arrow-down-outline"
                      size={12}
                      color={config.colors.hasBlockGreen}
                      style={styles.icon}
                    />
                    <Text style={[styles.priceText, { color: config.colors.hasBlockGreen }]}>
                      {formatValue(item.wantsTotal - item.hasTotal)}
                    </Text>
                  </View>
                )}
                {item.hasTotal === item.wantsTotal && (
                  <Text style={[styles.priceText, { color: config.colors.primary }]}>-</Text>
                )}
              </>
            )}
          </View>
          {item.wantsItems && item.wantsItems.length > 0 && (
            <Text style={[styles.priceText, styles.wantBackground]}>
              {t('trade.you')}: {formatValue(item.wantsTotal)}
            </Text>
          )}
        </View>

        {/* Description */}
        {item.description && <Text style={styles.description}>{renderTextWithUsername(item.description)}
        </Text>}
        {item.userId === user.id && (<View style={styles.footer}>
          {!item.isFeatured &&
            <TouchableOpacity onPress={() => handleMakeFeatureTrade(item)} style={[styles.boost, { backgroundColor: 'purple' }]}>
              <Text




                style={{ color: 'white', }}
              >{t('trade.boost_it')}</Text>
            </TouchableOpacity>}
          <TouchableOpacity onPress={() => handleDelete(item)} style={[styles.boost, { backgroundColor: 'black' }]}>
            <Text


              color={config.colors.secondary}

              style={{ color: 'white', }}
            >{t('trade.delete_it')}</Text>
          </TouchableOpacity>
          {/* <Icon
            name="share-social"
            size={24}
            color={config.colors.primary}
            onPress={() => {
              setSelectedTrade(item); // ✅ Set the selected trade
              setOpenShareModel(true); // ✅ Then open the modal
            }}
          /> */}



        </View>)}
        {/* <ShareTradeModal
          visible={openShareModel}
          onClose={() => setOpenShareModel(false)}
          tradeData={selectedTrade}
        /> */}

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
            backgroundColor: isDarkMode ? '#1C1C1E' : '#FFF',
            color: isDarkMode ? '#FFF' : '#000',
            borderWidth: 1,
            borderColor: isDarkMode ? '#333' : '#E5E5EA'
          }}
          placeholder={t("trade.search_placeholder") || "Search items..."}
          placeholderTextColor={isDarkMode ? '#888' : '#666'}
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={() => {
            setSearchLastDoc(null);
            setSearchHasMore(true);
            if (searchQuery.trim()) {
              handleSearchTrades(false);
            }
          }}
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
          onPress={() => {
            setSearchLastDoc(null);
            setSearchHasMore(true);
            if (searchQuery.trim()) {
              handleSearchTrades(false);
            }
          }}
          disabled={isSearching}
        >
          {isSearching ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Icon name="search" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* ✅ Search Options Checkboxes (Below Search Bar) */}
      {(searchQuery.length > 0) && (
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 10, flexWrap: 'wrap' }}>
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
              {searchInHas && <Icon name="checkmark" size={14} color="#fff" />}
            </View>
            <Text style={[styles.checkboxLabel, { color: isDarkMode ? '#fff' : '#000' }]}>
              {t("trade.search_in_me") || "Me (Has)"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.checkboxContainer, !searchInWants && styles.checkboxUnchecked, { marginLeft: 15 }]}
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
              {searchInWants && <Icon name="checkmark" size={14} color="#fff" />}
            </View>
            <Text style={[styles.checkboxLabel, { color: isDarkMode ? '#fff' : '#000' }]}>
              {t("trade.search_in_you") || "Them (Wants)"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setSearchQuery('');
              setIsSearchMode(false);
              setSearchLastDoc(null);
              setSearchHasMore(true);
              fetchInitialTrades();
            }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginLeft: 'auto',
              padding: 5
            }}
          >
            <Text style={{ color: isDarkMode ? '#999' : '#666', fontSize: 12, marginRight: 4 }}>Clear</Text>
            <Icon name="close-circle" size={16} color={isDarkMode ? '#999' : '#666'} />
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={filteredTrades}
        renderItem={renderTrade}
        keyExtractor={(item) => item.isFeatured ? `featured-${item.id}` : item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.2}
        removeClippedSubviews={true} // 🚀 Reduce memory usage
        initialNumToRender={10} // 🔹 Render fewer items at start
        maxToRenderPerBatch={10} // 🔹 Load smaller batches
        updateCellsBatchingPeriod={50} // 🔹 Reduce updates per frame
        windowSize={5} // 🔹 Keep only 5 screens worth in memory
        refreshing={refreshing} // Add Pull-to-Refresh
        onRefresh={handleRefresh} // Attach Refresh Handler
        onScroll={({ nativeEvent }) => {
          const { contentOffset } = nativeEvent;
          // ✅ Check if user is at top (within 60px from top)
          const atTop = contentOffset.y <= 60;
          setIsAtTop(atTop);
        }}
        scrollEventThrottle={16}
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

      {!localState.isPro && <BannerAdComponent />}

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
              color={config.colors.primary}
            />
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
};
const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 8,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      flex: 1,
    },
    tradeItem: {
      padding: 10,
      marginBottom: 10,
      // marginHorizontal: 10,
      backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',

      borderRadius: 10, // Smooth rounded corners
      borderWidth: !config.isNoman ? 3 : 0,
      borderColor: config.colors.hasBlockGreen,
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
      backgroundColor: isDarkMode ? '#2a2a2a' : '#f0f0f0',
      borderRadius: 10,
      paddingHorizontal: 6,
      borderWidth: 1.5,
      borderColor: isDarkMode ? '#444' : '#c5c5c5',
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
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: isDarkMode ? '#2a2a2a' : '#e8e8e8',
      borderWidth: isDarkMode ? 0 : 1,
      borderColor: isDarkMode ? 'transparent' : '#d0d0d0',
    },
    checkboxUnchecked: {
      opacity: 0.6,
    },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 4,
      borderWidth: 2,
      borderColor: config.colors.primary,
      marginRight: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    checkboxChecked: {
      backgroundColor: config.colors.primary,
      borderColor: config.colors.primary,
    },
    checkboxLabel: {
      fontSize: 13,

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
      color: isDarkMode ? 'white' : "black",
    },
    traderName: {
      fontWeight: 'bold',
      fontSize: 8,
      color: isDarkMode ? 'white' : "black",

    },
    tradeTime: {
      fontSize: 8,
      color: isDarkMode ? 'lightgrey' : "grey",
      // color: 'lightgrey'

    },
    tradeDetails: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      color: isDarkMode ? 'white' : "black",
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

      color: isDarkMode ? '#ccc' : '#666',
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
      color: isDarkMode ? 'lightgrey' : "grey",

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
      color: isDarkMode ? 'white' : "black",
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
      // paddingHorizontal: 30,
      paddingTop: 5,
      marginTop: 10,
      borderTopColor: config.colors.hasBlockGreen
    },
    tag: {
      backgroundColor: config.colors.hasBlockGreen,
      position: 'absolute',
      top: 0,
      left: 0,
      paddingHorizontal: 8,
      paddingVertical: 1,
      borderTopLeftRadius: 8,
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

export default TradeList;