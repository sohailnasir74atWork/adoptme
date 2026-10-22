import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  StatusBar,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { navigationRef, trackCurrentScreen } from './Code/Helper/navigationService';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useGlobalState } from './Code/GlobelStats';
// Imported at the top on purpose: its launch clock is the cold-start ad budget.
import AppOpenAdManager from './Code/Ads/openApp';
import { markAdsReady } from './Code/Ads/adsGate';
import { ensureAdsInitialized, openConsentStep } from './Code/Ads/init';
import { installLeaveAppGuard } from './Code/Ads/leaveAppGuard';
import { useLocalState } from './Code/LocalGlobelStats';
import { AdsConsent } from 'react-native-google-mobile-ads';
import MainTabs from './Code/AppHelper/MainTabs';
import {
  MyDarkTheme,
  MyLightTheme,
} from './Code/AppHelper/AppHelperFunction';
import { noteReviewActiveDay } from './Code/AppHelper/reviewPrompt';
import { useTranslation } from 'react-i18next';

import RNBootSplash from "react-native-bootsplash";
import { requestTrackingPermission, getTrackingStatus } from 'react-native-tracking-transparency';
import { setThemedNavBar } from './Code/Helper/systemNavBar';
import Icon from 'react-native-vector-icons/Ionicons';
import DateOfBirthModal from './Code/AppHelper/DateOfBirthModal';
import AttPrimer from './Code/AppHelper/AttPrimer';
import EmailOptInGate from './Code/AppHelper/EmailOptInGate';
import { saveOwnPrivateProfile, getPrivateProfile } from './Code/Helper/privateProfile';
import { ref as dbRef, update as dbUpdate } from '@react-native-firebase/database';

// Heavy screens stay out of the eager-import graph and are loaded on first
// navigation via getComponent / inline require. Admin/analytics/leaderboard
// etc. are never visited by most users. Each one used to add to JS bundle parse time on every cold start.




// Module-level singleton for the ATT request. Native lib (0.1.2) can resolve
// its promise twice if the system dialog is interrupted by a scene transition;
// caching the in-flight promise + short-circuiting on already-determined
// statuses ensures requestTrackingPermission is reached at most once per
// app session, even if the caller is invoked multiple times.
let _attPromise = null;
async function ensureAttRequested(beforePrompt) {
  if (_attPromise) return _attPromise;
  _attPromise = (async () => {
    try {
      const status = await getTrackingStatus().catch(() => 'unavailable');
      if (status !== 'not-determined') return status;
      // First launch only: show our own priming screen explaining WHY we
      // ask before triggering Apple's one-shot system dialog. A higher
      // opt-in rate here directly lifts iOS eCPM (IDFA → personalised ads +
      // clean SKAdNetwork attribution). The primer is informational only,
      // so a failure/skip must never block the real prompt — hence the
      // swallow. beforePrompt resolves when the user taps "Continue".
      if (typeof beforePrompt === 'function') {
        try { await beforePrompt(); } catch {}
      }
      return await requestTrackingPermission();
    } catch {
      return 'unavailable';
    }
  })();
  return _attPromise;
}

const Stack = createNativeStackNavigator();

// Picker / share / sign-in / links: our own trips out never come back to an
// app-open ad (Code/Ads/leaveAppGuard.js).
installLeaveAppGuard();


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

  // ✅ DOB gate — mandatory for all logged-in users. Not while the login
  // reads are incomplete: the DOB may be on file and just not loaded yet, and
  // the profile reload (GlobelStats) clears the flag once it is.
  const showDobModal = !!user?.id && !user?.dateOfBirth && !user?.profileIncomplete;
  const handleDobSubmit = useCallback(async (dobString) => {
    if (!user?.id || !appdatabase) return;
    try {
      // users_private/{uid}, not the publicly readable users/{uid} (round 2).
      // The rules make it write-once: if a DOB is already on file (the login
      // read timed out, say) the write is refused and that one is kept.
      const saved = await saveOwnPrivateProfile(appdatabase, user.id, { dateOfBirth: dobString });
      let dob = saved ? dobString : (await getPrivateProfile(appdatabase, user.id)).dateOfBirth;
      if (!dob) {
        // users_private refused AND holds nothing — the rules for it aren't
        // live (app shipped before the server step) or the write failed. Never
        // leave the user stuck behind a gate with no way out: fall back to the
        // pre-round-2 location, which the owner can always write. The mirror
        // still gets it to Supabase for safe chat, and privatizeUserPII moves
        // it into users_private at cutover.
        await dbUpdate(dbRef(appdatabase, `users/${user.id}`), { dateOfBirth: dobString }).catch((e) => {
          console.error('Error saving DOB (fallback):', e);
        });
        dob = dobString;
      }
      setUser((prev) => ({ ...prev, dateOfBirth: dob }));
    } catch (err) {
      console.error('Error saving DOB:', err);
      // Same rule: an error must not trap the user behind the gate.
      setUser((prev) => ({ ...prev, dateOfBirth: dobString }));
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
  // ATT priming pre-prompt (iOS). The resolver ref lets the async consent
  // flow await the user tapping "Continue" before Apple's system dialog fires.
  const [attPrimerVisible, setAttPrimerVisible] = useState(false);
  const attPrimerResolveRef = React.useRef(null);


  // Deferred to idle so it doesn't compete with first paint. Ad SDK init and
  // the in-app-update RPC together used to block the JS thread for several
  // hundred ms during cold start.
  useEffect(() => {
    const id = requestIdleCallback(() => {
      try {
        const InterstitialAdManager = require('./Code/Ads/IntAd').default;
        const { checkForUpdate } = require('./Code/AppHelper/InAppUpdateChecker');
        InterstitialAdManager.init();
        // No rewarded preload here: it ran for every user (Pro included) on
        // every launch against a <1% show rate — 214K requests for 797
        // impressions in a month on iOS. The reward surfaces call
        // RewardedAdManager.prepare() on mount, which is early enough.
        checkForUpdate();
      } catch (_) {}
    });
    return () => cancelIdleCallback(id);
  }, []);



  // `theme` is already resolved to 'light' | 'dark' by GlobelStats, which owns
  // the Appearance listener and folds the 'system' preference in, so this just
  // follows it.
  useEffect(() => {
    setThemedNavBar(theme);
  }, [theme]);



  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#1E88E5" />
      </View>
    );
  }





  // Shows the ATT primer and resolves once the user taps "Continue", so the
  // consent flow can then trigger Apple's real tracking dialog.
  const showAttPrimer = useCallback(
    () => new Promise((resolve) => {
      attPrimerResolveRef.current = resolve;
      setAttPrimerVisible(true);
    }),
    [],
  );
  const handleAttPrimerContinue = useCallback(() => {
    setAttPrimerVisible(false);
    const resolve = attPrimerResolveRef.current;
    attPrimerResolveRef.current = null;
    if (resolve) resolve();
  }, []);

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
        await ensureAttRequested(showAttPrimer);
      }
      // ATT is settled (iOS): this session's UMP step may run now. Ad managers
      // that asked for init earlier (the app-open manager starts at JS load)
      // held their consent step for this, so UMP never comes before ATT
      // (Code/Ads/init.js).
      openConsentStep();

      // Gather UMP consent AND initialise the SDK through the single shared
      // choke point in Code/Ads/init.js. That helper runs, in order:
      //   gatherConsent() (writes the IAB TCF string for EEA/UK/CH users, via
      //   the UMP consent form when required) → setRequestConfiguration
      //   (maxAdContentRating 'T', child-treatment flag) → initialize().
      // Every ad manager awaits this SAME promise before it loads, so no ad is
      // ever requested before consent is resolved. Doing consent here — before
      // init — is what fixes AdMob's "Consent requirement: Low coverage": the
      // TC string now exists before the first (highest-value) EEA impression,
      // instead of the old order where initialize() and the ad loads raced the
      // consent form and the earliest requests went out with no TC string.
      // tagForUnderAgeOfConsent is intentionally NOT set: the UMP flow already
      // handles the under-16 case via the IAB TCF v2 string, so setting it
      // globally would suppress personalised ads for every user.
      await ensureAdsInitialized();

      // Record the resolved status for our own UI/analytics. getConsentInfo()
      // reflects the state left by gatherConsent() above (form completed, or
      // NOT_REQUIRED outside the EEA).
      try {
        const consentInfo = await AdsConsent.getConsentInfo();
        saveConsentStatus(consentInfo.status);
      } catch (_) {
        // Non-fatal — ads are already initialised regardless of this readback.
      }
    } catch (error) {
      // Silently handle consent errors
    } finally {
      // Never leave the consent step held, whatever failed above.
      openConsentStep();
      // Onboarding is over (App only mounts after it) and ATT → UMP have run,
      // including a consent form refreshed alongside init: open the gate that
      // the one-time notification permission ask waits on (Code/Ads/adsGate.js).
      try {
        const { whenConsentGathered } = require('./Code/Ads/init');
        whenConsentGathered().then(markAdsReady, markAdsReady);
      } catch (_) {
        markAdsReady();
      }
    }
  }, [saveConsentStatus, showAttPrimer]);

  // Store review: count active days here; the prompt itself is asked at
  // success moments (Code/AppHelper/reviewPrompt.js), never at launch.
  useEffect(() => {
    noteReviewActiveDay();
  }, []);

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
    <View style={{ flex: 1 }} onTouchStartCapture={AppOpenAdManager.noteUserTouch}>
      <NavigationContainer
        ref={navigationRef}
        theme={selectedTheme}
        onReady={trackCurrentScreen}
        onStateChange={trackCurrentScreen}
      >
        {/* Edge-to-edge: backgroundColor/translucent are ignored by the OS
            here, and forcing them conflicted with the window on some older
            devices (whole-screen shift). Only barStyle (icon color) is set;
            all spacing comes from useSafeAreaInsets on each screen. */}
        <StatusBar barStyle={theme === 'dark' ? 'light-content' : 'dark-content'} />

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

          <Stack.Screen name="Analytics" options={{ title: t('nav.market_analytics'), ...headerOptions }} getComponent={() => require('./Code/Analytics/AnalyticsScreen').default} />
          <Stack.Screen name="PetTracker" options={{ headerShown: false }} getComponent={() => require('./Code/PetTracker/PetTrackerScreen').default} />
          <Stack.Screen name="GrindDetail" options={{ headerShown: false }} getComponent={() => require('./Code/PetTracker/GrindDetailScreen').default} />
          <Stack.Screen name="MysteryEggScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/MysteryEgg').default} />
          <Stack.Screen name="MyCosmeticsScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/MyCosmeticsScreen').default} />
          <Stack.Screen name="GameHub" options={{ title: t('mini_games.title'), ...headerOptions }} getComponent={() => require('./Code/Engagement/GameHub').default} />
          <Stack.Screen name="ArrowGameScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/ArrowGameScreen').default} />
          <Stack.Screen name="QuizBattleScreen" options={{ title: t('mini_games.quiz_battle_name'), ...headerOptions }} getComponent={() => require('./Code/ValuesScreen/PetGuessingGame/QuizBattle').default} />
          <Stack.Screen name="TradeShowdownScreen" options={{ title: t('mini_games.trade_showdown_name'), ...headerOptions }} getComponent={() => require('./Code/ValuesScreen/PetGuessingGame/TradeShowdown').default} />
          <Stack.Screen name="BadgesScreen" options={{ headerShown: false }} getComponent={() => require('./Code/SettingScreen/BadgesScreen').default} />
          <Stack.Screen name="NotificationFeedScreen" options={{ title: t('settings.notifications'), ...headerOptions }} getComponent={() => require('./Code/Engagement/NotificationFeed').default} />
          <Stack.Screen name="SocialDashboardScreen" options={{ title: t('home_tab.action_friends'), ...headerOptions }} getComponent={() => require('./Code/AppHelper/SocialDashboard').default} />
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
          <Stack.Screen name="LeaderboardScreen" options={{ title: t('home_tab.action_leaderboard'), ...headerOptions }} getComponent={() => require('./Code/ChatScreen/GroupChat/LeaderboardScreen').default} />
          <Stack.Screen name="ModsScreen" options={{ headerShown: false }} getComponent={() => require('./Code/Engagement/ModsScreen').default} />
          <Stack.Screen name="TradeMatch" options={{ headerShown: false }} getComponent={() => require('./Code/TradeMatch/TradeMatchScreen').default} />
          <Stack.Screen name="Squad" options={{ headerShown: false }} getComponent={() => require('./Code/Squad/SquadScreen').default} />
          <Stack.Screen name="Elections" options={{ headerShown: false }} getComponent={() => require('./Code/Elections/ElectionsScreen').default} />
          {/* The Admin Dashboard lives in ChatNavigator; this root entry lets the
              Elections screen and profile drawers reach it (params: initialTab). */}
          <Stack.Screen name="AdminPanel" options={{ title: 'Admin Dashboard' }} getComponent={() => require('./Code/AppHelper/AdminDashboard').default} />
          <Stack.Screen name="PetCards" options={{ headerShown: false }} getComponent={() => require('./Code/PetCards/PetCardsScreen').default} />
          <Stack.Screen name="Birthdays" options={{ headerShown: false }} getComponent={() => require('./Code/Birthdays/BirthdaysScreen').default} />
          <Stack.Screen name="PackOpening" options={{ headerShown: false, animation: 'fade', gestureEnabled: false }} getComponent={() => require('./Code/PetCards/PackOpeningScreen').default} />
          <Stack.Screen name="CardAlbum" options={{ headerShown: false }} getComponent={() => require('./Code/PetCards/CardAlbumScreen').default} />
          <Stack.Screen name="CardWallpaper" options={{ headerShown: false }} getComponent={() => require('./Code/PetCards/CardWallpaper').default} />

          <Stack.Screen name="ValueScreen" options={{ title: t('home_tab.action_pet_values'), ...headerOptions }}>
            {renderValueScreen}
          </Stack.Screen>

          <Stack.Screen name="Setting" options={{ title: t('tabs.settings'), ...headerOptions }}>
            {renderSettings}
          </Stack.Screen>

          <Stack.Screen name="MyStuffScreen" options={{ title: t('home.my_stuff'), ...headerOptions }}>
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

      {/* Email news-and-updates opt-in: applies the sign-in checkbox, asks
          undecided users once, and backs the Settings switch. Waits for the
          DOB gate, which it relies on for the 13+ check, and for a complete
          profile (an unloaded DOB is not a missing one). */}
      <EmailOptInGate
        user={user}
        appdatabase={appdatabase}
        isDarkMode={theme === 'dark'}
        knownDob={user?.dateOfBirth || null}
        blocked={showDobModal || attPrimerVisible || !!user?.profileIncomplete}
      />

      {/* ATT priming pre-prompt (iOS) — shown once before Apple's system
          tracking dialog to lift opt-in, which lifts iOS eCPM. */}
      <AttPrimer
        visible={attPrimerVisible}
        onContinue={handleAttPrimerContinue}
        isDarkMode={theme === 'dark'}
      />
    </View>
  );
}

// The splash waits for login (isAppReady) but never longer than this from JS
// start: most logins take 0.2-2.5 s; a slower one lets the app open and the
// profile fill in behind it (GlobelStats reloads it, SigninDrawer never asks a
// signed-in player to sign in meanwhile).
const SPLASH_LOGIN_CAP_MS = 3000;
const JS_STARTED_AT = Date.now();

export default function AppWrapper() {
  const { localState, updateLocalState } = useLocalState();
  const { theme } = useGlobalState();

  // Launch App Open ad: decided once per launch. The splash no longer waits
  // for it; it shows when it loads, over the splash or Home, under the window
  // and no-touch rules in Code/Ads/openApp.js / adPolicy.js.
  const [splashCapReached, setSplashCapReached] = useState(false);
  const coldStartPrepared = useRef(false);
  useEffect(() => {
    if (!coldStartPrepared.current) {
      coldStartPrepared.current = true;
      if (localState.showOnBoardingScreen || localState.isPro) {
        AppOpenAdManager.skipColdStart();
      } else {
        AppOpenAdManager.prepareColdStart();
      }
    }
    if (localState.isPro) {
      // Pro bought mid-session (RevenueCat or squad Pro, both land in isPro):
      // drop the warm app-open and interstitial ads and their timers now, not
      // at the next launch.
      AppOpenAdManager.stop();
      require('./Code/Ads/IntAd').default.cleanup();
      return undefined;
    }
    if (localState.showOnBoardingScreen) return undefined;
    // Registers the AppState listener so the App Open ad shows on every
    // background→foreground return (capped + Pro-gated), not just once.
    // Returning users past onboarding were already started at JS load
    // (bottom of Code/Ads/openApp.js); this is a no-op for them.
    AppOpenAdManager.start();
    return undefined;
  }, [localState.isPro, localState.showOnBoardingScreen]);

  useEffect(() => {
    const id = setTimeout(() => setSplashCapReached(true),
      Math.max(0, JS_STARTED_AT + SPLASH_LOGIN_CAP_MS - Date.now()));
    return () => clearTimeout(id);
  }, []);

  // Hide the splash once login is done (or the cap passed). rAF, not
  // requestIdleCallback: an idle callback can be starved and leave the splash
  // stuck on screen. Once it has faded, Home is on screen, which starts the
  // launch ad's no-touch rule.
  useEffect(() => {
    if (localState.isAppReady || splashCapReached) {
      const raf = requestAnimationFrame(() => {
        Promise.resolve(RNBootSplash.hide({ fade: true }))
          .catch(() => {})
          .then(() => AppOpenAdManager.noteHomeVisible());
      });
      return () => cancelAnimationFrame(raf);
    }
    return undefined;
  }, [localState.isAppReady, splashCapReached]);

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