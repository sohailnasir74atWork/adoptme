import { AppState, Platform, Linking } from 'react-native';
import SpInAppUpdates, { IAUUpdateKind, IAUInstallStatus } from 'sp-react-native-in-app-updates';
import { createMMKV } from 'react-native-mmkv';

// Initialize updater for both platforms
const inAppUpdates = new SpInAppUpdates(
  false // isDebug: false for production behavior
);

const IOS_APP_ID = '6745400111';
const IOS_STORE_DEEPLINK = `itms-apps://itunes.apple.com/app/id${IOS_APP_ID}`;
const IOS_STORE_HTTP = `https://apps.apple.com/app/id${IOS_APP_ID}`;

// How often one store version is pushed at the user. Before this cap the
// check ran on every cold start, so for the days between a release going
// live and the user updating, iOS players were sent to the App Store on
// every launch and Android players got Play's blocking IMMEDIATE flow each
// time. One nudge a day per version keeps the update visible without
// hijacking every launch; a genuinely forced update belongs behind a remote
// minimum-version flag, not here.
const NUDGE_MIN_GAP_MS = 24 * 60 * 60 * 1000;
const K_NUDGE_AT = 'updateNudgeAt';
const K_NUDGE_VERSION = 'updateNudgeVersion';

let storage = null;
try { storage = createMMKV(); } catch (_) {}

const nudgedRecently = (storeVersion) => {
  try {
    const lastVersion = storage?.getString(K_NUDGE_VERSION) || '';
    const lastAt = storage?.getNumber(K_NUDGE_AT) || 0;
    return lastVersion === storeVersion && Date.now() - lastAt < NUDGE_MIN_GAP_MS;
  } catch (_) {
    return false;
  }
};

const markNudged = (storeVersion) => {
  try {
    storage?.set(K_NUDGE_VERSION, storeVersion);
    storage?.set(K_NUDGE_AT, Date.now());
  } catch (_) {}
};

// Android FLEXIBLE updates download while the user keeps using the app. The
// install is an app restart, so it is applied only once the app is in the
// background, where Play performs it silently.
let installListenerArmed = false;
const armFlexibleInstall = () => {
  if (installListenerArmed) return;
  installListenerArmed = true;
  let downloaded = false;
  const installWhenHidden = () => {
    if (!downloaded || AppState.currentState !== 'background') return;
    downloaded = false;
    try { inAppUpdates.installUpdate(); } catch (_) {}
  };
  inAppUpdates.addStatusUpdateListener((event) => {
    if (event?.status === IAUInstallStatus.DOWNLOADED) {
      downloaded = true;
      installWhenHidden();
    }
  });
  AppState.addEventListener('change', installWhenHidden);
};

export const checkForUpdate = async () => {
  try {
    // Checks Play Store (Android) or App Store (iOS) directly.
    const result = await inAppUpdates.checkNeedsUpdate();
    if (!result?.shouldUpdate) return;

    const storeVersion = String(result.storeVersion || 'unknown');
    if (nudgedRecently(storeVersion)) return;
    markNudged(storeVersion);

    if (Platform.OS === 'android') {
      armFlexibleInstall();
      await inAppUpdates.startUpdate({ updateType: IAUUpdateKind.FLEXIBLE });
    } else if (Platform.OS === 'ios') {
      // iOS has no in-app update flow: open the store listing.
      try {
        await Linking.openURL(result.storeUrl || IOS_STORE_DEEPLINK);
      } catch {
        await Linking.openURL(IOS_STORE_HTTP);
      }
    }
  } catch (err) {
    console.warn('Update check failed:', err?.message || err);
  }
};
