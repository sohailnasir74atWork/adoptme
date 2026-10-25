import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
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
  Linking,
  Platform,
  ActivityIndicator,
  Animated,
  useWindowDimensions,
  StyleSheet,
  BackHandler,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { getStyles } from './settingstyle';
import { handleGetSuggestions, handleOpenFacebook, handleOpenWebsite, handleRateApp, handleadoptme, handleShareApp, imageOptions, handleBloxFruit, handleRefresh, handleReport, handleOpenPrivacy, handleOpenChild } from './settinghelper';
import { usePrivacyOptionsRequired, showPrivacyOptionsForm } from '../Ads/consentOptions';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import EmailUpdatesRow from './EmailUpdatesRow';
import { SettingsGroup, SettingsRow, SubPageHeader, getRowStyles, legacyRowProps } from './SettingsUI';
import DeviceInfo from 'react-native-device-info';
import BirthdayVisibilityRow from '../Birthdays/BirthdayVisibilityRow';
import { logoutUser } from '../Firebase/UserLogics';
import SignInDrawer from '../Firebase/SigninDrawer';
import { ensureGoogleSignInConfigured } from '../Firebase/googleSignInConfig';
import { markSignOutIntent } from '../Firebase/signOutIntent';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import auth from '@react-native-firebase/auth';
import { resetUserState, registerForNotifications } from '../Globelhelper';
import { syncValueUpdatesTopic } from '../Helper/valueUpdatesTopic';
import { requestPermission as askNotificationPermission } from '../Helper/PermissionCheck';
import ConditionalKeyboardWrapper from '../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import config from '../Helper/Environment';
import notifee from '@notifee/react-native';
import SubscriptionScreen from './OfferWall';
import { ref, remove, get, update, set } from '@react-native-firebase/database';
import { warmProfileCache, getCachedProfile, setCachedProfile, invalidateFullProfile } from '../Helper/profileCache';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
// useLanguage removed - using i18n from useTranslation hook
import { useTranslation } from 'react-i18next';
import { getFlag } from '../Helper/CountryCheck';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import { setAppLanguage, loadLanguage } from '../../i18n';
import { safeCompressImage } from '../Helper/safeCompressImage';
import RNFS from 'react-native-fs';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import UserBadgeRail from '../Helper/UserBadgeRail';
import { getMyCosmetics, setCachedUsername, setCachedAvatar } from '../Helper/cosmeticsCache';
import { addXP, getUserXP, getLevelFromXP } from '../Engagement/xpUtils';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';
// The same drawer every other screen opens on a player: "View my public
// profile" feeds it the signed-in user so they see exactly what others see.
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';


import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  startAfter,
  deleteDoc,
  writeBatch,
  runTransaction,
} from '@react-native-firebase/firestore';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

// Initialize dayjs plugins
dayjs.extend(relativeTime);
import PetModal from '../ChatScreen/PrivateChat/PetsModel';
import PortfolioValuation from './PortfolioValuation';
import GuidesScreen from './GuidesScreen';
import { useNavigation } from '@react-navigation/native';
import { openReportForm, reviewForReport } from '../Reports/openReportForm';
import { launchImageLibrary } from 'react-native-image-picker';
import { syncTradeInventory } from '../Helper/tradeMatch';
import { tradeStatus as wflStatus } from '../Helper/tradeStatus';
// Bunny avatar upload (same zone/keys as your post uploader)
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

// ~500 KB max for avatar (small, DP-friendly)
const MAX_AVATAR_SIZE_BYTES = 500 * 1024;
// You can't block yourself; a stable reference keeps the drawer's prop identity constant.
const NO_BANNED_USERS = [];

// Saved as the bio when a user leaves it empty. Stored in English, so the
// editor starts empty for it and the profile shows the translated default.
const DEFAULT_BIO_EN = 'Hi there, I am new here';

// Roblox bio code for this account. Derived from the uid so it never changes
// between attempts. Consonants only: Roblox's filter can hashtag digit runs
// and letter combos that spell words.
const ROBLOX_CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
const robloxVerificationCode = (uid) => {
  let h = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    h = Math.imul(h ^ uid.charCodeAt(i), 16777619);
  }
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += ROBLOX_CODE_LETTERS[(h >>> 0) % ROBLOX_CODE_LETTERS.length];
    h = Math.imul(h ^ (h >>> 15), 2246822507) + i;
  }
  return `AMV-${code}`;
};

// users.roblox.com rate-limits per IP (shared school/mobile IPs hit it fast):
// wait once and retry before giving up.
const fetchRoblox = async (url, options) => {
  const response = await fetch(url, options);
  if (response.status !== 429) return response;
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return fetch(url, options);
};

// Helper function to format item names
const formatTradeName = (name) => {
  if (!name || typeof name !== 'string') return '';
  let formattedName = name.replace(/^\+/, '');
  formattedName = formattedName.replace(/\s+/g, '-');
  return formattedName;
};

// Helper function to format values
const formatTradeValue = (value) => {
  if (!value || typeof value !== 'number') return '0';
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(1)}B`;
  } else if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  } else if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  } else {
    return value.toLocaleString();
  }
};

// Helper function to group items
const groupTradeItems = (items) => {
  if (!Array.isArray(items)) return [];
  const grouped = {};
  items.forEach(({ name, type }) => {
    const key = `${name}-${type}`;
    if (grouped[key]) {
      grouped[key].count += 1;
    } else {
      grouped[key] = { name, type, count: 1 };
    }
  });
  return Object.values(grouped);
};

// Helper function to get trade deal
const getTradeDeal = (hasTotal, wantsTotal) => {
  // Handle both number and object formats
  const hasValue = typeof hasTotal === 'number' ? hasTotal : hasTotal?.value;
  const wantsValue = typeof wantsTotal === 'number' ? wantsTotal : wantsTotal?.value;

  if (!hasValue || hasValue <= 0) {
    return { deal: { label: "trade.unknown_deal", color: "#8E8E93" }, tradeRatio: 0 };
  }

  const tradeRatio = wantsValue ? wantsValue / hasValue : 0;
  let deal;

  // Fair is the shared 5% rule (Helper/tradeStatus); great and decent
  // stretch to meet it, as fair used to span 0.75-1.25 here.
  if (wflStatus(hasValue, wantsValue) === 'fair') {
    deal = { label: "trade.fair_deal", color: "#FFCC00" };
  } else if (tradeRatio >= 0.05 && tradeRatio <= 0.6) {
    deal = { label: "trade.best_deal", color: "#34C759" };
  } else if (tradeRatio > 0.6 && tradeRatio < 1) {
    deal = { label: "trade.great_deal", color: "#32D74B" };
  } else if (tradeRatio > 1 && tradeRatio <= 1.4) {
    deal = { label: "trade.decent_deal", color: "#FF9F0A" };
  } else if (tradeRatio > 1.4 && tradeRatio <= 1.55) {
    deal = { label: "trade.weak_deal", color: "#D65A31" };
  } else {
    deal = { label: "trade.risky_deal", color: "#7D1128" };
  }

  return { deal, tradeRatio };
};

// Modern Minimalist Edit Profile Drawer Component
const EditProfileDrawerContent = ({
  isDarkMode,
  newDisplayName,
  setNewDisplayName,
  handlePickAndUploadAvatar,
  uploadingAvatar,
  avatarSearch,
  setAvatarSearch,
  filteredAvatarOptions,
  selectedImage,
  setSelectedImage,
  bio,
  setBio,
  handleSaveChanges,
  t,
  config,
  user,
}) => {
  const slideAnim = useRef(new Animated.Value(300)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const c = getThemeColors(isDarkMode);
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const { height: windowHeight } = useWindowDimensions();
  const PROFILE_EDIT_COOLDOWN_DAYS = 10;

  // ✅ Calculate cooldown status - only checks existing cooldown from last save, not unsaved changes
  const cooldownStatus = useMemo(() => {
    // ✅ Only check if user is in cooldown from their last saved edit
    // Cooldown is NOT triggered by making changes, only when they press "Save"
    if (!user?.lastProfileEditAt) {
      return { inCooldown: false, daysRemaining: 0 };
    }

    const lastEditTimestamp = typeof user.lastProfileEditAt === 'number'
      ? user.lastProfileEditAt
      : Date.parse(user.lastProfileEditAt);

    if (isNaN(lastEditTimestamp)) {
      return { inCooldown: false, daysRemaining: 0 };
    }

    const now = Date.now();
    const daysSinceLastEdit = (now - lastEditTimestamp) / (1000 * 60 * 60 * 24);
    const daysRemaining = Math.ceil(PROFILE_EDIT_COOLDOWN_DAYS - daysSinceLastEdit);

    return {
      inCooldown: daysSinceLastEdit < PROFILE_EDIT_COOLDOWN_DAYS,
      daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
    };
  }, [user?.lastProfileEditAt]);

  // ✅ Check if user is trying to save name/avatar changes (for save button state)
  const isTryingToSaveNameOrAvatar = useMemo(() => {
    const displayNameChanged = newDisplayName.trim() !== (user?.displayName || '').trim();
    const avatarChanged = (selectedImage || '').trim() !== (user?.avatar || '').trim();
    return { displayNameChanged, avatarChanged };
  }, [newDisplayName, selectedImage, user?.displayName, user?.avatar]);

  // ✅ Determine if save button should be disabled (only if in cooldown AND trying to save name)
  // 10-day cooldown applies ONLY to Display Name changes, NOT Avatar
  const shouldDisableSave = cooldownStatus.inCooldown && isTryingToSaveNameOrAvatar.displayNameChanged;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.drawer,
        {
          transform: [{ translateY: slideAnim }],
          opacity: fadeAnim,
        },
      ]}
    >
      <ScrollView
        // Cap the sheet height so tall content — especially on small screens
        // or when the keyboard is open — stays on screen and the Save button
        // is reachable by scrolling instead of being clipped off the bottom
        // (SwipeableBottomDrawer uses overflow:'hidden', so anything past the
        // fold was previously unreachable).
        style={{ maxHeight: windowHeight * 0.75 }}
        contentContainerStyle={{ padding: 14, paddingBottom: 18 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
      {/* Minimalist Header */}
      {/* <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <Text style={{ fontSize: 18, fontWeight: 'bold' , color: c.text }}>
          Edit Profile
        </Text>
        <View style={{
          width: 4,
          height: 4,
          borderRadius: 2,
          backgroundColor: config.colors.primary,
        }} />
      </View> */}

      {/* Display Name - Minimal Design */}
      <View style={{ marginBottom: 10 }}>
        <Text style={{ fontSize: 11, fontWeight: 'bold', color: c.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {t('settings.profile.display_name')}
        </Text>
        <TextInput
          style={{
            backgroundColor: c.bgAlt,
            padding: 12,
            borderRadius: 10,
            fontSize: 14,
            color: c.text,
            borderWidth: 0,
          }}
          placeholder={t('settings.profile.enter_name')}
          placeholderTextColor={c.textMuted}
          value={newDisplayName}
          onChangeText={setNewDisplayName}
        />
      </View>

      {/* Profile Picture - Clean Section */}
      <View style={{ marginBottom: 10 }}>
        <Text style={{ fontSize: 11, fontWeight: 'bold', color: c.textSecondary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {t('settings.profile.profile_picture')}
        </Text>

        <TouchableOpacity
          style={{
            backgroundColor: c.bgAlt,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            paddingVertical: 11,
            borderRadius: 10,
            marginBottom: 8,
          }}
          onPress={handlePickAndUploadAvatar}
          disabled={uploadingAvatar}
          activeOpacity={0.7}
        >
          {uploadingAvatar ? (
            <ActivityIndicator color={config.colors.primary} size="small" />
          ) : (
            <>
              <Icon
                name="cloud-upload-outline"
                size={16}
                color={config.colors.primary}
                style={{ marginRight: 6 }}
              />
              <Text style={{ color: config.colors.primary, fontSize: 13, fontWeight: 'bold' }}>
                {t('settings.profile.upload_photo')}
              </Text>
            </>
          )}
        </TouchableOpacity>

        <View style={{
          backgroundColor: c.bgAlt,
          borderRadius: 10,
          padding: 8,
          marginBottom: 8,
          flexDirection: 'row',
          alignItems: 'center',
        }}>
          <Icon name="search-outline" size={14} color={c.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={{
              flex: 1,
              fontSize: 13,
              color: c.text,
              padding: 0,
            }}
            placeholder={t('settings.profile.search_pets')}
            placeholderTextColor={c.textMuted}
            value={avatarSearch}
            onChangeText={setAvatarSearch}
          />
        </View>

        {/* Avatar Grid - Minimal */}
        <FlatList
          removeClippedSubviews={false}
          data={filteredAvatarOptions}
          keyExtractor={(item, index) => `${item.url}-${index}`}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingVertical: 4 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => setSelectedImage(item.url)}
              activeOpacity={0.7}
              style={{
                marginRight: 8,
                borderRadius: 20,
                borderWidth: selectedImage === item.url ? 2.5 : 0,
                borderColor: config.colors.primary,
                padding: selectedImage === item.url ? 2 : 0,
              }}
            >
              <Image resizeMethod="resize"
                source={{ uri: item.url }}
                style={{ width: 40, height: 40, borderRadius: 20, opacity: selectedImage === item.url ? 1 : 0.6 }}
              />
            </TouchableOpacity>
          )}
        />
      </View>

      {/* Bio - Clean Design */}
      <View style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: 'bold', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {t('settings.profile.bio')}
          </Text>
          <Text style={{
            fontSize: 10,
            color: bio.length > 120 ? '#EF4444' : (c.textMuted),
            fontWeight: 'bold',
          }}>
            {bio.length}/120
          </Text>
        </View>
        <TextInput
          style={{
            backgroundColor: c.bgAlt,
            minHeight: 65,
            textAlignVertical: 'top',
            padding: 12,
            borderRadius: 10,
            fontSize: 13,
            color: c.text,
            borderWidth: 0,
          }}
          placeholder={t('settings.profile.bio_placeholder')}
          placeholderTextColor={c.textMuted}
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
      </View>

      {/* ✅ Cooldown Warning Message - only show if trying to save name/avatar changes */}
      {shouldDisableSave && (
        <View
          style={{
            backgroundColor: isDarkMode ? '#1e293b' : '#fef3c7',
            padding: 12,
            borderRadius: 10,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: isDarkMode ? '#F59E0B' : '#FCD34D',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
            <Icon name="time-outline" size={16} color="#F59E0B" style={{ marginRight: 6 }} />
            <Text style={{
              fontSize: 12,
              fontWeight: 'bold',
              color: isDarkMode ? '#FCD34D' : '#92400E'
            }}>
              {t('settings.profile.edit_cooldown_active')}
            </Text>
          </View>
          <Text style={{
            fontSize: 11,

            color: isDarkMode ? '#FCD34D' : '#92400E',
            lineHeight: 16,
          }}>
            {t('settings.profile.edit_cooldown_info', { days: PROFILE_EDIT_COOLDOWN_DAYS })}{'\n'}
            {t('settings.profile.try_again_in', { count: cooldownStatus.daysRemaining })}{'\n'}
            {t('settings.profile.bio_anytime')}
          </Text>
        </View>
      )}

      {/* Modern Save Button */}
      <TouchableOpacity
        style={{
          backgroundColor: shouldDisableSave
            ? (isDarkMode ? '#374151' : '#9ca3af')
            : config.colors.primary,
          paddingVertical: 13,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: shouldDisableSave ? 0.6 : 1,
        }}
        onPress={handleSaveChanges}
        disabled={shouldDisableSave}
        activeOpacity={0.8}
      >
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: 'bold' }}>
          {shouldDisableSave
            ? t('settings.profile.edit_available_in', { count: cooldownStatus.daysRemaining })
            : t('settings.save_changes')}
        </Text>
      </TouchableOpacity>
      </ScrollView>
    </Animated.View>
  );
};

export default function SettingsScreen({ selectedTheme }) {
  const settingsNav = useNavigation();
  const [isDrawerVisible, setDrawerVisible] = useState(false);
  // Public-profile preview. The drawer starts loading the moment it has a
  // selectedUser (it does not wait for isVisible), so it is only mounted
  // while open or sliding closed: target = who it shows, visible = open.
  const [showPublicProfile, setShowPublicProfile] = useState(false);
  const [publicProfileTarget, setPublicProfileTarget] = useState(null);
  const publicProfileCloseTimer = useRef(null);
  const [newDisplayName, setNewDisplayName] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [openSingnin, setOpenSignin] = useState(false);
  const { user, theme, updateLocalStateAndDatabase, setUser, appdatabase, firestoreDB, single_offer_wall, isAdmin } = useGlobalState()
  const { updateLocalState, localState, mySubscriptions } = useLocalState()
  const [isPermissionGranted, setIsPermissionGranted] = useState(false);
  const [showOfferWall, setShowofferWall] = useState(false);
  // useLanguage hook removed - using i18n from useTranslation now
  const [ownedPets, setOwnedPets] = useState([]);
  const [wishlistPets, setWishlistPets] = useState([]);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [owned, setOwned] = useState(false);
  const [avatarSearch, setAvatarSearch] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  // In-screen sub-page of the grouped list: null | 'privacy' | 'help' | 'legal'.
  const [subPage, setSubPage] = useState(null);
  const [showRobloxSheet, setShowRobloxSheet] = useState(false);
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
  const [isVerifyingRoblox, setIsVerifyingRoblox] = useState(false);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [bio, setBio] = useState('');
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [ratingSummary, setRatingSummary] = useState(null);
  const [loadingRating, setLoadingRating] = useState(false);
  const [createdAtText, setCreatedAtText] = useState(null);
  const [showMyTradesModal, setShowMyTradesModal] = useState(false);
  const [modalMyTrades, setModalMyTrades] = useState([]);
  const [modalLastTradeDoc, setModalLastTradeDoc] = useState(null);
  const [modalHasMoreTrades, setModalHasMoreTrades] = useState(false);
  const [loadingModalMyTrades, setLoadingModalMyTrades] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [deletingTradeId, setDeletingTradeId] = useState(null);

  // Followers modal (load 2 by 2 like trades)
  const [showFollowersModal, setShowFollowersModal] = useState(false);
  const [modalFollowers, setModalFollowers] = useState([]);
  const [modalLastFollowerDoc, setModalLastFollowerDoc] = useState(null);
  const [modalHasMoreFollowers, setModalHasMoreFollowers] = useState(false);
  const [loadingModalFollowers, setLoadingModalFollowers] = useState(false);
  const [showGuidesModal, setShowGuidesModal] = useState(false);
  const [realStarBalance, setRealStarBalance] = useState(0);

  // Fetch real star balance from RTDB (not from user object).
  // onValue fires immediately with the current value, so the old
  // getStarBalance() seed call was a duplicate download of the same leaf.
  useEffect(() => {
    if (!user?.id || !appdatabase) return;
    const { ref: dbRef, onValue } = require('@react-native-firebase/database');
    const balRef = dbRef(appdatabase, `users/${user.id}/dailyStars/starBalance`);
    const unsub = onValue(balRef, (snap) => {
      setRealStarBalance(snap.exists() ? (snap.val() || 0) : 0);
    });
    return () => unsub();
  }, [user?.id, appdatabase]);


  // Load user's active cosmetics from MMKV cache (instant, no DB call)
  const myActiveCosmetics = useMemo(() => getMyCosmetics(), [subPage]);

  const { t, i18n } = useTranslation();
  // EEA/UK/CH users must be able to revisit their ad-consent choice from the
  // app menu (Google UMP requirement); everyone else never sees the row.
  const privacyOptionsRequired = usePrivacyOptionsRequired();
  const language = i18n.language; // ✅ Using i18n directly
  // ✅ Custom changeLanguage that lazy-loads and persists
  const changeLanguage = async (langCode) => {
    await loadLanguage(langCode);
    await setAppLanguage(langCode);
  };
  const BASE_ADOPTME_URL = 'https://elvebredd.com';


  // ✅ Fixed: 't' → 'tab', added Pressable + haptic for smooth switching
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
      const { uri: compressedUri } = await safeCompressImage(asset.uri, {
        maxWidth: 300,
        quality: 0.7,
      });

      const filePath = compressedUri.replace('file://', '');
      const stat = await RNFS.stat(filePath);

      // 🔹 Reject heavy images
      if (stat.size > MAX_AVATAR_SIZE_BYTES) {
        Alert.alert(
          t('settings.profile.image_too_large_title'),
          t('settings.profile.image_too_large_message')
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
        Alert.alert(t('settings.profile.upload_failed'), t('settings.profile.upload_error_image'));
        setUploadingAvatar(false);
        return;
      }

      const publicUrl = `${BUNNY_CDN_BASE}/${decodeURIComponent(remotePath)}`;

      // ✅ Set as current selected profile image
      setSelectedImage(publicUrl);
    } catch (e) {
      console.warn('[Avatar upload]', e?.message || e);
      Alert.alert(t('settings.profile.upload_failed'), t('settings.profile.upload_error_generic'));
    } finally {
      setUploadingAvatar(false);
    }
  }, [user?.id, t]);



  const { triggerHapticFeedback } = useHaptic();
  const themes = [t('settings.theme_system'), t('settings.theme_light'), t('settings.theme_dark')];
  // const themes = ['System', 'Light','Dark'];

  const handleToggle = (value) => {
    updateLocalState('isHaptic', value); // Update isHaptic state globally
  };

  // ✅ Handle read receipts toggle
  const handleToggleReadReceipts = (value) => {
    updateLocalState('showReadReceipts', value);
  };

  // ✅ Handle online status visibility toggle
  const handleToggleOnlineStatus = async (value) => {
    // ✅ Check if user is pro - if not, show upgrade alert
    if (!localState.isPro) {
      Alert.alert(
        t('settings.pro_feature.title'),
        t('settings.pro_feature.message'),
        [
          { text: t("home.cancel"), style: 'cancel' },
          {
            text: t("trade.upgrade"),
            style: 'default',
            onPress: () => setShowofferWall(true),
          },
        ]
      );
      return;
    }

    // ✅ Pro users can toggle freely
    // ✅ Just update local state - GlobelStats.js will handle RTDB update (presence/{uid})
    // ✅ Cloud Function will sync RTDB changes to Firestore online_users_node/list
    updateLocalState('showOnlineStatus', value);
  };

  // ✅ Verify Roblox username exists and get user ID
  const verifyRobloxUsername = async (username) => {
    if (!username || username.trim().length < 3) {
      return { valid: false, error: t('settings.roblox.username_too_short') };
    }

    try {
      // ✅ Use POST request with JSON body (correct Roblox API format)
      const response = await fetchRoblox(
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

      if (response.status === 429) {
        return { valid: false, error: t('settings.roblox.busy') };
      }
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      // ✅ Check if data exists and has results
      if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
        return { valid: false, error: t('settings.roblox.username_not_found') };
      }

      const robloxUser = data.data[0];
      if (!robloxUser || !robloxUser.id) {
        return { valid: false, error: t('settings.roblox.invalid_user_data') };
      }

      return {
        valid: true,
        userId: robloxUser.id,
        displayName: robloxUser.displayName || username,
      };
    } catch (error) {
      console.error('Error verifying Roblox username:', error);
      return { valid: false, error: t('settings.roblox.verify_error', { error: error.message || t('settings.roblox.verify_failed') }) };
    }
  };

  // ✅ Check if verification code exists in Roblox profile description.
  // userId comes from the lookup the caller already made — a second username
  // lookup only spent more of Roblox's per-IP rate limit.
  const checkVerificationCode = async (userId, code) => {
    try {
      // Get user profile (description is publicly accessible)
      const profileResponse = await fetchRoblox(
        `https://users.roblox.com/v1/users/${userId}`
      );
      // A 429 body has no description, which used to read as "code not found"
      // even when the code was in the bio.
      if (profileResponse.status === 429) {
        return { verified: false, retry: true, error: t('settings.roblox.busy') };
      }
      if (!profileResponse.ok) {
        return { verified: false, retry: true, error: t('settings.roblox.verify_failed') };
      }
      const profileData = await profileResponse.json();

      // Case and spaces don't matter: players retype the code by hand.
      const description = (profileData.description || '').toUpperCase().replace(/\s+/g, '');
      if (description.includes(code)) {
        return { verified: true, userId };
      } else {
        return { verified: false, error: t('settings.roblox.code_not_found') };
      }
    } catch (error) {
      console.error('Error checking verification code:', error);
      return { verified: false, retry: true, error: t('settings.roblox.verify_failed') };
    }
  };

  // ✅ Handle Roblox username update with verification
  const handleUpdateRobloxUsername = async () => {
    if (!user?.id) {
      showErrorMessage(t('alert.error'), t('signin.message')); // Reusing existing keys
      return;
    }

    const trimmedUsername = robloxUsername.trim();
    if (!trimmedUsername) {
      showErrorMessage(t('alert.error'), t('settings.roblox.enter_username'));
      return;
    }

    // First verify username exists
    setIsVerifyingRoblox(true);
    const verifyResult = await verifyRobloxUsername(trimmedUsername);

    if (!verifyResult.valid) {
      setIsVerifyingRoblox(false);
      showErrorMessage(t('settings.roblox.invalid_username_title'), verifyResult.error);
      return;
    }

    // Same code every time for this account, so the one already in the bio
    // still matches after a retry or after Android kills the app while the
    // player is in Roblox.
    const code = robloxVerificationCode(user.id);
    setIsVerifyingRoblox(false);

    // Show instructions
    Alert.alert(
      t('settings.roblox.verify_title'),
      t('settings.roblox.verify_instructions', { code }),
      [
        { text: t('home.cancel'), style: 'cancel' },
        {
          text: t('settings.roblox.copy_code'),
          onPress: () => {
            Clipboard.setString(code);
            showSuccessMessage(t('settings.roblox.code_copied_title'), t('settings.roblox.code_copied', { code }));
          },
        },
        {
          text: t('settings.roblox.i_added_it'),
          onPress: async () => {
            setIsVerifyingRoblox(true);
            const result = await checkVerificationCode(verifyResult.userId, code);

            // Roblox busy or unreachable: nothing was checked, so keep what is saved.
            if (result.retry) {
              setIsVerifyingRoblox(false);
              showErrorMessage(t('alert.error'), result.error);
              return;
            }

            // ✅ Save username to database regardless of verification status
            const isVerified = result.verified;
            // Use userId from verification result if verified, otherwise from initial username check
            const userIdToSave = result.verified ? result.userId : (verifyResult.userId || null);

            await updateLocalStateAndDatabase({
              robloxUsername: trimmedUsername,
              robloxUsernameVerified: isVerified,
              robloxUserId: userIdToSave,
            });

            // ✅ Update local state
            setRobloxUsername(trimmedUsername);
            setRobloxUsernameVerified(isVerified);

            // ✅ Update user state immediately for UI
            setUser((prev) => ({
              ...prev,
              robloxUsername: trimmedUsername,
              robloxUsernameVerified: isVerified,
              robloxUserId: userIdToSave,
            }));

            if (isVerified) {
              showSuccessMessage(t('alert.success'), t('settings.roblox.verified_success'));
            } else {
              showErrorMessage(t('settings.roblox.saved_title'), `${result.error}\n${t('settings.roblox.saved_message')}`);
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
  const c = getThemeColors(isDarkMode);
  const initializedUserIdRef = useRef(null); // ✅ Track which user ID we've initialized for

  // ✅ Initialize form values when drawer opens or user ID changes
  useEffect(() => {
    // Only initialize when drawer opens (isDrawerVisible becomes true) or when user ID changes
    if (!isDrawerVisible) return; // Don't initialize when drawer is closed

    if (user && user?.id) {
      // Only reset if this is a different user or first time initialization for this user
      if (initializedUserIdRef.current !== user.id) {
        initializedUserIdRef.current = user.id;
        setNewDisplayName(user?.displayName?.trim() || 'Anonymous');
        setSelectedImage(user?.avatar?.trim() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
        // ✅ Load Roblox username if exists
        setRobloxUsername(user?.robloxUsername || '');
        setRobloxUsernameVerified(user?.robloxUsernameVerified || false);
      }
    } else {
      // User logged out - reset everything
      initializedUserIdRef.current = null;
      setNewDisplayName(t('first.guest_user')); // Changed from 'Guest User' to t('first.guest_user') which exists or make new key? 'first.guest_user' exists
      setSelectedImage('https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png');
      setRobloxUsername('');
      setRobloxUsernameVerified(false);
    }

  }, [isDrawerVisible, user?.id]); // ✅ Only initialize when drawer opens or user ID changes

  // Load bio from Firestore and rating from user_ratings_summary (single source of truth)
  useEffect(() => {
    if (!user?.id || !appdatabase || !firestoreDB) {
      setBio('');
      setRatingSummary(null);
      setCreatedAtText(null);
      setLoadingRating(false);
      return;
    }

    const loadBioAndRating = async () => {
      setLoadingRating(true);
      try {
        // ✅ MIGRATED: Read rating summary from Firestore user_ratings_summary (single source of truth)
        // 📅 2026-03-13: bio migrated from reviews/{userId} → user_profiles/{userId}.
        //    🔮 FUTURE CLEANUP: Once all users updated, remove the reviewDocSnap fetch and its fallback reads.
        const [summaryDocSnap, createdSnap, profileDocSnap, reviewDocSnap] = await Promise.all([
          getDoc(doc(firestoreDB, 'user_ratings_summary', user.id)),
          get(ref(appdatabase, `users/${user.id}/createdAt`)),
          getDoc(doc(firestoreDB, 'user_profiles', user.id)),
          // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this line once all users updated
          getDoc(doc(firestoreDB, 'reviews', user.id)),
        ]);

        // 📅 2026-03-13: Bio migrated from reviews/{userId} → user_profiles/{userId}.
        //    🔮 FUTURE CLEANUP: Once all users updated, remove the reviewDocSnap fallback below.
        let loadedBio = '';
        if (profileDocSnap.exists()) {
          const profileData = profileDocSnap.data();
          if (profileData && profileData.bio && typeof profileData.bio === 'string' && profileData.bio.trim()) {
            loadedBio = profileData.bio.trim();
          }
          // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this else-if block once all users updated
        } else if (reviewDocSnap.exists()) {
          const reviewData = reviewDocSnap.data();
          if (reviewData && reviewData.bio && typeof reviewData.bio === 'string' && reviewData.bio.trim()) {
            loadedBio = reviewData.bio.trim();
          }
        }
        // The stored English default reads as "no bio" (see DEFAULT_BIO_EN).
        setBio(loadedBio === DEFAULT_BIO_EN ? '' : loadedBio);

        // ✅ FIRESTORE ONLY: Load rating summary from user_ratings_summary
        if (summaryDocSnap.exists()) {
          const summaryData = summaryDocSnap.data();
          if (summaryData) {
            setRatingSummary({
              value: Number(summaryData.averageRating || 0),
              count: Number(summaryData.count || 0),
            });
          }
        } else {
          // ✅ COST-OPTIMIZED: Only recalculate if summary truly missing (one-time per user)
          // Check RTDB first (free) before expensive Firestore query
          const avgSnap = await get(ref(appdatabase, `averageRatings/${user.id}`));
          if (avgSnap.exists()) {
            // ✅ RTDB has data - migrate it (cheap: 1 RTDB read + 1 Firestore write)
            const avgData = avgSnap.val();
            const avgValue = Number(avgData.value || 0);
            const avgCount = Number(avgData.count || 0);

            setRatingSummary({
              value: avgValue,
              count: avgCount,
            });

            if (avgValue > 0 || avgCount > 0) {
              await setDoc(
                doc(firestoreDB, 'user_ratings_summary', user.id),
                {
                  averageRating: avgValue,
                  count: avgCount,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            }
          } else {
            // ✅ Only query Firestore reviews if RTDB also has no data (expensive operation)
            // This ensures we don't waste reads if RTDB migration is possible
            try {
              const reviewsQuery = query(
                collection(firestoreDB, 'reviews'),
                where('toUserId', '==', user.id),
                limit(100) // ✅ COST LIMIT: Max 100 reviews per calculation (prevents huge reads)
              );
              const reviewsSnapshot = await getDocs(reviewsQuery);

              if (!reviewsSnapshot.empty) {
                let totalRating = 0;
                let ratingCount = 0;

                reviewsSnapshot.docs.forEach((doc) => {
                  const reviewData = doc.data();
                  if (reviewData.rating && typeof reviewData.rating === 'number') {
                    totalRating += reviewData.rating;
                    ratingCount += 1;
                  }
                });

                if (ratingCount > 0) {
                  const calculatedAverage = totalRating / ratingCount;

                  setRatingSummary({
                    value: parseFloat(calculatedAverage.toFixed(2)),
                    count: ratingCount,
                  });

                  // ✅ Create summary (prevents future recalculations)
                  await setDoc(
                    doc(firestoreDB, 'user_ratings_summary', user.id),
                    {
                      averageRating: parseFloat(calculatedAverage.toFixed(2)),
                      count: ratingCount,
                      updatedAt: serverTimestamp(),
                    },
                    { merge: true }
                  );
                } else {
                  setRatingSummary(null);
                }
              } else {
                setRatingSummary(null);
              }
            } catch (error) {
              console.error('Error calculating summary from reviews:', error);
              setRatingSummary(null);
            }
          }
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
              if (minutes < 1) setCreatedAtText(t('settings.time.just_now'));
              else if (minutes < 60) setCreatedAtText(t('settings.time.min_ago', { count: minutes }));
              else {
                const hours = Math.floor(minutes / 60);
                if (hours < 24) setCreatedAtText(t('settings.time.hour_ago', { count: hours }));
                else {
                  const days = Math.floor(hours / 24);
                  if (days < 30) setCreatedAtText(t('settings.time.day_ago', { count: days }));
                  else {
                    const months = Math.floor(days / 30);
                    if (months < 12) setCreatedAtText(t('settings.time.month_ago', { count: months }));
                    else {
                      const years = Math.floor(months / 12);
                      setCreatedAtText(t('settings.time.year_ago', { count: years }));
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
        setBio('');
        setRatingSummary(null);
        setCreatedAtText(null);
      } finally {
        setLoadingRating(false);
      }
    };

    loadBioAndRating();
  }, [user?.id, appdatabase, firestoreDB]);

  useEffect(() => { }, [mySubscriptions])

  useEffect(() => {
    const checkPermission = async () => {
      const settings = await notifee.getNotificationSettings();
      // The switch reflects OS permission AND the user's own opt-out. Reading
      // only the OS setting made a manual "off" flip back on next visit.
      const osGranted = settings.authorizationStatus === 1;
      setIsPermissionGranted(osGranted && localState?.chatNotificationsOff !== true);
    };

    checkPermission();
  }, [localState?.chatNotificationsOff]);

  // Request permission
  const requestPermission = async () => {
    try {
      const settings = await notifee.requestPermission();
      if (settings.authorizationStatus === 0) {
        Alert.alert(
          t("settings.permission_required"),
          t("settings.notification_permissions_disabled"),
          [
            { text: t("home.cancel"), style: 'cancel' },
            {
              text: t("settings.go_to_settings"),
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
      // Re-request OS permission, then re-register the FCM token we cleared.
      const granted = await requestPermission();
      if (granted) {
        updateLocalState('chatNotificationsOff', false);
        if (user?.id) {
          try {
            await registerForNotifications(user.id);
          } catch (e) {
            console.warn('[settings] token re-register failed:', e?.message);
          }
        }
      }
      setIsPermissionGranted(granted);
    } else {
      // Off has to do real work: the OS permission can't be revoked from here,
      // and notifyNewMessage has no global "notifications off" flag — it only
      // early-returns when users/{uid}/fcmToken is missing. So clear the token.
      updateLocalState('chatNotificationsOff', true);
      setIsPermissionGranted(false);
      if (user?.id && appdatabase) {
        try {
          await set(ref(appdatabase, `users/${user.id}/fcmToken`), null);
        } catch (e) {
          console.warn('[settings] token clear failed:', e?.message);
        }
      }
    }
  };

  // Value update pushes: the FCM topic 'value-updates'. Membership is per
  // device, so this works for guests too and is separate from the chat switch
  // above (which clears users/{uid}/fcmToken). Not awaited: a failed call is
  // retried at the next launch (Helper/valueUpdatesTopic.js).
  const handleToggleValueUpdates = (value) => {
    updateLocalState('valueUpdateNotifications', value);
    syncValueUpdatesTopic(value, { force: true });
    // The pushes only show with OS permission, and nothing asks guests for it
    // at startup. Uses the shared helper, not the local requestPermission
    // above, because that one also flips the chat switch on.
    if (value) askNotificationPermission().catch(() => {});
  };
  const USERNAME_REGEX = /^[A-Za-z0-9_-]+$/;

  const handleSaveChanges = async () => {
    triggerHapticFeedback('impactLight');
    const MAX_NAME_LENGTH = 15;
    const PROFILE_EDIT_COOLDOWN_DAYS = 10; // ✅ Fixed: 10 days cooldown

    if (!user?.id) return;

    if (newDisplayName.length > MAX_NAME_LENGTH) {
      showErrorMessage(
        t("home.alert.error"),
        t("settings.display_name_length_error")
      );
      return;
    }

    // ✅ Block restricted display names (impersonating system/default names)
    const RESTRICTED_NAMES = [
      'unknown', 'anonymous', 'guest', 'guest user', 'admin', 'moderator',
      'mod', 'system', 'bot', 'undefined', 'null', 'deleted', 'banned',
    ];
    const nameLower = newDisplayName.trim().toLowerCase();
    if (RESTRICTED_NAMES.includes(nameLower) || /^(guest|anon|unknown)\s*\d*$/i.test(newDisplayName.trim())) {
      showErrorMessage(
        t("home.alert.error"),
        t("settings.restricted_name_error", { defaultValue: "This display name is not allowed. Please choose a different name." })
      );
      return;
    }

    // ✅ Check if displayName or avatar changed
    const displayNameChanged = newDisplayName.trim() !== (user?.displayName || '').trim();
    const avatarChanged = (selectedImage || '').trim() !== (user?.avatar || '').trim();

    // ✅ Only check cooldown if displayName is being changed (Avatar change is free)
    if (displayNameChanged && user?.lastProfileEditAt) {
      const lastEditTimestamp = typeof user.lastProfileEditAt === 'number'
        ? user.lastProfileEditAt
        : Date.parse(user.lastProfileEditAt);

      if (!isNaN(lastEditTimestamp)) {
        const now = Date.now();
        const daysSinceLastEdit = (now - lastEditTimestamp) / (1000 * 60 * 60 * 24);
        const daysRemaining = Math.ceil(PROFILE_EDIT_COOLDOWN_DAYS - daysSinceLastEdit);

        if (daysSinceLastEdit < PROFILE_EDIT_COOLDOWN_DAYS) {
          showErrorMessage(
            t('settings.profile.edit_cooldown_title'),
            `${t('settings.profile.edit_cooldown_info', { days: PROFILE_EDIT_COOLDOWN_DAYS })} ${t('settings.profile.try_again_in', { count: daysRemaining })}`
          );
          return;
        }
      }
    }

    // ✅ WARN USER: If changing name, show confirmation that they can't change for 10 days
    // Avatar change does not need this warning as it doesn't trigger cooldown
    if (displayNameChanged) {
      Alert.alert(
        t('settings.profile.confirm_change_title'),
        t('settings.profile.confirm_change_message', { days: PROFILE_EDIT_COOLDOWN_DAYS }),
        [
          { text: t('home.cancel'), style: 'cancel' },
          {
            text: t('settings.profile.confirm_save'),
            style: 'default',
            onPress: () => performSaveChanges(displayNameChanged, avatarChanged),
          },
        ]
      );
    } else {
      // Only avatar or bio changed - no confirmation needed
      performSaveChanges(false, avatarChanged);
    }
  };

  // ✅ Actual save function (called after confirmation)
  const performSaveChanges = async (displayNameChanged, avatarChanged) => {
    try {
      const now = Date.now();

      // ✅ Update profile with timestamp (displayName, avatar, lastProfileEditAt)
      // Only update lastProfileEditAt if displayName or avatar changed
      const updateData = {
        displayName: newDisplayName.trim(),
        avatar: (selectedImage || '').trim(),
      };

      if (displayNameChanged || avatarChanged) {
        updateData.lastProfileEditAt = displayNameChanged ? now : (user?.lastProfileEditAt || null); // ✅ Update timestamp ONLY if name changed
      }

      await updateLocalStateAndDatabase(updateData);

      // Refresh local caches immediately so the user's own name/avatar update
      // across chat surfaces (own p_{uid} profileCache entry + HomeTab's
      // cached username/avatar) without waiting for seedCurrentUser on the
      // next chat mount. Spread the existing entry so isPro/frame/badges are
      // preserved. Other users pick up the change via the user_identity
      // mirror once their profileCache TTL rolls over.
      if (user?.id) {
        const trimmedName = newDisplayName.trim();
        const trimmedAvatar = (selectedImage || '').trim();
        const existing = getCachedProfile(user.id) || {};
        setCachedProfile(user.id, {
          ...existing,
          displayName: trimmedName || 'Anonymous',
          avatar: trimmedAvatar || null,
        });
        if (trimmedName) setCachedUsername(trimmedName);
        if (trimmedAvatar) setCachedAvatar(trimmedAvatar);
        // The public-profile drawer reads the 30-min full-profile cache; drop
        // it so the preview shows the new name/avatar right away.
        invalidateFullProfile(user.id);
      }

      // 📅 2026-03-13: Bio dual-write to user_profiles (new primary) + reviews (backward compat).
      //    🔮 FUTURE CLEANUP: Once all users updated, remove the setDoc to 'reviews' below.
      // Bio can be changed anytime (no cooldown restriction)
      if (user?.id && firestoreDB) {
        const trimmedBio = bio.trim();
        const bioToSave = trimmedBio || DEFAULT_BIO_EN;
        const bioPayload = {
          bio: bioToSave,
          updatedAt: serverTimestamp(),
        };

        await Promise.all([
          setDoc(doc(firestoreDB, 'user_profiles', user.id), bioPayload, { merge: true }),
          // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this line once all users updated
          setDoc(doc(firestoreDB, 'reviews', user.id), bioPayload, { merge: true }),
        ]);
      }

      setDrawerVisible(false);
      showSuccessMessage(
        t("home.alert.success"),
        t("settings.profile_success")
      );
    } catch (error) {
      console.error('Error updating profile:', error);
      showErrorMessage(
        t("home.alert.error"),
        t("settings.profile.save_error")
      );
    }
  };



  const displayName = user?.id
    ? newDisplayName?.trim() || user?.displayName || t('settings.profile.anonymous')
    : t('first.guest_user');

  // ✅ Render stars for rating
  const renderStars = (value) => {
    const rounded = Math.round(value || 0);
    const full = '★'.repeat(Math.min(rounded, 5));
    const empty = '☆'.repeat(Math.max(0, 5 - rounded));
    return (
      <Text style={{ color: '#ffb700be', fontSize: 14, fontWeight: '600' }}>
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
          backgroundColor: c.bg,
        }}
      >
        <Image resizeMethod="resize"
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
    owned === 'owned' ? setOwned(true) : setOwned(false)
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
                reviewedUserName: userData?.displayName || t('settings.profile.unknown_user'),
                reviewedUserAvatar: userData?.avatar || null,
              };
            } catch (error) {
              return {
                id: doc.id,
                ...data,
                type: 'gave',
                reviewedUserName: t('settings.profile.unknown_user'),
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
                reviewerName: userData?.displayName || t('settings.profile.unknown_user'),
                reviewerAvatar: userData?.avatar || null,
              };
            } catch (error) {
              return {
                id: doc.id,
                ...data,
                type: 'received',
                reviewerName: t('settings.profile.unknown_user'),
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

  // Load "My Trades" modal when opens
  useEffect(() => {
    if (!showMyTradesModal || !user?.id || !firestoreDB) {
      return;
    }

    const loadMyTrades = async () => {
      setLoadingModalMyTrades(true);
      try {
        // Load initial batch of 3 trades
        const tradesQuery = await getDocs(query(
          collection(firestoreDB, 'trades_new'),
          where('userId', '==', user.id),
          orderBy('timestamp', 'desc'),
          limit(3)
        ));

        const tradesDocs = tradesQuery.docs;
        const tradesData = tradesDocs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        setModalMyTrades(tradesData);
        setModalLastTradeDoc(tradesDocs[tradesDocs.length - 1] || null);
        setModalHasMoreTrades(tradesDocs.length === 3);
      } catch (error) {
        console.error('Error loading my trades:', error);
        setModalMyTrades([]);
        setModalHasMoreTrades(false);
      } finally {
        setLoadingModalMyTrades(false);
      }
    };

    loadMyTrades();
  }, [showMyTradesModal, user?.id, firestoreDB]);

  // Load more "My Trades" in modal
  const loadMoreMyTrades = useCallback(async () => {
    if (!user?.id || !firestoreDB || loadingModalMyTrades || !modalLastTradeDoc) return;

    setLoadingModalMyTrades(true);
    try {
      const tradesQuery = await getDocs(query(
        collection(firestoreDB, 'trades_new'),
        where('userId', '==', user.id),
        orderBy('timestamp', 'desc'),
        startAfter(modalLastTradeDoc),
        limit(10) // Load 10 at a time
      ));

      const tradesDocs = tradesQuery.docs;

      if (tradesDocs.length > 0) {
        const newTrades = tradesDocs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        }));

        setModalMyTrades((prev) => [...prev, ...newTrades]);
        setModalLastTradeDoc(tradesDocs[tradesDocs.length - 1]);
        setModalHasMoreTrades(tradesDocs.length === 10);
      } else {
        setModalHasMoreTrades(false);
      }
    } catch (error) {
      console.error('Error loading more trades:', error);
      setModalHasMoreTrades(false);
    } finally {
      setLoadingModalMyTrades(false);
    }
  }, [user?.id, firestoreDB, modalLastTradeDoc, loadingModalMyTrades]);

  // Load Followers modal when opens
  const FOLLOWERS_PAGE_SIZE = 2;
  useEffect(() => {
    if (!showFollowersModal || !user?.id || !firestoreDB || !appdatabase) return;

    const loadFollowers = async () => {
      setLoadingModalFollowers(true);
      try {
        let followersSnapshot;
        let usedOrderBy = true;
        try {
          const q = query(
            collection(firestoreDB, 'following'),
            where('followingId', '==', user.id),
            orderBy('createdAt', 'desc'),
            limit(FOLLOWERS_PAGE_SIZE + 1)
          );
          followersSnapshot = await getDocs(q);
        } catch (idxErr) {
          usedOrderBy = false;
          const fallbackQuery = query(
            collection(firestoreDB, 'following'),
            where('followingId', '==', user.id),
            limit(FOLLOWERS_PAGE_SIZE + 1)
          );
          followersSnapshot = await getDocs(fallbackQuery);
        }
        const docs = followersSnapshot.docs;
        const hasMore = docs.length > FOLLOWERS_PAGE_SIZE;
        const displayDocs = hasMore ? docs.slice(0, FOLLOWERS_PAGE_SIZE) : docs;
        const followerIds = displayDocs.map(d => d.data().followerId).filter(Boolean);

        await warmProfileCache(appdatabase, followerIds);
        const followersWithDetails = followerIds.map((followerId) => {
          const cached = getCachedProfile(followerId);
          return {
            id: followerId,
            displayName: cached?.displayName || null, // translated fallback at render
            avatar: cached?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          };
        });

        setModalFollowers(followersWithDetails);
        setModalLastFollowerDoc(displayDocs[displayDocs.length - 1] || null);
        setModalHasMoreFollowers(hasMore);
      } catch (error) {
        console.error('Error loading followers:', error);
        setModalFollowers([]);
        setModalHasMoreFollowers(false);
      } finally {
        setLoadingModalFollowers(false);
      }
    };

    loadFollowers();
  }, [showFollowersModal, user?.id, firestoreDB, appdatabase]);

  // Load more Followers
  const loadMoreFollowers = useCallback(async () => {
    if (!user?.id || !firestoreDB || !appdatabase || loadingModalFollowers || !modalLastFollowerDoc) return;

    setLoadingModalFollowers(true);
    try {
      let followersSnapshot;
      try {
        const followersQuery = query(
          collection(firestoreDB, 'following'),
          where('followingId', '==', user.id),
          orderBy('createdAt', 'desc'),
          startAfter(modalLastFollowerDoc),
          limit(FOLLOWERS_PAGE_SIZE + 1)
        );
        followersSnapshot = await getDocs(followersQuery);
      } catch (idxErr) {
        // Fallback without orderBy if index is missing
        const fallbackQuery = query(
          collection(firestoreDB, 'following'),
          where('followingId', '==', user.id),
          startAfter(modalLastFollowerDoc),
          limit(FOLLOWERS_PAGE_SIZE + 1)
        );
        followersSnapshot = await getDocs(fallbackQuery);
      }
      const docs = followersSnapshot.docs;
      const hasMore = docs.length > FOLLOWERS_PAGE_SIZE;
      const displayDocs = hasMore ? docs.slice(0, FOLLOWERS_PAGE_SIZE) : docs;
      const followerIds = displayDocs.map(d => d.data().followerId).filter(Boolean);

      await warmProfileCache(appdatabase, followerIds);
      const newFollowers = followerIds.map((followerId) => {
        const cached = getCachedProfile(followerId);
        return {
          id: followerId,
          displayName: cached?.displayName || null, // translated fallback at render
          avatar: cached?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        };
      });

      setModalFollowers(prev => [...prev, ...newFollowers]);
      setModalLastFollowerDoc(displayDocs[displayDocs.length - 1] || null);
      setModalHasMoreFollowers(hasMore);
    } catch (error) {
      console.error('Error loading more followers:', error);
      setModalHasMoreFollowers(false);
    } finally {
      setLoadingModalFollowers(false);
    }
  }, [user?.id, firestoreDB, appdatabase, modalLastFollowerDoc, loadingModalFollowers]);

  // Delete a single trade
  const handleDeleteTrade = useCallback(async (tradeId, isFeatured) => {
    if (!user?.id || !firestoreDB) return;

    Alert.alert(
      t("trade.delete_confirmation_title"),
      t("trade.delete_confirmation_message"),
      [
        { text: t("trade.cancel"), style: "cancel" },
        {
          text: t("trade.delete"),
          style: "destructive",
          onPress: async () => {
            try {
              setDeletingTradeId(tradeId);
              const actualTradeId = tradeId.startsWith("featured-") ? tradeId.replace("featured-", "") : tradeId;
              await deleteDoc(doc(firestoreDB, "trades_new", actualTradeId));

              if (isFeatured) {
                const currentFeaturedData = localState.featuredCount || { count: 0, time: null };
                const newFeaturedCount = Math.max(0, currentFeaturedData.count - 1);
                updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: currentFeaturedData.time,
                });
              }

              setModalMyTrades((prev) => prev.filter((trade) => trade.id !== tradeId));
              showSuccessMessage(
                t("trade.delete_success"),
                t("trade.delete_success_message")
              );
            } catch (error) {
              console.error("Error deleting trade:", error);
              showErrorMessage(
                t("trade.delete_error"),
                t("trade.delete_error_message")
              );
            } finally {
              setDeletingTradeId(null);
            }
          },
        },
      ]
    );
  }, [user?.id, firestoreDB, localState.featuredCount, updateLocalState, t]);

  // Delete all trades
  const handleDeleteAllTrades = useCallback(async () => {
    if (!user?.id || !firestoreDB || modalMyTrades.length === 0) return;

    Alert.alert(
      t('trade.delete_all_title'),
      t('trade.delete_all_message', { count: modalMyTrades.length }),
      [
        { text: t("trade.cancel"), style: "cancel" },
        {
          text: t('trade.delete_all'),
          style: "destructive",
          onPress: async () => {
            try {
              setIsDeletingAll(true);

              if (modalMyTrades.length === 0) {
                setIsDeletingAll(false);
                return;
              }

              const batch = writeBatch(firestoreDB);
              let featuredCount = 0;

              modalMyTrades.forEach((trade) => {
                const tradeId = trade.id.startsWith("featured-") ? trade.id.replace("featured-", "") : trade.id;
                if (trade.isFeatured) {
                  featuredCount++;
                }
                const tradeRef = doc(firestoreDB, "trades_new", tradeId);
                batch.delete(tradeRef);
              });

              await batch.commit();

              // Update featured count if needed
              if (featuredCount > 0) {
                const currentFeaturedData = localState.featuredCount || { count: 0, time: null };
                const newFeaturedCount = Math.max(0, currentFeaturedData.count - featuredCount);
                updateLocalState("featuredCount", {
                  count: newFeaturedCount,
                  time: currentFeaturedData.time,
                });
              }

              setModalMyTrades([]);
              setModalLastTradeDoc(null);
              setModalHasMoreTrades(false);
              setModalHasMoreTrades(false);
              showSuccessMessage(t('alert.success'), t('trade.delete_all_success'));
            } catch (error) {
              console.error("Error deleting all trades:", error);
              showErrorMessage(t('alert.error'), t('trade.delete_all_error'));
            } finally {
              setIsDeletingAll(false);
            }
          },
        },
      ]
    );
  }, [user?.id, firestoreDB, modalMyTrades, localState.featuredCount, updateLocalState, t]);

  // Render trade item for modal
  const renderTradeItem = useCallback((trade) => {
    const { deal, tradeRatio } = getTradeDeal(trade.hasTotal, trade.wantsTotal);
    const tradePercentage = Math.abs(((tradeRatio - 1) * 100).toFixed(0));
    const isProfit = tradeRatio > 1;
    const neutral = tradeRatio === 1;
    const formattedTime = trade.timestamp ? dayjs(trade.timestamp.toDate()).fromNow() : t('profile.time_unknown');

    const groupedHasItems = groupTradeItems(trade.hasItems || []);
    const groupedWantsItems = groupTradeItems(trade.wantsItems || []);

    const getTradeItemImageUrl = (item) => {
      if (!item || !item.name) return '';

      const baseImgUrl = localState.imgurl;
      if (!baseImgUrl) return '';

      // Try to find item in parsedValuesData to get image path
      if (parsedValuesData.length > 0) {
        const foundItem = parsedValuesData.find(
          (i) => (i?.name || i?.Name || '').toLowerCase() === item.name.toLowerCase()
        );
        if (foundItem?.image) {
          const path = foundItem.image.startsWith('/') ? foundItem.image : `/${foundItem.image}`;
          return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}${path}`;
        }
      }

      // Fallback: try item.image if available
      if (item.image) {
        const path = item.image.startsWith('/') ? item.image : `/${item.image}`;
        return `${baseImgUrl.replace(/"/g, '').replace(/\/$/, '')}${path}`;
      }

      return '';
    };

    return (
      <View
        key={trade.id}
        style={{
          backgroundColor: c.bg,
          borderRadius: 12,
          padding: 12,
          marginBottom: 12,
          borderWidth: 1,
          borderColor: c.border,
          opacity: deletingTradeId === trade.id ? 0.5 : 1,
        }}
      >
        {/* Trade Header */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              {trade.isFeatured && (
                <View style={{
                  backgroundColor: config.colors.hasBlockGreen,
                  paddingVertical: 1,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  marginRight: 5,
                  flexShrink: 0,
                  flexGrow: 0,
                }}>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>{t('trade.featured_badge')}</Text>
                </View>
              )}
              <Text style={{ fontSize: 10, color: c.textSecondary }}>
                {formattedTime}
              </Text>
            </View>
            {/* Status and Mode Badges - Side by side like Trades.jsx */}
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 4,
              alignSelf: 'flex-start',
              flexShrink: 1,
              flexGrow: 0,
              flexWrap: 'nowrap',
              width: undefined,
            }}>
              {/* Status Badge (Win/Lose/Fair) - Only show if status field exists */}
              {trade.status && (
                <View style={{
                  backgroundColor: trade.status === 'w' ? '#10B981' : // Green for win
                    trade.status === 'f' ? config.colors.secondary : // Blue for fair
                      config.colors.primary, // Pink/red for lose
                  paddingVertical: 1,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  marginRight: 5,
                  flexShrink: 0,
                  flexGrow: 0,
                }}>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>
                    {trade.status === 'w' ? t('trade.status_win') : trade.status === 'f' ? t('trade.status_fair') : t('trade.status_lose')}
                  </Text>
                </View>
              )}
              {/* Shark/Frost/GG Badge */}
              {trade.isSharkMode !== undefined && (
                <View style={{
                  backgroundColor: trade.isSharkMode == 'GG' ? '#5c4c49' : trade.isSharkMode === true ? config.colors.secondary : config.colors.hasBlockGreen,
                  paddingVertical: 1,
                  paddingHorizontal: 6,
                  borderRadius: 6,
                  flexShrink: 0,
                  flexGrow: 0,
                }}>
                  <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>
                    {trade.isSharkMode == 'GG' ? t('trade.shark_gg') : trade.isSharkMode === true ? t('trade.shark_shark') : t('trade.shark_frost')}
                  </Text>
                </View>
              )}
            </View>
            {(groupedHasItems.length > 0 && groupedWantsItems.length > 0) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <View style={{
                  backgroundColor: deal.color,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  marginRight: 8,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>
                    {t(deal.label) || deal.label}
                  </Text>
                </View>
                <Text style={{
                  fontSize: 12,
                  color: 'white',
                  fontWeight: '600'
                }}>
                  {tradePercentage}% {!neutral && (
                    <Icon
                      name={isProfit ? 'arrow-down-outline' : 'arrow-up-outline'}
                      size={12}
                      color={isProfit ? config.colors.wantBlockRed : config.colors.hasBlockGreen}
                    />
                  )}
                </Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            onPress={() => handleDeleteTrade(trade.id, trade.isFeatured)}
            disabled={deletingTradeId === trade.id}
            style={{
              padding: 6,
              borderRadius: 6,
              backgroundColor: c.bgAlt,
            }}
          >
            {deletingTradeId === trade.id ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <Icon name="trash-outline" size={18} color="#EF4444" />
            )}
          </TouchableOpacity>
        </View>

        {/* Trade Items - Matching Trades.jsx structure */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10 }}>
          {/* Has Items Grid */}
          {trade.hasItems && trade.hasItems.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: '48%' }}>
              {Array.from({
                length: Math.max(4, Math.ceil(trade.hasItems.length / 4) * 4)
              }).map((_, idx) => {
                const tradeItem = trade.hasItems[idx];
                return (
                  <View key={idx} style={{ width: '22%', height: 40, margin: 1, alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 10 }}>
                    {tradeItem ? (
                      <>
                        <Image resizeMethod="resize"
                          source={{ uri: getTradeItemImageUrl(tradeItem) || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                          style={{ width: 30, height: 30, borderRadius: 6 }}
                          resizeMode="contain"
                          defaultSource={{ uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                        />
                        <View style={{ position: 'absolute', bottom: -5, right: 0, flexDirection: 'row', gap: 1, padding: 1, alignItems: 'center', justifyContent: 'center' }}>
                          {tradeItem.isFly && (
                            <Text style={{ color: 'white', backgroundColor: '#3498db', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>F</Text>
                          )}
                          {tradeItem.isRide && (
                            <Text style={{ color: 'white', backgroundColor: '#e74c3c', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>R</Text>
                          )}
                          {tradeItem.valueType && tradeItem.valueType !== 'd' && (
                            <Text style={{
                              color: 'white',
                              backgroundColor: tradeItem.valueType === 'm' ? '#9b59b6' : '#2ecc71',
                              borderRadius: 10,
                              width: 10,
                              height: 10,
                              fontSize: 6,
                              textAlign: 'center',
                              lineHeight: 10,
                              fontWeight: '600',
                              overflow: 'hidden',
                              padding: 0,
                              margin: 0
                            }}>{tradeItem.valueType.toUpperCase()}</Text>
                          )}
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{ width: '48%', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{
                backgroundColor: 'black',
                paddingVertical: 1,
                paddingHorizontal: 6,
                borderRadius: 6,
                flexShrink: 0,
                flexGrow: 0,
              }}>
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>{t('trade.give_offer')}</Text>
              </View>
            </View>
          )}

          {/* Transfer Icon */}
          <View style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Image resizeMethod="resize" source={require('../../assets/left-right.png')} style={{ width: 20, height: 20, borderRadius: 5 }} />
          </View>

          {/* Wants Items Grid */}
          {trade.wantsItems && trade.wantsItems.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', width: '48%' }}>
              {Array.from({
                length: Math.max(4, Math.ceil(trade.wantsItems.length / 4) * 4)
              }).map((_, idx) => {
                const tradeItem = trade.wantsItems[idx];
                return (
                  <View key={idx} style={{ width: '22%', height: 40, margin: 1, alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: 10 }}>
                    {tradeItem ? (
                      <>
                        <Image resizeMethod="resize"
                          source={{ uri: getTradeItemImageUrl(tradeItem) || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                          style={{ width: 30, height: 30, borderRadius: 6 }}
                          resizeMode="contain"
                          defaultSource={{ uri: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                        />
                        <View style={{ position: 'absolute', bottom: -5, right: 0, flexDirection: 'row', gap: 1, padding: 1, alignItems: 'center', justifyContent: 'center' }}>
                          {tradeItem.isFly && (
                            <Text style={{ color: 'white', backgroundColor: '#3498db', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>F</Text>
                          )}
                          {tradeItem.isRide && (
                            <Text style={{ color: 'white', backgroundColor: '#e74c3c', borderRadius: 10, width: 10, height: 10, fontSize: 6, textAlign: 'center', lineHeight: 10, fontWeight: '600', overflow: 'hidden', padding: 0, margin: 0 }}>R</Text>
                          )}
                          {tradeItem.valueType && tradeItem.valueType !== 'd' && (
                            <Text style={{
                              color: 'white',
                              backgroundColor: tradeItem.valueType === 'm' ? '#9b59b6' : '#2ecc71',
                              borderRadius: 10,
                              width: 10,
                              height: 10,
                              fontSize: 6,
                              textAlign: 'center',
                              lineHeight: 10,
                              fontWeight: '600',
                              overflow: 'hidden',
                              padding: 0,
                              margin: 0
                            }}>{tradeItem.valueType.toUpperCase()}</Text>
                          )}
                        </View>
                      </>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{ width: '48%', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{
                backgroundColor: 'black',
                paddingVertical: 1,
                paddingHorizontal: 6,
                borderRadius: 6,
                flexShrink: 0,
                flexGrow: 0,
              }}>
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 8, textAlign: 'center' }}>{t('trade.give_offer')}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Trade Totals - Matching Trades.jsx structure */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', width: '100%', marginTop: 10 }}>
          {trade.hasItems && trade.hasItems.length > 0 && (
            <Text style={{
              fontSize: 8,
              fontWeight: 'bold',
              color: 'white',
              textAlign: 'center',
              alignSelf: 'center',
              marginHorizontal: 'auto',
              paddingHorizontal: 4,
              paddingVertical: 2,
              borderRadius: 6,
              backgroundColor: config.colors.hasBlockGreen
            }}>
              {t('profile.trade_me_total', { value: formatTradeValue(typeof trade.hasTotal === 'number' ? trade.hasTotal : trade.hasTotal?.value || 0) })}
            </Text>
          )}
          <View style={{ justifyContent: 'center', alignItems: 'center', marginHorizontal: 8 }}>
            {(trade.hasItems && trade.hasItems.length > 0 && trade.wantsItems && trade.wantsItems.length > 0) && (
              <>
                {(() => {
                  const hasValue = typeof trade.hasTotal === 'number' ? trade.hasTotal : trade.hasTotal?.value || 0;
                  const wantsValue = typeof trade.wantsTotal === 'number' ? trade.wantsTotal : trade.wantsTotal?.value || 0;
                  if (hasValue > wantsValue) {
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="arrow-up-outline" size={12} color="green" />
                        <Text style={{ fontSize: 8, fontWeight: 'bold', color: 'green', textAlign: 'center', alignSelf: 'center', marginHorizontal: 'auto', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6 }}>
                          {formatTradeValue(hasValue - wantsValue)}
                        </Text>
                      </View>
                    );
                  } else if (hasValue < wantsValue) {
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="arrow-down-outline" size={12} color={config.colors.hasBlockGreen} />
                        <Text style={{ fontSize: 8, fontWeight: 'bold', color: config.colors.hasBlockGreen, textAlign: 'center', alignSelf: 'center', marginHorizontal: 'auto', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6 }}>
                          {formatTradeValue(wantsValue - hasValue)}
                        </Text>
                      </View>
                    );
                  } else {
                    return <Text style={{ fontSize: 8, fontWeight: 'bold', color: config.colors.primary, textAlign: 'center' }}>-</Text>;
                  }
                })()}
              </>
            )}
          </View>
          {trade.wantsItems && trade.wantsItems.length > 0 && (
            <Text style={{
              fontSize: 8,
              fontWeight: 'bold',
              color: 'white',
              textAlign: 'center',
              alignSelf: 'center',
              marginHorizontal: 'auto',
              paddingHorizontal: 4,
              paddingVertical: 2,
              borderRadius: 6,
              backgroundColor: config.colors.wantBlockRed
            }}>
              {t('profile.trade_you_total', { value: formatTradeValue(typeof trade.wantsTotal === 'number' ? trade.wantsTotal : trade.wantsTotal?.value || 0) })}
            </Text>
          )}
        </View>

        {/* Description */}
        {trade.description && (
          <Text style={{
            fontSize: 11,
            color: c.textSecondary,
            marginTop: 8,
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: c.border,
          }}>
            {trade.description}
          </Text>
        )}
      </View>
    );
  }, [
    isDarkMode,
    t,
    deletingTradeId,
    handleDeleteTrade,
    localState.imgurl,
    parsedValuesData,
    firestoreDB
  ]);

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
                  reviewedUserName: userData?.displayName || t('settings.profile.unknown_user'),
                  reviewedUserAvatar: userData?.avatar || null,
                };
              } catch (error) {
                return {
                  id: doc.id,
                  ...data,
                  type: 'gave',
                  reviewedUserName: t('settings.profile.unknown_user'),
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
                  reviewerName: userData?.displayName || t('settings.profile.unknown_user'),
                  reviewerAvatar: userData?.avatar || null,
                };
              } catch (error) {
                return {
                  id: doc.id,
                  ...data,
                  type: 'received',
                  reviewerName: t('settings.profile.unknown_user'),
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
      showErrorMessage(t('alert.error'), t('reviews.empty_error'));
      return;
    }

    try {
      // Document ID format: toUserId_fromUserId
      const reviewDocId = `${editingReview.toUserId}_${user.id}`;
      const reviewRef = doc(firestoreDB, 'reviews', reviewDocId);

      // ✅ Get old rating before updating
      const existingReviewSnap = await getDoc(reviewRef);
      const oldRating = existingReviewSnap.exists() ? existingReviewSnap.data()?.rating : null;
      const newRating = editReviewRating;

      // ✅ Check if rating changed - if so, update summary
      const ratingChanged = oldRating !== null && oldRating !== newRating;

      if (ratingChanged) {
        // ✅ FIX: Atomic transaction for user_ratings_summary (prevents race conditions)
        const summaryRef = doc(firestoreDB, 'user_ratings_summary', editingReview.toUserId);

        let updatedAverage = 0;
        let updatedCount = 0;
        await runTransaction(firestoreDB, async (transaction) => {
          const summarySnap = await transaction.get(summaryRef);
          const summaryData = summarySnap.exists() ? summarySnap.data() : null;
          const oldAverage = summaryData?.averageRating || 0;
          const oldCount = summaryData?.count || 1; // safety: at least 1 if updating

          // ✅ Recalculate average: remove old rating, add new rating
          const newAverage = ((oldAverage * oldCount) - oldRating + newRating) / oldCount;
          updatedAverage = newAverage;
          updatedCount = oldCount;

          transaction.set(
            summaryRef,
            {
              averageRating: parseFloat(newAverage.toFixed(2)),
              count: oldCount, // Count stays the same (updating existing review)
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        });

        // 🏅 Rating change can push the rated user over 4.5 avg — recheck 5-Star badge
        if (appdatabase) {
          const { checkFiveStarBadge } = require('../ChatScreen/GroupChat/badgeUtils');
          checkFiveStarBadge(appdatabase, editingReview.toUserId, updatedAverage, updatedCount);
        }
      }

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

      showSuccessMessage(t('alert.success'), t('reviews.update_success'));
      setEditingReview(null);
      setEditReviewText('');
      setEditReviewRating(0);
    } catch (error) {
      console.error('Error updating review:', error);
      showErrorMessage(t('alert.error'), t('reviews.update_error'));
    }
  };

  // 📅 2026-03-13: Pets dual-write to user_profiles (new primary) + reviews (backward compat).
  //    🔮 FUTURE CLEANUP: Once all users updated, remove the setDoc to 'reviews' below.
  const savePetsToReviews = async (newOwned, newWishlist) => {
    if (!user?.id || !firestoreDB) return;

    const payload = {
      ownedPets: newOwned,
      wishlistPets: newWishlist,
      updatedAt: serverTimestamp(),
    };

    await Promise.all([
      setDoc(doc(firestoreDB, 'user_profiles', user.id), payload, { merge: true }),
      // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this line once all users updated
      setDoc(doc(firestoreDB, 'reviews', user.id), payload, { merge: true }),
    ]);

    setOwnedPets(newOwned);
    setWishlistPets(newWishlist);
    syncTradeInventory(user.id, newOwned, newWishlist);
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
        markSignOutIntent('account-deleted');
        await currentUser.delete(); // 🔐 Requires recent login
        // Drop the cached Google account as well. Left in place, GlobelStats'
        // silent re-login found it (this session, or on the next launch) and
        // signed the user straight back in — recreating the account.
        ensureGoogleSignInConfigured();
        try { await GoogleSignin.signOut(); } catch (_) {}
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


  // ── View my public profile ──
  // Same payload shape the chat/feed screens hand the drawer (senderId +
  // sender + avatar); the drawer then loads the rest from the backend the way
  // it does for anyone else. The flag rides along but the drawer only renders
  // it for admin viewers (Code/Helper/countryFlag.js).
  // Own badges for the profile header. Admin lives in global state (the RTDB
  // leaf is `admin`); the squad count rides on the cached cosmetics row.
  const myBadgeUser = useMemo(() => (user?.id ? {
    ...user,
    isAdmin: !!isAdmin || !!user.admin,
    squadCount: getCachedProfile(user.id)?.squadCount ?? 0,
  } : null), [user, isAdmin]);

  const publicProfileUser = useMemo(() => {
    if (!user?.id) return null;
    return {
      id: user.id,
      senderId: user.id,
      sender: user.displayName || t('settings.profile.anonymous'),
      displayName: user.displayName || t('settings.profile.anonymous'),
      avatar: user.avatar || null,
      flage: user.flage || null,
      robloxUsername: user.robloxUsername || null,
      robloxUsernameVerified: !!user.robloxUsernameVerified,
      isPro: !!user.isPro,
    };
  }, [user?.id, user?.displayName, user?.avatar, user?.flage, user?.robloxUsername, user?.robloxUsernameVerified, user?.isPro, t]);

  const openSubPage = useCallback((page) => {
    triggerHapticFeedback('impactLight');
    setSubPage(page);
  }, [triggerHapticFeedback]);
  const closeSubPage = useCallback(() => setSubPage(null), []);

  // Android back on a sub-page returns to the main list, not out of Settings.
  useEffect(() => {
    if (!subPage) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSubPage(null);
      return true;
    });
    return () => sub.remove();
  }, [subPage]);

  const handleViewPublicProfile = useCallback(() => {
    triggerHapticFeedback('impactLight');
    if (!publicProfileUser) {
      showErrorMessage(t('settings.notice'), t('settings.login_to_customize_profile'));
      return;
    }
    if (publicProfileCloseTimer.current) {
      clearTimeout(publicProfileCloseTimer.current);
      publicProfileCloseTimer.current = null;
    }
    setPublicProfileTarget(publicProfileUser);
    setShowPublicProfile(true);
  }, [publicProfileUser, triggerHapticFeedback, t]);

  // Hide first so the Modal slides out, then unmount once the animation is
  // done (same 400 ms the other unmount-on-close drawers in this app use).
  const closePublicProfile = useCallback(() => {
    setShowPublicProfile(false);
    if (publicProfileCloseTimer.current) clearTimeout(publicProfileCloseTimer.current);
    publicProfileCloseTimer.current = setTimeout(() => {
      publicProfileCloseTimer.current = null;
      setPublicProfileTarget(null);
    }, 400);
  }, []);

  useEffect(() => () => {
    if (publicProfileCloseTimer.current) clearTimeout(publicProfileCloseTimer.current);
  }, []);

  const handleSelect = (lang) => {
    if (!localState.isPro) {
      setShowofferWall(true)
    } else {
      setAppLanguage(lang);
      changeLanguage(lang)
    }
  }


  const formatPlanName = (plan) => {
    if (!plan) return t('settings.plans.pro');
    const p = plan.toLowerCase();

    // Match by keywords in the product ID (covers all RevenueCat naming patterns)
    if (p.includes('week'))  return t('settings.plans.one_week');
    if (p.includes('1m') || p.includes('month'))  return t('settings.plans.one_month');
    if (p.includes('3m') || p.includes('quarter')) return t('settings.plans.three_months');
    if (p.includes('6m'))  return t('settings.plans.six_months');
    if (p.includes('1y') || p.includes('year') || p.includes('annual')) return t('settings.plans.one_year');
    if (p.includes('lifetime')) return t('settings.plans.lifetime');

    return t('settings.plans.pro');
  };


  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const rs = useMemo(() => getRowStyles(c, isDarkMode), [c, isDarkMode]);
  return (
    <View style={styles.container}>
      {subPage === 'privacy' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <SubPageHeader title={t('settings.privacy_chat')} onBack={closeSubPage} c={c} color={config.colors.primary} />

          <SettingsGroup rs={rs} title={t('settings.who_can_message')}>
            {/* Chat availability — two independent doors. Trade chat is what
                opens from the Trades screen; general chat is everywhere else
                (public chat, feed, leaderboard, inbox, profiles). Each switch
                blocks both directions for that door. Switch reads "chat on";
                storage stays chatOff* (true = blocked). */}
            <SettingsRow
              rs={rs}
              icon="chatbubbles-outline"
              label={t('settings.allow_general_chat')}
              subtitle={t('settings.allow_general_chat_sub')}
              switchValue={!user?.chatOffGeneral}
              onSwitch={(v) => { triggerHapticFeedback('impactLight'); updateLocalStateAndDatabase('chatOffGeneral', !v); }}
            />
            <SettingsRow
              rs={rs}
              icon="swap-horizontal-outline"
              label={t('settings.allow_trade_chat')}
              subtitle={t('settings.allow_trade_chat_sub')}
              switchValue={!user?.chatOffTrade}
              onSwitch={(v) => { triggerHapticFeedback('impactLight'); updateLocalStateAndDatabase('chatOffTrade', !v); }}
            />
          </SettingsGroup>
          <Text style={rs.note}>{t('settings.chat_off_note')}</Text>

          {user?.id && (
            <SettingsGroup rs={rs} title={t('settings.what_others_see')}>
              <SettingsRow
                rs={rs}
                icon="radio-button-on-outline"
                label={t('settings.online_status')}
                switchValue={localState.showOnlineStatus ?? true}
                onSwitch={handleToggleOnlineStatus}
              />
              <SettingsRow
                rs={rs}
                icon="checkmark-done-outline"
                label={t('settings.read_receipts')}
                switchValue={localState.showReadReceipts ?? true}
                onSwitch={handleToggleReadReceipts}
              />
              <BirthdayVisibilityRow
                uid={user.id}
                knownDob={user?.dateOfBirth || null}
                {...legacyRowProps(rs)}
                onHaptic={() => triggerHapticFeedback('impactLight')}
              />
            </SettingsGroup>
          )}
        </ScrollView>
      ) : subPage === 'help' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <SubPageHeader title={t('settings.help_feedback')} onBack={closeSubPage} c={c} color={config.colors.primary} />
          <SettingsGroup rs={rs}>
            <SettingsRow rs={rs} icon="bulb-outline" label={t('settings.give_suggestions')} chevron
              onPress={() => { handleGetSuggestions(user); triggerHapticFeedback('impactLight'); }} />
            <SettingsRow rs={rs} icon="flag-outline" label={t('settings.report_abuse')} chevron
              onPress={() => { handleReport(user); triggerHapticFeedback('impactLight'); }} />
            <SettingsRow rs={rs} icon="briefcase-outline" label={t('settings.business_enquiries')} subtitle="thesolanalabs@gmail.com" chevron
              onPress={() => Linking.openURL('mailto:thesolanalabs@gmail.com')} />
            <SettingsRow rs={rs} icon="globe-outline" label={t('settings.visit_website')} chevron="open-outline"
              onPress={() => { handleOpenWebsite(); triggerHapticFeedback('impactLight'); }} />
          </SettingsGroup>
        </ScrollView>
      ) : subPage === 'legal' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <SubPageHeader title={t('settings.legal_safety')} onBack={closeSubPage} c={c} color={config.colors.primary} />
          <SettingsGroup rs={rs}>
            <SettingsRow rs={rs} icon="document-text-outline" label={t('settings.privacy_policy')} chevron="open-outline"
              onPress={() => { handleOpenPrivacy(); triggerHapticFeedback('impactLight'); }} />
            {privacyOptionsRequired && (
              <SettingsRow rs={rs} icon="options-outline" label={t('settings.privacy_options', { defaultValue: 'Privacy options' })} chevron
                onPress={() => { showPrivacyOptionsForm(); triggerHapticFeedback('impactLight'); }} />
            )}
            <SettingsRow rs={rs} icon="shield-outline" label={t('settings.child_safety')} chevron="open-outline"
              onPress={() => { handleOpenChild(); triggerHapticFeedback('impactLight'); }} />
          </SettingsGroup>
        </ScrollView>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          {/* Profile card: tap opens the profile others see (bio, reviews,
              badges live there); the pencil opens the edit drawer. */}
          <View style={[rs.card, { marginTop: 6 }]}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={user?.id ? handleViewPublicProfile : () => setOpenSignin(true)}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}
            >
              {/* flex:1 + minWidth:0 bounds the avatar+name block so a long
                  username truncates instead of shoving the edit icon off. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 }}>
                {(() => {
                  const avatarUrl = typeof selectedImage === 'string' && selectedImage.trim()
                    ? selectedImage
                    : user?.avatar && typeof user.avatar === 'string' && user.avatar.trim()
                      ? user.avatar.trim()
                      : 'https://bloxfruitscalc.com/wp-content/uploads/2025/placeholder.png';
                  return (
                    <FramedAvatar
                      avatarUri={avatarUrl}
                      frame={myActiveCosmetics?.profileFrame || null}
                      isDarkMode={isDarkMode}
                      avatarSize={56}
                    />
                  );
                })()}
                <View style={{ paddingLeft: 12, flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text
                      style={[!user?.id ? styles.userNameLogout : styles.userName, { flexShrink: 1 }]}
                      numberOfLines={1}
                    >
                      {!user?.id ? t("settings.login_register") : displayName}
                    </Text>
                    {user?.isPro &&
                      <Image resizeMethod="resize"
                        source={require('../../assets/pro.png')}
                        style={{ width: 14, height: 14, marginLeft: 4 }}
                      />
                    }
                  </View>
                  {!user?.id && <Text style={styles.rewardLogout}>{t('settings.login_description')}</Text>}
                  {user?.id && user?.robloxUsername && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                      <Text style={{ fontSize: 12, color: '#0EA5E9', fontWeight: '600' }} numberOfLines={1}>@{user.robloxUsername}</Text>
                      {robloxUsernameVerified && <Icon name="checkmark-circle" size={13} color="#16a34a" style={{ marginLeft: 3 }} />}
                    </View>
                  )}
                  {/* Every badge as a labelled chip, as on the profile drawer
                      (Code/Helper/UserBadgeRail.jsx); Unverified rides along. */}
                  {user?.id && (
                    <UserBadgeRail
                      user={myBadgeUser}
                      variant="full"
                      isDarkMode={isDarkMode}
                      style={{ justifyContent: 'flex-start', marginTop: 4 }}
                    >
                      {user?.robloxUsername && !user?.robloxUsernameVerified && (
                        <View style={{
                          flexDirection: 'row', alignItems: 'center', gap: 4,
                          backgroundColor: isDarkMode ? 'rgba(251,191,36,0.15)' : 'rgba(217,119,6,0.1)',
                          borderWidth: 1, borderColor: isDarkMode ? 'rgba(251,191,36,0.3)' : 'rgba(217,119,6,0.25)',
                          paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999,
                        }}>
                          <Icon name="alert-circle-outline" size={10} color={isDarkMode ? '#fbbf24' : '#d97706'} />
                          <Text style={{ fontSize: 9, fontWeight: '700', color: isDarkMode ? '#fbbf24' : '#d97706' }}>{t('profile.unverified')}</Text>
                        </View>
                      )}
                    </UserBadgeRail>
                  )}
                </View>
              </View>
              {user?.id ? (
                <TouchableOpacity
                  onPress={handleProfileUpdate}
                  style={{ flexShrink: 0, paddingLeft: 8 }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.save_changes')}
                >
                  <Icon name="create-outline" size={22} color={c.textSecondary} />
                </TouchableOpacity>
              ) : (
                <Icon name="chevron-forward" size={16} color={c.textMuted} />
              )}
            </TouchableOpacity>

            {user?.id && (
              <View style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }}>
                {[
                  {
                    key: 'rating',
                    value: loadingRating ? '…' : ratingSummary ? `${ratingSummary.value.toFixed(1)} ★` : '–',
                    label: ratingSummary
                      ? t('settings.stat_reviews', { count: ratingSummary.count })
                      : t('settings.not_rated'),
                  },
                  { key: 'xp', value: (user?.xp?.total || 0).toLocaleString(), label: t('settings.stat_xp') },
                  { key: 'stars', value: realStarBalance.toLocaleString(), label: t('settings.stat_stars') },
                ].map((s, i) => (
                  <View key={s.key} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderLeftWidth: i ? StyleSheet.hairlineWidth : 0, borderLeftColor: c.border }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: c.text }}>{s.value}</Text>
                    <Text style={{ fontSize: 11, color: c.textSecondary, marginTop: 1 }} numberOfLines={1}>{s.label}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Pro: one card. Free → upgrade; Pro → plan name + Manage. */}
          {localState.isPro ? (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={manageSubscription}
              style={[rs.card, { flexDirection: 'row', alignItems: 'center', padding: 14, marginTop: 12, borderWidth: 1, borderColor: isDarkMode ? '#3b2e6e' : '#ffcc4d' }]}
            >
              <Image resizeMethod="resize" source={require('../../assets/pro.png')} style={{ width: 22, height: 22, marginRight: 12 }} />
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: c.text }} numberOfLines={1}>
                {mySubscriptions.length === 0
                  ? t('settings.paid')
                  : `${t('settings.paid')} · ${mySubscriptions.map(sub => formatPlanName(sub.plan)).join(', ')}`}
              </Text>
              <View style={{ backgroundColor: isDarkMode ? '#273449' : '#f1f2f5', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: c.text }}>{t('settings.manage')}</Text>
              </View>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setShowofferWall(true)}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 14, marginTop: 12, borderRadius: 14, backgroundColor: config.colors.primary }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>{t('settings.get_pro')}</Text>
                <Text style={{ fontSize: 12, color: 'rgba(255,255,255,0.92)', marginTop: 2 }} numberOfLines={2}>{t('settings.get_pro_sub')}</Text>
              </View>
              <View style={{ backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, marginLeft: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: config.colors.primary }}>{t('settings.upgrade')}</Text>
              </View>
            </TouchableOpacity>
          )}

          {user?.id && (
            <SettingsGroup rs={rs} title={t('settings.section_account')}>
              <SettingsRow
                rs={rs}
                icon="game-controller-outline"
                label={t('settings.roblox_account')}
                value={robloxUsernameVerified
                  ? t('settings.roblox.verified_badge')
                  : user?.robloxUsername ? t('profile.unverified') : t('settings.not_linked')}
                valueStyle={robloxUsernameVerified ? { color: '#16a34a', fontWeight: '600' } : user?.robloxUsername ? { color: '#d97706', fontWeight: '600' } : null}
                chevron
                onPress={() => { triggerHapticFeedback('impactLight'); setShowRobloxSheet(true); }}
              />
              <SettingsRow
                rs={rs}
                icon="star-outline"
                label={t('settings.reviews.title')}
                value={ratingSummary ? t('settings.stat_reviews', { count: ratingSummary.count }) : null}
                chevron
                onPress={() => setShowReceivedReviewsModal(true)}
              />
              <SettingsRow rs={rs} icon="people-outline" label={t('settings.followers.title')} chevron
                onPress={() => setShowFollowersModal(true)} />
              <SettingsRow rs={rs} icon="trophy-outline" label={t('settings.badges', { defaultValue: 'Badges & Achievements' })} chevron
                onPress={() => { settingsNav.navigate('BadgesScreen'); triggerHapticFeedback('impactLight'); }} />
              {(user?.rewardPoints || 0) > 0 && (
                /* Old reward points: one-time convert to XP (4 points = 1 XP). */
                <SettingsRow
                  rs={rs}
                  icon="diamond-outline"
                  label={t('settings.points.convert_button', {
                    points: (user?.rewardPoints || 0).toLocaleString(),
                    xp: Math.floor((user?.rewardPoints || 0) / 4).toLocaleString(),
                  })}
                  chevron
                  onPress={async () => {
                    const pts = user?.rewardPoints || 0;
                    const xpToAdd = Math.floor(pts / 4);
                    if (xpToAdd <= 0) return;
                    try {
                      await addXP(appdatabase, user.id, xpToAdd);
                      await update(ref(appdatabase, `users/${user.id}`), { rewardPoints: 0 });
                      updateLocalStateAndDatabase('rewardPoints', 0);
                      showSuccessMessage(
                        t('settings.points.converted_title'),
                        t('settings.points.converted_message', {
                          count: pts,
                          points: pts.toLocaleString(),
                          xp: xpToAdd.toLocaleString(),
                        })
                      );
                    } catch (e) {
                      showErrorMessage(t('alert.error'), t('settings.points.convert_error'));
                    }
                  }}
                />
              )}
            </SettingsGroup>
          )}

          <SettingsGroup rs={rs} title={t('settings.section_notifications')}>
            <SettingsRow rs={rs} icon="chatbubble-outline" label={t('settings.chat_notifications')}
              switchValue={isPermissionGranted} onSwitch={handleToggleNotification} />
            {/* Value update notifications: guests too (topic push, no account needed) */}
            <SettingsRow rs={rs} icon="trending-up-outline" label={t('settings.value_update_notifications')}
              switchValue={localState.valueUpdateNotifications ?? true} onSwitch={handleToggleValueUpdates} />
            {user?.id && (
              <EmailUpdatesRow
                uid={user.id}
                appdatabase={appdatabase}
                knownDob={user?.dateOfBirth || null}
                {...legacyRowProps(rs)}
                onHaptic={() => triggerHapticFeedback('impactLight')}
              />
            )}
          </SettingsGroup>

          <SettingsGroup rs={rs} style={{ marginTop: 18 }}>
            <SettingsRow rs={rs} icon="lock-closed-outline" label={t('settings.privacy_chat')}
              subtitle={t('settings.privacy_chat_sub')} chevron onPress={() => openSubPage('privacy')} />
          </SettingsGroup>

          <SettingsGroup rs={rs} title={t('settings.section_appearance')}>
            <SettingsRow
              rs={rs}
              icon="contrast-outline"
              label={t('settings.theme')}
              right={
                <View style={{ flexDirection: 'row', backgroundColor: isDarkMode ? '#273449' : '#f1f2f5', borderRadius: 9, padding: 2 }}>
                  {['system', 'light', 'dark'].map((key, index) => {
                    const on = localState.theme === key;
                    const label = themes[index] || key;
                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => { triggerHapticFeedback('impactLight'); updateLocalState('theme', key); }}
                        style={{ paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7, backgroundColor: on ? c.bgAlt : 'transparent' }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: on ? '700' : '500', color: on ? c.text : c.textSecondary }}>
                          {label.charAt(0).toUpperCase() + label.slice(1).toLowerCase()}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              }
            />
            <SettingsRow rs={rs} icon="pulse-outline" label={t('settings.haptic_feedback')}
              switchValue={localState.isHaptic} onSwitch={handleToggle} />
          </SettingsGroup>

          <SettingsGroup rs={rs} title={t('settings.section_help')}>
            <SettingsRow rs={rs} icon="book-outline" label={t('settings.how_it_works', { defaultValue: 'How It Works' })} chevron
              onPress={() => { setShowGuidesModal(true); triggerHapticFeedback('impactLight'); }} />
            <SettingsRow rs={rs} icon="help-buoy-outline" label={t('settings.help_feedback')} chevron onPress={() => openSubPage('help')} />
            <SettingsRow rs={rs} icon="shield-checkmark-outline" label={t('settings.legal_safety')} chevron onPress={() => openSubPage('legal')} />
            <SettingsRow rs={rs} icon="heart-outline" label={t('settings.rate_us')} chevron
              onPress={() => { handleRateApp(); triggerHapticFeedback('impactLight'); }} />
            <SettingsRow rs={rs} icon="share-social-outline" label={t('settings.share_app')} chevron
              onPress={() => { handleShareApp(); triggerHapticFeedback('impactLight'); }} />
          </SettingsGroup>

          <Text style={rs.sectionTitle}>{t('settings.other_apps')}</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {[
              { key: 'blox', logo: require('../../assets/logo.webp'), label: t('settings.app_bloxfruits'), onPress: handleBloxFruit },
              { key: 'mm2', logo: require('../../assets/MM2logo.webp'), label: t('settings.app_mm2'), onPress: handleadoptme },
            ].map((app) => (
              <TouchableOpacity
                key={app.key}
                activeOpacity={0.8}
                onPress={() => { app.onPress(); triggerHapticFeedback('impactLight'); }}
                style={[rs.card, { flex: 1, flexDirection: 'row', alignItems: 'center', padding: 10 }]}
              >
                <Image resizeMethod="resize" source={app.logo} style={{ width: 36, height: 36, borderRadius: 8 }} />
                <Text style={{ flex: 1, marginLeft: 9, fontSize: 13, fontWeight: '600', color: c.text }} numberOfLines={2}>{app.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {user?.id && (
            <>
              <TouchableOpacity activeOpacity={0.8} onPress={handleLogout} style={[rs.card, { marginTop: 22, paddingVertical: 14, alignItems: 'center' }]}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: config.colors.primary }}>{t('settings.logout')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDeleteUser} style={{ paddingVertical: 16, alignItems: 'center' }}>
                <Text style={{ fontSize: 14, color: '#ef4444' }}>{t('settings.delete_my_account')}</Text>
              </TouchableOpacity>
            </>
          )}
          <Text style={{ textAlign: 'center', fontSize: 12, color: c.textMuted, marginTop: user?.id ? 0 : 18, lineHeight: 18 }}>
            {t('settings.version', { version: DeviceInfo.getVersion() })}
          </Text>
        </ScrollView>
      )}

      {/* 📖 Guides Modal */}
      <GuidesScreen visible={showGuidesModal} onClose={() => setShowGuidesModal(false)} />

      {/* Roblox account sheet: the username box + Verify used to sit inline. */}
      <Modal
        visible={showRobloxSheet}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowRobloxSheet(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setShowRobloxSheet(false)} />
        <ConditionalKeyboardWrapper>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <SwipeableBottomDrawer onClose={() => setShowRobloxSheet(false)} isDarkMode={isDarkMode} showPill={true} style={{ backgroundColor: c.bgAlt, padding: 20 }}>
              <Text style={{ fontSize: 20, fontWeight: '800', color: c.text }}>{t('settings.roblox_account')}</Text>
              <Text style={{ fontSize: 13, color: c.textSecondary, marginTop: 4 }}>{t('settings.roblox_sheet_desc')}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, borderWidth: 1, borderColor: c.border, borderRadius: 12, paddingHorizontal: 12, backgroundColor: c.bg }}>
                <Icon name="game-controller-outline" size={18} color={c.textSecondary} />
                <TextInput
                  style={{ flex: 1, color: c.text, fontSize: 16, paddingVertical: 12, marginLeft: 8 }}
                  placeholder={t('settings.roblox.enter_username_placeholder')}
                  placeholderTextColor={c.textMuted}
                  value={robloxUsername}
                  onChangeText={setRobloxUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {robloxUsernameVerified && (
                  <Text style={{ color: '#16a34a', fontSize: 12, fontWeight: '700' }}>{t('settings.roblox.verified_badge')}</Text>
                )}
              </View>
              {robloxUsername && !robloxUsernameVerified ? (
                <Text style={{ fontSize: 12, color: '#d97706', marginTop: 8 }}>{t('settings.roblox.unverified_warning')}</Text>
              ) : null}
              <TouchableOpacity
                onPress={handleUpdateRobloxUsername}
                disabled={isVerifyingRoblox}
                style={{ backgroundColor: config.colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 18, marginBottom: 8 }}
              >
                {isVerifyingRoblox ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
                    {robloxUsernameVerified ? t('settings.roblox.reverify_button') : t('settings.roblox.verify_button')}
                  </Text>
                )}
              </TouchableOpacity>
            </SwipeableBottomDrawer>
          </View>
        </ConditionalKeyboardWrapper>
      </Modal>
      <ScreenBottomBanner ad={false} />

      {/* Public profile preview: the shared profile drawer pointed at yourself */}
      {publicProfileTarget && (
        <ProfileBottomDrawer
          isVisible={showPublicProfile}
          toggleModal={closePublicProfile}
          selectedUser={publicProfileTarget}
          isOnline={false}
          bannedUsers={NO_BANNED_USERS}
        />
      )}

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
            <SwipeableBottomDrawer onClose={() => setDrawerVisible(false)} isDarkMode={isDarkMode} showPill={true} style={{ backgroundColor: c.bg, padding: 20 }}>
            <EditProfileDrawerContent
              isDarkMode={isDarkMode}
              newDisplayName={newDisplayName}
              setNewDisplayName={setNewDisplayName}
              handlePickAndUploadAvatar={handlePickAndUploadAvatar}
              uploadingAvatar={uploadingAvatar}
              avatarSearch={avatarSearch}
              setAvatarSearch={setAvatarSearch}
              filteredAvatarOptions={filteredAvatarOptions}
              selectedImage={selectedImage}
              setSelectedImage={setSelectedImage}
              bio={bio}
              setBio={setBio}
              handleSaveChanges={handleSaveChanges}
              t={t}
              config={config}
              user={user}
            />
            </SwipeableBottomDrawer>
          </View>
        </ConditionalKeyboardWrapper>
      </Modal>


      <SubscriptionScreen visible={showOfferWall} onClose={() => setShowofferWall(false)} track='Setting' oneWallOnly={single_offer_wall} showoffer={!single_offer_wall} />
      <SignInDrawer
        visible={openSingnin}
        onClose={() => setOpenSignin(false)}
        selectedTheme={selectedTheme}
        message={t('signin.access_all_features')}
        screen='Setting'
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
          <SwipeableBottomDrawer onClose={() => { setShowGaveReviewsModal(false); setModalGaveReviews([]); setModalLastGaveDoc(null); setModalHasMoreGave(false); }} isDarkMode={isDarkMode} style={[styles.drawer, { maxHeight: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={styles.drawerSubtitle}>{t('settings.reviews.gave_title')}</Text>
              <TouchableOpacity onPress={() => {
                setShowGaveReviewsModal(false);
                setModalGaveReviews([]);
                setModalLastGaveDoc(null);
                setModalHasMoreGave(false);
              }}>
                <Icon name="close" size={24} color={c.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {loadingModalGaveReviews && modalGaveReviews.length === 0 ? (
                <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
              ) : modalGaveReviews.length === 0 ? (
                <Text style={{ textAlign: 'center', color: c.textSecondary, marginVertical: 20 }}>
                  {t('settings.reviews.no_reviews')}
                </Text>
              ) : (
                <>
                  {modalGaveReviews.map((review) => (
                    <View
                      key={review.id}
                      style={{
                        backgroundColor: c.bg,
                        borderRadius: 12,
                        padding: 8,
                        marginBottom: 8,
                        borderWidth: 1,
                        borderColor: c.border,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 4 }}>
                            {review.reviewedUserName || t('settings.profile.unknown_user')}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Icon
                                key={star}
                                name={star <= review.rating ? 'star' : 'star-outline'}
                                size={14}
                                color={star <= review.rating ? '#ffb700be' : '#ccc'}
                                style={{ marginRight: 2 }}
                              />
                            ))}
                            {review.edited && (
                              <Text style={{ fontSize: 10, color: c.textSecondary, marginLeft: 6 }}>
                                {t('settings.reviews.edited')}
                              </Text>
                            )}
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          {review.updatedAt && (
                            <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#9ca3af' }}>
                              {review.updatedAt.toDate ?
                                new Date(review.updatedAt.toDate()).toLocaleDateString() :
                                new Date(review.updatedAt).toLocaleDateString()}
                            </Text>
                          )}
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
                      </View>
                      <Text style={{ fontSize: 13, color: c.textSecondary, lineHeight: 18 }}>
                        {review.review}
                      </Text>
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
                          {t('settings.reviews.load_more')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              )}
            </ScrollView>
          </SwipeableBottomDrawer>
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
          <SwipeableBottomDrawer onClose={() => { setShowReceivedReviewsModal(false); setModalReceivedReviews([]); setModalLastReceivedDoc(null); setModalHasMoreReceived(false); }} isDarkMode={isDarkMode} style={[styles.drawer, { maxHeight: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={[styles.drawerSubtitle, { flex: 1 }]} numberOfLines={1}>{t('settings.reviews.received_title')}</Text>
              {/* Settings has one Reviews row; the reviews you gave are one tap away here. */}
              <TouchableOpacity
                onPress={() => {
                  setShowReceivedReviewsModal(false);
                  setModalReceivedReviews([]);
                  setModalLastReceivedDoc(null);
                  setModalHasMoreReceived(false);
                  setShowGaveReviewsModal(true);
                }}
                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: c.bg, marginRight: 10 }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: c.text }}>{t('settings.reviews.i_gave')}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => {
                setShowReceivedReviewsModal(false);
                setModalReceivedReviews([]);
                setModalLastReceivedDoc(null);
                setModalHasMoreReceived(false);
              }}>
                <Icon name="close" size={24} color={c.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {loadingModalReceivedReviews && modalReceivedReviews.length === 0 ? (
                <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
              ) : modalReceivedReviews.length === 0 ? (
                <Text style={{ textAlign: 'center', color: c.textSecondary, marginVertical: 20 }}>
                  {t('settings.reviews.no_reviews')}
                </Text>
              ) : (
                <>
                  {modalReceivedReviews.map((review) => (
                    <View
                      key={review.id}
                      style={{
                        backgroundColor: c.bg,
                        borderRadius: 12,
                        padding: 8,
                        marginBottom: 8,
                        borderWidth: 1,
                        borderColor: c.border,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 4 }}>
                            {review.reviewerName || t('settings.profile.unknown_user')}
                          </Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Icon
                                key={star}
                                name={star <= review.rating ? 'star' : 'star-outline'}
                                size={14}
                                color={star <= review.rating ? '#ffb700be' : '#ccc'}
                                style={{ marginRight: 2 }}
                              />
                            ))}
                            {review.edited && (
                              <Text style={{ fontSize: 10, color: c.textSecondary, marginLeft: 6 }}>
                                {t('settings.reviews.edited')}
                              </Text>
                            )}
                          </View>
                        </View>
                        <View style={styles.reviewSide}>
                          {review.updatedAt && (
                            <Text style={{ fontSize: 10, color: isDarkMode ? '#9ca3af' : '#9ca3af' }}>
                              {review.updatedAt.toDate ?
                                new Date(review.updatedAt.toDate()).toLocaleDateString() :
                                new Date(review.updatedAt).toLocaleDateString()}
                            </Text>
                          )}
                          {/* Report a false review: Complaints & ideas with it attached. */}
                          <TouchableOpacity
                            onPress={() => {
                              const payload = reviewForReport(review, user?.id);
                              setShowReceivedReviewsModal(false);
                              setModalReceivedReviews([]);
                              setModalLastReceivedDoc(null);
                              setModalHasMoreReceived(false);
                              openReportForm({ category: 'false_review', review: payload });
                            }}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            accessibilityRole="button"
                            accessibilityLabel={t('reviews.report')}
                          >
                            <Icon name="flag-outline" size={15} color={c.textSecondary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <Text style={{ fontSize: 13, color: c.textSecondary, lineHeight: 18 }}>
                        {review.review}
                      </Text>
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
                          {t('settings.reviews.load_more')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              )}
            </ScrollView>
          </SwipeableBottomDrawer>
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
            <SwipeableBottomDrawer onClose={() => { setEditingReview(null); setEditReviewText(''); setEditReviewRating(0); }} isDarkMode={isDarkMode} style={styles.drawer}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={styles.drawerSubtitle}>{t('settings.reviews.edit_title')}</Text>
                <TouchableOpacity
                  onPress={() => {
                    setEditingReview(null);
                    setEditReviewText('');
                    setEditReviewRating(0);
                  }}
                >
                  <Icon name="close" size={24} color={c.text} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.drawerSubtitle, { marginBottom: 8 }]}>{t('settings.reviews.rating_label')}</Text>
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
                      color={star <= editReviewRating ? '#ffb700be' : '#ccc'}
                    />
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[styles.drawerSubtitle, { marginBottom: 8 }]}>{t('settings.reviews.review_label')}</Text>
              <TextInput
                style={[styles.input, { minHeight: 100, textAlignVertical: 'top' }]}
                placeholder={t('settings.reviews.placeholder')}
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
                <Text style={styles.saveButtonText}>{t('settings.reviews.save_button')}</Text>
              </TouchableOpacity>
            </SwipeableBottomDrawer>
          </View>
        </ConditionalKeyboardWrapper>
      </Modal>



      {/* Followers Modal */}
      <Modal
        visible={showFollowersModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowFollowersModal(false);
          setModalFollowers([]);
          setModalLastFollowerDoc(null);
          setModalHasMoreFollowers(false);
        }}
      >
        <Pressable
          style={styles.overlay}
          onPress={() => {
            setShowFollowersModal(false);
            setModalFollowers([]);
            setModalLastFollowerDoc(null);
            setModalHasMoreFollowers(false);
          }}
        />
        <View style={{
          flex: 1,
          justifyContent: 'flex-end',
          backgroundColor: 'rgba(0,0,0,0.5)'
        }}>
          <SwipeableBottomDrawer onClose={() => { setShowFollowersModal(false); setModalFollowers([]); setModalLastFollowerDoc(null); setModalHasMoreFollowers(false); }} isDarkMode={isDarkMode} style={[styles.drawer, { maxHeight: '90%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={styles.drawerSubtitle}>{t('settings.followers.title')}</Text>
              <TouchableOpacity onPress={() => {
                setShowFollowersModal(false);
                setModalFollowers([]);
                setModalLastFollowerDoc(null);
                setModalHasMoreFollowers(false);
              }}>
                <Icon name="close" size={24} color={c.text} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {loadingModalFollowers && modalFollowers.length === 0 ? (
                <ActivityIndicator size="small" color={config.colors.primary} style={{ marginVertical: 20 }} />
              ) : modalFollowers.length === 0 ? (
                <Text style={{ textAlign: 'center', color: c.textSecondary, marginVertical: 20 }}>
                  {t('settings.followers.no_followers')}
                </Text>
              ) : (
                <>
                  {modalFollowers.map((follower) => (
                    <TouchableOpacity
                      key={follower.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingVertical: 12,
                        paddingHorizontal: 8,
                        borderBottomWidth: 1,
                        borderBottomColor: c.border,
                      }}
                      activeOpacity={0.7}
                    >
                      <Image resizeMethod="resize"
                        source={{ uri: follower.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                        style={{ width: 44, height: 44, borderRadius: 22 }}
                      />
                      <Text style={{ marginLeft: 12, fontSize: 15, fontWeight: '600', color: c.text }} numberOfLines={1}>
                        {follower.displayName || t('profile.unknown_user')}
                      </Text>
                    </TouchableOpacity>
                  ))}

                  {modalHasMoreFollowers && (
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
                      onPress={loadMoreFollowers}
                      disabled={loadingModalFollowers}
                    >
                      {loadingModalFollowers ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>
                          {t('settings.reviews.load_more')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </>
              )}
            </ScrollView>
          </SwipeableBottomDrawer>
        </View>
      </Modal>

    </View>
  );
}