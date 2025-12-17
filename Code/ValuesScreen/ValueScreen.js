import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Image,
  FlatList,
  Pressable,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { debounce } from '../Helper/debounce';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import config from '../Helper/Environment';
import { useGlobalState } from '../GlobelStats';
import CodesDrawer from './Code';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../AppHelper/MixPenel';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';
import { handleBloxFruit, handleadoptme } from '../SettingScreen/settinghelper';

const VALUE_TYPES = ['D', 'N', 'M'];
const MODIFIERS = ['F', 'R'];

// ✅ Move getImageUrl OUTSIDE component
const getImageUrl = (item, isGG, baseImgUrl, baseImgUrlGG) => {
  if (!item || !item.name) return '';
  if (isGG) {
    const encoded = encodeURIComponent(item.name);
    return `${baseImgUrlGG?.replace(/"/g, '')}/items/${encoded}.webp`;
  }
  if (!item.image || !baseImgUrl) return '';
  return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}/${item.image.replace(/^\//, '')}`;
};

// ✅ Move getItemValue OUTSIDE component  
const getItemValue = (item, selectedValueType, isFlySelected, isRideSelected) => {
  if (!item) return 0;
  const simpleValueCategories = ['eggs', 'vehicles', 'pet wear', 'other', 'toys', 'food', 'strollers', 'gifts'];
  if (simpleValueCategories.includes(item.type)) {
    return Number((item.type === 'eggs' ? item.rvalue : item.value) || 0).toFixed(2);
  }
  if (!selectedValueType) return 0;
  const valueKey = selectedValueType === 'n' ? 'nvalue' : selectedValueType === 'm' ? 'mvalue' : 'rvalue';
  const modifierSuffix = isFlySelected && isRideSelected ? ' - fly&ride' :
    isFlySelected ? ' - fly' : isRideSelected ? ' - ride' : ' - nopotion';
  return Number((item[valueKey + modifierSuffix] || 0)).toFixed(2);
};

// ✅ Simple badge component
const ItemBadge = React.memo(({ type, style, styles }) => (
  <Text style={[styles.itemBadge, style]}>{type}</Text>
));

// ✅ Badge button - use Pressable for better Android performance
const BadgeButton = React.memo(({ badge, isActive, onPress, styles }) => {
  const activeColor = badge === 'M' ? '#9b59b6' : badge === 'N' ? '#2ecc71' : 
    badge === 'D' ? '#FF6666' : badge === 'F' ? '#3498db' : '#e74c3c';

  return (
    <Pressable
      onPress={() => onPress(badge)}
      style={[
        styles.badgeButton,
        isActive && [styles.badgeButtonActive, { backgroundColor: activeColor }]
      ]}
      android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: false }}
    >
      <Text style={[styles.badgeButtonText, isActive && styles.badgeButtonTextActive]}>
        {badge}
      </Text>
    </Pressable>
  );
});

// ✅ Simplified image component
const ItemImage = React.memo(({ uri, badges, styles }) => (
  <View style={styles.imageWrapper}>
    <Image source={{ uri }} style={styles.icon} resizeMode="cover" />
    <View style={styles.itemBadgesContainer}>{badges}</View>
  </View>
));

// ✅ CRITICAL: Move ListItem OUTSIDE ValueScreen
const ListItem = React.memo(({ 
  item, 
  itemSelection, 
  onBadgePress, 
  styles, 
  onPress, 
  isSelectable,
  imageUrl,
  currentValue,
  hideBadge 
}) => {
  const badges = useMemo(() => {
    if (hideBadge.includes(item.type?.toUpperCase())) return [];
    const b = [];
    if (itemSelection.isFly) b.push(<ItemBadge key="fly" type="F" style={styles.itemBadgeFly} styles={styles} />);
    if (itemSelection.isRide) b.push(<ItemBadge key="ride" type="R" style={styles.itemBadgeRide} styles={styles} />);
    if (itemSelection.valueType !== 'd') {
      b.push(<ItemBadge key="value" type={itemSelection.valueType.toUpperCase()} 
        style={itemSelection.valueType === 'm' ? styles.itemBadgeMega : styles.itemBadgeNeon} styles={styles} />);
    }
    return b;
  }, [item.type, itemSelection, styles, hideBadge]);

  const handleBadgePress = useCallback((badge) => {
    onBadgePress(item.id, badge);
  }, [item.id, onBadgePress]);

  return (
    <Pressable 
      style={styles.itemContainer} 
      onPress={onPress} 
      disabled={!isSelectable}
      android_ripple={isSelectable ? { color: 'rgba(0,0,0,0.1)' } : null}
    >
      <View style={styles.imageContainer}>
        <ItemImage uri={imageUrl} badges={badges} styles={styles} />
        <View style={styles.itemInfo}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.value}>Value: {Number(currentValue).toLocaleString()}</Text>
          <Text style={styles.rarity}>{item.rarity}</Text>
        </View>
      </View>
      <View style={styles.badgesContainer}>
        {VALUE_TYPES.map((badge) => (
          <BadgeButton key={badge} badge={badge} isActive={itemSelection.valueType === badge.toLowerCase()} 
            onPress={handleBadgePress} styles={styles} />
        ))}
        {MODIFIERS.map((badge) => (
          <BadgeButton key={badge} badge={badge} isActive={badge === 'F' ? itemSelection.isFly : itemSelection.isRide} 
            onPress={handleBadgePress} styles={styles} />
        ))}
      </View>
    </Pressable>
  );
});



const ValueScreen = React.memo(({ selectedTheme, fromChat, selectedFruits, setSelectedFruits, onRequestClose, fromSetting, ownedPets, setOwnedPets, wishlistPets, setWishlistPets, owned }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [selectedValueType, setSelectedValueType] = useState('d');
  const [isFlySelected, setIsFlySelected] = useState(false);
  const [isRideSelected, setIsRideSelected] = useState(false);
  const { reload, theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const { localState, toggleAd } = useLocalState();
  const [codesData, setCodesData] = useState([]);
  const { t } = useTranslation();
  const [filters, setFilters] = useState(['All']);
  const displayedFilter = selectedFilter === 'PREMIUM' ? 'GAME PASS' : selectedFilter;
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const [refreshing, setRefreshing] = useState(false);
  const [itemSelections, setItemSelections] = useState({});
  const [showAd1, setShowAd1] = useState(localState?.showAd1);
  const [sortOrder, setSortOrder] = useState('none');

  // ✅ Memoize these arrays
  const hideBadge = useMemo(() => 
    !localState.isGG ? ['EGGS', 'VEHICLES', 'PET WEAR', 'OTHER'] : ['PETWEAR', 'FOODS', 'VEHICLES', 'TOYS', 'GIFTS', 'STROLLERS', 'STICKERS'],
    [localState.isGG]
  );
  
  const CATEGORIES = useMemo(() => 
    !localState.isGG ? ['ALL', 'PETS', 'EGGS', 'VEHICLES', 'TOYS', 'PET WEAR', 'FOOD', 'STROLLERS', 'GIFTS', 'OTHER'] : ['ALL', 'PETS', 'PETWEAR', 'FOODS', 'VEHICLES', 'TOYS', 'GIFTS', 'STROLLERS', 'STICKERS'],
    [localState.isGG]
  );

  // ✅ Stable reference for isSelectable
  const isSelectable = fromChat || fromSetting;

  // ✅ Stable keyExtractor for FlatList
  const keyExtractor = useCallback((item) => item.id || item.name, []);
  
  // ✅ getItemLayout for faster scrolling (approximate item height)
  const ITEM_HEIGHT = 140;
  const getItemLayout = useCallback((data, index) => ({
    length: ITEM_HEIGHT,
    offset: ITEM_HEIGHT * Math.floor(index / 2),
    index,
  }), []);

  const editValuesRef = useRef({
    Value: '',
    Permanent: '',
    Biliprice: '',
    Robuxprice: '',
  });
  useEffect(() => {
    // Toggle the ad state when the screen is mounted
    const newAdState = toggleAd();
    setShowAd1(newAdState);
  }, []);
  const CustomAd = () => (
    <View style={styles.adContainer}>
      <View style={styles.adContent}>
        <Image
          source={require('../../assets/icon.webp')} // Replace with your ad icon
          style={styles.adIcon}
        />
        <View>
          <Text style={styles.adTitle}>Blox Fruits Values</Text>
          <Text style={styles.tryNowText}>Try Our other app</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.downloadButton} onPress={() => {
        handleBloxFruit(); triggerHapticFeedback('impactLight');
      }}>
        <Text style={styles.downloadButtonText}>Download</Text>
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
          <Text style={styles.adTitle}>MM2 Values</Text>
          <Text style={styles.tryNowText}>Try Our other app</Text>
        </View>
      </View>
      <TouchableOpacity style={styles.downloadButton} onPress={() => {
        handleadoptme(); triggerHapticFeedback('impactLight');
      }}>
        <Text style={styles.downloadButtonText}>Download</Text>
      </TouchableOpacity>
    </View>
  );


  // Memoize the parsed data to prevent unnecessary re-parsing
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
  }, [parsedValuesData]);

  // Optimize the search and filter logic

  // useEffect(() => {
  //   if (localState.isGG) {
  //     const types = new Set(parsedValuesData.map(i => (i.type || '').toUpperCase()));
  //     // console.log("🧪 GG Types:", Array.from(types));
  //   }
  // }, [parsedValuesData]);


  const filteredData = useMemo(() => {
    if (!Array.isArray(parsedValuesData) || parsedValuesData.length === 0) return [];

    const searchLower = searchText.toLowerCase();
    const filterUpper = selectedFilter.toUpperCase();

    let filtered = parsedValuesData.filter((item) => {
      if (!item?.name) return false;

      const matchesSearch = item.name.toLowerCase().includes(searchLower);
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
  }, [parsedValuesData, searchText, selectedFilter, sortOrder, selectedValueType, isFlySelected, isRideSelected]);


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


  // ✅ Stable handler for item press - moved outside renderItem
  const handleItemPress = useCallback((item, itemSelection, imageUrl, currentValue) => {
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

    if (fromChat) {
      setSelectedFruits(prev => [...(prev || []), fruitObj]);
    }
    if (fromSetting) {
      if (owned) {
        setOwnedPets(prev => [...(prev || []), fruitObj]);
      } else {
        setWishlistPets(prev => [...(prev || []), fruitObj]);
      }
    }
  }, [fromChat, fromSetting, owned, setSelectedFruits, setOwnedPets, setWishlistPets]);

  // ✅ Optimized renderItem - minimal work, stable references
  const renderItem = useCallback(({ item }) => {
    const itemSelection = itemSelections[item.id] || { valueType: 'd', isFly: false, isRide: false };
    const currentValue = getItemValue(item, itemSelection.valueType, itemSelection.isFly, itemSelection.isRide);
    const imageUrl = getImageUrl(item, localState.isGG, localState.imgurl, localState.imgurlGG);

    return (
      <ListItem
        item={item}
        itemSelection={itemSelection}
        onBadgePress={handleItemBadgePress}
        styles={styles}
        onPress={() => handleItemPress(item, itemSelection, imageUrl, currentValue)}
        isSelectable={isSelectable}
        imageUrl={imageUrl}
        currentValue={currentValue}
        hideBadge={hideBadge}
      />
    );
  }, [itemSelections, handleItemBadgePress, styles, localState.isGG, localState.imgurl, localState.imgurlGG, handleItemPress, isSelectable, hideBadge]);


  // Update filters when data changes
  useEffect(() => {
    setFilters(availableFilters);
  }, [availableFilters]);

  // Update codes data
  useEffect(() => {
    setCodesData(parsedCodesData);
  }, [parsedCodesData]);

  const handleRefresh = async () => {
    setRefreshing(true);

    try {
      await reload(); // Re-fetch stock data
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleDrawer = () => {
    triggerHapticFeedback('impactLight');
    const callbackfunction = () => {
      setHasAdBeenShown(true); // Mark the ad as shown
      setIsDrawerVisible(!isDrawerVisible);
    };

    if (!hasAdBeenShown && !localState.isPro) {
      InterstitialAdManager.showAd(callbackfunction);
    }
    else {
      setIsDrawerVisible(!isDrawerVisible);
    }
    mixpanel.track("Code Drawer Open");
  }


  const applyFilter = (filter) => {
    setSelectedFilter(filter);
  };

  const handleSearchChange = debounce((text) => {
    setSearchText(text);
  }, 300);
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
                    ? 'Selected pets'
                    : owned
                      ? 'Owned pets'
                      : 'Wishlist'}
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
                removeClippedSubviews={Platform.OS === 'android'}
                renderItem={({ item, index }) => (
                  <Pressable 
                    style={styles.selectedPetCard} 
                    onPress={() => handleRemoveSelected(index)}
                    android_ripple={{ color: 'rgba(0,0,0,0.1)' }}
                  >
                    <Image source={{ uri: item.imageUrl }} style={styles.selectedPetImage} />
                    <Text style={styles.selectedPetName} numberOfLines={1}>{item.name}</Text>
                    <View style={styles.removePetButton}>
                      <Icon name="close" size={8} color="#fff" />
                    </View>
                  </Pressable>
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
              placeholder="Search"
              placeholderTextColor="#888"
              onChangeText={handleSearchChange}
            />
            {/* Selected / owned pets strip (chat/settings only) */}


            {!fromChat && !fromSetting && <Menu>
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
                    <Text style={[styles.filterOptionText, selectedFilter === filter && styles.selectedOption]}>
                      {filter}
                    </Text>
                  </MenuOption>
                ))}
              </MenuOptions>

            </Menu>}
            <TouchableOpacity
              style={styles.filterButton}
              onPress={() => {
                setSortOrder(prev =>
                  prev === 'asc' ? 'desc' : prev === 'desc' ? 'none' : 'asc'
                );
              }}
            >
              <Text style={styles.filterText}>
                {sortOrder === 'asc' ? '▲ High' : sortOrder === 'desc' ? '▼ LOw' : 'Filter'}
              </Text>
            </TouchableOpacity>
            {selectedFruits?.length > 0 && <TouchableOpacity
              style={[styles.filterButton, { backgroundColor: 'purple' }]}
              onPress={onRequestClose}
            >
              <Text style={styles.filterText}>
                Done
              </Text>
            </TouchableOpacity>}
          </View>

          {filteredData.length > 0 ? (
            <FlatList
              data={filteredData}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews={Platform.OS === 'android'}
              numColumns={2}
              columnWrapperStyle={styles.columnWrapper}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              maxToRenderPerBatch={6}
              windowSize={3}
              initialNumToRender={6}
              updateCellsBatchingPeriod={50}
              getItemLayout={getItemLayout}
            />
          ) : (
            <Text style={[styles.description, { textAlign: 'center', marginTop: 20, color: 'gray' }]}>
              {t("value.no_results")}
            </Text>
          )}
        </View>
        <CodesDrawer isVisible={isDrawerVisible} toggleModal={toggleDrawer} codes={codesData} />
      </GestureHandlerRootView>
      {!localState.isPro && !fromChat && <BannerAdComponent />}
    </>
  );
});
export const getStyles = (isDarkMode) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#121212' : '#f8f9fa',
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
    backgroundColor: isDarkMode ? '#2a2a2a' : '#ffffff',
    borderRadius: 8,
    paddingHorizontal: 20,
    color: isDarkMode ? '#ffffff' : '#000000',
    flex: 1,
    fontSize: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },

  itemContainer: {
    backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
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
    backgroundColor: isDarkMode ? '#2a2a2a' : '#f8f9fa',
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
    color: isDarkMode ? '#ffffff' : '#000000',
    marginBottom: 2,
    letterSpacing: -0.5,
  },
  value: {
    fontSize: 12,
    color: isDarkMode ? '#e0e0e0' : '#333333',
    marginBottom: 2,
    fontWeight: '500',
  },
  rarity: {
    fontSize: 10,
    color: config.colors.primary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
    backgroundColor: isDarkMode ? '#2a2a2a' : '#f0f0f0',
    // padding: 16,
    borderRadius: 16,
    marginTop: 8,
  },
  badgeButton: {
    paddingVertical: 7,
    paddingHorizontal: 15,
    borderRadius: 15,
    backgroundColor: isDarkMode ? '#3a3a3a' : '#ffffff',
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
    color: isDarkMode ? '#ffffff' : '#666666',
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
    color: isDarkMode ? '#fff' : '#333',
  },
  selectedOption: {
    fontWeight: '700',
    color: config.colors.primary,
  },
  menuOptions: {
    backgroundColor: isDarkMode ? '#2a2a2a' : '#ffffff',
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
    color: isDarkMode ? '#888888' : '#666666',
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
    fontFamily: 'Lato-Bold',
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
    backgroundColor: isDarkMode ? '#34495E' : '#f3d0c7', // Dark: darker contrast, Light: White
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
    fontFamily: 'Lato-Bold',
    marginRight: 5,
  },
  // filterOptionText: {
  //   fontSize: 14,
  //   padding: 10,
  //   color: "#333",
  // },
  selectedOption: {
    fontFamily: 'Lato-Bold',
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
    borderTopColor: isDarkMode ? '#4A4A4A' : '#E0E0E0',
    marginTop: 8,
  },
  badgeButton: {
    // marginHorizontal: 1,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: isDarkMode ? '#2A2A2A' : '#f0f0f0',
  },
  badgeButtonActive: {
    backgroundColor: '#FF6666',
  },
  badgeButtonText: {
    fontSize: 10,
    fontWeight: '600',
    color: isDarkMode ? '#fff' : '#666',
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
    backgroundColor: isDarkMode ? '#181c22' : '#f8f9fa',
  },
  categoryBarContent: {
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  categoryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: isDarkMode ? '#23272f' : '#f0f0f0',
    marginRight: 8,
  },
  categoryButtonActive: {
    backgroundColor: config.colors.primary,
  },
  categoryButtonText: {
    fontSize: 13,
    color: isDarkMode ? '#bbb' : '#333',
    fontWeight: '600',
  },
  categoryButtonTextActive: {
    color: '#fff',
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
    fontFamily: 'Lato-Bold',
    color: isDarkMode ? '#bbb' : '#333',
    // marginBottom: 5, // Adds space below the title
  },
  tryNowText: {
    fontSize: 14,
    fontFamily: 'Lato-Regular',
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
    fontFamily: 'Lato-Bold',
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
    color: isDarkMode ? '#ffffff' : '#111827',
  },
  selectedPetsCount: {
    fontSize: 11,
    fontWeight: '600',
    color: isDarkMode ? '#9ca3af' : '#6b7280',
  },
  selectedPetsList: {
    paddingVertical: 4,
  },
  selectedPetCard: {
    width: 40,
    marginRight: 8,
    borderRadius: 10,
    padding: 6,
    backgroundColor: isDarkMode ? '#1f2933' : '#ffffff',
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
    backgroundColor: isDarkMode ? '#111827' : '#f3f4f6',
  },
  selectedPetName: {
    fontSize: 8,
    fontWeight: '500',
    color: isDarkMode ? '#e5e7eb' : '#111827',
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

export default ValueScreen;
