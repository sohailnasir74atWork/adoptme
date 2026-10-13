// themes.js
import { DefaultTheme, DarkTheme } from '@react-navigation/native';
import InAppReview from 'react-native-in-app-review';


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
    background: '#0f172a',
    text: 'white',
    primary: '#BB86FC',
  },
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
