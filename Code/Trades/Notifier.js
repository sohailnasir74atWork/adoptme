// NotifierDrawer.js
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, Image, StyleSheet, ScrollView, Modal, ToastAndroid, Platform, Alert } from 'react-native';
import { ref, onValue, remove, set, update, get } from '@react-native-firebase/database';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import InterstitialAdManager from '../Ads/IntAd';
import { requestPermission } from '../Helper/PermissionCheck';
import { showMessage } from 'react-native-flash-message';
import config from '../Helper/Environment';

const NotifierDrawer = () => {
  const { user, appdatabase, theme } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';

  const [mode, setMode] = useState('buy');
  const [savedItems, setSavedItems] = useState({ buy: {}, sale: {} });
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [adShown, setAdShown] = useState(false);

  const openDrawerToSelect = ()=> {
    if (!user?.id) {
      showMessage({
        message: 'Please log in to select an item',
        type: 'warning',
        duration: 2500,
      });
      return;
    }
    requestPermission()
    setIsDrawerVisible(true)
  }
  const parsedValuesData = useMemo(() => {
    try {
      const rawData = localState.isGG ? localState.ggData : localState.data;
      if (!rawData) return [];
      const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch (error) {
      console.error("Error parsing data:", error);
      return [];
    }
  }, [localState.isGG, localState.data, localState.ggData]);

  const getImageUrl = useCallback((item, itemNameOverride = null) => {
    const itemName = itemNameOverride || item?.name || item?.Name || '';
    if (!itemName) return '';
    
    // ✅ Generate image URL client-side based on item name
    // This reduces Firebase storage costs (we only store name, not image URL)
    const encoded = encodeURIComponent(itemName);
    if (localState.isGG) {
      return `${localState.imgurlGG?.replace(/"/g, '')}/items/${encoded}.webp`;
    }
    
    // ✅ For non-GG mode, try to get image from item object if available
    if (item?.image) {
      return `${localState.imgurl?.replace(/"/g, '')}/${item.image.replace(/^\/+/, '')}`;
    }
    
    // ✅ Fallback: try to find item in parsedValuesData to get image
    if (itemName && parsedValuesData.length > 0) {
      const foundItem = parsedValuesData.find(
        (i) => (i?.name || i?.Name || '').toLowerCase() === itemName.toLowerCase()
      );
      if (foundItem?.image) {
        return `${localState.imgurl?.replace(/"/g, '')}/${foundItem.image.replace(/^\/+/, '')}`;
      }
    }
    
    return '';
  }, [localState.isGG, localState.imgurlGG, localState.imgurl, parsedValuesData]);

  // const showMessage = (msg) => {
  //   if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
  //   else Alert.alert('Info', msg);
  // };

  useEffect(() => {
    if (!user?.id) return;
    const buyRef = ref(appdatabase, `/notifier/buy/${user.id}`);
    const saleRef = ref(appdatabase, `/notifier/sale/${user.id}`);

    const buyListener = onValue(buyRef, async (snap) => {
      const buyData = snap.val() || {};
      setSavedItems(prev => ({ ...prev, buy: buyData }));
      
      // ✅ OPTIMIZED: Migrate old format items to new string format + create indexes
      // This reduces storage and download costs significantly
      if (Object.keys(buyData).length > 0) {
        const indexUpdates = {};
        const migrationUpdates = {};
        let hasIndexUpdates = false;
        let hasMigrationUpdates = false;
        
        // Batch check and migrate old format items + create missing indexes
        const checkPromises = Object.entries(buyData).map(async ([itemKey, itemValue]) => {
          const itemName = typeof itemValue === 'string' ? itemValue : (itemValue?.name || itemValue?.Name || '');
          if (!itemName) return;
          
          // ✅ MIGRATION: Convert old object format to new string format
          if (typeof itemValue !== 'string') {
            migrationUpdates[`notifier/buy/${user.id}/${itemKey}`] = itemName;
            hasMigrationUpdates = true;
          }
          
          // Create reverse index
          const indexRef = ref(appdatabase, `/notifier_index/buy/${itemKey}/${user.id}`);
          try {
            const indexSnap = await get(indexRef);
            if (!indexSnap.exists()) {
              indexUpdates[`notifier_index/buy/${itemKey}/${user.id}`] = true;
              hasIndexUpdates = true;
            }
          } catch (error) {
            // Silently fail - index creation is not critical
          }
        });
        
        await Promise.all(checkPromises);
        
        // Batch migrate old format items
        if (hasMigrationUpdates && Object.keys(migrationUpdates).length > 0) {
          update(ref(appdatabase), migrationUpdates).catch((error) => {
            console.warn('Error migrating notifier items:', error);
          });
        }
        
        // Batch create all missing indexes at once
        if (hasIndexUpdates && Object.keys(indexUpdates).length > 0) {
          update(ref(appdatabase), indexUpdates).catch((error) => {
            // Silently fail - index creation is not critical for app functionality
          });
        }
      }
    });
    
    const saleListener = onValue(saleRef, async (snap) => {
      const saleData = snap.val() || {};
      setSavedItems(prev => ({ ...prev, sale: saleData }));
      
      // ✅ OPTIMIZED: Migrate old format items to new string format + create indexes
      if (Object.keys(saleData).length > 0) {
        const indexUpdates = {};
        const migrationUpdates = {};
        let hasIndexUpdates = false;
        let hasMigrationUpdates = false;
        
        const checkPromises = Object.entries(saleData).map(async ([itemKey, itemValue]) => {
          const itemName = typeof itemValue === 'string' ? itemValue : (itemValue?.name || itemValue?.Name || '');
          if (!itemName) return;
          
          // ✅ MIGRATION: Convert old object format to new string format
          if (typeof itemValue !== 'string') {
            migrationUpdates[`notifier/sale/${user.id}/${itemKey}`] = itemName;
            hasMigrationUpdates = true;
          }
          
          const indexRef = ref(appdatabase, `/notifier_index/sale/${itemKey}/${user.id}`);
          try {
            const indexSnap = await get(indexRef);
            if (!indexSnap.exists()) {
              indexUpdates[`notifier_index/sale/${itemKey}/${user.id}`] = true;
              hasIndexUpdates = true;
            }
          } catch (error) {
            // Silently fail
          }
        });
        
        await Promise.all(checkPromises);
        
        // Batch migrate old format items
        if (hasMigrationUpdates && Object.keys(migrationUpdates).length > 0) {
          update(ref(appdatabase), migrationUpdates).catch((error) => {
            console.warn('Error migrating notifier items:', error);
          });
        }
        
        if (hasIndexUpdates && Object.keys(indexUpdates).length > 0) {
          update(ref(appdatabase), indexUpdates).catch((error) => {
            // Silently fail
          });
        }
      }
    });

    return () => {
      buyListener();
      saleListener();
    };
  }, [user?.id, appdatabase]);

  const subtitleText =
  mode === 'buy'
    ? "Select items you want to buy. You'll be notified when someone is offering them."
    : "Select items you want to sell. You'll be notified when someone is looking for them.";
    const buttonText =
    mode === 'buy'
      ? "Notify me when offered"
      : "Notify me when wanted";
  

  const handleSelect =  (item) => {
    const itemName = item?.name || item?.Name;
    if (!itemName) return;
    const key = itemName.replace(/[^a-zA-Z0-9]/g, '_');
    const itemRef = ref(appdatabase, `/notifier/${mode}/${user.id}/${key}`);
    const indexRef = ref(appdatabase, `/notifier_index/${mode}/${key}/${user.id}`);
    
    // ✅ OPTIMIZED: Store only name (not image URL) to reduce Firebase storage/download costs
    // Image URL can be generated client-side using getImageUrl() function which looks up image from parsedValuesData
    // Cloud function only needs 'name' for matching, so storing image is unnecessary
    set(itemRef, itemName); // Store as string value instead of object
    
    // ✅ OPTIMIZED: Create reverse index for cloud function optimization
    // This allows cloud function to query by item name instead of downloading all users' items
    set(indexRef, true).catch((error) => {
      console.error('Error creating notifier index:', error);
    });
    
    showMessage({
      message: `${itemName} added to ${mode.toUpperCase()}`,
      type: 'success',
      duration: 2500,
    });
  };

  const handleRemove = (key) => {
    if (!user?.id) return;
  
    const proceedToRemove = () => {
      const itemRef = ref(appdatabase, `/notifier/${mode}/${user.id}/${key}`);
      const indexRef = ref(appdatabase, `/notifier_index/${mode}/${key}/${user.id}`);
      
      // ✅ OPTIMIZED: Remove both item and reverse index
      remove(itemRef);
      remove(indexRef).catch((error) => {
        console.error('Error removing notifier index:', error);
      });
      
      showMessage({
        message: 'Item removed',
        type: 'info',
        duration: 2000,
      });
    };
  
    if (!adShown && !localState?.isPro) {
      setAdShown(true); // mark ad as shown for this session
      InterstitialAdManager.showAd(proceedToRemove);
    } else {
      proceedToRemove();
    }
  };
  

  const renderItem = ({ item }) => {
    const itemName = item?.name || item?.Name || '';
    const key = itemName.replace(/[^a-zA-Z0-9]/g, '_');
    const isSelected = !!savedItems[mode]?.[key];
    return (
      <TouchableOpacity
        style={[styles.itemContainer, isSelected && styles.itemSelected, isDarkMode && styles.itemContainerDark]}
        onPress={() => handleSelect(item)}>
        <Image
          source={{ uri: getImageUrl(item) }}
          style={styles.itemImage}
        />
        <Text style={[styles.itemText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#fff' : '#000' }]}>{itemName}</Text>
      </TouchableOpacity>
    );
  };

  const renderSavedItem = ([key, data]) => {
    // ✅ OPTIMIZED: Generate image URL from name only (image is inferred from parsedValuesData)
    // This reduces Firebase storage and download costs significantly
    // Handle both old format (object with name) and new format (string value)
    const itemName = typeof data === 'string' ? data : (data?.name || data?.Name || '');
    const imageUrl = getImageUrl({}, itemName); // Pass empty object, name as override
    return (
      <View style={styles.savedItem} key={key}>
        <Image source={{ uri: imageUrl }} style={styles.itemImageSelected} />
        <Text style={[styles.itemText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#fff' : '#000', marginLeft:5 }]}>{itemName}</Text>
        <TouchableOpacity onPress={() => handleRemove(key)}>
        <Icon name="close-circle" size={20} color="red" style={styles.removeText} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#121212' : '#fff' }]}>
        {/* <Text style={[styles.infoText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#aaa' : '#666' }]}>
        Select items you want to buy or sell — we’ll notify you when someone is offering them or looking for them in a trade.
</Text> */}

      <TouchableOpacity style={styles.fab} onPress={openDrawerToSelect}>
        <Icon name="add-circle" size={44} color={config.colors.primary} />
      </TouchableOpacity>

      <View style={styles.modeToggle}>
        <TouchableOpacity
          style={[styles.toggleButton, mode === 'buy' && styles.active]}
          onPress={() => setMode('buy')}>
          <Text style={{ fontFamily: 'Lato-Bold', color: '#fff', fontSize:13 }}>Notify Me When Offered</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleButton, mode === 'sale' && styles.active]}
          onPress={() => setMode('sale')}>
          <Text style={{ fontFamily: 'Lato-Bold', color: '#fff' , fontSize:13 }}>Notify Me When Wanted</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionTitle, { fontFamily: 'Lato-Bold', color: isDarkMode ? '#fff' : '#000' }]}>{subtitleText}</Text>

      <View style={{ flexWrap: 'wrap', flexDirection: 'row', gap: 8 }}>
  {Object.keys(savedItems[mode] || {}).length > 0
    ? Object.entries(savedItems[mode]).map(renderSavedItem)
    : <Text style={[styles.placeholderText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#aaa' : '#888' }]}>
        No items selected.
      </Text>}
</View>


      <Modal visible={isDrawerVisible} animationType="slide">
        <View style={[styles.drawerContainer, { backgroundColor: isDarkMode ? '#1e1e1e' : '#fff' }]}>
          <Text style={[styles.sectionTitle, { fontFamily: 'Lato-Bold', color: isDarkMode ? '#fff' : '#000' }]}>Select Items to Notify</Text>

          <FlatList
            data={parsedValuesData}
            renderItem={renderItem}
            keyExtractor={(item, index) => item?.name || item?.Name || `item-${index}`}
            numColumns={3}
            contentContainerStyle={styles.grid}
          />

          <TouchableOpacity onPress={() => setIsDrawerVisible(false)} style={styles.closeButton}>
            <Text style={{ fontFamily: 'Lato-Bold', color: '#fff' }}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
    textRegular: { fontFamily: 'Lato-Regular' },
    textBold: { fontFamily: 'Lato-Bold' },
  
    container: { flex: 1, padding: 12 },
    drawerContainer: { flex: 1, padding: 12 },
    modeToggle: { flexDirection: 'row', justifyContent: 'center', marginBottom: 10 },
    toggleButton: { padding: 10, marginHorizontal: 5, backgroundColor: '#ccc', borderRadius: 8 },
    active: { backgroundColor: config.colors.primary },
  
    sectionTitle: {
      fontFamily: 'Lato-Bold',
      fontSize: 13,
      marginVertical: 8,
    },
    itemContainer: {
      alignItems: 'center',
      margin: 8,
      borderWidth: 1,
      borderColor: '#ddd',
      borderRadius: 8,
      padding: 5,
      // borderWidth:1
    },
    itemContainerDark: { borderColor: '#333' },
    itemSelected: { borderColor: config.colors.primary, borderWidth: 2 },
  
    itemImage: { width: 50, height: 50, borderRadius: 8 },
    itemImageSelected: { width: 25, height: 25, borderRadius: 8 },
    itemText: {
      fontFamily: 'Lato-Regular',
      fontSize: 12,
      // marginTop: 4,
    },
    savedItem: { alignItems: 'center', justifyContent:'center', marginRight: 5 , borderWidth:1, borderRadius:8, padding:5, flexDirection:'row'},
  
    removeText: {
      fontFamily: 'Lato-Bold',
      color: 'red',
      marginHorizontal:4
      // marginTop: 4,
    },
    placeholderText: {
      fontFamily: 'Lato-Regular',
      padding: 20,
      fontSize: 14,
    },
    infoText: {
      fontFamily: 'Lato-Regular',
    //   textAlign: 'center',
      fontSize: 13,
      marginBottom: 6,
    },
    grid: { paddingBottom: 100 },
  
    fab: {
      position: 'absolute',
      bottom: 10,
      right: 10,
      zIndex: 10,
    },
    closeButton: {
      marginTop: 20,
      alignSelf: 'center',
      backgroundColor: config.colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
    },
  });
  

export default NotifierDrawer;