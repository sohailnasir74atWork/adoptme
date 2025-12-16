import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StatusBar,
  SafeAreaView,
  Animated,
  ActivityIndicator,
  AppState,
  Appearance,
  InteractionManager,
  TouchableOpacity,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from './Code/SettingScreen/Setting';
import { useGlobalState } from './Code/GlobelStats';
import { useLocalState } from './Code/LocalGlobelStats';
import { AdsConsent, AdsConsentStatus, MobileAds } from 'react-native-google-mobile-ads';
import MainTabs from './Code/AppHelper/MainTabs';
import {
  MyDarkTheme,
  MyLightTheme,
  requestReview,
} from './Code/AppHelper/AppHelperFunction';
import OnboardingScreen from './Code/AppHelper/OnBoardingScreen';
import { useTranslation } from 'react-i18next';
// import RewardCenterScreen from './Code/SettingScreen/RewardCenter';
// import RewardRulesModal from './Code/SettingScreen/RewardRulesModel';
import InterstitialAdManager from './Code/Ads/IntAd';
import AppOpenAdManager from './Code/Ads/openApp';
import RNBootSplash from "react-native-bootsplash";
import SystemNavigationBar from 'react-native-system-navigation-bar';
import { checkForUpdate } from './Code/AppHelper/InAppUpdateChecker';
import AdminUnbanScreen from './Code/AppHelper/AdminDashboard';
import Icon from 'react-native-vector-icons/Ionicons';
import SubscriptionScreen from './Code/SettingScreen/OfferWall';




const Stack = createNativeStackNavigator();
const setNavigationBarAppearance = (theme) => {
  if (theme === 'dark') {
    SystemNavigationBar.setNavigationColor('#000000', 'light', 'navigation');
  } else {
    SystemNavigationBar.setNavigationColor('#FFFFFF', 'dark', 'navigation');
  }
};

// const adUnitId = getAdUnitId('openapp');

function App() {
  const { theme, single_offer_wall } = useGlobalState();
  const { t } = useTranslation();
  const { localState, updateLocalState } = useLocalState();

  // ✅ Fixed: Use ref to prevent infinite loop when updating warnedAboutTheme
  const warnedAboutThemeRef = React.useRef(false);
  const selectedTheme = useMemo(() => {
    if (!theme && !warnedAboutThemeRef.current && !localState?.warnedAboutTheme) {
      warnedAboutThemeRef.current = true;
      updateLocalState('warnedAboutTheme', true);
    }
    return theme === 'dark' ? MyDarkTheme : MyLightTheme;
  }, [theme, localState?.warnedAboutTheme]); // ✅ Removed updateLocalState from deps
  const [chatFocused, setChatFocused] = useState(true);
  const [modalVisibleChatinfo, setModalVisibleChatinfo] = useState(false)
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [showofferwall, setShowofferwall] = useState(false);


  useEffect(() => {
    InterstitialAdManager.init();
    checkForUpdate()
  }, []);



  useEffect(() => {
    const listener = Appearance.addChangeListener(({ colorScheme }) => {
      if (theme === 'system') {
        setNavigationBarAppearance(colorScheme);
      }
    });

    return () => listener.remove();
  }, [theme]);

  // useEffect(() => {
  //   const askPermission = async () => {
  //     const status = await requestTrackingPermission();
  //     console.log('Tracking status:', status); // authorized, denied, etc.
  //   };
  
  //   if (Platform.OS === 'ios') {
  //     askPermission();
  //   }
  // }, []);
  // useEffect(() => {
  //   let isMounted = true;
  //   let unsubscribe;

  //   const initializeAds = async () => {
  //     try {
  //       await AppOpenAdManager.init();
  //     } catch (error) {
  //       console.error('❌ Error initializing ads:', error);
  //     }
  //   };

  //   const handleAppStateChange = async (state) => {
  //     if (!isMounted) return;

  //     try {
  //       if (state === 'active' && !localState?.isPro) {
  //         await AppOpenAdManager.showAd();
  //       }
  //     } catch (error) {
  //       console.error('❌ Error showing ad:', error);
  //     }
  //   };

  //   initializeAds();
  //   unsubscribe = AppState.addEventListener('change', handleAppStateChange);

  //   return () => {
  //     isMounted = false;
  //     if (unsubscribe) {
  //       unsubscribe.remove();
  //     }
  //     AppOpenAdManager.cleanup();
  //   };
  // }, [localState?.isPro]);



  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1E88E5" />
      </View>
    );
  }





  // ✅ Memoize saveConsentStatus to prevent recreation
  const saveConsentStatus = useCallback((status) => {
    updateLocalState('consentStatus', status);
  }, [updateLocalState]);

  // ✅ Memoize handleUserConsent to prevent recreation
  const handleUserConsent = useCallback(async () => {
    try {
      const consentInfo = await AdsConsent.requestInfoUpdate();
      await MobileAds().initialize();  

  
      if (
        consentInfo.status === AdsConsentStatus.OBTAINED ||
        consentInfo.status === AdsConsentStatus.NOT_REQUIRED
      ) {
        saveConsentStatus(consentInfo.status);
        return;
      }
  
      if (consentInfo.isConsentFormAvailable && consentInfo.isRequestLocationInEeaOrUnknown) {
        const formResult = await AdsConsent.showForm();
        saveConsentStatus(formResult.status);
      }
    } catch (error) {
      // Silently handle consent errors
    }
  }, [saveConsentStatus]);

  // ✅ Fixed: Use ref to track if reviewCount was updated to prevent infinite loop
  const reviewCountUpdatedRef = React.useRef(false);
  useEffect(() => {
    // ✅ Only update reviewCount once on mount, not on every reviewCount change
    if (!reviewCountUpdatedRef.current) {
      const { reviewCount } = localState || {};
      if (reviewCount !== undefined) {
        reviewCountUpdatedRef.current = true;
        updateLocalState('reviewCount', Number(reviewCount) + 1);
      }
    }
  }, []); // ✅ Empty deps - only run once on mount

  // ✅ Separate useEffect for review request - only runs when reviewCount changes
  useEffect(() => {
    const { reviewCount } = localState || {};
    if (reviewCount && reviewCount % 6 === 0 && reviewCount > 0) {
      try {
        requestReview();
      } catch (error) {
        // ✅ Silently handle errors to prevent crashes
      }
    }
  }, [localState?.reviewCount]); // ✅ Only depend on reviewCount, not updateLocalState

  // Handle Consent
  useEffect(() => {
    handleUserConsent();
  }, [handleUserConsent]);



  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: selectedTheme.colors.background, }}>
      <Animated.View style={{ flex: 1 }}>
        <NavigationContainer theme={selectedTheme}>
          <StatusBar
            barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
            backgroundColor={selectedTheme.colors.background}
          />

          <Stack.Navigator>
            <Stack.Screen name="Home" options={{ headerShown: false }}>
              {() => <MainTabs selectedTheme={selectedTheme} setChatFocused={setChatFocused} chatFocused={chatFocused} setModalVisibleChatinfo={setModalVisibleChatinfo} modalVisibleChatinfo={modalVisibleChatinfo} />}
            </Stack.Screen>
            <Stack.Screen
              name="Admin"
              options={{
                title: "Admin Dashboard",
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
                headerRight: () => (
                  <TouchableOpacity onPress={() => setModalVisible(true)} style={{ marginRight: 16 }}>
                    <Icon name="information-circle-outline" size={24} color={selectedTheme.colors.text} />
                  </TouchableOpacity>
                ),
              }}
            >
              {() => <AdminUnbanScreen selectedTheme={selectedTheme} />}
            </Stack.Screen>

            {/* Move this outside of <Stack.Navigator> */}


            <Stack.Screen
              name="Setting"
              options={{
                title: t('tabs.settings'),
                headerStyle: { backgroundColor: selectedTheme.colors.background },
                headerTintColor: selectedTheme.colors.text,
              }}
            >
              {() => <SettingsScreen selectedTheme={selectedTheme} />}
            </Stack.Screen>
          </Stack.Navigator>
          
        </NavigationContainer>
        {/* RewardRulesModal commented out - uncomment if needed */}
        {/* {modalVisible && (
          <RewardRulesModal visible={modalVisible} onClose={() => setModalVisible(false)} selectedTheme={selectedTheme} />
        )} */}
          <SubscriptionScreen visible={showofferwall} onClose={() => setShowofferwall(false)} track='Home' showoffer={!single_offer_wall}   oneWallOnly={single_offer_wall}/>
      </Animated.View>
    </SafeAreaView>
  );
}

export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
  const { theme } = useGlobalState();
  useEffect(() => {
    if (localState.isAppReady) {
      InteractionManager.runAfterInteractions(() => {
        RNBootSplash.hide({ fade: true });
      });
    }
  }, [localState.isAppReady]);
  useEffect(() => {
    if (!localState.showOnBoardingScreen) 
   { (!localState.isPro) && AppOpenAdManager.initAndShow();}
  }, [localState.isPro]);

  const selectedTheme = useMemo(() => {
    if (!theme) {
      // console.warn("⚠️ Theme not found! Falling back to Light Theme.");
    }
    return theme === 'dark' ? MyDarkTheme : MyLightTheme;
  }, [theme]);

  // ✅ Memoize handleSplashFinish to prevent recreation
  const handleSplashFinish = useCallback(() => {
    updateLocalState('showOnBoardingScreen', false);
  }, [updateLocalState]);

  if (localState.showOnBoardingScreen) {
    return <OnboardingScreen onFinish={handleSplashFinish} selectedTheme={selectedTheme} />;
  }

  return <App />
}