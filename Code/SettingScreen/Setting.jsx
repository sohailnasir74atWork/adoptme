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
import { ref, remove, get, update, set } from '@react-native-firebase/database';
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
  const [userReviews, setUserReviews] = useState([]); // Reviews user gave to others
  const [receivedReviews, setReceivedReviews] = useState([]); // Reviews others gave to user
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [loadingReceivedReviews, setLoadingReceivedReviews] = useState(false);
  const [editingReview, setEditingReview] = useState(null);
  const [editReviewText, setEditReviewText] = useState('');
  const [editReviewRating, setEditReviewRating] = useState(0);
  const [lastGaveDoc, setLastGaveDoc] = useState(null); // Last document for pagination (gave)
  const [lastReceivedDoc, setLastReceivedDoc] = useState(null); // Last document for pagination (received)
  const [hasMoreGave, setHasMoreGave] = useState(false); // Whether there are more "gave" reviews
  const [hasMoreReceived, setHasMoreReceived] = useState(false); // Whether there are more "received" reviews
  const [showGaveReviewsModal, setShowGaveReviewsModal] = useState(false); // Modal visibility for gave reviews
  const [showReceivedReviewsModal, setShowReceivedReviewsModal] = useState(false); // Modal visibility for received reviews
  const [modalGaveReviews, setModalGaveReviews] = useState([]); // Reviews shown in gave modal
  const [modalReceivedReviews, setModalReceivedReviews] = useState([]); // Reviews shown in received modal
  const [modalLastGaveDoc, setModalLastGaveDoc] = useState(null); // Last doc for modal pagination (gave)
  const [modalLastReceivedDoc, setModalLastReceivedDoc] = useState(null); // Last doc for modal pagination (received)
  const [modalHasMoreGave, setModalHasMoreGave] = useState(false); // Whether there are more gave reviews
  const [modalHasMoreReceived, setModalHasMoreReceived] = useState(false); // Whether there are more received reviews
  const [loadingModalGaveReviews, setLoadingModalGaveReviews] = useState(false);
  const [loadingModalReceivedReviews, setLoadingModalReceivedReviews] = useState(false);
  const [robloxUsername, setRobloxUsername] = useState('');
  const [robloxUsernameVerified, setRobloxUsernameVerified] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [isVerifyingRoblox, setIsVerifyingRoblox] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [bio, setBio] = useState('');
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [ratingSummary, setRatingSummary] = useState(null);
  const [loadingRating, setLoadingRating] = useState(false);
  const [createdAtText, setCreatedAtText] = useState(null);




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
    // ✅ Check if user is pro - if not, show upgrade alert
    if (!localState.isPro) {
      Alert.alert(
        "Pro Feature",
        "Buy a plan to unlock this feature",
        [
          { text: t("home.cancel"), style: 'cancel' },
          {
            text: "Upgrade",
            style: 'default',
            onPress: () => setShowofferWall(true),
          },
        ]
      );
      return;
    }

    // ✅ Pro users can toggle freely
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

  // ✅ Handle online status visibility toggle
  const handleToggleOnlineStatus = async (value) => {
    // ✅ Check if user is pro - if not, show upgrade alert
    if (!localState.isPro) {
      Alert.alert(
        "Pro Feature",
        "Buy a plan to unlock this feature",
        [
          { text: t("home.cancel"), style: 'cancel' },
          {
            text: "Upgrade",
            style: 'default',
            onPress: () => setShowofferWall(true),
          },
        ]
      );
      return;
    }

    // ✅ Pro users can toggle freely
    updateLocalState('showOnlineStatus', value);
    
    if (user?.id && appdatabase) {
      try {
        const onlineUsersRef = ref(appdatabase, `/online_users/${user.id}`);
        if (value) {
          // ✅ Show online status - add to online_users
          await set(onlineUsersRef, true).catch((error) => 
            console.error("🔥 Error adding to online_users:", error)
          );
        } else {
          // ✅ Hide online status - remove from online_users to save Firebase costs
          await remove(onlineUsersRef).catch((error) => 
            console.error("🔥 Error removing from online_users:", error)
          );
        }
      } catch (error) {
        console.error('Error updating online status visibility:', error);
      }
    }
  };

  // ✅ Generate verification code for Roblox username
  const generateVerificationCode = () => {
    const code = `AMV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    setVerificationCode(code);
    return code;
  };

  // ✅ Verify Roblox username exists and get user ID
  const verifyRobloxUsername = async (username) => {
    if (!username || username.trim().length < 3) {
      return { valid: false, error: 'Username must be at least 3 characters' };
    }

    try {
      // ✅ Use POST request with JSON body (correct Roblox API format)
      const response = await fetch(
        'https://users.roblox.com/v1/usernames/users',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            usernames: [username.trim()],
            excludeBannedUsers: false,
          }),
        }
      );
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const data = await response.json();
      
      // ✅ Check if data exists and has results
      if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        return { valid: false, error: 'Username not found on Roblox. Please check spelling.' };
      }

      const robloxUser = data.data[0];
      if (!robloxUser || !robloxUser.id) {
        return { valid: false, error: 'Invalid user data received from Roblox' };
      }

      return {
        valid: true,
        userId: robloxUser.id,
        displayName: robloxUser.displayName || username,
      };
    } catch (error) {
      console.error('Error verifying Roblox username:', error);
      return { valid: false, error: `Failed to verify username: ${error.message || 'Please try again.'}` };
    }
  };

  // ✅ Check if verification code exists in Roblox profile description
  const checkVerificationCode = async (username, code) => {
    try {
      // Get user ID from username
      const verifyResult = await verifyRobloxUsername(username);
      if (!verifyResult.valid) {
        return { verified: false, error: verifyResult.error };
      }

      // Get user profile (description is publicly accessible)
      const profileResponse = await fetch(
        `https://users.roblox.com/v1/users/${verifyResult.userId}`
      );
      const profileData = await profileResponse.json();

      // Check if verification code exists in description
      const description = profileData.description || '';
      if (description.includes(code)) {
        return { verified: true, userId: verifyResult.userId };
      } else {
        return { verified: false, error: 'Verification code not found in your Roblox profile description' };
      }
    } catch (error) {
      console.error('Error checking verification code:', error);
      return { verified: false, error: 'Failed to verify. Please try again.' };
    }
  };

  // ✅ Handle Roblox username update with verification
  const handleUpdateRobloxUsername = async () => {
    if (!user?.id) {
      showErrorMessage('Error', 'Please login first');
      return;
    }

    const trimmedUsername = robloxUsername.trim();
    if (!trimmedUsername) {
      showErrorMessage('Error', 'Please enter a Roblox username');
      return;
    }

    // First verify username exists
    setIsVerifyingRoblox(true);
    const verifyResult = await verifyRobloxUsername(trimmedUsername);
    
    if (!verifyResult.valid) {
      setIsVerifyingRoblox(false);
      showErrorMessage('Invalid Username', verifyResult.error);
      return;
    }

    // Generate verification code
    const code = generateVerificationCode();
    setIsVerifyingRoblox(false);

    // Show instructions
    Alert.alert(
      'Verify Your Roblox Username',
      `To verify ownership, please:\n\n1. Go to your Roblox profile\n2. Edit your profile description\n3. Add this code: ${code}\n4. Save your profile\n5. Then click "I Added It" below`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'I Added It',
          onPress: async () => {
            setIsVerifyingRoblox(true);
            const result = await checkVerificationCode(trimmedUsername, code);
            
            if (result.verified) {
              // ✅ Save verified username to Firebase user node
              await updateLocalStateAndDatabase({
                robloxUsername: trimmedUsername,
                robloxUsernameVerified: true,
                robloxUserId: result.userId,
              });

              // ✅ Update local state
              setRobloxUsername(trimmedUsername);
              setRobloxUsernameVerified(true);
              
              // ✅ Update user state immediately for UI
              setUser((prev) => ({
                ...prev,
                robloxUsername: trimmedUsername,
                robloxUsernameVerified: true,
                robloxUserId: result.userId,
              }));
              
              showSuccessMessage('Success', 'Roblox username verified and saved!');
            } else {
              showErrorMessage('Verification Failed', result.error || 'Could not verify username');
            }
            setIsVerifyingRoblox(false);
          },
        },
      ]
    );
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
      // ✅ Load Roblox username if exists
      setRobloxUsername(user?.robloxUsername || '');
      setRobloxUsernameVerified(user?.robloxUsernameVerified || false);
    } else {
      setNewDisplayName('Guest User');
      setSelectedImage('https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
      setRobloxUsername('');
      setRobloxUsernameVerified(false);
    }

  }, [user]);

  // Load bio and rating from averageRatings node
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setBio('Hi there, I am new here');
      setRatingSummary(null);
      setCreatedAtText(null);
      setLoadingRating(false);
      return;
    }

    const loadBioAndRating = async () => {
      setLoadingRating(true);
      try {
        const [ratingSnap, createdSnap] = await Promise.all([
          get(ref(appdatabase, `averageRatings/${user.id}`)),
          get(ref(appdatabase, `users/${user.id}/createdAt`)),
        ]);

        // Load bio
        if (ratingSnap.exists()) {
          const data = ratingSnap.val();
          setBio(data.bio || 'Hi there, I am new here');
          setRatingSummary({
            value: Number(data.value || 0),
            count: Number(data.count || 0),
          });
        } else {
          setBio('Hi there, I am new here');
          setRatingSummary(null);
        }

        // Load joined date
        if (createdSnap.exists()) {
          const raw = createdSnap.val();
          let ts = typeof raw === 'number' ? raw : Date.parse(raw);
          if (!Number.isNaN(ts)) {
            const now = Date.now();
            const diffMs = now - ts;
            if (diffMs >= 0) {
              const minutes = Math.floor(diffMs / 60000);
              if (minutes < 1) setCreatedAtText('Just now');
              else if (minutes < 60) setCreatedAtText(`${minutes} min${minutes === 1 ? '' : 's'} ago`);
              else {
                const hours = Math.floor(minutes / 60);
                if (hours < 24) setCreatedAtText(`${hours} hour${hours === 1 ? '' : 's'} ago`);
                else {
                  const days = Math.floor(hours / 24);
                  if (days < 30) setCreatedAtText(`${days} day${days === 1 ? '' : 's'} ago`);
                  else {
                    const months = Math.floor(days / 30);
                    if (months < 12) setCreatedAtText(`${months} month${months === 1 ? '' : 's'} ago`);
                    else {
                      const years = Math.floor(months / 12);
                      setCreatedAtText(`${years} year${years === 1 ? '' : 's'} ago`);
                    }
                  }
                }
              }
            } else {
              setCreatedAtText(null);
            }
          } else {
            setCreatedAtText(null);
          }
        } else {
          setCreatedAtText(null);
        }
      } catch (error) {
        console.error('Error loading bio and rating:', error);
        setBio('Hi there, I am new here');
        setRatingSummary(null);
        setCreatedAtText(null);
      } finally {
        setLoadingRating(false);
      }
    };

    loadBioAndRating();
  }, [user?.id, appdatabase]);

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
    // if (!USERNAME_REGEX.test(newDisplayName)) {
    //   showErrorMessage(
    //     t("home.alert.error"),
    //     "Only letters, numbers, '-' and '_' are allowed in the username."
    //   );
    //   return;
    // }
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

    // ✅ Render stars for rating
    const renderStars = (value) => {
      const rounded = Math.round(value || 0);
      const full = '★'.repeat(Math.min(rounded, 5));
      const empty = '☆'.repeat(Math.max(0, 5 - rounded));
      return (
        <Text style={{ color: '#FFD700', fontSize: 14, fontWeight: '600' }}>
          {full}
          <Text style={{ color: '#999' }}>{empty}</Text>
        </Text>
      );
    };

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

// Don't load reviews initially - only load when modals open

// Load "gave" reviews modal when opens
useEffect(() => {
  if (!showGaveReviewsModal || !user?.id || !firestoreDB || !appdatabase) {
    return;
  }

  const loadGaveModalReviews = async () => {
    setLoadingModalGaveReviews(true);
    try {
      // Load initial batch of 5 reviews
      const gaveQuery = await getDocs(query(
        collection(firestoreDB, 'reviews'),
        where('fromUserId', '==', user.id),
        orderBy('updatedAt', 'desc'),
        limit(5)
      ));

      const gaveDocs = gaveQuery.docs;

      // Fetch user names for gave reviews
      const gaveWithNames = await Promise.all(
        gaveDocs.map(async (doc) => {
          const data = doc.data();
          try {
            const userRef = ref(appdatabase, `users/${data.toUserId}`);
            const userSnapshot = await get(userRef);
            const userData = userSnapshot.val();
            return {
              id: doc.id,
              ...data,
              type: 'gave',
              reviewedUserName: userData?.displayName || 'Unknown User',
              reviewedUserAvatar: userData?.avatar || null,
            };
          } catch (error) {
            return {
              id: doc.id,
              ...data,
              type: 'gave',
              reviewedUserName: 'Unknown User',
              reviewedUserAvatar: null,
            };
          }
        })
      );

      setModalGaveReviews(gaveWithNames);
      setModalLastGaveDoc(gaveDocs[gaveDocs.length - 1] || null);
      setModalHasMoreGave(gaveDocs.length === 5);
    } catch (error) {
      console.error('Error loading gave modal reviews:', error);
      setModalGaveReviews([]);
    } finally {
      setLoadingModalGaveReviews(false);
    }
  };

  loadGaveModalReviews();
}, [showGaveReviewsModal, user?.id, firestoreDB, appdatabase]);

// Load "received" reviews modal when opens
useEffect(() => {
  if (!showReceivedReviewsModal || !user?.id || !firestoreDB || !appdatabase) {
    return;
  }

  const loadReceivedModalReviews = async () => {
    setLoadingModalReceivedReviews(true);
    try {
      // Load initial batch of 5 reviews
      const receivedQuery = await getDocs(query(
        collection(firestoreDB, 'reviews'),
        where('toUserId', '==', user.id),
        orderBy('updatedAt', 'desc'),
        limit(5)
      ));

      const receivedDocs = receivedQuery.docs;

      // Fetch user names for received reviews
      const receivedWithNames = await Promise.all(
        receivedDocs.map(async (doc) => {
          const data = doc.data();
          try {
            const userRef = ref(appdatabase, `users/${data.fromUserId}`);
            const userSnapshot = await get(userRef);
            const userData = userSnapshot.val();
            return {
              id: doc.id,
              ...data,
              type: 'received',
              reviewerName: userData?.displayName || 'Unknown User',
              reviewerAvatar: userData?.avatar || null,
            };
          } catch (error) {
            return {
              id: doc.id,
              ...data,
              type: 'received',
              reviewerName: 'Unknown User',
              reviewerAvatar: null,
            };
          }
        })
      );

      setModalReceivedReviews(receivedWithNames);
      setModalLastReceivedDoc(receivedDocs[receivedDocs.length - 1] || null);
      setModalHasMoreReceived(receivedDocs.length === 5);
    } catch (error) {
      console.error('Error loading received modal reviews:', error);
      setModalReceivedReviews([]);
    } finally {
      setLoadingModalReceivedReviews(false);
    }
  };

  loadReceivedModalReviews();
}, [showReceivedReviewsModal, user?.id, firestoreDB, appdatabase]);

// Load more "gave" reviews in modal - keeps loading until all are fetched
const loadMoreGaveModalReviews = useCallback(async () => {
  if (!user?.id || !firestoreDB || !appdatabase || loadingModalGaveReviews || !modalLastGaveDoc) return;

  setLoadingModalGaveReviews(true);
  try {
    let lastDoc = modalLastGaveDoc;
    let allNewReviews = [];
    let hasMore = true;

    // Keep loading in batches until all reviews are fetched
    while (hasMore && lastDoc) {
      const gaveQuery = await getDocs(query(
        collection(firestoreDB, 'reviews'),
        where('fromUserId', '==', user.id),
        orderBy('updatedAt', 'desc'),
        startAfter(lastDoc),
        limit(20) // Load 20 at a time for efficiency
      ));

      const gaveDocs = gaveQuery.docs;
      
      if (gaveDocs.length > 0) {
        const gaveWithNames = await Promise.all(
          gaveDocs.map(async (doc) => {
            const data = doc.data();
            try {
              const userRef = ref(appdatabase, `users/${data.toUserId}`);
              const userSnapshot = await get(userRef);
              const userData = userSnapshot.val();
              return {
                id: doc.id,
                ...data,
                type: 'gave',
                reviewedUserName: userData?.displayName || 'Unknown User',
                reviewedUserAvatar: userData?.avatar || null,
              };
            } catch (error) {
              return {
                id: doc.id,
                ...data,
                type: 'gave',
                reviewedUserName: 'Unknown User',
                reviewedUserAvatar: null,
              };
            }
          })
        );

        allNewReviews.push(...gaveWithNames);
        lastDoc = gaveDocs[gaveDocs.length - 1];
        hasMore = gaveDocs.length === 20; // If we got 20, there might be more
      } else {
        hasMore = false;
      }
    }

    if (allNewReviews.length > 0) {
      setModalGaveReviews((prev) => [...prev, ...allNewReviews]);
      setModalLastGaveDoc(lastDoc);
    }
    setModalHasMoreGave(hasMore);
  } catch (error) {
    console.error('Error loading more gave modal reviews:', error);
    setModalHasMoreGave(false);
  } finally {
    setLoadingModalGaveReviews(false);
  }
}, [user?.id, firestoreDB, appdatabase, modalLastGaveDoc, loadingModalGaveReviews]);

// Load more "received" reviews in modal - keeps loading until all are fetched
const loadMoreReceivedModalReviews = useCallback(async () => {
  if (!user?.id || !firestoreDB || !appdatabase || loadingModalReceivedReviews || !modalLastReceivedDoc) return;

  setLoadingModalReceivedReviews(true);
  try {
    let lastDoc = modalLastReceivedDoc;
    let allNewReviews = [];
    let hasMore = true;

    // Keep loading in batches until all reviews are fetched
    while (hasMore && lastDoc) {
      const receivedQuery = await getDocs(query(
        collection(firestoreDB, 'reviews'),
        where('toUserId', '==', user.id),
        orderBy('updatedAt', 'desc'),
        startAfter(lastDoc),
        limit(20) // Load 20 at a time for efficiency
      ));

      const receivedDocs = receivedQuery.docs;
      
      if (receivedDocs.length > 0) {
        const receivedWithNames = await Promise.all(
          receivedDocs.map(async (doc) => {
            const data = doc.data();
            try {
              const userRef = ref(appdatabase, `users/${data.fromUserId}`);
              const userSnapshot = await get(userRef);
              const userData = userSnapshot.val();
              return {
                id: doc.id,
                ...data,
                type: 'received',
                reviewerName: userData?.displayName || 'Unknown User',
                reviewerAvatar: userData?.avatar || null,
              };
            } catch (error) {
              return {
                id: doc.id,
                ...data,
                type: 'received',
                reviewerName: 'Unknown User',
                reviewerAvatar: null,
              };
            }
          })
        );

        allNewReviews.push(...receivedWithNames);
        lastDoc = receivedDocs[receivedDocs.length - 1];
        hasMore = receivedDocs.length === 20; // If we got 20, there might be more
      } else {
        hasMore = false;
      }
    }

    if (allNewReviews.length > 0) {
      setModalReceivedReviews((prev) => [...prev, ...allNewReviews]);
      setModalLastReceivedDoc(lastDoc);
    }
    setModalHasMoreReceived(hasMore);
  } catch (error) {
    console.error('Error loading more received modal reviews:', error);
    setModalHasMoreReceived(false);
  } finally {
    setLoadingModalReceivedReviews(false);
  }
}, [user?.id, firestoreDB, appdatabase, modalLastReceivedDoc, loadingModalReceivedReviews]);

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
      {activeTab === "profile" ?   <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.cardContainer}>
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
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
              <Text style={!user?.id ? styles.userNameLogout : styles.userName}>
                {!user?.id ? t("settings.login_register") : displayName}
                </Text>
                {user?.isPro &&  
        <Image
        source={require('../../assets/pro.png')} 
                    style={{ width: 14, height: 14, marginLeft: 4 }} 
                  />
                }
                {/* ✅ Roblox Verification Badge */}
                {user?.id && user?.robloxUsername && (
                  <View style={{ 
                    marginLeft: 6, 
                    backgroundColor: user?.robloxUsernameVerified ? '#4CAF50' : '#FFA500', 
                    paddingHorizontal: 6, 
                    paddingVertical: 2, 
                    borderRadius: 4 
                  }}>
                    <Text style={{ color: '#fff', fontSize: 9, fontWeight: '600' }}>
                      {user?.robloxUsernameVerified ? '✓ Verified' : '⚠ Unverified'}
              </Text>
                  </View>
                )}
              </View>
              
              {/* Roblox Username Display */}
              {user?.id && user?.robloxUsername && (
                <Text
                  style={{
                    fontSize: 11,
                    color: '#00A8FF', // Nice blue color for Roblox
                    marginTop: 4,
                    fontWeight: '500',
                  }}
                >
                  @{user.robloxUsername}
                </Text>
              )}
              
              {!user?.id && <Text style={styles.rewardLogout}>{t('settings.login_description')}</Text>}
              {user?.id && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <Text style={styles.reward}>{t("settings.my_points")}: {user?.rewardPoints || 0}</Text>
                  {/* {user?.robloxUsername && (
                    <Text style={[styles.reward, { marginLeft: 8, fontSize: 11, opacity: 0.7 }]}>
                      • Roblox: {user.robloxUsername}
                    </Text>
                  )} */}
                </View>
              )}
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={handleProfileUpdate}>
            {user?.id && <Icon name="create" size={24} color={'#566D5D'} />}
          </TouchableOpacity>
        </View>

        {/* ⭐ Rating summary - Below profile picture section */}
        {user?.id && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 12,
              marginBottom: 12,
              paddingVertical: 8,
              paddingHorizontal: 12,
              backgroundColor: isDarkMode ? '#1b1b1b' : '#f2f2f2',
              borderRadius: 8,
            }}
          >
            {loadingRating ? (
              <ActivityIndicator
                size="small"
                color={config.colors.primary}
              />
            ) : ratingSummary ? (
              <>
                {renderStars(ratingSummary.value)}
                <Text
                  style={{
                    marginLeft: 6,
                    fontSize: 12,
                    color: isDarkMode ? '#e5e7eb' : '#4b5563',
                  }}
                >
                  {ratingSummary.value.toFixed(1)} / 5 ·{' '}
                  {ratingSummary.count} rating
                  {ratingSummary.count === 1 ? '' : 's'}
                </Text>
              </>
            ) : (
              <Text
                style={{
                  fontSize: 12,
                  color: isDarkMode ? '#9ca3af' : '#6b7280',
                }}
              >
                Not rated yet
              </Text>
            )}

            {!loadingRating && createdAtText && (
              <Text
                style={{
                  fontSize: 10,
                  backgroundColor: isDarkMode ? '#FACC15' : '#16A34A',
                  paddingHorizontal: 5,
                  borderRadius: 4,
                  paddingVertical: 1,
                  color: 'white',
                  marginLeft: 5,
                }}
              >
                Joined {createdAtText}
              </Text>
            )}
          </View>
        )}

        {/* 📝 Bio Section - Below rating box */}
        {user?.id && (
          <View
            style={{
              borderRadius: 12,
              padding: 12,
              backgroundColor: isDarkMode ? '#0f172a' : '#f3f4f6',
              marginBottom: 12,
            }}
          >
            <Text
              style={{
                fontSize: 14,
                fontFamily: 'Lato-Bold',
                marginBottom: 6,
                color: isDarkMode ? '#e5e7eb' : '#111827',
              }}
            >
              Bio
            </Text>
            <Text
              style={{
                fontSize: 13,
                color: isDarkMode ? '#e5e7eb' : '#111827',
                lineHeight: 18,
              }}
            >
              {bio || 'Hi there, I am new here'}
            </Text>
          </View>
        )}
        
        {/* Flag Visibility Toggle */}
        {user?.id && (
          <View style={styles.option}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
              <TouchableOpacity 
                style={{ flexDirection: 'row', alignItems: 'center' }}
                onPress={() => handleToggleFlag(!localState.showFlag)}
              >
                <Icon name="flag-outline" size={18} color={'white'} style={{backgroundColor:'#FF6B6B', padding:5, borderRadius:5}} />
                <Text style={styles.optionText}>Hide Country Flag</Text>
              </TouchableOpacity>
              <Switch
                value={localState.showFlag ?? true}
                onValueChange={handleToggleFlag}
              />
            </View>
          </View>
        )}
        
        {/* ✅ Show Online Status Toggle */}
        <View style={styles.option}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
            <TouchableOpacity 
              style={{ flexDirection: 'row', alignItems: 'center' }}
              onPress={() => handleToggleOnlineStatus(!localState.showOnlineStatus)}
            >
              <Icon name="radio-button-on-outline" size={18} color={'white'} style={{backgroundColor:'#4CAF50', padding:5, borderRadius:5}} />
              <Text style={styles.optionText}>Hide Online Status</Text>
            </TouchableOpacity>
            <Switch
              value={localState.showOnlineStatus ?? true}
              onValueChange={handleToggleOnlineStatus}
            />
          </View>
        </View>

        {/* ✅ Roblox Username Section */}
        {user?.id && (
          <View style={styles.option}>
            <View style={{ width: '100%' }}>
              {/* Header with icon and label */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Icon 
                  name="game-controller-outline" 
                  size={18} 
                  color={'white'} 
                  style={{
                    backgroundColor: '#00A8FF', 
                    padding: 5, 
                    borderRadius: 5, 
                    marginRight: 8
                  }} 
                />
                <Text style={styles.optionText}>Roblox Username</Text>
                {robloxUsernameVerified && (
                  <View style={{ 
                    marginLeft: 8, 
                    backgroundColor: '#4CAF50', 
                    paddingHorizontal: 6, 
                    paddingVertical: 2, 
                    borderRadius: 4 
                  }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>
                      ✓ Verified
                    </Text>
                  </View>
                )}
              </View>
              
              {/* Input and Verify button row */}
              <View style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                marginBottom: 4,
                width: '100%',
              }}>
                <TextInput
                  style={{
                    flex: 1,
                    marginRight: 8,
                    backgroundColor: isDarkMode ? '#1b1b1b' : '#f2f2f2',
                    color: isDarkMode ? '#fff' : '#000',
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 6,
                    fontSize: 14,
                    height: 30,
                  }}
                  placeholder="Enter your Roblox username"
                  placeholderTextColor={isDarkMode ? '#888' : '#999'}
                  value={robloxUsername}
                  onChangeText={setRobloxUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {isVerifyingRoblox ? (
                  <View style={{ 
                    height: 30, 
                    justifyContent: 'center', 
                    alignItems: 'center',
                    width: 80,
                  }}>
                    <ActivityIndicator size="small" color={config.colors.primary} />
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={handleUpdateRobloxUsername}
                    style={{
                      backgroundColor: config.colors.primary,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 6,
                      minWidth: 80,
                      height: 30,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>
                      {robloxUsernameVerified ? 'Re-verify' : 'Verify'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              
              {/* Warning text for unverified */}
              {robloxUsername && !robloxUsernameVerified && (
                <Text style={{ 
                  fontSize: 11, 
                  color: '#FFA500', 
                  marginTop: 4,
                  marginLeft: 0,
                }}>
                  ⚠️ Unverified - Click "Verify" to prove ownership
                </Text>
              )}
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

        {/* Reviews Section - Two Small Modern Buttons */}
        <View style={styles.reviewsSection}>
          <Text style={{ fontSize: 14, fontFamily: 'Lato-Bold', color: isDarkMode ? '#e5e7eb' : '#111827', marginBottom: 12 }}>
            Reviews
          </Text>

          {!user?.id ? (
            <Text style={styles.reviewsEmptyText}>
              Login to see your reviews
            </Text>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {/* Reviews I Gave Button */}
              <TouchableOpacity
                onPress={() => setShowGaveReviewsModal(true)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
                  borderRadius: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
                }}
              >
                <Icon name="star" size={18} color="#4A90E2" style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: isDarkMode ? '#e5e7eb' : '#111827' }}>
                  I Gave
                </Text>
              </TouchableOpacity>

              {/* Reviews I Received Button */}
              <TouchableOpacity
                onPress={() => setShowReceivedReviewsModal(true)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
                  borderRadius: 10,
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
                }}
              >
                <Icon name="heart" size={18} color="#9B59B6" style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: isDarkMode ? '#e5e7eb' : '#111827' }}>
                  I Received
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
        </View>
      </ScrollView>

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

              {/* Bio Editing Section */}
              <Text style={[styles.drawerSubtitle, { marginTop: 16, marginBottom: 8 }]}>
                Bio
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ 
                  fontSize: 11, 
                  color: bio.length > 120 ? '#EF4444' : (isDarkMode ? '#9ca3af' : '#6b7280'),
                  fontWeight: '500',
                  marginLeft: 'auto'
                }}>
                  {bio.length}/120
                </Text>
              </View>
              <TextInput
                style={[
                  styles.input,
                  { 
                    minHeight: 60,
                    textAlignVertical: 'top',
                    paddingTop: 10,
                  },
                ]}
                placeholder="Hi there, I am new here"
                placeholderTextColor="#999"
                value={bio}
                onChangeText={(text) => {
                  if (text.length <= 120) {
                    setBio(text);
                  }
                }}
                maxLength={120}
                multiline={true}
                numberOfLines={3}
                autoCapitalize="sentences"
                autoCorrect={true}
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

      {/* Reviews I Gave Modal */}
      <Modal
        visible={showGaveReviewsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowGaveReviewsModal(false);
          setModalGaveReviews([]);
          setModalLastGaveDoc(null);
          setModalHasMoreGave(false);
        }}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => {
            setShowGaveReviewsModal(false);
            setModalGaveReviews([]);
            setModalLastGaveDoc(null);
            setModalHasMoreGave(false);
          }}
        />
        <View style={{ 
          flex: 1, 
          justifyContent: 'flex-end',
          backgroundColor: 'rgba(0,0,0,0.5)' 
        }}>
          <View style={[styles.drawer, { maxHeight: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={styles.drawerSubtitle}>Reviews I Gave</Text>
              <TouchableOpacity onPress={() => {
                setShowGaveReviewsModal(false);
                setModalGaveReviews([]);
                setModalLastGaveDoc(null);
                setModalHasMoreGave(false);
              }}>
                <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {loadingModalGaveReviews && modalGaveReviews.length === 0 ? (
                <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
              ) : modalGaveReviews.length === 0 ? (
                <Text style={{ textAlign: 'center', color: isDarkMode ? '#9ca3af' : '#6b7280', marginVertical: 20 }}>
                  No reviews found
                </Text>
              ) : (
                <>
                  {modalGaveReviews.map((review) => (
                    <View
                      key={review.id}
                      style={{
                        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
                        borderRadius: 12,
                        padding: 12,
                        marginBottom: 12,
                        borderWidth: 1,
                        borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: isDarkMode ? '#e5e7eb' : '#111827', marginBottom: 4 }}>
                            {review.reviewedUserName || 'Unknown User'}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Icon
                                key={star}
                                name={star <= review.rating ? 'star' : 'star-outline'}
                                size={14}
                                color={star <= review.rating ? '#FFD700' : '#ccc'}
                                style={{ marginRight: 2 }}
                              />
                            ))}
                            {review.edited && (
                              <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#6b7280', marginLeft: 6 }}>
                                (Edited)
                              </Text>
                            )}
                          </View>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            setShowGaveReviewsModal(false);
                            handleEditReview(review);
                          }}
                          style={{ padding: 4 }}
                        >
                          <Icon name="create-outline" size={18} color={config.colors.primary} />
                        </TouchableOpacity>
                      </View>
                      <Text style={{ fontSize: 13, color: isDarkMode ? '#d1d5db' : '#4b5563', lineHeight: 18, marginBottom: 6 }}>
                        {review.review}
                      </Text>
                      {review.updatedAt && (
                        <Text style={{ fontSize: 11, color: isDarkMode ? '#9ca3af' : '#9ca3af' }}>
                          {review.updatedAt.toDate ? 
                            new Date(review.updatedAt.toDate()).toLocaleDateString() :
                            new Date(review.updatedAt).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                  ))}

                  {modalHasMoreGave && (
                    <TouchableOpacity
                      style={{
                        backgroundColor: config.colors.primary,
                        paddingVertical: 12,
                        paddingHorizontal: 16,
                        borderRadius: 8,
                        alignItems: 'center',
                        marginTop: 8,
                        marginBottom: 16,
                      }}
                      onPress={loadMoreGaveModalReviews}
                      disabled={loadingModalGaveReviews}
                    >
                      {loadingModalGaveReviews ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                          Load More
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Reviews I Received Modal */}
      <Modal
        visible={showReceivedReviewsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowReceivedReviewsModal(false);
          setModalReceivedReviews([]);
          setModalLastReceivedDoc(null);
          setModalHasMoreReceived(false);
        }}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => {
            setShowReceivedReviewsModal(false);
            setModalReceivedReviews([]);
            setModalLastReceivedDoc(null);
            setModalHasMoreReceived(false);
          }}
        />
        <View style={{ 
          flex: 1, 
          justifyContent: 'flex-end',
          backgroundColor: 'rgba(0,0,0,0.5)' 
        }}>
          <View style={[styles.drawer, { maxHeight: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={styles.drawerSubtitle}>Reviews I Received</Text>
              <TouchableOpacity onPress={() => {
                setShowReceivedReviewsModal(false);
                setModalReceivedReviews([]);
                setModalLastReceivedDoc(null);
                setModalHasMoreReceived(false);
              }}>
                <Icon name="close" size={24} color={isDarkMode ? '#fff' : '#000'} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {loadingModalReceivedReviews && modalReceivedReviews.length === 0 ? (
                <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
              ) : modalReceivedReviews.length === 0 ? (
                <Text style={{ textAlign: 'center', color: isDarkMode ? '#9ca3af' : '#6b7280', marginVertical: 20 }}>
                  No reviews found
                </Text>
              ) : (
                <>
                  {modalReceivedReviews.map((review) => (
                    <View
                      key={review.id}
                      style={{
                        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
                        borderRadius: 12,
                        padding: 12,
                        marginBottom: 12,
                        borderWidth: 1,
                        borderColor: isDarkMode ? '#1f2937' : '#e5e7eb',
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: isDarkMode ? '#e5e7eb' : '#111827', marginBottom: 4 }}>
                            {review.reviewerName || 'Unknown User'}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Icon
                                key={star}
                                name={star <= review.rating ? 'star' : 'star-outline'}
                                size={14}
                                color={star <= review.rating ? '#FFD700' : '#ccc'}
                                style={{ marginRight: 2 }}
                              />
                            ))}
                            {review.edited && (
                              <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#6b7280', marginLeft: 6 }}>
                                (Edited)
                              </Text>
                            )}
                          </View>
                        </View>
                      </View>
                      <Text style={{ fontSize: 13, color: isDarkMode ? '#d1d5db' : '#4b5563', lineHeight: 18, marginBottom: 6 }}>
                        {review.review}
                      </Text>
                      {review.updatedAt && (
                        <Text style={{ fontSize: 11, color: isDarkMode ? '#9ca3af' : '#9ca3af' }}>
                          {review.updatedAt.toDate ? 
                            new Date(review.updatedAt.toDate()).toLocaleDateString() :
                            new Date(review.updatedAt).toLocaleDateString()}
                        </Text>
                      )}
                    </View>
                  ))}

                  {modalHasMoreReceived && (
                    <TouchableOpacity
                      style={{
                        backgroundColor: config.colors.primary,
                        paddingVertical: 12,
                        paddingHorizontal: 16,
                        borderRadius: 8,
                        alignItems: 'center',
                        marginTop: 8,
                        marginBottom: 16,
                      }}
                      onPress={loadMoreReceivedModalReviews}
                      disabled={loadingModalReceivedReviews}
                    >
                      {loadingModalReceivedReviews ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                          Load More
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

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