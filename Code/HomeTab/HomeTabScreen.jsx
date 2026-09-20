import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Image, Platform, Dimensions, Share, StatusBar, Modal, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { doc, getDoc } from '@react-native-firebase/firestore';
import config from '../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { setAppLanguage, loadLanguage, AVAILABLE_LANGUAGES } from '../../i18n';
import { useNavigation, useFocusEffect } from '@react-navigation/native';

import { getStarStatus } from '../Engagement/starUtils';
import { getUserXP, getLevelFromXP, getXPProgress, getNextLevel } from '../Engagement/xpUtils';

import StatusFeed from '../Design/StatusFeed';
import SignInDrawer from '../Firebase/SigninDrawer';
import TrendingPets from './TrendingPets';
// import HomeTrackerCard from '../PetTracker/HomeTrackerCard'; // hidden
import GuidesScreen from '../SettingScreen/GuidesScreen';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import { getMyCosmetics, syncMyCosmetics, getCachedEggData, getCachedUsername, setCachedUsername, getCachedAvatar, setCachedAvatar } from '../Helper/cosmeticsCache';
import SafeLottieView from '../Helper/SafeLottieView';
import BannerAdComponent from '../Ads/bannerAds';
import {
  VALUE_SOURCE,
  VALUE_UNIT,
  DEFAULT_VALUE_SOURCE,
  SOURCE_NAME,
  valueOf,
  formatValue as formatSourceValue,
} from '../Helper/valueSources';

// Lottie files for XP levels
const LEVEL_LOTTIE = {
  1: require('../../assets/lottie/levels/crack_egg.json'),
  2: require('../../assets/lottie/levels/springing_chick.json'),
  3: require('../../assets/lottie/levels/junior.json'),
  5: require('../../assets/lottie/levels/exploral.json'),
  7: require('../../assets/lottie/levels/adventurer.json'),
  10: require('../../assets/lottie/levels/collector.json'),
  12: require('../../assets/lottie/levels/fire.json'),
  15: require('../../assets/lottie/levels/trader_pro.json'),
  18: require('../../assets/lottie/levels/expert.json'),
  20: require('../../assets/lottie/levels/rising_star.json'),
  23: require('../../assets/lottie/levels/master.json'),
  25: require('../../assets/lottie/levels/legend.json'),
  28: require('../../assets/lottie/levels/elite.json'),
  30: require('../../assets/lottie/levels/mythic.json'),
};

const { width } = Dimensions.get('window');

const formatValue = (v) => {
  if (!v || typeof v !== 'number') return '0';
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (v < 1) return v.toFixed(2);
  return v % 1 === 0 ? v.toString() : v.toFixed(2);
};

const formatPlain = (v) => {
  if (!v || typeof v !== 'number') return '0';
  if (v % 1 === 0) return v.toLocaleString('en-US');
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// The owned-pets focus read below (user_profiles/{me} → reviews/{me}) ran on
// EVERY focus of the Home tab. Serve the last result for 10 min per uid
// instead; the first focus for a uid (and any uid change) still reads
// immediately and the screen shows the same data.
const HOME_FOCUS_REFRESH_MS = 10 * 60 * 1000;
const ownedPetsFocusCache = new Map(); // uid -> { ts, ownedPets }

const HomeTabScreen = ({ selectedTheme }) => {
  const { theme, user, tradingServerLink, appdatabase, firestoreDB, isUserBlocked, strikeInfo, deviceBanInfo } = useGlobalState();
  const { localState } = useLocalState();
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const isDarkMode = theme === 'dark';
  const insets = useSafeAreaInsets();

  const [canClaimStar, setCanClaimStar] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);
  const [showGuides, setShowGuides] = useState(false);
  const [userXP, setUserXP] = useState(() => {
    const cached = getCachedEggData();
    return { total: cached.xp || 0, level: 1 };
  });
  const starPulse = useRef(new Animated.Value(1)).current;
  const [isSigninDrawerVisible, setSigninDrawerVisible] = useState(false);
  const [signinMessage, setSigninMessage] = useState('');
  const [ownedPets, setOwnedPets] = useState([]);

  // ✅ Ban status — consumes the global gate so device-bans block too
  const isBanned = isUserBlocked;
  const banDetails = strikeInfo || deviceBanInfo;

  // Helper: require sign-in before performing action
  const requireSignIn = (action, message) => {
    const finalMessage = message || t('home_tab.sign_in_default');
    if (!user?.id) {
      setSigninMessage(finalMessage);
      setSigninDrawerVisible(true);
      return;
    }
    action();
  };
  // Cosmetics: init from MMKV (instant), then re-sync from DB
  const [myCosmetics, setMyCosmetics] = useState(() => getMyCosmetics());

  const currentLang = AVAILABLE_LANGUAGES.find(l => l.code === i18n.language) || AVAILABLE_LANGUAGES[0];

  const changeLanguage = async (langCode) => {
    await loadLanguage(langCode);
    await setAppLanguage(langCode);
    setShowLangPicker(false);
  };

  // ── Set status bar to light when Home screen is focused ──
  useFocusEffect(
    useCallback(() => {
      StatusBar.setBarStyle('light-content', true);
      if (Platform.OS === 'android') {
        StatusBar.setBackgroundColor(isDarkMode ? config.darkColors.surface : config.colors.primary, true);
      }
      return () => {
        // Reset status bar when leaving Home tab
        StatusBar.setBarStyle(isDarkMode ? 'light-content' : 'dark-content', true);
        if (Platform.OS === 'android') {
          StatusBar.setBackgroundColor(isDarkMode ? config.darkColors.bg : '#FFFFFF', true);
        }
      };
    }, [isDarkMode])
  );

  // ⭐ Live XP listener — updates hero in real-time when XP changes anywhere
  useEffect(() => {
    if (!user?.id || !appdatabase) return;

    const { ref: dbRef, onValue } = require('@react-native-firebase/database');
    const xpRef = dbRef(appdatabase, `users/${user.id}/xp`);

    const unsubscribe = onValue(xpRef, (snap) => {
      if (snap.exists()) {
        const data = snap.val();
        setUserXP({
          total: data.total || 0,
          level: data.level || 1,
        });
      }
    });

    // Sync cosmetics from DB → update state
    syncMyCosmetics(appdatabase, user.id).then(c => setMyCosmetics(c));


    // Fetch owned pets for portfolio value
    (async () => {
      try {
        let snap = await getDoc(doc(firestoreDB, 'user_profiles', user.id));
        if (!snap.exists()) snap = await getDoc(doc(firestoreDB, 'reviews', user.id));
        if (snap.exists()) {
          const data = snap.data();
          setOwnedPets(Array.isArray(data?.ownedPets) ? data.ownedPets : []);
        }
      } catch (e) { console.warn('[Home] fetch pets:', e?.message); }
    })();

    return () => unsubscribe(); // onValue returns the unsubscribe function directly
  }, [user?.id, appdatabase, firestoreDB]);

  // Re-fetch owned pets when home screen gains focus (e.g. after editing in
  // My Stuff) — at most once per 10 min per uid (see ownedPetsFocusCache);
  // otherwise re-apply the cached list.
  useFocusEffect(
    useCallback(() => {
      // Refresh cosmetics from the (instantly-updated) MMKV cache so a frame
      // just equipped in My Cosmetics shows on the hero avatar without waiting
      // for a remount. Synchronous read — no DB cost.
      setMyCosmetics(getMyCosmetics());
      if (!user?.id || !firestoreDB) return;
      const uid = user.id;
      const cached = ownedPetsFocusCache.get(uid);
      if (cached && (Date.now() - cached.ts) < HOME_FOCUS_REFRESH_MS) {
        if (Array.isArray(cached.ownedPets)) setOwnedPets(cached.ownedPets);
        return;
      }
      (async () => {
        try {
          let snap = await getDoc(doc(firestoreDB, 'user_profiles', uid));
          if (!snap.exists()) snap = await getDoc(doc(firestoreDB, 'reviews', uid));
          let pets = null;
          if (snap.exists()) {
            const data = snap.data();
            pets = Array.isArray(data?.ownedPets) ? data.ownedPets : [];
            setOwnedPets(pets);
          }
          ownedPetsFocusCache.set(uid, { ts: Date.now(), ownedPets: pets });
        } catch (e) { console.warn('[Home] refresh pets:', e?.message); }
      })();
    }, [user?.id, firestoreDB])
  );

  // ⭐ Star badge pulse animation
  useEffect(() => {
    if (canClaimStar) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(starPulse, { toValue: 1.4, duration: 500, useNativeDriver: true }),
          Animated.timing(starPulse, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [canClaimStar]);

  // ⭐ Check if daily star is claimable
  useEffect(() => {
    if (!user?.id || !appdatabase) return;
    getStarStatus(appdatabase, user.id).then(s => setCanClaimStar(!!s?.canClaim));
  }, [user?.id, appdatabase]);

  // ── Quick Action Items ──
  const quickActions = useMemo(() => [
    { key: 'values', image: require('../../assets/home-actions/pet-values.png'), label: t('home_tab.action_pet_values'), color: '#2563EB', onPress: () => navigation.navigate('ValueScreen') },
    { key: 'topRated', image: require('../../assets/home-actions/leaderboard.png'), label: t('home_tab.action_leaderboard', { defaultValue: 'Leaderboard' }), color: '#F59E0B', onPress: () => navigation.navigate('LeaderboardScreen') },
    { key: 'stars', image: require('../../assets/home-actions/badges.png'), label: t('home_tab.action_badges'), color: '#FB923C', onPress: () => requireSignIn(() => navigation.navigate('BadgesScreen'), t('home_tab.signin_claim_stars')), hasBadge: canClaimStar },
    { key: 'following', image: require('../../assets/home-actions/friends.png'), label: t('home_tab.action_friends'), color: '#EC4899', onPress: () => requireSignIn(() => navigation.navigate('SocialDashboardScreen'), t('home_tab.signin_friends')) },
    { key: 'mods', image: require('../../assets/home-actions/mods.png'), label: t('home_tab.action_mods', { defaultValue: 'Mods' }), color: '#0EA5E9', onPress: () => navigation.navigate('ModsScreen') },
  ], [t, i18n.language, navigation, canClaimStar, user?.id]);

  // ── XP computed values ──
  const currentLevel = useMemo(() => getLevelFromXP(userXP.total), [userXP.total]);
  const nextLevel = useMemo(() => getNextLevel(userXP.total), [userXP.total]);
  const xpProgress = useMemo(() => getXPProgress(userXP.total), [userXP.total]);

  // ── Greeting based on time of day ──
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return t('home_tab.good_morning', 'Good Morning');
    if (hour < 17) return t('home_tab.good_afternoon', 'Good Afternoon');
    return t('home_tab.good_evening', 'Good Evening');
  }, [t, i18n.language]);

  const handleShare = async () => {
    const link = Platform.OS === 'ios' ? config.IOsShareLink : config.andriodShareLink;
    try {
      await Share.share({
        message: t('home_tab.share_message', { link }),
      });
    } catch (_) { }
  };

  // ── Pet value lookup (same logic as TradeJournal) ──
  //
  // Re-priced against the ACTIVE source, not against whatever was stored when
  // the pet was added. "My Stuff Worth" is a live figure, so switching the
  // calculator to GG has to move it — otherwise the header keeps quoting
  // Elvebredd while every other screen quotes GG, and the two silently
  // disagree by roughly 1.9x.
  const valueSource = localState?.valueSource || DEFAULT_VALUE_SOURCE;

  const parsedPetData = useMemo(() => {
    try {
      // Falls back to Elvebredd when the GG feed has not arrived yet, so a
      // cold start shows the old total rather than zero.
      const raw = (valueSource === VALUE_SOURCE.GG && localState?.ggData)
        ? localState.ggData
        : localState?.data;
      if (!raw) return [];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch { return []; }
  }, [localState?.data, localState?.ggData, valueSource]);

  const lookupPetValue = useCallback((pet) => {
    if (!pet?.name || parsedPetData.length === 0) return Number(pet?.value) || 0;
    const petName = (pet.name || '').toLowerCase().trim();
    const item = parsedPetData.find(d => (d?.name || '').toLowerCase().trim() === petName);
    // The active source may not list this pet at all — 2,363 Elvebredd names
    // are absent from GG. Fall back to the stored snapshot rather than zero, so
    // a pet never vanishes from the total just because the source changed.
    if (!item) return Number(pet?.value) || 0;

    // `unit` applies to Elvebredd only. GG is shown exactly as GG publishes
    // it — see the GG exemption in valueSources.convert(). Converting GG to
    // Sharks used its own 0.0105 Shark anchor, which disagrees with
    // Elvebredd's by 1.905x and pulled every GG number to ~0.618x.
    return valueOf(item, {
      source: valueSource,
      unit: VALUE_UNIT.SHARK,
      valueType: pet.valueType || 'd',
      isFly: pet.isFly || false,
      isRide: pet.isRide || false,
    }) || Number(pet?.value) || 0;
  }, [parsedPetData, valueSource]);

  const portfolioValue = useMemo(() =>
    ownedPets.reduce((s, p) => s + lookupPetValue(p), 0)
    , [ownedPets, lookupPetValue]);

  const heroBgColor = isDarkMode ? '#1a1035' : config.colors.primary;

  return (
    <View style={{ flex: 1, backgroundColor: heroBgColor }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={true}
        overScrollMode="never"
      >
        {/* ═══ SECTION 1: Hero Welcome Banner ═══ */}
        <View style={[styles.heroBanner, { backgroundColor: heroBgColor, paddingTop: insets.top + 12 }]}>

          {/* Decorative hero bubbles — colorful for kids */}
          <View style={{ position: 'absolute', top: -20, right: -15, width: 100, height: 100, borderRadius: 50, backgroundColor: isDarkMode ? 'rgba(168,85,247,0.12)' : 'rgba(255,255,255,0.06)' }} />
          <View style={{ position: 'absolute', top: 30, right: 70, width: 60, height: 60, borderRadius: 30, backgroundColor: isDarkMode ? 'rgba(236,72,153,0.1)' : 'rgba(255,255,255,0.04)' }} />
          <View style={{ position: 'absolute', top: -10, left: -20, width: 80, height: 80, borderRadius: 40, backgroundColor: isDarkMode ? 'rgba(59,130,246,0.1)' : 'rgba(255,255,255,0.05)' }} />
          <View style={{ position: 'absolute', bottom: 10, left: '40%', width: 50, height: 50, borderRadius: 25, backgroundColor: isDarkMode ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.03)' }} />
          <View style={{ position: 'absolute', bottom: 20, right: '25%', width: 70, height: 70, borderRadius: 35, backgroundColor: isDarkMode ? 'rgba(20,184,166,0.1)' : 'rgba(255,255,255,0.04)' }} />

          {/* Hero overlay */}
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: isDarkMode ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.1)', borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }} />

          <View style={styles.heroContent}>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroGreeting}>{greeting}</Text>
              <Text style={styles.heroName} numberOfLines={1}>
                {user?.displayName || getCachedUsername() || t('home_tab.pet_lover_default')}
              </Text>
            </View>
            {/* Language + Avatar */}
            <View style={styles.heroRightGroup}>
              <TouchableOpacity
                onPress={() => setShowLangPicker(true)}
                activeOpacity={0.7}
                style={styles.langIcon}
              >
                <Text style={styles.langIconText}>{currentLang.flag}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigation.navigate('Setting')}
                activeOpacity={0.8}
              >
                {user?.avatar || getCachedAvatar() ? (
                  <FramedAvatar
                    avatarUri={user?.avatar || getCachedAvatar()}
                    frame={myCosmetics?.profileFrame || null}
                    isDarkMode={isDarkMode}
                    avatarSize={45}
                    forceDetail
                  />
                ) : (
                  <View style={{ width: 45, height: 45, borderRadius: 22.5, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                    <FontAwesome name="user" size={20} color="rgba(255,255,255,0.7)" solid />
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* ── XP Card (inside hero — always rendered to prevent layout shift) ── */}
          <View style={[styles.xpCard]}>
            <View style={styles.xpCardRow}>
              <View style={styles.xpCardLeft}>
                {LEVEL_LOTTIE[currentLevel.level] ? (
                  <View style={styles.xpLevelLottieWrap}>
                    <SafeLottieView
                      source={LEVEL_LOTTIE[currentLevel.level]}
                      autoPlay
                      loop
                      resizeMode="contain"
                      style={{ width: '100%', height: '100%' }}
                    />
                  </View>
                ) : (
                  <Text style={[styles.xpLevelEmoji]}>{currentLevel.emoji}</Text>
                )}
                <View>
                  <Text style={[styles.xpCardTitle, { color: isDarkMode ? config.darkColors.textPrimary : '#fff' }]}>{currentLevel.title}</Text>
                  <Text style={[styles.xpCardSub, { color: isDarkMode ? config.darkColors.textSecondary : 'rgba(255,255,255,0.7)' }]}>{t('home_tab.xp_level_sub', { level: currentLevel.level, xp: userXP.total.toLocaleString() })}</Text>
                </View>
              </View>
            </View>
            <View style={[styles.xpBarBg, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <View style={[styles.xpBarFill, { width: `${Math.max(5, xpProgress * 100)}%` }]} />
            </View>
          </View>

          {/* ── My Stuff Worth ── */}
          <TouchableOpacity
            onPress={() => requireSignIn(() => navigation.navigate('MyStuffScreen'), t('home_tab.signin_my_stuff'))}
            activeOpacity={0.8}
            style={[styles.petsWorthCard, { backgroundColor: isDarkMode ? config.darkColors.elevated : 'rgba(0,0,0,0.15)' }]}
          >
            <View style={styles.petsWorthHeader}>
              <View style={styles.petsWorthTitleRow}>
                <FontAwesome name="dog" size={14} color="#fff" solid />
                <Text style={styles.petsWorthTitle}>{t('home_tab.my_stuff_worth')}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={styles.petsWorthTotalPill}>
                  <FontAwesome name="tags" size={10} color="#FFC107" solid />
                  <Text style={styles.petsWorthTotalText}>{formatPlain(portfolioValue)}</Text>
                </View>
                <FontAwesome name="chevron-right" size={10} color="rgba(255,255,255,0.5)" />
              </View>
            </View>
          </TouchableOpacity>

        </View>

        {/* ── Page content with background ── */}
        <View style={{ backgroundColor: selectedTheme.colors.background }}>

          {/* ═══ BAN STATUS CARD ═══
              Three scenarios this card has to handle (ported from Blox Fruit):
                1. Direct account ban — strikeInfo populated (email-keyed)
                   → "Account Banned" copy
                2. Associated-device ban — only deviceBanInfo populated
                   (a different account on this device was banned)
                   → "Device Restricted" copy + surfaces the originating
                     email so the user understands why a fresh signup
                     didn't restore access.
                3. Both — direct ban wins (it's the primary signal).
          */}
          {isBanned && (strikeInfo || deviceBanInfo) && (() => {
            const info = strikeInfo || deviceBanInfo;
            const isAssociatedBan = !strikeInfo && !!deviceBanInfo;
            const associatedEmail = deviceBanInfo?.email || null;
            const isPermanent = info.bannedUntil === 'permanent';
            return (
              <View style={{
                marginHorizontal: 16,
                marginTop: 14,
                marginBottom: 4,
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: 1.5,
                borderColor: isDarkMode ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.2)',
              }}>
                {/* Red header */}
                <View style={{
                  backgroundColor: isDarkMode ? 'rgba(239,68,68,0.15)' : '#FEF2F2',
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <View style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: isDarkMode ? 'rgba(239,68,68,0.25)' : '#FEE2E2',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name={isAssociatedBan ? 'phone-portrait' : 'ban'} size={18} color="#EF4444" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#EF4444' }}>
                      ⚠️ {isAssociatedBan
                        ? (isPermanent ? 'Device Permanently Restricted' : 'Device Temporarily Restricted')
                        : (isPermanent ? 'Account Permanently Banned' : 'Account Temporarily Restricted')}
                    </Text>
                    <Text style={{ fontSize: 11, color: isDarkMode ? '#f87171' : '#DC2626', marginTop: 2 }}>
                      Strike {info.strikeCount || 1} • {
                        isPermanent
                          ? 'Permanent'
                          : (() => {
                            const diff = (info.bannedUntil || 0) - Date.now();
                            if (diff <= 0) return 'Expired';
                            const hrs = Math.floor(diff / (1000 * 60 * 60));
                            const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                            if (hrs > 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h remaining`;
                            if (hrs > 0) return `${hrs}h ${mins}m remaining`;
                            return `${mins}m remaining`;
                          })()
                      }
                    </Text>
                  </View>
                </View>

                {/* Why-you're-seeing-this — associated-device ban only */}
                {isAssociatedBan && (
                  <View style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    backgroundColor: isDarkMode ? 'rgba(239,68,68,0.06)' : '#FFFBFB',
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#FCE4E4',
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: isDarkMode ? '#888' : '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
                      Why you are seeing this
                    </Text>
                    <Text style={{ fontSize: 13, color: isDarkMode ? '#e5e5e5' : '#374151', lineHeight: 18 }}>
                      {associatedEmail
                        ? `This device is linked to a banned account (${associatedEmail}). Signing in with a different email won't restore access.`
                        : "This device is linked to a banned account. Signing in with a different email won't restore access."}
                    </Text>
                  </View>
                )}

                {/* Reason body */}
                {info.reason && (
                  <View style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    backgroundColor: isDarkMode ? 'rgba(239,68,68,0.06)' : '#FFFBFB',
                    borderTopWidth: isAssociatedBan ? StyleSheet.hairlineWidth : 0,
                    borderTopColor: isDarkMode ? 'rgba(255,255,255,0.06)' : '#FCE4E4',
                  }}>
                    <Text style={{ fontSize: 10, fontWeight: '600', color: isDarkMode ? '#888' : '#9CA3AF', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Reason</Text>
                    <Text style={{ fontSize: 13, color: isDarkMode ? '#e5e5e5' : '#374151', lineHeight: 18 }}>
                      {info.reason}
                    </Text>
                  </View>
                )}
              </View>
            );
          })()}

          {/* ═══ SECTION 2: Quick Actions Row ═══ */}
          <View style={styles.quickActionsRow}>
            {quickActions.map((action) => (
              <TouchableOpacity
                key={action.key}
                style={styles.quickActionBtn}
                onPress={action.onPress || (() => {
                  if (action.screen) {
                    navigation.navigate(action.tab, { screen: action.screen });
                  } else {
                    navigation.navigate(action.tab);
                  }
                })}
                activeOpacity={0.7}
              >
                <View style={{ position: 'relative' }}>
                  <View style={[styles.quickActionIcon, { backgroundColor: action.color + '14' }]}>
                    <Image source={action.image} style={styles.quickActionImage} resizeMode="contain" />
                  </View>
                  {action.hasBadge && (
                    <Animated.View style={[styles.starBadge, { transform: [{ scale: starPulse }] }]} />
                  )}
                  {action.isNew && (
                    <View style={styles.newTileBadge}>
                      <Text style={styles.newTileBadgeText}>NEW</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.quickActionLabel, { color: isDarkMode ? config.darkColors.textSecondary : '#64748b' }]} numberOfLines={1}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ═══ STATUS FEED (Stories) ═══ */}
          <StatusFeed
            user={user}
            firestoreDB={firestoreDB}
            appdatabase={appdatabase}
            isDarkMode={isDarkMode}
            onRequireSignIn={() => setSigninDrawerVisible(true)}
          />

          {/* ═══ SECTION: Trending Pets ═══ */}
          <TrendingPets isDarkMode={isDarkMode} navigation={navigation} />

          {/* ═══ Pet Aging & Growing Tracker (hidden) ═══ */}
          {/* <HomeTrackerCard isDarkMode={isDarkMode} navigation={navigation} /> */}

          {/* ═══ SECTION 3: Cosmetics ═══ */}
          <View style={styles.section}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Image source={require('../../assets/home-actions/cosmetics.png')} style={styles.cosmeticsSectionIcon} resizeMode="contain" />
              <Text style={[styles.sectionTitle, { color: selectedTheme.colors.text, marginBottom: 0 }]}>Cosmetics</Text>
            </View>
            <View style={styles.cosmeticsCards}>
              {/* 🥚 Hatch eggs to earn cosmetics */}
              <TouchableOpacity
                style={[
                  styles.cosmeticCard,
                  {
                    backgroundColor: isDarkMode ? 'rgba(236,72,153,0.12)' : '#FDF2F8',
                    borderColor: isDarkMode ? 'rgba(236,72,153,0.3)' : '#FBCFE8',
                  },
                ]}
                onPress={() => requireSignIn(() => navigation.navigate('MysteryEggScreen'), t('home_tab.signin_mystery_egg'))}
                activeOpacity={0.85}
              >
                <View style={[styles.cosmeticIcon, { backgroundColor: '#EC4899' }]}>
                  <Image source={require('../../assets/home-actions/mystery-egg.png')} style={styles.cosmeticCardImage} resizeMode="contain" />
                </View>
                <View style={styles.cosmeticCardContent}>
                  <View style={styles.cosmeticTitleRow}>
                    <Text style={[styles.cosmeticCardTitle, { color: selectedTheme.colors.text }]}>
                      {t('home_tab.game_mystery_egg')}
                    </Text>
                    <View style={styles.cosmeticNewBadge}>
                      <Text style={styles.cosmeticNewBadgeText}>{t('home_tab.new')}</Text>
                    </View>
                  </View>
                  <Text style={[styles.cosmeticCardDesc, { color: isDarkMode ? '#94A3B8' : '#64748B' }]}>Hatch eggs to win cosmetics</Text>
                </View>
                <FontAwesome name="chevron-right" size={14} color={isDarkMode ? '#64748B' : '#94A3B8'} solid />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.cosmeticCard,
                  {
                    backgroundColor: isDarkMode ? 'rgba(139,92,246,0.12)' : '#F5F3FF',
                    borderColor: isDarkMode ? 'rgba(139,92,246,0.3)' : '#DDD6FE',
                  },
                ]}
                onPress={() => requireSignIn(() => navigation.navigate('MyCosmeticsScreen'), t('home_tab.signin_cosmetics'))}
                activeOpacity={0.85}
              >
                <View style={[styles.cosmeticIcon, { backgroundColor: '#8B5CF6' }]}>
                  <Image source={require('../../assets/home-actions/cosmetics.png')} style={styles.cosmeticCardImage} resizeMode="contain" />
                </View>
                <View style={styles.cosmeticCardContent}>
                  <Text style={[styles.cosmeticCardTitle, { color: selectedTheme.colors.text }]}>{t('home_tab.action_cosmetics')}</Text>
                  <Text style={[styles.cosmeticCardDesc, { color: isDarkMode ? '#94A3B8' : '#64748B' }]}>View and equip your collection</Text>
                </View>
                <FontAwesome name="chevron-right" size={14} color={isDarkMode ? '#64748B' : '#94A3B8'} solid />
              </TouchableOpacity>
            </View>
          </View>

          {/* ═══ SECTION 4: Share Button ═══ */}
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.shareButton}
              onPress={handleShare}
              activeOpacity={0.85}
            >
              <FontAwesome name="paw" size={18} color="#fff" solid />
              <Text style={styles.shareButtonText}>{t('home_tab.invite_friends_play')}</Text>
              <FontAwesome name="paper-plane" size={14} color="#fff" solid />
            </TouchableOpacity>
          </View>

          {/* ═══ How It Works — bottom text link ═══ */}
          <TouchableOpacity
            style={styles.guidesLink}
            onPress={() => setShowGuides(true)}
            activeOpacity={0.7}
          >
            <FontAwesome name="circle-question" size={14} color={isDarkMode ? '#94A3B8' : '#64748B'} />
            <Text style={[styles.guidesLinkText, { color: isDarkMode ? '#94A3B8' : '#64748B' }]}>
              {t('guides.link_text', { defaultValue: 'How It Works — Learn about all features' })}
            </Text>
          </TouchableOpacity>

          {/* ═══ SECTION 5: Footer ═══ */}
          <View style={styles.footer}>
            <Image
              source={require('../../assets/splashscreen.webp')}
              style={styles.footerLogo}
              resizeMode="contain"
            />
            <Text style={[styles.footerText, { color: isDarkMode ? config.darkColors.textMuted : '#BBB' }]}>
              {t('home_tab.made_with_love')}
            </Text>
          </View>

        </View>
      </ScrollView>

      {/* ═══ Sticky Banner Ad (outside ScrollView) ═══ */}
      {!localState.isPro && <BannerAdComponent collapsible />}





      {/* 📖 Guides Modal */}
      <GuidesScreen visible={showGuides} onClose={() => setShowGuides(false)} />

      {/* 🔐 Sign In Drawer (for StatusFeed) */}
      <SignInDrawer
        visible={isSigninDrawerVisible}
        onClose={() => setSigninDrawerVisible(false)}
        selectedTheme={selectedTheme}
        screen="Home"
        message={signinMessage}
      />

      {/* 🌐 Language Picker Modal */}
      <Modal visible={showLangPicker} animationType="fade" transparent>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
          activeOpacity={1}
          onPress={() => setShowLangPicker(false)}
        >
          <TouchableOpacity activeOpacity={1} style={{
            backgroundColor: isDarkMode ? '#1e293b' : '#fff',
            borderRadius: 20, padding: 20, width: '100%', maxWidth: 340,
          }}>
            <Text style={{ fontSize: 18, fontWeight: '800', color: isDarkMode ? '#f1f5f9' : '#111', marginBottom: 16, textAlign: 'center' }}>
              {t('home_tab.choose_language')}
            </Text>
            {AVAILABLE_LANGUAGES.map(lang => {
              const isActive = i18n.language === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={{
                    flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 14,
                    borderRadius: 12, marginBottom: 4,
                    backgroundColor: isActive ? (isDarkMode ? '#3B82F620' : '#EFF6FF') : 'transparent',
                  }}
                  onPress={() => changeLanguage(lang.code)}
                >
                  <Text style={{ fontSize: 22, marginRight: 12 }}>{lang.flag}</Text>
                  <Text style={{ fontSize: 14, fontWeight: isActive ? '800' : '500', color: isDarkMode ? '#f1f5f9' : '#111', flex: 1 }}>
                    {lang.name}
                  </Text>
                  {isActive && <Text style={{ fontSize: 14, color: '#3B82F6' }}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // ── Cosmetics Cards ──
  cosmeticsCards: { gap: 10 },
  cosmeticsSectionIcon: { width: 24, height: 24 },
  cosmeticCard: {
    width: '100%',
    minHeight: 68,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cosmeticIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cosmeticCardImage: { width: 38, height: 38 },
  cosmeticCardContent: { flex: 1 },
  cosmeticTitleRow: { flexDirection: 'row', alignItems: 'center' },
  cosmeticCardTitle: { fontSize: 14, fontWeight: '800' },
  cosmeticCardDesc: { fontSize: 11, fontWeight: '500', marginTop: 3 },
  cosmeticNewBadge: {
    marginLeft: 7,
    backgroundColor: '#EC4899',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  cosmeticNewBadgeText: { color: '#fff', fontSize: 8, fontWeight: '800' },

  // ── Hero Banner (Premium Minimal) ──
  heroBanner: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  heroContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 2,
    marginBottom: 14,
  },
  heroTextWrap: {
    flex: 1,
    marginRight: 16,
  },
  heroGreeting: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.7)',
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  heroName: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: -0.3,
  },
  heroRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  langIcon: {
    backgroundColor: 'transparent',
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langIconText: {
    fontSize: 15,
  },

  // ── XP Card (inside hero) ──
  xpCard: {
    marginHorizontal: 0,
    // paddingHorizontal: 14,
    // paddingVertical: 12,
    borderRadius: 14,
  },
  xpCardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  xpCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  xpLevelEmoji: {
    fontSize: 20,
  },
  xpCardTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  xpCardSub: {
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  xpLevelLottieWrap: {
    width: 30,
    height: 30,
    overflow: 'visible',
  },
  xpValuePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  xpValueText: {
    fontSize: 12,
    fontWeight: '700',
  },
  xpBarBg: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
  },
  xpBarFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#FFC107',
  },

  // ── My Pets Worth Card ──
  petsWorthCard: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
  },
  petsWorthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  petsWorthTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  petsWorthTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  petsWorthTotalPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  petsWorthTotalText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFC107',
  },
  petsWorthItem: {
    alignItems: 'center',
    width: 60,
  },
  petsWorthItemImage: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  petsWorthItemName: {
    fontSize: 9,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
    textAlign: 'center',
  },
  petsWorthItemValue: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFC107',
    marginTop: 1,
  },

  // ── Quick Actions ──
  quickActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 12,
    paddingVertical: 20,
  },
  quickActionBtn: {
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  quickActionIcon: {
    width: 50,
    height: 50,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickActionImage: { width: 42, height: 42 },
  starBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#EF4444',
    borderWidth: 2,
    borderColor: '#fff',
  },
  newTileBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  newTileBadgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  quickActionLabel: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },

  // ── Share button ──
  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6366F1',
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  shareButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },

  // ── Sections ──
  section: {
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 14,
  },


  // ── Guides link ──
  guidesLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 4,
  },
  guidesLinkText: {
    fontSize: 13,
    fontWeight: '500',
  },

  // ── Footer ──
  footer: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  footerLogo: {
    width: 40,
    height: 40,
    marginBottom: 8,
    opacity: 0.5,
  },
  footerText: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },

});

export default HomeTabScreen;
