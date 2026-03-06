import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { ref, set, update, get, onDisconnect, getDatabase, onValue, remove, query, orderByValue, equalTo } from '@react-native-firebase/database';
import { getFirestore, doc, onSnapshot } from '@react-native-firebase/firestore';
import { createNewUser, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { useColorScheme, InteractionManager, AppState, Appearance } from 'react-native';
import { getFlag } from './Helper/CountryCheck';



const app = getApps().length ? getApp() : null;
const auth = getAuth(app);
const firestoreDB = getFirestore(app);
const appdatabase = getDatabase(app);
const GlobalStateContext = createContext();



// Custom hook to access global state
export const useGlobalState = () => useContext(GlobalStateContext);

export const GlobalStateProvider = ({ children }) => {
  const { localState, updateLocalState } = useLocalState()

  const colorScheme = useColorScheme(); // 'light' or 'dark' or null

  const resolveTheme = (userPref, systemScheme) =>
    userPref === 'system' ? (systemScheme || 'light') : userPref;

  const [theme, setTheme] = useState(() => resolveTheme(localState.theme, colorScheme));
  const [api, setApi] = useState(null);
  const [freeTranslation, setFreeTranslation] = useState(null);
  const [currentUserEmail, setCurrentuserEmail] = useState('')
  const [single_offer_wall, setSingle_offer_wall] = useState(false)
  const [tradingServerLink, setTradingServerLink] = useState(null); // Trading server link from admin servers



  const [isAdmin, setIsAdmin] = useState(false);
  const [isInActiveGame, setIsInActiveGame] = useState(false); // ✅ Track if user is in active game
  const [user, setUser] = useState({
    id: null,
    // selectedFruits: [],
    // isReminderEnabled: false,
    // isSelectedReminderEnabled: false,
    displayName: '',
    avatar: null,
    // rewardPoints: 0,
    isBlock: false,
    fcmToken: null,
    lastActivity: null,
    online: false,
    isPro: false,
    createdAt: null


  });

  const [loading, setLoading] = useState(false);
  // const [robloxUsername, setRobloxUsername] = useState('');
  const robloxUsernameRef = useRef('');

  // Keep localState.theme in a ref so the Appearance listener can read it without stale closures
  const themeSettingRef = useRef(localState.theme);
  useEffect(() => { themeSettingRef.current = localState.theme; }, [localState.theme]);

  // Track theme changes from useColorScheme
  useEffect(() => {
    setTheme(resolveTheme(localState.theme, colorScheme));
  }, [localState.theme, colorScheme]);

  // Robust fallback: Appearance.addChangeListener catches system theme changes
  // even when useColorScheme hook doesn't re-trigger (known RN issue on some devices)
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme: newScheme }) => {
      if (themeSettingRef.current === 'system') {
        setTheme(newScheme || 'light');
      }
    });
    return () => sub?.remove();
  }, []);

  // const isAdmin = user?.id  ? user?.id == '3CAAolfaX3UE3BLTZ7ghFbNnY513' : false

  // ✅ Store updateLocalState in ref to avoid dependency issues
  const updateLocalStateRef = useRef(updateLocalState);
  useEffect(() => {
    updateLocalStateRef.current = updateLocalState;
  }, [updateLocalState]);

  // ✅ Keep localState accessible via ref for memoized callbacks (avoids stale closures)
  const localStateRef = useRef(localState);
  useEffect(() => {
    localStateRef.current = localState;
  }, [localState]);

  // ✅ Memoize updateLocalStateAndDatabase to prevent infinite loops and duplicate writes
  const updateLocalStateAndDatabase = useCallback(async (keyOrUpdates, value) => {
    try {
      let updates = {};

      if (typeof keyOrUpdates === 'string') {
        updates = { [keyOrUpdates]: value };
        await updateLocalStateRef.current(keyOrUpdates, value); // ✅ Use ref to avoid dependency
      } else if (typeof keyOrUpdates === 'object') {
        updates = keyOrUpdates;
        for (const [key, val] of Object.entries(updates)) {
          await updateLocalStateRef.current(key, val); // ✅ Use ref to avoid dependency
        }
      } else {
        throw new Error('Invalid arguments for update.');
      }

      // ✅ Update in-memory user state and Firebase in one functional update (prevents duplicate writes)
      setUser((prev) => {
        // ✅ Check if updates are actually different to prevent duplicate writes
        const hasChanges = Object.keys(updates).some(key => prev[key] !== updates[key]);
        if (!hasChanges && prev?.id) {
          // No changes, skip Firebase write
          return prev;
        }

        const updatedUser = { ...prev, ...updates };

        // ✅ Update Firebase only if user is logged in and there are actual changes
        // ✅ Exclude 'online' field from user data (it's stored in presence/{uid} node)
        if (prev?.id && appdatabase && hasChanges) {
          const userRef = ref(appdatabase, `users/${prev.id}`);
          const userDataUpdates = { ...updates };
          delete userDataUpdates.online; // ✅ Don't sync online to user data
          update(userRef, userDataUpdates).catch((error) => {
            // Silently handle Firebase errors
          });
        }

        return updatedUser;
      });
    } catch (error) {
      // console.error('❌ Error updating user state or database:', error);
    }
  }, [appdatabase]); // ✅ Removed updateLocalState from deps, using ref instead



  // ✅ Use ref to track if flag has been set for current user (prevents infinite loop)
  const flagSetForUserRef = useRef(null);
  const updateLocalStateAndDatabaseRef = useRef(updateLocalStateAndDatabase);

  // ✅ Keep ref updated with latest function
  useEffect(() => {
    updateLocalStateAndDatabaseRef.current = updateLocalStateAndDatabase;
  }, [updateLocalStateAndDatabase]);

  // ✅ Handle flag setting based on user preference (saves Firebase data costs)
  useEffect(() => {
    if (!isAdmin && user?.id && appdatabase) {
      // ✅ Only set flag once per user.id to prevent infinite loop
      if (flagSetForUserRef.current !== user.id) {
        flagSetForUserRef.current = user.id;

        // ✅ Only store flag if user wants to show it (saves Firebase data costs)
        if (localState?.showFlag !== false) {
          // User wants to show flag - store it
          updateLocalStateAndDatabaseRef.current({ flage: getFlag() });
        }
        // If showFlag is false, don't store flag (saves data)
      } else {
        // ✅ Handle flag toggle changes after initial setup
        if (localState?.showFlag === false && user?.flage) {
          // ✅ User toggled flag off - remove it from Firebase to save data
          const userRef = ref(appdatabase, `users/${user.id}`);
          update(userRef, { flage: null }).catch(() => { });
          setUser((prev) => ({ ...prev, flage: null }));
        } else if (localState?.showFlag !== false && !user?.flage) {
          // ✅ User toggled flag on - add it
          const flagValue = getFlag();
          const userRef = ref(appdatabase, `users/${user.id}`);
          update(userRef, { flage: flagValue }).catch(() => { });
          setUser((prev) => ({ ...prev, flage: flagValue }));
        }
      }
    }
  }, [user?.id, isAdmin, localState?.showFlag, appdatabase, user?.flage]) // ✅ Check showFlag preference

  // ✅ Memoize resetUserState to prevent unnecessary re-renders
  const resetUserState = useCallback(() => {
    setUser({
      id: null,
      // selectedFruits: [],
      // isReminderEnabled: false,
      // isSelectedReminderEnabled: false,
      displayName: '',
      avatar: null,
      // rewardPoints: 0,
      isBlock: false,
      fcmToken: null,
      lastActivity: null,
      online: false,
      isPro: false,
      createdAt: null
    });
  }, []); // No dependencies, so it never re-creates

  // ✅ Memoize handleUserLogin
  const handleUserLogin = useCallback(async (loggedInUser) => {
    if (!loggedInUser) {
      resetUserState(); // No longer recreates resetUserState
      return;
    }
    try {
      const userId = loggedInUser.uid;
      const userRef = ref(appdatabase, `users/${userId}`);


      // 🔄 Fetch user data
      const snapshot = await get(userRef);
      let userData;

      const makeadmin = loggedInUser.email === 'thesolanalabs@gmail.com' || loggedInUser.email === 'sohailnasir74business@gmail.com' || loggedInUser.email === 'sohailnasir74@gmail.com';
      if (makeadmin) { setIsAdmin(makeadmin) }
      setCurrentuserEmail(loggedInUser.email)

      if (snapshot.exists()) {
        // ⏳ USER EXISTS → Keep existing createdAt
        const existing = snapshot.val();

        // ✅ SELF-HEALING: Update email if missing or changed
        if (loggedInUser.email && (!existing.email || existing.email !== loggedInUser.email)) {
          const emailUpdates = {
            email: loggedInUser.email,
            decodedEmail: loggedInUser.email.replace(/\./g, '(dot)'),
          };
          await update(userRef, emailUpdates).catch(err => console.log("Email update error:", err));
          // Merge updates into existing object so local state is correct immediately
          Object.assign(existing, emailUpdates);
        }

        userData = {
          ...existing,
          id: userId,
          createdAt: existing.createdAt || Date.now()   // fallback if missing
        };

      } else {
        // 🆕 NEW USER → Set createdAt once
        userData = {
          ...createNewUser(userId, loggedInUser, robloxUsernameRef?.current),
          createdAt: Date.now()
        };

        await set(userRef, userData);
      }

      setUser(userData);

      // 🔥 Refresh and update FCM token
      await Promise.all([registerForNotifications(userId)]);

    } catch (error) {
      // console.error("❌ Auth state change error:", error);
    }
  }, [appdatabase, resetUserState]); // ✅ Uses memoized resetUserState
  useEffect(() => {
    if (!user?.id) return;

    const run = async () => {
      try {
        console.log('Registering push token for user:', user.id);
        await registerForNotifications(user.id);
      } catch (e) {
        console.log('registerForNotifications error', e);
      }
    };

    run();
  }, [user?.id]);


  // ✅ Ensure useEffect runs only when necessary
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (loggedInUser) => {
      if (loggedInUser && !loggedInUser.emailVerified) {
        await auth().signOut();
        // showErrorMessage("Email Not Verified", "Please check your inbox and verify your email.");
        return;
      }

      InteractionManager.runAfterInteractions(async () => {
        await handleUserLogin(loggedInUser);

        if (loggedInUser?.uid) {
          await registerForNotifications(loggedInUser.uid);
        }

        await updateLocalState('isAppReady', true);
      });
    });

    return () => unsubscribe();
  }, []);



  useEffect(() => {
    const fetchAPIKeys = async () => {
      try {
        const apiRef = ref(appdatabase, 'api');
        const paywallSecondOnlyFlagRef = ref(appdatabase, 'single_offer_wall');
        const freeRef = ref(appdatabase, 'free_translation');

        const [snapshotApi, paywallSecondOnlyFlag, snapshotFree] = await Promise.all([
          get(apiRef),
          get(paywallSecondOnlyFlagRef),
          get(freeRef),
        ]);

        if (snapshotApi.exists()) {
          const value = snapshotApi.val();
          setApi(value);
        } else {
          // console.warn('⚠️ No Google Translate API key found at /api');
        }

        if (snapshotFree.exists()) {
          const value = snapshotFree.val();
          setFreeTranslation(value);
        } else {
          // console.warn('⚠️ No free translation key found at /free_translation');
        }
        if (paywallSecondOnlyFlag.exists()) {
          const value = paywallSecondOnlyFlag.val();
          // console.log('chec', value)
          setSingle_offer_wall(value);
          // console.log('🔑 [Firebase] Free Translation Key from /free_translation:', value);
        } else {
          console.warn('⚠️ No free translation key found at /free_translation');
        }


      } catch (error) {
        // console.error('🔥 Error fetching API keys from Firebase:', error);
      }
    };

    fetchAPIKeys();
  }, []);

  // Fetch trading server link with 3 hour caching
  // ✅ FIXED: Run once on mount only — deps no longer include values this effect updates
  useEffect(() => {
    if (!appdatabase) return;

    const fetchTradingServerLink = async () => {
      try {
        // Read from MMKV directly to avoid stale closure
        const cachedLink = localState.tradingServerLink;
        const lastFetch = localState.lastServerFetch ? new Date(localState.lastServerFetch).getTime() : 0;
        const now = Date.now();
        const EXPIRY_LIMIT = 3 * 60 * 60 * 1000; // 3 hours

        if ((now - lastFetch) > EXPIRY_LIMIT || !cachedLink) {
          const serverRef = ref(appdatabase, 'server');
          const snapshot = await get(serverRef);

          if (snapshot.exists()) {
            const serverData = snapshot.val();
            const serverList = Object.entries(serverData).map(([id, value]) => ({ id, ...value }));
            const firstServer = serverList.length > 0 ? serverList[0] : null;
            const serverLink = firstServer?.link || null;

            if (serverLink) {
              setTradingServerLink(serverLink);
              updateLocalStateRef.current('tradingServerLink', serverLink);
              updateLocalStateRef.current('lastServerFetch', new Date().toISOString());
            }
          }
        } else if (cachedLink) {
          setTradingServerLink(cachedLink);
        }
      } catch (error) {
        console.error('Error fetching trading server link:', error);
        if (localState.tradingServerLink) {
          setTradingServerLink(localState.tradingServerLink);
        }
      }
    };

    fetchTradingServerLink();
  }, [appdatabase]); // ✅ Only re-run if appdatabase changes (once)

  const updateUserProStatus = () => {
    if (!user?.id) {
      // console.error("User ID or database instance is missing!");
      return;
    }

    const userIsProRef = ref(appdatabase, `/users/${user?.id}/isPro`);

    set(userIsProRef, localState?.isPro)
      .then(() => {
      })
      .catch((error) => {
        // console.error("Error updating online status:", error);
      });
  };





  useEffect(() => {
    InteractionManager.runAfterInteractions(() => {
      // checkInternetConnection();
      updateUserProStatus();
    });
  }, [user.id, localState.isPro]);


  useEffect(() => {
    // console.log("🕓 Saving lastActivity:", new Date().toISOString());
    updateLocalStateAndDatabase('lastActivity', new Date().toISOString());
  }, []);



  // ✅ FIXED: Memoize fetchStockData to prevent contextValue from changing every render
  // This was causing ALL 80+ useGlobalState consumers to re-render on every cycle
  const fetchStockData = useCallback(async (refresh) => {
    try {
      setLoading(true);

      const ls = localStateRef.current;
      const lastActivity = ls.lastActivity ? new Date(ls.lastActivity).getTime() : 0;
      const now = Date.now();
      const timeElapsed = now - lastActivity;
      const EXPIRY_LIMIT = refresh ? 1 * 1000 : 3 * 60 * 1000; // 10s for refresh, 6min default
      const shouldFetch =
        timeElapsed > EXPIRY_LIMIT ||
        !ls.data ||
        !Object.keys(ls.data).length ||
        !ls.imgurl;


      if (shouldFetch) {
        let image = '';
        // console.log(shouldFetch, 'shouldfetch')

        const valuesNotGG = `https://adoptme.b-cdn.net?cb=${Date.now()}`;

        // 🔹 Fetch non-GG data from Bunny CDN ONLY (no Firebase fallback)
        try {
          // console.log('🌐 Fetching non-GG data from:', valuesNotGG);
          const res = await fetch(valuesNotGG, {
            method: 'GET',
            cache: 'no-store',
          });
          const json = await res.json();

          if (!json || typeof json !== 'object' || json.error || !Object.keys(json).length) {
            throw new Error('Non-GG CDN returned invalid data');
          }
          // console.log(JSON.stringify(json))
          await updateLocalStateRef.current('data', json);
        } catch (err) {
          console.warn('⚠️ Non-GG CDN failed, using cached data:', err.message);
          // ✅ OPTIMIZED: Use cached data instead of downloading from Firebase xlsData
          // This prevents downloading 12.43 MB from Firebase RTDB
          // If no cached data exists, keep existing localState.data (empty or old)
          const localDataObj = typeof ls.data === 'string' ? JSON.parse(ls.data) : ls.data;
          const hasLocalData = localDataObj && Object.keys(localDataObj || {}).length > 0;

          if (!hasLocalData) {
            console.error('❌ No CDN data and no cached data available. App may not function correctly.');
            // Keep existing localState.data (which might be empty)
            // Don't download from Firebase to save costs
          } else {
            console.log('✅ Using cached data instead of downloading from Firebase xlsData');
          }
        }



        // 🔹 Fetch shared image_url
        const imageSnapShot = await get(ref(appdatabase, 'image_url'));
        image = imageSnapShot.exists() ? imageSnapShot.val() : '';
        await updateLocalStateRef.current('imgurl', image);
        // console.log('updated everything')
      }
    } catch (error) {
      // console.error("❌ Error fetching stock data:", error);
    } finally {
      setLoading(false);
    }
  }, [appdatabase]); // ✅ Stable — only changes if appdatabase changes (once)

  // ✅ Run the function only if needed
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchStockData();
    });

    return () => task.cancel();
  }, [fetchStockData]);

  const reload = useCallback(() => {
    fetchStockData(true);
  }, [fetchStockData]);



  // ✅ Set up online status tracking using separate presence node (RTDB-only, optimized for scale)
  // ✅ Foreground-only presence (ACTIVE = online, background/inactive = offline)
  // ✅ Uses presence/{uid} instead of users/{uid}/online for better scalability
  // ✅ FIXED: Added throttling to prevent RejectedExecutionException from thread pool exhaustion
  useEffect(() => {
    if (!user?.id || !appdatabase) return;

    const uid = user.id;
    const presenceRef = ref(appdatabase, `presence/${uid}`); // ✅ Separate presence node
    const connectedRef = ref(appdatabase, ".info/connected")

    let isConnected = false;
    let currentAppState = AppState.currentState; // 'active' | 'background' | 'inactive'
    let armedOnDisconnect = false;
    let lastUpdateTime = 0; // ✅ For throttling
    const THROTTLE_MS = 500; // ✅ Minimum 500ms between presence updates

    const setLocalOnline = (val) => {
      setUser((prev) => (prev?.id ? { ...prev, online: val } : prev));
    };

    const forceOffline = async () => {
      try {
        await set(presenceRef, false);
      } catch (e) {
        // log if you want: console.log("forceOffline error", e);
      }
      setLocalOnline(false);
    };

    let onDisconnectHandler = null;

    const armOnDisconnect = async () => {
      if (armedOnDisconnect) return;
      try {
        onDisconnectHandler = onDisconnect(presenceRef);
        await onDisconnectHandler.set(false);
        armedOnDisconnect = true;
      } catch (e) {
        // Handle error silently
      }
    };

    let running = false;
    let pending = false;

    const updatePresence = async () => {
      // ✅ THROTTLE: Prevent rapid-fire updates that cause thread pool exhaustion
      const now = Date.now();
      if (now - lastUpdateTime < THROTTLE_MS) {
        // Schedule a delayed update instead of firing immediately
        if (!pending) {
          pending = true;
          setTimeout(() => {
            pending = false;
            lastUpdateTime = Date.now();
            updatePresence();
          }, THROTTLE_MS);
        }
        return;
      }
      lastUpdateTime = now;

      if (running) {
        pending = true;
        return;
      }
      running = true;

      try {
        if (localState?.showOnlineStatus === false) {
          try {
            if (onDisconnectHandler) {
              await onDisconnectHandler.cancel();
            }
          } catch { }
          armedOnDisconnect = false;
          await forceOffline();
          return;
        }

        if (!isConnected || currentAppState !== "active") {
          await forceOffline();
          return;
        }

        await armOnDisconnect();
        await set(presenceRef, true);
        setLocalOnline(true);

      } catch (e) {
        // console.log("updatePresence error", e);
      } finally {
        running = false;

        // ✅ if something changed while we were running, apply latest state once more
        if (pending) {
          pending = false;
          // ✅ Use setTimeout to prevent synchronous recursion (thread pool issue)
          setTimeout(updatePresence, 100);
        }
      }
    };



    // Listen to RTDB connection state - wrapped in try-catch to prevent crashes
    const unsubConnected = onValue(connectedRef, (snap) => {
      try {
        isConnected = snap.val() === true;
        updatePresence();
      } catch (e) {
        // ✅ FIXED: Catch errors to prevent RejectedExecutionException crash
        console.warn('Presence update error (ignored):', e?.message || e);
      }
    });

    // Listen to AppState changes
    const sub = AppState.addEventListener("change", (nextState) => {
      try {
        currentAppState = nextState;
        // immediately offline when background/inactive
        updatePresence();
      } catch (e) {
        // ✅ FIXED: Catch errors to prevent crash
        console.warn('AppState presence error (ignored):', e?.message || e);
      }
    });

    // Initial sync
    updatePresence();

    return () => {
      // ✅ Cleanup: Mark user offline when component unmounts or user.id changes (logout)
      sub.remove();
      if (typeof unsubConnected === "function") unsubConnected();

      // ✅ Cancel onDisconnect handler if it exists
      if (onDisconnectHandler) {
        onDisconnectHandler.cancel().catch(() => { });
      }

      // ✅ Mark offline in RTDB (using closure to capture the old uid)
      // This ensures when user.id changes to null (logout), the previous user is marked offline
      set(presenceRef, false).catch(() => { });
      setLocalOnline(false);
    };
  }, [user?.id, appdatabase, localState?.showOnlineStatus]);



  // console.log(user)

  const contextValue = useMemo(
    () => ({
      user, auth,
      firestoreDB,
      appdatabase,
      theme,
      setUser,
      updateLocalStateAndDatabase,
      fetchStockData,
      loading,
      freeTranslation,
      isAdmin,
      reload,
      robloxUsernameRef, api, currentUserEmail, single_offer_wall, tradingServerLink,
      isInActiveGame, // ✅ Game state for invite notifications
      setIsInActiveGame, // ✅ Set game state
    }),
    [user, theme, loading, robloxUsernameRef, api, freeTranslation, currentUserEmail, tradingServerLink, isInActiveGame]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


