/**
 * TradeJournal.js — Pet Portfolio Hub
 * 
 * 4-tab hub:
 * 🎒 My Pets — owned pets grid, add new, total value
 * ⭐ Goals  — wishlist with progress bars + goal tracking
 * 📈 Timeline — trade history feed (modern card UI)
 * 📊 Stats  — trade stats dashboard
 * 
 * Auto-updates inventory on trade completion.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, Image,
  StyleSheet, Dimensions, ActivityIndicator, Alert, ScrollView, TextInput,
} from 'react-native';
import { useNavigation, useIsFocused, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, query, where, orderBy, limit, getDocs, startAfter,
  doc, updateDoc, getDoc, setDoc, deleteDoc, serverTimestamp as fsServerTimestamp,
} from '@react-native-firebase/firestore';
import { ref, get, set, push, remove, serverTimestamp, query as rtdbQuery, orderByChild, limitToLast, endBefore } from '@react-native-firebase/database';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import { addXP, XP_ACTIONS } from '../Engagement/xpUtils';
import PetModal from '../ChatScreen/PrivateChat/PetsModel';
import { useLocalState } from '../LocalGlobelStats';
import { fetchAnalyticsData, getDemandScore, getHotStatus } from '../Helper/analyticsDataHelper';
import { getThemeColors } from '../Helper/themeColors';
import { fetchSavedTradeRefs, unsaveTrade, pingTrader, fetchTradeAcceptors, removeAllTradeAcceptors } from '../Trades/tradeHelpers';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';
import { useGlobalState } from '../GlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { showSuccessMessage, showErrorMessage } from '../Helper/MessageHelper';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import BannerAdComponent from '../Ads/bannerAds';
dayjs.extend(relativeTime);

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PET_CARD_SIZE = (SCREEN_WIDTH - 64) / 3;

const RESULT_META = {
  win:  { emoji: '🏆', label: 'trade_journal.results.i_won',  color: '#10B981' },
  fair: { emoji: '🤝', label: 'trade_journal.results.even', color: '#F59E0B' },
  loss: { emoji: '📉', label: 'trade_journal.results.i_lost', color: '#EF4444' },
};

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
  active: '#10B981',
  timeline: '#8B5CF6',
};

const TABS = [
  { key: 'pets', icon: 'bag-shopping', label: 'trade_journal.tabs.my_pets' },
  { key: 'goals', icon: 'star', label: 'trade_journal.tabs.goals' },
  { key: 'active', icon: 'bolt', label: 'trade_journal.tabs.active_trade' },
  { key: 'timeline', icon: 'clock-rotate-left', label: 'trade_journal.tabs.done_trades' },
];

const TradeJournal = ({
  firestoreDB, db, uid, isDarkMode,
}) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const visible = useIsFocused();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState(route.params?.initialTab || 'pets');
  const { localState, updateLocalState } = useLocalState();
  const [ownedPets, setOwnedPets] = useState(localState.ownedPets || []);
  const [wishlistPets, setWishlistPets] = useState(localState.wishlistPets || []);
  const [activeTrades, setActiveTrades] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Server-side pagination cursors
  const activeLastDocRef = useRef(null);
  const [hasMoreActive, setHasMoreActive] = useState(true);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const PAGE_SIZE = 5;
  const [completing, setCompleting] = useState(null);
  const [selectedRating, setSelectedRating] = useState('fair');
  const [showPetPicker, setShowPetPicker] = useState(false);
  const [petPickerMode, setPetPickerMode] = useState('owned');
  const [petSearch, setPetSearch] = useState('');
  const [petSort, setPetSort] = useState('recent'); // 'recent' | 'value-desc' | 'value-asc' | 'name'
  const [showMyProfile, setShowMyProfile] = useState(false);
  // Editable trade completion
  const [editingTrade, setEditingTrade] = useState(null);
  const [editGave, setEditGave] = useState([]);
  const [editGot, setEditGot] = useState([]);
  const [editPickerSide, setEditPickerSide] = useState(null); // 'gave' | 'got'
  const preEditSnapshotRef = useRef([]); // snapshot of ownedPets before opening picker in edit mode
  const { user } = useGlobalState();
  const [savedTrades, setSavedTrades] = useState([]);
  const [savedDrawerTrade, setSavedDrawerTrade] = useState(null);
  const [savedDrawerVisible, setSavedDrawerVisible] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState('mine'); // 'mine' | 'saved'
  const highlightTradeId = route.params?.highlightTradeId || null;
  const highlightHandledRef = useRef(false);

  // When arriving from a notification with highlightTradeId, fetch that trade + all other data
  useEffect(() => {
    if (!highlightTradeId || !firestoreDB) return;
    highlightHandledRef.current = false;
    setTab('active');
    setActiveSubTab('mine');
    setHasMoreActive(false);
    setLoading(true);
    (async () => {
      try {
        const [snap] = await Promise.all([
          getDoc(doc(firestoreDB, 'trades_new', highlightTradeId)),
          // Also load pets, stats, history so they aren't stuck at 0/empty
          fetchPets(),
          fetchHistory(),
          fetchTradeStats(),
          fetchSavedTrades(),
          fetchAnalyticsData().then(setAnalyticsMaps).catch(() => {}),
        ]);
        if (snap.exists()) {
          const trade = { id: snap.id, ...snap.data() };
          setActiveTrades([trade]);
          // Fetch acceptor count + open acceptor list for this trade
          fetchAcceptorCounts([trade]);
          openAcceptorList(highlightTradeId);
        }
      } catch (e) {
        console.warn('[TradeJournal] fetch highlighted trade error:', e?.message);
      } finally {
        setLoading(false);
        highlightHandledRef.current = true;
        navigation.setParams({ highlightTradeId: undefined, initialTab: undefined });
      }
    })();
  }, [highlightTradeId, firestoreDB]);

  // Sync tab when navigating from notification without highlightTradeId
  useEffect(() => {
    const paramTab = route.params?.initialTab;
    if (paramTab && !highlightTradeId && TABS.some(t => t.key === paramTab)) {
      setTab(paramTab);
      navigation.setParams({ initialTab: undefined });
    }
  }, [route.params?.initialTab]);
  const [acceptorCounts, setAcceptorCounts] = useState({}); // { tradeId: count }
  const [acceptorListTradeId, setAcceptorListTradeId] = useState(null); // trade ID for acceptors modal
  const [acceptorList, setAcceptorList] = useState([]); // array of acceptor objects for modal
  const [acceptorListLoading, setAcceptorListLoading] = useState(false);

  // Refs to avoid stale closures in PetModal onClose
  const ownedPetsRef = useRef(ownedPets);
  const wishlistPetsRef = useRef(wishlistPets);
  const editPickerSideRef = useRef(editPickerSide);
  useEffect(() => { ownedPetsRef.current = ownedPets; }, [ownedPets]);
  useEffect(() => { wishlistPetsRef.current = wishlistPets; }, [wishlistPets]);
  useEffect(() => { editPickerSideRef.current = editPickerSide; }, [editPickerSide]);

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

  // ── Fetch active trades (paginated — 5 at a time) ──
  const fetchActiveTrades = useCallback(async (loadMore = false) => {
    if (!firestoreDB || !uid) return;
    try {
      let q;
      if (loadMore && activeLastDocRef.current) {
        q = query(
          collection(firestoreDB, 'trades_new'),
          where('userId', '==', uid),
          orderBy('timestamp', 'desc'),
          startAfter(activeLastDocRef.current),
          limit(PAGE_SIZE),
        );
      } else {
        q = query(
          collection(firestoreDB, 'trades_new'),
          where('userId', '==', uid),
          orderBy('timestamp', 'desc'),
          limit(PAGE_SIZE),
        );
      }
      const snap = await getDocs(q);
      const newTrades = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => !t.completed);
      if (snap.docs.length > 0) {
        activeLastDocRef.current = snap.docs[snap.docs.length - 1];
      }
      setHasMoreActive(snap.docs.length >= PAGE_SIZE);
      if (loadMore) {
        setActiveTrades(prev => [...prev, ...newTrades]);
      } else {
        setActiveTrades(newTrades);
      }
    } catch (err) {
      console.warn('[MyStuff] fetch trades error:', err?.message);
    }
  }, [firestoreDB, uid]);

  // ✅ Fetch accepted/saved trades (RTDB refs → Firestore trade docs)
  const fetchSavedTrades = useCallback(async () => {
    if (!db || !uid || !firestoreDB) return;
    try {
      const refs = await fetchSavedTradeRefs(db, uid);
      if (!refs || Object.keys(refs).length === 0) {
        setSavedTrades([]);
        return;
      }
      // Batch-fetch trade docs from Firestore
      const entries = Object.entries(refs);
      const results = await Promise.all(
        entries.map(async ([tradeId, refData]) => {
          try {
            const snap = await getDoc(doc(firestoreDB, 'trades_new', tradeId));
            if (snap.exists()) {
              return { id: tradeId, ...snap.data(), _savedRef: refData };
            } else {
              // Trade was deleted by poster
              return { id: tradeId, _deleted: true, _savedRef: refData };
            }
          } catch {
            return { id: tradeId, _deleted: true, _savedRef: refData };
          }
        })
      );
      setSavedTrades(results);
    } catch (e) {
      console.warn('[MyStuff] fetch saved trades error:', e?.message);
    }
  }, [db, uid, firestoreDB]);

  // ── Fetch acceptor counts for all active trades ──
  const fetchAcceptorCounts = useCallback(async (trades) => {
    if (!db || !trades || trades.length === 0) return;
    const counts = {};
    await Promise.all(
      trades.map(async (trade) => {
        const acceptors = await fetchTradeAcceptors(db, trade.id);
        const count = Object.keys(acceptors).length;
        if (count > 0) counts[trade.id] = count;
      })
    );
    setAcceptorCounts(counts);
  }, [db]);

  // ── Open acceptors list modal ──
  const openAcceptorList = useCallback(async (tradeId) => {
    if (!db) return;
    setAcceptorListTradeId(tradeId);
    setAcceptorListLoading(true);
    const acceptors = await fetchTradeAcceptors(db, tradeId);
    const list = Object.entries(acceptors).map(([uid, data]) => ({
      uid,
      name: data.name || 'Unknown',
      robloxUsername: data.robloxUsername || '',
      avatar: data.avatar || '',
      acceptedAt: data.acceptedAt || 0,
    })).sort((a, b) => (b.acceptedAt || 0) - (a.acceptedAt || 0));
    setAcceptorList(list);
    setAcceptorListLoading(false);
  }, [db]);

  // ── Trade stats (lightweight separate node) ──
  const [tradeStats, setTradeStats] = useState(null);
  const fetchTradeStats = useCallback(async () => {
    if (!db || !uid) return;
    try {
      const snap = await get(ref(db, `tradeStats/${uid}`));
      if (snap.exists()) setTradeStats(snap.val());
      else setTradeStats(null);
    } catch (err) {
      console.warn('[MyStuff] fetch stats error:', err?.message);
    }
  }, [db, uid]);

  const updateTradeStats = useCallback(async (rating, gaveValue, gotValue, delta = 1) => {
    if (!db || !uid) return;
    try {
      const snap = await get(ref(db, `tradeStats/${uid}`));
      const current = snap.exists() ? snap.val() : { total: 0, wins: 0, fairs: 0, losses: 0, totalGave: 0, totalGot: 0 };
      const updated = {
        total: (current.total || 0) + delta,
        wins: (current.wins || 0) + (rating === 'win' ? delta : 0),
        fairs: (current.fairs || 0) + (rating === 'fair' ? delta : 0),
        losses: (current.losses || 0) + (rating === 'loss' ? delta : 0),
        totalGave: (current.totalGave || 0) + (gaveValue * delta),
        totalGot: (current.totalGot || 0) + (gotValue * delta),
      };
      await set(ref(db, `tradeStats/${uid}`), updated);
      setTradeStats(updated);
    } catch (err) {
      console.warn('[MyStuff] update stats error:', err?.message);
    }
  }, [db, uid]);

  // ── Fetch trade history (server-side paginated — 5 at a time) ──
  const historyLastTimestampRef = useRef(null);
  const fetchHistory = useCallback(async (loadMore = false) => {
    if (!db || !uid) return;
    try {
      let q;
      const histRef = ref(db, `tradeJournal/${uid}`);
      if (loadMore && historyLastTimestampRef.current !== null) {
        q = rtdbQuery(histRef, orderByChild('completedAt'), endBefore(historyLastTimestampRef.current), limitToLast(PAGE_SIZE));
      } else {
        q = rtdbQuery(histRef, orderByChild('completedAt'), limitToLast(PAGE_SIZE));
      }
      const snap = await get(q);
      if (!snap.exists()) {
        if (!loadMore) { setHistory([]); setHasMoreHistory(false); }
        else { setHasMoreHistory(false); }
        return;
      }
      const data = snap.val();
      const arr = Object.entries(data).map(([id, val]) => ({ id, ...val }));
      arr.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
      if (arr.length > 0) {
        historyLastTimestampRef.current = arr[arr.length - 1].completedAt || 0;
      }
      setHasMoreHistory(arr.length >= PAGE_SIZE);
      if (loadMore) {
        setHistory(prev => [...prev, ...arr]);
      } else {
        historyLastTimestampRef.current = arr.length > 0 ? arr[arr.length - 1].completedAt || 0 : null;
        setHistory(arr);
      }
    } catch (err) {
      console.warn('[MyStuff] fetch history error:', err?.message);
    }
  }, [db, uid]);

  // ── Clear trade history ──
  const clearHistory = useCallback(() => {
    Alert.alert(
      t('trade_journal.alerts.clear_history_title'),
      t('trade_journal.alerts.clear_history_msg'),
      [
        { text: t('trade_journal.alerts.cancel'), style: 'cancel' },
        {
          text: t('trade_journal.alerts.clear_all'), style: 'destructive',
          onPress: async () => {
            try {
              if (db && uid) await remove(ref(db, `tradeJournal/${uid}`));
              if (db && uid) await remove(ref(db, `tradeStats/${uid}`));
              setHistory([]);
              setTradeStats(null);
              historyLastTimestampRef.current = null;
              setHasMoreHistory(false);
              Alert.alert(t('trade_journal.alerts.done'), t('trade_journal.alerts.history_cleared'));
            } catch (err) {
              Alert.alert(t('trade_journal.alerts.error'), t('trade_journal.alerts.could_not_clear'));
            }
          },
        },
      ]
    );
  }, [db, uid, t]);

  // ── Delete single active trade ──
  const deleteActiveTrade = useCallback((item) => {
    Alert.alert(t('trade_journal.alerts.delete_trade_title'), t('trade_journal.alerts.delete_trade_msg'), [
      { text: t('trade_journal.alerts.cancel'), style: 'cancel' },
      {
        text: t('trade_journal.alerts.delete'), style: 'destructive',
        onPress: async () => {
          try {
            if (firestoreDB && item.id) await deleteDoc(doc(firestoreDB, 'trades_new', item.id));
            // Clean up acceptors for this deleted trade
            if (db && item.id) await removeAllTradeAcceptors(db, item.id);
            setActiveTrades(prev => prev.filter(t => t.id !== item.id));
            setAcceptorCounts(prev => { const next = { ...prev }; delete next[item.id]; return next; });
          } catch {
            Alert.alert(t('trade_journal.alerts.error'), t('trade_journal.alerts.could_not_delete'));
          }
        },
      },
    ]);
  }, [firestoreDB, db, t]);

  // ── Clear all active trades ──
  const clearActiveTrades = useCallback(() => {
    Alert.alert(
      t('trade_journal.alerts.delete_all_active_title'),
      t('trade_journal.alerts.delete_all_active_msg'),
      [
        { text: t('trade_journal.alerts.cancel'), style: 'cancel' },
        {
          text: t('trade_journal.alerts.delete_all'), style: 'destructive',
          onPress: async () => {
            try {
              await Promise.all(
                activeTrades.map(tData => deleteDoc(doc(firestoreDB, 'trades_new', tData.id)))
              );
              // Clean up acceptors for all deleted trades
              if (db) await Promise.all(activeTrades.map(tData => removeAllTradeAcceptors(db, tData.id)));
              setActiveTrades([]);
              setAcceptorCounts({});
              Alert.alert(t('trade_journal.alerts.done'), t('trade_journal.alerts.all_active_deleted'));
            } catch {
              Alert.alert(t('trade_journal.alerts.error'), t('trade_journal.alerts.could_not_delete'));
            }
          },
        },
      ]
    );
  }, [firestoreDB, db, activeTrades, t]);

  const initialLoadDoneRef = useRef(false);
  useEffect(() => {
    if (visible) {
      // Skip full fetch if we're handling a highlighted trade from notification
      if (highlightTradeId) return;
      // Only fetch pets/goals/stats once — they only change via user actions
      // which already update state directly. Re-fetch active trades & saved trades
      // on every focus since other users can accept/interact with them.
      if (!initialLoadDoneRef.current) {
        activeLastDocRef.current = null;
        setHasMoreActive(true);
        setHasMoreHistory(true);
        setLoading(true);
        Promise.all([fetchPets(), fetchActiveTrades(), fetchHistory(), fetchTradeStats(), fetchSavedTrades()])
          .finally(() => {
            setLoading(false);
            initialLoadDoneRef.current = true;
            setTimeout(() => { hasFetchedRef.current = true; }, 200);
          });
        fetchAnalyticsData().then(setAnalyticsMaps).catch(() => {});
      } else {
        // On re-focus, only refresh active trades & saved trades (other users may have accepted)
        activeLastDocRef.current = null;
        setHasMoreActive(true);
        Promise.all([fetchActiveTrades(), fetchSavedTrades()]);
      }
    }
  }, [visible, fetchPets, fetchActiveTrades, fetchHistory, fetchTradeStats, fetchSavedTrades]);

  // ── Fetch acceptor counts whenever active trades change ──
  useEffect(() => {
    if (activeTrades.length > 0) fetchAcceptorCounts(activeTrades);
  }, [activeTrades, fetchAcceptorCounts]);


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

  // ── Map raw trade items to clean objects ──
  const mapItems = useCallback((items) => (items || []).map(i => ({
    name: i.name || i.Name || 'Unknown',
    image: i.image || i.Image || i.imageUrl || null,
    value: Number(i.value) || 0,
    category: i.type || i.category || 'pets',
  })), []);

  // ── Start "Complete As Is" flow ──
  const startCompleteAsIs = useCallback((trade) => {
    setEditingTrade(trade);
    setEditGave(mapItems(trade.hasItems));
    setEditGot(mapItems(trade.wantsItems));
    setCompleting(trade.id);
    setSelectedRating('fair');
  }, [mapItems]);

  // ── Start "Edit Items" flow ──
  const startEditItems = useCallback((trade) => {
    setEditingTrade(trade);
    setEditGave(mapItems(trade.hasItems));
    setEditGot(mapItems(trade.wantsItems));
    setCompleting(trade.id + '_edit');
    setSelectedRating('fair');
  }, [mapItems]);

  // ── Remove item from editing list ──
  const removeEditItem = useCallback((side, index) => {
    if (side === 'gave') setEditGave(prev => prev.filter((_, i) => i !== index));
    else setEditGot(prev => prev.filter((_, i) => i !== index));
  }, []);

  // ── Complete a trade (uses editGave/editGot) ──
  const handleComplete = useCallback(async (trade, rating) => {
    if (!db || !uid || !firestoreDB) return;
    if (editGave.length === 0 || editGot.length === 0) {
      Alert.alert(t('trade_journal.alerts.add_items_title'), t('trade_journal.alerts.add_items_msg'));
      return;
    }
    setCompleting('saving');
    try {
      const gave = editGave;
      const got = editGot;

      await push(ref(db, `tradeJournal/${uid}`), {
        gave, got, result: rating,
        gaveValue: gave.reduce((s, p) => s + (p.value || 0), 0),
        gotValue: got.reduce((s, p) => s + (p.value || 0), 0),
        originalTradeId: trade.id,
        completedAt: serverTimestamp(),
      });

      // Update running stats
      const gv = gave.reduce((s, p) => s + (p.value || 0), 0);
      const gtv = got.reduce((s, p) => s + (p.value || 0), 0);
      await updateTradeStats(rating, gv, gtv, 1);

      // Only mark as completed if this is the user's OWN trade (not an accepted/saved trade from someone else)
      if (trade.userId === uid) {
        try {
          await updateDoc(doc(firestoreDB, 'trades_new', trade.id), {
            completed: true, completedAt: new Date().toISOString(), completionResult: rating,
          });
        } catch {}
        // Clean up all acceptors for this trade since it's now completed
        await removeAllTradeAcceptors(db, trade.id);
        setAcceptorCounts(prev => { const next = { ...prev }; delete next[trade.id]; return next; });
        if (acceptorListTradeId === trade.id) { setAcceptorListTradeId(null); setAcceptorList([]); }
      } else {
        // Accepted/saved trade from another user — remove from saved list after completing
        try {
          await remove(ref(db, `savedTrades/${uid}/${trade.id}`));
          setSavedTrades(prev => prev.filter(x => x.id !== trade.id));
        } catch {}
      }

      // Auto-update inventory
      let updatedOwned = [...ownedPets];
      let removedNames = [];
      let notOwnedNames = [];
      let addedNames = [];

      gave.forEach(g => {
        const gName = (g.name || '').toLowerCase();
        const gType = g.valueType || 'd';
        const gFly = !!g.isFly;
        const gRide = !!g.isRide;
        // Match exact variant: same name + valueType + fly + ride.
        // Falls back to name-only only when no variant exists, so a neon
        // trade can never silently remove a mega of the same pet.
        let idx = updatedOwned.findIndex(p =>
          (p.name || '').toLowerCase() === gName &&
          (p.valueType || 'd') === gType &&
          !!p.isFly === gFly &&
          !!p.isRide === gRide
        );
        if (idx === -1) {
          const sameName = updatedOwned.filter(p => (p.name || '').toLowerCase() === gName);
          if (sameName.length === 1) {
            idx = updatedOwned.indexOf(sameName[0]);
          }
        }
        if (idx !== -1) {
          updatedOwned.splice(idx, 1);
          removedNames.push(g.name);
        } else {
          notOwnedNames.push(g.name);
        }
      });
      got.forEach(g => {
        if (g.name) {
          updatedOwned.push({
            name: g.name, image: getImgUrl(g.image), imageUrl: getImgUrl(g.image),
            value: g.value, category: g.category,
            valueType: g.valueType || 'd', isFly: g.isFly || false, isRide: g.isRide || false,
            addedAt: new Date().toISOString(), addedVia: 'trade',
          });
          addedNames.push(g.name);
        }
      });
      setOwnedPets(updatedOwned);
      await savePets(updatedOwned, wishlistPets);

      addXP(db, uid, XP_ACTIONS.COMPLETE_TRADE);
      await Promise.all([fetchActiveTrades(), fetchHistory()]);
      setCompleting(null);
      setEditingTrade(null);
      setEditGave([]);
      setEditGot([]);

      // Warn about not-owned items
      if (notOwnedNames.length > 0) {
        Alert.alert(
          t('trade_journal.alerts.heads_up'),
          t(notOwnedNames.length > 1 ? 'trade_journal.alerts.not_owned_msg_pl' : 'trade_journal.alerts.not_owned_msg_sg', { names: notOwnedNames.join(', ') })
        );
      }

      // Success message
      let msg = `+${XP_ACTIONS.COMPLETE_TRADE} XP\n`;
      if (addedNames.length > 0) msg += `✅ ${t('trade_journal.alerts.added')} ${addedNames.join(', ')}\n`;
      if (removedNames.length > 0) msg += `🔄 ${t('trade_journal.alerts.removed')} ${removedNames.join(', ')}`;
      if (notOwnedNames.length > 0) msg += `\n⚠️ ${t('trade_journal.alerts.not_in_list')} ${notOwnedNames.join(', ')}`;
      Alert.alert(t('trade_journal.alerts.trade_saved'), msg.trim());
    } catch (err) {
      Alert.alert(t('trade_journal.alerts.error'), t('trade_journal.alerts.could_not_complete'));
      setCompleting(null);
    }
  }, [db, uid, firestoreDB, ownedPets, wishlistPets, savePets, fetchActiveTrades, fetchHistory, editGave, editGot, getImgUrl, updateTradeStats, t, acceptorListTradeId]);

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

  // Net value needs real-time calculation from loaded history
  const netValue = useMemo(() => {
    if (history.length === 0) return 0;
    let totalGave = 0, totalGot = 0;
    history.forEach(h => {
      let gaveSum = 0, gotSum = 0;
      (h.gave || []).forEach(p => { gaveSum += lookupPetValue(p); });
      (h.got || []).forEach(p => { gotSum += lookupPetValue(p); });
      totalGave += gaveSum || Number(h.gaveValue) || 0;
      totalGot += gotSum || Number(h.gotValue) || 0;
    });
    return totalGot - totalGave;
  }, [history, lookupPetValue]);

  // Merge stored stats with real-time net value
  const stats = useMemo(() => {
    if (!tradeStats) return null;
    const total = tradeStats.total || 0;
    return {
      total,
      wins: tradeStats.wins || 0,
      fairs: tradeStats.fairs || 0,
      losses: tradeStats.losses || 0,
      winRate: total > 0 ? Math.round(((tradeStats.wins || 0) / total) * 100) : 0,
      netValue,
    };
  }, [tradeStats, netValue]);

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

  // Trades I accepted from others (no need for "others accepted mine" — those already show in My Trades with acceptor badge)
  const iAcceptedTrades = useMemo(() =>
    savedTrades.filter(t => t._savedRef?.type === 'accepted').map(t => ({ ...t, _acceptType: 'i_accepted' })),
    [savedTrades]
  );
  const bookmarkedTrades = useMemo(() => savedTrades.filter(t => t._savedRef?.type === 'saved'), [savedTrades]);

  const renderActiveSubTabPills = () => (
    <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12, paddingHorizontal: 12, paddingTop: 4 }}>
      {[
        { key: 'mine', label: t('trade_journal.active.my_trades', { defaultValue: 'My Trades' }), icon: '📌', color: '#3B82F6', count: activeTrades.length },
        { key: 'accepted', label: t('trade_journal.active.accepted_tab', { defaultValue: 'Accepted' }), icon: '🤝', color: '#10B981', count: iAcceptedTrades.length },
        { key: 'saved', label: t('trade_journal.active.saved_tab', { defaultValue: 'Saved' }), icon: '🔖', color: '#F59E0B', count: bookmarkedTrades.length },
      ].map(pill => (
        <TouchableOpacity
          key={pill.key}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
            backgroundColor: activeSubTab === pill.key ? pill.color : (isDarkMode ? '#1e293b' : '#f1f5f9'),
          }}
          onPress={() => setActiveSubTab(pill.key)}
        >
          <Text style={{ fontSize: 12, fontWeight: '600', color: activeSubTab === pill.key ? '#fff' : subtextColor }}>
            {pill.icon} {pill.label}
          </Text>
          {pill.count > 0 && (
            <View style={{ backgroundColor: activeSubTab === pill.key ? 'rgba(255,255,255,0.25)' : pill.color + '20', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1 }}>
              <Text style={{ fontSize: 10, fontWeight: '700', color: activeSubTab === pill.key ? '#fff' : pill.color }}>{pill.count}</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );

  const renderActiveTrades = () => (
    <View style={{ flex: 1 }}>
      {renderActiveSubTabPills()}
      {activeSubTab === 'mine' ? (
        <FlatList
          data={activeTrades}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const hasImgs = (item.hasItems || []).filter(i => i);
            const wantsImgs = (item.wantsItems || []).filter(i => i);
            const hasVal = item.hasTotal || 0;
            const wantsVal = item.wantsTotal || 0;
            const isEditing = completing === item.id + '_edit';
            const isCompleting = completing === item.id || isEditing;

            const tradeDate = item.timestamp?.toDate
              ? dayjs(item.timestamp.toDate()).fromNow()
              : item.timestamp?.seconds
                ? dayjs(item.timestamp.seconds * 1000).fromNow()
                : null;

            return (
              <View style={[styles.activeCard, {
                backgroundColor: isDarkMode ? '#131a2e' : '#eff6ff',
                marginBottom: 10,
                borderWidth: 1, borderColor: isDarkMode ? '#3B82F630' : '#3B82F625', borderRadius: 14,
                shadowColor: '#3B82F6',
                shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDarkMode ? 0.3 : 0.08, shadowRadius: 6,
                elevation: 3,
              }]}>
                {/* Trade age */}
                {tradeDate && (
                  <Text style={{ fontSize: 11, color: subtextColor, marginBottom: 6 }}>
                    {tradeDate}
                  </Text>
                )}
                {/* Trade visual */}
                <View style={styles.tlTradeVisual}>
                  <View style={styles.tlSide}>
                    <Text style={[styles.tlSideLabel, { color: '#EF4444' }]}>{t('trade_journal.active.i_give')}</Text>
                    <View style={[styles.tlPetBubbles, { flexWrap: 'wrap', gap: 4 }]}>
                      {(isEditing ? editGave : hasImgs).map((pet, i) => (
                        <TouchableOpacity key={`h-${i}`}
                          onPress={isEditing ? () => removeEditItem('gave', i) : undefined}
                          activeOpacity={isEditing ? 0.5 : 1}
                        >
                          <Image
                            source={{ uri: getImgUrl(pet.image || pet.Image) }}
                            style={[styles.tlPetImg,
                              isEditing && { borderColor: '#EF4444' }]}
                            resizeMode="contain"
                          />
                        </TouchableOpacity>
                      ))}
                      {isEditing && (
                        <TouchableOpacity
                          style={[styles.addItemBubble, { marginLeft: editGave.length > 0 ? 0 : 0 }]}
                          onPress={() => {
                            preEditSnapshotRef.current = [...ownedPets];
                            setEditPickerSide('gave');
                            setPetPickerMode('owned');
                            setShowPetPicker(true);
                          }}
                        >
                          <FontAwesome name="plus" size={10} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                    {hasVal > 0 && !isEditing && <Text style={[styles.tlValText, { color: '#EF4444' }]}>{formatValue(hasVal)}</Text>}
                  </View>

                  <View style={styles.tlArrowWrap}>
                    <FontAwesome name="arrow-right-arrow-left" size={12} color={subtextColor} />
                  </View>

                  <View style={[styles.tlSide, { alignItems: 'flex-end' }]}>
                    <Text style={[styles.tlSideLabel, { color: '#10B981' }]}>{t('trade_journal.active.i_get')}</Text>
                    <View style={[styles.tlPetBubbles, { justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4 }]}>
                      {(isEditing ? editGot : wantsImgs).map((pet, i) => (
                        <TouchableOpacity key={`w-${i}`}
                          onPress={isEditing ? () => removeEditItem('got', i) : undefined}
                          activeOpacity={isEditing ? 0.5 : 1}
                        >
                          <Image
                            source={{ uri: getImgUrl(pet.image || pet.Image) }}
                            style={[styles.tlPetImg,
                              isEditing && { borderColor: '#10B981' }]}
                            resizeMode="contain"
                          />
                        </TouchableOpacity>
                      ))}
                      {isEditing && (
                        <TouchableOpacity
                          style={[styles.addItemBubble, { marginLeft: editGot.length > 0 ? 0 : 0 }]}
                          onPress={() => {
                            preEditSnapshotRef.current = [...ownedPets];
                            setEditPickerSide('got');
                            setPetPickerMode('owned');
                            setShowPetPicker(true);
                          }}
                        >
                          <FontAwesome name="plus" size={10} color="#10B981" />
                        </TouchableOpacity>
                      )}
                    </View>
                    {wantsVal > 0 && !isEditing && <Text style={[styles.tlValText, { color: '#10B981' }]}>{formatValue(wantsVal)}</Text>}
                  </View>
                </View>

                {isEditing && (
                  <Text style={[styles.editHint, { color: subtextColor }]}>
                    {t('trade_journal.active.edit_hint')}
                  </Text>
                )}

                {/* Acceptors badge — shows how many people accepted this trade */}
                {!isCompleting && (acceptorCounts[item.id] || 0) > 0 && (
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      marginTop: 8, paddingHorizontal: 10, paddingVertical: 7,
                      backgroundColor: '#10B98118', borderRadius: 10,
                      alignSelf: 'flex-start',
                    }}
                    onPress={() => openAcceptorList(item.id)}
                  >
                    <Text style={{ fontSize: 13 }}>🤝</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#10B981' }}>
                      {acceptorCounts[item.id]} {acceptorCounts[item.id] === 1 ? 'person' : 'people'} accepted
                    </Text>
                    <FontAwesome name="chevron-right" size={10} color="#10B981" />
                  </TouchableOpacity>
                )}

                {/* Completion flow */}
                {isCompleting ? (
                  <View style={{ marginTop: 10 }}>
                    <Text style={[styles.rateTitle, { color: textColor }]}>{t('trade_journal.active.how_did_it_go')}</Text>
                    <View style={styles.ratingRow}>
                      {Object.entries(RESULT_META).map(([key, meta]) => (
                        <TouchableOpacity key={key}
                          style={[styles.ratingPill, { borderColor: isDarkMode ? '#334155' : '#e2e8f0' },
                            selectedRating === key && { borderColor: meta.color, backgroundColor: meta.color + '18' }]}
                          onPress={() => setSelectedRating(key)}
                        >
                          <Text>{meta.emoji}</Text>
                          <Text style={[styles.ratingLabel, { color: textColor }]}>{t(meta.label)}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <TouchableOpacity style={styles.cancelBtn}
                        onPress={() => { setCompleting(null); setEditingTrade(null); }}
                      >
                        <Text style={{ color: subtextColor, fontWeight: '600', fontSize: 13 }}>{t('trade_journal.active.cancel')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.confirmBtn, { backgroundColor: RESULT_META[selectedRating].color }]}
                        onPress={() => handleComplete(item, selectedRating)}
                      >
                        <Text style={styles.confirmBtnText}>{t('trade_journal.active.save_trade')}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.completionOptions}>
                    <TouchableOpacity
                      style={[styles.completeAsIsBtn, { backgroundColor: isDarkMode ? '#164e63' : '#ecfdf5' }]}
                      onPress={() => startCompleteAsIs(item)}
                    >
                      <FontAwesome name="circle-check" size={13} color="#10B981" solid />
                      <Text style={[styles.completeAsIsText, { color: '#10B981' }]}>{t('trade_journal.active.done')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editItemsBtn, { backgroundColor: isDarkMode ? '#1e293b' : '#f8fafc' }]}
                      onPress={() => startEditItems(item)}
                    >
                      <FontAwesome name="pen-to-square" size={12} color={subtextColor} />
                      <Text style={[styles.editItemsText, { color: subtextColor }]}>{t('trade_journal.active.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
                {/* Delete button inside card */}
                {!isCompleting && (
                  <TouchableOpacity
                    style={styles.cardDeleteBtn}
                    onPress={() => deleteActiveTrade(item)}
                    activeOpacity={0.7}
                  >
                    <FontAwesome name="trash-can" size={11} color="#EF4444" />
                    <Text style={styles.cardDeleteText}>{t('trade_journal.active.delete')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
          ListHeaderComponent={
            <View>
              {activeTrades.length > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    onPress={() => Alert.alert(
                      t('trade_journal.alerts.active_trades_info_title'),
                      t('trade_journal.alerts.active_trades_info_msg')
                    )}
                  >
                    <FontAwesome name="circle-info" size={14} color="#3B82F6" />
                    <Text style={{ fontSize: 12, color: '#3B82F6', fontWeight: '600' }}>{t('trade_journal.active.how_it_works')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    onPress={clearActiveTrades}
                    activeOpacity={0.7}
                  >
                    <FontAwesome name="trash-can" size={12} color="#EF4444" />
                    <Text style={styles.clearHistoryText}>{t('trade_journal.active.delete_all')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={{ fontSize: 40 }}>⚡</Text>
              <Text style={[styles.emptyTitle, { color: textColor }]}>{t('trade_journal.active.empty_title')}</Text>
              <Text style={[styles.emptySub, { color: subtextColor, textAlign: 'center', lineHeight: 20 }]}>
                {t('trade_journal.active.empty_sub')}
              </Text>
            </View>
          }
          ListFooterComponent={
            hasMoreActive && activeTrades.length > 0 ? (
              <TouchableOpacity
                style={[styles.loadMoreBtn, { backgroundColor: cardBg }]}
                onPress={async () => {
                  setLoadingMore(true);
                  await fetchActiveTrades(true);
                  setLoadingMore(false);
                }}
                activeOpacity={0.7}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <ActivityIndicator size="small" color={textColor} />
                ) : (
                  <Text style={[styles.loadMoreText, { color: textColor }]}>{t('trade_journal.timeline.load_more')}</Text>
                )}
              </TouchableOpacity>
            ) : null
          }
        />
      ) : activeSubTab === 'accepted' ? (
        renderSavedTradesSection(iAcceptedTrades, 'accepted')
      ) : (
        renderSavedTradesSection(bookmarkedTrades, 'saved')
      )}
    </View>
  );

  // ✅ Accepted/Saved trades from other users
  const renderSavedTradesSection = (tradeList, sectionType = 'accepted') => {
    if (tradeList.length === 0) {
      const isAcceptedTab = sectionType === 'accepted';
      return (
        <View style={[styles.emptyWrap, { paddingHorizontal: 12 }]}>
          <Text style={{ fontSize: 40 }}>{isAcceptedTab ? '🤝' : '🔖'}</Text>
          <Text style={[styles.emptyTitle, { color: textColor }]}>
            {isAcceptedTab
              ? t('trade_journal.active.no_accepted', { defaultValue: 'No accepted trades' })
              : t('trade_journal.active.no_saved', { defaultValue: 'No saved trades' })}
          </Text>
          <Text style={[styles.emptySub, { color: subtextColor, textAlign: 'center', lineHeight: 20 }]}>
            {isAcceptedTab
              ? t('trade_journal.active.no_accepted_sub', { defaultValue: 'Accept trades from the feed to coordinate in-game trades.' })
              : t('trade_journal.active.no_saved_sub', { defaultValue: 'Bookmark trades from the feed to save them for later.' })}
          </Text>
        </View>
      );
    }
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={{ paddingHorizontal: 12 }}>
        {tradeList.map(item => {
          const savedRef = item._savedRef || {};
          const isAccepted = savedRef.type === 'accepted';
          const isDeleted = item._deleted;
          const isIAccepted = item._acceptType === 'i_accepted';

          // Card styling
          const cardBackground = isIAccepted
            ? (isDarkMode ? '#131a2e' : '#eff6ff') // subtle blue tint
            : cardBg;

          const cardBorder = isIAccepted
            ? (isDarkMode ? '#3B82F630' : '#3B82F625')
            : (isDarkMode ? '#334155' : '#e2e8f0');

          // Trade creation date
          const tradeDate = item.timestamp?.toDate
            ? dayjs(item.timestamp.toDate()).fromNow()
            : item.timestamp?.seconds
              ? dayjs(item.timestamp.seconds * 1000).fromNow()
              : null;

          // Acceptance date
          const acceptDate = savedRef.savedAt
            ? dayjs(savedRef.savedAt).fromNow()
            : null;

          return (
            <View key={`${item._acceptType || 'saved'}_${item.id}`} style={[styles.activeCard, {
              backgroundColor: cardBackground, marginBottom: 10, opacity: isDeleted ? 0.5 : 1,
              borderWidth: 1, borderColor: cardBorder, borderRadius: 14,
              shadowColor: isIAccepted ? '#3B82F6' : '#000',
              shadowOffset: { width: 0, height: 2 }, shadowOpacity: isDarkMode ? 0.3 : 0.08, shadowRadius: 6,
              elevation: 3,
            }]}>
              {isDeleted ? (
                <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                  <Text style={{ fontSize: 24 }}>🚫</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#EF4444', marginTop: 4 }}>
                    {t('trade_journal.active.deleted_by_trader', { defaultValue: 'Trade deleted by trader' })}
                  </Text>
                  <TouchableOpacity
                    style={{ marginTop: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#EF444418', borderRadius: 8 }}
                    onPress={async () => {
                      await unsaveTrade(db, uid, item.id);
                      setSavedTrades(prev => prev.filter(x => x.id !== item.id));
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#EF4444' }}>
                      {t('trade_journal.active.remove', { defaultValue: 'Remove' })}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  {/* Badge + Date row */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                      <View style={{
                        backgroundColor: isIAccepted ? '#3B82F618' : '#3B82F618',
                        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8,
                        flexDirection: 'row', alignItems: 'center', gap: 4,
                      }}>
                        <Text style={{ fontSize: 10 }}>{isAccepted ? '🤝' : '🔖'}</Text>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: '#3B82F6' }}>
                          {isAccepted
                            ? t('trade.i_accepted', { defaultValue: 'You accepted' })
                            : t('trade.saved', { defaultValue: 'Saved' })}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 11, fontWeight: '600', color: subtextColor, flexShrink: 1 }} numberOfLines={1}>
                        {`${t('trade_journal.active.from', { defaultValue: 'from' })} ${savedRef.traderName || item.traderName || 'Unknown'}`}
                      </Text>
                    </View>
                    {tradeDate && (
                      <Text style={{ fontSize: 10, color: subtextColor, marginLeft: 6 }}>
                        {tradeDate}
                      </Text>
                    )}
                  </View>

                  {/* Accepted date */}
                  {acceptDate && isIAccepted && (
                    <Text style={{ fontSize: 10, color: subtextColor, marginBottom: 4 }}>
                      {t('trade.accepted_time', { defaultValue: 'Accepted' })} {acceptDate}
                    </Text>
                  )}

                  {/* Trade visual */}
                  <View style={styles.tlTradeVisual}>
                    <View style={styles.tlSide}>
                      <Text style={[styles.tlSideLabel, { color: '#EF4444' }]}>{t('trade_journal.active.i_give')}</Text>
                      <View style={[styles.tlPetBubbles, { flexWrap: 'wrap', gap: 4 }]}>
                        {(item.hasItems || []).filter(i => i).map((pet, idx) => (
                          <Image key={`h-${idx}`}
                            source={{ uri: getImgUrl(pet.image || pet.Image) }}
                            style={styles.tlPetImg}
                            resizeMode="contain"
                          />
                        ))}
                      </View>
                      {item.hasTotal > 0 && <Text style={[styles.tlValText, { color: '#EF4444' }]}>{formatValue(item.hasTotal)}</Text>}
                    </View>
                    <View style={styles.tlArrowWrap}>
                      <FontAwesome name="arrow-right-arrow-left" size={12} color={subtextColor} />
                    </View>
                    <View style={[styles.tlSide, { alignItems: 'flex-end' }]}>
                      <Text style={[styles.tlSideLabel, { color: '#10B981' }]}>{t('trade_journal.active.i_get')}</Text>
                      <View style={[styles.tlPetBubbles, { justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4 }]}>
                        {(item.wantsItems || []).filter(i => i).map((pet, idx) => (
                          <Image key={`w-${idx}`}
                            source={{ uri: getImgUrl(pet.image || pet.Image) }}
                            style={styles.tlPetImg}
                            resizeMode="contain"
                          />
                        ))}
                      </View>
                      {item.wantsTotal > 0 && <Text style={[styles.tlValText, { color: '#10B981' }]}>{formatValue(item.wantsTotal)}</Text>}
                    </View>
                  </View>

                  {/* Roblox username - copyable */}
                  {(savedRef.traderRobloxUsername || item.robloxUsername) && (
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: isDarkMode ? '#1e3a5f' : '#EFF6FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start' }}
                      onPress={() => {
                        Clipboard.setString(savedRef.traderRobloxUsername || item.robloxUsername);
                        showSuccessMessage('📋', t('trade.roblox_copied', { defaultValue: 'Roblox username copied!' }));
                      }}
                    >
                      <FontAwesome name="gamepad" size={12} color="#3B82F6" solid />
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#3B82F6' }}>
                        {savedRef.traderRobloxUsername || item.robloxUsername}
                      </Text>
                      <FontAwesome name="copy" size={10} color="#3B82F680" />
                    </TouchableOpacity>
                  )}

                  {/* Action buttons */}
                  {(() => {
                      const isEditing = completing === item.id + '_edit';
                      const isCompleting = completing === item.id || isEditing;

                      if (isCompleting) {
                        return (
                          <View style={{ marginTop: 8 }}>
                            {/* Editable pet rows when in edit mode */}
                            {isEditing && (
                              <View style={styles.tlTradeVisual}>
                                <View style={styles.tlSide}>
                                  <Text style={[styles.tlSideLabel, { color: '#EF4444' }]}>{t('trade_journal.active.i_give')}</Text>
                                  <View style={[styles.tlPetBubbles, { flexWrap: 'wrap', gap: 4 }]}>
                                    {editGave.map((pet, idx) => (
                                      <TouchableOpacity key={`eg-${idx}`} onPress={() => removeEditItem('gave', idx)}>
                                        <Image source={{ uri: getImgUrl(pet.image || pet.Image) }} style={[styles.tlPetImg, { opacity: 0.8 }]} resizeMode="contain" />
                                      </TouchableOpacity>
                                    ))}
                                    <TouchableOpacity
                                      style={styles.addPetBtn}
                                      onPress={() => {
                                        preEditSnapshotRef.current = [...ownedPets];
                                        setEditPickerSide('gave');
                                        setPetPickerMode('owned');
                                        setShowPetPicker(true);
                                      }}
                                    >
                                      <FontAwesome name="plus" size={10} color="#EF4444" />
                                    </TouchableOpacity>
                                  </View>
                                </View>
                                <View style={styles.tlArrowWrap}>
                                  <FontAwesome name="arrow-right-arrow-left" size={12} color={subtextColor} />
                                </View>
                                <View style={[styles.tlSide, { alignItems: 'flex-end' }]}>
                                  <Text style={[styles.tlSideLabel, { color: '#10B981' }]}>{t('trade_journal.active.i_get')}</Text>
                                  <View style={[styles.tlPetBubbles, { justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4 }]}>
                                    {editGot.map((pet, idx) => (
                                      <TouchableOpacity key={`egt-${idx}`} onPress={() => removeEditItem('got', idx)}>
                                        <Image source={{ uri: getImgUrl(pet.image || pet.Image) }} style={[styles.tlPetImg, { opacity: 0.8 }]} resizeMode="contain" />
                                      </TouchableOpacity>
                                    ))}
                                    <TouchableOpacity
                                      style={styles.addPetBtn}
                                      onPress={() => {
                                        preEditSnapshotRef.current = [...ownedPets];
                                        setEditPickerSide('got');
                                        setPetPickerMode('owned');
                                        setShowPetPicker(true);
                                      }}
                                    >
                                      <FontAwesome name="plus" size={10} color="#10B981" />
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              </View>
                            )}

                            {/* Rating selector */}
                            <View style={styles.ratingRow}>
                              {Object.entries(RESULT_META).map(([key, meta]) => (
                                <TouchableOpacity
                                  key={key}
                                  style={[styles.ratingPill, selectedRating === key && { backgroundColor: meta.color + '22', borderColor: meta.color }]}
                                  onPress={() => setSelectedRating(key)}
                                >
                                  <Text style={{ fontSize: 16 }}>{meta.emoji}</Text>
                                  <Text style={[styles.ratingLabel, { color: textColor }]}>{t(meta.label)}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>

                            {/* Save / Cancel */}
                            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                              <TouchableOpacity style={styles.cancelBtn}
                                onPress={() => { setCompleting(null); setEditingTrade(null); }}
                              >
                                <Text style={{ color: subtextColor, fontWeight: '600', fontSize: 13 }}>{t('trade_journal.active.cancel')}</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[styles.confirmBtn, { backgroundColor: RESULT_META[selectedRating].color }]}
                                onPress={() => handleComplete(item, selectedRating)}
                              >
                                <Text style={styles.confirmBtnText}>{t('trade_journal.active.save_trade')}</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      }

                      // Normal action buttons
                      return (
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          {/* Chat with trader — opens profile drawer */}
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#6366F118', borderRadius: 8 }}
                            onPress={() => {
                              setSavedDrawerTrade(item);
                              setSavedDrawerVisible(true);
                            }}
                          >
                            <FontAwesome name="comment-dots" size={11} color="#6366F1" solid />
                            <Text style={{ fontSize: 11, fontWeight: '600', color: '#6366F1' }}>
                              {t('chat.start_chat', { defaultValue: 'Chat' })}
                            </Text>
                          </TouchableOpacity>

                          {/* Ping trader */}
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#3B82F618', borderRadius: 8 }}
                            onPress={async () => {
                              try {
                                await pingTrader(db, firestoreDB, uid, user?.displayName || 'Someone', { ...item, traderId: savedRef.traderId || item.userId });
                                showSuccessMessage('📢', t('trade.ping_sent', { defaultValue: 'Ping sent! Trader will be notified.' }));
                              } catch (e) {
                                showErrorMessage(t('home.alert.error'), e?.message || 'Error');
                              }
                            }}
                          >
                            <FontAwesome name="bell" size={11} color="#3B82F6" solid />
                            <Text style={{ fontSize: 11, fontWeight: '600', color: '#3B82F6' }}>
                              {t('trade.ping_trader', { defaultValue: 'Ping Trader' })}
                            </Text>
                          </TouchableOpacity>

                          {/* Complete as-is */}
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#10B98118', borderRadius: 8 }}
                            onPress={() => startCompleteAsIs(item)}
                          >
                            <FontAwesome name="circle-check" size={11} color="#10B981" solid />
                            <Text style={{ fontSize: 11, fontWeight: '600', color: '#10B981' }}>
                              {t('trade_journal.active.done')}
                            </Text>
                          </TouchableOpacity>

                          {/* Edit before completing */}
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#F59E0B18', borderRadius: 8 }}
                            onPress={() => startEditItems(item)}
                          >
                            <FontAwesome name="pen-to-square" size={11} color="#F59E0B" />
                            <Text style={{ fontSize: 11, fontWeight: '600', color: '#F59E0B' }}>
                              {t('trade_journal.active.edit')}
                            </Text>
                          </TouchableOpacity>

                          {/* Remove */}
                          <TouchableOpacity
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#EF444418', borderRadius: 8 }}
                            onPress={async () => {
                              await unsaveTrade(db, uid, item.id);
                              setSavedTrades(prev => prev.filter(x => x.id !== item.id));
                              showSuccessMessage(t('trade.removed', { defaultValue: 'Removed' }), '');
                            }}
                          >
                            <FontAwesome name="trash-can" size={11} color="#EF4444" />
                            <Text style={{ fontSize: 11, fontWeight: '600', color: '#EF4444' }}>
                              {t('trade_journal.active.remove', { defaultValue: 'Remove' })}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })()}
                </>
              )}
            </View>
          );
        })}

        </View>

        {/* Profile drawer for Chat */}
        {savedDrawerTrade && (
          <ProfileBottomDrawer
            isVisible={savedDrawerVisible && savedDrawerTrade?.id != null}
            toggleModal={() => { setSavedDrawerVisible(false); setSavedDrawerTrade(null); }}
            startChat={() => {
              const t = savedDrawerTrade;
              const sRef = t?._savedRef || {};
              setSavedDrawerVisible(false);
              setSavedDrawerTrade(null);
              navigation.navigate('PrivateChatRoot', {
                selectedUser: {
                  senderId: sRef.traderId || t.userId,
                  sender: sRef.traderName || t.traderName || 'Unknown',
                  avatar: t.avatar || null,
                  robloxUsername: sRef.traderRobloxUsername || t.robloxUsername || null,
                },
                item: t,
              });
            }}
            selectedUser={{
              senderId: savedDrawerTrade._savedRef?.traderId || savedDrawerTrade.userId,
              sender: savedDrawerTrade._savedRef?.traderName || savedDrawerTrade.traderName || 'Unknown',
              avatar: savedDrawerTrade.avatar || null,
              robloxUsername: savedDrawerTrade._savedRef?.traderRobloxUsername || savedDrawerTrade.robloxUsername || null,
            }}
            isOnline={false}
            bannedUsers={[]}
          />
        )}
      </ScrollView>
    );
  };
  // TAB 4: TIMELINE (Completed trades only)
  // ════════════════════════════════════════════════
  // ── Delete single history item ──
  const deleteHistoryItem = useCallback((item) => {
    Alert.alert('Delete this trade?', 'This will remove this trade record.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            if (db && uid && item.id) {
              await remove(ref(db, `tradeJournal/${uid}/${item.id}`));
            }
            setHistory(prev => prev.filter(h => h.id !== item.id));
            // Decrement stats
            const gv = (item.gave || []).reduce((s, p) => s + (Number(p.value) || 0), 0) || Number(item.gaveValue) || 0;
            const gtv = (item.got || []).reduce((s, p) => s + (Number(p.value) || 0), 0) || Number(item.gotValue) || 0;
            updateTradeStats(item.result, gv, gtv, -1);
          } catch {
            Alert.alert('Error', 'Could not delete trade.');
          }
        },
      },
    ]);
  }, [db, uid, updateTradeStats]);

  const renderTimelineItem = useCallback(({ item }) => {
    const meta = RESULT_META[item.result] || RESULT_META.fair;
    const gaveItems = item.gave || [];
    const gotItems = item.got || [];
    const gaveVal = item.gaveValue || gaveItems.reduce((s, p) => s + (Number(p.value) || 0), 0);
    const gotVal = item.gotValue || gotItems.reduce((s, p) => s + (Number(p.value) || 0), 0);
    const netVal = gotVal - gaveVal;

    // Format date
    let dateStr = '';
    if (item.completedAt) {
      try {
        const d = typeof item.completedAt === 'object' && item.completedAt.toDate
          ? item.completedAt.toDate()
          : new Date(typeof item.completedAt === 'number' ? item.completedAt : item.completedAt);
        if (!isNaN(d.getTime())) {
          const now = new Date();
          const diffMs = now - d;
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          if (diffDays === 0) dateStr = t('trade_journal.timeline.today');
          else if (diffDays === 1) dateStr = t('trade_journal.timeline.yesterday');
          else if (diffDays < 7) dateStr = t('trade_journal.timeline.days_ago', { count: diffDays });
          else dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
      } catch {}
    }

    return (
      <View style={[styles.tlCard, { backgroundColor: cardBg }]}>
        <View style={styles.tlDotWrap}>
          <View style={[styles.tlDot, { backgroundColor: meta.color }]} />
          <View style={styles.tlLine} />
        </View>
        <View style={styles.tlContent}>
          {/* Date */}
          {dateStr ? (
            <Text style={[styles.tlDate, { color: subtextColor }]}>{dateStr}</Text>
          ) : null}

          {/* Result badge + net value + scam */}
          <View style={styles.tlBadgeRow}>
            <View style={[styles.tlResultBadge, { backgroundColor: meta.color + '20' }]}>
              <Text style={[styles.tlResultText, { color: meta.color }]}>
                {meta.emoji} {meta.label}
              </Text>
            </View>
            {netVal !== 0 && (
              <View style={[styles.tlNetBadge, {
                backgroundColor: netVal >= 0 ? '#10B98115' : '#EF444415',
              }]}>
                <FontAwesome
                  name={netVal >= 0 ? 'arrow-trend-up' : 'arrow-trend-down'}
                  size={10}
                  color={netVal >= 0 ? '#10B981' : '#EF4444'}
                />
                <Text style={[styles.tlNetText, { color: netVal >= 0 ? '#10B981' : '#EF4444' }]}>
                  {netVal >= 0 ? '+' : ''}{formatValue(netVal)}
                </Text>
              </View>
            )}
            {item.didScam && (
              <View style={[styles.tlNetBadge, { backgroundColor: '#FEE2E2' }]}>
                <Text style={{ fontSize: 10, color: '#EF4444', fontWeight: '700' }}>⚠️ {t('trade_journal.timeline.scam')}</Text>
              </View>
            )}
          </View>

          {/* Pet images: Gave → Got */}
          <View style={styles.tlTradeVisual}>
            <View style={styles.tlSide}>
              <Text style={[styles.tlSideLabel, { color: '#EF4444' }]}>{t('trade_journal.timeline.i_gave')}</Text>
              <View style={[styles.tlPetBubbles, { flexWrap: 'wrap', gap: 4 }]}>
                {gaveItems.map((pet, i) => {
                  const demand = getDemandScore(pet.name, analyticsMaps.demandMap);
                  return (
                    <View key={`g-${i}`} style={{ alignItems: 'center' }}>
                      <Image
                        source={{ uri: getImgUrl(pet.image) }}
                        style={styles.tlPetImg}
                        resizeMode="contain"
                      />
                      {demand && demand.score >= 7 && (
                        <Text style={{ fontSize: 7, color: '#EF4444' }}>🔥{demand.label}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
              {gaveVal > 0 && <Text style={[styles.tlValText, { color: '#EF4444' }]}>{formatValue(gaveVal)}</Text>}
            </View>

            <View style={styles.tlArrowWrap}>
              <FontAwesome name="arrow-right" size={12} color={subtextColor} />
            </View>

            <View style={[styles.tlSide, { alignItems: 'flex-end' }]}>
              <Text style={[styles.tlSideLabel, { color: '#10B981' }]}>{t('trade_journal.timeline.i_got')}</Text>
              <View style={[styles.tlPetBubbles, { justifyContent: 'flex-end', flexWrap: 'wrap', gap: 4 }]}>
                {gotItems.map((pet, i) => {
                  const demand = getDemandScore(pet.name, analyticsMaps.demandMap);
                  return (
                    <View key={`r-${i}`} style={{ alignItems: 'center' }}>
                      <Image
                        source={{ uri: getImgUrl(pet.image) }}
                        style={styles.tlPetImg}
                        resizeMode="contain"
                      />
                      {demand && demand.score >= 7 && (
                        <Text style={{ fontSize: 7, color: '#10B981' }}>🔥{demand.label}</Text>
                      )}
                    </View>
                  );
                })}
              </View>
              {gotVal > 0 && <Text style={[styles.tlValText, { color: '#10B981' }]}>{formatValue(gotVal)}</Text>}
            </View>
          </View>
          {/* Demand-aware trade analysis */}
          {(() => {
            let maxGaveDemand = 0, maxGotDemand = 0, gaveName = '', gotName = '';
            gaveItems.forEach(p => { const d = getDemandScore(p.name, analyticsMaps.demandMap); if (d && d.score > maxGaveDemand) { maxGaveDemand = d.score; gaveName = p.name; } });
            gotItems.forEach(p => { const d = getDemandScore(p.name, analyticsMaps.demandMap); if (d && d.score > maxGotDemand) { maxGotDemand = d.score; gotName = p.name; } });
            if (maxGotDemand >= 7 && maxGaveDemand < maxGotDemand) return (
              <View style={{ backgroundColor: '#10B98110', borderRadius: 6, padding: 6, marginTop: 6 }}>
                <Text style={{ fontSize: 10, color: '#10B981' }}>{t('trade_journal.timeline.smart_trade', { got: gotName, gotD: maxGotDemand })}</Text>
              </View>
            );
            if (maxGaveDemand >= 7 && maxGotDemand < maxGaveDemand) return (
              <View style={{ backgroundColor: '#F59E0B10', borderRadius: 6, padding: 6, marginTop: 6 }}>
                <Text style={{ fontSize: 10, color: '#F59E0B' }}>{t('trade_journal.timeline.bad_trade', { gave: gaveName, gaveD: maxGaveDemand })}</Text>
              </View>
            );
            if (maxGaveDemand >= 7 && maxGotDemand >= 7) return (
              <View style={{ backgroundColor: '#3B82F610', borderRadius: 6, padding: 6, marginTop: 6 }}>
                <Text style={{ fontSize: 10, color: '#3B82F6' }}>{t('trade_journal.timeline.fair_swap')}</Text>
              </View>
            );
            return null;
          })()}
          {/* Delete button */}
          <TouchableOpacity
            style={styles.cardDeleteBtn}
            onPress={() => deleteHistoryItem(item)}
            activeOpacity={0.7}
          >
            <FontAwesome name="trash-can" size={11} color="#EF4444" />
            <Text style={styles.cardDeleteText}>{t('trade_journal.timeline.delete')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [isDarkMode, cardBg, textColor, subtextColor, getImgUrl, deleteHistoryItem]);

  const renderTimeline = () => (
    <FlatList
      data={history}
      keyExtractor={(item, i) => item.id || `t-${i}`}
      contentContainerStyle={styles.listContent}
      renderItem={(props) => (
        <View>
          {renderTimelineItem(props)}
        </View>
      )}
      ListFooterComponent={
        hasMoreHistory && history.length > 0 ? (
          <TouchableOpacity
            style={[styles.loadMoreBtn, { backgroundColor: cardBg }]}
            onPress={async () => {
              setLoadingMore(true);
              await fetchHistory(true);
              setLoadingMore(false);
            }}
            activeOpacity={0.7}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <ActivityIndicator size="small" color={textColor} />
            ) : (
              <Text style={[styles.loadMoreText, { color: textColor }]}>{t('trade_journal.timeline.load_more')}</Text>
            )}
          </TouchableOpacity>
        ) : null
      }
      ListHeaderComponent={stats ? (
        <View style={{ marginBottom: 12 }}>
          {/* ── Bar Chart: Win / Fair / Loss Distribution ── */}
          <View style={[styles.statsCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.statsCardTitle, { color: textColor }]}>{t('trade_journal.timeline.trade_results')}</Text>
            <View style={styles.barChartWrap}>
              {stats.wins > 0 && (
                <View style={[styles.barSegment, { flex: stats.wins, backgroundColor: '#10B981', borderTopLeftRadius: 8, borderBottomLeftRadius: 8, borderTopRightRadius: stats.fairs === 0 && stats.losses === 0 ? 8 : 0, borderBottomRightRadius: stats.fairs === 0 && stats.losses === 0 ? 8 : 0 }]}>
                  <Text style={styles.barSegmentText}>{stats.wins}</Text>
                </View>
              )}
              {stats.fairs > 0 && (
                <View style={[styles.barSegment, { flex: stats.fairs, backgroundColor: '#F59E0B', borderTopLeftRadius: stats.wins === 0 ? 8 : 0, borderBottomLeftRadius: stats.wins === 0 ? 8 : 0, borderTopRightRadius: stats.losses === 0 ? 8 : 0, borderBottomRightRadius: stats.losses === 0 ? 8 : 0 }]}>
                  <Text style={styles.barSegmentText}>{stats.fairs}</Text>
                </View>
              )}
              {stats.losses > 0 && (
                <View style={[styles.barSegment, { flex: stats.losses, backgroundColor: '#EF4444', borderTopRightRadius: 8, borderBottomRightRadius: 8, borderTopLeftRadius: stats.wins === 0 && stats.fairs === 0 ? 8 : 0, borderBottomLeftRadius: stats.wins === 0 && stats.fairs === 0 ? 8 : 0 }]}>
                  <Text style={styles.barSegmentText}>{stats.losses}</Text>
                </View>
              )}
            </View>
            <View style={styles.barLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                <Text style={[styles.legendText, { color: subtextColor }]}>{t('trade_journal.timeline.win')}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                <Text style={[styles.legendText, { color: subtextColor }]}>{t('trade_journal.timeline.fair')}</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
                <Text style={[styles.legendText, { color: subtextColor }]}>{t('trade_journal.timeline.loss')}</Text>
              </View>
            </View>
          </View>

          {/* ── Quick Stats Grid ── */}
          <View style={styles.statsGridRow}>
            <View style={[styles.statsGridItem, { backgroundColor: cardBg }]}>
              <Text style={{ fontSize: 20 }}>📦</Text>
              <Text style={[styles.statsGridValue, { color: textColor }]}>{stats.total}</Text>
              <Text style={[styles.statsGridLabel, { color: subtextColor }]}>{t('trade_journal.timeline.total_trades')}</Text>
            </View>
            <View style={[styles.statsGridItem, { backgroundColor: cardBg }]}>
              <Text style={{ fontSize: 20 }}>🏆</Text>
              <Text style={[styles.statsGridValue, { color: '#10B981' }]}>{stats.winRate}%</Text>
              <Text style={[styles.statsGridLabel, { color: subtextColor }]}>{t('trade_journal.timeline.win_rate')}</Text>
            </View>
            <View style={[styles.statsGridItem, { backgroundColor: cardBg }]}>
              <Text style={{ fontSize: 20 }}>{stats.netValue >= 0 ? '📈' : '📉'}</Text>
              <Text style={[styles.statsGridValue, { color: stats.netValue >= 0 ? '#10B981' : '#EF4444' }]}>
                {stats.netValue >= 0 ? '+' : ''}{formatValue(stats.netValue)}
              </Text>
              <Text style={[styles.statsGridLabel, { color: subtextColor }]}>{t('trade_journal.timeline.net_value')}</Text>
            </View>
          </View>

          {/* ── Demand Insight ── */}
          {(() => {
            let gotHighDemand = 0, gaveHighDemand = 0;
            history.forEach(h => {
              (h.got || []).forEach(p => { const d = getDemandScore(p.name, analyticsMaps.demandMap); if (d && d.score >= 7) gotHighDemand++; });
              (h.gave || []).forEach(p => { const d = getDemandScore(p.name, analyticsMaps.demandMap); if (d && d.score >= 7) gaveHighDemand++; });
            });
            if (gotHighDemand > gaveHighDemand && gotHighDemand >= 2) return (
              <View style={{ paddingHorizontal: 4, marginBottom: 8 }}>
                <View style={[styles.statsGridItem, { backgroundColor: cardBg }]}>
                  <Text style={{ fontSize: 12, color: '#10B981', fontWeight: '600', textAlign: 'center' }}>{t('trade_journal.timeline.smart_trader')}</Text>
                </View>
              </View>
            );
            if (gaveHighDemand > gotHighDemand && gaveHighDemand >= 2) return (
              <View style={{ paddingHorizontal: 4, marginBottom: 8 }}>
                <View style={[styles.statsGridItem, { backgroundColor: cardBg }]}>
                  <Text style={{ fontSize: 12, color: '#F59E0B', fontWeight: '600', textAlign: 'center' }}>{t('trade_journal.timeline.generous_trader')}</Text>
                </View>
              </View>
            );
            return null;
          })()}

          {/* ── Clear History ── */}
          <TouchableOpacity
            style={styles.clearHistoryBtn}
            onPress={clearHistory}
            activeOpacity={0.7}
          >
            <FontAwesome name="trash-can" size={12} color="#EF4444" />
            <Text style={styles.clearHistoryText}>{t('trade_journal.timeline.clear_history')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      ListEmptyComponent={
        <View style={styles.emptyWrap}>
          <Text style={{ fontSize: 40 }}>📈</Text>
          <Text style={[styles.emptyTitle, { color: textColor }]}>{t('trade_journal.timeline.empty_title')}</Text>
          <Text style={[styles.emptySub, { color: subtextColor }]}>
            {t('trade_journal.timeline.empty_sub')}
          </Text>
        </View>
      }
    />
  );

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
            {tab === 'active' && renderActiveTrades()}
            {tab === 'timeline' && renderTimeline()}
          </>
        )}

        {/* Sticky Banner Ad (outside tab content) — pad bottom for system nav */}
        {!localState?.isPro && (
          <View style={{ paddingBottom: insets.bottom }}>
            <BannerAdComponent />
          </View>
        )}
      </View>

      {/* Acceptors List — absolute overlay (avoids iOS nested Modal issues) */}
      {!!acceptorListTradeId && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => { setAcceptorListTradeId(null); setAcceptorList([]); }} />
          <View style={{
            backgroundColor: isDarkMode ? '#1e293b' : '#fff',
            borderTopLeftRadius: 20, borderTopRightRadius: 20,
            maxHeight: '60%', paddingBottom: Math.max(insets.bottom, 30),
          }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: isDarkMode ? '#334155' : '#e2e8f0' }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: textColor }}>
                {t('trade_journal.active.people_accepted', { defaultValue: 'People who accepted' })}
              </Text>
              <TouchableOpacity onPress={() => { setAcceptorListTradeId(null); setAcceptorList([]); }}>
                <FontAwesome name="xmark" size={18} color={subtextColor} />
              </TouchableOpacity>
            </View>
            {/* List */}
            {acceptorListLoading ? (
              <ActivityIndicator size="large" color="#3B82F6" style={{ marginTop: 30 }} />
            ) : acceptorList.length === 0 ? (
              <Text style={{ textAlign: 'center', color: subtextColor, marginTop: 30 }}>
                {t('trade_journal.active.no_acceptors', { defaultValue: 'No one has accepted yet' })}
              </Text>
            ) : (
              <FlatList
                data={acceptorList}
                keyExtractor={item => item.uid}
                renderItem={({ item: acceptor }) => (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
                    borderBottomWidth: 1, borderBottomColor: isDarkMode ? '#334155' : '#f1f5f9',
                  }}>
                    <Image
                      source={{ uri: acceptor.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                      style={{ width: 40, height: 40, borderRadius: 20, marginRight: 12, backgroundColor: '#e2e8f0' }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '600', color: textColor }}>{acceptor.name}</Text>
                      {acceptor.robloxUsername ? (
                        <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }} onPress={() => { Clipboard.setString(acceptor.robloxUsername); showSuccessMessage('Copied', acceptor.robloxUsername); }}>
                          <Text style={{ fontSize: 11, color: '#3B82F6' }}>🎮 {acceptor.robloxUsername}</Text>
                          <FontAwesome name="copy" size={9} color="#3B82F680" />
                        </TouchableOpacity>
                      ) : null}
                      {acceptor.acceptedAt ? (
                        <Text style={{ fontSize: 10, color: subtextColor, marginTop: 2 }}>
                          {dayjs(acceptor.acceptedAt).fromNow()}
                        </Text>
                      ) : null}
                    </View>
                    {/* Chat button */}
                    <TouchableOpacity
                      style={{ backgroundColor: '#3B82F618', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, marginLeft: 8 }}
                      onPress={() => {
                        setAcceptorListTradeId(null);
                        setAcceptorList([]);
                        navigation.navigate('PrivateChatRoot', {
                          selectedUser: {
                            senderId: acceptor.uid,
                            sender: acceptor.name,
                            avatar: acceptor.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                          },
                        });
                      }}
                    >
                      <FontAwesome name="comment" size={14} color="#3B82F6" />
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      )}

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
        onClose={() => {
          setShowPetPicker(false);
          // If editing a trade, capture newly added items (don't add to owned collection)
          setTimeout(() => {
            const side = editPickerSideRef.current;
            if (side && editingTrade) {
              const snapshot = preEditSnapshotRef.current;
              const current = ownedPetsRef.current;
              const newItems = current.slice(snapshot.length);
              if (newItems.length > 0) {
                const mapped = newItems.map(p => ({
                  name: p.name || p.Name || 'Unknown',
                  image: p.imageUrl || p.image || p.Image || '',
                  value: Number(p.value) || 0,
                }));
                if (side === 'gave') {
                  setEditGave(prev => [...prev, ...mapped]);
                } else {
                  setEditGot(prev => [...prev, ...mapped]);
                }
                setOwnedPets(snapshot); // restore — auto-save won't fire since it restores original
              }
              setEditPickerSide(null);
            }
            // Normal mode: auto-save useEffect handles it — no manual save needed
          }, 100);
        }}
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
