// 🏆 Optimize performance by enabling screens before any imports
import { enableScreens } from 'react-native-screens';
enableScreens();

import React, { useEffect, lazy, Suspense } from 'react';
import { AppRegistry, Text, Platform, StatusBar } from 'react-native';
import AppWrapper from './App';
import { name as appName } from './app.json';
import { GlobalStateProvider } from './Code/GlobelStats';
import { LocalStateProvider } from './Code/LocalGlobelStats';
import { MenuProvider } from 'react-native-popup-menu';
import './i18n'; // ✅ Initialize i18next BEFORE any components that use useTranslation

// 🔁 MODULAR Firebase Messaging imports
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import { MMKV } from 'react-native-mmkv';

import FlashMessage from 'react-native-flash-message';

// 🔇 (optional) silence modular deprecation warnings globally
// globalThis.RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;

// 🚀 Lazy load Notification Handler for better startup performance
const NotificationHandler = lazy(() =>
  import('./Code/Firebase/FrontendNotificationHandling'),
);

// 🎮 Lazy load Global Invite Toast for game invites
const GlobalInviteToast = lazy(() =>
  import('./Code/ValuesScreen/PetGuessingGame/components/GlobalInviteToast'),
);

// ✅ Create a messaging instance (default Firebase app)
const messaging = getMessaging();

// ✅ Create MMKV storage instance for background access
const storage = new MMKV();

// ✅ Helper function to safely parse JSON from storage
const safeParseJSON = (key, defaultValue) => {
  try {
    const value = storage.getString(key);
    return value ? JSON.parse(value) : defaultValue;
  } catch (error) {
    return defaultValue;
  }
};

// ✅ Background Notification Handler (modular API)
// Filters out notifications from blocked users even when app is closed
setBackgroundMessageHandler(messaging, async remoteMessage => {
  try {
    if (!remoteMessage) {
      return; // No message, nothing to process
    }

    const { notification, data } = remoteMessage || {};
    const senderId = data?.senderId;

    // ✅ Filter out notifications from blocked users (client-side only)
    if (senderId) {
      // Read bannedUsers directly from MMKV storage (works in background)
      const bannedUsers = safeParseJSON('bannedUsers', []);

      if (Array.isArray(bannedUsers) && bannedUsers.includes(senderId)) {
        // User is blocked - don't show notification
        // console.log('[Background] Sender is banned, skipping notification:', senderId);
        return; // Return early to prevent notification display
      }
    }

    // If not blocked, notification will be shown by the OS
    // Note: We can't prevent OS-level notifications completely in background,
    // but this handler prevents processing, which helps with some notification types
    // console.log('[Background] Notification allowed:', senderId);
  } catch (error) {
    // Silently handle errors to prevent crashes
    // console.error('[Background] Error processing notification:', error);
  }
});

// 🧠 Calculate StatusBar height (Android vs iOS)
const STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight || 18 : 44;

// 🛑 Error Boundary
class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Caught in ErrorBoundary:', error, info);
  }

  render() {
    return this.state.hasError ? (
      <Text>Something went wrong.</Text>
    ) : (
      this.props.children
    );
  }
}

// ✅ Memoized App component to prevent unnecessary re-renders
const App = React.memo(() => (
  <MenuProvider skipInstanceCheck>
    <LocalStateProvider>
      <GlobalStateProvider>
        <ErrorBoundary>
          <AppWrapper />
        </ErrorBoundary>

        {/* ✅ Flash Message below status bar */}
        <FlashMessage
          position="top"
          floating
          statusBarHeight={STATUS_BAR_HEIGHT}
        />

        {/* Lazy loaded Notification Handler */}
        <Suspense fallback={null}>
          <NotificationHandler />
        </Suspense>

        {/* 🎮 Global Invite Toast - Shows on any screen */}
        <Suspense fallback={null}>
          <GlobalInviteToast />
        </Suspense>
      </GlobalStateProvider>
    </LocalStateProvider>
  </MenuProvider>
));

// ✅ Register the app entry point
AppRegistry.registerComponent(appName, () => App);
