import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, FlatList, TextInput, Image, Pressable, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import { useGlobalState } from '../GlobelStats';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { getDatabase, ref } from '@react-native-firebase/database';
import { useLocalState } from '../LocalGlobelStats';
import SignInDrawer from '../Firebase/SigninDrawer';
import firestore from '@react-native-firebase/firestore';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../Translation/LanguageProvider';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { mixpanel } from '../AppHelper/MixPenel';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import Share from 'react-native-share';
import ShareTradeModal from '../Trades/ShareTradeModal';

const INITIAL_ITEMS = [null, null, null, null, null, null, null, null, null];
const CATEGORIES = ['ALL', 'PETS', 'EGGS', 'VEHICLES', 'PET WEAR', 'OTHER', 'FAVORITES'];
const VALUE_TYPES = ['D', 'N', 'M'];
const MODIFIERS = ['F', 'R'];
const hideBadge = ['EGGS', 'VEHICLES', 'PET WEAR', 'OTHER'];

const getItemValue = (item, selectedValueType, isFlySelected, isRideSelected, isSharkMode = true) => {
  if (!item) return 0;
  
  // Categories that only use 'value' field
  const simpleValueCategories = ['eggs', 'vehicles', 'pet wear', 'other'];
  
  // Handle simple value categories
  if (simpleValueCategories.includes(item.type)) {
    const value = Number(item.type === 'eggs' ? item.rvalue : item.value) || 0;
    return Number((isSharkMode ? value : value / 131.85).toFixed(2));
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
  return Number((isSharkMode ? value : value / 131.85).toFixed(2));
};

const getTradeStatus = (hasTotal, wantsTotal) => {
  // If only has items are selected (wantsTotal is 0), show LOSE
  if (hasTotal > 0 && wantsTotal === 0) return 'lose';
  
  // If only wants items are selected (hasTotal is 0), show WIN
  if (hasTotal === 0 && wantsTotal > 0) return 'win';
  
  // If both are 0 or both have values, show FAIR
  return 'fair';
};

const HomeScreen = ({ selectedTheme }) => {
  const { theme, user } = useGlobalState();
  const tradesCollection = useMemo(() => firestore().collection('trades_new'), []);
  const [hasItems, setHasItems] = useState(INITIAL_ITEMS);
  const [fruitRecords, setFruitRecords] = useState([]);
  const [selectedPetType, setSelectedPetType] = useState('ALL');
  const [wantsItems, setWantsItems] = useState(INITIAL_ITEMS);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedSection, setSelectedSection] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [hasTotal, setHasTotal] = useState(0);
  const [wantsTotal, setWantsTotal] = useState(0);
  const { triggerHapticFeedback } = useHaptic();
  const { localState, updateLocalState } = useLocalState();
  const [modalVisible, setModalVisible] = useState(false);
  const [description, setDescription] = useState('');
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { language } = useLanguage();
  const [lastTradeTime, setLastTradeTime] = useState(null);
  const [openShareModel, setOpenShareModel] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  const [type, setType] = useState(null);
  const platform = Platform.OS.toLowerCase();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';
  const viewRef = useRef();
  const [selectedValueType, setSelectedValueType] = useState('d');
  const [isFlySelected, setIsFlySelected] = useState(false);
  const [isRideSelected, setIsRideSelected] = useState(false);
  const [isSharkMode, setIsSharkMode] = useState(true);
  const [isAddingToFavorites, setIsAddingToFavorites] = useState(false);
  const [isShareModalVisible, setIsShareModalVisible] = useState(false);

  const tradeStatus = useMemo(() => 
    getTradeStatus(hasTotal, wantsTotal)
  , [hasTotal, wantsTotal]);

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

  const resetState = useCallback(() => {
    triggerHapticFeedback('impactLight');
    setSelectedSection(null);
    setHasTotal(0);
    setWantsTotal(0);
    setHasItems(INITIAL_ITEMS);
    setWantsItems(INITIAL_ITEMS);
  }, [triggerHapticFeedback]);

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

  const selectItem = useCallback((item) => {
    if (!item) return;
    // console.log(item);
    
    triggerHapticFeedback('impactLight');
    const value = getItemValue(item, selectedValueType, isFlySelected, isRideSelected, isSharkMode);
    const selectedItem = {
      ...item,
      selectedValue: value,
      valueType: selectedValueType,
      isFly: isFlySelected,
      isRide: isRideSelected
    };
    
    const updateItems = selectedSection === 'has' ? [...hasItems] : [...wantsItems];
    const nextEmptyIndex = updateItems.indexOf(null);
    
    if (nextEmptyIndex !== -1) {
      updateItems[nextEmptyIndex] = selectedItem;
      if (selectedSection === 'has') {
        setHasItems(updateItems);
        updateTotal(selectedItem, 'has', true, true);
      } else {
        setWantsItems(updateItems);
        updateTotal(selectedItem, 'wants', true, true);
      }
    }
    setIsDrawerVisible(false);
  }, [hasItems, wantsItems, selectedSection, selectedValueType, isFlySelected, isRideSelected, isSharkMode, triggerHapticFeedback, updateTotal]);

  const handleCellPress = useCallback((index, isHas) => {
    const items = isHas ? hasItems : wantsItems;
    
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
    }
  }, [hasItems, wantsItems, triggerHapticFeedback, updateTotal]);

  // Memoize the mode change effect to prevent unnecessary recalculations
  const updateItemsForMode = useCallback((items) => {
    return items.map(item => {
      if (!item) return null;
      const value = getItemValue(item, item.valueType, item.isFly, item.isRide, isSharkMode);
      return { ...item, selectedValue: value };
    });
  }, [isSharkMode]);

  // Optimize the mode change effect
  useEffect(() => {
    const updatedHasItems = updateItemsForMode(hasItems);
    const updatedWantsItems = updateItemsForMode(wantsItems);
    
    // Batch state updates
    const updates = () => {
      setHasItems(updatedHasItems);
      setWantsItems(updatedWantsItems);
      
      const newHasTotal = updatedHasItems.reduce((sum, item) => sum + (item?.selectedValue || 0), 0);
      const newWantsTotal = updatedWantsItems.reduce((sum, item) => sum + (item?.selectedValue || 0), 0);
      setHasTotal(newHasTotal);
      setWantsTotal(newWantsTotal);
    };
    
    updates();
  }, [isSharkMode, updateItemsForMode]);
  // Add toggleFavorite function
  const toggleFavorite = useCallback((item) => {
    if (!item) return;
    
    const currentFavorites = localState.favorites || [];
    const isFavorite = currentFavorites.some(fav => fav.id === item.id);
    
    let newFavorites;
    if (isFavorite) {
      newFavorites = currentFavorites.filter(fav => fav.id !== item.id);
    } else {
      newFavorites = [...currentFavorites, item];
    }
    
    updateLocalState('favorites', newFavorites);
    triggerHapticFeedback('impactLight');
  }, [localState.favorites, updateLocalState, triggerHapticFeedback]);

  // Update filteredData to include favorites
  const filteredData = useMemo(() => {
    if (selectedPetType === 'FAVORITES') {
      // For FAVORITES tab, only show favorited items
      return (localState.favorites || [])
        .filter(item => {
          if (!item?.name || !item?.type) return false;
          const matchesSearch = item.name.toLowerCase().includes(searchText.toLowerCase());
          return matchesSearch;
        })
        .sort((a, b) => {
          const valueA = getItemValue(a, selectedValueType, isFlySelected, isRideSelected, isSharkMode);
          const valueB = getItemValue(b, selectedValueType, isFlySelected, isRideSelected, isSharkMode);
          return valueB - valueA;
        });
    } else {
      // For other tabs, show all items with type filter
      return fruitRecords
        .filter(item => {
          if (!item?.name || !item?.type) return false;
          const matchesSearch = item.name.toLowerCase().includes(searchText.toLowerCase());
          const matchesType = selectedPetType === 'ALL' || selectedPetType.toLowerCase() === item.type.toLowerCase();
          return matchesSearch && matchesType;
        })
        .sort((a, b) => {
          const valueA = getItemValue(a, selectedValueType, isFlySelected, isRideSelected, isSharkMode);
          const valueB = getItemValue(b, selectedValueType, isFlySelected, isRideSelected, isSharkMode);
          return valueB - valueA;
        });
    }
  }, [fruitRecords, searchText, selectedPetType, selectedValueType, isFlySelected, isRideSelected, isSharkMode, localState.favorites]);

  // Update renderGridItem to handle favorites mode
  const renderGridItem = useCallback(({ item }) => (
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


      <Image
     source={{ uri: `${localState?.imgurl?.replace(/"/g, "").replace(/\/$/, "")}/${item.image?.replace(/^\//, "")}` }}

      style={styles.gridItemImage}
      />
      <Text numberOfLines={1} style={styles.gridItemText}>
        {item.name}
      </Text>
      {isAddingToFavorites && (
        <TouchableOpacity 
          style={styles.favoriteButton}
          onPress={() => toggleFavorite(item)}
        >
          <Icon 
            name={(localState.favorites || []).some(fav => fav.id === item.id) ? "heart" : "heart-outline"} 
            size={20} 
            color={(localState.favorites || []).some(fav => fav.id === item.id) ? "#e74c3c" : "#666"} 
          />
        </TouchableOpacity>
      )}
      {selectedPetType === 'FAVORITES' && (
        <TouchableOpacity 
          style={styles.removeButton}
          onPress={() => toggleFavorite(item)}
        >
          <Icon 
            name="close-circle" 
            size={20} 
            color="#e74c3c" 
          />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  ), [selectItem, toggleFavorite, localState.favorites, isAddingToFavorites, selectedPetType]);

  // Update renderFavoritesHeader function
  const renderFavoritesHeader = useCallback(() => {
    if (selectedPetType === 'FAVORITES') {
      return (
        <View style={styles.favoritesHeader}>
          <Text style={styles.favoritesTitle}>Your Favorites</Text>
        </View>
      );
    }
    return null;
  }, [selectedPetType]);

  // Update renderFavoritesFooter function
  const renderFavoritesFooter = useCallback(() => {
    if (selectedPetType === 'FAVORITES') {
      return (
        <View style={styles.badgeContainer}>
          <TouchableOpacity 
            style={styles.addToFavoritesButton}
            onPress={() => {
              setIsAddingToFavorites(true);
              setSelectedPetType('ALL');
            }}
          >
            <Icon name="add-circle" size={30} color={config.colors.hasBlockGreen} />
            <Text style={styles.addToFavoritesText}>Add Items to Favorites</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return null;
  }, [selectedPetType]);

  // Memoize key extractor
  const keyExtractor = useCallback((item) => 
    item.id?.toString() || Math.random().toString()
  , []);

  // Optimize FlatList performance
  const getItemLayout = useCallback((data, index) => ({
    length: 100, // Approximate height of each item
    offset: 100 * index,
    index,
  }), []);

  useEffect(() => {
    let isMounted = true;

    const parseAndSetData = async () => {
      if (!localState.data) return;

      try {
        let parsedData = localState.data;
        if (typeof localState.data === 'string') {
          parsedData = JSON.parse(localState.data);
        }

        if (parsedData && typeof parsedData === 'object' && Object.keys(parsedData).length > 0) {
          if (isMounted) {
            setFruitRecords(Object.values(parsedData));
          }
        } else {
          if (isMounted) {
            setFruitRecords([]);
          }
        }
      } catch (error) {
        console.error("Error parsing data:", error);
        if (isMounted) {
          setFruitRecords([]);
        }
      }
    };

    parseAndSetData();
    return () => { isMounted = false; };
  }, [localState.data]);

  const handleCreateTradePress = useCallback(() => {
    if (!user?.id) {
      setIsSigninDrawerVisible(true); // Open SignInDrawer if not logged in
      return;
    }
  
    setTimeout(() => {
      const hasItemsCount = hasItems.filter(Boolean).length;
      const wantsItemsCount = wantsItems.filter(Boolean).length;
  
      if (hasItemsCount === 0 && wantsItemsCount === 0) {
        showErrorMessage(t("home.alert.error"), t("home.alert.missing_items_error"));
        return;
      }
  
      setType('create');
      setModalVisible(true);
    }, 100); // Small delay to allow React state to settle
  }, [hasItems, wantsItems, t]);
  

  const handleCreateTrade = useCallback(async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      const database = getDatabase();
      const avgRatingSnap = await ref(database, `averageRatings/${user?.id}`).once('value');
      const avgRatingData = avgRatingSnap.val();
      
      const userRating = avgRatingData?.value || null;
      const ratingCount = avgRatingData?.count || 0;

      const mapTradeItem = item => ({
        name: item.name || item.Name,
        type: item.type || item.Type,
        value: item.selectedValue,
        valueType: item.valueType,
        isFly: item.isFly,
        isRide: item.isRide,
        image: item.image,
      });

      const newTrade = {
        userId: user?.id || "Anonymous",
        traderName: user?.displayName || "Anonymous",
        avatar: user?.avatar || null,
        isPro: localState.isPro,
        isFeatured: false,
        hasItems: hasItems.filter(item => item && (item.name || item.Name)).map(mapTradeItem),
        wantsItems: wantsItems.filter(item => item && (item.name || item.Name)).map(mapTradeItem),
        hasTotal,
        wantsTotal,
        description: description || "",
        timestamp: firestore.FieldValue.serverTimestamp(),
        rating: userRating,
        ratingCount
      };
        const now = Date.now();
        if (lastTradeTime && now - lastTradeTime < 60000) {
          showErrorMessage(t("home.alert.error"), "Please wait for 1 minute before creating new trade");
          setIsSubmitting(false);
          return;
        }

        await tradesCollection.add(newTrade);
      // Step 1: Close modal first
setModalVisible(false);

// Step 2: Define the success callback
const callbackfunction = () => {
  showSuccessMessage(t("home.alert.success"), "Your trade has been posted successfully!");
};

// Step 3: Update timestamp and analytics
setLastTradeTime(now);
mixpanel.track("Trade Created", { user: user?.id });

// Step 4: Wait for next frame (modal animation finish) then delay for iOS
requestAnimationFrame(() => {
  setTimeout(() => {
    if (!localState.isPro) {
      try {
        InterstitialAdManager.showAd(callbackfunction);
      } catch (err) {
        console.warn('[AdManager] Failed to show ad:', err);
        callbackfunction(); // fallback if ad fails
      }
    } else {
      callbackfunction();
    }
  }, Platform.OS === 'ios' ? 500 : 300); // iOS needs a longer delay
});

    } catch (error) {
      console.error("Error creating trade:", error);
      showErrorMessage(t("home.alert.error"), "Something went wrong while posting the trade.");
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, user, localState.isPro, hasItems, wantsItems, description, type, lastTradeTime, tradesCollection, t]);

  const handleShareTrade = useCallback(() => {
    const hasItemsCount = hasItems.filter(Boolean).length;
    const wantsItemsCount = wantsItems.filter(Boolean).length;

    if (hasItemsCount === 0 && wantsItemsCount === 0) {
      showErrorMessage(t("home.alert.error"), t("home.alert.missing_items_error"));
      return;
    }

    setIsShareModalVisible(true);
  }, [hasItems, wantsItems, t]);

  const profitLoss = wantsTotal - hasTotal;
  const isProfit = profitLoss >= 0;
  const neutral = profitLoss === 0;


  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

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
                      <Text style={styles.bigNumber}>{hasTotal?.toLocaleString() || '0'}</Text>
                      <View style={styles.statusContainer}>
                        <Text style={[
                          styles.statusText,
                          tradeStatus === 'win' ? styles.statusActive : styles.statusInactive
                        ]}>WIN</Text>
                        <Text style={[
                          styles.statusText,
                          tradeStatus === 'fair' ? styles.statusActive : styles.statusInactive
                        ]}>FAIR</Text>
                        <Text style={[
                          styles.statusText,
                          tradeStatus === 'lose' ? styles.statusActive : styles.statusInactive
                        ]}>LOSE</Text>
                </View>
                      <Text style={styles.bigNumber}>{wantsTotal?.toLocaleString() || '0'}</Text>
                </View>
                    <View style={styles.progressContainer}>
                      <View style={styles.progressBar}>
                        <View 
                          style={[
                            styles.progressLeft,
                            { width: progressBarStyle.left }
                          ]} 
                        />
                        <View 
                          style={[
                            styles.progressRight,
                            { width: progressBarStyle.right }
                          ]} 
                        />
                      </View>
                    </View>
                    <View style={styles.labelContainer}>
                      <Text style={styles.offerLabel}>YOUR OFFER</Text>
                      <Text style={styles.dividerText}>|</Text>
                      <Text style={styles.offerLabel}>THEIR OFFER</Text>
                    </View>
                  </View>
                </View>
              )}
              <View style={styles.profitLossBox}>
                <Text style={[styles.bigNumber2, { color: isProfit ? config.colors.hasBlockGreen : config.colors.wantBlockRed }]}>
                  {Math.abs(profitLoss).toLocaleString()} 
                </Text>
                <View style={[styles.divider, {position:'absolute', right:0}]}>
                  <Image
                    source={require('../../assets/reset.png')}
                    style={{ width: 18, height: 18, tintColor: 'white' }}
                    onTouchEnd={resetState}
                  />
                </View>
              </View>

              <View style={{flexDirection:'row', justifyContent:'space-between'}}>
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
                             source={{ uri: `${localState?.imgurl?.replace(/"/g, "").replace(/\/$/, "")}/${item.image?.replace(/^\//, "")}` }}
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
                      </>
                    ) : (
                          index === lastFilledIndexHas + 1 && (
                            <Icon 
                              name="add-circle" 
                              size={30} 
                              color={isDarkMode ? "#fdf7e5" : '#fdf7e5'} 
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
                           source={{ uri: `${localState?.imgurl?.replace(/"/g, "").replace(/\/$/, "")}/${item.image?.replace(/^\//, "")}` }}
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
                      </>
                    ) : (
                          index === lastFilledIndexWant + 1 && (
                            <Icon 
                              name="add-circle" 
                              size={30} 
                              color={isDarkMode ? "#fdf7e5" : '#fdf7e5'} 
                            />
                          )
                    )}
                  </TouchableOpacity>
                    );
                  })}
              </View>
              </View>

              <View style={styles.typeContainer}>
                
                <View style={styles.typeButtonsContainer}>
                  <TouchableOpacity 
                    style={[styles.typeButton, isSharkMode && styles.typeButtonActive]}
                    onPress={() => setIsSharkMode(true)}
                  >
                    <Text style={[styles.typeButtonText, isSharkMode && styles.typeButtonTextActive]}>Shark</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.typeButton, !isSharkMode && styles.typeButtonActive]}
                    onPress={() => setIsSharkMode(false)}
                  >
                    <Text style={[styles.typeButtonText, !isSharkMode && styles.typeButtonTextActive]}>Frost</Text>
                  </TouchableOpacity>
                  
              </View>
                <View style={styles.recommendedContainer}>
                  <Icon 
                    name="return-up-forward-outline" 
                    size={20} 
                    color="#666" 
                    style={styles.curvedArrow}
                  />
                  <Text style={styles.recommendedText}>RECOMMENDED</Text>
                      </View>
              </View>

              {!config.isNoman && (
                <View style={styles.summaryContainer}>
                <View style={[styles.summaryBox, styles.hasBox]}>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', alignSelf: 'center', }} />
                  <View style={{justifyContent:'space-between', flexDirection:'row' }} >
                  <Text style={styles.priceValue}>{t('home.value')}:</Text>
                      <Text style={styles.priceValue}>${hasTotal?.toLocaleString()}</Text>
                  </View>
                </View>
                <View style={[styles.summaryBox, styles.wantsBox]}>
                  <View style={{ width: '90%', backgroundColor: '#e0e0e0', alignSelf: 'center', }} />
                  <View style={{justifyContent:'space-between', flexDirection:'row' }} >
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
                <Text style={{ color: 'white' }}>{t('home.create_trade')}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.shareTradeButton} 
                onPress={handleShareTrade}
              >
                <Text style={{ color: 'white' }}>{t('home.share_trade')}</Text>
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
                <View style={styles.categoryList}>
                  {CATEGORIES.map((category) => (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.categoryButton,
                        selectedPetType === category && styles.categoryButtonActive
                      ]}
                      onPress={() => {
                        setSelectedPetType(category);
                        if (category !== 'FAVORITES') {
                          setIsAddingToFavorites(false);
                        }
                      }}
                    >
                      <Text style={[
                        styles.categoryButtonText,
                        selectedPetType === category && styles.categoryButtonTextActive
                      ]}>{category}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.gridContainer}>
                  {renderFavoritesHeader()}
                  <FlatList
                    data={filteredData}
                    keyExtractor={keyExtractor}
                    renderItem={renderGridItem}
                    numColumns={3}
                    initialNumToRender={12}
                    maxToRenderPerBatch={12}
                    windowSize={5}
                    removeClippedSubviews={true}
                    getItemLayout={getItemLayout}
                  />
                  {selectedPetType === 'FAVORITES' ? renderFavoritesFooter() : (
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
              <View style={{flexDirection:'row', flex:1}}>
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
      </GestureHandlerRootView>
      {!localState.isPro && <BannerAdComponent/>}
      <ShareTradeModal
        visible={isShareModalVisible}
        onClose={() => setIsShareModalVisible(false)}
        hasItems={hasItems}
        wantsItems={wantsItems}
        hasTotal={hasTotal}
        wantsTotal={wantsTotal}
        description={description}
      />
    </>
  );
};

const getStyles = (isDarkMode) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
      paddingBottom: 5,
    },
    summaryContainer: {
      width: '100%',
    },
    summaryInner: {
      backgroundColor: isDarkMode ? '#5c4c49' : 'rgba(255, 255, 255, 0.9)',
      borderRadius: 15,
      
      padding: 15,
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
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
      
    },
    bigNumber: {
      fontSize: 22,
      fontWeight: 'bold',
      color: '#333',
      textAlign: 'center',
      color: isDarkMode ? 'white' : '#333',
      minWidth:100

    },
    bigNumber2: {
      fontSize: 40,
      fontWeight: 'bold',
      color: '#333',
      textAlign: 'center',
      color: isDarkMode ? 'white' : '#333',

    },
    statusContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(0, 0, 0, 0.05)',
      borderRadius: 20,
      padding: 5,

    },
    statusText: {
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: 10,
    },
    statusActive: {
      color: isDarkMode ? 'white' : '#333',
    },
    statusInactive: {
      color: isDarkMode ? '#999' : '#999',
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
      justifyContent: 'center',
      // marginTop: 5,
      
    },
    offerLabel: {
      fontSize: 10,
      color: isDarkMode ? '#999' : '#666',
      fontWeight: '600',
      paddingHorizontal: 10,
    },
    dividerText: {
      fontSize: 14,
      color: '#999',
      paddingHorizontal: 5,
    },
    summaryBox: {
      width: '48%',
      padding: 5,
      borderRadius: 8,
    },
    profitLossBox:{
justifyContent:'center',
alignItems:'center',
flexDirection:'row',
paddingVertical:10,
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
      fontFamily: 'Lato-Bold',
    },
    itemRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      width: '49%',
      alignItems: 'center',
      marginBottom: 5,
      borderWidth: 1,
      borderColor: 'rgb(255, 102, 102)',
      marginHorizontal: 'auto',
      borderRadius: 4,
      overflow: 'hidden',
    },
    addItemBlockNew: {
      width: '33.33%',
      height: 60,
      backgroundColor: isDarkMode ? '#5c4c49' : '#f3d0c7',
      justifyContent: 'center',
      alignItems: 'center',
      position: 'relative',
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: 'rgb(255, 102, 102)',
    },
    itemText: {
      color: isDarkMode ? 'white' : 'black',
      textAlign: 'center',
      fontFamily: 'Lato-Bold',
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
      backgroundColor: isDarkMode ? '#3B404C' : 'white',
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
      backgroundColor: isDarkMode ? '#3B404C' : 'white',
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
    categoryList: {
      width: '30%',
      paddingRight: 12,
    },
    categoryButton: {
      marginVertical: 4,
      paddingVertical: 12,
      paddingHorizontal: 8,
      backgroundColor: '#f0f0f0',
      borderRadius: 12,
      alignItems: 'center',
    },
    categoryButtonActive: {
      backgroundColor: '#FF9999',
    },
    categoryButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: '#666',
    },
    categoryButtonTextActive: {
      color: '#fff',
    },
    gridContainer: {
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
      color: isDarkMode ? '#fff' : '#333',
    },
    badgeContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? '#4A4A4A' : '#E0E0E0',
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
      backgroundColor: isDarkMode ? '#2A2A2A' : '#f0f0f0',
    },
    badgeButtonActive: {
      backgroundColor: '#3498db',
    },
    badgeButtonText: {
      fontSize: 12,
      fontWeight: '600',
      color: isDarkMode ? '#fff' : '#666',
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
      fontFamily: 'Lato-Regular',
      fontSize: 12
    },
    flatListContainer: {
      justifyContent: 'space-between',
      paddingBottom: 20
    },
    columnWrapper: {
      flex: 1,
      justifyContent: 'space-around',
    },
    itemImageOverlay: {
      width: 40,
      height: 40,
      borderRadius: 5,
    },
    screenshotView: {
      padding: 10,
      flex: 1,
    },
    float: {
      position: 'absolute',
      right: 5,
      bottom: 5,
      zIndex: 1,
    },
    titleText: {
      fontFamily: 'Lato-Regular',
      fontSize: 10
    },
    loaderContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    loaderText: {
      fontSize: 16,
      fontFamily: 'Lato-Bold',
    },
    noDataContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#f9f9f9',
    },
    noDataText: {
      fontSize: 16,
      color: 'gray',
      fontFamily: 'Lato-Bold',
    },
    createtrade: {
      alignSelf: 'center',
      justifyContent: 'center',
      flexDirection: 'row'
    },
    createtradeButton: {
      backgroundColor: config.colors.hasBlockGreen,
      alignSelf: 'center',
      padding: 10,
      justifyContent: 'center',
      flexDirection: 'row',
      minWidth: 120,
      borderTopStartRadius: 20,
      borderBottomStartRadius: 20,
      marginRight: 1
    },
    shareTradeButton: {
      backgroundColor: config.colors.wantBlockRed,
      alignSelf: 'center',
      padding: 10,
      flexDirection: 'row',
      justifyContent: 'center',
      minWidth: 120,
      borderTopEndRadius: 20,
      borderBottomEndRadius: 20,
      marginLeft: 1
    },
    modalMessage: {
      fontSize: 12,
      marginBottom: 4,
      color: isDarkMode ? 'white' : 'black',
      fontFamily: 'Lato-Regular'
    },
    modalMessagefooter: {
      fontSize: 10,
      marginBottom: 10,
      color: isDarkMode ? 'grey' : 'grey',
      fontFamily: 'Lato-Regular'
    },
    input: {
      width: '100%',
      height: 40,
      borderColor: 'gray',
      borderWidth: 1,
      borderRadius: 5,
      paddingHorizontal: 10,
      marginBottom: 20,
      color: isDarkMode ? 'white' : 'black',
      fontFamily: 'Lato-Ragular'
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
      fontFamily: 'Lato-Bold',
    },
    notification: {
      justifyContent: "space-between",
      padding: 12,
      paddingTop: 20,
      backgroundColor: config.colors.secondary,
      marginHorizontal: 10,
      marginTop: 10,
      borderRadius: 8
    },
    text: {
      color: "white",
      fontSize: 12,
      fontFamily: "Lato-Regular",
      lineHeight: 12
    },
    closeButtonNotification: {
      marginLeft: 10,
      padding: 5,
      position: 'absolute',
      top: 0,
      right: 0
    },
    itemBlock: {
      width: '11.11%',
      height: 110,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginBottom: 10,
      position: 'relative',
      ...(!config.isNoman && {
        borderColor: config.colors.hasBlockGreen,
      }),
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
      color: isDarkMode ? '#aaa' : '#666',
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
      color: isDarkMode ? '#fff' : '#666',
      marginTop: 10,
      marginBottom: 20,
    },
    addToFavoritesButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDarkMode ? '#2A2A2A' : '#f0f0f0',
      padding: 15,
      borderRadius: 8,
      margin: 10,
      width: '100%',
    },
    addToFavoritesText: {
      marginLeft: 8,
      fontSize: 14,
      color: isDarkMode ? '#fff' : '#666',
    },
    favoritesHeader: {
      padding: 10,
      alignItems: 'center',
    },
    favoritesTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: isDarkMode ? '#fff' : '#333',
    },
  });

export default HomeScreen;