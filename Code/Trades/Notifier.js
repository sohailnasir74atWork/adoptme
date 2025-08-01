// NotifierDrawer.js
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, Image, StyleSheet, ScrollView, Modal, ToastAndroid, Platform, Alert } from 'react-native';
import { ref, onValue, remove, set } from '@react-native-firebase/database';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import Icon from 'react-native-vector-icons/Ionicons';
import InterstitialAdManager from '../Ads/IntAd';
import { requestPermission } from '../Helper/PermissionCheck';
import { showMessage } from 'react-native-flash-message';

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

  const getImageUrl = (item) => {
    if (!item || !item.name) return '';
    const encoded = encodeURIComponent(item.name);
    if (localState.isGG) {
      return `${localState.imgurlGG?.replace(/"/g, '')}/items/${encoded}.webp`;
    }
    return `${localState.imgurl?.replace(/"/g, '')}/${item.image?.replace(/^\/+/, '')}`;
};

  // const showMessage = (msg) => {
  //   if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
  //   else Alert.alert('Info', msg);
  // };

  useEffect(() => {
    if (!user?.id) return;
    const buyRef = ref(appdatabase, `/notifier/buy/${user.id}`);
    const saleRef = ref(appdatabase, `/notifier/sale/${user.id}`);

    const buyListener = onValue(buyRef, snap => {
      setSavedItems(prev => ({ ...prev, buy: snap.val() || {} }));
    });
    const saleListener = onValue(saleRef, snap => {
      setSavedItems(prev => ({ ...prev, sale: snap.val() || {} }));
    });

    return () => {
      buyListener();
      saleListener();
    };
  }, [user?.id]);

  const subtitleText =
  mode === 'buy'
    ? "Select items you want to buy. You'll be notified when someone is offering them."
    : "Select items you want to sell. You'll be notified when someone is looking for them.";
    const buttonText =
    mode === 'buy'
      ? "Notify me when offered"
      : "Notify me when wanted";
  

  const handleSelect =  (item) => {
   
  
    if (!item?.name) return;
    const key = item.name.replace(/[^a-zA-Z0-9]/g, '_');
    const itemRef = ref(appdatabase, `/notifier/${mode}/${user.id}/${key}`);
    set(itemRef, {
      name: item.name,
      image: item.image || '',
    });
    showMessage({
      message: `${item.name} added to ${mode.toUpperCase()}`,
      type: 'success',
      duration: 2500,
    });
  };

  const handleRemove = (key) => {
    if (!user?.id) return;
  
    const proceedToRemove = () => {
      const itemRef = ref(appdatabase, `/notifier/${mode}/${user.id}/${key}`);
      remove(itemRef);
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
    const key = item.name.replace(/[^a-zA-Z0-9]/g, '_');
    const isSelected = !!savedItems[mode]?.[key];
    return (
      <TouchableOpacity
        style={[styles.itemContainer, isSelected && styles.itemSelected, isDarkMode && styles.itemContainerDark]}
        onPress={() => handleSelect(item)}>
        <Image
          source={{ uri: getImageUrl(item) }}
          style={styles.itemImage}
        />
        <Text style={[styles.itemText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#fff' : '#000' }]}>{item.name}</Text>
      </TouchableOpacity>
    );
  };

  const renderSavedItem = ([key, data]) => (
    <View style={styles.savedItem} key={key}>
      <Image source={{ uri: getImageUrl(data) }} style={styles.itemImageSelected} />
      <Text style={[styles.itemText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#fff' : '#000', marginLeft:5 }]}>{data.name}</Text>
      <TouchableOpacity onPress={() => handleRemove(key)}>
      <Icon name="close-circle" size={20} color="red" style={styles.removeText} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: isDarkMode ? '#121212' : '#fff' }]}>
        {/* <Text style={[styles.infoText, { fontFamily: 'Lato-Regular', color: isDarkMode ? '#aaa' : '#666' }]}>
        Select items you want to buy or sell — we’ll notify you when someone is offering them or looking for them in a trade.
</Text> */}

      <TouchableOpacity style={styles.fab} onPress={openDrawerToSelect}>
        <Icon name="add-circle" size={44} color="#FF6666" />
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
            keyExtractor={(item) => item.name}
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
    active: { backgroundColor: '#FF6666' },
  
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
    itemSelected: { borderColor: '#FF6666', borderWidth: 2 },
  
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
      backgroundColor: '#FF6666',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 8,
    },
  });
  

export default NotifierDrawer;