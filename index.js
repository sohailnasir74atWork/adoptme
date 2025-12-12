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
import { LanguageProvider } from './Code/Translation/LanguageProvider';

// 🔁 MODULAR Firebase Messaging imports
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';

import FlashMessage from 'react-native-flash-message';

// 🔇 (optional) silence modular deprecation warnings globally
// globalThis.RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;

// 🚀 Lazy load Notification Handler for better startup performance
const NotificationHandler = lazy(() =>
  import('./Code/Firebase/FrontendNotificationHandling'),
);

// ✅ Create a messaging instance (default Firebase app)
const messaging = getMessaging();

// ✅ Background Notification Handler (modular API)
setBackgroundMessageHandler(messaging, async remoteMessage => {
  // handle background notification (optional)
  // console.log('📩 Background message:', remoteMessage);
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
    <LanguageProvider>
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
        </GlobalStateProvider>
      </LocalStateProvider>
    </LanguageProvider>
  </MenuProvider>
));

// ✅ Register the app entry point
AppRegistry.registerComponent(appName, () => App);
