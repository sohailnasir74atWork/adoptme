// PayWall.js
// All paywall *display* goes through OfferWall.jsx (custom). This file only
// keeps the offerings cache used to preload pricing on app start.
import Purchases from 'react-native-purchases';

let cachedOfferings = null;

export const preloadOfferings = async () => {
  try {
    const offerings = await Purchases.getOfferings();
    if (offerings?.all) {
      cachedOfferings = offerings.all;
    }
  } catch (e) {
    // Silent fail — will fetch on demand as fallback
  }
};

export const getCachedOfferings = () => cachedOfferings;
