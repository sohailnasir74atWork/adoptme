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
import { navigationRef } from './Code/Helper/navigationService';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useGlobalState } from './Code/GlobelStats';
import { useLocalState } from './Code/LocalGlobelStats';
import { AdsConsent, AdsConsentStatus, MaxAdContentRating, MobileAds } from 'react-native-google-mobile-ads';
import MainTabs from './Code/AppHelper/MainTabs';
import {
  MyDarkTheme,
  MyLightTheme,
  requestReview,
} from './Code/AppHelper/AppHelperFunction';
import { useTranslation } from 'react-i18next';

import RNBootSplash from "react-native-bootsplash";
import { requestTrackingPermission, getTrackingStatus } from 'react-native-tracking-transparency';
import SystemNavigationBar from 'react-native-system-navigation-bar';
import Icon from 'react-native-vector-icons/Ionicons';
import DateOfBirthModal from './Code/AppHelper/DateOfBirthModal';
import { ref as dbRef, update as dbUpdate } from '@react-native-firebase/database';

// Heavy screens stay out of the eager-import graph and are loaded on first
// navigation via getComponent / inline require. ArrowGameScreen alone is
// 2300+ lines; admin/analytics/leaderboard etc. are never visited by most
// users. Each one used to add to JS bundle parse time on every cold start.




// Module-level singleton for the ATT request. Native lib (0.1.2) can resolve
// its promise twice if the system dialog is interrupted by a scene transition;
// caching the in-flight promise + short-circuiting on already-determined
// statuses ensures requestTrackingPermission is reached at most once per
// app session, even if the caller is invoked multiple times.
let _attPromise = null;
async function ensureAttRequested() {
  if (_attPromise) return _attPromise;
  _attPromise = (async () => {
    try {
      const status = await getTrackingStatus().catch(() => 'unavailable');
      if (status !== 'not-determined') return status;
      return await requestTrackingPermission();
    } catch {
      return 'unavailable';
    }
  })();
  return _attPromise;
}

const Stack = createNativeStackNavigator();
const setNavigationBarAppearance = (theme) => {
  if (theme === 'dark') {
    SystemNavigationBar.setNavigationColor('#0f172a', 'light', 'navigation');
  } else {
    SystemNavigationBar.setNavigationColor('#FFFFFF', 'dark', 'navigation');
  }
};

// Wrapper for PrivateChat used from root stack (SocialDashboard → Chat)
// Manages its own drawer state since it's outside ChatNavigator.
// PrivateChat is required lazily so its bundle isn't parsed until first nav.
const PrivateChatRootWrapper = (props) => {
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const PrivateChatScreen = require('./Code/ChatScreen/PrivateChat/PrivateChat').default;
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


  // Deferred to idle so it doesn't compete with first paint. Ad SDK init and
  // the in-app-update RPC together used to block the JS thread for several
  // hundred ms during cold start.
  useEffect(() => {
    const id = requestIdleCallback(() => {
      try {
        const InterstitialAdManager = require('./Code/Ads/IntAd').default;
        const RewardedAdManager = require('./Code/Ads/RewardedAdManager').default;
        const { checkForUpdate } = require('./Code/AppHelper/InAppUpdateChecker');
        InterstitialAdManager.init();
        RewardedAdManager.init();
        checkForUpdate();
      } catch (_) {}
    });
    return () => cancelIdleCallback(id);
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
      // Request ATT once per app session. Guard: skip if status is already
      // determined (avoids triggering the prompt on every effect re-run), and
      // share an in-flight promise so concurrent callers can't hit the library's
      // known double-resolve bug when the system dialog is interrupted by a
      // scene transition / app backgrounding.
      if (Platform.OS === 'ios') {
        await ensureAttRequested();
      }

      const consentInfo = await AdsConsent.requestInfoUpdate();

      // Set request config BEFORE initialize() so the first ad request
      // already respects it. maxAdContentRating='T' opens up Teen-rated
      // inventory (game installs, teen-friendly brands) that AdMob's
      // default 'G' ceiling silently locks out — matches our Play Console
      // 13+ target audience. tagForChildDirectedTreatment=false confirms
      // this is NOT a kids-app build, which avoids the conservative kids
      // pricing AdMob applies when treatment is left unspecified.
      // tagForUnderAgeOfConsent is intentionally NOT set: the EEA consent
      // flow (AdsConsent above) already handles the under-16 case via the
      // IAB TCF v2 string, so setting it globally here would suppress
      // personalized ads for every user, not just under-age-of-consent ones.
      await MobileAds().setRequestConfiguration({
        maxAdContentRating: MaxAdContentRating.T,
        tagForChildDirectedTreatment: false,
      });
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

  // Consent + ATT flow runs on idle. Ads can't show until this finishes
  // anyway, and pushing it off the critical path frees first paint.
  useEffect(() => {
    const id = requestIdleCallback(() => { handleUserConsent(); });
    return () => cancelIdleCallback(id);
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

  const renderGameHub = useCallback(({ navigation }) => {
    const GameHub = require('./Code/Engagement/GameHub').default;
    return <GameHub navigation={navigation} />;
  }, []);
  const renderValueScreen = useCallback(() => {
    const ValueScreen = require('./Code/ValuesScreen/ValueScreen').default;
    return <ValueScreen selectedTheme={selectedTheme} />;
  }, [selectedTheme]);
  const renderSettings = useCallback(() => {
    const SettingsScreen = require('./Code/SettingScreen/Setting').default;
    return <SettingsScreen selectedTheme={selectedTheme} />;
  }, [selectedTheme]);
  const renderMyStuff = useCallback(() => {
    const TradeJournal = require('./Code/Engagement/TradeJournal').default;
    return (
      <TradeJournal
        firestoreDB={firestoreDB}
        db={appdatabase}
        uid={user?.id}
        isDarkMode={theme === 'dark'}
      />
    );
  }, [firestoreDB, appdatabase, user?.id, theme]);

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
            getComponent={() => require('./Code/AppHelper/AdminDashboard').default}
          />

          <Stack.Screen name="Analytics" options={{ title: 'Market Analytics', ...headerOptions }} getComponent={() => require('./Code/Analytics/AnalyticsScreen').default} />
          <Stack.Screen name="QuizBattleScreen" options={{ title: 'Quiz Battle', ...headerOptions }} getComponent={() => require('./Code/ValuesScreen/PetGuessingGame/QuizBattle').default} />
          <Stack.Screen name="TradeShowdownScreen" options={{ title: 'Trade Showdown', ...headerOptions }} getComponent={() => require('./Code/ValuesScreen/PetGuessingGame/TradeShowdown').default} />
          <Stack.Screen name="MysteryEggScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/MysteryEgg').default} />
          <Stack.Screen name="MyCosmeticsScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/MyCosmeticsScreen').default} />
          <Stack.Screen name="ArrowGameScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/ArrowGameScreen').default} />
          <Stack.Screen name="BadgesScreen" options={{ headerShown: false }} getComponent={() => require('./Code/SettingScreen/BadgesScreen').default} />
          <Stack.Screen name="NotificationFeedScreen" options={{ title: 'Notifications', ...headerOptions }} getComponent={() => require('./Code/Engagement/NotificationFeed').default} />
          <Stack.Screen name="SocialDashboardScreen" options={{ title: 'Friends', ...headerOptions }} getComponent={() => require('./Code/AppHelper/SocialDashboard').default} />
          <Stack.Screen
            name="PrivateChatRoot"
            options={({ route }) => ({
              headerTitle: () => {
                const PrivateChatHeader = require('./Code/ChatScreen/PrivateChat/PrivateChatHeader').default;
                return (
                  <PrivateChatHeader
                    selectedUser={route.params?.selectedUser}
                    selectedTheme={selectedTheme}
                    bannedUsers={[]}
                    isDrawerVisible={route.params?._drawerVisible || false}
                    setIsDrawerVisible={() => {}}
                  />
                );
              },
              ...headerOptions,
            })}
          >
            {(props) => <PrivateChatRootWrapper {...props} />}
          </Stack.Screen>
          <Stack.Screen name="LeaderboardScreen" options={{ title: 'Leaderboard', ...headerOptions }} getComponent={() => require('./Code/ChatScreen/GroupChat/LeaderboardScreen').default} />
          <Stack.Screen name="ModsScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/ModsScreen').default} />

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

      {showofferwall && (() => {
        const SubscriptionScreen = require('./Code/SettingScreen/OfferWall').default;
        return <SubscriptionScreen visible={showofferwall} onClose={handleCloseOfferwall} track='Home' showoffer={!single_offer_wall} oneWallOnly={single_offer_wall} />;
      })()}

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
    if (!localState.showOnBoardingScreen && !localState.isPro) {
      const id = requestIdleCallback(() => {
        try {
          const AppOpenAdManager = require('./Code/Ads/openApp').default;
          AppOpenAdManager.initAndShow();
        } catch (_) {}
      });
      return () => cancelIdleCallback(id);
    }
  }, [localState.isPro, localState.showOnBoardingScreen]);

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
    const OnboardingScreen = require('./Code/AppHelper/OnBoardingScreen').default;
    return <OnboardingScreen onFinish={handleSplashFinish} selectedTheme={selectedTheme} />;
  }

  return <App />
}