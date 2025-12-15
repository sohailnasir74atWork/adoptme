import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { ref, set, update, get, onDisconnect, getDatabase, onValue } from '@react-native-firebase/database';
import { getFirestore } from '@react-native-firebase/firestore';
import { createNewUser, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { useColorScheme, InteractionManager, AppState } from 'react-native';
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

  const colorScheme = useColorScheme(); // 'light' or 'dark'

  const resolvedTheme = localState.theme === 'system' ? colorScheme : localState.theme;
  const [theme, setTheme] = useState(resolvedTheme);
  const [api, setApi] = useState(null);
  const [freeTranslation, setFreeTranslation] = useState(null);
  const [currentUserEmail, setCurrentuserEmail] = useState('')
  const [single_offer_wall, setSingle_offer_wall] = useState(false)
  const [tradingServerLink, setTradingServerLink] = useState(null); // Trading server link from admin servers



  const [isAdmin, setIsAdmin] = useState(false);
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

  const [onlineMembersCount, setOnlineMembersCount] = useState(0);
  const [loading, setLoading] = useState(false);
  // const [robloxUsername, setRobloxUsername] = useState('');
  const robloxUsernameRef = useRef('');


  // Track theme changes
  useEffect(() => {
    setTheme(localState.theme === 'system' ? colorScheme : localState.theme);
  }, [localState.theme, colorScheme]);

  // const isAdmin = user?.id  ? user?.id == '3CAAolfaX3UE3BLTZ7ghFbNnY513' : false

  // ✅ Store updateLocalState in ref to avoid dependency issues
  const updateLocalStateRef = useRef(updateLocalState);
  useEffect(() => {
    updateLocalStateRef.current = updateLocalState;
  }, [updateLocalState]);

  // ✅ Memoize updateLocalStateAndDatabase to prevent infinite loops
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

      // ✅ Update in-memory user state and Firebase in one functional update
      setUser((prev) => {
        const updatedUser = { ...prev, ...updates };
        
        // ✅ Update Firebase only if user is logged in (use prev.id to avoid dependency)
        if (prev?.id && appdatabase) {
          const userRef = ref(appdatabase, `users/${prev.id}`);
          update(userRef, updates).catch((error) => {
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
          update(userRef, { flage: null }).catch(() => {});
          setUser((prev) => ({ ...prev, flage: null }));
        } else if (localState?.showFlag !== false && !user?.flage) {
          // ✅ User toggled flag on - add it
          const flagValue = getFlag();
          const userRef = ref(appdatabase, `users/${user.id}`);
          update(userRef, { flage: flagValue }).catch(() => {});
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
  useEffect(() => {
    const fetchTradingServerLink = async () => {
      try {
        const lastServerFetch = localState.lastServerFetch ? new Date(localState.lastServerFetch).getTime() : 0;
        const now = Date.now();
        const timeElapsed = now - lastServerFetch;
        const EXPIRY_LIMIT = 3 * 60 * 60 * 1000; // 3 hours

        // Only fetch if expired or not cached
        if (timeElapsed > EXPIRY_LIMIT || !localState.tradingServerLink) {
          const serverRef = ref(appdatabase, 'server');
          const snapshot = await get(serverRef);

          if (snapshot.exists()) {
            const serverData = snapshot.val();
            // Convert to array and get first server link
            const serverList = Object.entries(serverData).map(([id, value]) => ({ id, ...value }));
            
            // Get the first server link (or you can filter by name if needed)
            const firstServer = serverList.length > 0 ? serverList[0] : null;
            const serverLink = firstServer?.link || null;

            if (serverLink) {
              setTradingServerLink(serverLink);
              await updateLocalState('tradingServerLink', serverLink);
              await updateLocalState('lastServerFetch', new Date().toISOString());
            }
          }
        } else {
          // Use cached link
          if (localState.tradingServerLink) {
            setTradingServerLink(localState.tradingServerLink);
          }
        }
      } catch (error) {
        console.error('Error fetching trading server link:', error);
        // Fallback to cached link if available
        if (localState.tradingServerLink) {
          setTradingServerLink(localState.tradingServerLink);
        }
      }
    };

    if (appdatabase) {
      fetchTradingServerLink();
    }
  }, [appdatabase, localState.lastServerFetch, localState.tradingServerLink]);

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



  // const fetchStockData = async (refresh) => {
  //   try {
  //     setLoading(true);

  //     const lastActivity = localState.lastActivity ? new Date(localState.lastActivity).getTime() : 0;
  //     const now = Date.now();
  //     const timeElapsed = now - lastActivity;
  //     const EXPIRY_LIMIT = refresh ? 1 * 10 * 1000 : 1 * 6 * 60 * 1000; // 30 min or 6 hrs

  //     const shouldFetch =
  //       timeElapsed > EXPIRY_LIMIT ||
  //       !localState.data ||
  //       !Object.keys(localState.data).length ||
  //       !localState.imgurl;

  //     if (shouldFetch) {
  //       let data = {};
  //       let image = '';

  //       // ✅ First try to fetch `data` from Bunny CDN
  //       try {
  //         const dataRes = await fetch('https://adoptme.b-cdn.net');
  //         const dataJson = await dataRes.json();
  //         // console.log(dataJson)

  //         if (!dataJson || typeof dataJson !== 'object' || dataJson.error || !Object.keys(dataJson).length) {
  //           throw new Error('CDN returned invalid or error data');
  //         }

  //         data = dataJson;

  //         console.log('✅ Loaded data from Bunny CDN');
  //       } catch (err) {
  //         console.warn('⚠️ Failed to load from CDN, falling back to Firebase:', err.message);

  //         const xlsSnapshot = await get(ref(appdatabase, 'xlsData'));
  //         data = xlsSnapshot.exists() ? xlsSnapshot.val() : {};
  //       }

  //       // ✅ Always fetch `image_url` from Firebase
  //       const imageSnapShot = await get(ref(appdatabase, 'image_url'));
  //       image = imageSnapShot.exists() ? imageSnapShot.val() : '';

  //       // ✅ Store in local state
  //       await updateLocalState('data', JSON.stringify(data));
  //       await updateLocalState('imgurl', JSON.stringify(image));
  //       await updateLocalState('lastActivity', new Date().toISOString());
  //     }

  //   } catch (error) {
  //     console.error("❌ Error fetching stock data:", error);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  const fetchStockData = async (refresh) => {
    try {
      setLoading(true);

      const lastActivity = localState.lastActivity ? new Date(localState.lastActivity).getTime() : 0;
      const now = Date.now();
      const timeElapsed = now - lastActivity;
      const EXPIRY_LIMIT = refresh ? 1 * 1000 : 3 * 60 * 1000; // 10s for refresh, 6min default
      const shouldFetch =
        timeElapsed > EXPIRY_LIMIT ||
        !localState.data ||
        !Object.keys(localState.data).length ||
        !localState.imgurl || !localState.ggData ||
        !Object.keys(localState.ggData).length || !localState.imgurlGG;


      if (shouldFetch) {
        let image = '';
        let imageGG = ''
        // console.log(shouldFetch, 'shouldfetch')

        const valuesNotGG = `https://adoptme.b-cdn.net?cb=${Date.now()}`;
        const valuesGG = 'https://adoptme-gg-values.b-cdn.net/adoptme_gg_values.json';

        // 🔹 Fetch non-GG data
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
          await updateLocalState('data', JSON.stringify(json));
        } catch (err) {
          console.warn('⚠️ Non-GG CDN failed, fallback to Firebase:', err.message);
          const snapshot = await get(ref(appdatabase, 'xlsData'));
          const fallbackData = snapshot.exists() ? snapshot.val() : {};
          await updateLocalState('data', JSON.stringify(fallbackData));
        }

        // 🔹 Fetch GG data
        try {
          // console.log('🌐 Fetching GG data from:', valuesGG);
          const res = await fetch(valuesGG, {
            method: 'GET',
            cache: 'no-store',
          });
          const json = await res.json();

          if (!json || typeof json !== 'object' || json.error || !Object.keys(json).length) {
            throw new Error('GG CDN returned invalid data');
          }
          // console.log(JSON.stringify(json[0]))
          await updateLocalState('ggData', JSON.stringify(json));
        } catch (err) {
          // console.warn('⚠️ GG CDN failed, fallback to Firebase:', err.message);
          const snapshot = await get(ref(appdatabase, 'ggData'));
          const fallbackData = snapshot.exists() ? snapshot.val() : {};
          await updateLocalState('ggData', JSON.stringify(fallbackData));
        }

        // 🔹 Fetch shared image_url
        const imageSnapShot = await get(ref(appdatabase, 'image_url'));
        const imageSnapShotgg = await get(ref(appdatabase, 'image_url_gg'));
        image = imageSnapShot.exists() ? imageSnapShot.val() : '';
        imageGG = imageSnapShotgg.exists() ? imageSnapShotgg.val() : '';
        await updateLocalState('imgurl', JSON.stringify(image));
        await updateLocalState('imgurlGG', JSON.stringify(imageGG));
        // console.log('updated everything')
      }
    } catch (error) {
      // console.error("❌ Error fetching stock data:", error);
    } finally {
      setLoading(false);
    }
  };




  // console.log(user)

  // ✅ Run the function only if needed
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      fetchStockData(); // ✅ Now runs after main thread is free
    });

    return () => task.cancel();
  }, []);

  const reload = () => {
    fetchStockData(true);
  };
  // ✅ Helper function to set user online
  const setUserOnline = useCallback(async () => {
    if (!user?.id || !appdatabase) return;

    // ✅ Mark user as online in local state & database
    await updateLocalStateAndDatabase('online', true);

    // ✅ Add user to online_users node (cost-effective: only stores online users)
    const userOnlineRef = ref(appdatabase, `/users/${user.id}/online`);
    
    // Set online status in users node
    await set(userOnlineRef, true).catch((error) => 
      console.error("🔥 Error setting online status:", error)
    );
    
    // ✅ Only add to online_users if user wants to show online status (optimized for Firebase costs)
    if (localState?.showOnlineStatus !== false) {
      const onlineUsersRef = ref(appdatabase, `/online_users/${user.id}`);
      // ✅ Add to online_users list (minimal data: just true, userId is the key)
      await set(onlineUsersRef, true).catch((error) => 
        console.error("🔥 Error adding to online_users:", error)
      );
    } else {
      // ✅ User has disabled online status - ensure they're not in online_users
      const onlineUsersRef = ref(appdatabase, `/online_users/${user.id}`);
      await onlineUsersRef.remove().catch((error) => 
        console.error("🔥 Error removing from online_users:", error)
      );
    }
  }, [user?.id, appdatabase, updateLocalStateAndDatabase, localState?.showOnlineStatus]);

  // ✅ Helper function to set user offline
  const setUserOffline = useCallback(async () => {
    if (!user?.id || !appdatabase) return;

    // ✅ Mark user as offline in local state
    updateLocalStateAndDatabase('online', false);

    // ✅ Remove from online_users
    const onlineUsersRef = ref(appdatabase, `/online_users/${user.id}`);
    await onlineUsersRef.remove().catch((error) => 
      console.error("🔥 Error removing from online_users:", error)
    );
  }, [user?.id, appdatabase, updateLocalStateAndDatabase]);

  // console.log(localState.ggData[0])
  useEffect(() => {
    if (!user?.id || !appdatabase) return;

    // ✅ Mark user as online when component mounts or user changes
    setUserOnline();

    // ✅ Add user to online_users node (cost-effective: only stores online users)
    const userOnlineRef = ref(appdatabase, `/users/${user.id}/online`);
    
    // ✅ Only set up online_users disconnect if user wants to show online status
    if (localState?.showOnlineStatus !== false) {
      const onlineUsersRef = ref(appdatabase, `/online_users/${user.id}`);
      // ✅ Remove from online_users on disconnect
      onDisconnect(onlineUsersRef)
        .remove()
        .catch((error) => console.error("🔥 Error removing from online_users on disconnect:", error));
    }

    // ✅ Ensure user is marked offline upon disconnection
    onDisconnect(userOnlineRef)
      .set(false)
      .catch((error) => console.error("🔥 Error setting onDisconnect:", error));

    return () => {
      // ✅ Cleanup: Mark user offline when the app is closed
      setUserOffline();
    };
  }, [user?.id, appdatabase, setUserOnline, setUserOffline, localState?.showOnlineStatus]);

  // ✅ Handle app state changes (background/foreground)
  useEffect(() => {
    if (!user?.id || !appdatabase) return;

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (nextAppState === 'active') {
        // ✅ App came to foreground - mark user online
        setUserOnline();
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        // ✅ App went to background - mark user offline
        setUserOffline();
      }
    });

    return () => {
      subscription?.remove();
    };
  }, [user?.id, appdatabase, setUserOnline, setUserOffline]);

  // ✅ Listen to online users count (COST-EFFECTIVE: only listens to /online_users, not all users)
  useEffect(() => {
    if (!appdatabase) return;

    // ✅ Only listen to /online_users node (much cheaper - only contains online users)
    const onlineUsersRef = ref(appdatabase, 'online_users');
    
    const unsubscribe = onValue(onlineUsersRef, (snapshot) => {
      if (!snapshot.exists()) {
        setOnlineMembersCount(0);
        return;
      }

      // Count children in online_users node (only online users, not all 100k users)
      const onlineUsers = snapshot.val();
      const onlineCount = onlineUsers ? Object.keys(onlineUsers).length : 0;

      setOnlineMembersCount(onlineCount);
    }, (error) => {
      console.error('Error listening to online members count:', error);
      setOnlineMembersCount(0);
    });

    return () => {
      unsubscribe();
    };
  }, [appdatabase]);

  // console.log(user)

  const contextValue = useMemo(
    () => ({
      user, auth,
      onlineMembersCount,
      firestoreDB,
      appdatabase,
      theme,
      setUser,
      setOnlineMembersCount,
      updateLocalStateAndDatabase,
      fetchStockData,
      loading,
      freeTranslation,
      isAdmin,
      reload,
      robloxUsernameRef, api, currentUserEmail, single_offer_wall, tradingServerLink
    }),
    [user, onlineMembersCount, theme, fetchStockData, loading, robloxUsernameRef, api, freeTranslation, currentUserEmail, auth, tradingServerLink]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


