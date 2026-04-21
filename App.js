import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  StatusBar,
  ActivityIndicator,
  Appearance,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { navigationRef } from './Code/Helper/navigationService';
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

import InterstitialAdManager from './Code/Ads/IntAd';
import RewardedAdManager from './Code/Ads/RewardedAdManager';
import AppOpenAdManager from './Code/Ads/openApp';
import RNBootSplash from "react-native-bootsplash";
import { requestTrackingPermission } from 'react-native-tracking-transparency';
import SystemNavigationBar from 'react-native-system-navigation-bar';
import { checkForUpdate } from './Code/AppHelper/InAppUpdateChecker';
import AdminUnbanScreen from './Code/AppHelper/AdminDashboard';
import Icon from 'react-native-vector-icons/Ionicons';
import SubscriptionScreen from './Code/SettingScreen/OfferWall';
import AnalyticsScreen from './Code/Analytics/AnalyticsScreen';
import GameHub from './Code/Engagement/GameHub';
import QuizBattle from './Code/ValuesScreen/PetGuessingGame/QuizBattle';
import TradeShowdown from './Code/ValuesScreen/PetGuessingGame/TradeShowdown';
import MysteryEggScreen from './Code/Engagement/MysteryEgg';
import MyCosmeticsScreen from './Code/Engagement/MyCosmeticsScreen';
import ArrowGameScreen from './Code/Engagement/ArrowGameScreen';
import ValueScreen from './Code/ValuesScreen/ValueScreen';
import LeaderboardScreen from './Code/ChatScreen/GroupChat/LeaderboardScreen';
import SocialDashboard from './Code/AppHelper/SocialDashboard';
import BadgesScreen from './Code/SettingScreen/BadgesScreen';
import TradeJournal from './Code/Engagement/TradeJournal';
import ModsScreen from './Code/Engagement/ModsScreen';
import DateOfBirthModal from './Code/AppHelper/DateOfBirthModal';
import { ref as dbRef, update as dbUpdate } from '@react-native-firebase/database';
import NotificationFeed from './Code/Engagement/NotificationFeed';
import PrivateChatScreen from './Code/ChatScreen/PrivateChat/PrivateChat';
import PrivateChatHeader from './Code/ChatScreen/PrivateChat/PrivateChatHeader';




const Stack = createNativeStackNavigator();
const setNavigationBarAppearance = (theme) => {
  if (theme === 'dark') {
    SystemNavigationBar.setNavigationColor('#0f172a', 'light', 'navigation');
  } else {
    SystemNavigationBar.setNavigationColor('#FFFFFF', 'dark', 'navigation');
  }
};

// Wrapper for PrivateChat used from root stack (SocialDashboard → Chat)
// Manages its own drawer state since it's outside ChatNavigator
const PrivateChatRootWrapper = (props) => {
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  return (
    <PrivateChatScreen
      {...props}
      bannedUsers={[]}
      isDrawerVisible={isDrawerVisible}
      setIsDrawerVisible={setIsDrawerVisible}
      noTabBar={true}
    />
  );
};

function App() {
  const { theme, single_offer_wall, firestoreDB, appdatabase, user, setUser } = useGlobalState();
  const { t } = useTranslation();
  const { localState, updateLocalState } = useLocalState();

  // ✅ DOB gate — mandatory for all logged-in users
  const showDobModal = !!user?.id && !user?.dateOfBirth;
  const handleDobSubmit = useCallback(async (dobString) => {
    if (!user?.id || !appdatabase) return;
    try {
      await dbUpdate(dbRef(appdatabase, `users/${user.id}`), { dateOfBirth: dobString });
      setUser((prev) => ({ ...prev, dateOfBirth: dobString }));
    } catch (err) {
      console.error('Error saving DOB:', err);
    }
  }, [user?.id, appdatabase, setUser]);

  // ✅ PERF: Shared header style objects — avoid recreating on every render
  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: theme === 'dark' ? '#0f172a' : '#fff' },
    headerTintColor: theme === 'dark' ? '#f1f5f9' : '#1a1a2e',
    headerTitleStyle: { fontWeight: 'bold' },
    animation: 'fade',
    animationDuration: 200,
  }), [theme]);

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
    RewardedAdManager.init();
    checkForUpdate()
  }, []);



  useEffect(() => {
    // Set nav bar color on initial load
    setNavigationBarAppearance(theme === 'dark' ? 'dark' : theme === 'system' ? Appearance.getColorScheme() : 'light');

    const listener = Appearance.addChangeListener(({ colorScheme }) => {
      if (theme === 'system') {
        setNavigationBarAppearance(colorScheme);
      }
    });

    return () => listener.remove();
  }, [theme]);



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
      // Request ATT permission on iOS before initializing ads
      if (Platform.OS === 'ios') {
        await requestTrackingPermission();
      }

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

  // ✅ PERF: Memoize screen render functions to prevent remounting
  const renderMainTabs = useCallback(() => (
    <MainTabs
      selectedTheme={selectedTheme}
      setChatFocused={setChatFocused}
      chatFocused={chatFocused}
      setModalVisibleChatinfo={setModalVisibleChatinfo}
      modalVisibleChatinfo={modalVisibleChatinfo}
    />
  ), [selectedTheme, chatFocused, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo]);

  const renderGameHub = useCallback(({ navigation }) => <GameHub navigation={navigation} />, []);
  const renderValueScreen = useCallback(() => <ValueScreen selectedTheme={selectedTheme} />, [selectedTheme]);
  const renderSettings = useCallback(() => <SettingsScreen selectedTheme={selectedTheme} />, [selectedTheme]);
  const renderMyStuff = useCallback(() => (
    <TradeJournal
      firestoreDB={firestoreDB}
      db={appdatabase}
      uid={user?.id}
      isDarkMode={theme === 'dark'}
    />
  ), [firestoreDB, appdatabase, user?.id, theme]);

  const handleCloseOfferwall = useCallback(() => setShowofferwall(false), []);

  return (
    <View style={{ flex: 1 }}>
      <NavigationContainer ref={navigationRef} theme={selectedTheme}>
        <StatusBar
          barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
          translucent={true}
          backgroundColor="transparent"
        />

        <Stack.Navigator screenOptions={headerOptions}>
          <Stack.Screen name="MainTabs" options={{ headerShown: false }}>
            {renderMainTabs}
          </Stack.Screen>

          <Stack.Screen
            name="Admin"
            options={{
              title: 'Admin Dashboard',
              ...headerOptions,
              headerRight: () => (
                <TouchableOpacity onPress={() => setModalVisible(true)} style={{ marginRight: 16 }}>
                  <Icon name="information-circle-outline" size={24} color={headerOptions.headerTintColor} />
                </TouchableOpacity>
              ),
            }}
            component={AdminUnbanScreen}
          />

          <Stack.Screen name="Analytics" options={{ title: 'Market Analytics', ...headerOptions }} component={AnalyticsScreen} />
          <Stack.Screen name="QuizBattleScreen" options={{ title: 'Quiz Battle', ...headerOptions }} component={QuizBattle} />
          <Stack.Screen name="TradeShowdownScreen" options={{ title: 'Trade Showdown', ...headerOptions }} component={TradeShowdown} />
          <Stack.Screen name="MysteryEggScreen" options={{ headerShown: false }} component={MysteryEggScreen} />
          <Stack.Screen name="MyCosmeticsScreen" options={{ headerShown: false }} component={MyCosmeticsScreen} />
          <Stack.Screen name="ArrowGameScreen" options={{ headerShown: false }} component={ArrowGameScreen} />
          <Stack.Screen name="BadgesScreen" options={{ headerShown: false }} component={BadgesScreen} />
          <Stack.Screen name="NotificationFeedScreen" options={{ title: 'Notifications', ...headerOptions }} component={NotificationFeed} />
          <Stack.Screen name="SocialDashboardScreen" options={{ title: 'Friends', ...headerOptions }} component={SocialDashboard} />
          <Stack.Screen
            name="PrivateChatRoot"
            options={({ route }) => ({
              headerTitle: () => (
                <PrivateChatHeader
                  selectedUser={route.params?.selectedUser}
                  selectedTheme={selectedTheme}
                  bannedUsers={[]}
                  isDrawerVisible={route.params?._drawerVisible || false}
                  setIsDrawerVisible={(v) => {}}
                />
              ),
              ...headerOptions,
            })}
          >
            {(props) => <PrivateChatRootWrapper {...props} />}
          </Stack.Screen>
          <Stack.Screen name="LeaderboardScreen" options={{ title: 'Top Traders', ...headerOptions }} component={LeaderboardScreen} />
          <Stack.Screen name="ModsScreen" options={{ headerShown: false }} component={ModsScreen} />

          <Stack.Screen name="GameHub" options={{ title: 'Game Hub', ...headerOptions }}>
            {renderGameHub}
          </Stack.Screen>

          <Stack.Screen name="ValueScreen" options={{ title: 'Pet Values', ...headerOptions }}>
            {renderValueScreen}
          </Stack.Screen>

          <Stack.Screen name="Setting" options={{ title: t('tabs.settings'), ...headerOptions }}>
            {renderSettings}
          </Stack.Screen>

          <Stack.Screen name="MyStuffScreen" options={{ title: 'My Stuff', ...headerOptions }}>
            {renderMyStuff}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>

      {showofferwall && <SubscriptionScreen visible={showofferwall} onClose={handleCloseOfferwall} track='Home' showoffer={!single_offer_wall} oneWallOnly={single_offer_wall} />}

      {/* DOB gate — blocks app until user provides date of birth */}
      <DateOfBirthModal
        visible={showDobModal}
        onSubmit={handleDobSubmit}
        isDarkMode={theme === 'dark'}
      />
    </View>
  );
}

export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
  const { theme } = useGlobalState();
  useEffect(() => {
    if (localState.isAppReady) {
      const id = requestIdleCallback(() => {
        RNBootSplash.hide({ fade: true });
      });
      return () => cancelIdleCallback(id);
    }
  }, [localState.isAppReady]);
  useEffect(() => {
    if (!localState.showOnBoardingScreen) { (!localState.isPro) && AppOpenAdManager.initAndShow(); }
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