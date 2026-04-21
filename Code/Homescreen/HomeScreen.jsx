import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList, TextInput, Image, Pressable, Platform, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import { useNavigation } from '@react-navigation/native';
import { useGlobalState } from '../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import { getThemeColors } from '../Helper/themeColors';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { getDatabase, ref, update, get } from '@react-native-firebase/database';
import { awardBadge, incrementAndCheckBadge, TRADE_BADGE_THRESHOLDS, checkNightOwlTrade } from '../ChatScreen/GroupChat/badgeUtils';
import { useLocalState } from '../LocalGlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import { useTranslation } from 'react-i18next';
import { isMatch } from '../Helper/searchHelper';
import { fetchAnalyticsData, getDemandScore, getHotStatus } from '../Helper/analyticsDataHelper';
import { useBanStatus } from '../ChatScreen/utils';
// useLanguage removed - using i18n.language from useTranslation hook
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import Share from 'react-native-share';
import ShareTradeModal from '../Trades/ShareTradeModal';
import { addDoc, collection, serverTimestamp, doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import SubscriptionScreen from '../SettingScreen/OfferWall';
import TradeCompletion from '../Engagement/TradeCompletion';

const GRID_STEPS = [9, 12, 15, 18];

const createEmptySlots = (count) => Array(count).fill(null);



// const CATEGORIES = ['ALL', 'PETS', 'EGGS', 'VEHICLES', 'PET WEAR', 'OTHER', 'FAVORITES'];
const VALUE_TYPES = ['D', 'N', 'M'];
const MODIFIERS = ['F', 'R'];
const hideBadge = ['EGGS', 'VEHICLES', 'PET WEAR', 'OTHER', 'STICKERS'];

const getItemValue = (item, selectedValueType, isFlySelected, isRideSelected, isSharkMode = true, factor) => {
  if (!item) return 0;

  // Categories that only use 'value' field
  const simpleValueCategories = ['eggs', 'vehicles', 'pet wear', 'other', 'toys', 'strollers', 'food', 'gifts', 'stickers'];


  // Handle simple value categories
  if (simpleValueCategories.includes(item.type?.toLowerCase())) {
    const value = Number(item.type?.toLowerCase() === 'eggs' ? item.rvalue : item.value) || 0;
    return Number((isSharkMode ? value : value / factor).toFixed(2));
  }

  // For pets, use the exact value key based on selected type and modifiers
  if (!selectedValueType) return 0;

  // Determine value key based on selected type
  const valueKey = selectedValueType === 'n' ? 'nvalue' :
    selectedValueType === 'm' ? 'mvalue' : 'rvalue';

  // Add modifier suffix
  const modifierSuffix = isFlySelected && isRideSelected ? ' - fly&ride' :
    isFlySelected ? ' - fly' :
      isRideSelected ? ' - ride' : ' - nopotion';

  const value = Number(item[valueKey + modifierSuffix]) || 0;
  // console.log(value)
  return Number((isSharkMode ? value : value / factor).toFixed(2));
};

const getTradeStatus = (hasTotal, wantsTotal) => {
  // If both are 0 (initial state), show WIN
  if (hasTotal === 0 && wantsTotal === 0) return 'win';

  // If only has items are selected (wantsTotal is 0), show LOSE
  if (hasTotal > wantsTotal) return 'lose';

  // If only wants items are selected (hasTotal is 0), show WIN
  if (hasTotal < wantsTotal) return 'win';

  // If both have equal values, show FAIR
  return 'fair';
};

const HomeScreen = ({ selectedTheme }) => {
  const navigation = useNavigation();
  const { theme, user, setUser, firestoreDB, single_offer_wall, reload, appdatabase } = useGlobalState();
  const tradesCollection = collection(firestoreDB, 'trades_new');
  const [gridStepIndex, setGridStepIndex] = useState(0); // 0 -> 9, 1 -> 12, 2 -> 15, 3 -> 18
  const [hasItems, setHasItems] = useState(() => createEmptySlots(GRID_STEPS[0]));
  const [showTips, setShowTips] = useState(true);
  const [wantsItems, setWantsItems] = useState(() => createEmptySlots(GRID_STEPS[0]));

  const [fruitRecords, setFruitRecords] = useState([]);
  const [selectedPetType, setSelectedPetType] = useState('MY_STUFF');
  // const [wantsItems, setWantsItems] = useState(INITIAL_ITEMS);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [hasTotal, setHasTotal] = useState(0);
  const [wantsTotal, setWantsTotal] = useState(0);
  const { triggerHapticFeedback } = useHaptic();
  const { localState, updateLocalState } = useLocalState();
  // ✅ State for item selections (value types, fly, ride) for favorites
  const [itemSelections, setItemSelections] = useState({});
  const [modalVisible, setModalVisible] = useState(false);
  const [description, setDescription] = useState('');
  const [robloxUsername, setRobloxUsername] = useState('');
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { t, i18n } = useTranslation();
  const language = i18n.language; // ✅ Using i18n directly instead of useLanguage
  const [lastTradeTime, setLastTradeTime] = useState(null);
  const [adShowen, setadShowen] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [showTradeCompletion, setShowTradeCompletion] = useState(false);
  const [type, setType] = useState(null);
  const platform = Platform.OS.toLowerCase();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  const viewRef = useRef();
  // ✅ Add refs to track timeouts and animation frames for cleanup
  const timeoutRefs = useRef({});
  const rafRefs = useRef({});
  const isMountedRef = useRef(true);
  const [selectedValueType, setSelectedValueType] = useState('d');
  const [isFlySelected, setIsFlySelected] = useState(false);
  const [isRideSelected, setIsRideSelected] = useState(false);
  const [isSharkMode, setIsSharkMode] = useState(true);
  const [isAddingToFavorites, setIsAddingToFavorites] = useState(false);
  const [isShareModalVisible, setIsShareModalVisible] = useState(false);
  const [debouncedSearchText, setDebouncedSearchText] = useState(searchText);
  const [factor, setFactor] = useState(null);
  const [showofferwall, setShowofferwall] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedTime, setLastUpdatedTime] = useState(new Date());
  const [analyticsMaps, setAnalyticsMaps] = useState({ demandMap: {}, hotMap: {} });
  const [viewMode, setViewMode] = useState('standard'); // 'standard' or 'detailed'

  // Load analytics data for demand/hot badges
  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        const data = await fetchAnalyticsData();
        setAnalyticsMaps(data);
      } catch (e) {
        console.warn('[HomeScreen] Analytics data load failed:', e.message);
      }
    };
    loadAnalytics();
  }, []);


  // ✅ Check ban status
  const { isBanned, banDetails } = useBanStatus(user?.email);

  // ✅ Cleanup all timeouts and animation frames on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clear all timeouts
      Object.values(timeoutRefs.current).forEach(id => {
        if (id) clearTimeout(id);
      });
      timeoutRefs.current = {};
      // Cancel all animation frames
      Object.values(rafRefs.current).forEach(id => {
        if (id) cancelAnimationFrame(id);
      });
      rafRefs.current = {};
    };
  }, []);



  const CATEGORIES = useMemo(() => {
    return ['MY_STUFF', 'ALL', 'PETS', 'EGGS', 'TOYS', 'VEHICLES', 'PET WEAR', 'STROLLERS', 'OTHER', 'FOOD', 'GIFTS', 'STICKERS'].map(cat => cat.toUpperCase());
  }, []);

  const getCategoryLabel = useCallback((category) => {
    const key = category.toLowerCase().replace(' ', '_');
    return t(`home.categories.${key}`, category);
  }, [t]);

  const tradeStatus = useMemo(() =>
    getTradeStatus(hasTotal, wantsTotal)
    , [hasTotal, wantsTotal]);


  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchText(searchText);
    }, 300); // Adjust delay as needed

    return () => clearTimeout(timeout);
  }, [searchText]);
  const progressBarStyle = useMemo(() => {
    // When both sides are empty, show a balanced fair state (50-50)
    if (!hasTotal && !wantsTotal) return { left: '50%', right: '50%' };

    const total = hasTotal + wantsTotal;
    const hasPercentage = (hasTotal / total) * 100;
    const wantsPercentage = (wantsTotal / total) * 100;

    return {
      left: `${hasPercentage}%`,
      right: `${wantsPercentage}%`
    };
  }, [hasTotal, wantsTotal]);



  const handleLoginSuccess = useCallback(() => {
    setIsSigninDrawerVisible(false);
  }, []);

  // ✅ Format last updated time as relative string
  const getLastUpdatedText = useCallback(() => {
    const now = new Date();
    const diffMs = now - lastUpdatedTime;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return t('settings.time.just_now');
    if (diffMins === 1) return t('settings.time.min_ago_one', { count: 1 });
    if (diffMins < 60) return t('settings.time.min_ago_other', { count: diffMins });
    if (diffHours === 1) return t('settings.time.hour_ago_one', { count: 1 });
    if (diffHours < 24) return t('settings.time.hour_ago_other', { count: diffHours });
    return lastUpdatedTime.toLocaleDateString();
  }, [lastUpdatedTime, t]);

  // ✅ Hard refresh values - reloads data from CDN/Firebase
  const handleRefresh = useCallback(async () => {
    if (refreshing || !isMountedRef.current) return;

    triggerHapticFeedback('impactLight');
    setRefreshing(true);

    try {
      await reload(); // Re-fetch values data from CDN/Firebase
      // ✅ Check if component is still mounted before updating state
      if (!isMountedRef.current) return;
      // ✅ Update last refreshed time
      setLastUpdatedTime(new Date());
      // ✅ Show success message when values are reloaded
      showSuccessMessage(t('home.alert.success'), t('home.alert.values_reloaded'));
    } catch (error) {
      console.error('Error refreshing values:', error);
      if (!isMountedRef.current) return;
      showErrorMessage(t('home.alert.error'), t('home.alert.reload_error'));
    } finally {
      if (isMountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [reload, refreshing, triggerHapticFeedback]);

  const resetState = useCallback(() => {
    triggerHapticFeedback('impactLight');
    setSelectedSection(null);
    setHasTotal(0);
    setWantsTotal(0);
    setGridStepIndex(0);
    setHasItems(createEmptySlots(GRID_STEPS[0]));
    setWantsItems(createEmptySlots(GRID_STEPS[0]));
  }, [triggerHapticFeedback]);


  // ✅ getImageUrl - No longer needs fallback since favorites now use current data
  const getImageUrl = useCallback((item, baseImgUrl) => {
    if (!item || !item.name) return '';

    // For non-GG mode, check if item has image property
    if (item.image && baseImgUrl) {
      return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}/${item.image.replace(/^\//, '')}`;
    }

    return '';
  }, []);


  const updateTotal = useCallback((item, section, add = true, isNew = false) => {
    if (!item) return;

    const value = Number(item.selectedValue) || 0;
    const valueChange = isNew ? (add ? value : -value) : 0;

    if (section === 'has') {
      setHasTotal(prev => prev + valueChange);
    } else {
      setWantsTotal(prev => prev + valueChange);
    }
  }, []);

  const handleBadgePress = useCallback((badge) => {
    if (badge === 'F') {
      setIsFlySelected(prev => !prev);
    } else if (badge === 'R') {
      setIsRideSelected(prev => !prev);
    } else {
      setSelectedValueType(badge.toLowerCase());
    }
  }, []);
  const maybeExpandGrid = useCallback(
    (nextHasItems, nextWantsItems) => {
      const currentSize = GRID_STEPS[gridStepIndex];
      const maxStepIndex = GRID_STEPS.length - 1;

      const hasCount = nextHasItems.filter(Boolean).length;
      const wantsCount = nextWantsItems.filter(Boolean).length;

      // Already at max (18 slots per side)
      if (gridStepIndex === maxStepIndex) {
        setHasItems(nextHasItems);
        setWantsItems(nextWantsItems);
        return;
      }

      // If either side filled all current slots -> grow to next step
      if (hasCount >= currentSize || wantsCount >= currentSize) {
        const nextSize = GRID_STEPS[gridStepIndex + 1];
        const diff = nextSize - currentSize;

        setGridStepIndex((prev) => prev + 1);
        setHasItems([...nextHasItems, ...createEmptySlots(diff)]);
        setWantsItems([...nextWantsItems, ...createEmptySlots(diff)]);
      } else {
        setHasItems(nextHasItems);
        setWantsItems(nextWantsItems);
      }
    },
    [gridStepIndex]
  );


  const selectItem = useCallback(
    (item) => {
      if (!item || !selectedSection) return;

      triggerHapticFeedback('impactLight');
      // console.log(item)

      const value = getItemValue(
        item,
        selectedValueType,
        isFlySelected,
        isRideSelected,
        isSharkMode,
        factor
      );

      const selectedItem = {
        ...item,
        selectedValue: value,
        valueType: selectedValueType,
        isFly: isFlySelected,
        isRide: isRideSelected,
      };

      // Work on copies of both sides so we can decide expansion
      const nextHasItems = [...hasItems];
      const nextWantsItems = [...wantsItems];


      const targetArray =
        selectedSection === 'has' ? nextHasItems : nextWantsItems;

      let nextEmptyIndex = targetArray.indexOf(null);

      // No empty slot left even at 18 → do nothing
      if (nextEmptyIndex === -1) {
        return;
      }

      targetArray[nextEmptyIndex] = selectedItem;

      // Update totals for the side we modified
      updateTotal(
        selectedItem,
        selectedSection === 'has' ? 'has' : 'wants',
        true,
        true
      );

      // This will also expand 9→12→15→18 if needed
      maybeExpandGrid(nextHasItems, nextWantsItems);

      setIsDrawerVisible(false);
    },
    [
      hasItems,
      wantsItems,
      selectedSection,
      selectedValueType,
      isFlySelected,
      isRideSelected,
      isSharkMode,
      isSharkMode,
      factor,
      triggerHapticFeedback,
      updateTotal,
      maybeExpandGrid,
    ]
  );


  const handleCellPress = useCallback((index, isHas) => {
    const items = isHas ? hasItems : wantsItems;
    // console.log(items);

    const callbackfunction = () => { };

    if (items[index]) {
      triggerHapticFeedback('impactLight');
      const item = items[index];
      const updatedItems = [...items];
      updatedItems[index] = null;

      if (isHas) {
        setHasItems(updatedItems);
        updateTotal(item, 'has', false, true);
      } else {
        setWantsItems(updatedItems);
        updateTotal(item, 'wants', false, true);
      }
    } else {
      triggerHapticFeedback('impactLight');
      setSelectedSection(isHas ? 'has' : 'wants');
      setIsDrawerVisible(true);

      // ✅ Store timeout and animation frame IDs for cleanup
      const rafKey1 = `cellPress_${Date.now()}_1`;
      const timeoutKey1 = `cellPress_${Date.now()}_2`;
      const rafKey2 = `cellPress_${Date.now()}_3`;
      const timeoutKey2 = `cellPress_${Date.now()}_4`;

      rafRefs.current[rafKey1] = requestAnimationFrame(() => {
        if (!isMountedRef.current) return;

        timeoutRefs.current[timeoutKey1] = setTimeout(() => {
          if (!isMountedRef.current) return;

          if (!adShowen && index === 1 && !localState.isPro && !isHas) {
            rafRefs.current[rafKey2] = requestAnimationFrame(() => {
              if (!isMountedRef.current) return;

              timeoutRefs.current[timeoutKey2] = setTimeout(() => {
                if (!isMountedRef.current) return;

                try {
                  callbackfunction();
                } catch (err) {
                  console.warn('[AdManager] Failed to show ad:', err);
                  callbackfunction();
                }
                // Clean up after execution
                delete timeoutRefs.current[timeoutKey2];
              }, 400);
            });
          } else {
            callbackfunction();
          }
          // Clean up after execution
          delete timeoutRefs.current[timeoutKey1];
        }, 500);
      });
    }
  }, [hasItems, wantsItems, triggerHapticFeedback, updateTotal, adShowen, localState.isPro]);

  // Memoize the mode change effect to prevent unnecessary recalculations
  const updateItemsForMode = useCallback((items) => {
    return items.map(item => {
      if (!item) return null;
      const value = getItemValue(item, item.valueType, item.isFly, item.isRide, isSharkMode, factor);
      return { ...item, selectedValue: value };
    });
  }, [isSharkMode, factor]); // ✅ Added missing dependencies

  // ✅ Optimize the mode change effect - Fixed: Only update when mode changes, not when items change
  useEffect(() => {
    // ✅ Check if component is still mounted
    if (!isMountedRef.current) return;

    // ✅ Use functional updates to avoid dependency on hasItems/wantsItems
    setHasItems(prevItems => {
      if (!isMountedRef.current) return prevItems; // Return previous state if unmounted
      const updated = updateItemsForMode(prevItems);
      const newTotal = updated.reduce((sum, item) => sum + (item?.selectedValue || 0), 0);
      if (isMountedRef.current) {
        setHasTotal(newTotal);
      }
      return updated;
    });

    setWantsItems(prevItems => {
      if (!isMountedRef.current) return prevItems; // Return previous state if unmounted
      const updated = updateItemsForMode(prevItems);
      const newTotal = updated.reduce((sum, item) => sum + (item?.selectedValue || 0), 0);
      if (isMountedRef.current) {
        setWantsTotal(newTotal);
      }
      return updated;
    });
  }, [isSharkMode, updateItemsForMode]); // ✅ Removed hasItems/wantsItems from deps to prevent infinite loop
  // Add toggleFavorite function - Save only identifiers (name, type, id) for favorites
  const toggleFavorite = useCallback((item) => {
    if (!item || !item.name) return;

    const currentFavorites = localState.favorites || [];
    // ✅ Save only identifiers to keep favorites updated with latest values
    const favoriteIdentifier = {
      name: item.name,
      type: item.type,
      id: item.id,
    };

    const isFavorite = currentFavorites.some(
      fav => (fav.id && fav.id === item.id) ||
        (fav.name && fav.name.toLowerCase() === item.name.toLowerCase() && fav.type && fav.type.toLowerCase() === item.type?.toLowerCase())
    );

    let newFavorites;
    if (isFavorite) {
      // Remove by matching id or name+type
      newFavorites = currentFavorites.filter(
        fav => !((fav.id && fav.id === item.id) ||
          (fav.name && fav.name.toLowerCase() === item.name.toLowerCase() && fav.type && fav.type.toLowerCase() === item.type?.toLowerCase()))
      );
    } else {
      newFavorites = [...currentFavorites, favoriteIdentifier];
    }

    updateLocalState('favorites', newFavorites);
    triggerHapticFeedback('impactLight');
  }, [localState.favorites, updateLocalState, triggerHapticFeedback]);

  // Update filteredData to include favorites
  const memoizedFruitRecords = useMemo(() => {
    return fruitRecords.map(item => {
      if (!item) return null;
      return {
        ...item,
        cachedValue: getItemValue(item, selectedValueType, isFlySelected, isRideSelected, isSharkMode, factor),
      };
    });
  }, [fruitRecords, selectedValueType, isFlySelected, isRideSelected, isSharkMode, factor]); // ✅ Added missing dependencies

  // Step 3: Use optimized filteredData
  const filteredData = useMemo(() => {
    let list;
    if (selectedPetType === 'MY_STUFF') {
      // Read-only My Stuff list from MMKV (synced from TradeJournal)
      const myPets = localState.ownedPets || [];
      // Build items then group duplicates (same name + valueType + fly + ride)
      const mapped = myPets.map(pet => {
        const petName = (pet.name || '').toLowerCase().trim();
        const foundItem = memoizedFruitRecords.find(
          item => item && (
            (pet.id && item.id === pet.id) ||
            (petName && item.name &&
              item.name.toLowerCase().trim() === petName &&
              pet.category && item.type &&
              item.type.toLowerCase() === pet.category.toLowerCase())
          )
        );
        if (foundItem) {
          const vType = pet.valueType || 'd';
          const fly = pet.isFly || false;
          const ride = pet.isRide || false;
          return {
            ...foundItem,
            _myStuffPet: pet,
            cachedValue: getItemValue(foundItem, vType, fly, ride, isSharkMode, factor),
          };
        }
        return {
          name: pet.name || pet.Name || 'Unknown',
          type: pet.category || 'pets',
          id: pet.id,
          image: pet.imageUrl || pet.image || '',
          _myStuffPet: pet,
          cachedValue: Number(pet.value) || 0,
        };
      });
      // Group duplicates: same name + valueType + fly + ride → single entry with _count
      const groupMap = {};
      mapped.forEach(item => {
        const pet = item._myStuffPet || {};
        const key = `${(item.name || '').toLowerCase().trim()}|${pet.valueType || 'd'}|${pet.isFly ? 1 : 0}|${pet.isRide ? 1 : 0}`;
        if (groupMap[key]) {
          groupMap[key]._count += 1;
        } else {
          groupMap[key] = { ...item, _count: 1, _groupKey: key };
        }
      });
      list = Object.values(groupMap);
    } else {
      list = memoizedFruitRecords;
    }

    return list
      .filter(item => {
        if (!item?.type) return false;
        const matchesSearch = isMatch(item.name, debouncedSearchText);
        const matchesType = selectedPetType === 'MY_STUFF' || selectedPetType === 'ALL' || selectedPetType.toLowerCase() === item.type.toLowerCase();
        return matchesSearch && matchesType;
      })
      .sort((a, b) => (b.cachedValue || 0) - (a.cachedValue || 0));
  }, [
    memoizedFruitRecords,
    debouncedSearchText,
    selectedPetType,
    selectedValueType,
    isFlySelected,
    isRideSelected,
    isSharkMode,
    localState.ownedPets,
    factor
  ]);
  // ✅ Handler for badge presses in favorites (N, M, D, R, F)
  const handleFavoriteBadgePress = useCallback((itemId, badge) => {
    triggerHapticFeedback('impactLight');
    setItemSelections(prev => {
      const currentSelection = prev[itemId] || { valueType: 'd', isFly: false, isRide: false };
      const newSelection = { ...currentSelection };

      switch (badge) {
        case 'F': newSelection.isFly = !currentSelection.isFly; break;
        case 'R': newSelection.isRide = !currentSelection.isRide; break;
        default: newSelection.valueType = badge.toLowerCase();
      }

      return { ...prev, [itemId]: newSelection };
    });
  }, [triggerHapticFeedback]);

  // ✅ BadgeButton component for favorites
  const BadgeButton = useCallback(({ badge, isActive, onPress }) => {
    let activeColor;
    if (badge === 'M') activeColor = '#9b59b6';
    else if (badge === 'N') activeColor = '#2ecc71';
    else if (badge === 'D') activeColor = '#FF6666';
    else if (badge === 'F') activeColor = '#3498db';
    else if (badge === 'R') activeColor = '#e74c3c';

    return (
      <TouchableOpacity
        onPress={onPress}
        style={[
          styles.favoriteBadgeButton,
          isActive && [styles.favoriteBadgeButtonActive, { backgroundColor: activeColor }]
        ]}
      >
        <Text style={[styles.favoriteBadgeButtonText, isActive && styles.favoriteBadgeButtonTextActive]}>
          {badge}
        </Text>
      </TouchableOpacity>
    );
  }, []);

  // Read-only My Stuff item row — tap to add to calculator
  const renderFavoriteItem = useCallback(({ item }) => {
    const pet = item._myStuffPet || {};
    // Use fruitRecords image if matched, else use stored imageUrl (may be full URL)
    let imageUrl = getImageUrl(item, localState.imgurl);
    if (!imageUrl && (pet.imageUrl || pet.image)) {
      const stored = pet.imageUrl || pet.image || '';
      imageUrl = stored.startsWith('http') ? stored : '';
    }
    const currentValue = item.cachedValue || 0;

    // Demand & hot badges
    const demand = getDemandScore(item.name, analyticsMaps.demandMap);
    const hot = getHotStatus(item.name, analyticsMaps.hotMap);

    // Build modifier tags
    const tags = [];
    if (pet.valueType === 'n') tags.push({ label: 'N', color: '#2ecc71' });
    if (pet.valueType === 'm') tags.push({ label: 'M', color: '#9b59b6' });
    if (pet.isFly) tags.push({ label: 'F', color: '#3498db' });
    if (pet.isRide) tags.push({ label: 'R', color: '#e67e22' });

    // Handler to add item to calculator
    const handleAddToCalculator = () => {
      if (!selectedSection) return;
      triggerHapticFeedback('impactLight');

      const selectedItem = {
        ...item,
        selectedValue: currentValue,
        valueType: pet.valueType || 'd',
        isFly: pet.isFly || false,
        isRide: pet.isRide || false,
      };

      const nextHasItems = [...hasItems];
      const nextWantsItems = [...wantsItems];
      const targetArray = selectedSection === 'has' ? nextHasItems : nextWantsItems;
      let nextEmptyIndex = targetArray.indexOf(null);

      if (nextEmptyIndex === -1) return;

      targetArray[nextEmptyIndex] = selectedItem;
      updateTotal(selectedItem, selectedSection === 'has' ? 'has' : 'wants', true, true);
      maybeExpandGrid(nextHasItems, nextWantsItems);
      setIsDrawerVisible(false);
    };

    const count = item._count || 1;

    return (
      <View style={styles.favoriteRowItem}>
        <TouchableOpacity
          style={styles.favoriteClickableArea}
          onPress={handleAddToCalculator}
          activeOpacity={0.7}
        >
          <View style={styles.favoriteImageContainer}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.favoriteItemImage} />
            ) : (
              <View style={[styles.favoriteItemImage, { backgroundColor: isDarkMode ? '#333' : '#ddd', justifyContent: 'center', alignItems: 'center' }]}>
                <Icon name="image-outline" size={18} color={isDarkMode ? '#666' : '#999'} />
              </View>
            )}
            {count > 1 && (
              <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: '#3B82F6', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>x{count}</Text>
              </View>
            )}
          </View>

          <View style={styles.favoriteItemInfo}>
            <Text style={styles.favoriteItemName} numberOfLines={1}>
              {item.name}{count > 1 ? ` (x${count})` : ''}
            </Text>
            <Text style={styles.favoriteItemValue}>Value: {Number(currentValue).toLocaleString()}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
              {tags.map(tag => (
                <View key={tag.label} style={{ backgroundColor: tag.color, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{tag.label}</Text>
                </View>
              ))}
              {demand && demand.score >= 5 && (
                <Text style={{ fontSize: 10, color: demand.score >= 8 ? '#10B981' : '#F59E0B' }}>
                  {demand.label}
                </Text>
              )}
              {hot && (
                <Text style={{ fontSize: 10, color: '#EF4444' }}>+{hot.pct}%</Text>
              )}
              <View style={{
                backgroundColor: pet.availableForTrade ? '#D1FAE5' : (isDarkMode ? '#1e293b' : '#f1f5f9'),
                borderRadius: 4,
                paddingHorizontal: 5,
                paddingVertical: 1,
                borderWidth: 1,
                borderColor: pet.availableForTrade ? '#10B981' : (isDarkMode ? '#334155' : '#e2e8f0'),
              }}>
                <Text style={{ fontSize: 9, fontWeight: '700', color: pet.availableForTrade ? '#10B981' : (isDarkMode ? '#64748B' : '#94a3b8') }}>
                  {pet.availableForTrade ? '✅ For Trade' : '🔒 Private'}
                </Text>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  }, [localState.imgurl, isSharkMode, factor, selectedSection, hasItems, wantsItems, updateTotal, maybeExpandGrid, triggerHapticFeedback, isDarkMode, getImageUrl, analyticsMaps, t]);

  // Update renderGridItem to handle non-favorites mode
  const renderGridItem = useCallback(({ item }) => {
    const imageUrl = getImageUrl(item, localState.imgurl);
    const isFavorite = (localState.favorites || []).some(
      fav => (fav.id && fav.id === item.id) ||
        (fav.name && fav.name.toLowerCase() === item.name?.toLowerCase() && fav.type && fav.type.toLowerCase() === item.type?.toLowerCase())
    );

    const demand = getDemandScore(item.name, analyticsMaps.demandMap);
    const hot = getHotStatus(item.name, analyticsMaps.hotMap);

    if (viewMode === 'detailed') {
      const currentValue = getItemValue(item, selectedValueType, isFlySelected, isRideSelected, isSharkMode, factor);
      return (
        <TouchableOpacity
          style={styles.detailedItem}
          onPress={() => {
            if (isAddingToFavorites) {
              toggleFavorite(item);
            } else {
              selectItem(item);
            }
          }}
        >
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.detailedItemImage} />
          ) : (
            <View style={[styles.detailedItemImage, { backgroundColor: isDarkMode ? '#333' : '#ddd', justifyContent: 'center', alignItems: 'center' }]}>
              <Icon name="image-outline" size={24} color={isDarkMode ? '#666' : '#999'} />
            </View>
          )}
          <View style={styles.detailedItemInfo}>
            <Text numberOfLines={1} style={styles.detailedItemName}>{item.name}</Text>
            <Text style={styles.detailedItemValue}>{t('value.label')} {Number(currentValue).toLocaleString()}</Text>
            {(demand || hot) && (
              <View style={styles.gridAnalyticsRow}>
                {demand && demand.score >= 7 && (
                  <View style={styles.gridDemandBadge}>
                    <Text style={{ fontSize: 7 }}>{'\u{1F525}'}</Text>
                    <Text style={styles.gridDemandText}>{demand.label}</Text>
                  </View>
                )}
                {hot && (
                  <View style={styles.gridHotBadge}>
                    <Text style={{ fontSize: 7 }}>{'\u{1F4C8}'}</Text>
                    <Text style={styles.gridHotText}>+{hot.pct}%</Text>
                  </View>
                )}
              </View>
            )}
          </View>
          {isAddingToFavorites && (
            <TouchableOpacity style={styles.favoriteButton} activeOpacity={0.8} onPress={() => toggleFavorite(item)}>
              <Icon name={isFavorite ? "heart" : "heart-outline"} size={20} color={isFavorite ? "#e74c3c" : "#666"} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        style={styles.gridItem}
        onPress={() => {
          if (isAddingToFavorites) {
            toggleFavorite(item);
          } else {
            selectItem(item);
          }
        }}
      >
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.gridItemImage}
          />
        ) : (
          <View style={[styles.gridItemImage, { backgroundColor: isDarkMode ? '#333' : '#ddd', justifyContent: 'center', alignItems: 'center' }]}>
            <Icon name="image-outline" size={30} color={isDarkMode ? '#666' : '#999'} />
          </View>
        )}
        {isAddingToFavorites && (
          <TouchableOpacity
            style={styles.favoriteButton}
            activeOpacity={0.8}
            onPress={() => {
              toggleFavorite(item);
            }}
          >
            <Icon
              name={isFavorite ? "heart" : "heart-outline"}
              size={20}
              color={isFavorite ? "#e74c3c" : "#666"}
            />
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  }, [selectItem, toggleFavorite, localState.favorites, isAddingToFavorites, localState.imgurl, isDarkMode, analyticsMaps, viewMode, selectedValueType, isFlySelected, isRideSelected, isSharkMode, factor, t]);

  // Header for My Stuff tab showing count & total value
  const renderFavoritesHeader = useCallback(() => {
    if (selectedPetType === 'MY_STUFF') {
      const myPets = localState.ownedPets || [];
      const totalValue = filteredData.reduce((sum, item) => sum + (item.cachedValue || 0) * (item._count || 1), 0);
      return (
        <View style={styles.favoritesHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingHorizontal: 4 }}>
            <Text style={styles.favoritesTitle}>{t('home.my_stuff', 'My Stuff')} ({myPets.length})</Text>
            {totalValue > 0 && (
              <Text style={{ fontSize: 13, fontWeight: '600', color: isDarkMode ? '#10B981' : '#059669' }}>
                {t('trade_journal.my_pets.total_value', 'Total')}: {Number(totalValue).toLocaleString()}
              </Text>
            )}
          </View>
        </View>
      );
    }
    return null;
  }, [selectedPetType, localState.ownedPets, filteredData, isDarkMode, t]);

  // Safe navigation — defer to next frame so iOS doesn't choke if a modal/drawer is closing
  const navigateToMyStuff = useCallback(() => {
    requestAnimationFrame(() => {
      navigation.navigate('MyStuffScreen');
    });
  }, [navigation]);

  // Footer for My Stuff tab
  const renderFavoritesFooter = useCallback(() => {
    if (selectedPetType !== 'MY_STUFF') return null;
    const hasPets = (localState.ownedPets || []).length > 0;

    return (
      <View style={{ paddingHorizontal: 16, paddingTop: hasPets ? 16 : 0, paddingBottom: 24, alignItems: 'center' }}>
        {!hasPets && (
          <View style={{ alignItems: 'center', paddingTop: 40, paddingBottom: 20 }}>
            <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: isDarkMode ? '#1E293B' : '#EFF6FF', justifyContent: 'center', alignItems: 'center', marginBottom: 14 }}>
              <Icon name="bag-handle-outline" size={34} color={isDarkMode ? '#60A5FA' : '#3B82F6'} />
            </View>
            <Text style={{ fontSize: 17, fontWeight: '700', color: isDarkMode ? '#E2E8F0' : '#1E293B', marginBottom: 6 }}>
              {t('home.no_pets_yet', 'No pets yet')}
            </Text>
            <Text style={{ fontSize: 13, color: isDarkMode ? '#64748B' : '#94A3B8', textAlign: 'center', lineHeight: 18, paddingHorizontal: 20 }}>
              {t('home.no_pets_desc', 'Add your pets in My Stuff to track their values and use them in the calculator.')}
            </Text>
          </View>
        )}
        <TouchableOpacity
          onPress={navigateToMyStuff}
          activeOpacity={0.75}
          style={{
            width: '100%',
            paddingVertical: 14,
            borderRadius: 12,
            backgroundColor: isDarkMode ? '#2563EB' : '#3B82F6',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          <Icon name={hasPets ? 'pencil-outline' : 'add-circle-outline'} size={18} color="#fff" />
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#fff' }}>
            {hasPets
              ? t('home.manage_my_stuff', 'Manage My Stuff')
              : t('home.add_pets_cta', 'Add Pets in My Stuff')}
          </Text>
          <Icon name="chevron-forward" size={16} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      </View>
    );
  }, [selectedPetType, localState.ownedPets, isDarkMode, t, navigateToMyStuff]);

  // Memoize key extractor — use _groupKey for grouped My Stuff items to avoid duplicate keys
  const keyExtractor = useCallback((item, index) =>
    item._groupKey || item.id?.toString() || `${item.name}-${item.type}-${index}`, []);


  // Optimize FlatList performance
  const getItemLayout = useCallback((data, index) => {
    // For favorites: row layout with larger height, for grid: smaller height
    const itemHeight = 100;
    return {
      length: itemHeight,
      offset: itemHeight * index,
      index,
    };
  }, [selectedPetType, isAddingToFavorites]);



  useEffect(() => {
    let isMounted = true;

    const fetchFactor = async () => {
      try {
        const database = getDatabase();
        const snapshot = await get(ref(database, 'factor'));
        const factor = snapshot.val();
        // ✅ Check if component is still mounted before updating state
        if (isMounted) {
          setFactor(factor);
        }
      } catch (error) {
        console.error('Error fetching factor:', error);
      }
    };

    fetchFactor();

    return () => {
      isMounted = false;
    };
  }, []);



  useEffect(() => {
    let isMounted = true;

    const parseAndSetData = async () => {
      try {
        const source = localState.data;

        if (!source) {
          if (isMounted) setFruitRecords([]);
          return;
        }

        const parsed = typeof source === 'string' ? JSON.parse(source) : source;

        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
          if (isMounted) {
            setFruitRecords(Object.values(parsed));
          }
        } else {
          if (isMounted) setFruitRecords([]);
        }
      } catch (err) {
        console.error("❌ Error parsing data in HomeScreen:", err);
        if (isMounted) setFruitRecords([]);
      }
    };

    parseAndSetData();

    return () => {
      isMounted = false;
    };
  }, [localState.data]); // ✅ Added dependencies so it updates when values are refreshed

  // console.log(filteredData.length)





  const handleCreateTradePress = useCallback(() => {
    // console.log(user.id);
    if (!user?.id) {
      setIsSigninDrawerVisible(true); // Open SignInDrawer if not logged in
      return;
    }

    if (isBanned) {
      const reason = banDetails?.reason || 'Access Denied';
      showErrorMessage(t("chat.access_denied", { defaultValue: 'Access Denied' }), t("chat.banned_message", { defaultValue: `You are banned: ${reason}` }));
      return;
    }

    // ✅ Store timeout ID for cleanup
    const timeoutKey = `createTrade_${Date.now()}`;
    timeoutRefs.current[timeoutKey] = setTimeout(() => {
      if (!isMountedRef.current) return;

      const hasItemsCount = hasItems.filter(Boolean).length;
      const wantsItemsCount = wantsItems.filter(Boolean).length;

      if (hasItemsCount === 0 && wantsItemsCount === 0) {
        showErrorMessage(t("home.alert.error"), t("home.alert.missing_items_error"));
        return;
      }

      setType('create');
      setRobloxUsername(user?.robloxUsername || ''); // Pre-fill from profile
      setModalVisible(true);
      // Clean up after execution
      delete timeoutRefs.current[timeoutKey];
    }, 100); // Small delay to allow React state to settle
  }, [hasItems, wantsItems, t, user?.id, isBanned, banDetails]);

  const handleCreateTrade = useCallback(async () => {
    if (isSubmitting) return;

    // ✅ Roblox username required
    if (!robloxUsername.trim()) {
      showErrorMessage(t('home.alert.error'), t('trade.roblox_required', { defaultValue: 'Please enter your Roblox username to post a trade.' }));
      return;
    }

    // ✅ Ban check — defense in depth (in case modal was opened before ban)
    if (isBanned) {
      const reason = banDetails?.reason || 'Access Denied';
      showErrorMessage(t("chat.access_denied", { defaultValue: 'Access Denied' }), t("chat.banned_message", { defaultValue: `You are banned: ${reason}` }));
      return;
    }

    setIsSubmitting(true);
    try {
      // ✅ FIRESTORE ONLY: Read rating summary from user_ratings_summary (single source of truth)
      let userRating = null;
      let ratingCount = 0;

      if (firestoreDB && user?.id) {
        const summaryDocSnap = await getDoc(doc(firestoreDB, 'user_ratings_summary', user.id));
        if (summaryDocSnap.exists()) {
          const summaryData = summaryDocSnap.data();
          userRating = summaryData.averageRating || null;
          ratingCount = summaryData.count || 0;
        } else {
          // ✅ ONE-TIME MIGRATION: If Firestore summary doesn't exist, check RTDB and migrate (legacy data only)
          // This is a temporary migration path for existing data. New ratings only use Firestore.
          const database = getDatabase();
          const avgRatingSnap = await get(ref(database, `averageRatings/${user.id}`));
          const avgRatingData = avgRatingSnap.val();

          if (avgRatingData) {
            userRating = avgRatingData.value || null;
            ratingCount = avgRatingData.count || 0;

            // ✅ ONE-TIME MIGRATION: Copy to Firestore (async, don't wait)
            if (userRating || ratingCount > 0) {
              setDoc(
                doc(firestoreDB, 'user_ratings_summary', user.id),
                {
                  averageRating: userRating || 0,
                  count: ratingCount || 0,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              ).catch(err => console.error('Error migrating rating summary to Firestore:', err));
            }
          }
        }
      }
      const now = Date.now(); // ✅ Use Date.now() for cooldown comparison
      const timestamp = serverTimestamp(); // ✅ Use serverTimestamp() for Firestore

      // ✅ Calculate hasRecentGameWin (similar to Trader.jsx)
      const hasRecentWin =
        typeof user?.lastGameWinAt === 'number' &&
        now - user.lastGameWinAt <= 24 * 60 * 60 * 1000; // last win within 24h

      const mapTradeItem = item => ({
        name: item.name || item.Name,
        type: item.type || item.Type,
        valueType: item.valueType,
        isFly: item.isFly,
        isRide: item.isRide,
        image: item.image ? item.image : '',
      });

      // ✅ Create indexed arrays for server-side search - OPTIMIZED: Store only full names + words (not prefixes)
      // Prefixes are generated on search side to reduce storage costs
      const createSearchTokens = (itemName) => {
        const name = itemName.toLowerCase().trim();
        const tokens = [name]; // Full name for exact match

        // Split into words and add each word as a token (for partial word matching)
        const words = name.split(/\s+/).filter(w => w.length > 0);
        tokens.push(...words);

        // ✅ OPTIMIZED: Don't store prefixes here - they're generated on search side
        // This reduces storage costs significantly (from ~10-20 tokens/item to ~2-3 tokens/item)

        return [...new Set(tokens)]; // Remove duplicates
      };

      const hasItemNames = hasItems
        .filter(item => item && (item.name || item.Name))
        .flatMap(item => createSearchTokens(item.name || item.Name));

      const wantsItemNames = wantsItems
        .filter(item => item && (item.name || item.Name))
        .flatMap(item => createSearchTokens(item.name || item.Name));

      // ✅ Calculate trade status and convert to single letter: 'w' (win), 'l' (lose), 'f' (fair)
      const tradeStatus = getTradeStatus(hasTotal, wantsTotal);
      const statusLetter = tradeStatus === 'win' ? 'w' : tradeStatus === 'lose' ? 'l' : 'f';

      // ✅ Get cosmetics for embedding
      const { getMyCosmetics } = require('../Helper/cosmeticsCache');
      const myCosmetics = getMyCosmetics();

      const newTrade = {
        userId: user?.id || "Anonymous",
        traderName: user?.displayName || "Anonymous",
        isFeatured: false,
        hasItems: hasItems.filter(item => item && (item.name || item.Name)).map(mapTradeItem),
        wantsItems: wantsItems.filter(item => item && (item.name || item.Name)).map(mapTradeItem),
        hasItemNames, // ✅ Indexed array for server-side search (lowercase)
        wantsItemNames, // ✅ Indexed array for server-side search (lowercase)
        hasTotal,
        wantsTotal,
        description: description || "",
        timestamp: timestamp,
        status: statusLetter,
        rating: userRating,
        ratingCount,
        isSharkMode: isSharkMode,
        // ✅ Only include truthy profile fields (saves storage)
        ...(user?.avatar ? { avatar: user.avatar } : {}),
        ...(localState.isPro ? { isPro: true } : {}),
        ...(user.flage ? { flage: user.flage } : {}),
        robloxUsername: robloxUsername.trim(),
        ...(user?.robloxUsernameVerified ? { robloxUsernameVerified: true } : {}),
        ...(hasRecentWin ? { hasRecentGameWin: true } : {}),
        ...(user?.topBadge ? { topBadge: user.topBadge } : {}),
        ...(user?.isAdmin ? { isAdmin: true } : {}),
        ...(user?.isModerator ? { isModerator: true } : {}),
        ...(user?.isTrusted ? { isTrusted: true } : {}),
        ...(user?.isCMSR ? { isCMSR: true } : {}),
        ...(user?.isBabyMod ? { isBabyMod: true } : {}),
        ...(myCosmetics?.profileFrame ? { profileFrame: myCosmetics.profileFrame } : {}),
        ...(myCosmetics?.chatTextColor?.color ? { chatTextColor: myCosmetics.chatTextColor.color } : {}),
        ...(myCosmetics?.tradeCardBg ? { tradeCardBg: myCosmetics.tradeCardBg } : {}),
      };

      // ✅ 2-minute cooldown check (using Date.now() for accurate comparison)
      const COOLDOWN_MS = 120000; // 2 minutes
      if (lastTradeTime && (now - lastTradeTime) < COOLDOWN_MS) {
        const secondsLeft = Math.ceil((COOLDOWN_MS - (now - lastTradeTime)) / 1000);
        const minutesLeft = Math.floor(secondsLeft / 60);
        const remainingSeconds = secondsLeft % 60;
        const timeMessage = minutesLeft > 0
          ? `${minutesLeft} minute${minutesLeft === 1 ? '' : 's'} and ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`
          : `${secondsLeft} second${secondsLeft === 1 ? '' : 's'}`;
        if (!isMountedRef.current) return;
        showErrorMessage(t("home.alert.error"), `Please wait ${timeMessage} before creating a new trade.`);
        setIsSubmitting(false);
        return;
      }


      const tradeRef = await addDoc(tradesCollection, newTrade);

      // ✅ Track activity for followers' feed
      try {
        await addDoc(collection(firestoreDB, 'user_activity'), {
          userId: user.id,
          type: 'trade_post',
          referenceId: tradeRef.id,
          displayName: user?.displayName || 'Unknown',
          avatar: user?.avatar || null,
          preview: description ? description.substring(0, 100) : 'Posted a new trade',
          createdAt: serverTimestamp(),
        });
      } catch (activityError) {
        console.warn('Failed to track activity:', activityError);
        // Don't fail the trade creation if activity tracking fails
      }

      // ✅ Check if component is still mounted before updating state
      if (!isMountedRef.current) return;

      // 🏅 Track trade count & award badges (firstTrade→starTrader→diamondTrader)
      incrementAndCheckBadge(appdatabase, user.id, 'tradeCount', TRADE_BADGE_THRESHOLDS)
        .then(() => {
          // Refresh topBadge in local state after badge award
          const { ref, get } = require('@react-native-firebase/database');
          get(ref(appdatabase, `users/${user.id}/topBadge`)).then(snap => {
            const newTop = snap.exists() ? snap.val() : null;
            if (newTop && newTop !== user.topBadge) {
              setUser(prev => ({ ...prev, topBadge: newTop }));
            }
          }).catch(() => { });
        });

      // 🦉 Check if trade was made after midnight (nightOwl badge)
      checkNightOwlTrade(appdatabase, user.id);

      // Step 1: Close modal first
      setModalVisible(false);

      // Step 2: Reset calculator (both sides) after successful trade creation
      resetState();
      setDescription(''); // ✅ Clear description input

      // ✅ Save Roblox username to user profile if new/changed
      if (robloxUsername.trim() && robloxUsername.trim() !== user?.robloxUsername) {
        try {
          update(ref(appdatabase, `users/${user.id}`), { robloxUsername: robloxUsername.trim() });
        } catch (e) {
          console.warn('[HomeScreen] Failed to save roblox username:', e?.message);
        }
      }

      // Step 3: Show success message immediately
      showSuccessMessage(t("home.alert.success"), "Your trade has been posted successfully!");

      // Step 4: Update timestamp and analytics
      if (isMountedRef.current) {
        setLastTradeTime(now); // ✅ Use Date.now() for cooldown tracking
      }
      mixpanel.track("Trade Created", { user: user?.id });

      // ✅ Store timeout and animation frame IDs for cleanup
      const rafKey1 = `createTrade_raf_${Date.now()}_1`;
      const timeoutKey1 = `createTrade_timeout_${Date.now()}_1`;
      const rafKey2 = `createTrade_raf_${Date.now()}_2`;
      const timeoutKey2 = `createTrade_timeout_${Date.now()}_2`;

      // Step 5: Show ad AFTER success message (non-blocking)
      rafRefs.current[rafKey1] = requestAnimationFrame(() => {
        if (!isMountedRef.current) return;

        // Wait for modal animation to finish before showing ad
        timeoutRefs.current[timeoutKey1] = setTimeout(() => {
          if (!isMountedRef.current) return;

          if (!localState.isPro) {
            rafRefs.current[rafKey2] = requestAnimationFrame(() => {
              if (!isMountedRef.current) return;

              timeoutRefs.current[timeoutKey2] = setTimeout(() => {
                if (!isMountedRef.current) return;

                try {
                  InterstitialAdManager.showAd(() => { });
                } catch (err) {
                  console.warn('[AdManager] Failed to show ad:', err);
                }
                // Clean up after execution
                delete timeoutRefs.current[timeoutKey2];
              }, 400); // Adjust based on animation time
            });
          }
          // Clean up after execution
          delete timeoutRefs.current[timeoutKey1];
        }, 500); // Give modal time to fully disappear on iOS
      });

    } catch (error) {
      console.error("Error creating trade:", error);
      if (!isMountedRef.current) return;
      showErrorMessage(t("home.alert.error"), "Something went wrong while posting the trade.");
    } finally {
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [isSubmitting, user, localState.isPro, hasItems, wantsItems, description, type, lastTradeTime, tradesCollection, t, resetState, isBanned, banDetails]);

  const handleShareTrade = useCallback(() => {
    const hasItemsCount = hasItems.filter(Boolean).length;
    const wantsItemsCount = wantsItems.filter(Boolean).length;

    if (hasItemsCount === 0 && wantsItemsCount === 0) {
      showErrorMessage(t("home.alert.error"), t("home.alert.missing_items_error"));
      return;
    }

    if (isBanned) {
      const reason = banDetails?.reason || 'Access Denied';
      showErrorMessage(t("chat.access_denied", { defaultValue: 'Access Denied' }), t("chat.banned_message", { defaultValue: `You are banned: ${reason}` }));
      return;
    }

    setIsShareModalVisible(true);
  }, [hasItems, wantsItems, t]);

  const profitLoss = wantsTotal - hasTotal;
  const isProfit = profitLoss >= 0;
  const neutral = profitLoss === 0;

  // ── Smart Trade Insights (demand + hot) ──
  const tradeInsights = useMemo(() => {
    const myItems = hasItems.filter(Boolean);
    const theirItems = wantsItems.filter(Boolean);
    const empty = { myDemand: 0, theirDemand: 0, myHotCount: 0, theirHotCount: 0, tips: [] };
    if (myItems.length === 0 && theirItems.length === 0) return empty;

    const { demandMap, hotMap } = analyticsMaps;

    const getAvgDemand = (items) => {
      const scores = items.map(i => {
        const d = demandMap[(i.name || '').toLowerCase().trim()];
        return d ? d.score : 0;
      }).filter(s => s > 0);
      return scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : 0;
    };

    const getHotCount = (items) =>
      items.filter(i => hotMap[(i.name || '').toLowerCase().trim()]).length;

    const myDemand = getAvgDemand(myItems);
    const theirDemand = getAvgDemand(theirItems);
    const myHotCount = getHotCount(myItems);
    const theirHotCount = getHotCount(theirItems);

    const tips = [];

    // High demand analysis
    const highGiving = myItems.filter(i => { const d = demandMap[(i.name || '').toLowerCase().trim()]; return d && d.score >= 8; });
    const highGetting = theirItems.filter(i => { const d = demandMap[(i.name || '').toLowerCase().trim()]; return d && d.score >= 8; });

    if (highGiving.length > 0 && highGetting.length === 0) {
      tips.push({ emoji: '😱', text: t('home.insights.giving_wanted'), color: '#EF4444' });
    } else if (highGetting.length > 0 && highGiving.length === 0) {
      tips.push({ emoji: '🤩', text: t('home.insights.getting_wanted'), color: '#10B981' });
    } else if (highGiving.length > 0 && highGetting.length > 0) {
      tips.push({ emoji: '🔄', text: t('home.insights.both_wanted'), color: '#3B82F6' });
    }

    // Rising value analysis
    if (theirHotCount > 0 && myHotCount === 0) {
      tips.push({ emoji: '🚀', text: t('home.insights.getting_rising'), color: '#10B981' });
    } else if (myHotCount > 0 && theirHotCount === 0) {
      tips.push({ emoji: '📊', text: t('home.insights.giving_rising'), color: '#F59E0B' });
    } else if (myHotCount > 0 && theirHotCount > 0) {
      tips.push({ emoji: '📈', text: t('home.insights.both_rising'), color: '#3B82F6' });
    }

    // Combined value + demand verdict
    if (tradeStatus === 'win' && myDemand >= theirDemand && myDemand > 0) {
      tips.push({ emoji: '🏆', text: t('home.insights.amazing_deal'), color: '#10B981' });
    } else if (tradeStatus === 'win' && theirDemand > myDemand) {
      tips.push({ emoji: '💡', text: t('home.insights.good_value_want_yours'), color: '#F59E0B' });
    } else if (tradeStatus === 'lose' && theirDemand > myDemand && theirDemand > 0) {
      tips.push({ emoji: '🤔', text: t('home.insights.paying_extra'), color: '#3B82F6' });
    } else if (tradeStatus === 'lose' && myDemand > theirDemand && myDemand > 0) {
      tips.push({ emoji: '😱', text: t('home.insights.giving_a_lot'), color: '#EF4444' });
    } else if (tradeStatus === 'lose' && myDemand > 0 && theirDemand > 0 && Math.abs(myDemand - theirDemand) < 0.5) {
      tips.push({ emoji: '📉', text: t('home.insights.paying_more_similar'), color: '#F59E0B' });
    } else if (tradeStatus === 'fair') {
      if (myDemand > 0 && theirDemand > 0) {
        tips.push({ emoji: '🤝', text: t('home.insights.fair_trade'), color: '#10B981' });
      }
    }

    // Fallback: always show at least one tip when both sides have items
    if (tips.length === 0 && myItems.length > 0 && theirItems.length > 0) {
      if (myDemand > 0 || theirDemand > 0) {
        const diff = myDemand - theirDemand;
        if (diff > 0.5) {
          tips.push({ emoji: '⭐', text: t('home.insights.yours_more_wanted'), color: '#F59E0B' });
        } else if (diff < -0.5) {
          tips.push({ emoji: '🌟', text: t('home.insights.theirs_more_wanted'), color: '#10B981' });
        } else {
          tips.push({ emoji: '⚖️', text: t('home.insights.equally_wanted'), color: '#3B82F6' });
        }
      }
    }

    return { myDemand, theirDemand, myHotCount, theirHotCount, tips: tips.slice(0, 3) };
  }, [hasItems, wantsItems, analyticsMaps, tradeStatus, t]);


  const styles = useMemo(() => getStyles(isDarkMode, c), [isDarkMode]);

  const lastFilledIndexHas = useMemo(() =>
    hasItems.reduce((lastIndex, item, index) => (item ? index : lastIndex), -1)
    , [hasItems]);

  const lastFilledIndexWant = useMemo(() =>
    wantsItems.reduce((lastIndex, item, index) => (item ? index : lastIndex), -1)
    , [wantsItems]);

  return (
    <>
      <GestureHandlerRootView>
        <View style={styles.container} key={language}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <ViewShot ref={viewRef} style={styles.screenshotView}>
              {config.isNoman && (
                <View style={styles.summaryContainer}>
                  <View style={styles.summaryInner}>
                    <View style={styles.topSection}>
                      {/* Left side: value + demand */}
                      <View style={{ alignItems: 'center' }}>
                        <Text style={styles.bigNumber}>{hasTotal?.toLocaleString() || '0'}</Text>
                        {tradeInsights.myDemand > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 }}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: tradeInsights.myDemand >= 7 ? '#EF4444' : tradeInsights.myDemand >= 4 ? '#F59E0B' : '#94a3b8' }}>
                              🔥{tradeInsights.myDemand}/10
                            </Text>
                            {tradeInsights.myHotCount > 0 && (
                              <Text style={{ fontSize: 9, fontWeight: '700', color: '#10B981' }}>📈{tradeInsights.myHotCount}</Text>
                            )}
                          </View>
                        )}
                      </View>

                      {/* Center: status pills */}
                      <View style={styles.statusContainer}>
                        <Text style={[
                          styles.statusText,
                          tradeStatus === 'fair' ? {
                            ...styles.statusActive,
                            backgroundColor: config.colors.secondary
                          } : styles.statusInactive
                        ]}>{t('home.fair').toUpperCase()}</Text>
                        <Text style={[
                          styles.statusText,
                          tradeStatus === 'win' ? {
                            ...styles.statusActive,
                            backgroundColor: '#10B981'
                          } : styles.statusInactive
                        ]}>{t('home.win').toUpperCase()}</Text>
                        <Text style={[
                          styles.statusText,
                          tradeStatus === 'lose' ? {
                            ...styles.statusActive,
                            backgroundColor: config.colors.primary
                          } : styles.statusInactive
                        ]}>{t('home.lose').toUpperCase()}</Text>
                      </View>

                      {/* Right side: value + demand */}
                      <View style={{ alignItems: 'center' }}>
                        <Text style={styles.bigNumber}>{wantsTotal?.toLocaleString() || '0'}</Text>
                        {tradeInsights.theirDemand > 0 && (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 }}>
                            <Text style={{ fontSize: 10, fontWeight: '800', color: tradeInsights.theirDemand >= 7 ? '#EF4444' : tradeInsights.theirDemand >= 4 ? '#F59E0B' : '#94a3b8' }}>
                              🔥{tradeInsights.theirDemand}/10
                            </Text>
                            {tradeInsights.theirHotCount > 0 && (
                              <Text style={{ fontSize: 9, fontWeight: '700', color: '#10B981' }}>📈{tradeInsights.theirHotCount}</Text>
                            )}
                          </View>
                        )}
                      </View>
                    </View>

                    <View style={styles.profitLossBox}>
                      <Text style={[styles.bigNumber2, { color: isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed }]}>
                        {Math.abs(profitLoss).toLocaleString()}
                      </Text>
                      <View style={[styles.divider, { position: 'absolute', right: 0, bottom: 0 }]}>
                        <Image
                          source={require('../../assets/reset.png')}
                          style={{ width: 18, height: 18, tintColor: 'white' }}
                          onTouchEnd={resetState}
                        />
                      </View>
                    </View>

                    {/* ── Smart Tip ── */}
                    {tradeInsights.tips.length > 0 && (() => {
                      const mainTip = tradeInsights.tips[0];
                      const extraTips = tradeInsights.tips.slice(1);
                      if (!showTips) return (
                        <TouchableOpacity onPress={() => setShowTips(true)} style={{ alignItems: 'center', marginTop: 4 }}>
                          <Text style={{ fontSize: 9, fontWeight: '600', color: isDarkMode ? '#475569' : '#94a3b8' }}>{t('home.insights.show_tips')}</Text>
                        </TouchableOpacity>
                      );
                      return (
                        <View style={{ alignItems: 'center', marginTop: 6 }}>
                          <TouchableOpacity
                            onPress={() => setShowTips(false)}
                            activeOpacity={0.7}
                            style={{
                              flexDirection: 'row', alignItems: 'center', gap: 6,
                              backgroundColor: mainTip.color + '18',
                              paddingLeft: 12, paddingRight: 8, paddingVertical: 6,
                              borderRadius: 20,
                            }}
                          >
                            <Text style={{ fontSize: 14 }}>{mainTip.emoji}</Text>
                            <Text style={{ fontSize: 11, fontWeight: '800', color: mainTip.color }}>
                              {mainTip.text}
                            </Text>
                            <Icon name="close-circle" size={14} color={mainTip.color + '60'} />
                          </TouchableOpacity>
                          {extraTips.length > 0 && (
                            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 4 }}>
                              {extraTips.map((tip, i) => (
                                <Text key={i} style={{ fontSize: 9, fontWeight: '700', color: tip.color }}>
                                  {tip.emoji} {tip.text}
                                </Text>
                              ))}
                            </View>
                          )}
                        </View>
                      );
                    })()}
                  </View>
                </View>
              )}

              <View style={styles.labelContainer}>
                <Text style={styles.offerLabel}>{t('home.labels.me')}</Text>
                <Text style={styles.dividerText}></Text>
                <Text style={styles.offerLabel}>{t('home.labels.you')}</Text>
                {/* ✅ Modern Refresh Button */}

              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={styles.itemRow}>
                  {hasItems?.map((item, index) => {
                    // For 3 columns
                    const isLastColumn = (index + 1) % 3 === 0;
                    const isLastRow = index >= hasItems.length - 3;
                    return (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.addItemBlockNew,
                          isLastColumn && { borderRightWidth: 0 },
                          isLastRow && { borderBottomWidth: 0 }
                        ]}
                        onPress={() => handleCellPress(index, true)}
                      >
                        {item ? (
                          <>
                            <Image
                              source={{ uri: getImageUrl(item, localState.imgurl) }}
                              style={[styles.itemImageOverlay]}
                            />
                            {!hideBadge.includes(item.type?.toUpperCase()) && (
                              <View style={styles.itemBadgesContainer}>
                                {item?.isFly && (
                                  <Text style={[styles.itemBadge, styles.itemBadgeFly]}>F</Text>
                                )}
                                {item?.isRide && (
                                  <Text style={[styles.itemBadge, styles.itemBadgeRide]}>R</Text>
                                )}
                                {item?.valueType && item.valueType !== 'd' && (
                                  <Text style={[
                                    styles.itemBadge,
                                    item.valueType === 'm' && styles.itemBadgeMega,
                                    item.valueType === 'n' && styles.itemBadgeNeon,
                                  ]}>{item.valueType.toUpperCase()}</Text>
                                )}
                              </View>
                            )}
                            {(() => {
                              const demand = getDemandScore(item.name, analyticsMaps.demandMap);
                              if (demand && demand.score >= 7) {
                                return (
                                  <View style={styles.calcDemandOverlay}>
                                    <View style={styles.calcDemandPill}>
                                      <Text style={styles.calcDemandPillText}>{demand.label}</Text>
                                    </View>
                                  </View>
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                              const hot = getHotStatus(item.name, analyticsMaps.hotMap);
                              if (hot) {
                                return (
                                  <View style={styles.calcHotOverlay}>
                                    <View style={styles.calcHotPill}>
                                      <Text style={styles.calcHotPillText}>+{hot.pct}%</Text>
                                    </View>
                                  </View>
                                );
                              }
                              return null;
                            })()}
                          </>
                        ) : (
                          index === lastFilledIndexHas + 1 && (
                            <Icon
                              name="add-circle"
                              size={30}
                              color={isDarkMode ? "#fdf7e5" : config.colors.primary + '80'}
                            />
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={[styles.itemRow]}>
                  {wantsItems?.map((item, index) => {
                    const isLastColumn = (index + 1) % 3 === 0;
                    const isLastRow = index >= wantsItems.length - 3;
                    return (
                      <TouchableOpacity
                        key={index}
                        style={[
                          styles.addItemBlockNew,
                          isLastColumn && { borderRightWidth: 0 },
                          isLastRow && { borderBottomWidth: 0 }
                        ]}
                        onPress={() => handleCellPress(index, false)}
                      >
                        {item ? (
                          <>
                            <Image
                              source={{ uri: getImageUrl(item, localState.imgurl) }}

                              style={[styles.itemImageOverlay]}
                            />
                            {!hideBadge.includes(item.type?.toUpperCase()) && (
                              <View style={styles.itemBadgesContainer}>
                                {item?.isFly && (
                                  <Text style={[styles.itemBadge, styles.itemBadgeFly]}>F</Text>
                                )}
                                {item?.isRide && (
                                  <Text style={[styles.itemBadge, styles.itemBadgeRide]}>R</Text>
                                )}
                                {item?.valueType && item.valueType !== 'd' && (
                                  <Text style={[
                                    styles.itemBadge,
                                    item.valueType === 'm' && styles.itemBadgeMega,
                                    item.valueType === 'n' && styles.itemBadgeNeon,
                                  ]}>{item.valueType.toUpperCase()}</Text>
                                )}
                              </View>
                            )}
                            {(() => {
                              const demand = getDemandScore(item.name, analyticsMaps.demandMap);
                              if (demand && demand.score >= 7) {
                                return (
                                  <View style={styles.calcDemandOverlay}>
                                    <View style={styles.calcDemandPill}>
                                      <Text style={styles.calcDemandPillText}>{demand.label}</Text>
                                    </View>
                                  </View>
                                );
                              }
                              return null;
                            })()}
                            {(() => {
                              const hot = getHotStatus(item.name, analyticsMaps.hotMap);
                              if (hot) {
                                return (
                                  <View style={styles.calcHotOverlay}>
                                    <View style={styles.calcHotPill}>
                                      <Text style={styles.calcHotPillText}>+{hot.pct}%</Text>
                                    </View>
                                  </View>
                                );
                              }
                              return null;
                            })()}
                          </>
                        ) : (
                          index === lastFilledIndexWant + 1 && (
                            <Icon
                              name="add-circle"
                              size={30}
                              color={isDarkMode ? "#fdf7e5" : config.colors.primary + '80'}
                            />
                          )
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
              <TouchableOpacity
                style={styles.lastUpdatedContainer}
                onPress={handleRefresh}
                disabled={refreshing}
                activeOpacity={0.7}
              >
                <View style={styles.lastUpdatedContent}>
                  {refreshing ? (
                    <ActivityIndicator size="small" color={config.colors.primary} style={{ marginRight: 6 }} />
                  ) : (
                    <Icon name="time-outline" size={14} color={isDarkMode ? '#aaa' : '#888'} style={{ marginRight: 6 }} />
                  )}
                  <Text style={[styles.lastUpdatedText, { color: isDarkMode ? '#aaa' : '#666' }]}>
                    {refreshing ? 'Updating...' : `${t('home.updated_prefix')}${getLastUpdatedText()}`}
                  </Text>
                  {!refreshing && (
                    <Icon name="refresh-outline" size={14} color={config.colors.primary} style={{ marginLeft: 6 }} />
                  )}
                </View>
              </TouchableOpacity>
              <View style={styles.typeContainer}>

                <View style={styles.typeButtonsContainer}>
                  <TouchableOpacity
                    style={[styles.typeButton, isSharkMode && styles.typeButtonActive]}
                    onPress={() => setIsSharkMode(true)}
                  >
                    <Text style={[styles.typeButtonText, isSharkMode && styles.typeButtonTextActive]}>{t('home.shark')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.typeButton, !isSharkMode && styles.typeButtonActive]}
                    onPress={() => setIsSharkMode(false)}
                  >
                    <Text style={[styles.typeButtonText, !isSharkMode && styles.typeButtonTextActive]}>{t('home.frost')}</Text>
                  </TouchableOpacity>

                </View>
                <View style={styles.recommendedContainer}>
                  <Icon
                    name="return-up-forward-outline"
                    size={20}
                    color="#666"
                    style={styles.curvedArrow}
                  />
                  <Text style={styles.recommendedText}>{t('home.recommended')}</Text>
                </View>
              </View>

              {!config.isNoman && (
                <View style={styles.summaryContainer}>
                  <View style={[styles.summaryBox, styles.hasBox]}>
                    <View style={{ width: '90%', backgroundColor: '#e0e0e0', alignSelf: 'center', }} />
                    <View style={{ justifyContent: 'space-between', flexDirection: 'row' }} >
                      <Text style={styles.priceValue}>{t('home.value')}:</Text>
                      <Text style={styles.priceValue}>${hasTotal?.toLocaleString()}</Text>
                    </View>
                  </View>
                  <View style={[styles.summaryBox, styles.wantsBox]}>
                    <View style={{ width: '90%', backgroundColor: '#e0e0e0', alignSelf: 'center', }} />
                    <View style={{ justifyContent: 'space-between', flexDirection: 'row' }} >
                      <Text style={styles.priceValue}>{t('home.value')}:</Text>
                      <Text style={styles.priceValue}>${wantsTotal?.toLocaleString()}</Text>
                    </View>
                  </View>
                </View>
              )}
            </ViewShot>
            <View style={styles.createtrade}>
              <TouchableOpacity
                style={styles.createtradeButton}
                onPress={() => handleCreateTradePress()}
              >
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 13, textAlign: 'center' }}>{t('home.create_trade')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.middleTradeButton}
                onPress={() => setShowTradeCompletion(true)}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                  <Icon name="book-outline" size={14} color="#fff" />
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 13 }}>Log Trade</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.shareTradeButton}
                onPress={handleShareTrade}
              >
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 13, textAlign: 'center' }}>{t('home.share_trade')}</Text>
              </TouchableOpacity>
            </View>

          </ScrollView>
          <Modal
            visible={isDrawerVisible}
            transparent={true}
            animationType="slide"
            onRequestClose={() => setIsDrawerVisible(false)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setIsDrawerVisible(false)} />
            <View style={styles.drawerContainer}>
              <View style={styles.drawerHeader}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search..."
                  value={searchText}
                  onChangeText={setSearchText}
                  placeholderTextColor={isDarkMode ? '#999' : '#666'}
                />
                <TouchableOpacity
                  onPress={() => setIsDrawerVisible(false)}
                  style={styles.closeButton}
                >
                  <Text style={styles.closeButtonText}>{t('home.close')}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.drawerContent}>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  style={styles.categoryListScroll}
                  contentContainerStyle={styles.categoryList}
                >
                  {CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.categoryButton,
                        selectedPetType === category && styles.categoryButtonActive
                      ]}
                      onPress={() => {
                        setSelectedPetType(category);
                        if (category !== 'MY_STUFF') {
                          setIsAddingToFavorites(false);
                        } else {
                          setIsAddingToFavorites(false);
                          // filteredData will recalculate because it depends on localState.ownedPets
                        }
                      }}
                    >
                      <Text style={[
                        styles.categoryButtonText,
                        selectedPetType === category && styles.categoryButtonTextActive
                      ]}>{getCategoryLabel(category)}</Text>
                      {category === 'STICKERS' && (
                        <View style={styles.newBadge}>
                          <Text style={styles.newBadgeText}>NEW</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={styles.gridContainer}>
                  {renderFavoritesHeader()}
                  {selectedPetType !== 'MY_STUFF' && (
                    <View style={styles.viewModeToggle}>
                      <TouchableOpacity
                        style={[styles.viewModeButton, viewMode === 'standard' && styles.viewModeButtonActive]}
                        onPress={() => setViewMode('standard')}
                      >
                        <Icon name="grid-outline" size={14} color={viewMode === 'standard' ? '#fff' : c.textSecondary} />
                        <Text style={[styles.viewModeText, viewMode === 'standard' && styles.viewModeTextActive]}>{t('home.standard', { defaultValue: 'Standard' })}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.viewModeButton, viewMode === 'detailed' && styles.viewModeButtonActive]}
                        onPress={() => setViewMode('detailed')}
                      >
                        <Icon name="list-outline" size={14} color={viewMode === 'detailed' ? '#fff' : c.textSecondary} />
                        <Text style={[styles.viewModeText, viewMode === 'detailed' && styles.viewModeTextActive]}>{t('home.detailed', { defaultValue: 'Detailed' })}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <FlatList
                    key={`${selectedPetType}-${viewMode}-${(localState.ownedPets || []).length}`}
                    data={filteredData}
                    keyExtractor={keyExtractor}
                    renderItem={selectedPetType === 'MY_STUFF' ? renderFavoriteItem : renderGridItem}
                    numColumns={selectedPetType === 'MY_STUFF' ? 1 : viewMode === 'detailed' ? 2 : 3}
                    initialNumToRender={12}
                    maxToRenderPerBatch={12}
                    windowSize={5}
                    removeClippedSubviews={false}
                    nestedScrollEnabled={true}
                    getItemLayout={selectedPetType === 'MY_STUFF' ? undefined : getItemLayout}
                  />
                  {selectedPetType === 'MY_STUFF' ? renderFavoritesFooter() : (
                    (selectedPetType === 'PETS' || selectedPetType === 'ALL') && (
                      <View style={styles.badgeContainer}>
                        {VALUE_TYPES.map((badge) => (
                          <TouchableOpacity
                            key={badge}
                            onPress={() => handleBadgePress(badge)}
                            style={[
                              styles.badgeButton,
                              selectedValueType === badge.toLowerCase() && [
                                styles.badgeButtonActive,
                                badge === 'D' && { backgroundColor: config.colors.hasBlockGreen },
                                badge === 'M' && { backgroundColor: '#9b59b6' },
                                badge === 'N' && { backgroundColor: '#2ecc71' }
                              ]
                            ]}
                          >
                            <Text style={[
                              styles.badgeButtonText,
                              selectedValueType === badge.toLowerCase() && styles.badgeButtonTextActive
                            ]}>{badge}</Text>
                          </TouchableOpacity>
                        ))}

                        {MODIFIERS.map((badge) => (
                          <TouchableOpacity
                            key={badge}
                            onPress={() => handleBadgePress(badge)}
                            style={[
                              styles.badgeButton,
                              (badge === 'F' ? isFlySelected : isRideSelected) && [
                                styles.badgeButtonActive,
                                badge === 'F' && { backgroundColor: '#3498db' },
                                badge === 'R' && { backgroundColor: config.colors.hasBlockGreen }
                              ]
                            ]}
                          >
                            <Text style={[
                              styles.badgeButtonText,
                              (badge === 'F' ? isFlySelected : isRideSelected) && styles.badgeButtonTextActive
                            ]}>{badge}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )
                  )}
                </View>
              </View>
            </View>
          </Modal>
          <Modal
            visible={modalVisible}
            transparent
            animationType="slide"
            onRequestClose={() => setModalVisible(false)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setModalVisible(false)} />
            <ConditionalKeyboardWrapper>
              <View style={{ flexDirection: 'row', flex: 1 }}>
                <View style={[styles.drawerContainer2, { backgroundColor: isDarkMode ? '#3B404C' : 'white' }]}>
                  <Text style={styles.modalMessage}>
                    {t("home.trade_description")}
                  </Text>
                  <Text style={styles.modalMessagefooter}>
                    {t("home.trade_description_hint")}
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder={t("home.write_description")}
                    maxLength={40}
                    value={description}
                    onChangeText={setDescription}
                  />
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    placeholder={t('trade.roblox_username_placeholder', { defaultValue: 'Roblox Username (required)' })}
                    maxLength={30}
                    value={robloxUsername}
                    onChangeText={setRobloxUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <View style={styles.buttonContainer}>
                    <TouchableOpacity
                      style={[styles.button, styles.cancelButton]}
                      onPress={() => setModalVisible(false)}
                    >
                      <Text style={styles.buttonText}>{t('home.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.button, styles.confirmButton]}
                      onPress={handleCreateTrade}
                      disabled={isSubmitting}
                    >
                      <Text style={styles.buttonText}>
                        {isSubmitting ? t('home.submit') : t('home.confirm')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ConditionalKeyboardWrapper>
          </Modal>

          <SignInDrawer
            visible={isSigninDrawerVisible}
            onClose={handleLoginSuccess}
            selectedTheme={selectedTheme}
            screen='Chat'
            message={t("home.alert.sign_in_required")}
          />
        </View>
        <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} track='Home' oneWallOnly={single_offer_wall} showoffer={!single_offer_wall} />
      </GestureHandlerRootView>
      {!localState.isPro && <BannerAdComponent />}
      <ShareTradeModal
        visible={isShareModalVisible}
        onClose={() => setIsShareModalVisible(false)}
        hasItems={hasItems}
        wantsItems={wantsItems}
        hasTotal={hasTotal}
        wantsTotal={wantsTotal}
        description={description}
      />
      <TradeCompletion
        visible={showTradeCompletion}
        onClose={() => setShowTradeCompletion(false)}
        db={appdatabase}
        uid={user?.id}
        isDarkMode={isDarkMode}
        hasItems={hasItems}
        wantsItems={wantsItems}
        tradeResult={tradeStatus}
        firestoreDB={firestoreDB}
      />
    </>
  );
};

const getStyles = (isDarkMode, c) => {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.bg,
      paddingBottom: 5,
    },
    summaryContainer: {
      width: '100%',

    },
    summaryInner: {
      backgroundColor: c.bgAlt,
      borderRadius: 15,
      marginBottom: 10,

      padding: 10,
      shadowColor: 'rgba(255, 255, 255, 0.9)',
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
      elevation: 2,
    },
    topSection: {
      flexDirection: 'row',
      justifyContent: 'space-evenly',
      alignItems: 'center',
      // marginBottom: 10,
      // backgroundColor:'blue'


    },
    bigNumber: {
      fontSize: 22,
      fontWeight: 'bold',
      color: '#333',
      textAlign: 'center',
      color: c.text,
      // minWidth: 100

    },
    bigNumber2: {
      fontSize: 40,
      fontWeight: 'bold',
      color: '#333',
      textAlign: 'center',
      color: c.text,

    },
    statusContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
      borderRadius: 20,
      padding: 5,
      paddingHorizontal: 8,
      // backgroundColor:'red'
    },
    statusText: {
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: 10,
    },
    statusActive: {
      color: c.textInverse,
      backgroundColor: config.colors.hasBlockGreen,
      borderRadius: 20,
    },
    statusInactive: {
      color: c.textMuted,
    },
    progressContainer: {
      marginVertical: 5,

    },
    progressBar: {
      height: 6,
      flexDirection: 'row',
      borderRadius: 3,
      overflow: 'hidden',
      backgroundColor: '#f0f0f0',
    },
    progressLeft: {
      height: '100%',
      backgroundColor: config.colors.hasBlockGreen,
      transition: 'width 0.3s ease',
    },
    progressRight: {
      height: '100%',
      backgroundColor: '#f3d0c7',
      transition: 'width 0.3s ease',
    },
    labelContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-evenly',
      // marginTop: 5,
      flex: 1,
      width: '100%',
      position: 'relative',
      // backgroundColor:'red',

    },
    offerLabel: {
      fontSize: 12,
      color: c.textSecondary,
      fontWeight: 'bold',
      paddingBottom: 5,
    },
    dividerText: {
      fontSize: 14,
      color: '#999',
      paddingHorizontal: 5,
    },
    refreshButton: {
      position: 'absolute',
      left: 0,
      bottom: -2,
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lastUpdatedContainer: {
      alignSelf: 'center',
      paddingVertical: 8,
      paddingHorizontal: 16,
      marginVertical: 4,
    },
    lastUpdatedContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    lastUpdatedText: {
      fontSize: 12,

      // shadowColor: '#000',
      // shadowOffset: { width: 0, height: 2 },
      // shadowOpacity: 0.1,
      // shadowRadius: 3,
      // elevation: 3,
    },
    summaryBox: {
      width: '48%',
      padding: 5,
      borderRadius: 8,
    },
    profitLossBox: {
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      // paddingVertical: 10,
    },
    hasBox: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    wantsBox: {
      backgroundColor: config.colors.wantBlockRed,
    },
    priceValue: {
      color: 'white',
      textAlign: 'center',
      marginTop: 5,
      fontWeight: 'bold',
    },
    itemRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      width: '49%',
      alignItems: 'center',
      marginBottom: 5,
      borderWidth: 1,
      borderColor: isDarkMode ? 'rgb(255, 102, 102)' : config.colors.primary + '80',
      marginHorizontal: 'auto',
      borderRadius: 4,
      overflow: 'hidden',
    },
    addItemBlockNew: {
      width: '33.33%',
      height: 60,
      backgroundColor: c.bgAlt,
      justifyContent: 'center',
      alignItems: 'center',
      position: 'relative',
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: isDarkMode ? 'rgb(255, 102, 102)' : config.colors.primary + '80',
    },
    itemText: {
      color: c.text,
      textAlign: 'center',
      fontWeight: 'bold',
      fontSize: 12
    },
    removeButton: {
      position: 'absolute',
      top: 2,
      right: 2,
      // backgroundColor: config.colors.wantBlockRed,
      borderRadius: 50,
      opacity: .7
    },
    divider: {
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: config.colors.primary,
      margin: 'auto',
      borderRadius: 12,
      padding: 5,
    },
    drawerContainer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: c.bgElevated,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      height: '80%',
      paddingTop: 16,
      paddingHorizontal: 16,
    },
    drawerContainer2: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: c.bgElevated,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      // height: '80%',
      paddingTop: 16,
      paddingHorizontal: 16,
    },
    drawerHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    drawerContent: {
      flex: 1,
      flexDirection: 'row',
    },
    categoryListScroll: {
      maxWidth: '25%',
      width: '25%',
      paddingRight: 12,
    },
    categoryList: {
      paddingVertical: 2,
    },
    categoryButton: {
      marginVertical: 2,
      marginHorizontal: 4,
      paddingVertical: 8,
      paddingHorizontal: 6,
      backgroundColor: '#f0f0f0',
      borderRadius: 6,
      alignItems: 'center',
      minWidth: 40,
    },
    categoryButtonActive: {
      backgroundColor: '#FF9999',
    },
    categoryButtonText: {
      fontSize: 8,
      fontWeight: '600',
      color: '#666',
    },
    categoryButtonTextActive: {
      color: '#fff',
    },
    newBadge: {
      backgroundColor: '#FF3B30',
      borderRadius: 4,
      paddingHorizontal: 3,
      paddingVertical: 1,
      marginTop: 2,
    },
    newBadgeText: {
      color: '#fff',
      fontSize: 6,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    gridContainer: {
      flex: 1,
      flexShrink: 1,
      flex: 1,
      // paddingBottom: 60,
    },
    gridItem: {
      flex: 1,
      margin: 4,
      alignItems: 'center',
    },
    gridItemImage: {
      width: 60,
      height: 60,
      borderRadius: 10,
    },
    gridItemText: {
      fontSize: 11,
      marginTop: 4,
      color: c.text,
    },
    gridAnalyticsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      marginTop: 2,
    },
    gridDemandBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#FF6B0025' : '#FF6B0015',
      paddingHorizontal: 3,
      paddingVertical: 1,
      borderRadius: 3,
      gap: 1,
    },
    gridDemandText: {
      fontSize: 8,
      fontWeight: '700',
      color: isDarkMode ? '#FF8C42' : '#E65100',
    },
    gridHotBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDarkMode ? '#10B98125' : '#10B98115',
      paddingHorizontal: 3,
      paddingVertical: 1,
      borderRadius: 3,
      gap: 1,
    },
    gridHotText: {
      fontSize: 8,
      fontWeight: '700',
      color: '#10B981',
    },
    viewModeToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 4,
      gap: 6,
    },
    viewModeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: c.bgAlt,
      gap: 4,
    },
    viewModeButtonActive: {
      backgroundColor: config.colors.primary,
    },
    viewModeText: {
      fontSize: 10,
      fontWeight: '600',
      color: c.textSecondary,
    },
    viewModeTextActive: {
      color: '#fff',
    },
    detailedItem: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.bgAlt,
      borderRadius: 10,
      padding: 8,
      margin: 4,
      flex: 1,
      gap: 8,
    },
    detailedItemImage: {
      width: 44,
      height: 44,
      borderRadius: 8,
    },
    detailedItemInfo: {
      flex: 1,
    },
    detailedItemName: {
      fontSize: 11,
      fontWeight: '700',
      color: c.text,
      marginBottom: 2,
    },
    detailedItemValue: {
      fontSize: 10,
      color: c.textSecondary,
      fontWeight: '500',
    },
    calcDemandOverlay: {
      position: 'absolute',
      top: 1,
      left: 1,
    },
    calcDemandPill: {
      backgroundColor: '#FF6B00CC',
      paddingHorizontal: 2,
      paddingVertical: 0.5,
      borderRadius: 2,
    },
    calcDemandPillText: {
      fontSize: 6,
      fontWeight: '800',
      color: 'white',
    },
    calcHotOverlay: {
      position: 'absolute',
      top: 1,
      right: 1,
    },
    calcHotPill: {
      backgroundColor: '#10B981CC',
      paddingHorizontal: 2,
      paddingVertical: 0.5,
      borderRadius: 2,
    },
    calcHotPillText: {
      fontSize: 6,
      fontWeight: '800',
      color: 'white',
    },
    badgeContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: c.border,
      // marginTop: 8,
    },
    badge: {
      color: 'white',
      padding: 0.5,
      borderRadius: 10,
      fontSize: 6,
      minWidth: 10,
      textAlign: 'center',
      overflow: 'hidden',
      fontWeight: '600',
    },
    badgeButton: {
      marginHorizontal: 4,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 16,
      backgroundColor: c.bgAlt,
    },
    badgeButtonActive: {
      backgroundColor: '#3498db',
    },
    badgeButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: c.text,
    },
    badgeButtonTextActive: {
      color: '#fff',
    },
    modalOverlay: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      flex: 1,
    },
    searchInput: {
      width: '75%',
      borderColor: '#333',
      borderWidth: 1,
      borderRadius: 5,
      height: 40,
      paddingHorizontal: 10,
      backgroundColor: '#fff',
      color: '#000',
    },
    closeButton: {
      backgroundColor: config.colors.wantBlockRed,
      padding: 10,
      borderRadius: 5,
      height: 40,

      width: '24%',
      alignItems: 'center',
      justifyContent: 'center'
    },
    closeButtonText: {
      color: 'white',
      textAlign: 'center',

      fontSize: 12
    },
    itemImageOverlay: {
      width: 40,
      height: 40,
      borderRadius: 5,
      resizeMode: 'contain',
    },
    screenshotView: {
      padding: 10,
      flex: 1,
    },


    createtrade: {
      alignSelf: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      paddingHorizontal: 16,
      gap: 1,
    },
    createtradeButton: {
      backgroundColor: config.colors.hasBlockGreen,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderTopStartRadius: 20,
      borderBottomStartRadius: 20,
    },
    middleTradeButton: {
      backgroundColor: '#10B981',
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
    },
    shareTradeButton: {
      backgroundColor: config.colors.wantBlockRed,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderTopEndRadius: 20,
      borderBottomEndRadius: 20,
    },
    modalMessage: {
      fontSize: 12,
      marginBottom: 4,
      color: c.text,

    },
    modalMessagefooter: {
      fontSize: 10,
      marginBottom: 10,
      color: c.textMuted,

    },
    input: {
      width: '100%',
      height: 40,
      borderColor: 'gray',
      borderWidth: 1,
      borderRadius: 5,
      paddingHorizontal: 10,
      marginBottom: 20,
      color: c.text,

    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      width: '100%',
      marginBottom: 10,
      paddingHorizontal: 20
    },
    button: {
      paddingVertical: 10,
      paddingHorizontal: 20,
      borderRadius: 5,
    },
    cancelButton: {
      backgroundColor: config.colors.wantBlockRed,
    },
    confirmButton: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    buttonText: {
      color: 'white',
      fontSize: 14,
      fontWeight: 'bold',
    },

    text: {
      color: "white",
      fontSize: 12,

      lineHeight: 12
    },


    typeContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 10,
      marginBottom: 20,
      position: 'relative',
    },
    recommendedContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 8,
    },
    recommendedText: {
      fontSize: 12,
      color: '#666',
      marginLeft: 4,
      fontWeight: '500',
    },
    curvedArrow: {
      transform: [{ rotate: '-90deg' }],
      marginRight: 2,
    },
    // ── Trade Insights ──
    insightsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 6,
      marginTop: 8,
      marginBottom: 4,
      paddingHorizontal: 8,
    },
    insightPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      borderWidth: 1,
    },
    insightText: {
      fontSize: 11,
      fontWeight: '700',
    },
    typeButtonsContainer: {
      flexDirection: 'row',
      backgroundColor: 'rgb(253, 229, 229)',
      borderRadius: 20,
      padding: 4,
    },
    typeButton: {
      paddingVertical: 8,
      paddingHorizontal: 20,
      borderRadius: 16,
    },
    typeButtonActive: {
      backgroundColor: 'rgb(255, 102, 102)',
    },
    typeButtonText: {
      fontSize: 14,
      color: '#666',
      fontWeight: '500',
    },
    typeButtonTextActive: {
      color: 'white',
      fontWeight: '600',
    },
    valueText: {
      fontSize: 10,
      color: c.textSecondary,
      marginTop: 2,
    },
    itemBadgesContainer: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      flexDirection: 'row',
      gap: 2,
      padding: 2,
    },
    itemBadge: {
      color: 'white',
      padding: 1,
      borderRadius: 5,
      fontSize: 6,
      minWidth: 10,
      textAlign: 'center',
      overflow: 'hidden',
      fontWeight: '600',
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
    // ✅ Favorites row layout styles - matching ValueScreen.js (compact version)
    favoriteRowItem: {
      backgroundColor: c.bgAlt,
      borderRadius: 6,
      marginHorizontal: 4,
      marginBottom: 4,
      padding: 6,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
      position: 'relative',
    },
    favoriteClickableArea: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 4,
    },
    favoriteImageContainer: {
      position: 'relative',
    },
    favoriteItemImage: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: c.cardBg,
    },
    favoriteItemInfo: {
      flex: 1,
      justifyContent: 'center',
    },
    favoriteItemName: {
      fontSize: 11,
      fontWeight: '700',
      color: c.text,
      marginBottom: 1,
      letterSpacing: -0.3,
    },
    favoriteItemValue: {
      fontSize: 9,
      color: c.textSecondary,
      marginBottom: 1,
      fontWeight: '500',
    },
    favoriteItemRarity: {
      fontSize: 8,
      color: config.colors.primary,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    favoriteBadgesContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 2,
      backgroundColor: c.bgAlt,
      borderRadius: 8,
      padding: 4,
      marginTop: 2,
    },
    favoriteBadgeButton: {
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 8,
      backgroundColor: c.bgElevated,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
      minWidth: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    favoriteBadgeButtonActive: {
      backgroundColor: config.colors.primary,
    },
    favoriteBadgeButtonText: {
      fontSize: 8,
      fontWeight: '600',
      color: c.text,
      textAlign: 'center',
    },
    favoriteBadgeButtonTextActive: {
      color: '#ffffff',
    },
    favoriteDeleteButton: {
      position: 'absolute',
      top: 4,
      right: 4,
      padding: 2,
      zIndex: 10,
    },
    favoriteButton: {
      position: 'absolute',
      top: 5,
      right: 5,
      padding: 5,
      borderRadius: 50,
    },
    emptyFavoritesContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
      marginTop: 50,
    },
    emptyFavoritesText: {
      fontSize: 16,
      color: c.text,
      marginTop: 10,
      marginBottom: 20,
    },
    addToFavoritesButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.bgAlt,
      padding: 10,
      borderRadius: 8,
      margin: 10,
      width: '100%',
    },
    addToFavoritesText: {
      marginLeft: 8,
      fontSize: 10,
      color: c.textSecondary,
    },
    favoritesHeader: {
      padding: 10,
      alignItems: 'center',
    },
    favoritesTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    createtradeAds: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },

    removeAdsButton: {
      borderRadius: 999,
      paddingVertical: 5,
      paddingHorizontal: 10,
      backgroundColor: '#fbbf24', // warm gold
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
      // minWidth:244
      marginTop: 20

    },

    removeAdsContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },

    crownWrapper: {
      width: 25,
      height: 25,
      borderRadius: 12,
      backgroundColor: '#fde68a',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 8,
    },

    removeAdsTextWrapper: {
      flexDirection: 'column',
    },

    removeAdsTitle: {
      color: '#1f2933',
      fontSize: 12,
      fontWeight: 'bold',
    },

    removeAdsSubtitle: {
      color: '#374151',
      fontSize: 10,

      opacity: 0.9,
    },

  });
};

export default HomeScreen;