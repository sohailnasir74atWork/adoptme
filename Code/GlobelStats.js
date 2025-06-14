import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getApp, getApps, initializeApp } from '@react-native-firebase/app';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { ref, set, update, get, onDisconnect, getDatabase } from '@react-native-firebase/database';
import { getFirestore } from '@react-native-firebase/firestore';
import { createNewUser, firebaseConfig, registerForNotifications } from './Globelhelper';
import { useLocalState } from './LocalGlobelStats';
import { requestPermission } from './Helper/PermissionCheck';
import { useColorScheme, InteractionManager } from 'react-native';
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
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
    isPro: false

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

  const updateLocalStateAndDatabase = async (keyOrUpdates, value) => {
    try {
      let updates = {};
  
      if (typeof keyOrUpdates === 'string') {
        updates = { [keyOrUpdates]: value };
        await updateLocalState(keyOrUpdates, value); // ✅ update local storage (AsyncStorage)
      } else if (typeof keyOrUpdates === 'object') {
        updates = keyOrUpdates;
        for (const [key, val] of Object.entries(updates)) {
          await updateLocalState(key, val); // ✅ update local storage key by key
        }
      } else {
        throw new Error('Invalid arguments for update.');
      }
  
      // ✅ Update in-memory user state
      setUser((prev) => ({ ...prev, ...updates }));
  
      // ✅ Update Firebase only if user is logged in
      if (user?.id) {
        const userRef = ref(appdatabase, `users/${user.id}`);
        await update(userRef, updates);
      }
    } catch (error) {
      console.error('❌ Error updating user state or database:', error);
    }
  };
  




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
      isPro: false
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

      const makeadmin = loggedInUser.email === 'thesolanalabs@gmail.com' || loggedInUser.email === 'mastermind@gmail.com';
      if (makeadmin) { setIsAdmin(makeadmin) }

      if (snapshot.exists()) {
        userData = { ...snapshot.val(), id: userId };


      } else {
        userData = createNewUser(userId, loggedInUser, robloxUsernameRef?.current);
        await set(userRef, userData);
      }
      setUser(userData);

      // 🔥 Refresh and update FCM token
      await Promise.all([registerForNotifications(userId), requestPermission()]);

    } catch (error) {
      console.error("❌ Auth state change error:", error);
    }
  }, [appdatabase, resetUserState]); // ✅ Uses memoized resetUserState

  // ✅ Ensure useEffect runs only when necessary
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (loggedInUser) => {
      InteractionManager.runAfterInteractions(async () => {
        await handleUserLogin(loggedInUser);

        if (loggedInUser?.uid) {
          await registerForNotifications(loggedInUser.uid);
          await requestPermission();
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
      const freeRef = ref(appdatabase, 'free_translation');

      const [snapshotApi, snapshotFree] = await Promise.all([
        get(apiRef),
        get(freeRef),
      ]);

      if (snapshotApi.exists()) {
        const value = snapshotApi.val();
        setApi(value);
      } else {
        console.warn('⚠️ No Google Translate API key found at /api');
      }

      if (snapshotFree.exists()) {
        const value = snapshotFree.val();
        setFreeTranslation(value);
      } else {
        console.warn('⚠️ No free translation key found at /free_translation');
      }

    } catch (error) {
      console.error('🔥 Error fetching API keys from Firebase:', error);
    }
  };

  fetchAPIKeys();
}, []);

  


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
        console.error("Error updating online status:", error);
      });
  };



  const checkInternetConnection = async () => {
    try {
      const response = await fetch('https://www.google.com/favicon.ico', { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Unable to reach the internet.');
      }
    } catch {
      // ✅ Show a friendly alert message
      Alert.alert(
        "⚠️ No Internet Connection",
        "Some features may not work properly. Please check your network and try again.",
        [{ text: "OK" }]
      );
    }
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
      const EXPIRY_LIMIT = refresh ? 1 * 1000 : 6 * 60 * 1000; // 10s for refresh, 6min default
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
          console.warn('⚠️ GG CDN failed, fallback to Firebase:', err.message);
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
        console.log('updated everything')
      }
    } catch (error) {
      console.error("❌ Error fetching stock data:", error);
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
// console.log(localState.ggData[0])
  useEffect(() => {
    if (!user?.id) return;

    // ✅ Mark user as online in local state & database
    updateLocalStateAndDatabase('online', true);

    // ✅ Ensure user is marked offline upon disconnection (only applies to Firebase)
    const userOnlineRef = ref(appdatabase, `/users/${user.id}/online`);

    onDisconnect(userOnlineRef)
      .set(false)
      .catch((error) => console.error("🔥 Error setting onDisconnect:", error));

    return () => {
      // ✅ Cleanup: Mark user offline when the app is closed
      updateLocalStateAndDatabase('online', false);
    };
  }, [user?.id]);

  // console.log(user)

  const contextValue = useMemo(
    () => ({
      user,
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
      robloxUsernameRef, api
    }),
    [user, onlineMembersCount, theme, fetchStockData, loading, robloxUsernameRef, api,freeTranslation]
  );

  return (
    <GlobalStateContext.Provider value={contextValue}>
      {children}
    </GlobalStateContext.Provider>
  );
};


