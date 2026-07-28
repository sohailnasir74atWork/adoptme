import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  FlatList,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { debounce } from '../Helper/debounce';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import CodesDrawer from './Code';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { ref, update } from '@react-native-firebase/database';
import { mixpanel } from '../AppHelper/MixPenel';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import { handleBloxFruit, handleadoptme } from '../SettingScreen/settinghelper';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { isMatch } from '../Helper/searchHelper';
import { fetchAnalyticsData, getDemandScore, getHotStatus } from '../Helper/analyticsDataHelper';
import { useNavigation } from '@react-navigation/native';


const VALUE_TYPES = ['D', 'N', 'M'];
const MODIFIERS = ['F', 'R'];


// const CATEGORY_FILTERS = ['PETS', 'EGGS', 'VEHICLES', 'PET WEAR', 'OTHER'];

// Rarity color mapping for badges
const RARITY_COLORS = {
  common: '#95a5a6',
  uncommon: '#2ecc71',
  rare: '#3498db',
  'ultra-rare': '#9b59b6',
  legendary: '#f39c12',
  premium: '#e74c3c',
  event: '#e91e63',
};
const getRarityColor = (rarity) => {
  if (!rarity) return '#888';
  return RARITY_COLORS[rarity.toLowerCase()] || '#888';
};

const ItemBadge = React.memo(({ type, style, styles }) => (
  <Text style={[styles.itemBadge, style]}>{type}</Text>
));

const BadgeButton = React.memo(({ badge, isActive, onPress, styles }) => {
  let activeColor;
  if (badge === 'M') {
    activeColor = '#9b59b6'; // Purple for Mega
  } else if (badge === 'N') {
    activeColor = '#2ecc71'; // Green for Neon
  } else if (badge === 'D') {
    activeColor = '#FF6666'; // Default red
  } else if (badge === 'F') {
    activeColor = '#3498db'; // Blue for Fly
  } else if (badge === 'R') {
    activeColor = '#e74c3c'; // Red for Ride
  }

  return (
    <TouchableOpacity
      onPress={() => onPress(badge)}
      style={[
        styles.badgeButton,
        isActive && [styles.badgeButtonActive, { backgroundColor: activeColor }]
      ]}
    >
      <Text style={[styles.badgeButtonText, isActive && styles.badgeButtonTextActive]}>
        {badge}
      </Text>
    </TouchableOpacity>
  );
});

const ItemImage = React.memo(({ uri, badges, styles }) => (
  <View style={styles.imageWrapper}>
    <Image source={{ uri }} style={styles.icon} resizeMode="cover" />
    <View style={styles.itemBadgesContainer}>
      {badges}
    </View>
  </View>
));

// ✅ PERF FIX: Moved to module level (was inside ValueScreen, recreated every render)
const getImageUrl = (item, baseImgUrl) => {
  if (!item || !item.name) return '';
  if (!item.image || !baseImgUrl) return '';
  return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}/${item.image.replace(/^\//, '')}`;
};

// ✅ PERF FIX: Moved to module level so React.memo actually works.
// When defined inside the component body, React creates a new component type every render,
// which defeats React.memo entirely.
//
// Allowlist — only pets get the value-type (D/N/M) and modifier (F/R) badges.
// Was a denylist (HIDE_BADGE_TYPES) but the data has variants the list didn't
// cover (PETWEAR no-space, FOODS plural, future categories like GAME PASS), so
// non-pet items were still showing M/F/R toggles. Matches the canonical pet
// check used elsewhere (e.g. TradeShowdown, IceBreaker).
const PET_TYPES = ['PETS', 'PET'];
const isPetType = (type) => PET_TYPES.includes(String(type || '').toUpperCase());
const CATEGORIES = ['ALL', 'PETS', 'EGGS', 'VEHICLES', 'TOYS', 'PET WEAR', 'FOOD', 'STROLLERS', 'GIFTS', 'STICKERS', 'OTHER'];

const ListItem = React.memo(({ item, itemSelection, onBadgePress, getItemValue, styles, onPress, demandMap, hotMap, fromChat, fromSetting, imgurl, t }) => {
  const currentValue = getItemValue(item, itemSelection.valueType, itemSelection.isFly, itemSelection.isRide);
  const badges = [];

  // Only pets get value-type / modifier badges.
  if (isPetType(item.type)) {
    if (itemSelection.isFly) {
      badges.push(<ItemBadge key="fly" type="F" style={styles.itemBadgeFly} styles={styles} />);
    }
    if (itemSelection.isRide) {
      badges.push(<ItemBadge key="ride" type="R" style={styles.itemBadgeRide} styles={styles} />);
    }
    if (itemSelection.valueType !== 'd') {
      badges.push(
        <ItemBadge
          key="value"
          type={itemSelection.valueType.toUpperCase()}
          style={itemSelection.valueType === 'm' ? styles.itemBadgeMega : styles.itemBadgeNeon}
          styles={styles}
        />
      );
    }
  }

  return (
    <TouchableOpacity style={[styles.itemContainer]} onPress={onPress} disabled={!fromChat && !fromSetting}>
      <View style={styles.imageContainer}>
        <ItemImage
          uri={getImageUrl(item, imgurl)}
          badges={badges}
          styles={styles}
        />
        <View style={styles.itemInfo}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.value}>{t('value.label')} {Number(currentValue).toLocaleString()}</Text>
          {item.rarity && (
            <View style={[styles.rarityBadge, { backgroundColor: getRarityColor(item.rarity) + '20' }]}>
              <View style={[styles.rarityDot, { backgroundColor: getRarityColor(item.rarity) }]} />
              <Text style={[styles.rarityText, { color: getRarityColor(item.rarity) }]}>
                {t(`rarities.${item.rarity?.toUpperCase()}`, { defaultValue: item.rarity })}
              </Text>
            </View>
          )}
          <View style={styles.analyticsRow}>
            {(() => {
              const demand = getDemandScore(item.name, demandMap);
              if (demand) {
                return (
                  <View style={[styles.demandBadge, demand.score >= 8 && styles.demandBadgeHigh]}>
                    <Text style={{ fontSize: 8 }}>{'\u{1F525}'}</Text>
                    <Text style={[styles.demandText, demand.score >= 8 && styles.demandTextHigh]}>
                      {demand.label}
                    </Text>
                  </View>
                );
              }
              return null;
            })()}
            {(() => {
              const hot = getHotStatus(item.name, hotMap);
              if (hot) {
                return (
                  <View style={styles.hotBadge}>
                    <Text style={{ fontSize: 8 }}>{'\u{1F4C8}'}</Text>
                    <Text style={styles.hotText}>+{hot.pct}%</Text>
                  </View>
                );
              }
              return null;
            })()}
          </View>
        </View>
      </View>

      {isPetType(item.type) && (
        <View style={styles.badgesContainer}>
          {VALUE_TYPES.map((badge) => (
            <BadgeButton
              key={badge}
              badge={badge}
              isActive={itemSelection.valueType === badge.toLowerCase()}
              onPress={() => onBadgePress(item.id, badge)}
              styles={styles}
            />
          ))}
          {MODIFIERS.map((badge) => (
            <BadgeButton
              key={badge}
              badge={badge}
              isActive={badge === 'F' ? itemSelection.isFly : itemSelection.isRide}
              onPress={() => onBadgePress(item.id, badge)}
              styles={styles}
            />
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
});

const ValueScreen = React.memo(({ selectedTheme, fromChat, selectedFruits, setSelectedFruits, onRequestClose, fromSetting, ownedPets, setOwnedPets, wishlistPets, setWishlistPets, owned }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [selectedValueType, setSelectedValueType] = useState('d');
  const [isFlySelected, setIsFlySelected] = useState(false);
  const [isRideSelected, setIsRideSelected] = useState(false);
  const [filterDropdownVisible, setFilterDropdownVisible] = useState(false);
  const { analytics, appdatabase, isAdmin, reload, theme } = useGlobalState()
  const isDarkMode = theme === 'dark'
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const { localState, toggleAd } = useLocalState()
  const navigation = useNavigation();
  // Chat pet picker: default to the user's own inventory ("My Pets"), with a
  // toggle to the full catalog. Inventory = localState.ownedPets (kept in sync
  // from Trade Journal / My Stuff → Firestore user_profiles + MMKV via savePets).
  const [chatPetSource, setChatPetSource] = useState('mine'); // 'mine' | 'all'
  const myPets = useMemo(
    () => (Array.isArray(localState?.ownedPets) ? localState.ownedPets : []),
    [localState?.ownedPets]
  );
  const [valuesData, setValuesData] = useState([]);
  const [codesData, setCodesData] = useState([]);
  const { t } = useTranslation();
  const [filters, setFilters] = useState(['All']);
  const displayedFilter = selectedFilter === 'PREMIUM' ? t('categories.GAME PASS') : t(`categories.${selectedFilter.toUpperCase()}`, { defaultValue: selectedFilter });
  const [analyticsMaps, setAnalyticsMaps] = useState({ demandMap: {}, hotMap: {} });

  // Load analytics data for demand/hot badges
  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        const data = await fetchAnalyticsData();
        setAnalyticsMaps(data);
      } catch (e) {
        console.warn('[ValueScreen] Analytics data load failed:', e.message);
      }
    };
    loadAnalytics();
  }, []);
  const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const { triggerHapticFeedback } = useHaptic();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [itemSelections, setItemSelections] = useState({});
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [showAd1, setShowAd1] = useState(localState?.showAd1);
  const [sortOrder, setSortOrder] = useState('none'); // 'asc', 'desc', or 'none'

  // ✅ Add refs to track mounted state and debounce cleanup
  const isMountedRef = useRef(true);
  const debounceTimeoutRef = useRef(null);


  const editValuesRef = useRef({
    Value: '',
    Permanent: '',
    Biliprice: '',
    Robuxprice: '',
  });
  // ✅ Cleanup on unmount - Fixed: Use ref to track if ad was toggled to prevent infinite loop
  const hasToggledAdRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    // ✅ Only toggle ad once on mount, not on every render
    if (!hasToggledAdRef.current) {
      hasToggledAdRef.current = true;
      const newAdState = toggleAd();
      if (isMountedRef.current) {
        setShowAd1(newAdState);
      }
    }

    return () => {
      isMountedRef.current = false;
      // ✅ Cleanup debounce timeout
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
        debounceTimeoutRef.current = null;
      }
    };
  }, []); // ✅ Empty deps - only run once on mount, toggleAd is stable
  const CustomAd = () => (
    <View style={styles.adContainer}>
      <View style={styles.adContent}>
        <Image
          source={require('../../assets/icon.webp')} // Replace with your ad icon
          style={styles.adIcon}
        />
        <View>
          <Text style={styles.adTitle}>{t('value.blox_fruits_values')}</Text>
          <Text style={styles.tryNowText}>{t('value.try_other_app')}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.downloadButton} onPress={() => {
        handleBloxFruit(); triggerHapticFeedback('impactLight');
      }}>
        <Text style={styles.downloadButtonText}>{t('value.download')}</Text>
      </TouchableOpacity>
    </View>
  );

  const CustomAd2 = () => (
    <View style={styles.adContainer}>
      <View style={styles.adContent}>
        <Image
          source={require('../../assets/MM2logo.webp')}
          style={styles.adIcon}
        />
        <View>
          <Text style={styles.adTitle}>{t('value.mm2_values')}</Text>
          <Text style={styles.tryNowText}>{t('value.try_other_app')}</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.downloadButton} onPress={() => {
        handleadoptme(); triggerHapticFeedback('impactLight');
      }}>
        <Text style={styles.downloadButtonText}>{t('value.download')}</Text>
      </TouchableOpacity>
    </View>
  );


  // Memoize the parsed data to prevent unnecessary re-parsing
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

  // ✅ PERF FIX: getImageUrl moved to module level
  // Memoize the parsed codes data
  const parsedCodesData = useMemo(() => {
    if (!localState.codes) return [];
    try {
      const parsed = typeof localState.codes === 'string' ? JSON.parse(localState.codes) : localState.codes;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch (error) {
      console.error("❌ Error parsing codes:", error);
      return [];
    }
  }, [localState.codes]);

  // Memoize the filters
  const availableFilters = useMemo(() => {
    const uniqueRarities = [...new Set(parsedValuesData.map(item =>
      item?.rarity ? item.rarity.toUpperCase() : null
    ).filter(Boolean))];
    return [...CATEGORIES, ...uniqueRarities.filter(r => !CATEGORIES.includes(r))];
  }, [parsedValuesData, CATEGORIES]); // ✅ Added CATEGORIES dependency

  // Optimize the search and filter logic




  // Optimize the getItemValue function
  // NOTE: Use exact property keys from data (English), NOT translated strings - data lookup keys must match
  const getItemValue = useCallback((item, selectedValueType, isFlySelected, isRideSelected) => {
    if (!item) return 0;

    const simpleValueCategories = ['eggs', 'vehicles', 'pet wear', 'other', 'toys', 'food', 'strollers', 'gifts', 'stickers'];
    if (simpleValueCategories.includes(item.type?.toLowerCase())) {
      return parseFloat(Number((item.type?.toLowerCase() === 'eggs' ? item.rvalue : item.value) || 0).toFixed(2));
    }

    if (!selectedValueType) return 0;

    const valueKey = selectedValueType === 'n' ? 'nvalue' :
      selectedValueType === 'm' ? 'mvalue' : 'rvalue';

    const modifierSuffix = isFlySelected && isRideSelected ? ' - fly&ride' :
      isFlySelected ? ' - fly' :
        isRideSelected ? ' - ride' : ' - nopotion';

    const value = Number(item[valueKey + modifierSuffix]) || 0;
    return parseFloat(Number(value).toFixed(2));
  }, []);
  const filteredData = useMemo(() => {
    if (!Array.isArray(parsedValuesData) || parsedValuesData.length === 0) return [];

    const searchLower = searchText.toLowerCase();
    const filterUpper = selectedFilter.toUpperCase();

    let filtered = parsedValuesData.filter((item) => {
      if (!item?.name) return false;

      const matchesSearch = isMatch(item.name, searchText);
      const matchesFilter = filterUpper === 'ALL' ||
        (CATEGORIES.includes(filterUpper) ?
          item.type?.toUpperCase() === filterUpper :
          item.rarity?.toUpperCase() === filterUpper);

      return matchesSearch && matchesFilter;
    });

    // Apply sort
    if (sortOrder !== 'none') {
      filtered.sort((a, b) => {
        const aValue = parseFloat(getItemValue(a, selectedValueType, isFlySelected, isRideSelected));
        const bValue = parseFloat(getItemValue(b, selectedValueType, isFlySelected, isRideSelected));
        return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
      });
    }

    return filtered;
  }, [parsedValuesData, searchText, selectedFilter, sortOrder, selectedValueType, isFlySelected, isRideSelected, getItemValue, CATEGORIES]); // ✅ Added getItemValue and CATEGORIES dependencies

  // Catalog lookup so "My Pets" can re-price each owned pet at the CURRENT value
  // using its saved variant (D/N/M + F/R), instead of the possibly-stale stored value.
  const catalogIndex = useMemo(() => {
    const byId = {}, byName = {};
    (parsedValuesData || []).forEach(it => {
      if (it?.id != null) byId[it.id] = it;
      const k = String(it?.name ?? '').toLowerCase().trim();
      if (k && !byName[k]) byName[k] = it;
    });
    return { byId, byName };
  }, [parsedValuesData]);

  // Chat "My Pets" mode data: the user's own inventory, each entry keeping its
  // saved variant badges and re-priced to the current catalog value. Tapping a
  // row sends THAT exact variant (so the message carries M/F/R + correct value).
  const myPetsView = useMemo(() => {
    if (!(fromChat && chatPetSource === 'mine')) return [];
    const q = searchText.trim().toLowerCase();
    return (myPets || [])
      .map((p, i) => {
        const cat = (p?.id != null && catalogIndex.byId[p.id]) ||
          catalogIndex.byName[String(p?.name ?? '').toLowerCase().trim()];
        const vt = String(p?.valueType || 'd').toLowerCase();
        const value = cat
          ? Number(getItemValue(cat, vt, !!p.isFly, !!p.isRide))
          : Number(p?.value || 0);
        return { ...p, valueType: vt, value, _idx: i };
      })
      .filter(p => !q || String(p?.name || '').toLowerCase().includes(q));
  }, [fromChat, chatPetSource, myPets, searchText, catalogIndex, getItemValue]);


  // Optimize the handleItemBadgePress function
  const handleItemBadgePress = useCallback((itemId, badge) => {
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

  // 👇 Add these inside ValueScreen, after your other hooks/useState
  const selectedList = useMemo(() => {
    if (fromChat) {
      return selectedFruits || [];
    }
    if (fromSetting) {
      return owned ? (ownedPets || []) : (wishlistPets || []);
    }
    return [];
  }, [fromChat, fromSetting, owned, selectedFruits, ownedPets, wishlistPets]);

  const handleRemoveSelected = useCallback(
    (index) => {
      if (fromChat) {
        setSelectedFruits?.((prev = []) => prev.filter((_, i) => i !== index));
      } else if (fromSetting) {
        if (owned) {
          setOwnedPets?.((prev = []) => prev.filter((_, i) => i !== index));
        } else {
          setWishlistPets?.((prev = []) => prev.filter((_, i) => i !== index));
        }
      }
    },
    [fromChat, fromSetting, owned, setSelectedFruits, setOwnedPets, setWishlistPets]
  );


  // Optimize the renderItem function
  const renderItem = useCallback(
    ({ item }) => {
      // current selection for this item
      const itemSelection =
        itemSelections[item.id] || { valueType: 'd', isFly: false, isRide: false };

      // value based on current badges
      const currentValue = getItemValue(
        item,
        itemSelection.valueType,
        itemSelection.isFly,
        itemSelection.isRide
      );

      // image url for this item
      const imageUrl = getImageUrl(
        item,
        localState.imgurl,
      );

      const handlePress = () => {
        if (!isMountedRef.current) return;

        const fruitObj = {
          Name: item.Name ?? item.name,
          name: item.name,
          value: Number(currentValue),
          valueType: itemSelection.valueType,
          isFly: itemSelection.isFly,
          isRide: itemSelection.isRide,
          imageUrl,
          category: item.type,
          id: item.id,
        };

        // 👉 From chat: always add another copy
        if (fromChat && setSelectedFruits) {
          setSelectedFruits(prev => [...(prev || []), fruitObj]);
        }

        // 👉 From settings: always add another copy
        if (fromSetting) {
          if (owned && setOwnedPets) {
            setOwnedPets(prev => [...(prev || []), fruitObj]);
          } else if (setWishlistPets) {
            setWishlistPets(prev => [...(prev || []), fruitObj]);
          }
        }
      };

      // const isSelected = selectedFruits ? selectedFruits?.some(f => f.id === item.id): owned ? ownedPets?.some(f => f.id === item.id) : wishlistPets?.some(f => f.id === item.id) ;


      return (
        <ListItem
          item={item}
          itemSelection={itemSelection}
          onBadgePress={handleItemBadgePress}
          getItemValue={getItemValue}
          styles={styles}
          onPress={handlePress}
          demandMap={analyticsMaps.demandMap}
          hotMap={analyticsMaps.hotMap}
          fromChat={fromChat}
          fromSetting={fromSetting}
          imgurl={localState.imgurl}
          t={t}
        />
      );
    },
    [
      itemSelections,
      handleItemBadgePress,
      getItemValue,
      styles,
      setWishlistPets,
      analyticsMaps,
      fromChat,
      fromSetting,
      localState.imgurl,
      t
    ]
  );

  // Renders one owned pet in chat "My Pets" mode. No interactive badge buttons —
  // the variant is fixed to what the user owns; tapping sends that exact pet so
  // the message carries its M/F/R + neon/mega badges and matching value.
  const renderOwnedItem = useCallback(
    ({ item }) => {
      const vt = String(item?.valueType || 'd').toLowerCase();
      const badges = [];
      if (item?.isFly) badges.push(<ItemBadge key="fly" type="F" style={styles.itemBadgeFly} styles={styles} />);
      if (item?.isRide) badges.push(<ItemBadge key="ride" type="R" style={styles.itemBadgeRide} styles={styles} />);
      if (vt !== 'd') {
        badges.push(
          <ItemBadge
            key="value"
            type={vt.toUpperCase()}
            style={vt === 'm' ? styles.itemBadgeMega : styles.itemBadgeNeon}
            styles={styles}
          />
        );
      }

      const imageUrl = item.imageUrl || getImageUrl(item, localState.imgurl);

      const handlePress = () => {
        if (!isMountedRef.current || !setSelectedFruits) return;
        triggerHapticFeedback('impactLight');
        setSelectedFruits(prev => [...(prev || []), {
          Name: item.Name ?? item.name,
          name: item.name,
          value: Number(item.value) || 0,
          valueType: vt,
          isFly: !!item.isFly,
          isRide: !!item.isRide,
          imageUrl,
          category: item.category,
          id: item.id,
        }]);
      };

      return (
        <TouchableOpacity style={[styles.itemContainer]} onPress={handlePress}>
          <View style={styles.imageContainer}>
            <ItemImage uri={imageUrl} badges={badges} styles={styles} />
            <View style={styles.itemInfo}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.value}>{t('value.label')} {Number(item.value || 0).toLocaleString()}</Text>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [styles, setSelectedFruits, triggerHapticFeedback, localState.imgurl, t]
  );


  // Update the useEffect for values data
  useEffect(() => {
    if (!isMountedRef.current) return;
    setValuesData(parsedValuesData);
    setFilters(availableFilters);
  }, [parsedValuesData, availableFilters]);

  // Update the useEffect for codes data
  useEffect(() => {
    if (!isMountedRef.current) return;
    setCodesData(parsedCodesData);
  }, [parsedCodesData]);

  const handleRefresh = useCallback(async () => {
    if (!isMountedRef.current) return;

    setRefreshing(true);

    try {
      await reload(); // Re-fetch stock data
      if (!isMountedRef.current) return;
      // ✅ Show success message when values are reloaded
      showSuccessMessage(t('chat.success'), t('value.values_reloaded'));
    } catch (error) {
      console.error('Error refreshing data:', error);
      if (!isMountedRef.current) return;
      showErrorMessage(t('chat.error'), t('value.failed_reload'));
    } finally {
      if (isMountedRef.current) {
        setRefreshing(false);
      }
    }
  }, [reload]);

  const toggleDrawer = useCallback(() => {
    if (!isMountedRef.current) return;

    triggerHapticFeedback('impactLight');
    const callbackfunction = () => {
      if (!isMountedRef.current) return;
      setHasAdBeenShown(true); // Mark the ad as shown
      setIsDrawerVisible(prev => !prev);
    };

    if (!hasAdBeenShown && !localState.isPro) {
      InterstitialAdManager.showAd(callbackfunction);
    }
    else {
      if (isMountedRef.current) {
        setIsDrawerVisible(prev => !prev);
      }
    }
    mixpanel.track("Code Drawer Open");
  }, [triggerHapticFeedback, hasAdBeenShown, localState.isPro]); // ✅ Removed isDrawerVisible - using functional update


  const applyFilter = (filter) => {
    setSelectedFilter(filter);
  };

  // ✅ Memoize debounced search with cleanup
  const handleSearchChange = useCallback((text) => {
    // Clear existing timeout
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // Set new timeout
    debounceTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setSearchText(text);
      }
      debounceTimeoutRef.current = null;
    }, 300);
  }, []);
  const closeDrawer = () => {
    setFilterDropdownVisible(false);
  };



  const handleBadgePress = useCallback((badge) => {
    triggerHapticFeedback('impactLight');
    if (badge === 'F') {
      setIsFlySelected(prev => !prev);
    } else if (badge === 'R') {
      setIsRideSelected(prev => !prev);
    } else {
      setSelectedValueType(badge.toLowerCase());
    }
  }, [triggerHapticFeedback]);

  return (
    <>
      <GestureHandlerRootView>
        <View style={styles.container}>
          {(fromChat || fromSetting) && selectedList?.length > 0 && (
            <View style={styles.selectedPetsSection}>
              <View style={styles.selectedPetsHeader}>
                <Text style={styles.selectedPetsTitle}>
                  {fromChat
                    ? t('value.selected_pets')
                    : owned
                      ? t('value.owned_pets')
                      : t('value.wishlist')}
                </Text>

                <Text style={styles.selectedPetsCount}>
                  {selectedList.length}
                </Text>
              </View>

              <FlatList
                horizontal
                data={selectedList}
                keyExtractor={(item, index) => `${item.id || item.name}-${index}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectedPetsList}
                renderItem={({ item, index }) => (
                  <TouchableOpacity style={styles.selectedPetCard} onPress={() => handleRemoveSelected(index)}>
                    <Image
                      source={{ uri: item.imageUrl }}
                      style={styles.selectedPetImage}
                    />
                    <Text
                      style={styles.selectedPetName}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>

                    <View
                      style={styles.removePetButton}

                    >
                      <Icon name="close" size={8} color="#fff" />
                    </View>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
          {/* {(!fromChat && !fromSetting) && (
  showAd1 ? <CustomAd /> : <CustomAd2 />
)} */}

          <View style={styles.searchFilterContainer}>

            <TextInput
              style={styles.searchInput}
              placeholder={t('value.search')}
              placeholderTextColor="#888"
              onChangeText={handleSearchChange}
            />
            {/* Selected / owned pets strip (chat/settings only) */}


            <Menu>
              <MenuTrigger onPress={() => { }}>
                <View style={styles.filterButton}>
                  <Text style={styles.filterText}>{displayedFilter}</Text>
                  <Icon name="chevron-down-outline" size={18} color="white" />
                </View>
              </MenuTrigger>
              <MenuOptions customStyles={{ optionsContainer: styles.menuOptions }}>
                {filters.map((filter) => (
                  <MenuOption
                    key={filter}
                    onSelect={() => applyFilter(filter)}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[styles.filterOptionText, selectedFilter === filter && styles.selectedOption]}>
                        {t(`categories.${filter.toUpperCase()}`, { defaultValue: filter.toUpperCase() })}
                      </Text>
                      {filter.toUpperCase() === 'STICKERS' && (
                        <View style={styles.newBadge}>
                          <Text style={styles.newBadgeText}>NEW</Text>
                        </View>
                      )}
                    </View>
                  </MenuOption>
                ))}
              </MenuOptions>

            </Menu>
            <TouchableOpacity
              style={styles.filterButton}
              onPress={() => {
                setSortOrder(prev =>
                  prev === 'asc' ? 'desc' : prev === 'desc' ? 'none' : 'asc'
                );
              }}
            >
              <Text style={styles.filterText}>
                {sortOrder === 'asc' ? t('value.sort_high') : sortOrder === 'desc' ? t('value.sort_low') : t('value.filter')}
              </Text>
            </TouchableOpacity>
            {!fromChat && !fromSetting && (
              <TouchableOpacity
                style={styles.filterButton}
                onPress={() => {
                  triggerHapticFeedback('impactLight');
                  handleRefresh();
                }}
                disabled={refreshing}
              >
                {refreshing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon name="refresh" size={18} color="white" />
                )}
              </TouchableOpacity>
            )}
            {selectedFruits?.length > 0 && <TouchableOpacity
              style={[styles.filterButton, { backgroundColor: 'purple' }]}
              onPress={onRequestClose}
            >
              <Text style={styles.filterText}>
                {t('value.done')}
              </Text>
            </TouchableOpacity>}
          </View>

          {fromChat && (
            <View style={styles.chatSourceToggle}>
              <TouchableOpacity
                style={[styles.chatSourceBtn, chatPetSource === 'mine' && styles.chatSourceBtnActive]}
                onPress={() => { triggerHapticFeedback('impactLight'); setChatPetSource('mine'); }}
                activeOpacity={0.8}
              >
                <Text style={[styles.chatSourceText, chatPetSource === 'mine' && styles.chatSourceTextActive]}>
                  {`My Pets${myPets.length ? ` (${myPets.length})` : ''}`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chatSourceBtn, chatPetSource === 'all' && styles.chatSourceBtnActive]}
                onPress={() => { triggerHapticFeedback('impactLight'); setChatPetSource('all'); }}
                activeOpacity={0.8}
              >
                <Text style={[styles.chatSourceText, chatPetSource === 'all' && styles.chatSourceTextActive]}>
                  All
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {((fromChat && chatPetSource === 'mine') ? myPetsView : filteredData).length > 0 ? (
            <FlatList
              data={(fromChat && chatPetSource === 'mine') ? myPetsView : filteredData}
              keyExtractor={(fromChat && chatPetSource === 'mine')
                ? (item, index) => `mine-${item.id ?? item.name}-${item._idx ?? index}`
                : (item) => item.id || item.name}
              renderItem={(fromChat && chatPetSource === 'mine') ? renderOwnedItem : renderItem}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={true}
              numColumns={2}
              columnWrapperStyle={styles.columnWrapper}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              maxToRenderPerBatch={10}
              windowSize={5}
              initialNumToRender={10}
            />
          ) : (fromChat && chatPetSource === 'mine' && myPets.length === 0) ? (
            <View style={styles.emptyMyPets}>
              <Icon name="paw-outline" size={40} color={config.colors.hasBlockGreen} />
              <Text style={styles.emptyMyPetsTitle}>No pets in your inventory yet</Text>
              <Text style={styles.emptyMyPetsSub}>
                Add the pets you own so you can send them here instantly — no more searching every time.
              </Text>
              <TouchableOpacity
                style={styles.emptyMyPetsBtn}
                onPress={() => {
                  triggerHapticFeedback('impactLight');
                  onRequestClose?.();
                  navigation.navigate('MyStuffScreen');
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.emptyMyPetsBtnText}>+ Add my pets</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setChatPetSource('all')} style={{ marginTop: 12 }}>
                <Text style={styles.emptyMyPetsLink}>Browse all pets instead</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={[styles.description, { textAlign: 'center', marginTop: 20, color: 'gray' }]}>
              {t("value.no_results")}
            </Text>
          )}
        </View>
        <CodesDrawer isVisible={isDrawerVisible} toggleModal={toggleDrawer} codes={codesData} />
      </GestureHandlerRootView>
      {!localState.isPro && !fromChat && <BannerAdComponent collapsible />}
    </>
  );
});
export const getStyles = (isDarkMode) => {
  const c = getThemeColors(isDarkMode);
  return StyleSheet.create({
    // Chat pet picker: My Pets / All toggle
    chatSourceToggle: {
      flexDirection: 'row',
      backgroundColor: c.bgAlt,
      borderRadius: 10,
      padding: 3,
      marginBottom: 8,
      marginHorizontal: 2,
    },
    chatSourceBtn: {
      flex: 1,
      paddingVertical: 7,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chatSourceBtnActive: {
      backgroundColor: config.colors.hasBlockGreen,
    },
    chatSourceText: {
      fontSize: 13,
      fontWeight: '700',
      color: c.textSecondary,
    },
    chatSourceTextActive: {
      color: '#fff',
    },
    // Chat pet picker: empty-inventory prompt
    emptyMyPets: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 30,
      paddingTop: 30,
    },
    emptyMyPetsTitle: {
      fontSize: 16,
      fontWeight: '800',
      color: c.text,
      marginTop: 12,
      textAlign: 'center',
    },
    emptyMyPetsSub: {
      fontSize: 13,
      color: c.textSecondary,
      marginTop: 6,
      textAlign: 'center',
      lineHeight: 18,
    },
    emptyMyPetsBtn: {
      marginTop: 18,
      backgroundColor: config.colors.hasBlockGreen,
      paddingVertical: 11,
      paddingHorizontal: 22,
      borderRadius: 10,
    },
    emptyMyPetsBtnText: {
      color: '#fff',
      fontWeight: '800',
      fontSize: 14,
    },
    emptyMyPetsLink: {
      color: config.colors.hasBlockGreen,
      fontWeight: '700',
      fontSize: 13,
    },
  container: {
    flex: 1,
    backgroundColor: c.bg,
    // paddingTop: 16,
  },
  columnWrapper: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    // marginBottom: 4,
  },
  searchFilterContainer: {
    flexDirection: 'row',
    marginVertical: 8,
    paddingHorizontal: 8,
    gap: 4,
    alignItems: 'center',
  },
  searchInput: {
    height: 40,
    backgroundColor: c.bgAlt,
    borderRadius: 8,
    paddingHorizontal: 20,
    color: c.text,
    flex: 1,
    fontSize: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },

  itemContainer: {
    backgroundColor: c.bgAlt,
    borderRadius: 10,
    marginBottom: 8,
    padding: 10,
    width: '49%', // 2 per row with spacing
    alignSelf: 'flex-start',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  imageContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  imageWrapper: {
    position: 'relative',
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: c.cardBg,
  },
  icon: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  itemInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: c.text,
    marginBottom: 2,
    letterSpacing: -0.5,
  },
  value: {
    fontSize: 12,
    color: c.textSecondary,
    marginBottom: 2,
    fontWeight: '500',
  },
  rarityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginTop: 2,
  },
  rarityDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 3,
  },
  rarityText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  analyticsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    flexWrap: 'wrap',
  },
  demandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDarkMode ? '#FF6B0020' : '#FF6B0015',
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 4,
    gap: 2,
  },
  demandBadgeHigh: {
    backgroundColor: isDarkMode ? '#FF450030' : '#FF450020',
  },
  demandText: {
    fontSize: 9,
    fontWeight: '700',
    color: isDarkMode ? '#FF8C42' : '#E65100',
  },
  demandTextHigh: {
    color: '#FF3D00',
  },
  hotBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: isDarkMode ? '#10B98120' : '#10B98115',
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 4,
    gap: 2,
  },
  hotText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#10B981',
  },
  itemBadgesContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    flexDirection: 'row',
    gap: 1,
    padding: 1,
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
  badgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
    backgroundColor: c.bgAlt,
    // padding: 16,
    borderRadius: 16,
    marginTop: 8,
  },
  badgeButton: {
    paddingVertical: 7,
    paddingHorizontal: 15,
    borderRadius: 15,
    backgroundColor: c.bgElevated,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  badgeButtonActive: {
    backgroundColor: config.colors.primary,
  },
  badgeButtonText: {
    fontSize: 10,
    fontWeight: '600',
    color: c.text,
    textAlign: 'center',
  },
  badgeButtonTextActive: {
    color: '#ffffff',
  },
  filterText: {
    color: "white",
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,

  },
  filterOptionText: {
    fontSize: 14,
    padding: 10,
    color: c.text,
  },
  selectedOption: {
    fontWeight: '700',
    color: config.colors.primary,
  },
  menuOptions: {
    backgroundColor: c.bgAlt,
    borderRadius: 16,
    padding: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginTop: 24,
    color: c.textSecondary,
    fontWeight: '500',
  },
  modalContainer: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 10,
    width: '80%',
    alignSelf: 'center', // Centers the modal horizontally
    position: 'absolute',
    top: '50%', // Moves modal halfway down the screen
    left: '10%', // Centers horizontally considering width: '80%'
    transform: [{ translateY: -150 }], // Adjusts for perfect vertical centering
    justifyContent: 'center',
    elevation: 5, // Adds a shadow on Android
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 8,
    marginVertical: 5,
    borderRadius: 5,
  },
  saveButton: {
    backgroundColor: "#2ecc71",
    paddingVertical: 10,
    borderRadius: 5,
    marginTop: 10,
  },
  cencelButton: {
    backgroundColor: "red",
    paddingVertical: 10,
    borderRadius: 5,
    marginTop: 10,
  },
  headertext: {
    backgroundColor: 'rgb(255, 102, 102)',
    paddingVertical: 1,
    paddingHorizontal: 5,
    borderRadius: 5,
    color: 'white',
    fontSize: 10,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: "flex-start",
    marginRight: 10

  },
  pointsBox: {
    width: '49%', // Ensures even spacing
    backgroundColor: c.bgAlt, // Dark: darker contrast, Light: White
    borderRadius: 8,
    padding: 10,
  },
  rowcenter: {
    flexDirection: 'row',
    alignItems: 'center',
    fontSize: 12,
    marginTop: 5,

  },
  menuContainer: {
    alignSelf: "center",
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: config.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    // paddingHorizontal: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  filterText: {
    color: "white",
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 5,
  },
  // filterOptionText: {
  //   fontSize: 14,
  //   padding: 10,
  //   color: "#333",
  // },
  selectedOption: {
    fontWeight: 'bold',
    color: "#34C759",
  },
  badgesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  badge: {
    color: 'white',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    fontSize: 12,
    fontWeight: 'bold',
    overflow: 'hidden',
    marginRight: 4,
  },
  badgeFly: {
    backgroundColor: '#3498db',
  },
  badgeRide: {
    backgroundColor: '#e74c3c',
  },
  badgeMega: {
    backgroundColor: '#9b59b6',
  },
  badgeNeon: {
    backgroundColor: '#2ecc71',
  },
  badgeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    marginTop: 8,
  },
  badgeButton: {
    // marginHorizontal: 1,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: c.bgAlt,
  },
  badgeButtonActive: {
    backgroundColor: '#FF6666',
  },
  badgeButtonText: {
    fontSize: 10,
    fontWeight: '600',
    color: c.text,
  },
  badgeButtonTextActive: {
    color: '#fff',
  },
  itemInfo: {
    flex: 1,
  },
  imageWrapper: {
    position: 'relative',
    width: 60,
    height: 60,
  },
  icon: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  itemBadgesContainer: {
    position: 'absolute',
    bottom: -10,
    left: 2,
    flexDirection: 'row',
    gap: 2,
  },
  itemBadge: {
    color: 'white',
    backgroundColor: '#FF6666',
    padding: 2,
    borderRadius: 6,
    fontSize: 7,
    minWidth: 12,
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
  categoryBar: {
    marginBottom: 8,
    paddingVertical: 4,
    backgroundColor: c.bg,
  },
  categoryBarContent: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  categoryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: c.bgAlt,
    marginRight: 8,
  },
  categoryButtonActive: {
    backgroundColor: config.colors.primary,
  },
  categoryButtonText: {
    fontSize: 13,
    color: c.textSecondary,
    fontWeight: '600',
  },
  categoryButtonTextActive: {
    color: '#fff',
  },
  newBadge: {
    backgroundColor: '#FF3B30',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginLeft: 6,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  adContainer: {
    // backgroundColor: '#F5F5F5', // Light background color for the ad
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    marginHorizontal: 10

  },
  adContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start', // Aligns text and image in a row
  },
  adIcon: {
    width: 50,
    height: 50,
    borderRadius: 5,
    marginRight: 15,
  },
  adTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: c.textSecondary,
    // marginBottom: 5, // Adds space below the title
  },
  tryNowText: {
    fontSize: 14,

    color: '#6A5ACD', // Adds a distinct color for the "Try Now" text
    // marginTop: 5, // Adds space between the title and the "Try Now" text
  },
  downloadButton: {
    backgroundColor: '#34C759',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 5,
    marginTop: 10, // Adds spacing between the text and the button
  },
  downloadButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  selectedPetsSection: {
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  selectedPetsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  selectedPetsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: c.text,
  },
  selectedPetsCount: {
    fontSize: 11,
    fontWeight: '600',
    color: c.textSecondary,
  },
  selectedPetsList: {
    paddingVertical: 4,
  },
  selectedPetCard: {
    width: 40,
    marginRight: 8,
    borderRadius: 10,
    padding: 6,
    backgroundColor: c.bgAlt,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  selectedPetImage: {
    width: '100%',
    height: 15,
    borderRadius: 8,
    marginBottom: 1,
    backgroundColor: c.bg,
  },
  selectedPetName: {
    fontSize: 8,
    fontWeight: '500',
    color: c.text,
  },
  removePetButton: {
    position: 'absolute',
    top: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },

});
};

export default ValueScreen;
