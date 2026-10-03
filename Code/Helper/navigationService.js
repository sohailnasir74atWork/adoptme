// navigationService.js — Global navigation ref for use outside NavigationContainer
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

/** Navigate from outside a screen (the global game-invite banner). No-op until the navigator is ready. */
export function navigate(name, params) {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name, params);
  }
}

// Routes a push notification may open (data.route). Anything else is ignored.
const PUSH_ROUTES = new Set(['TradeMatch', 'Squad', 'Elections']);

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
