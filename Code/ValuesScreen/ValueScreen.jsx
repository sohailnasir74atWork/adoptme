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
import { ref, update } from '@react-native-firebase/database';
import { mixpanel } from '../AppHelper/MixPenel';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import InterstitialAdManager from '../Ads/IntAd';
import BannerAdComponent from '../Ads/bannerAds';

const VALUE_TYPES = ['D', 'N', 'M'];
const MODIFIERS = ['F', 'R'];

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

const ListItem = React.memo(({ item, itemSelection, onBadgePress, getItemValue, styles }) => {
  const currentValue = getItemValue(item, itemSelection.valueType, itemSelection.isFly, itemSelection.isRide);
  const badges = [];

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

  return (
    <View style={styles.itemContainer}>
      <View style={styles.imageContainer}>
        <ItemImage
          uri={`https://elvebredd.com${item.image}`}
          badges={badges}
          styles={styles}
        />
        <View style={styles.itemInfo}>
          <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
          <Text style={styles.value}>Value: {Number(currentValue).toLocaleString()}</Text>
          <Text style={styles.rarity}>{item.rarity}</Text>
        </View>
      </View>
      
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
    </View>
  );
});

const ValueScreen = React.memo(({ selectedTheme }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedFilter, setSelectedFilter] = useState('All');
  const [selectedValueType, setSelectedValueType] = useState('d');
  const [isFlySelected, setIsFlySelected] = useState(false);
  const [isRideSelected, setIsRideSelected] = useState(false);
  const [filterDropdownVisible, setFilterDropdownVisible] = useState(false);
  const { analytics, appdatabase, isAdmin, reload, theme } = useGlobalState()
  const isDarkMode = theme === 'dark'
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const [filteredData, setFilteredData] = useState([]);
  const { localState } = useLocalState()
  const [valuesData, setValuesData] = useState([]);
  const [codesData, setCodesData] = useState([]);
  const { t } = useTranslation();
  const [filters, setFilters] = useState(['All']);
  const displayedFilter = selectedFilter === 'PREMIUM' ? 'GAME PASS' : selectedFilter;
  const formatName = (name) => name.replace(/^\+/, '').replace(/\s+/g, '-');
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [hasAdBeenShown, setHasAdBeenShown] = useState(false);
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const [isShowingAd, setIsShowingAd] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const [selectedFruit, setSelectedFruit] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // State for pull-to-refresh
  const [itemSelections, setItemSelections] = useState({});

  const editValuesRef = useRef({
    Value: '',
    Permanent: '',
    Biliprice: '',
    Robuxprice: '',
  });



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

  const updateFruitData = () => {
    if (!selectedFruit || !selectedFruit.Name) {
      console.error("❌ No fruit selected for update or missing Name property");
      return;
    }

    let localData = localState.data;

    // Ensure localState.data is parsed correctly if it's a string
    if (typeof localData === "string") {
      try {
        localData = JSON.parse(localData);
      } catch (error) {
        console.error("❌ Failed to parse localState.data as JSON", error, localData);
        return;
      }
    }

    // Check again to ensure it's a valid object
    if (!localData || typeof localData !== "object" || Array.isArray(localData)) {
      console.error("❌ localState.data is missing or not a valid object", localData);
      return;
    }

    // Find the correct record key (case-insensitive match)
    const recordKey = Object.keys(localData).find(key => {
      const record = localData[key];

      if (!record || !record.Name) {
        console.warn(`⚠️ Skipping record ${key} due to missing Name field`, record);
        return false;
      }

      return record.Name.trim().toLowerCase() === selectedFruit.Name.trim().toLowerCase();
    });

    if (!recordKey) {
      console.error(`❌ Error: Record key not found for ${selectedFruit.Name}`);
      return;
    }

    // Ensure values are valid before updating
    const updatedValues = {
      Value: isNaN(Number(editValuesRef.current.Value)) ? 0 : Number(editValuesRef.current.Value),
      Permanent: isNaN(Number(editValuesRef.current.Permanent)) ? 0 : Number(editValuesRef.current.Permanent),
      Biliprice: isNaN(Number(editValuesRef.current.Biliprice)) ? 0 : Number(editValuesRef.current.Biliprice),
      Robuxprice: editValuesRef.current.Robuxprice || "N/A",
    };

    // Reference to the correct Firebase record
    const fruitRef = ref(appdatabase, `/fruit_data/${recordKey}`);

    update(fruitRef, updatedValues)
      .then(() => {
        setIsModalVisible(false);
      })
      .catch((error) => {
        console.error("❌ Error updating fruit:", error);
      });
  };
  const applyFilter = (filter) => {
    setSelectedFilter(filter);
  };


  useEffect(() => {
    if (localState.data) {
      try {
        const parsedValues = typeof localState.data === 'string' ? JSON.parse(localState.data) : localState.data;

        if (typeof parsedValues !== 'object' || parsedValues === null) {
          throw new Error('Parsed data is not a valid object');
        }

        const values = Object.values(parsedValues);
        setValuesData(values);

        // Extract unique rarities and update filters
        const uniqueRarities = ['All', ...new Set(values.map(item => 
          item.rarity ? item.rarity.toUpperCase() : null
        ).filter(Boolean))];
        setFilters(uniqueRarities);
      } catch (error) {
        console.error("❌ Error parsing data:", error, "📝 Raw Data:", localState.data);
        setValuesData([]);
      }
    }
  }, [localState.data]);


  useEffect(() => {
    if (localState.codes) {
      try {
        // ✅ Handle both JSON string & object cases
        const parsedCodes = typeof localState.codes === 'string' ? JSON.parse(localState.codes) : localState.codes;

        // ✅ Ensure parsedCodes is a valid object
        if (typeof parsedCodes !== 'object' || parsedCodes === null) {
          throw new Error('Parsed codes is not a valid object');
        }

        const extractedCodes = Object.values(parsedCodes);
        setCodesData(extractedCodes.length > 0 ? extractedCodes : []);
      } catch (error) {
        console.error("❌ Error parsing codes:", error, "📝 Raw Codes Data:", localState.codes);
        setCodesData([]); // Fallback to empty array
      }
    }
  }, [localState.codes]);

  const handleFilterChange = (filter) => {
    triggerHapticFeedback('impactLight');
    setSelectedFilter(filter === 'GAME PASS' ? 'PREMIUM' : filter);
    setFilterDropdownVisible(false);
  };

  const handleSearchChange = debounce((text) => {
    setSearchText(text);
  }, 300);
  const closeDrawer = () => {
    setFilterDropdownVisible(false);
  };
  useEffect(() => {
    if (!Array.isArray(valuesData) || valuesData.length === 0) {
      setFilteredData([]);
      return;
    }

    const filtered = valuesData.filter((item) => {
      if (!item?.name) return false;

      const matchesSearch = item.name.toLowerCase().includes(searchText.toLowerCase());
      const matchesRarity = selectedFilter === 'All' || 
        (item.rarity && item.rarity.toUpperCase() === selectedFilter);
      
      return matchesSearch && matchesRarity;
    });

    setFilteredData(filtered);
  }, [valuesData, searchText, selectedFilter]);
  const EditFruitModal = () => (
    <Modal visible={isModalVisible} transparent={true} animationType="slide">
      <View style={styles.modalContainer}>
        <Text style={styles.modalTitle}>Edit {selectedFruit?.name}</Text>

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Value}
          onChangeText={(text) => (editValuesRef.current.Value = text)}
          keyboardType="numeric"
          placeholder="Value"
        />

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Permanent}
          onChangeText={(text) => (editValuesRef.current.Permanent = text)}
          keyboardType="numeric"
          placeholder="Permanent Value"
        />

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Biliprice}
          onChangeText={(text) => (editValuesRef.current.Biliprice = text)}
          keyboardType="numeric"
          placeholder="Beli Price"
        />

        <TextInput
          style={styles.input}
          defaultValue={editValuesRef.current.Robuxprice}
          onChangeText={(text) => (editValuesRef.current.Robuxprice = text)}
          keyboardType="default"
          placeholder="Robux Price"
        />


        <TouchableOpacity style={styles.saveButton}>
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setIsModalVisible(false)} style={styles.cencelButton}>
          <Text style={styles.saveButtonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );

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

  const getItemValue = (item, selectedValueType, isFlySelected, isRideSelected) => {
    if (!item) return 0;
    
    // Categories that only use 'value' field
    const simpleValueCategories = ['EGGS', 'VEHICLES', 'PET WEAR', 'OTHER'];
    
    // If item is from a simple value category or has a direct value field, use that
    if (simpleValueCategories.includes(item.type) || item.value !== undefined || item.rvalue !== undefined) {
      return Number(Number(item.value || item.rvalue).toFixed(2)) || 0;
    }
    
    // For other categories (PETS), use the selected value type
    if (!selectedValueType) return 0;
    
    let valueKey = '';
    if (selectedValueType === 'n') valueKey = 'nvalue';
    else if (selectedValueType === 'm') valueKey = 'mvalue';
    else if (selectedValueType === 'd') valueKey = 'rvalue';

    if (isFlySelected && isRideSelected) valueKey += ' - fly&ride';
    else if (isFlySelected) valueKey += ' - fly';
    else if (isRideSelected) valueKey += ' - ride';
    else if (!isFlySelected && !isRideSelected) valueKey += ' - nopotion';

    return Number(item[valueKey]) || 0;
  };

  const handleItemBadgePress = useCallback((itemId, badge) => {
    triggerHapticFeedback('impactLight');
    setItemSelections(prev => {
      const currentSelection = prev[itemId] || { valueType: 'd', isFly: false, isRide: false };
      
      if (badge === 'F') {
        return { ...prev, [itemId]: { ...currentSelection, isFly: !currentSelection.isFly }};
      } else if (badge === 'R') {
        return { ...prev, [itemId]: { ...currentSelection, isRide: !currentSelection.isRide }};
      } else {
        return { ...prev, [itemId]: { ...currentSelection, valueType: badge.toLowerCase() }};
      }
    });
  }, [triggerHapticFeedback]);

  const renderItem = useCallback(({ item }) => (
    <ListItem
      item={item}
      itemSelection={itemSelections[item.id] || { valueType: 'd', isFly: false, isRide: false }}
      onBadgePress={handleItemBadgePress}
      getItemValue={getItemValue}
      styles={styles}
    />
  ), [itemSelections, handleItemBadgePress, getItemValue, styles]);

  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          {/* <Text style={[styles.description, { color: selectedTheme.colors.text }]}>
            {t("value.description")}
          </Text> */}
          <View style={styles.searchFilterContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search"
              placeholderTextColor="#888"
              onChangeText={handleSearchChange}

            />
            <Menu>
              <MenuTrigger onPress={() => {}}>
                <View style={styles.filterButton}>
                  <Text style={styles.filterText}>{displayedFilter}</Text>
                  <Icon name="chevron-down-outline" size={18} color="white" />
                </View>
              </MenuTrigger>

              <MenuOptions customStyles={{ optionsContainer: styles.menuOptions }}>
                {filters.map((filter) => (
                  <MenuOption
                    key={filter}
                    onSelect={() => {
                      applyFilter(filter);
                    }}
                  >
                    <Text style={[styles.filterOptionText, selectedFilter === filter && styles.selectedOption]}>
                      {filter}
                    </Text>
                  </MenuOption>
                ))}
              </MenuOptions>
            </Menu>
            {/* <TouchableOpacity
              style={[styles.filterDropdown, { backgroundColor: config.colors.primary }]}
              onPress={toggleDrawer}
            >
              <Text style={[styles.filterText, { color: 'white' }]}> {t("value.codes")}</Text>
            </TouchableOpacity> */}
          </View>







          {filteredData.length > 0 ? (
            <>
              <FlatList
                data={filteredData}
                keyExtractor={(item) => item.id || item.name}
                renderItem={renderItem}
                showsVerticalScrollIndicator={false}
                removeClippedSubviews={true}
                numColumns={!config.isNoman ? 1 : 1}
                refreshing={refreshing}
                onRefresh={handleRefresh}
              // columnWrapperStyle={!config.isNoman ? styles.columnWrapper : styles.columnWrapper}
              />
              {isModalVisible && selectedFruit && <EditFruitModal />}
            </>
          ) : (
            <Text style={[styles.description, { textAlign: 'center', marginTop: 20, color: 'gray' }]}>
              {t("value.no_results")}
            </Text>
          )
          }

        </View>
        <CodesDrawer isVisible={isDrawerVisible} toggleModal={toggleDrawer} codes={codesData} />
      </GestureHandlerRootView>
      {!localState.isPro && <BannerAdComponent/>}

      {/* {!localState.isPro && <View style={{ alignSelf: 'center' }}>
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
    </>
  );
});
export const getStyles = (isDarkMode) => StyleSheet.create({
  container: { 
    flex: 1,
    backgroundColor: isDarkMode ? '#121212' : '#f8f9fa',
    paddingTop: 16,
  },
  searchFilterContainer: { 
    flexDirection: 'row', 
    marginBottom: 16,
    paddingHorizontal: 16,
    gap: 12,
    alignItems: 'center',
  },
  searchInput: {   
    height: 48,
    backgroundColor: isDarkMode ? '#2a2a2a' : '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 20,
    color: isDarkMode ? '#ffffff' : '#000000',
    flex: 1,
    fontSize: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  filterButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: config.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  itemContainer: {
    backgroundColor: isDarkMode ? '#1e1e1e' : '#ffffff',
    borderRadius: 20,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  imageContainer: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  imageWrapper: {
    position: 'relative',
    width: 80,
    height: 80,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
    backgroundColor: isDarkMode ? '#2a2a2a' : '#f8f9fa',
  },
  icon: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  itemInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: isDarkMode ? '#ffffff' : '#000000',
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  value: {
    fontSize: 16,
    color: isDarkMode ? '#e0e0e0' : '#333333',
    marginBottom: 6,
    fontWeight: '500',
  },
  rarity: {
    fontSize: 14,
    color: config.colors.primary,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemBadgesContainer: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    flexDirection: 'row',
    gap: 4,
  },
  itemBadge: {
    color: 'white',
    padding: 4,
    borderRadius: 8,
    fontSize: 12,
    minWidth: 24,
    textAlign: 'center',
    overflow: 'hidden',
    fontWeight: '700',
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
    gap: 8,
    backgroundColor: isDarkMode ? '#2a2a2a' : '#f0f0f0',
    padding: 16,
    borderRadius: 16,
    marginTop: 8,
  },
  badgeButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
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
    fontSize: 14,
    fontWeight: '600',
    color: isDarkMode ? '#ffffff' : '#666666',
    textAlign: 'center',
  },
  badgeButtonTextActive: {
    color: '#ffffff',
  },
  filterText: {
    color: "white",
    fontSize: 16,
    fontWeight: '600',
    marginRight: 8,
  },
  filterOptionText: {
    fontSize: 16,
    padding: 16,
    color: isDarkMode ? '#ffffff' : '#333333',
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
    paddingHorizontal: 15,
    borderRadius: 8,
  },
  filterText: {
    color: "white",
    fontSize: 14,
    fontFamily: 'Lato-Bold',
    marginRight: 5,
  },
  filterOptionText: {
    fontSize: 14,
    padding: 10,
    color: "#333",
  },
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
    marginHorizontal: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: isDarkMode ? '#2A2A2A' : '#f0f0f0',
  },
  badgeButtonActive: {
    backgroundColor: '#FF6666',
  },
  badgeButtonText: {
    fontSize: 12,
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
    borderRadius: 4,
    fontSize: 8,
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
});

export default ValueScreen;
