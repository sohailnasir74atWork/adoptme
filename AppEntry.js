// Foreground React tree. Loaded lazily by index.js so background FCM wake-ups
// don't pay the cost of parsing the full app bundle (was ANR-ing
// MainApplication.onCreate on slow devices).

import React from 'react';
import { Text, Platform, StatusBar } from 'react-native';
import { getCrashlytics, recordError, log as crashlyticsLog } from '@react-native-firebase/crashlytics';
import AppWrapper from './App';
import { GlobalStateProvider } from './Code/GlobelStats';
import { LocalStateProvider } from './Code/LocalGlobelStats';
import { MenuProvider } from 'react-native-popup-menu';
import i18n from './i18n';

import FlashMessage from 'react-native-flash-message';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const NotificationHandler = React.lazy(() =>
  import('./Code/Firebase/FrontendNotificationHandling'),
);
const SquadBootstrap = React.lazy(() => import('./Code/Squad/SquadBootstrap'));

const STATUS_BAR_HEIGHT =
  Platform.OS === 'android' ? StatusBar.currentHeight || 18 : 44;

const crashlyticsInstance = getCrashlytics();

class ErrorBoundary extends React.Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('Caught in ErrorBoundary:', error, info);
    try {
      recordError(crashlyticsInstance, error);
      crashlyticsLog(crashlyticsInstance, `ErrorBoundary: ${info?.componentStack || 'no stack'}`);
    } catch (_) {}
  }

  render() {
    return this.state.hasError ? (
      <Text>{i18n.t('misc.app_crashed')}</Text>
    ) : (
      this.props.children
    );
  }
}

const App = React.memo(() => (
  <SafeAreaProvider>
    <MenuProvider skipInstanceCheck>
      <LocalStateProvider>
        <GlobalStateProvider>
          <ErrorBoundary>
            <AppWrapper />
          </ErrorBoundary>

          <FlashMessage
            position="top"
            floating
            statusBarHeight={STATUS_BAR_HEIGHT}
          />

          <React.Suspense fallback={null}>
            <NotificationHandler />
            <SquadBootstrap />
          </React.Suspense>
        </GlobalStateProvider>
      </LocalStateProvider>
    </MenuProvider>
  </SafeAreaProvider>
));

export default App;
