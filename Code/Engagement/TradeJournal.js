/**
 * TradeJournal.js — Pet Portfolio Hub
 *
 * 2-tab hub:
 * 🎒 My Pets — owned pets grid, add new, total value
 * ⭐ Goals  — wishlist with progress bars + goal tracking
 *
 * Active/Done/Saved trades were removed from here — the Trades feed
 * now has My Trades / Saved filters for instant access.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Image,
  StyleSheet, Dimensions, ActivityIndicator, Alert, ScrollView, TextInput,
} from 'react-native';
import { useNavigation, useIsFocused, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  doc, getDoc, setDoc, serverTimestamp as fsServerTimestamp,
} from '@react-native-firebase/firestore';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import PetModal from '../ChatScreen/PrivateChat/PetsModel';
import { useLocalState } from '../LocalGlobelStats';
import { fetchAnalyticsData, getDemandScore, getHotStatus } from '../Helper/analyticsDataHelper';
import { getThemeColors } from '../Helper/themeColors';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import { useGlobalState } from '../GlobelStats';
import BannerAdComponent from '../Ads/bannerAds';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PET_CARD_SIZE = (SCREEN_WIDTH - 64) / 3;

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

const TAB_COLORS = {
  pets: '#3B82F6',
  goals: '#F59E0B',
};

const TABS = [
  { key: 'pets', icon: 'bag-shopping', label: 'trade_journal.tabs.my_pets' },
  { key: 'goals', icon: 'star', label: 'trade_journal.tabs.goals' },
];

const TradeJournal = ({
  firestoreDB, db, uid, isDarkMode,
}) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const visible = useIsFocused();
  const insets = useSafeAreaInsets();
  const initialTabParam = route.params?.initialTab;
  const [tab, setTab] = useState(TABS.some(t => t.key === initialTabParam) ? initialTabParam : 'pets');
  const { localState, updateLocalState } = useLocalState();
  const [ownedPets, setOwnedPets] = useState(localState.ownedPets || []);
  const [wishlistPets, setWishlistPets] = useState(localState.wishlistPets || []);
  const [loading, setLoading] = useState(true);
  const [showPetPicker, setShowPetPicker] = useState(false);
  const [petPickerMode, setPetPickerMode] = useState('owned');
  const [petSearch, setPetSearch] = useState('');
  const [petSort, setPetSort] = useState('recent'); // 'recent' | 'value-desc' | 'value-asc' | 'name'
  const [showMyProfile, setShowMyProfile] = useState(false);
  const { user } = useGlobalState();

  // Sync tab when navigating from notification
  useEffect(() => {
    const paramTab = route.params?.initialTab;
    if (paramTab && TABS.some(t => t.key === paramTab)) {
      setTab(paramTab);
      navigation.setParams({ initialTab: undefined, highlightTradeId: undefined });
    }
  }, [route.params?.initialTab]);

  // Refs to avoid stale closures in PetModal onClose
  const ownedPetsRef = useRef(ownedPets);
  const wishlistPetsRef = useRef(wishlistPets);
  useEffect(() => { ownedPetsRef.current = ownedPets; }, [ownedPets]);
  useEffect(() => { wishlistPetsRef.current = wishlistPets; }, [wishlistPets]);

  // Image URL helper
  const getImgUrl = useCallback((imgPath) => {
    if (!imgPath) return 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
    if (imgPath.startsWith('http')) return imgPath;
    const base = (localState?.imgurl || 'https://elvebredd.com').replace(/"/g, '').replace(/\/$/, '');
    const path = imgPath.startsWith('/') ? imgPath : `/${imgPath}`;
    return `${base}${path}`;
  }, [localState?.imgurl]);

  // ── Fetch owned + wishlist pets ──
  // 📅 2026-03-13: Migrated from reviews/{userId} → user_profiles/{userId}.
  //    Reads user_profiles first, falls back to reviews for backward compat with older app versions.
  //    🔮 FUTURE CLEANUP: Once all users have updated, remove the reviews fallback read (line with 'reviews', uid).
  const fetchPets = useCallback(async () => {
    if (!firestoreDB || !uid) return;
    try {
      let snap = await getDoc(doc(firestoreDB, 'user_profiles', uid));
      // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this fallback once all users updated
      if (!snap.exists()) {
        snap = await getDoc(doc(firestoreDB, 'reviews', uid));
      }
      if (snap.exists()) {
        const data = snap.data();
        const owned = Array.isArray(data?.ownedPets) ? data.ownedPets : [];
        const wishlist = Array.isArray(data?.wishlistPets) ? data.wishlistPets : [];
        setOwnedPets(owned);
        setWishlistPets(wishlist);
        // Sync to MMKV so next open is instant
        updateLocalState('ownedPets', owned);
        updateLocalState('wishlistPets', wishlist);
      }
    } catch (err) {
      console.warn('[MyStuff] fetch pets error:', err?.message);
    }
  }, [firestoreDB, uid, updateLocalState]);

  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (visible) {
      // Only fetch pets/goals once — they only change via user actions
      // which already update state directly.
      if (!initialLoadDoneRef.current) {
        setLoading(true);
        fetchPets()
          .finally(() => {
            setLoading(false);
            initialLoadDoneRef.current = true;
            setTimeout(() => { hasFetchedRef.current = true; }, 200);
          });
        fetchAnalyticsData().then(setAnalyticsMaps).catch(() => {});
      }
    }
  }, [visible, fetchPets]);


  // ── Save pets to Firestore ──
  // 📅 2026-03-13: Dual-write to user_profiles (new primary) + reviews (backward compat).
  //    🔮 FUTURE CLEANUP: Once all users updated, remove the setDoc to 'reviews' below.
  const savePets = useCallback(async (newOwned, newWishlist) => {
    if (!firestoreDB || !uid) return;
    try {
      const payload = {
        ownedPets: newOwned,
        wishlistPets: newWishlist,
        updatedAt: fsServerTimestamp(),
      };
      await Promise.all([
        setDoc(doc(firestoreDB, 'user_profiles', uid), payload, { merge: true }),
        // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this line once all users updated
        setDoc(doc(firestoreDB, 'reviews', uid), payload, { merge: true }),
      ]);

      // 🐾 Check petParent (20+ pets) and collector (100+ pets) badges
      if (db && uid && newOwned.length >= 20) {
        try {
          const { checkPetParentBadge, checkCollectorBadge } = require('../ChatScreen/GroupChat/badgeUtils');
          checkPetParentBadge(db, uid, newOwned.length);
          if (newOwned.length >= 100) checkCollectorBadge(db, uid, newOwned.length);
        } catch (e) {}
      }
      // Sync MMKV immediately so HomeScreen & next open reflect changes
      updateLocalState('ownedPets', newOwned);
      updateLocalState('wishlistPets', newWishlist);
    } catch (err) {
      console.warn('[MyStuff] save error:', err?.message);
    }
  }, [firestoreDB, uid, updateLocalState]);

  // ── Auto-save pets when they change (debounced) ──
  const hasFetchedRef = useRef(false);
  const saveTimerRef = useRef(null);
  useEffect(() => {
    if (!hasFetchedRef.current) return; // Skip initial fetch
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      savePets(ownedPets, wishlistPets);
    }, 300);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [ownedPets, wishlistPets, savePets]);

  // ── Remove pet from owned ──
  const removePet = useCallback((index) => {
    Alert.alert(t('trade_journal.alerts.remove_pet_title'), t('trade_journal.alerts.remove_pet_msg'), [
      { text: t('trade_journal.alerts.keep_it'), style: 'cancel' },
      {
        text: t('trade_journal.alerts.remove'), style: 'destructive',
        onPress: () => {
          const newOwned = ownedPets.filter((_, i) => i !== index);
          setOwnedPets(newOwned);
          savePets(newOwned, wishlistPets);
        },
      },
    ]);
  }, [ownedPets, wishlistPets, savePets, t]);

  // ── Remove pet from wishlist ──
  const removeWishlistPet = useCallback((index) => {
    const newWishlist = wishlistPets.filter((_, i) => i !== index);
    setWishlistPets(newWishlist);
    savePets(ownedPets, newWishlist);
  }, [ownedPets, wishlistPets, savePets]);

  // ── Clear all owned pets ──
  const clearOwnedPets = useCallback(() => {
    Alert.alert(
      t('trade_journal.alerts.clear_pets_title', { defaultValue: 'Clear inventory?' }),
      t('trade_journal.alerts.clear_pets_msg', {
        count: ownedPets.length,
        defaultValue: 'This removes all {{count}} pets from your inventory. Your wishlist and trade history are not affected.',
      }),
      [
        { text: t('trade_journal.alerts.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('trade_journal.alerts.clear_all', { defaultValue: 'Clear all' }),
          style: 'destructive',
          onPress: async () => {
            setOwnedPets([]);
            try {
              await savePets([], wishlistPets);
            } catch {
              Alert.alert(
                t('trade_journal.alerts.error', { defaultValue: 'Error' }),
                t('trade_journal.alerts.could_not_clear', { defaultValue: 'Could not clear inventory.' })
              );
            }
          },
        },
      ]
    );
  }, [ownedPets.length, wishlistPets, savePets, t]);

  // ── Clear all wishlist pets ──
  const clearWishlistPets = useCallback(() => {
    Alert.alert(
      t('trade_journal.alerts.clear_wishlist_title', { defaultValue: 'Clear wishlist?' }),
      t('trade_journal.alerts.clear_wishlist_msg', {
        count: wishlistPets.length,
        defaultValue: 'This removes all {{count}} pets from your wishlist. Your inventory and trade history are not affected.',
      }),
      [
        { text: t('trade_journal.alerts.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('trade_journal.alerts.clear_all', { defaultValue: 'Clear all' }),
          style: 'destructive',
          onPress: async () => {
            setWishlistPets([]);
            try {
              await savePets(ownedPets, []);
            } catch {
              Alert.alert(
                t('trade_journal.alerts.error', { defaultValue: 'Error' }),
                t('trade_journal.alerts.could_not_clear', { defaultValue: 'Could not clear wishlist.' })
              );
            }
          },
        },
      ]
    );
  }, [wishlistPets.length, ownedPets, savePets, t]);

  // ── Toggle pet available for trade ──
  const toggleAvailableForTrade = useCallback((index, listType) => {
    if (listType === 'owned') {
      const newOwned = ownedPets.map((pet, i) =>
        i === index ? { ...pet, availableForTrade: !pet.availableForTrade } : pet
      );
      setOwnedPets(newOwned);
    } else {
      const newWishlist = wishlistPets.map((pet, i) =>
        i === index ? { ...pet, availableForTrade: !pet.availableForTrade } : pet
      );
      setWishlistPets(newWishlist);
    }
  }, [ownedPets, wishlistPets]);

  // ── Real-time pet value lookup from RTDB data ──
  const parsedPetData = useMemo(() => {
    try {
      const raw = localState?.data;
      if (!raw) return [];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
    } catch { return []; }
  }, [localState?.data]);

  const lookupPetValue = useCallback((pet) => {
    if (!pet?.name || parsedPetData.length === 0) return Number(pet?.value) || 0;
    const petName = (pet.name || '').toLowerCase().trim();
    const item = parsedPetData.find(d => (d?.name || '').toLowerCase().trim() === petName);
    if (!item) return Number(pet?.value) || 0;

    // Simple categories — use base value
    const simpleCategories = ['eggs', 'vehicles', 'pet wear', 'other', 'toys', 'food', 'strollers', 'gifts'];
    if (simpleCategories.includes(item.type?.toLowerCase())) {
      return Number(item.type?.toLowerCase() === 'eggs' ? item.rvalue : item.value) || 0;
    }

    // Determine value type from stored pet data (d=default/regular, n=neon, m=mega)
    const vType = pet.valueType || 'd';
    const valueKey = vType === 'n' ? 'nvalue' : vType === 'm' ? 'mvalue' : 'rvalue';

    // Determine modifier suffix
    const isFly = pet.isFly || false;
    const isRide = pet.isRide || false;
    const suffix = isFly && isRide ? ' - fly&ride' :
      isFly ? ' - fly' : isRide ? ' - ride' : ' - nopotion';

    return Number(item[valueKey + suffix]) || Number(item.rvalue) || 0;
  }, [parsedPetData]);

  // ── Demand data ──
  const [analyticsMaps, setAnalyticsMaps] = useState({ demandMap: {}, hotMap: {} });

  // ── Computed values ──
  const portfolioValue = useMemo(() =>
    ownedPets.reduce((s, p) => s + lookupPetValue(p), 0)
  , [ownedPets, lookupPetValue]);

  // Pets list as user sees it: filtered by search, sorted by chosen mode.
  // Each entry keeps its originalIndex so removePet still operates on the
  // canonical ownedPets array regardless of display order.
  const displayedPets = useMemo(() => {
    const q = petSearch.trim().toLowerCase();
    const indexed = ownedPets.map((pet, originalIndex) => ({ pet, originalIndex }));
    const filtered = q
      ? indexed.filter(({ pet }) => (pet.name || '').toLowerCase().includes(q))
      : indexed;
    if (petSort === 'recent') return filtered;
    const sorted = [...filtered];
    if (petSort === 'value-desc') sorted.sort((a, b) => lookupPetValue(b.pet) - lookupPetValue(a.pet));
    else if (petSort === 'value-asc') sorted.sort((a, b) => lookupPetValue(a.pet) - lookupPetValue(b.pet));
    else if (petSort === 'name') sorted.sort((a, b) => (a.pet.name || '').localeCompare(b.pet.name || ''));
    return sorted;
  }, [ownedPets, petSearch, petSort, lookupPetValue]);

  // Colors
  const c = getThemeColors(isDarkMode);
  const bg = c.bg;
  const cardBg = c.bgAlt;
  const textColor = c.text;
  const subtextColor = c.textSecondary;

  // ════════════════════════════════════════════════
  // TAB 1: MY PETS
  // ════════════════════════════════════════════════
  const renderMyPets = () => (
    <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.heroCard, { backgroundColor: isDarkMode ? '#1e293b' : '#f0f9ff' }]}>
        <Text style={[styles.heroLabel, { color: subtextColor }]}>{t('trade_journal.my_pets.worth')}</Text>
        <Text style={[styles.heroValue, { color: '#3B82F6' }]}>{formatPlain(portfolioValue)}</Text>
        <Text style={[styles.heroSub, { color: subtextColor }]}>{t('trade_journal.my_pets.pets_count', { count: ownedPets.length })}</Text>
        <TouchableOpacity
          onPress={() => setShowMyProfile(true)}
          style={{
            marginTop: 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            backgroundColor: isDarkMode ? '#1e3a5f' : '#dbeafe',
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 20,
          }}
        >
          <FontAwesome name="user" size={11} color="#3B82F6" />
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#3B82F6' }}>
            {t('trade_journal.my_pets.view_my_profile', { defaultValue: 'View my profile' })}
          </Text>
        </TouchableOpacity>
        {ownedPets.length > 0 && (() => {
          // Demand breakdown of entire portfolio
          let highDemand = [], risingPets = [], lowDemand = 0, noDemand = 0;
          ownedPets.forEach(p => {
            const d = getDemandScore(p.name, analyticsMaps.demandMap);
            const h = getHotStatus(p.name, analyticsMaps.hotMap);
            if (d && d.score >= 7) highDemand.push({ ...p, demandScore: d.score });
            else if (h && h.isHot) risingPets.push({ ...p, pct: h.pct });
            else if (d && d.score <= 3) lowDemand++;
            else noDemand++;
          });
          const totalTracked = highDemand.length + risingPets.length + lowDemand;
          const portfolioStrength = totalTracked > 0
            ? highDemand.length >= 3 ? t('trade_journal.my_pets.power_strong') : highDemand.length >= 1 ? t('trade_journal.my_pets.power_decent') : t('trade_journal.my_pets.power_weak')
            : null;
          return (
            <View style={{ marginTop: 10, width: '100%' }}>
              {/* Demand tier breakdown */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: 6 }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#EF4444' }}>{highDemand.length}</Text>
                  <Text style={{ fontSize: 9, color: subtextColor }}>{t('trade_journal.my_pets.hot')}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#10B981' }}>{risingPets.length}</Text>
                  <Text style={{ fontSize: 9, color: subtextColor }}>{t('trade_journal.my_pets.rising')}</Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: '#94a3b8' }}>{lowDemand}</Text>
                  <Text style={{ fontSize: 9, color: subtextColor }}>{t('trade_journal.my_pets.low')}</Text>
                </View>
              </View>
              {/* Portfolio strength */}
              {portfolioStrength && (
                <Text style={{ fontSize: 11, color: '#3B82F6', textAlign: 'center', fontWeight: '600' }}>
                  {portfolioStrength}
                </Text>
              )}
              {/* Best assets */}
              {highDemand.length > 0 && (
                <Text style={{ fontSize: 10, color: subtextColor, textAlign: 'center', marginTop: 4 }}>
                  {t('trade_journal.my_pets.best_assets')} {highDemand.sort((a, b) => b.demandScore - a.demandScore).slice(0, 3).map(p => p.name).join(', ')}
                </Text>
              )}
            </View>
          );
        })()}
      </View>

      {/* Trade visibility hint */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
        backgroundColor: isDarkMode ? '#1e3a5f40' : '#EFF6FF',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginVertical: 8,
        borderLeftWidth: 3,
        borderLeftColor: '#3B82F6',
      }}>
        <FontAwesome name="circle-info" size={13} color="#3B82F6" style={{ marginTop: 1 }} />
        <Text style={{ flex: 1, fontSize: 11, color: isDarkMode ? '#cbd5e1' : '#475569', lineHeight: 15 }}>
          {t('trade_journal.my_pets.trade_visibility_hint', { defaultValue: 'Tap the pill below each pet to toggle between ✅ For Trade and 🔒 Private. Only items marked For Trade appear on your profile for others to trade with.' })}
        </Text>
      </View>

      {/* Add pet button */}
      <TouchableOpacity
        style={[styles.addPetBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#f0fdf4' }]}
        onPress={() => { setPetPickerMode('owned'); setShowPetPicker(true); }}
      >
        <Text style={[styles.addPetText, { color: '#10B981' }]}>{t('trade_journal.my_pets.add_pet')}</Text>
      </TouchableOpacity>

      {/* Search + sort controls */}
      {ownedPets.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: cardBg,
            borderRadius: 10,
            paddingHorizontal: 10,
            height: 36,
            marginBottom: 8,
          }}>
            <FontAwesome name="magnifying-glass" size={12} color={subtextColor} />
            <TextInput
              value={petSearch}
              onChangeText={setPetSearch}
              placeholder={t('trade_journal.my_pets.search_placeholder', { defaultValue: 'Search pets...' })}
              placeholderTextColor={subtextColor}
              style={{ flex: 1, marginLeft: 8, color: textColor, fontSize: 13, padding: 0 }}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {petSearch.length > 0 && (
              <TouchableOpacity onPress={() => setPetSearch('')} hitSlop={8}>
                <Text style={{ color: subtextColor, fontSize: 14 }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {[
              { key: 'recent', label: t('trade_journal.my_pets.sort_recent', { defaultValue: 'Recent' }) },
              { key: 'value-desc', label: t('trade_journal.my_pets.sort_value_desc', { defaultValue: 'Value ↓' }) },
              { key: 'value-asc', label: t('trade_journal.my_pets.sort_value_asc', { defaultValue: 'Value ↑' }) },
              { key: 'name', label: t('trade_journal.my_pets.sort_name', { defaultValue: 'A–Z' }) },
            ].map(opt => {
              const active = petSort === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => setPetSort(opt.key)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 14,
                    backgroundColor: active ? '#3B82F6' : cardBg,
                  }}
                >
                  <Text style={{
                    fontSize: 11,
                    fontWeight: '600',
                    color: active ? '#fff' : subtextColor,
                  }}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Pets grid */}
      {ownedPets.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={{ fontSize: 40 }}>🎒</Text>
          <Text style={[styles.emptyTitle, { color: textColor }]}>{t('trade_journal.my_pets.empty_title')}</Text>
          <Text style={[styles.emptySub, { color: subtextColor }]}>
            {t('trade_journal.my_pets.empty_sub')}
          </Text>
        </View>
      ) : displayedPets.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Text style={{ fontSize: 40 }}>🔍</Text>
          <Text style={[styles.emptyTitle, { color: textColor }]}>
            {t('trade_journal.my_pets.no_match_title', { defaultValue: 'No pets match' })}
          </Text>
          <Text style={[styles.emptySub, { color: subtextColor }]}>
            {t('trade_journal.my_pets.no_match_sub', { defaultValue: 'Try a different search.' })}
          </Text>
        </View>
      ) : (
        <View style={styles.petsGrid}>
          {displayedPets.map(({ pet, originalIndex }) => (
            <View
              key={`${pet.name}-${originalIndex}`}
              style={[styles.petCard, { backgroundColor: cardBg }]}
            >
              <TouchableOpacity style={styles.petRemoveBtn} onPress={() => removePet(originalIndex)}>
                <Text style={styles.petRemoveText}>✕</Text>
              </TouchableOpacity>
              <Image
                source={{ uri: getImgUrl(pet.imageUrl || pet.image) }}
                style={styles.petImage}
                resizeMode="contain"
              />
              <Text style={[styles.petName, { color: textColor }]} numberOfLines={1}>
                {pet.name}
              </Text>
              {(lookupPetValue(pet) > 0) && (
                <Text style={[styles.petValue, { color: subtextColor }]}>
                  {formatPlain(lookupPetValue(pet))}
                </Text>
              )}
              {(() => {
                const demand = getDemandScore(pet.name, analyticsMaps.demandMap);
                const hot = getHotStatus(pet.name, analyticsMaps.hotMap);
                if (demand && demand.score >= 7) return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 }}>
                    <Text style={{ fontSize: 8, color: demand.score >= 8 ? '#EF4444' : '#F59E0B' }}>🔥 {demand.label}</Text>
                  </View>
                );
                if (hot) return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 }}>
                    <Text style={{ fontSize: 8, color: '#10B981' }}>📈 +{hot.pct}%</Text>
                  </View>
                );
                return null;
              })()}
              {pet.addedVia === 'trade' && (
                <View style={styles.tradeBadge}>
                  <Text style={styles.tradeBadgeText}>🔄</Text>
                </View>
              )}
              <TouchableOpacity
                onPress={() => toggleAvailableForTrade(originalIndex, 'owned')}
                style={{
                  marginTop: 4,
                  paddingVertical: 4,
                  paddingHorizontal: 7,
                  borderRadius: 6,
                  backgroundColor: pet.availableForTrade
                    ? (isDarkMode ? '#10B98120' : '#D1FAE5')
                    : (isDarkMode ? '#F59E0B20' : '#FEF3C7'),
                  borderWidth: 1,
                  borderColor: pet.availableForTrade ? '#10B981' : '#F59E0B',
                }}
              >
                <Text style={{
                  fontSize: 8,
                  fontWeight: '800',
                  color: pet.availableForTrade ? '#10B981' : '#D97706',
                  textAlign: 'center',
                }}>
                  {pet.availableForTrade ? '✅ For Trade' : '🔒 Private'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {ownedPets.length > 0 && (
        <TouchableOpacity style={styles.clearHistoryBtn} onPress={clearOwnedPets}>
          <Text style={styles.clearHistoryText}>
            {t('trade_journal.my_pets.clear_inventory', { defaultValue: '🗑 Clear inventory' })}
          </Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );

  // ════════════════════════════════════════════════
  // TAB 2: GOALS (Wishlist)
  // ════════════════════════════════════════════════
  const renderGoals = () => {
    // Pre-compute owned pets with values for suggestions
    const ownedWithValues = ownedPets.map(op => ({
      name: op.name,
      value: lookupPetValue(op),
      demand: getDemandScore(op.name, analyticsMaps.demandMap)?.score || 0,
    })).filter(op => op.value > 0).sort((a, b) => b.value - a.value);

    const bestOwnedValue = ownedWithValues.length > 0 ? ownedWithValues[0].value : 0;

    return (
      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          style={[styles.addPetBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#fefce8' }]}
          onPress={() => { setPetPickerMode('wishlist'); setShowPetPicker(true); }}
        >
          <Text style={[styles.addPetText, { color: '#F59E0B' }]}>{t('trade_journal.goals.add_dream')}</Text>
        </TouchableOpacity>

        {/* Trade visibility hint */}
        {wishlistPets.length > 0 && (
          <View style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 8,
            backgroundColor: isDarkMode ? '#1e3a5f40' : '#EFF6FF',
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 10,
            borderLeftWidth: 3,
            borderLeftColor: '#3B82F6',
          }}>
            <FontAwesome name="circle-info" size={13} color="#3B82F6" style={{ marginTop: 1 }} />
            <Text style={{ flex: 1, fontSize: 11, color: isDarkMode ? '#cbd5e1' : '#475569', lineHeight: 15 }}>
              {t('trade_journal.goals.trade_visibility_hint', { defaultValue: 'Tap ✅ Trading / 🔒 Private on each pet to control visibility. Only pets marked Trading show on your profile so others know you\'re looking for them.' })}
            </Text>
          </View>
        )}

        {wishlistPets.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={{ fontSize: 40 }}>✨</Text>
            <Text style={[styles.emptyTitle, { color: textColor }]}>{t('trade_journal.goals.empty_title')}</Text>
            <Text style={[styles.emptySub, { color: subtextColor }]}>
              {t('trade_journal.goals.empty_sub')}
            </Text>
          </View>
        ) : (
          wishlistPets.map((pet, index) => {
            const petVal = lookupPetValue(pet);

            // ── Correct progress: based on your BEST single pet vs dream pet ──
            // In Adopt Me, trades are typically 1-for-1 or small combos,
            // so the best indicator is your best pet's value vs the target
            const progress = petVal > 0 && bestOwnedValue > 0
              ? Math.min(1, bestOwnedValue / petVal) : 0;
            const canAfford = petVal > 0 && bestOwnedValue >= petVal;

            // ── Find your best trade option(s) ──
            const closestPet = ownedWithValues.find(
              op => op.value >= petVal * 0.7 && op.value <= petVal * 2.5
            );
            // If no single pet is close, find best combo (up to 3 pets)
            let comboOffer = [];
            let comboValue = 0;
            if (!closestPet && petVal > 0) {
              for (const op of ownedWithValues) {
                if (comboValue >= petVal) break;
                comboOffer.push(op);
                comboValue += op.value;
                if (comboOffer.length >= 3) break;
              }
            }

            // ── Demand & difficulty (factors in BOTH demand AND value) ──
            // A cheap pet should never show as "Hard" just because demand is high
            const demand = getDemandScore(pet.name, analyticsMaps.demandMap);
            const demandScore = demand?.score || 0;
            // Value tiers: cheap < 50, mid < 200, expensive >= 200
            const isCheap = petVal > 0 && petVal < 50;
            const isMid = petVal >= 50 && petVal < 200;
            let difficulty;
            if (isCheap) {
              // Cheap pets are always Easy or at most Medium
              difficulty = demandScore >= 8
                ? { label: t('trade_journal.goals.diff_medium'), color: '#3B82F6', bg: '#DBEAFE', emoji: '🎯' }
                : { label: t('trade_journal.goals.diff_easy'), color: '#10B981', bg: '#D1FAE5', emoji: '✅' };
            } else if (isMid) {
              // Mid-value: cap at Hard
              difficulty = demandScore >= 8
                ? { label: t('trade_journal.goals.diff_hard'), color: '#F59E0B', bg: '#FEF3C7', emoji: '⚡' }
                : demandScore >= 5
                  ? { label: t('trade_journal.goals.diff_medium'), color: '#3B82F6', bg: '#DBEAFE', emoji: '🎯' }
                  : { label: t('trade_journal.goals.diff_easy'), color: '#10B981', bg: '#D1FAE5', emoji: '✅' };
            } else {
              // Expensive pets: full difficulty scale
              difficulty = demandScore >= 8
                ? { label: t('trade_journal.goals.diff_very_hard'), color: '#EF4444', bg: '#FEE2E2', emoji: '🔥' }
                : demandScore >= 6
                  ? { label: t('trade_journal.goals.diff_hard'), color: '#F59E0B', bg: '#FEF3C7', emoji: '⚡' }
                  : demandScore >= 3
                    ? { label: t('trade_journal.goals.diff_medium'), color: '#3B82F6', bg: '#DBEAFE', emoji: '🎯' }
                    : { label: t('trade_journal.goals.diff_easy'), color: '#10B981', bg: '#D1FAE5', emoji: '✅' };
            }

            // ── Kid-friendly tip based on situation ──
            let tip = null;
            if (canAfford && closestPet) {
              tip = { emoji: '🎉', text: t('trade_journal.goals.tip_trade_for', { name: closestPet.name }), color: '#10B981' };
            } else if (closestPet && closestPet.value >= petVal * 0.7 && closestPet.value < petVal) {
              const gap = petVal - closestPet.value;
              tip = { emoji: '🤏', text: t('trade_journal.goals.tip_close', { name: closestPet.name, gap: formatValue(gap) }), color: '#3B82F6' };
            } else if (comboOffer.length > 1 && comboValue >= petVal) {
              tip = { emoji: '🧩', text: t('trade_journal.goals.tip_combo', { combo: comboOffer.map(o => o.name).join(' + ') }), color: '#8B5CF6' };
            } else if (ownedPets.length === 0) {
              tip = { emoji: '🎒', text: t('trade_journal.goals.tip_add_first'), color: '#F59E0B' };
            } else if (petVal > 0 && bestOwnedValue > 0 && bestOwnedValue < petVal * 0.3) {
              tip = { emoji: '📈', text: t('trade_journal.goals.tip_keep_trading'), color: '#F59E0B' };
            } else if (petVal > 0 && bestOwnedValue >= petVal * 0.3) {
              tip = { emoji: '💪', text: t('trade_journal.goals.tip_getting_closer'), color: '#3B82F6' };
            }

            // ── Demand label for display ──
            const hot = getHotStatus(pet.name, analyticsMaps.hotMap);
            const demandLabel = demandScore >= 7
              ? { text: t('trade_journal.goals.demand_high'), color: '#EF4444' }
              : demandScore >= 4
                ? { text: t('trade_journal.goals.demand_mid'), color: '#F59E0B' }
                : hot?.isHot
                  ? { text: `📈 +${hot.pct}%`, color: '#10B981' }
                  : demandScore > 0
                    ? { text: t('trade_journal.goals.demand_low'), color: '#94a3b8' }
                    : null;

            return (
              <View key={`wish-${pet.name}-${index}`}
                style={{
                  backgroundColor: cardBg,
                  borderRadius: 14,
                  padding: 12,
                  marginBottom: 8,
                  borderLeftWidth: 3,
                  borderLeftColor: difficulty.color,
                }}
              >
                {/* Row: Image + Info + Delete */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  {/* Compact pet image */}
                  <Image
                    source={{ uri: getImgUrl(pet.imageUrl || pet.image) }}
                    style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: isDarkMode ? '#0f172a' : '#f1f5f9' }}
                    resizeMode="contain"
                  />

                  {/* Name + pills row */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: textColor }} numberOfLines={1}>{pet.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                      {petVal > 0 && (
                        <View style={{ backgroundColor: isDarkMode ? '#1e3a5f' : '#EFF6FF', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                          <Text style={{ fontSize: 9, fontWeight: '700', color: '#3B82F6' }}>🏷️ {formatPlain(petVal)}</Text>
                        </View>
                      )}
                      <View style={{ backgroundColor: difficulty.bg, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ fontSize: 9, fontWeight: '700', color: difficulty.color }}>{difficulty.emoji} {difficulty.label}</Text>
                      </View>
                      {demandLabel && (
                        <View style={{ backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                          <Text style={{ fontSize: 9, fontWeight: '600', color: demandLabel.color }}>{demandLabel.text}</Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Toggle available for trade */}
                  <TouchableOpacity
                    onPress={() => toggleAvailableForTrade(index, 'wishlist')}
                    style={{
                      marginRight: 4,
                      backgroundColor: pet.availableForTrade
                        ? (isDarkMode ? '#10B98120' : '#D1FAE5')
                        : (isDarkMode ? '#F59E0B20' : '#FEF3C7'),
                      borderRadius: 6,
                      borderWidth: 1,
                      borderColor: pet.availableForTrade ? '#10B981' : '#F59E0B',
                      paddingHorizontal: 8,
                      paddingVertical: 4,
                    }}
                  >
                    <Text style={{
                      fontSize: 10,
                      fontWeight: '800',
                      color: pet.availableForTrade ? '#10B981' : '#D97706',
                    }}>
                      {pet.availableForTrade ? '✅ Trading' : '🔒 Private'}
                    </Text>
                  </TouchableOpacity>
                  {/* Delete */}
                  <TouchableOpacity onPress={() => removeWishlistPet(index)} style={{ padding: 4 }}>
                    <FontAwesome name="xmark" size={12} color="#cbd5e1" />
                  </TouchableOpacity>
                </View>

                {/* Thin progress bar — no labels, just visual */}
                {petVal > 0 && ownedPets.length > 0 && (
                  <View style={{ marginTop: 8, borderRadius: 3, height: 4, backgroundColor: isDarkMode ? '#0f172a' : '#e2e8f0', overflow: 'hidden' }}>
                    <View style={{
                      width: `${Math.max(3, Math.round(progress * 100))}%`,
                      height: 4,
                      borderRadius: 3,
                      backgroundColor: canAfford ? '#10B981' : progress >= 0.7 ? '#3B82F6' : '#94a3b8',
                    }} />
                  </View>
                )}

                {/* Compact tip — single line */}
                {tip && (
                  <Text style={{ fontSize: 10, color: tip.color, fontWeight: '600', marginTop: 6 }}>
                    {tip.emoji} {tip.text}
                  </Text>
                )}
              </View>
            );
          })
        )}

        {wishlistPets.length > 0 && (
          <TouchableOpacity style={styles.clearHistoryBtn} onPress={clearWishlistPets}>
            <Text style={styles.clearHistoryText}>
              {t('trade_journal.goals.clear_wishlist', { defaultValue: '🗑 Clear wishlist' })}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    );
  };

  if (!visible) return null;

  return (
    <>
      <View style={[styles.container, { backgroundColor: bg }]}>
        {/* Tabs — pill style */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[styles.tabScroll, { borderBottomColor: isDarkMode ? '#1e293b' : '#f0f0f0' }]}
          contentContainerStyle={styles.tabBar}
        >
          {TABS.map(tabItem => {
            const isActive = tab === tabItem.key;
            const color = TAB_COLORS[tabItem.key] || '#3B82F6';
            return (
              <TouchableOpacity
                key={tabItem.key}
                style={[styles.tabPill, isActive && { backgroundColor: color + '20' }]}
                onPress={() => setTab(tabItem.key)}
                activeOpacity={0.8}
              >
                <FontAwesome name={tabItem.icon} size={11}
                  color={isActive ? color : subtextColor}
                  solid={isActive}
                />
                <Text style={[
                  styles.tabPillText,
                  { color: subtextColor },
                  isActive && { color, fontWeight: '800' },
                ]}>
                  {t(tabItem.label)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Content */}
        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color="#3B82F6" />
          </View>
        ) : (
          <>
            {tab === 'pets' && renderMyPets()}
            {tab === 'goals' && renderGoals()}
          </>
        )}

        {/* Sticky Banner Ad (outside tab content) — pad bottom for system nav */}
        {!localState?.isPro && (
          <View style={{ paddingBottom: insets.bottom }}>
            <BannerAdComponent />
          </View>
        )}
      </View>

      {/* Own profile viewer */}
      <ProfileBottomDrawer
        isVisible={showMyProfile}
        toggleModal={() => setShowMyProfile(false)}
        startChat={null}
        selectedUser={{
          senderId: user?.id,
          sender: user?.displayName || t('trade_journal.my_pets.you', { defaultValue: 'You' }),
          avatar: user?.avatar || null,
        }}
        isOnline={true}
        bannedUsers={[]}
      />

      {/* Pet Picker Modal */}
      <PetModal
        fromSetting={true}
        visible={showPetPicker}
        owned={petPickerMode === 'owned'}
        ownedPets={ownedPets}
        setOwnedPets={setOwnedPets}
        wishlistPets={wishlistPets}
        setWishlistPets={setWishlistPets}
        onClose={() => setShowPetPicker(false)}
      />
    </>
  );
};

// ══════════════════════════════════════
// STYLES
// ══════════════════════════════════════
const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  title: { fontSize: 22, fontWeight: '800' },
  tabScroll: { flexGrow: 0, flexShrink: 0, borderBottomWidth: 1 },
  tabBar: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 8, gap: 4, alignItems: 'center' },
  tabPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 7, paddingHorizontal: 14, borderRadius: 20, gap: 6,
  },
  tabPillText: { fontSize: 11, fontWeight: '700' },
  listContent: { padding: 16, paddingBottom: 100 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  // Hero
  heroCard: { borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 12 },
  heroLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  heroValue: { fontSize: 36, fontWeight: '900', letterSpacing: -1 },
  heroSub: { fontSize: 12, marginTop: 4 },
  heroSubRow: { flexDirection: 'row', marginTop: 14 },
  heroSubItem: { flex: 1, alignItems: 'center' },
  heroSubDivider: { width: 1, marginVertical: 2 },
  heroSubLabel: { fontSize: 10, fontWeight: '600', marginBottom: 2 },
  heroSubVal: { fontSize: 16, fontWeight: '800' },
  // Add pet
  addPetBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 12, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)', borderStyle: 'dashed',
  },
  addPetText: { fontSize: 14, fontWeight: '600' },
  // Pets grid
  petsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  petCard: {
    width: PET_CARD_SIZE, alignItems: 'center', padding: 10, borderRadius: 12,
  },
  petImage: { width: 44, height: 44, borderRadius: 8, marginBottom: 4 },
  petRemoveBtn: {
    position: 'absolute', top: 2, right: 2, zIndex: 1,
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(239,68,68,0.85)', alignItems: 'center', justifyContent: 'center',
  },
  petRemoveText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  petName: { fontSize: 10, fontWeight: '600', textAlign: 'center' },
  petValue: { fontSize: 9, fontWeight: '500', marginTop: 1 },
  tradeBadge: { position: 'absolute', top: 4, left: 4 },
  tradeBadgeText: { fontSize: 10 },
  // Goals
  goalCard: { borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  goalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  goalImage: { width: 40, height: 40, borderRadius: 8 },
  goalName: { fontSize: 14, fontWeight: '700' },
  goalValue: { fontSize: 11 },
  affordBadge: { backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  affordText: { color: '#10B981', fontSize: 11, fontWeight: '700' },
  goalDeleteBtn: { padding: 6, marginLeft: 4 },
  progressBg: { height: 8, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },
  progressText: { fontSize: 11, marginTop: 4 },
  // Stats dashboard (History header)
  statsCard: { borderRadius: 14, padding: 14, marginBottom: 10 },
  statsCardTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  barChartWrap: { flexDirection: 'row', height: 28, borderRadius: 8, overflow: 'hidden', gap: 2 },
  barSegment: { alignItems: 'center', justifyContent: 'center', minWidth: 24 },
  barSegmentText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  barLegend: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: '500' },
  statsGridRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statsGridItem: { flex: 1, alignItems: 'center', padding: 12, borderRadius: 12 },
  statsGridValue: { fontSize: 18, fontWeight: '800', marginTop: 4 },
  statsGridLabel: { fontSize: 10, fontWeight: '500', marginTop: 2 },
  // Date on trade card
  tlDate: { fontSize: 10, fontWeight: '600', marginBottom: 4 },
  // Clear history
  clearHistoryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8, marginTop: 4,
  },
  clearHistoryText: { fontSize: 12, fontWeight: '600', color: '#EF4444' },
  // Per-item delete inside card
  cardDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4,
    paddingTop: 4, marginTop: 4,
  },
  cardDeleteText: { fontSize: 11, fontWeight: '600', color: '#EF4444' },
  // Load more
  loadMoreBtn: {
    alignItems: 'center', paddingVertical: 12, borderRadius: 12, marginTop: 8,
  },
  loadMoreText: { fontSize: 13, fontWeight: '700' },
  // Active trade card
  activeCard: { borderRadius: 14, padding: 14, marginBottom: 12 },
  completionOptions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  completeAsIsBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10,
  },
  completeAsIsText: { fontSize: 12, fontWeight: '700' },
  editItemsBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)',
  },
  editItemsText: { fontSize: 12, fontWeight: '600' },
  editHint: { fontSize: 10, textAlign: 'center', marginTop: 8, fontStyle: 'italic' },
  rateTitle: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  addItemBubble: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: 'rgba(0,0,0,0.1)', borderStyle: 'dashed',
    justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.5)',
  },
  // Rating
  ratingRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  ratingPill: {
    flex: 1, alignItems: 'center', gap: 2, paddingVertical: 6, borderRadius: 8, borderWidth: 1.5,
  },
  ratingLabel: { fontSize: 10, fontWeight: '600' },
  completeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: '#3B82F6', paddingVertical: 8, borderRadius: 8, marginTop: 10,
  },
  completeBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  cancelBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  confirmBtn: { flex: 2, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  confirmBtnText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  // Stats
  statsGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: { flex: 1, alignItems: 'center', padding: 14, borderRadius: 12 },
  statNumber: { fontSize: 20, fontWeight: '800', marginTop: 4 },
  statLabel: { fontSize: 10, fontWeight: '600', marginTop: 2 },
  breakdownCard: { borderRadius: 12, padding: 14 },
  breakdownTitle: { fontSize: 13, fontWeight: '700', marginBottom: 10 },
  breakdownBar: { flexDirection: 'row', height: 10, borderRadius: 6, overflow: 'hidden', marginBottom: 10 },
  barSeg: { height: '100%' },
  legendRow: { flexDirection: 'row', justifyContent: 'space-around' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontWeight: '600' },
  // Timeline styles
  tlCard: {
    flexDirection: 'row', marginBottom: 4, paddingBottom: 4,
  },
  tlDotWrap: { width: 24, alignItems: 'center', paddingTop: 14 },
  tlDot: { width: 10, height: 10, borderRadius: 5, zIndex: 1 },
  tlLine: {
    width: 2, flex: 1, backgroundColor: 'rgba(148,163,184,0.2)', marginTop: 2,
  },
  tlContent: {
    flex: 1, borderRadius: 14, padding: 14, marginLeft: 6,
  },
  tlBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  tlResultBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  tlResultText: { fontSize: 12, fontWeight: '700' },
  tlNetBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  tlNetText: { fontSize: 11, fontWeight: '700' },
  tlTradeVisual: { flexDirection: 'row', alignItems: 'center' },
  tlSide: { flex: 1 },
  tlSideLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 0.8, marginBottom: 4 },
  tlPetBubbles: { flexDirection: 'row', alignItems: 'center' },
  tlPetImg: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)',
    backgroundColor: '#f1f5f9',
  },
  tlPetMore: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#334155', justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)',
  },
  tlPetMoreText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  tlValText: { fontSize: 11, fontWeight: '700', marginTop: 4 },
  tlArrowWrap: { width: 30, alignItems: 'center' },
  tlNoItems: { fontSize: 16 },
  // Empty
  emptyWrap: { alignItems: 'center', paddingTop: 50 },
  emptyTitle: { fontSize: 16, fontWeight: '700', marginTop: 8 },
  emptySub: { fontSize: 13, marginTop: 4, textAlign: 'center', paddingHorizontal: 40 },
  // Bottom
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    padding: 16, paddingBottom: 34, borderTopWidth: 1,
  },
  logNewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#3B82F6', paddingVertical: 14, borderRadius: 12,
  },
  logNewBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});

export default React.memo(TradeJournal);
