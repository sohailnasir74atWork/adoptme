import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';

import Purchases from 'react-native-purchases';
import config from './Helper/Environment';
import { useTranslation } from 'react-i18next';
import { mixpanel } from './AppHelper/MixPenel';
import { showErrorMessage, showSuccessMessage } from './Helper/MessageHelper';
import { preloadOfferings } from './SettingScreen/PayWall';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (e) {
  console.warn('[LocalGlobelStats] MMKV not available:', e.message);
  storage = {
    getString: () => undefined,
    getBoolean: () => undefined,
    set: () => {},
    delete: () => {},
    clearAll: () => {},
  };
}
const LocalStateContext = createContext();

export const useLocalState = () => useContext(LocalStateContext);

export const LocalStateProvider = ({ children }) => {
  // Initial local state
  const safeParseJSON = (key, defaultValue) => {
    try {
      const value = storage.getString(key);
      return value ? JSON.parse(value) : defaultValue;
    } catch (error) {
      // console.error(`🚨 JSON Parse Error for key "${key}":`, error);
      return defaultValue; // Return a safe fallback value
    }
  };

  const [localState, setLocalState] = useState(() => ({
    localKey: storage.getString('localKey') || 'defaultValue',
    reviewCount: Number(storage.getString('reviewCount')) || 0,
    lastVersion: storage.getString('lastVersion') || 'UNKNOWN',
    updateCount: Number(storage.getString('updateCount')) || 0,
    featuredCount: safeParseJSON('featuredCount', { count: 0, time: null }),
    isHaptic: storage.getBoolean('isHaptic') ?? true,
    theme: storage.getString('theme') || 'system',
    consentStatus: storage.getString('consentStatus') || 'UNKNOWN',
    isPro: storage.getBoolean('isPro') ?? false,
    fetchDataTime: storage.getString('fetchDataTime') || null,
    data: null, // Loaded async to avoid blocking cold start

    codes: safeParseJSON('codes', {}),
    normalStock: safeParseJSON('normalStock', []),
    bannedUsers: safeParseJSON('bannedUsers', []),
    mirageStock: safeParseJSON('mirageStock', []),
    prenormalStock: safeParseJSON('prenormalStock', []),
    premirageStock: safeParseJSON('premirageStock', []),
    isAppReady: storage.getBoolean('isAppReady') ?? false,
    lastActivity: storage.getString('lastActivity') || null,
    showOnBoardingScreen: storage.getBoolean('showOnBoardingScreen') ?? true,
    user_name: storage.getString('user_name') || 'Anonymous',
    translationUsage: safeParseJSON('translationUsage', { count: 0, date: new Date().toDateString() }),
    favorites: safeParseJSON('favorites', []),
    imgurl: storage.getString('imgurl') || 'https://elvebredd.com',
    showAd1: storage.getBoolean('showAd1') ?? true,
    postsCache: safeParseJSON('postsCache', []),
    tradingServerLink: storage.getString('tradingServerLink') || null,
    lastServerFetch: storage.getString('lastServerFetch') || null,
    showFlag: storage.getBoolean('showFlag') ?? true, // ✅ Default true (show flag), user can hide to save data
    showOnlineStatus: storage.getBoolean('showOnlineStatus') ?? true, // ✅ Default true (show online), user can hide to save Firebase costs
    showReadReceipts: storage.getBoolean('showReadReceipts') ?? true, // ✅ Default true (show read ticks), user can toggle off/on
    gameMusicEnabled: storage.getBoolean('gameMusicEnabled') ?? true, // ✅ Default true (music on), user can toggle off/on

  }));


  // RevenueCat states
  const [customerId, setCustomerId] = useState(null);
  // const [isPro, setIsPro] = useState(true); // Sync with MMKV storage
  const [packages, setPackages] = useState([]);
  const [mySubscriptions, setMySubscriptions] = useState([]);
  const { t } = useTranslation();


  // ✅ System theme changes are handled by GlobelStats.js (resolvedTheme)
  // No listener needed here — storing 'system' in MMKV is correct,
  // GlobelStats resolves it to 'light'/'dark' at render time

  // ✅ PERF: Load heavy pet data asynchronously after interactions to avoid blocking cold start
  const dataLoadedRef = useRef(false);
  useEffect(() => {
    const id = requestIdleCallback(() => {
      try {
        const raw = storage.getString('data');
        const parsed = raw ? JSON.parse(raw) : {};
        dataLoadedRef.current = true;
        setLocalState(prev => ({ ...prev, data: parsed }));
      } catch (e) {
        dataLoadedRef.current = true;
        setLocalState(prev => ({ ...prev, data: {} }));
      }
    });
    return () => cancelIdleCallback(id);
  }, []);

  // ✅ PERF: Serialize data to MMKV off the main thread using setTimeout
  useEffect(() => {
    if (!dataLoadedRef.current || !localState.data) return;
    const timeoutId = setTimeout(() => {
      try {
        storage.set('data', JSON.stringify(localState.data));
      } catch (e) {
        // Silently handle serialization errors
      }
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [localState.data]);

  // console.log(localState.isPro)
  // ✅ Memoize updateLocalState to prevent recreation on every render
  const updateLocalState = useCallback((key, value) => {
    setLocalState((prevState) => ({
      ...prevState,
      [key]: value,
    }));

    // Save to MMKV storage
    if (typeof value === 'string') {
      storage.set(key, value);
    } else if (typeof value === 'number') {
      storage.set(key, value.toString());
    } else if (typeof value === 'boolean') {
      storage.set(key, value);
    } else if (typeof value === 'object') {
      storage.set(key, JSON.stringify(value)); // ✅ Store objects/arrays as JSON
    } else {
      // console.error('🚨 MMKV supports only string, number, boolean, or JSON stringified objects.');
    }
  }, []); // ✅ Empty deps - function is stable, doesn't depend on any props/state
  const canTranslate = useCallback(() => {
    const today = new Date().toDateString();
    const { count, date } = localState.translationUsage || { count: 0, date: today };

    if (date !== today) {
      // Reset count for new day
      const newUsage = { count: 0, date: today };
      updateLocalState('translationUsage', newUsage);
      return true;
    }

    return count < 20;
  }, [localState.translationUsage, updateLocalState]);

  // ✅ Memoize toggleAd to prevent recreation on every render
  const toggleAd = useCallback(() => {
    const newAdState = !localState.showAd1;
    updateLocalState('showAd1', newAdState);
    return newAdState;
  }, [localState.showAd1, updateLocalState]);

  const incrementTranslationCount = useCallback(() => {
    const today = new Date().toDateString();
    const { count, date } = localState.translationUsage || { count: 0, date: today };

    const updatedUsage = {
      count: date === today ? count + 1 : 1,
      date: today,
    };

    updateLocalState('translationUsage', updatedUsage);
  }, [localState.translationUsage, updateLocalState]);


  // console.log(localState.data)
  // console.log(isPro)
  // Initialize RevenueCat
  // ✅ PERF: Memoize RevenueCat functions
  const fetchOfferings = useCallback(async () => {
    try {
      const offerings = await Purchases.getOfferings();
      if (offerings.current?.availablePackages?.length > 0) {
        setPackages(offerings.current.availablePackages);
      }
    } catch (error) {
      // Silently handle
    }
  }, []);

  const checkEntitlements = useCallback(async () => {
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      const entitlements = customerInfo.entitlements.active;
      const proKey = Object.keys(entitlements).find(
        (key) => key.toLowerCase() === 'pro'
      );
      const proStatus = !!(proKey && entitlements[proKey]);
      updateLocalState('isPro', proStatus);

      setMySubscriptions(
        proStatus
          ? customerInfo.activeSubscriptions.map((sub) => ({
              plan: sub,
              expiry: customerInfo.allExpirationDates[sub] || null,
            }))
          : []
      );
    } catch (error) {
      // Silently handle
    }
  }, [updateLocalState]);

  const initRevenueCat = useCallback(async () => {
    try {
      await Purchases.configure({ apiKey: config.apiKey, usesStoreKit2IfAvailable: false });
      const userID = await Purchases.getAppUserID();
      setCustomerId(userID);

      await Promise.all([
        fetchOfferings().catch(() => null),
        checkEntitlements().catch(() => null),
        preloadOfferings().catch(() => null),
      ]);
    } catch (error) {
      setCustomerId(null);
      setPackages([]);
      setMySubscriptions([]);
    }
  }, [fetchOfferings, checkEntitlements]);

  useEffect(() => {
    const id = requestIdleCallback(initRevenueCat);
    return () => cancelIdleCallback(id);
  }, [initRevenueCat]);

  // ✅ Listen for real-time subscription changes (purchase, renewal, expiry)
  useEffect(() => {
    const listener = Purchases.addCustomerInfoUpdateListener((customerInfo) => {
      const entitlements = customerInfo.entitlements.active;
      const proKey = Object.keys(entitlements).find(
        (key) => key.toLowerCase() === 'pro'
      );
      const proStatus = !!(proKey && entitlements[proKey]);
      updateLocalState('isPro', proStatus);

      if (proStatus) {
        setMySubscriptions(
          customerInfo.activeSubscriptions.map((plan) => ({
            plan,
            expiry: customerInfo.allExpirationDates[plan] || null,
          }))
        );
      } else {
        setMySubscriptions([]);
      }
    });
    return () => { if (listener && typeof listener.remove === 'function') listener.remove(); };
  }, [updateLocalState]);


  const restorePurchases = useCallback(async (setLoadingReStore) => {
    setLoadingReStore(true);
    try {
      const customerInfo = await Purchases.restorePurchases();
      const entitlements = customerInfo.entitlements.active;
      const proKey = Object.keys(entitlements).find(
        (key) => key.toLowerCase() === 'pro'
      );
      const proStatus = !!(proKey && entitlements[proKey]);

      updateLocalState('isPro', proStatus);
      setMySubscriptions(
        proStatus
          ? customerInfo.activeSubscriptions.map((plan) => ({
              plan,
              expiry: customerInfo.allExpirationDates[plan] || null,
            }))
          : []
      );
    } catch (error) {
      // Silently handle
    } finally {
      setLoadingReStore(false);
    }
  }, [updateLocalState]);

  // Handle in-app purchase
  const purchaseProduct = useCallback(async (packageToPurchase, setLoading, track) => {
    setLoading(true);
    try {
      const { customerInfo } = await Purchases.purchasePackage(packageToPurchase);
      const entitlements = customerInfo.entitlements.active;
      const proKey = Object.keys(entitlements).find(
        (key) => key.toLowerCase() === 'pro'
      );
      const proStatus = !!(proKey && entitlements[proKey]);

      updateLocalState('isPro', proStatus);
      setMySubscriptions(
        proStatus
          ? customerInfo.activeSubscriptions.map((plan) => ({
              plan,
              expiry: customerInfo.allExpirationDates[plan] || null,
            }))
          : []
      );

      if (track) {
        mixpanel.track('Purchase Completed', {
          package: packageToPurchase.identifier,
          price: packageToPurchase.product.price,
          currency: packageToPurchase.product.currencyCode,
        });
      }

      showSuccessMessage('Success', 'Purchase completed successfully!');
    } catch (error) {
      if (!error.userCancelled) {
        showErrorMessage('Error', 'Failed to complete purchase. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [updateLocalState]);

  const clearKey = useCallback((key) => {
    setLocalState((prevState) => {
      const newState = { ...prevState };
      delete newState[key];
      return newState;
    });
    storage.delete(key);
  }, []);

  const clearAll = useCallback(() => {
    setLocalState({});
    storage.clearAll();
  }, []);

  const getRemainingTranslationTries = useCallback(() => {
    const today = new Date().toDateString();
    const { count = 0, date = today } = localState.translationUsage || {};
    return date === today ? 20 - count : 20;
  }, [localState.translationUsage]);


  const contextValue = useMemo(
    () => ({
      localState,
      updateLocalState,
      clearKey,
      clearAll,
      customerId,
      packages,
      mySubscriptions,
      purchaseProduct,
      restorePurchases,
      refreshCustomerInfo: checkEntitlements,
      canTranslate,
      incrementTranslationCount,
      getRemainingTranslationTries,
      toggleAd,
    }),
    [localState, customerId, packages, mySubscriptions, updateLocalState, clearKey, clearAll, purchaseProduct, restorePurchases, checkEntitlements, canTranslate, incrementTranslationCount, getRemainingTranslationTries, toggleAd]
  );

  return (
    <LocalStateContext.Provider value={contextValue}>
      {children}
    </LocalStateContext.Provider>
  );
};
