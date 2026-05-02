// Polyfill global URL / URLSearchParams before anything else. Supabase
// Realtime opens its WebSocket from a module loaded later, and on iOS the
// missing polyfill causes the socket to silently fail to upgrade — messages
// appear only on reload. Keep this as the first line.
import 'react-native-url-polyfill/auto';

// Enable native screens before any react-native-screens code runs.
import { enableScreens } from 'react-native-screens';
enableScreens();

import { AppRegistry } from 'react-native';
import { getCrashlytics, recordError, log as crashlyticsLog } from '@react-native-firebase/crashlytics';
import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';
import { createMMKV } from 'react-native-mmkv';
import { name as appName } from './app.json';

// Background-only essentials live at module top-level. Everything React-tree
// related (providers, screens, i18n, FlashMessage) is in AppEntry.js, loaded
// lazily by AppRegistry only when the foreground UI actually starts. This
// keeps the FCM headless wake-up under the 5s broadcast-receiver budget that
// used to ANR MainApplication.onCreate (top crash issue, 248 reports).

const messaging = getMessaging();
const storage = createMMKV();
const crashlyticsInstance = getCrashlytics();

const safeParseJSON = (key, defaultValue) => {
  try {
    const value = storage.getString(key);
    return value ? JSON.parse(value) : defaultValue;
  } catch {
    return defaultValue;
  }
};

setBackgroundMessageHandler(messaging, async (remoteMessage) => {
  try {
    const senderId = remoteMessage?.data?.senderId;
    if (!senderId) return;
    const bannedUsers = safeParseJSON('bannedUsers', []);
    if (Array.isArray(bannedUsers) && bannedUsers.includes(senderId)) {
      return;
    }
  } catch (_) {}
});

const originalHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  try {
    recordError(crashlyticsInstance, error);
    crashlyticsLog(crashlyticsInstance, `Global error | Fatal: ${isFatal} | ${error?.message || error}`);
  } catch (_) {}
  originalHandler(error, isFatal);
});

// Lazy-require defers parsing AppEntry.js (and its full screen graph + i18n
// + GlobalState/LocalState providers) until the foreground component is
// actually instantiated. Headless background tasks never trigger this.
AppRegistry.registerComponent(appName, () => require('./AppEntry').default);
