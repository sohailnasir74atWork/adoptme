import { Platform, Linking } from 'react-native';
import SpInAppUpdates, { IAUUpdateKind } from 'sp-react-native-in-app-updates';

// Initialize updater for both platforms
const inAppUpdates = new SpInAppUpdates(
  false // isDebug: false for production behavior
);

const IOS_APP_ID = '6745400111';
const IOS_STORE_DEEPLINK = `itms-apps://itunes.apple.com/app/id${IOS_APP_ID}`;
const IOS_STORE_HTTP = `https://apps.apple.com/app/id${IOS_APP_ID}`;

export const checkForUpdate = async () => {
  // if (__DEV__) return;

  try {
    // ---------------------------------------------------------
    // Standard Store Check (Library)
    // ---------------------------------------------------------
    // Checks Play Store (Android) or App Store (iOS) directly.
    const result = await inAppUpdates.checkNeedsUpdate();

    if (result?.shouldUpdate) {
      console.log('Store update available:', result);

      if (Platform.OS === 'android') {
        // Android: Supports immediate/flexible in-app updates
        await inAppUpdates.startUpdate({ updateType: IAUUpdateKind.IMMEDIATE });
      } else if (Platform.OS === 'ios') {
        // iOS: Redirect to App Store
        try {
          // result.storeUrl often comes from the library, but we have a fallback
          await Linking.openURL(result.storeUrl || IOS_STORE_DEEPLINK);
        } catch {
          await Linking.openURL(IOS_STORE_HTTP);
        }
      }
    }

  } catch (err) {
    console.warn('Update check failed:', err?.message || err);
  }
};
