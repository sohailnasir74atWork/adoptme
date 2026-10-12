/**
 * valueUpdatesTopic.js — the "Value Update Notifications" setting.
 *
 * The values publisher (DataFetching/adoptme) sends ONE FCM message to the
 * topic `value-updates` whenever trading values change (data.type
 * 'values_update', data.route 'ValueScreen'). Topic membership belongs to the
 * device's FCM token, so guests get these too, unlike chat pushes, which need
 * a signed-in user's users/{uid}/fcmToken.
 *
 * The setting is localState.valueUpdateNotifications (MMKV, default ON).
 * syncValueUpdatesTopic() makes the device's membership match it, once per
 * launch (FrontendNotificationHandling) and whenever the Settings switch flips.
 *
 * Every (un)subscribe is a network call, so the last result is kept in MMKV
 * (`valueUpdatesTopicSync`: { on, token, at }) and the call is skipped while
 * the setting and the FCM token still match and the record is under a week
 * old. A new token (reinstall, rotation) has no topics, hence the token
 * check; the weekly redo also undoes a server-side bulk subscribe for a device
 * whose setting is off. Nothing here throws: a failure leaves no record, so
 * the next launch tries again.
 *
 * Membership alone shows nothing without OS notification permission (iOS,
 * Android 13+), and nothing else asks a guest for it, so
 * scheduleValueUpdatesPermissionAsk() asks once per install: after onboarding
 * and the ATT → UMP consent prompts (whenAdsReady, Ads/adsGate.js), 3 s later,
 * and never over a full-screen ad.
 */
import { Platform } from 'react-native';
import {
  getMessaging,
  getToken,
  getAPNSToken,
  subscribeToTopic,
  unsubscribeFromTopic,
} from '@react-native-firebase/messaging';
import notifee, { AuthorizationStatus } from '@notifee/react-native';
import { whenAdsReady } from '../Ads/adsGate';
import { isFullScreenAdVisible } from '../Ads/adVisibility';

export const VALUE_UPDATES_TOPIC = 'value-updates';
// The localState / MMKV key Settings writes through updateLocalState.
export const VALUE_UPDATES_SETTING_KEY = 'valueUpdateNotifications';
// MMKV boolean: the one-time startup permission ask has happened.
export const PERMISSION_ASKED_KEY = 'valueUpdatesPermissionAsked';
const SYNC_KEY = 'valueUpdatesTopicSync';
const RESYNC_MS = 7 * 24 * 60 * 60 * 1000;
const CALL_TIMEOUT_MS = 20000;
const APNS_TRIES = 5;
const APNS_WAIT_MS = 2000;
const PERMISSION_ASK_DELAY_MS = 3000;
const AD_CHECK_MS = 2000;
const AD_CHECK_TRIES = 60;

let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Android queues a topic operation while offline, so its promise can hang.
const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('value-updates topic call timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export const isValueUpdatesEnabled = () => {
  try {
    return storage?.getBoolean(VALUE_UPDATES_SETTING_KEY) ?? true;
  } catch (_) {
    return true;
  }
};

const readSync = () => {
  try {
    const raw = storage?.getString(SYNC_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};

const writeSync = (value) => {
  try {
    if (value) storage?.set(SYNC_KEY, JSON.stringify(value));
    else storage?.remove(SYNC_KEY);
  } catch (_) {}
};

// iOS: FCM needs the APNs token before it can mint a token or join a topic.
// firebase.json leaves messaging_ios_auto_register_for_remote_messages at its
// default (on), so RNFB registers the device at launch; like
// registerForNotifications in Globelhelper.js, this only waits for the APNs
// token. No permission prompt: registration does not need one.
const apnsReady = async (messaging) => {
  if (Platform.OS !== 'ios') return true;
  for (let i = 0; i < APNS_TRIES; i += 1) {
    try {
      if (await getAPNSToken(messaging)) return true;
    } catch (_) {}
    await sleep(APNS_WAIT_MS);
  }
  return false;
};

const doSync = async (on, force) => {
  try {
    const messaging = getMessaging();
    if (!(await apnsReady(messaging))) return false;
    const token = await withTimeout(getToken(messaging), CALL_TIMEOUT_MS);
    if (!token) return false;

    const last = readSync();
    if (
      !force &&
      last &&
      last.on === on &&
      last.token === token &&
      Date.now() - (Number(last.at) || 0) < RESYNC_MS
    ) {
      return true;
    }

    // Unknown state until the call succeeds: a timed-out call may still land
    // later, so never leave a record that could skip the next attempt.
    writeSync(null);
    await withTimeout(
      on
        ? subscribeToTopic(messaging, VALUE_UPDATES_TOPIC)
        : unsubscribeFromTopic(messaging, VALUE_UPDATES_TOPIC),
      CALL_TIMEOUT_MS,
    );
    writeSync({ on, token, at: Date.now() });
    return true;
  } catch (_) {
    return false;
  }
};

// Calls run one at a time, so quick on/off flips land in order.
let queue = Promise.resolve(true);

/**
 * Subscribe or unsubscribe this device to match the setting. `enabled`
 * defaults to the stored setting; `force` skips the "already synced" check
 * (used when the user flips the switch). Resolves to true when the device is
 * known to match; never rejects.
 */
export const syncValueUpdatesTopic = (enabled = isValueUpdatesEnabled(), { force = false } = {}) => {
  queue = queue.then(() => doSync(enabled !== false, force)).catch(() => false);
  return queue;
};

/**
 * Ask for OS notification permission at most once per install. Skipped while
 * the setting is off (the flag stays unset, so it can still happen later).
 * The flag is written before anything else so a crash or a quick relaunch can
 * never ask twice. notifee, not messaging().requestPermission(), which does
 * nothing on Android. Never throws.
 */
export const askPermissionOnce = async () => {
  try {
    if (!isValueUpdatesEnabled() || storage?.getBoolean(PERMISSION_ASKED_KEY)) return;
    storage?.set(PERMISSION_ASKED_KEY, true);
    const { authorizationStatus } = await notifee.getNotificationSettings();
    if (
      authorizationStatus === AuthorizationStatus.AUTHORIZED ||
      authorizationStatus === AuthorizationStatus.PROVISIONAL
    ) {
      return;
    }
    await notifee.requestPermission();
  } catch (_) {}
};

let permissionAskScheduled = false;

/**
 * Call once at app start (FrontendNotificationHandling). Waits for the
 * onboarding + consent gate, which stays pending through a first-launch
 * onboarding rather than skipping it, then 3 s, then for any full-screen ad
 * to close. If an ad is still up after ~2 minutes it leaves the ask for the
 * next launch. Fire-and-forget; never throws.
 */
export const scheduleValueUpdatesPermissionAsk = () => {
  if (permissionAskScheduled) return;
  permissionAskScheduled = true;
  whenAdsReady()
    .then(() => sleep(PERMISSION_ASK_DELAY_MS))
    .then(async () => {
      for (let i = 0; isFullScreenAdVisible(); i += 1) {
        if (i >= AD_CHECK_TRIES) return;
        await sleep(AD_CHECK_MS);
      }
      await askPermissionOnce();
    })
    .catch(() => {});
};
