// firebaseHelpers.js

import { Platform } from 'react-native';

// ✅ Modular Cloud Messaging API
import {
  getMessaging,
  requestPermission,
  getAPNSToken,
  getToken,
  AuthorizationStatus,
} from '@react-native-firebase/messaging';

// ✅ Modular Realtime Database API
import {
  getDatabase,
  ref,
  get,
  set,
} from '@react-native-firebase/database';

import { generateOnePieceUsername } from './Helper/RendomNamegen';

// ✅ Modular Database usage
export const saveTokenToDatabase = async (token, currentUserId) => {
  if (!currentUserId || !token) {
    // console.warn('⚠️ Invalid inputs: Cannot save FCM token.');
    return;
  }

  // ✅ Validate user ID - must be non-empty string without invalid Firebase path characters
  const userIdStr = String(currentUserId).trim();
  if (!userIdStr || /[.#$\[\]]/.test(userIdStr)) {
    console.warn('⚠️ Invalid user ID format. Cannot save FCM token.');
    return;
  }

  try {
    const db = getDatabase();

    const tokenRef = ref(db, `users/${userIdStr}/fcmToken`);
    const invalidTokenRef = ref(db, `users/${userIdStr}/isTokenInvalid`);

    // optional timeout guard
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('🔥 Firebase timeout while fetching token')),
        5000,
      ),
    );

    // `once('value')` → modular `get(reference)`
    const tokenSnapshot = await Promise.race([
      get(tokenRef),
      timeoutPromise,
    ]);

    const currentToken = tokenSnapshot.exists()
      ? tokenSnapshot.val()
      : null;

    // same token already stored → nothing to do
    if (currentToken === token) {
      return;
    }

    // `.set()` → modular `set(ref, value)`
    await Promise.all([
      set(tokenRef, token),
      set(invalidTokenRef, false),
    ]);
  } catch (error) {
    // console.warn('🔥 Error saving FCM token:', error?.message || error);
  }
};

export const registerForNotifications = async (
  currentUserId,
  retryCount = 0,
  maxRetries = 3,
) => {
  // ✅ Validate user ID - must be non-empty string without invalid Firebase path characters
  const userIdStr = currentUserId ? String(currentUserId).trim() : '';
  if (!userIdStr || /[.#$\[\]]/.test(userIdStr)) {
    // console.warn('⚠️ Invalid user ID format. Cannot register for notifications.');
    return;
  }

  try {
    // ✅ Modular Messaging instance
    const messagingInstance = getMessaging();

    // ✅ requestPermission(messagingInstance)
    const authStatus = await requestPermission(messagingInstance);

    const isAuthorized =
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL;

    if (!isAuthorized) {
      // console.warn('🚫 Notification permissions not granted.');
      return;
    }

    // iOS: make sure APNs token exists first
    if (Platform.OS === 'ios') {
      // ✅ modular getAPNSToken(messagingInstance)
      const apnsToken = await getAPNSToken(messagingInstance);

      if (!apnsToken) {
        // console.warn('⚠️ APNS token not available yet.');
        if (retryCount < maxRetries) {
          setTimeout(
            () =>
              registerForNotifications(
                currentUserId,
                retryCount + 1,
                maxRetries,
              ),
            1500,
          );
        }
        return;
      }
    }

    // ✅ modular getToken(messagingInstance)
    const fcmToken = await getToken(messagingInstance);
    // console.log('📡 FCM token:', fcmToken);

    if (!fcmToken) {
      // console.warn('❌ Failed to fetch FCM token (null/undefined).');
      if (retryCount < maxRetries) {
        setTimeout(
          () =>
            registerForNotifications(
              userIdStr,
              retryCount + 1,
              maxRetries,
            ),
          1500,
        );
      }
      return;
    }

    await saveTokenToDatabase(fcmToken, userIdStr);
  } catch (error) {
    console.warn(
      '🔥 Error registering for notifications:',
      error?.message || error,
    );
    if (retryCount < maxRetries) {
      setTimeout(
        () =>
          registerForNotifications(
            currentUserId,
            retryCount + 1,
            maxRetries,
          ),
        1500,
      );
    }
  }
};

// 🧍 New user shape in Realtime DB
export const createNewUser = (
  userId,
  loggedInUser = {},
  robloxUsername,
) => ({
  id: userId,
  displayName:
    robloxUsername ||
    loggedInUser.displayName ||
    generateOnePieceUsername() ||
    'Anonymous',
  avatar:
    loggedInUser.photoURL ||
    'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
  isBlock: false,
  fcmToken: null,
  lastactivity: null,
  online: false,
  isPro: false,
  email: loggedInUser.email || null,
  decodedEmail: loggedInUser.email ? loggedInUser.email.replace(/\./g, '(dot)') : null,
});

export const resetUserState = (setUser) => {
  setUser({
    id: null,
    displayName: '',
    avatar: null,
    isBlock: false,
    fcmToken: null,
    lastactivity: null,
    online: false,
    isPro: false,
  });
};
