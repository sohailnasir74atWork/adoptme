// themes.js
import { DefaultTheme, DarkTheme } from '@react-navigation/native';
import { AppOpenAd, AdEventType } from 'react-native-google-mobile-ads';
import InAppReview from 'react-native-in-app-review';
import { AdsConsent, AdsConsentStatus } from 'react-native-google-mobile-ads';


export const MyLightTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#f2f2f7',
    text: 'black',
    primary: '#3E8BFC',
  },
};

export const MyDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#121212',
    text: 'white',
    primary: '#BB86FC',
  },
};


// adHelper.js

export const initializeAds = async () => {
  await mobileAds().initialize();
};


export const loadAppOpenAd = async (
  adUnitId,
  lastAdShownTime,
  adCooldown,
  setLastAdShownTime,
  setIsAdLoaded,
  isPro
) => {
  if (isPro) return; // Return immediately if the user is Pro

  const now = Date.now();
  if (now - lastAdShownTime < adCooldown) return; // Ensure cooldown is respected

  try {
    const appOpenAd = AppOpenAd.createForAdRequest(adUnitId);

    appOpenAd.addAdEventListener(AdEventType.LOADED, () => {
      setIsAdLoaded(true); // Mark ad as loaded
      appOpenAd.show();
      setLastAdShownTime(Date.now());
      setIsAdLoaded(false); // Reset ad loaded state
    });

    appOpenAd.addAdEventListener(AdEventType.ERROR, (error) => {
      // console.error('Ad Error:', error);
      setIsAdLoaded(false);
    });

    await appOpenAd.load(); // Load the ad
  } catch (error) {
    // console.error('Error loading App Open Ad:', error);
    setIsAdLoaded(false);
  }
};


// reviewHelper.js

// ✅ Rate limiting: Track last review request time
let lastReviewRequestTime = 0;
const REVIEW_COOLDOWN = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
let isReviewInProgress = false;

export const requestReview = () => {
  // ✅ Prevent multiple simultaneous calls
  if (isReviewInProgress) {
    return;
  }

  // ✅ Rate limiting: Don't request review more than once per 24 hours
  const now = Date.now();
  if (now - lastReviewRequestTime < REVIEW_COOLDOWN) {
    return;
  }

  // ✅ Check availability and handle errors properly
  try {
    if (!InAppReview.isAvailable()) {
      return;
    }

    isReviewInProgress = true;
    lastReviewRequestTime = now;

    InAppReview.RequestInAppReview()
      .then(() => {
        // Success - review flow completed
        isReviewInProgress = false;
      })
      .catch((error) => {
        // ✅ Silently handle errors to prevent crashes
        // Don't log errors that might spam the console
        isReviewInProgress = false;
        // Reset lastReviewRequestTime on error so user can try again later
        lastReviewRequestTime = 0;
      });
  } catch (error) {
    // ✅ Catch any synchronous errors
    isReviewInProgress = false;
    lastReviewRequestTime = 0;
  }
};


// consentHelper.js

export const handleUserConsent = async (setConsentStatus, setLoading) => {
  try {
    const consentInfo = await AdsConsent.requestInfoUpdate();
    if (consentInfo.isConsentFormAvailable) {
      if (consentInfo.status === AdsConsentStatus.REQUIRED) {
        const formResult = await AdsConsent.showForm();
        setConsentStatus(formResult.status);
      } else {
        setConsentStatus(consentInfo.status);
      }
    }
  } catch (error) {
    // console.error('Error handling consent:', error);
  } finally {
    setLoading(false);
  }
};
