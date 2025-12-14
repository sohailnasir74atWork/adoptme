import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  TextInput,
  FlatList,
  Modal,
  Pressable,
  Alert,
  ScrollView,
  Switch,
  Linking,
  Platform,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { getStyles } from './settingstyle';
import { handleGetSuggestions, handleOpenFacebook, handleOpenWebsite, handleRateApp, handleadoptme, handleShareApp, imageOptions, handleBloxFruit, handleRefresh, handleReport, handleOpenPrivacy, handleOpenChild} from './settinghelper';
import { logoutUser } from '../Firebase/UserLogics';
import SignInDrawer from '../Firebase/SigninDrawer';
import auth from '@react-native-firebase/auth';
import { resetUserState } from '../Globelhelper';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import notifee from '@notifee/react-native';
import SubscriptionScreen from './OfferWall';
import { ref, remove, get, update } from '@react-native-firebase/database';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { useLanguage } from '../Translation/LanguageProvider';
import { useTranslation } from 'react-i18next';
import { getFlag } from '../Helper/CountryCheck';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { setAppLanguage } from '../../i18n';
import { Image as CompressorImage } from 'react-native-compressor';
import RNFS from 'react-native-fs';


import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  startAfter,
} from '@react-native-firebase/firestore';
import PetModal from '../ChatScreen/PrivateChat/PetsModel';
import { launchImageLibrary } from 'react-native-image-picker';
// Bunny avatar upload (same zone/keys as your post uploader)
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY   = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE     = 'https://pull-gag.b-cdn.net';

// ~500 KB max for avatar (small, DP-friendly)
const MAX_AVATAR_SIZE_BYTES = 500 * 1024;


export default function SettingsScreen({ selectedTheme }) {
  const [isDrawerVisible, setDrawerVisible] = useState(false);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [openSingnin, setOpenSignin] = useState(false);
  const { user, theme, updateLocalStateAndDatabase, setUser, appdatabase, firestoreDB , single_offer_wall} = useGlobalState()
  const { updateLocalState, localState, mySubscriptions } = useLocalState()
  const [isPermissionGranted, setIsPermissionGranted] = useState(false);
  const [showOfferWall, setShowofferWall] = useState(false);
  const { language, changeLanguage } = useLanguage();
  const [ownedPets, setOwnedPets] = useState([]);
const [wishlistPets, setWishlistPets] = useState([]);
const [petModalVisible, setPetModalVisible] = useState(false);
const [owned, setOwned] = useState(false);
const [avatarSearch, setAvatarSearch] = useState('');
const [uploadingAvatar, setUploadingAvatar] = useState(false);
const [activeTab, setActiveTab] = useState("profile"); // "profile" | "app"
  const [activeReviewsTab, setActiveReviewsTab] = useState("gave"); // "gave" | "received"
  const [userReviews, setUserReviews] = useState([]); // Reviews user gave to others
  const [receivedReviews, setReceivedReviews] = useState([]); // Reviews others gave to user
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [loadingReceivedReviews, setLoadingReceivedReviews] = useState(false);
  const [editingReview, setEditingReview] = useState(null);
  const [editReviewText, setEditReviewText] = useState('');
  const [editReviewRating, setEditReviewRating] = useState(0);
  const [displayedGaveCount, setDisplayedGaveCount] = useState(2); // How many "gave" reviews to show
  const [displayedReceivedCount, setDisplayedReceivedCount] = useState(2); // How many "received" reviews to show
  const [lastGaveDoc, setLastGaveDoc] = useState(null); // Last document for pagination (gave)
  const [lastReceivedDoc, setLastReceivedDoc] = useState(null); // Last document for pagination (received)
  const [hasMoreGave, setHasMoreGave] = useState(false); // Whether there are more "gave" reviews
  const [hasMoreReceived, setHasMoreReceived] = useState(false); // Whether there are more "received" reviews




  const { t } = useTranslation();
  const BASE_ADOPTME_URL = 'https://elvebredd.com';


  const SettingsTabs = () => (
    <View
      style={{
        flexDirection: "row",
        // marginHorizontal: 12,
        marginTop: 4,
        marginBottom: 4,
        backgroundColor: isDarkMode ? "#1b1b1b" : "#f2f2f2",
        borderRadius: 6,
        padding: 4,
      }}
    >
      {[
        { key: "profile", label: "Profile Settings" },
        { key: "app", label: "App Settings" },
      ].map((t) => {
        const isActive = activeTab === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              alignItems: "center",
              backgroundColor: isActive ? config.colors.primary : "transparent",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Lato-Bold",
                color: isActive ? "#fff" : (isDarkMode ? "#ddd" : "#333"),
              }}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const ReviewsTabs = () => (
    <View
      style={{
        flexDirection: "row",
        marginTop: 4,
        marginBottom: 4,
        backgroundColor: isDarkMode ? "#1b1b1b" : "#f2f2f2",
        borderRadius: 6,
        padding: 4,
      }}
    >
      {[
        { key: "gave", label: "Reviews I Gave" },
        { key: "received", label: "Reviews I Received" },
      ].map((t) => {
        const isActive = activeReviewsTab === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            onPress={() => setActiveReviewsTab(t.key)}
            style={{
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              alignItems: "center",
              backgroundColor: isActive ? config.colors.primary : "transparent",
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Lato-Bold",
                color: isActive ? "#fff" : (isDarkMode ? "#ddd" : "#333"),
              }}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const parsedValuesData = useMemo(() => {
    try {
      const raw = localState?.data;
      if (!raw) return [];

      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

      // Convert object map to array if needed
      return Array.isArray(parsed) ? parsed : Object.values(parsed || {});
    } catch (e) {
      console.log('Error parsing localState.data', e);
      return [];
    }
  }, [localState?.data]);

  const petAvatarOptions = useMemo(() => {
    if (!parsedValuesData?.length) return [];

    return parsedValuesData
      .filter(item => item?.image && item?.name)
      .map(item => {
        const path = item.image.startsWith('/') ? item.image : `/${item.image}`;
        return {
          url: `${BASE_ADOPTME_URL}${path}`,
          name: item.name,
          type: item.type || 'pet',
        };
      });
  }, [parsedValuesData]);

  const defaultAvatarOptions = useMemo(
    () =>
      imageOptions.map((url, index) => ({
        url,
        name: `Icon ${index + 1}`,
        type: 'default',
      })),
    [imageOptions]
  );

  const avatarOptions = useMemo(
    () => [...petAvatarOptions, ...defaultAvatarOptions],
    [defaultAvatarOptions, petAvatarOptions]
  );
  


  // Final list: existing `imageOptions` + options from values data
  const filteredAvatarOptions = useMemo(() => {
    const q = avatarSearch.trim().toLowerCase();
    if (!q) return avatarOptions;

    return avatarOptions.filter(opt => {
      // Always keep default icons
      if (opt.type === 'default') return true;
      return opt.name?.toLowerCase().includes(q);
    });
  }, [avatarSearch, avatarOptions]);
  const handlePickAndUploadAvatar = useCallback(async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
      });

      if (!result.assets?.length) return;

      const asset = result.assets[0];

      setUploadingAvatar(true);

      // 🔹 Compress to small DP-friendly size
      const compressedUri = await CompressorImage.compress(asset.uri, {
        maxWidth: 300,
        quality: 0.7,
      });

      const filePath = compressedUri.replace('file://', '');
      const stat = await RNFS.stat(filePath);

      // 🔹 Reject heavy images
      if (stat.size > MAX_AVATAR_SIZE_BYTES) {
        Alert.alert(
          'Image too large',
          'Please choose a smaller image (max ~500 KB) or crop it before uploading.'
        );
        setUploadingAvatar(false);
        return;
      }

      const userId = user?.id ?? 'anon';
      const filename = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
      const remotePath = `avatars/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
      const uploadUrl = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`;

      const base64 = await RNFS.readFile(filePath, 'base64');
      const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));

      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          AccessKey: BUNNY_ACCESS_KEY,
          'Content-Type': 'application/octet-stream',
        },
        body: binary,
      });

      const txt = await res.text().catch(() => '');

      if (!res.ok) {
        console.warn('[Bunny avatar ERROR]', res.status, txt?.slice(0, 200));
        Alert.alert('Upload failed', 'Could not upload image. Please try again.');
        setUploadingAvatar(false);
        return;
      }

      const publicUrl = `${BUNNY_CDN_BASE}/${decodeURIComponent(remotePath)}`;

      // ✅ Set as current selected profile image
      setSelectedImage(publicUrl);
    } catch (e) {
      console.warn('[Avatar upload]', e?.message || e);
      Alert.alert('Upload failed', 'Something went wrong. Please try again.');
    } finally {
      setUploadingAvatar(false);
    }
  }, [user?.id]);



  const { triggerHapticFeedback } = useHaptic();
  const themes = [t('settings.theme_system'), t('settings.theme_light'), t('settings.theme_dark')];
    // const themes = ['System', 'Light','Dark'];

  const handleToggle = (value) => {
    updateLocalState('isHaptic', value); // Update isHaptic state globally
  };

  // ✅ Handle flag visibility toggle
  const handleToggleFlag = async (value) => {
    updateLocalState('showFlag', value);
    
    if (user?.id && appdatabase) {
      try {
        const userRef = ref(appdatabase, `users/${user.id}`);
        if (value) {
          // ✅ Show flag - store it
          const flagValue = getFlag();
          await update(userRef, { flage: flagValue });
          // Update local user state
          setUser((prev) => ({ ...prev, flage: flagValue }));
        } else {
          // ✅ Hide flag - remove it from Firebase to save data
          await update(userRef, { flage: null });
          // Update local user state
          setUser((prev) => ({ ...prev, flage: null }));
        }
      } catch (error) {
        console.error('Error updating flag visibility:', error);
      }
    }
  };



  const languageOptions = [
    { code: "en", label: t("settings.languages.en"), flag: "🇺🇸" },
    { code: "fil", label: t("settings.languages.fil"), flag: "🇵🇭" },
    { code: "vi", label: t("settings.languages.vi"), flag: "🇻🇳" },
    { code: "pt", label: t("settings.languages.pt"), flag: "🇵🇹" },
    { code: "id", label: t("settings.languages.id"), flag: "🇮🇩" },
    { code: "es", label: t("settings.languages.es"), flag: "🇪🇸" },
    { code: "fr", label: t("settings.languages.fr"), flag: "🇫🇷" },
    { code: "de", label: t("settings.languages.de"), flag: "🇩🇪" },
    { code: "ru", label: t("settings.languages.ru"), flag: "🇷🇺" },
    { code: "ar", label: t("settings.languages.ar"), flag: "🇸🇦" }
  ];


  const isDarkMode = theme === 'dark';
  useEffect(() => {
    if (user && user?.id) {
      setNewDisplayName(user?.displayName?.trim() || 'Anonymous');
      setSelectedImage(user?.avatar?.trim() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
    } else {
      setNewDisplayName('Guest User');
      setSelectedImage('https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
    }

  }, [user]);
  useEffect(() => { }, [mySubscriptions])

  useEffect(() => {
    const checkPermission = async () => {
      const settings = await notifee.getNotificationSettings();
      setIsPermissionGranted(settings.authorizationStatus === 1); // 1 means granted
    };

    checkPermission();
  }, []);

  // Request permission
  const requestPermission = async () => {
    try {
      const settings = await notifee.requestPermission();
      if (settings.authorizationStatus === 0) {
        Alert.alert(
          t("settings.permission_required"),
          t("settings.notification_permissions_disabled"),
          [
            { text:  t("home.cancel"), style: 'cancel' },
            {
              text:  t("settings.go_to_settings"),
              onPress: () => Linking.openSettings(), // Redirect to app settings
            },
          ]
        );
        return false; // Permission not granted
      }

      if (settings.authorizationStatus === 1) {
        setIsPermissionGranted(true); // Update state if permission granted
        return true;
      }
    } catch (error) {
      // console.error('Error requesting notification permission:', error);
      // Alert.alert(t("home.error"), 'An error occurred while requesting notification permissions.');
      return false;
    }
  };

  // Handle toggle
  const handleToggleNotification = async (value) => {
    if (value) {
      // If enabling notifications, request permission
      const granted = await requestPermission();
      setIsPermissionGranted(granted);
    } else {
      // If disabling, update the state
      setIsPermissionGranted(false);
    }
  };
  const USERNAME_REGEX = /^[A-Za-z0-9_-]+$/;

  const handleSaveChanges = async () => {

    triggerHapticFeedback('impactLight');
    const MAX_NAME_LENGTH = 20;

    if (!user?.id) return;

    if (newDisplayName.length > MAX_NAME_LENGTH) {
      showErrorMessage(
        t("home.alert.error"),
        t("settings.display_name_length_error")
      );
      return;
    }
    if (!USERNAME_REGEX.test(newDisplayName)) {
      showErrorMessage(
        t("home.alert.error"),
        "Only letters, numbers, '-' and '_' are allowed in the username."
      );
      return;
    }
    try {
      await updateLocalStateAndDatabase({
        displayName: newDisplayName.trim(),
        avatar: selectedImage.trim(),
      });

      setDrawerVisible(false);
      showSuccessMessage(
        t("home.alert.success"),
        t("settings.profile_success")
      );
    } catch (error) {
      // console.error('Error updating profile:', error);
    }
  };



  const displayName = user?.id
    ? newDisplayName?.trim() || user?.displayName || 'Anonymous'
    : 'Guest User';


    // ✅ Updated to match BottomDrawer square pet UI style
    const renderPetBubble = (pet, index) => {
      // ✅ Safety checks
      if (!pet || typeof pet !== 'object') return null;
    
      const valueType = (pet.valueType || 'd').toLowerCase();
      let rarityBg = '#FF6666';
      if (valueType === 'n') rarityBg = '#2ecc71';
      if (valueType === 'm') rarityBg = '#9b59b6';
    
      return (
        <View
          key={`${pet.id || pet.name || index}-${index}`}
          style={{
            width: 42,
            height: 42,
            marginRight: 6,
            borderRadius: 10,
            overflow: 'hidden',
            backgroundColor: isDarkMode ? '#0f172a' : '#e5e7eb',
          }}
        >
          <Image
            source={{ uri: pet.imageUrl || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
            style={{ width: '100%', height: '100%' }}
          />
          <View
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            {/* Rarity badge */}
            <View
              style={{
                paddingHorizontal: 3,
                paddingVertical: 1,
                borderRadius: 999,
                backgroundColor: rarityBg,
                marginLeft: 2,
              }}
            >
              <Text
                style={{
                  fontSize: 8,
                  fontWeight: '700',
                  color: '#fff',
                }}
              >
                {valueType.toUpperCase()}
              </Text>
            </View>
    
            {/* Fly badge */}
            {pet.isFly && (
              <View
                style={{
                  paddingHorizontal: 3,
                  paddingVertical: 1,
                  borderRadius: 999,
                  backgroundColor: '#3498db',
                  marginLeft: 2,
                }}
              >
                <Text
                  style={{ fontSize: 8, fontWeight: '700', color: '#fff' }}
                >
                  F
                </Text>
              </View>
            )}
    
            {/* Ride badge */}
            {pet.isRide && (
              <View
                style={{
                  paddingHorizontal: 3,
                  paddingVertical: 1,
                  borderRadius: 999,
                  backgroundColor: '#e74c3c',
                  marginLeft: 2,
                }}
              >
                <Text
                  style={{ fontSize: 8, fontWeight: '700', color: '#fff' }}
                >
                  R
                </Text>
              </View>
            )}
          </View>
        </View>
      );
    };
    
    
    // Later you’ll hook these into a modal / selector
    const handleManagePets = (owned) => {
      // e.g. open modal to pick owned pets
      owned === 'owned' ?  setOwned(true) : setOwned(false)
      setPetModalVisible(true)
    };
    
 // Load owned / wishlist pets from Firestore on screen load
 useEffect(() => {
  if (!user?.id || !firestoreDB) {
    setOwnedPets([]);
    setWishlistPets([]);
    return;
  }

  const userReviewRef = doc(firestoreDB, 'reviews', user.id);

  const unsubscribe = onSnapshot(userReviewRef, (docSnap) => {
    const data = docSnap.data();
    if (!data) {
      setOwnedPets([]);
      setWishlistPets([]);
      return;
    }

    setOwnedPets(Array.isArray(data.ownedPets) ? data.ownedPets : []);
    setWishlistPets(Array.isArray(data.wishlistPets) ? data.wishlistPets : []);
  });

  return () => unsubscribe();
}, [user?.id, firestoreDB]);

// Fetch reviews made by the current user (OPTIMIZED: only fetch what's needed)
useEffect(() => {
  if (!user?.id || !firestoreDB || !appdatabase) {
    setUserReviews([]);
    setLastGaveDoc(null);
    setHasMoreGave(false);
    return;
  }

  const fetchUserReviews = async () => {
    setLoadingReviews(true);
    try {
      // Only fetch 2 reviews initially + 1 extra to check if there are more
      const q = query(
        collection(firestoreDB, 'reviews'),
        where('fromUserId', '==', user.id),
        orderBy('updatedAt', 'desc'),
        limit(3) // Fetch 3 to check if more exist (we'll only use 2)
      );

      const snapshot = await getDocs(q);
      const docs = snapshot.docs;
      
      // Check if there are more reviews
      setHasMoreGave(docs.length > 2);
      
      // Only process the first 2 reviews
      const reviewsToProcess = docs.slice(0, 2);
      const reviewsData = reviewsToProcess.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Fetch user names ONLY for the 2 reviews we're displaying
      const reviewsWithNames = await Promise.all(
        reviewsData.map(async (review) => {
          try {
            const userRef = ref(appdatabase, `users/${review.toUserId}`);
            const userSnapshot = await get(userRef);
            const userData = userSnapshot.val();
            
            return {
              ...review,
              reviewedUserName: userData?.displayName || 'Unknown User',
              reviewedUserAvatar: userData?.avatar || null,
            };
          } catch (error) {
            console.error(`Error fetching user ${review.toUserId}:`, error);
            return {
              ...review,
              reviewedUserName: 'Unknown User',
              reviewedUserAvatar: null,
            };
          }
        })
      );

      setUserReviews(reviewsWithNames);
      
      // Store last document for pagination
      if (reviewsToProcess.length > 0) {
        setLastGaveDoc(reviewsToProcess[reviewsToProcess.length - 1]);
      }
    } catch (error) {
      console.error('Error fetching user reviews:', error);
      showErrorMessage('Error', 'Failed to load your reviews');
    } finally {
      setLoadingReviews(false);
    }
  };

  fetchUserReviews();
}, [user?.id, firestoreDB, appdatabase]);

// Fetch reviews received by the current user (OPTIMIZED: only fetch what's needed)
useEffect(() => {
  if (!user?.id || !firestoreDB || !appdatabase) {
    setReceivedReviews([]);
    setLastReceivedDoc(null);
    setHasMoreReceived(false);
    return;
  }

  const fetchReceivedReviews = async () => {
    setLoadingReceivedReviews(true);
    try {
      // Only fetch 2 reviews initially + 1 extra to check if there are more
      const q = query(
        collection(firestoreDB, 'reviews'),
        where('toUserId', '==', user.id),
        orderBy('updatedAt', 'desc'),
        limit(3) // Fetch 3 to check if more exist (we'll only use 2)
      );

      const snapshot = await getDocs(q);
      const docs = snapshot.docs;
      
      // Check if there are more reviews
      setHasMoreReceived(docs.length > 2);
      
      // Only process the first 2 reviews
      const reviewsToProcess = docs.slice(0, 2);
      const reviewsData = reviewsToProcess.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Fetch user names ONLY for the 2 reviews we're displaying
      const reviewsWithNames = await Promise.all(
        reviewsData.map(async (review) => {
          try {
            const userRef = ref(appdatabase, `users/${review.fromUserId}`);
            const userSnapshot = await get(userRef);
            const userData = userSnapshot.val();
            
            return {
              ...review,
              reviewerName: userData?.displayName || 'Unknown User',
              reviewerAvatar: userData?.avatar || null,
            };
          } catch (error) {
            console.error(`Error fetching reviewer ${review.fromUserId}:`, error);
            return {
              ...review,
              reviewerName: 'Unknown User',
              reviewerAvatar: null,
            };
          }
        })
      );

      setReceivedReviews(reviewsWithNames);
      
      // Store last document for pagination
      if (reviewsToProcess.length > 0) {
        setLastReceivedDoc(reviewsToProcess[reviewsToProcess.length - 1]);
      }
    } catch (error) {
      console.error('Error fetching received reviews:', error);
      showErrorMessage('Error', 'Failed to load received reviews');
    } finally {
      setLoadingReceivedReviews(false);
    }
  };

  fetchReceivedReviews();
}, [user?.id, firestoreDB, appdatabase]);

// Reset pagination when switching tabs (optional - can be removed if you want to keep state)
useEffect(() => {
  // Reset counts but keep loaded data to avoid unnecessary refetches
  setDisplayedGaveCount(userReviews.length || 2);
  setDisplayedReceivedCount(receivedReviews.length || 2);
}, [activeReviewsTab]);

// Load more "gave" reviews with pagination
const loadMoreGaveReviews = useCallback(async () => {
  if (!user?.id || !firestoreDB || !appdatabase || !lastGaveDoc || !hasMoreGave) {
    return;
  }

  setLoadingReviews(true);
  try {
    // Fetch next 2 reviews + 1 extra to check if more exist
    const q = query(
      collection(firestoreDB, 'reviews'),
      where('fromUserId', '==', user.id),
      orderBy('updatedAt', 'desc'),
      startAfter(lastGaveDoc),
      limit(3) // Fetch 3 to check if more exist (we'll only use 2)
    );

    const snapshot = await getDocs(q);
    const docs = snapshot.docs;
    
    // Check if there are more reviews
    setHasMoreGave(docs.length > 2);
    
    // Only process the first 2 reviews
    const reviewsToProcess = docs.slice(0, 2);
    const reviewsData = reviewsToProcess.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Fetch user names ONLY for the 2 new reviews
    const reviewsWithNames = await Promise.all(
      reviewsData.map(async (review) => {
        try {
          const userRef = ref(appdatabase, `users/${review.toUserId}`);
          const userSnapshot = await get(userRef);
          const userData = userSnapshot.val();
          
          return {
            ...review,
            reviewedUserName: userData?.displayName || 'Unknown User',
            reviewedUserAvatar: userData?.avatar || null,
          };
        } catch (error) {
          console.error(`Error fetching user ${review.toUserId}:`, error);
          return {
            ...review,
            reviewedUserName: 'Unknown User',
            reviewedUserAvatar: null,
          };
        }
      })
    );

    // Append new reviews
    setUserReviews((prev) => [...prev, ...reviewsWithNames]);
    setDisplayedGaveCount((prev) => prev + 2);
    
    // Update last document for pagination
    if (reviewsToProcess.length > 0) {
      setLastGaveDoc(reviewsToProcess[reviewsToProcess.length - 1]);
    }
  } catch (error) {
    console.error('Error loading more reviews:', error);
    showErrorMessage('Error', 'Failed to load more reviews');
  } finally {
    setLoadingReviews(false);
  }
}, [user?.id, firestoreDB, appdatabase, lastGaveDoc, hasMoreGave]);

// Load more "received" reviews with pagination
const loadMoreReceivedReviews = useCallback(async () => {
  if (!user?.id || !firestoreDB || !appdatabase || !lastReceivedDoc || !hasMoreReceived) {
    return;
  }

  setLoadingReceivedReviews(true);
  try {
    // Fetch next 2 reviews + 1 extra to check if more exist
    const q = query(
      collection(firestoreDB, 'reviews'),
      where('toUserId', '==', user.id),
      orderBy('updatedAt', 'desc'),
      startAfter(lastReceivedDoc),
      limit(3) // Fetch 3 to check if more exist (we'll only use 2)
    );

    const snapshot = await getDocs(q);
    const docs = snapshot.docs;
    
    // Check if there are more reviews
    setHasMoreReceived(docs.length > 2);
    
    // Only process the first 2 reviews
    const reviewsToProcess = docs.slice(0, 2);
    const reviewsData = reviewsToProcess.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Fetch user names ONLY for the 2 new reviews
    const reviewsWithNames = await Promise.all(
      reviewsData.map(async (review) => {
        try {
          const userRef = ref(appdatabase, `users/${review.fromUserId}`);
          const userSnapshot = await get(userRef);
          const userData = userSnapshot.val();
          
          return {
            ...review,
            reviewerName: userData?.displayName || 'Unknown User',
            reviewerAvatar: userData?.avatar || null,
          };
        } catch (error) {
          console.error(`Error fetching reviewer ${review.fromUserId}:`, error);
          return {
            ...review,
            reviewerName: 'Unknown User',
            reviewerAvatar: null,
          };
        }
      })
    );

    // Append new reviews
    setReceivedReviews((prev) => [...prev, ...reviewsWithNames]);
    setDisplayedReceivedCount((prev) => prev + 2);
    
    // Update last document for pagination
    if (reviewsToProcess.length > 0) {
      setLastReceivedDoc(reviewsToProcess[reviewsToProcess.length - 1]);
    }
  } catch (error) {
    console.error('Error loading more reviews:', error);
    showErrorMessage('Error', 'Failed to load more reviews');
  } finally {
    setLoadingReceivedReviews(false);
  }
}, [user?.id, firestoreDB, appdatabase, lastReceivedDoc, hasMoreReceived]);

    // Handle editing a review
    const handleEditReview = (review) => {
      setEditingReview(review);
      setEditReviewText(review.review || '');
      setEditReviewRating(review.rating || 0);
    };

    // Save edited review
    const handleSaveEditedReview = async () => {
      if (!editingReview || !firestoreDB || !user?.id) return;

      const trimmedReview = (editReviewText || '').trim();
      if (!trimmedReview) {
        showErrorMessage('Error', 'Review text cannot be empty');
        return;
      }

      try {
        // Document ID format: toUserId_fromUserId
        const reviewDocId = `${editingReview.toUserId}_${user.id}`;
        const reviewRef = doc(firestoreDB, 'reviews', reviewDocId);

        await setDoc(
          reviewRef,
          {
            fromUserId: user.id,
            toUserId: editingReview.toUserId,
            rating: editReviewRating,
            userName: user?.displayName || user?.displayname || null,
            review: trimmedReview,
            createdAt: editingReview.createdAt, // Preserve original
            updatedAt: serverTimestamp(),
            edited: true,
          },
          { merge: true }
        );

        // Update local state
        setUserReviews((prev) =>
          prev.map((r) =>
            r.id === editingReview.id
              ? {
                  ...r,
                  review: trimmedReview,
                  rating: editReviewRating,
                  updatedAt: new Date(),
                  edited: true,
                }
              : r
          )
        );

        showSuccessMessage('Success', 'Review updated successfully!');
        setEditingReview(null);
        setEditReviewText('');
        setEditReviewRating(0);
      } catch (error) {
        console.error('Error updating review:', error);
        showErrorMessage('Error', 'Failed to update review');
      }
    };

    // Call this after user finishes editing selection
    const savePetsToReviews = async (newOwned, newWishlist) => {
      if (!user?.id || !firestoreDB) return;
    
      const userReviewRef = doc(firestoreDB, 'reviews', user.id);
    
      await setDoc(
        userReviewRef,
        {
          ownedPets: newOwned,
          wishlistPets: newWishlist,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    
      setOwnedPets(newOwned);
      setWishlistPets(newWishlist);
    };
    
    

  const handleLogout = async () => {
    triggerHapticFeedback('impactLight');
    try {
      await logoutUser(setUser);
      showSuccessMessage(
        t("home.alert.success"),
        t("settings.logout_success")
      );
    } catch (error) {
      console.error('Error during logout:', error);
      showErrorMessage(
        t("home.alert.error"),
        t("settings.logout_error")
      );
    }
  };
  
  const handleDeleteUser = async () => {
    triggerHapticFeedback('impactLight');
  
    if (!user?.id) {
      showErrorMessage(t("home.alert.error"), t("settings.delete_error"));
      return;
    }
  
    const userId = user.id;
  
    // Step 1: Acknowledge irreversible action
    const showAcknowledgment = () =>
      new Promise((resolve, reject) => {
        Alert.alert(
          t("settings.delete_account"),
          t("settings.delete_account_warning"),
          [
            { text: t("home.cancel"), style: 'cancel', onPress: reject },
            { text: t("settings.proceed"), style: 'destructive', onPress: resolve },
          ]
        );
      });
  
    // Step 2: Final confirmation
    const showFinalConfirmation = () =>
      new Promise((resolve, reject) => {
        Alert.alert(
          t("settings.confirm_deletion"),
          t("settings.confirm_deletion_warning"),
          [
            { text: t("home.cancel"), style: 'cancel', onPress: reject },
            { text: t("trade.delete"), style: 'destructive', onPress: resolve },
          ]
        );
      });
  
    try {
      // Confirm both steps
      await showAcknowledgment();
      await showFinalConfirmation();
  
      // Step 3: Delete from Realtime DB
      const userRef = ref(appdatabase, `users/${userId}`);
      await remove(userRef);
  
      // Step 4: Delete from Firebase Auth
      const currentUser = auth().currentUser;
      if (currentUser) {
        await currentUser.delete(); // 🔐 Requires recent login
      } else {
        showErrorMessage(t("home.alert.error"), t("settings.user_not_found"));
        return;
      }
  
      // Step 5: Reset local state
      await resetUserState(setUser);
  
      // ✅ Success
      showSuccessMessage(
        t("home.alert.success"),
        t("settings.success_deleted")
      );
  
    } catch (error) {
      if (error?.code === 'auth/requires-recent-login') {
        showErrorMessage(
          t("settings.session_expired"),
          t("settings.session_expired_message")
        );
      } else if (error?.message) {
        showErrorMessage(
          t("home.alert.error"),
          error.message
        );
      } else {
        showErrorMessage(
          t("home.alert.error"),
          t("settings.delete_error")
        );
      }
    }
  };
  
  
  const manageSubscription = () => {
    const url = Platform.select({
      ios: 'https://apps.apple.com/account/subscriptions',
      android: 'https://play.google.com/store/account/subscriptions',
    });
  
    if (url) {
      Linking.openURL(url).catch((err) => {
        console.error('Error opening subscription manager:', err);
      });
    }
  };



  const handleProfileUpdate = () => {
    triggerHapticFeedback('impactLight');
    if (user?.id) {
      setDrawerVisible(true); // Open the profile drawer if the user is logged in
    } else {
      // Alert.alert(t("settings.notice"), t("settings.login_to_customize_profile")); // Show alert if user is not logged in
      showErrorMessage(
        t("settings.notice"),
        t("settings.login_to_customize_profile")
      );
    }
  };


const handleSelect = (lang) => {
  if(!localState.isPro){
    setShowofferWall(true)
  } else
 { setAppLanguage(lang); 
  changeLanguage(lang)}
}


const formatPlanName = (plan) => {
  // console.log(plan, 'plan');

  if (plan === 'MONTHLY' || plan === 'Blox_values_199_1m') return '1 MONTH';
  if (plan === 'QUARTERLY' || plan === 'Blox_values_499_3m') return '3 MONTHS';
  if (plan === 'YEARLY' || plan === 'Blox_values_999_1y') return '1 YEAR';

  return 'Anonymous Plan';
};


  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  return (
    <View style={styles.container}>
        <SettingsTabs />

      {/* User Profile Section */}
      {activeTab === "profile" ?   <View style={styles.cardContainer}>
        <View style={[styles.optionuserName, styles.option]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image
              source={
                typeof selectedImage === 'string' && selectedImage.trim()
                  ? { uri: selectedImage }
                  : { uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }
              }
              style={styles.profileImage}
            />
            <TouchableOpacity onPress={user?.id ? () => { } : () => { setOpenSignin(true) }} disabled={user?.id !== null}>
              <Text style={!user?.id ? styles.userNameLogout : styles.userName}>
                {!user?.id ? t("settings.login_register") : displayName}
                {user?.isPro &&  
        <Image
        source={require('../../assets/pro.png')} 
        style={{ width: 14, height: 14 }} 
      />
        }
              </Text>
              {!user?.id && <Text style={styles.rewardLogout}>{t('settings.login_description')}</Text>}
              {user?.id && <Text style={styles.reward}>{t("settings.my_points")}: {user?.rewardPoints || 0}</Text>}
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={handleProfileUpdate}>
            {user?.id && <Icon name="create" size={24} color={'#566D5D'} />}
          </TouchableOpacity>
        </View>
        
        {/* Flag Visibility Toggle */}
        {user?.id && (
          <View style={styles.option}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <TouchableOpacity 
                style={{ flexDirection: 'row', alignItems: 'center' }}
                onPress={() => handleToggleFlag(!localState.showFlag)}
              >
                <Icon name="flag-outline" size={18} color={'white'} style={{backgroundColor:'#FF6B6B', padding:5, borderRadius:5}} />
                <Text style={styles.optionText}>Show Country Flag</Text>
              </TouchableOpacity>
              <Switch
                value={localState.showFlag ?? true}
                onValueChange={handleToggleFlag}
              />
            </View>
          </View>
        )}
        
        <View style={styles.petsSection}>
  {/* Owned Pets */}
  <View style={[styles.petsColumn]}>
    <View style={styles.petsHeaderRow}>
      <Text style={styles.petsTitle}>
       Owned Pets
      </Text>
      {user?.id && (
        <TouchableOpacity onPress={()=>handleManagePets('owned')}>
          {user?.id && <Icon name="create" size={24} color={'#566D5D'} />}
        </TouchableOpacity>
      )}
    </View>

    {ownedPets.length === 0 ? (
      <Text style={styles.petsEmptyText}>
       {user?.id ? 'Select the pets you own' : 'Login to selected owned pets'}
      </Text>
    ) : (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 6 }}
      >
        <View style={{ flexDirection: 'row' }}>
        {ownedPets.map((pet, index) => renderPetBubble(pet, index))}
      </View>
      </ScrollView>
    )}
  </View>

  {/* Wishlist */}
  <View style={styles.petsColumn}>
    <View style={styles.petsHeaderRow}>
      <Text style={styles.petsTitle}>
        Wishlist
      </Text>
      {user?.id && (
        <TouchableOpacity onPress={()=>handleManagePets('wish')}>
         {user?.id && <Icon name="create" size={24} color={'#566D5D'} />}
        </TouchableOpacity>
      )}
    </View>

    {wishlistPets.length === 0 ? (
      <Text style={styles.petsEmptyText}>
     {user?.id ? 'Add pets you want' : 'Login & Add pets you want'}
      </Text>
    ) : (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 6 }}
      >
        <View style={{ flexDirection: 'row' }}>
          {wishlistPets.map((pet, index) => renderPetBubble(pet, index))}
        </View>
      </ScrollView>
    )}
  </View>
</View>

        {/* Reviews Section with Tabs */}
        <View style={styles.reviewsSection}>
          <ReviewsTabs />
          
          {/* Reviews I Gave Tab */}
          {activeReviewsTab === "gave" && (
            <>
              {!user?.id ? (
                <Text style={styles.reviewsEmptyText}>
                  Login to see your reviews
                </Text>
              ) : loadingReviews ? (
                <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
              ) : userReviews.length === 0 ? (
                <Text style={styles.reviewsEmptyText}>
                  You haven't reviewed anyone yet
                </Text>
              ) : (
                <>
                  <ScrollView style={styles.reviewsList} showsVerticalScrollIndicator={false}>
                    {userReviews.map((review) => (
                      <View key={review.id} style={styles.reviewItem}>
                        <View style={styles.reviewHeader}>
                          <View style={styles.reviewHeaderLeft}>
                            <Text style={styles.reviewUserName}>
                              {review.reviewedUserName || review.toUserId || 'Unknown User'}
                            </Text>
                            <View style={styles.reviewRating}>
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Icon
                                  key={star}
                                  name={star <= review.rating ? 'star' : 'star-outline'}
                                  size={14}
                                  color={star <= review.rating ? '#FFD700' : '#ccc'}
                                />
                              ))}
                            </View>
                            {review.edited && (
                              <Text style={styles.editedBadge}>(Edited)</Text>
                            )}
                          </View>
                          <TouchableOpacity
                            onPress={() => handleEditReview(review)}
                            style={styles.editButton}
                          >
                            <Icon name="create-outline" size={18} color={config.colors.primary} />
                          </TouchableOpacity>
                        </View>
                        <Text style={styles.reviewText}>{review.review}</Text>
                        {review.updatedAt && (
                          <Text style={styles.reviewDate}>
                            {review.updatedAt.toDate ? 
                              new Date(review.updatedAt.toDate()).toLocaleDateString() :
                              new Date(review.updatedAt).toLocaleDateString()}
                          </Text>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                  {hasMoreGave && (
                    <TouchableOpacity
                      style={styles.loadMoreButton}
                      onPress={loadMoreGaveReviews}
                      disabled={loadingReviews}
                    >
                      <Text style={styles.loadMoreText}>
                        {loadingReviews ? 'Loading...' : 'Load More'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </>
          )}

          {/* Reviews I Received Tab */}
          {activeReviewsTab === "received" && (
            <>
              {!user?.id ? (
                <Text style={styles.reviewsEmptyText}>
                  Login to see reviews you received
                </Text>
              ) : loadingReceivedReviews ? (
                <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
              ) : receivedReviews.length === 0 ? (
                <Text style={styles.reviewsEmptyText}>
                  No one has reviewed you yet
                </Text>
              ) : (
                <>
                  <ScrollView style={styles.reviewsList} showsVerticalScrollIndicator={false}>
                    {receivedReviews.map((review) => (
                      <View key={review.id} style={styles.reviewItem}>
                        <View style={styles.reviewHeader}>
                          <View style={styles.reviewHeaderLeft}>
                            <Text style={styles.reviewUserName}>
                              {review.reviewerName || review.fromUserId || 'Unknown User'}
                            </Text>
                            <View style={styles.reviewRating}>
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Icon
                                  key={star}
                                  name={star <= review.rating ? 'star' : 'star-outline'}
                                  size={14}
                                  color={star <= review.rating ? '#FFD700' : '#ccc'}
                                />
                              ))}
                            </View>
                            {review.edited && (
                              <Text style={styles.editedBadge}>(Edited)</Text>
                            )}
                          </View>
                        </View>
                        <Text style={styles.reviewText}>{review.review}</Text>
                        {review.updatedAt && (
                          <Text style={styles.reviewDate}>
                            {review.updatedAt.toDate ? 
                              new Date(review.updatedAt.toDate()).toLocaleDateString() :
                              new Date(review.updatedAt).toLocaleDateString()}
                          </Text>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                  {hasMoreReceived && (
                    <TouchableOpacity
                      style={styles.loadMoreButton}
                      onPress={loadMoreReceivedReviews}
                      disabled={loadingReceivedReviews}
                    >
                      <Text style={styles.loadMoreText}>
                        {loadingReceivedReviews ? 'Loading...' : 'Load More'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </>
              )}
            </>
          )}
        </View>

      </View>

     : <ScrollView showsVerticalScrollIndicator={false}>
        {/* <Text style={styles.subtitle}>{t('settings.app_settings')}</Text> */}
        <View style={styles.cardContainer}>
          <View style={styles.option} onPress={() => {
            handleToggle(); triggerHapticFeedback('impactLight');
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="radio-outline" size={18} color={'white'} style={{backgroundColor:'#B76E79', padding:5, borderRadius:5}} />
                <Text style={styles.optionText}>{t('settings.haptic_feedback')}</Text>
                </TouchableOpacity>
              <Switch value={localState.isHaptic} onValueChange={handleToggle} />
            </View>

          </View>
          <View style={styles.option} onPress={() => {
            handleShareApp(); triggerHapticFeedback('impactLight');
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="notifications" size={18} color={'white'} style={{backgroundColor:config.colors.hasBlockGreen, padding:5, borderRadius:5}}/>
                <Text style={styles.optionText}>{t('settings.chat_notifications')}</Text></TouchableOpacity>
              <Switch
                value={isPermissionGranted}
                onValueChange={handleToggleNotification}
              />
            </View>

          </View>

          <View style={styles.optionLast} onPress={() => {
            handleShareApp(); triggerHapticFeedback('impactLight');
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="contrast-outline" size={18} color={'white'} style={{backgroundColor:'#4A90E2', padding:5, borderRadius:5}}/>
                <Text style={styles.optionText}>{t('settings.theme')}</Text></TouchableOpacity>
              <View style={styles.containertheme}>
                {themes.map((theme, index) => (
                  <TouchableOpacity
                    key={theme}
                    style={[
                      styles.box,
                      localState.theme === ['system', 'light', 'dark'][index].toLowerCase() && styles.selectedBox, // Highlight selected box
                    ]}
                    onPress={() => updateLocalState('theme', ['system', 'light', 'dark'][index])}
                  >
                    
                    <Text
                    style={[
                      styles.text,
                      localState.theme === ['system', 'light', 'dark'][index] && styles.selectedText, // Highlight selected text
                    ]}
                  >
                    {theme}
                  </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            
          </View>
          {/* <View style={styles.optionLast} onPress={() => {
            HANDLEH(); triggerHapticFeedback('impactLight');
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Icon name="contrast-outline" size={18} color={'white'} style={{ backgroundColor: '#4A90E2', padding: 5, borderRadius: 5 }} />
                <Text style={styles.optionText}>Active Values</Text>
              </TouchableOpacity>
              <View style={styles.containertheme}>
                <TouchableOpacity
                  style={[styles.box, !localState.isGG && styles.selectedBox]}
                  onPress={() => { updateLocalState('isGG', false); handleRefresh(reload) }}
                >
                  <Text style={[styles.text, !localState.isGG && styles.selectedText]}>
                  Elvebredd Values
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.box, localState.isGG && styles.selectedBox]}
                  onPress={() => { updateLocalState('isGG', true); handleRefresh(reload) }}
                >
                  <Text style={[styles.text, localState.isGG && styles.selectedText]}>
                    GG Values
                  </Text>
                </TouchableOpacity>
              </View>

            </View>
          </View> */}
        </View>

        {/* <Text style={styles.subtitle}>{t('settings.language_settings')}</Text>
        <View style={styles.cardContainer}>
          <View style={[styles.optionLast, { flexDirection: 'row', justifyContent: 'space-between' }]}>
            <View style={{ flexDirection: 'row', }}>
          <Icon name="language-outline" size={18} color={'white'} style={{backgroundColor:'purple', padding:5, borderRadius:5}}/>

            <Text style={styles.optionText}>{t('settings.select_language')}</Text></View>

            <Menu>
              <MenuTrigger style={styles.menuTrigger}>
                <Text style={styles.optionText}>
                  {languageOptions.find(l => l.code === language)?.flag} {language.toUpperCase()} ▼
                </Text>
              </MenuTrigger>

              <MenuOptions style={styles.options}>
                {languageOptions.map((lang) => (
                  <MenuOption key={lang.code} onSelect={()=>handleSelect(lang.code)} style={styles.option_menu}>
                    <Text>
                      {lang.flag} {lang.label}
                    </Text>
                  </MenuOption>
                ))}
              </MenuOptions>
            </Menu>
          </View>
        </View> */}


        <Text style={styles.subtitle}>{t('settings.pro_subscription')}</Text>
        <View style={[styles.cardContainer, {backgroundColor:'#FFD700'}]}>

          <TouchableOpacity style={[styles.optionLast]} onPress={() => { setShowofferWall(true);     
 }}>
            <Icon name="prism-outline" size={18} color={'white'} style={{backgroundColor:config.colors.hasBlockGreen, padding:5, borderRadius:5}}/>
            <Text style={[styles.optionText, {color:'black'}]}>
            {t('settings.active_plan')} : {localState.isPro ? t('settings.paid') : t('settings.free')}
            </Text>
          </TouchableOpacity>
          {localState.isPro && (
            <View style={styles.subscriptionContainer}>
              <Text style={styles.subscriptionText}>
              {t('settings.active_plan')} - 
                  {mySubscriptions.length === 0
                  ?   t('settings.paid')
                  : mySubscriptions.map(sub => formatPlanName(sub.plan)).join(', ')}
              </Text>

              <TouchableOpacity onPress={manageSubscription} style={styles.manageButton}>
                <Text style={styles.manageButtonText}>{t('settings.manage')}</Text>
              </TouchableOpacity>

            </View>
          )}
        </View>
        <Text style={styles.subtitle}>{t('settings.other_settings')}</Text>

        <View style={styles.cardContainer}>


          <TouchableOpacity style={styles.option} onPress={() => {
            handleShareApp(); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="share-social-outline" size={18} color={'white'} style={{backgroundColor:'#B76E79', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>{t('settings.share_app')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.option} onPress={() => {
            handleGetSuggestions(user); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="mail-outline" size={18} color={'white'}  style={{backgroundColor:'#566D5D', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>{t('settings.give_suggestions')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.option} onPress={() => {
            handleReport(user); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="warning" size={18} color={'pink'}  style={{backgroundColor:'#566D5D', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>Report Abusive Content</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.option} onPress={() => { handleRateApp(); triggerHapticFeedback('impactLight'); }
          }>
            <Icon name="star-outline" size={18} color={'white'} style={{backgroundColor:'#A2B38B', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>{t('settings.rate_us')}</Text>
          </TouchableOpacity>
          {/* <TouchableOpacity style={styles.option} onPress={() => {
            handleOpenFacebook(); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="logo-facebook" size={18} color={'white'} style={{backgroundColor:'#566D5D', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>{t('settings.visit_facebook_group')}</Text>
          </TouchableOpacity> */}
          <TouchableOpacity style={user?.id ? styles.option : styles.optionLast} onPress={() => {
            handleOpenWebsite(); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="link-outline" size={18} color={'white'}  style={{backgroundColor:'#4B4453', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>{t('settings.visit_website')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={user?.id ? styles.option : styles.optionLast} onPress={() => {
            handleOpenPrivacy(); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="link-outline" size={18} color={'white'}  style={{backgroundColor:'green', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={user?.id ? styles.option : styles.optionLast} onPress={() => {
            handleOpenChild(); triggerHapticFeedback('impactLight');
          }}>
            <Icon name="link-outline" size={18} color={'white'}  style={{backgroundColor:'blue', padding:5, borderRadius:5}}/>
            <Text style={styles.optionText}>Child Safety Standards</Text>
          </TouchableOpacity>
          {user?.id && <TouchableOpacity style={styles.option} onPress={handleLogout} >
            <Icon name="person-outline" size={18} color={'white'} style={{backgroundColor:'#4B4453', padding:5, borderRadius:5}} />
            <Text style={styles.optionTextLogout}>{t('settings.logout')}</Text>
          </TouchableOpacity>}
          {user?.id && <TouchableOpacity style={styles.optionDelete} onPress={handleDeleteUser} >
            <Icon name="warning-outline" size={24} color={'#4B4453'} />
            <Text style={styles.optionTextDelete}>{t('settings.delete_my_account')}</Text>
          </TouchableOpacity>}

        </View>
        
        <Text style={styles.subtitle}>Our Other APPS</Text>
       
       <View style={styles.cardContainer}>


<TouchableOpacity style={styles.option} onPress={() => {
 handleBloxFruit(); triggerHapticFeedback('impactLight');
}}>
<Image 
 source={require('../../assets/logo.webp')} 
 style={{ width: 40, height: 40,   borderRadius: 5 }} 
/>

 <Text style={styles.optionText}>Blox Fruits Values</Text>
</TouchableOpacity>
<TouchableOpacity style={styles.optionLast} onPress={() => {
  handleadoptme(); triggerHapticFeedback('impactLight');
}}>
 <Image 
  source={require('../../assets/MM2logo.webp')} 
  style={{ width: 40, height: 40,   borderRadius: 5 }} 
/>

  <Text style={styles.optionText}>MM2 Values</Text>
</TouchableOpacity>



</View>
<Text style={styles.subtitle}>Business Enquiries
</Text>

<Text style={styles.textlink}>
   For collaborations, partnerships, or other business-related queries, feel free to contact us at:{' '}
   <TouchableOpacity onPress={() => Linking.openURL('mailto:thesolanalabs@gmail.com')}>
     <Text style={styles.emailText}>thesolanalabs@gmail.com</Text>
   </TouchableOpacity>
 </Text>
 {/* <Text style={styles.subtitle}>Our Other APPS</Text> */}
       
        {/* <View style={styles.cardContainer}> */}



{/* <TouchableOpacity style={styles.optionLast} onPress={() => {
            handleMM2(); triggerHapticFeedback('impactLight');
          }}>
            <Image
              source={require('../../assets/MM2logo.webp')}
              style={{ width: 40, height: 40, borderRadius: 5 }}
            />

            <Text style={styles.optionText}>MM2 Values</Text>
          </TouchableOpacity> */}


{/* </View> */}
{/* <Text style={styles.subtitle}>Business Enquiries
</Text> */}

{/* <Text style={styles.text}>
    For collaborations, partnerships, or other business-related queries, feel free to contact us at:{' '}
    <TouchableOpacity onPress={() => Linking.openURL('mailto:thesolanalabs@gmail.com')}>
      <Text style={styles.emailText}>thesolanalabs@gmail.com</Text>
    </TouchableOpacity>
  </Text> */}


      </ScrollView>}

      {/* Bottom Drawer */}
         {/* Bottom Drawer */}
         <Modal
        animationType="slide"
        transparent={true}
        visible={isDrawerVisible}
        onRequestClose={() => setDrawerVisible(false)}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => setDrawerVisible(false)}
        />
        <ConditionalKeyboardWrapper>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <View style={styles.drawer}>
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                {/* <Image
                  source={
                    typeof selectedImage === 'string' && selectedImage.trim()
                      ? { uri: selectedImage }
                      : { uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }
                  }
                  style={[
                    styles.profileImage,
                    { marginRight: 10, width: 30, height: 30, borderRadius: 15 },
                  ]}
                /> */}
                <View style={{ flex: 1 }}>
                  <Text style={styles.drawerSubtitle}>{t('settings.change_display_name')}</Text>
                  <TextInput
                    style={[styles.input, { marginTop: 4 }]}
                    placeholder="Enter new display name"
                    value={newDisplayName}
                    onChangeText={setNewDisplayName}
                  />
                </View>
              </View>

              {/* Profile Image Selection title */}
              <Text style={[styles.drawerSubtitle]}>
                {t('settings.select_profile_icon')}
              </Text>

          
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  {
                    backgroundColor: config.colors.secondary,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 10,
                  },
                ]}
                onPress={handlePickAndUploadAvatar}
                disabled={uploadingAvatar}
              >
                {uploadingAvatar ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Icon
                      name="cloud-upload-outline"
                      size={18}
                      color="#fff"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.saveButtonText}>
                      Upload from gallery
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <TextInput
                style={[
                  styles.input,
                  // { marginBottom: 8, fontSize: 12, paddingVertical: 6 },
                ]}
                placeholder="Search pets (e.g. Giraffe, Egg...)"
                placeholderTextColor="#999"
                value={avatarSearch}
                onChangeText={setAvatarSearch}
              />

              {/* Avatar list: defaults + pets (filtered) */}
              <FlatList
                data={filteredAvatarOptions}
                keyExtractor={(item, index) => `${item.url}-${index}`}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 4 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => setSelectedImage(item.url)}
                    style={[
                      styles.imageOptionWrapper,
                      selectedImage === item.url && styles.imageOptionSelected,
                      { alignItems: 'center', marginRight: 10 },
                    ]}
                  >
                    <Image
                      source={{ uri: item.url }}
                      style={styles.imageOption}
                    />
                    {/* {item.type !== 'default' && (
                      <Text
                        numberOfLines={1}
                        style={{
                          fontSize: 10,
                          marginTop: 4,
                          maxWidth: 70,
                          color: isDarkMode ? '#ddd' : '#333',
                        }}
                      >
                        {item.name}
                      </Text>
                    )} */}
                  </TouchableOpacity>
                )}
              />

              {/* Save button */}
              <TouchableOpacity
                style={[styles.saveButton, { marginTop: 16 }]}
                onPress={handleSaveChanges}
              >
                <Text style={styles.saveButtonText}>
                  {t('settings.save_changes')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ConditionalKeyboardWrapper>
      </Modal>

     
      <SubscriptionScreen visible={showOfferWall} onClose={() => setShowofferWall(false)} track='Setting' oneWallOnly={single_offer_wall} showoffer={!single_offer_wall}/>
      <SignInDrawer
        visible={openSingnin}
        onClose={() => setOpenSignin(false)}
        selectedTheme={selectedTheme}
        message='Signin to access all features'
         screen='Setting'
      />
            <PetModal fromSetting={true} ownedPets={ownedPets} setOwnedPets={setOwnedPets} wishlistPets={wishlistPets} setWishlistPets={setWishlistPets} onClose={async ()=>{{ setPetModalVisible(false); await savePetsToReviews(ownedPets, wishlistPets)}}}       visible={petModalVisible} owned={owned}
            />

      {/* Edit Review Modal */}
      <Modal
        visible={!!editingReview}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setEditingReview(null);
          setEditReviewText('');
          setEditReviewRating(0);
        }}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => {
            setEditingReview(null);
            setEditReviewText('');
            setEditReviewRating(0);
          }}
        />
        <ConditionalKeyboardWrapper>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <View style={styles.drawer}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={styles.drawerSubtitle}>Edit Review</Text>
                <TouchableOpacity
                  onPress={() => {
                    setEditingReview(null);
                    setEditReviewText('');
                    setEditReviewRating(0);
                  }}
                >
                  <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.drawerSubtitle, { marginBottom: 8 }]}>Rating</Text>
              <View style={{ flexDirection: 'row', marginBottom: 16 }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity
                    key={star}
                    onPress={() => setEditReviewRating(star)}
                    style={{ marginRight: 8 }}
                  >
                    <Icon
                      name={star <= editReviewRating ? 'star' : 'star-outline'}
                      size={32}
                      color={star <= editReviewRating ? '#FFD700' : '#ccc'}
                    />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.drawerSubtitle, { marginBottom: 8 }]}>Review</Text>
              <TextInput
                style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
                placeholder="Write your review..."
                placeholderTextColor="#999"
                value={editReviewText}
                onChangeText={setEditReviewText}
                multiline
                numberOfLines={4}
              />

              <TouchableOpacity
                style={[styles.saveButton, { marginTop: 16 }]}
                onPress={handleSaveEditedReview}
              >
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ConditionalKeyboardWrapper>
      </Modal>

    </View>
  );
}