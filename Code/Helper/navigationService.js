// navigationService.js — Global navigation ref for use outside NavigationContainer
import { createNavigationContainerRef } from '@react-navigation/native';
import { getCrashlytics, setAttribute, log as crashlyticsLog } from '@react-native-firebase/crashlytics';
import { getAnalytics, logEvent } from '@react-native-firebase/analytics';

export const navigationRef = createNavigationContainerRef();

// Screen names for crash reports (2026-10-05). Before this every Android crash
// breadcrumb said only "MainActivity", so the RN 0.87 Fabric addViewAt crash
// (~0.9% of users on 175) could not be tied to a screen. The screen_view event
// becomes a Crashlytics breadcrumb, the log line lands in the crash's logs, and
// the `screen` key shows where the app was at the moment it crashed.
let _lastScreen = null;
export function trackCurrentScreen() {
  const name = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : null;
  if (!name || name === _lastScreen) return;
  _lastScreen = name;
  try {
    const c = getCrashlytics();
    crashlyticsLog(c, `screen ${name}`);
    setAttribute(c, 'screen', name).catch(() => {});
  } catch (_) {}
  try {
    logEvent(getAnalytics(), 'screen_view', { screen_name: name, screen_class: name }).catch(() => {});
  } catch (_) {}
}

/** Navigate from outside a screen (the global game-invite banner). No-op until the navigator is ready. */
export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}

// Routes a push notification may open (data.route). Anything else is ignored.
// All are root-stack screens that open without params. ValueScreen is the
// values list, opened by the 'value-updates' topic push (values_update).
const PUSH_ROUTES = new Set(['TradeMatch', 'Squad', 'Elections', 'Birthdays', 'ValueScreen']);

/**
 * Open the screen a tapped notification points to. On a cold start the
 * navigator mounts after the tap is delivered, so retry for a few seconds.
 */
export function openPushRoute(route, tries = 0) {
  if (!PUSH_ROUTES.has(route)) return;
  if (navigationRef.isReady()) {
    navigationRef.navigate(route);
  } else if (tries < 20) {
    setTimeout(() => openPushRoute(route, tries + 1), 300);
  }
}
