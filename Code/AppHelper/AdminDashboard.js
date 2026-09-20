// ✅ FIX ALL (AdminDashboard) — makes Reviews + Dates + Rating Summary ALWAYS correct
// WHAT THIS FIXES:
// 1) "Invalid Date" -> Firestore Timestamp / {_seconds} / {seconds} / number / string all supported
// 2) "No comment" -> uses real saved field: review (fallback comment/text)
// 3) Rating shows 0.0 (0 reviews) even when reviews exist ->
//    - tries Firestore summary user_ratings_summary/{userId}
//    - if missing OR count=0 -> computes rating+count directly from reviews as fallback
// 4) "5 star always" -> removes `|| 5` bug and parses rating as number safely
//
// Drop-in replace your AdminDashboard file with this one.

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Alert,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  Image,
  Modal,
  ScrollView,
  Keyboard,
  Clipboard,
  Switch,
} from 'react-native';

import {
  getDatabase,
  ref,
  get,
  set,
  query,
  orderByChild,
  orderByKey,
  equalTo,
  startAt,
  endAt,
  limitToFirst,
  limitToLast,
  onValue,
  update,
} from '@react-native-firebase/database';
import { warmProfileCache, getCachedProfile, getOrFetchProfile } from '../Helper/profileCache';

import {
  getFirestore,
  collection,
  getDocs,
  query as firestoreQuery,
  where,
  orderBy,
  limit,
  startAfter,
  doc,
  getDoc,
  deleteDoc,
  setDoc,
  addDoc,
  Timestamp,
  updateDoc,
} from '@react-native-firebase/firestore';

import { unbanUserWithEmail, banUserwithEmail, setUserStrike, muteUser, canStaffBanMute } from '../ChatScreen/utils';
import ModEvidencePicker from './ModEvidencePicker';
import EvidenceViewer from './EvidenceViewer';
import { uploadEvidence } from '../Helper/modEvidenceUpload';
import { adminListUserChats, adminDeleteChatPair } from '../Supabase/chatMetaBackend';
import { adminLoadPrivateMessages, adminDeletePrivateChat } from '../Supabase/privateMessagesBackend';
import { searchIdentityByName, searchIdentityByEmail, getRolesBatch, getRobloxBatch } from '../Supabase/userBackend';
import {
  fetchUserModHistory,
  fetchUserModCounts,
  fetchModLeaderboard,
  fetchRecentModActions,
} from '../Supabase/modLogBackend';
import { useGlobalState } from '../GlobelStats';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';
import { safeCompressImage } from '../Helper/safeCompressImage';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

const base64ToBytes = (base64) => {
  if (!base64 || typeof base64 !== 'string') throw new Error('Invalid base64 input');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/[\r\n]+/g, '');
  let output = [];
  let i = 0;
  while (i < str.length) {
    const enc1 = chars.indexOf(str.charAt(i++));
    const enc2 = chars.indexOf(str.charAt(i++));
    const enc3 = chars.indexOf(str.charAt(i++));
    const enc4 = chars.indexOf(str.charAt(i++));
    if (enc1 === -1 || enc2 === -1 || enc3 === -1 || enc4 === -1) throw new Error('Invalid base64 character');
    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;
    if (enc3 !== 64) output.push(chr1, chr2);
    else output.push(chr1);
    if (enc4 !== 64 && enc3 !== 64) output.push(chr3);
  }
  return Uint8Array.from(output);
};

const decodeEmail = (encoded) => (encoded ? encoded.replace(/\(dot\)/g, '.') : '');

// The ONE way this screen turns an email into an RTDB key.
//
// Writes go through encodeEmailForBan() in ChatScreen/utils.js, which
// lowercases and trims before encoding. Two readers here did not
// (`email.replace(/\./g,'(dot)')`), so for any user with a capital letter
// in their email the dashboard read a key that had never been written —
// which is why strike history and ban status came back empty for them
// while the user was very much banned. Same rule, one function.
const encodeEmailKey = (email) =>
  (email || '').toLowerCase().trim().replace(/\./g, '(dot)');

// Human labels for the audit log's action enum.
// ─────────────────────────────────────────────────────────────────────
// Design tokens
//
// This screen had 218 inline isDark-ternaries for colour, so
// every surface drifted a shade from its neighbours and nothing shared a
// spacing scale. One palette, two themes, referenced everywhere.
//
// Colour is treated as information, not decoration: neutrals carry the
// layout, and a hue only appears where it means something (a status, a
// destructive action). That is why status chips are tinted rather than
// filled — a list of solid red BANNED badges is hard to scan precisely
// because every row shouts equally loudly.
// ─────────────────────────────────────────────────────────────────────
const palette = {
  light: {
    bg: '#F2F2F7',
    surface: '#FFFFFF',
    surfaceAlt: '#F7F7FA',
    border: '#E4E4E9',
    borderStrong: '#D3D3DA',
    text: '#0B0B0F',
    textMuted: '#61616B',
    textFaint: '#9A9AA3',
    fieldBg: '#FFFFFF',
    overlay: 'rgba(0,0,0,0.45)',
  },
  dark: {
    bg: '#000000',
    surface: '#131316',
    surfaceAlt: '#1C1C21',
    border: '#2A2A31',
    borderStrong: '#3A3A43',
    text: '#FFFFFF',
    textMuted: '#9C9CA6',
    textFaint: '#63636D',
    fieldBg: '#1C1C21',
    overlay: 'rgba(0,0,0,0.65)',
  },
};

// Semantic hues — identical in both themes so a status always reads the
// same colour, with a low-alpha tint for chip backgrounds.
const HUE = {
  accent:  '#0A84FF',
  danger:  '#FF3B30',
  warn:    '#FF9500',
  warnMid: '#FF6B00',
  success: '#34C759',
  mute:    '#5856D6',
  gold:    '#FFC93C',
};
const tint = (hex, a = '1F') => `${hex}${a}`;

const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
const RADIUS = { sm: 8, md: 12, lg: 16, pill: 999 };

// `label` heads a single entry ("Muted · 10 min"); `noun` is the counting
// form used in tallies ("3 mutes"), because "3 muted" does not read.
const ACTION_META = {
  mute:   { label: 'Muted',    noun: 'mutes',   icon: 'volume-mute',      color: HUE.mute },
  strike: { label: 'Strike',   noun: 'strikes', icon: 'warning',          color: HUE.warn },
  ban:    { label: 'Banned',   noun: 'bans',    icon: 'ban',              color: HUE.danger },
  unban:  { label: 'Unbanned', noun: 'unbans',  icon: 'checkmark-circle', color: HUE.success },
};

const SOURCE_LABEL = {
  admin_dashboard: 'Dashboard',
  group_chat: 'Chat',
  report: 'Auto (reports)',
  auto: 'Auto',
  unknown: '—',
};

// The ACTUAL durations setUserStrike applies. These were previously
// advertised on the buttons as "3 hours / 3 days / Permanent", which
// matched nothing in the code — the real ladder is 12h / 24h / permanent.
// Kept next to each other so the label can never drift from the behaviour
// again without someone seeing both.
const STRIKE_TIERS = [
  { count: 1, label: 'Strike 1', duration: '12 hours',  color: HUE.warn },
  { count: 2, label: 'Strike 2', duration: '24 hours',  color: '#FF6B00' },
  { count: 3, label: 'Strike 3', duration: 'Permanent', color: HUE.danger },
];
const BAD_KEYS = new Set(['undefined', 'onloaduser', '', null, undefined]);
const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
const USER_CHATS_PAGE_SIZE = 20;

// ✅ Sanitize search query — strip chars invalid in Firebase RTDB queries
const sanitizeSearchQuery = (q) => q.replace(/[.#$\[\]\/\\]/g, '');

// ✅ Timestamp/date helpers (Fix "Invalid Date")
const toMillisSafe = (v) => {
  if (!v) return null;

  // Firestore Timestamp instance
  if (typeof v?.toMillis === 'function') return v.toMillis();

  // Firestore Timestamp-like plain object
  const seconds = v?.seconds ?? v?._seconds;
  const nanos = v?.nanoseconds ?? v?._nanoseconds ?? 0;
  if (typeof seconds === 'number') {
    return Math.round(seconds * 1000 + nanos / 1e6);
  }

  // millis number
  if (typeof v === 'number') return v;

  // string date
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }

  return null;
};

const formatDateSafe = (v) => {
  const ms = toMillisSafe(v);
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return '';
  }
};

const parseRatingSafe = (r) => {
  const n = typeof r === 'number' ? r : Number(r);
  if (Number.isNaN(n)) return 0;
  return n;
};

const getAvatarSafe = (obj) => obj?.avatar || DEFAULT_AVATAR;

const timeAgo = (v) => {
  const ms = toMillisSafe(v);
  if (!ms) return '';
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
};

const AdminDashboard = () => {
  const { theme, user: currentUser, isAdmin, modControlsEnabled } = useGlobalState();
  const isDark = theme === 'dark';
  const db = useMemo(() => getDatabase(), []);
  // Moderator status lives on the user object (GlobelStats context has no isModerator
  // export) — destructuring it from context left it undefined for every mod, which
  // disabled ban/mute/strike here even with mod controls switched ON.
  const isModerator = !!currentUser?.isModerator;
  const isBabyMod = !!currentUser?.isBabyMod;
  // Moderator ban/mute powers can be disabled by an admin. Admins are never blocked.
  const canBanMute = canStaffBanMute({ isAdmin, isModerator, isBabyMod, modControlsEnabled });
  const navigation = useNavigation();
  // targetSdk 36 means Android draws edge-to-edge and nothing is inset for
  // us. This screen handled insets nowhere, so the bottom of every list —
  // and, worst of all, the strike buttons in the user modal — sat behind
  // the system navigation bar.
  const insets = useSafeAreaInsets();
  // Active palette. `C` is used everywhere in place of the old inline
  // isDark ternaries.
  const C = isDark ? palette.dark : palette.light;

  // Tabs
  const [activeTab, setActiveTab] = useState('banned');

  // ── Status Feed (admin moderation) ──
  const STATUS_PAGE_SIZE = 10;
  const [statusList, setStatusList] = useState([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusLoadingMore, setStatusLoadingMore] = useState(false);
  const [statusHasMore, setStatusHasMore] = useState(true);
  const statusCursorRef = React.useRef(null);
  const [statusProfileUser, setStatusProfileUser] = useState(null);

  const fetchStatusFeed = useCallback(async (reset = false) => {
    try {
      const fdb = getFirestore();
      if (reset) {
        setStatusLoading(true);
        statusCursorRef.current = null;
        setStatusHasMore(true);
      } else {
        if (!statusHasMore || statusLoadingMore) return;
        setStatusLoadingMore(true);
      }

      let q = firestoreQuery(
        collection(fdb, 'statuses'),
        orderBy('createdAt', 'desc'),
        limit(STATUS_PAGE_SIZE),
      );
      if (!reset && statusCursorRef.current) {
        q = firestoreQuery(
          collection(fdb, 'statuses'),
          orderBy('createdAt', 'desc'),
          startAfter(statusCursorRef.current),
          limit(STATUS_PAGE_SIZE),
        );
      }

      const snap = await getDocs(q);
      const docs = snap.docs;
      const items = docs.map(d => ({ id: d.id, ...d.data() }));

      if (docs.length > 0) {
        statusCursorRef.current = docs[docs.length - 1];
      }
      if (docs.length < STATUS_PAGE_SIZE) setStatusHasMore(false);

      setStatusList(prev => {
        const merged = reset ? items : [...prev, ...items];
        const seen = new Set();
        return merged.filter(s => {
          if (!s.id || seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
      });
    } catch (err) {
      console.warn('[AdminDashboard] fetchStatusFeed error:', err?.message);
    } finally {
      setStatusLoading(false);
      setStatusLoadingMore(false);
    }
  }, [statusHasMore, statusLoadingMore]);

  const handleAdminDeleteStatus = useCallback((statusId) => {
    Alert.alert('Delete Status', 'Delete this status permanently?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const fdb = getFirestore();
            await deleteDoc(doc(fdb, 'statuses', statusId));
            setStatusList(prev => prev.filter(s => s.id !== statusId));
          } catch (err) {
            Alert.alert('Error', 'Failed to delete status.');
          }
        },
      },
    ]);
  }, []);

  useEffect(() => {
    if (activeTab === 'statusFeed' && statusList.length === 0) {
      fetchStatusFeed(true);
    }
  }, [activeTab]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Banned Data — bounded by default (recent 25), email-prefix search on demand.
  // Was: single `get(banned_users_by_email)` returning ~1MB of records the
  // client then filtered down to <200 active. Now: small ordered queries.
  const [allBannedUsers, setAllBannedUsers] = useState([]); // recent OR search results
  const [loadingBanned, setLoadingBanned] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [bannedSearchQuery, setBannedSearchQuery] = useState('');
  const [strikeFilter, setStrikeFilter] = useState('all'); // 'all' | '1' | '2' | '3+'
  const [isSearching, setIsSearching] = useState(false); // true while debounced search is in flight or active
  // Paging state for the restriction list. There are ~2,000 active bans;
  // the list used to stop at the first 25 with no way to see the rest.
  const [loadingMoreBans, setLoadingMoreBans] = useState(false);
  const [bansHasMore, setBansHasMore] = useState(true);
  const banCursorRef = React.useRef(null);

  // ─────────────────────────────────────────────
  // Helper: check if a string looks like a Firebase user ID (not a display name)
  const looksLikeUserId = (val) => {
    if (!val || typeof val !== 'string') return false;
    return val.length >= 15 && /^[a-zA-Z0-9]+$/.test(val);
  };

  // ─────────────────────────────────────────────
  // Builds the list/record-shape rows from a snapshot — shared by the
  // recent-bans and email-prefix-search paths so they render identically.
  const buildBanRowsFromSnapshot = useCallback(async (snapshot) => {
    if (!snapshot.exists()) return [];

    const list = [];
    const now = Date.now();
    const idsToResolve = new Set();

    snapshot.forEach((child) => {
      const encodedEmail = child.key;
      if (BAD_KEYS.has(encodedEmail)) return;
      const entry = child.val();
      const sc = entry?.strikeCount || 0;

      // Drop only entries that are no longer in force. The old guard
      // `if (sc < 1) return` was described as "skip expired mutes" but it
      // skips ALL mutes, expired or not — a mute never carries a strike.
      // So an admin could mute someone and then find them nowhere in the
      // dashboard. Expiry is what decides visibility, not strike count.
      const until = entry?.bannedUntil;
      const isActive = until === 'permanent' || (typeof until === 'number' && until > now);
      if (!isActive) return;

      const rawBannedBy = typeof entry?.bannedBy === 'string'
        ? entry.bannedBy
        : entry?.bannedBy?.displayName || 'Unknown';

      list.push({
        isBanned: true,
        email: decodeEmail(encodedEmail),
        encodedEmail,
        // Reason has been written as the boolean `true` by this screen's
        // own miswired ban call; only render an actual string.
        reason: typeof entry?.reason === 'string' && entry.reason.trim() ? entry.reason.trim() : '—',
        strikeCount: sc,
        bannedUntil: until ?? null,
        displayName: entry?.displayName || 'Unknown',
        avatar: getAvatarSafe(entry),
        bannedBy: rawBannedBy,
        // setUserStrike historically wrote `appliedAt` and no `bannedAt`,
        // so 1,999 of the 2,000 live bans carry only the former. Read both
        // or every one of them sorts as "no date".
        bannedAt: entry?.bannedAt ?? entry?.appliedAt ?? null,
        id: entry?.userId || null,
      });

      if (looksLikeUserId(rawBannedBy)) {
        idsToResolve.add(rawBannedBy);
      }
    });

    // Most-recent first
    list.sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));

    // Batch-resolve mod IDs → display names via profileCache
    if (idsToResolve.size > 0) {
      const ids = [...idsToResolve];
      await warmProfileCache(db, ids);
      list.forEach((item) => {
        if (looksLikeUserId(item.bannedBy)) {
          const cached = getCachedProfile(item.bannedBy);
          if (cached?.displayName) item.bannedByName = cached.displayName;
        }
      });
    }

    return list;
  }, [db]);

  // Fetch active restrictions, PAGED.
  //
  // WHY THIS CHANGED TWICE
  // The original query was orderByChild('bannedAt').limitToLast(25), and it
  // returned nothing an admin cared about. Measured on production:
  //
  //     2,695 records — 2,000 active, every one of them PERMANENT
  //     1,999 of those 2,000 had NO `bannedAt` field at all
  //
  // RTDB sorts records missing the ordering key FIRST, so limitToLast could
  // only ever reach the 695 expired mutes that did have it — which the
  // active-filter then dropped. The list showed 0 while 2,000 users were
  // banned. Cause: setUserStrike wrote `appliedAt`, never `bannedAt`
  // (fixed in ChatScreen/utils.js, and backfilled onto the existing rows by
  // scripts/backfill-ban-timestamps.js).
  //
  // With every record now carrying `bannedAt`, ONE ordered query reaches
  // all of them, and keyset pagination walks back through the full roster
  // 40 at a time. Each page stays bounded — this never becomes the
  // full-node download the screen used to do — but "Load more" now reaches
  // every banned user instead of stopping at an arbitrary 25.
  const BAN_PAGE_SIZE = 40;

  const fetchRecentBans = useCallback(async (reset = true) => {
    if (reset ? loadingBanned : (loadingMoreBans || !bansHasMore)) return;
    if (reset) { setLoadingBanned(true); banCursorRef.current = null; setBansHasMore(true); }
    else setLoadingMoreBans(true);

    try {
      // Page backwards through bannedAt: each page ends just before the
      // oldest row already loaded.
      const cursor = reset ? null : banCursorRef.current;
      const q = cursor == null
        ? query(ref(db, 'banned_users_by_email'), orderByChild('bannedAt'), limitToLast(BAN_PAGE_SIZE))
        : query(ref(db, 'banned_users_by_email'), orderByChild('bannedAt'), endAt(cursor - 1), limitToLast(BAN_PAGE_SIZE));

      const snapshot = await get(q);

      // Oldest bannedAt in this page becomes the next cursor. Taken from
      // the RAW snapshot, not the filtered rows — otherwise a page whose
      // records are all expired would leave the cursor unmoved and
      // "Load more" would fetch the same page forever.
      let oldest = null;
      let rawCount = 0;
      snapshot.forEach((child) => {
        rawCount++;
        const t = child.val()?.bannedAt;
        if (typeof t === 'number' && (oldest === null || t < oldest)) oldest = t;
      });

      const rows = await buildBanRowsFromSnapshot(snapshot);

      setAllBannedUsers((prev) => {
        const merged = reset ? rows : [...prev, ...rows];
        const seen = new Set();
        return merged
          .filter((r) => {
            if (!r.encodedEmail || seen.has(r.encodedEmail)) return false;
            seen.add(r.encodedEmail);
            return true;
          })
          .sort((a, b) => (b.bannedAt || 0) - (a.bannedAt || 0));
      });

      banCursorRef.current = oldest;
      // A short page means RTDB had nothing older left to give.
      setBansHasMore(rawCount >= BAN_PAGE_SIZE && oldest !== null);
    } catch (err) {
      console.error('Fetch bans error:', err);
    } finally {
      setLoadingBanned(false);
      setLoadingMoreBans(false);
      setRefreshing(false);
    }
  }, [db, loadingBanned, loadingMoreBans, bansHasMore, buildBanRowsFromSnapshot]);

  // Email-prefix search. RTDB keys are encoded emails (`name(dot)domain(dot)tld`),
  // so an orderByKey range query gives us a cheap prefix match on the email
  // itself. Capped at 50 results — typing more chars narrows further.
  const searchBansByEmail = useCallback(async (rawPrefix) => {
    const prefix = rawPrefix.trim().toLowerCase();
    if (!prefix) return;
    setLoadingBanned(true);
    try {
      const encoded = prefix.replace(/\./g, '(dot)');
      const q = query(
        ref(db, 'banned_users_by_email'),
        orderByKey(),
        startAt(encoded),
        endAt(encoded + ''),
        limitToFirst(50),
      );
      const snapshot = await get(q);
      const list = await buildBanRowsFromSnapshot(snapshot);
      setAllBannedUsers(list);
    } catch (err) {
      console.error('Search bans error:', err);
    } finally {
      setLoadingBanned(false);
      setRefreshing(false);
    }
  }, [db, buildBanRowsFromSnapshot]);

  // Load recent-25 on mount
  useEffect(() => {
    fetchRecentBans();
  }, []);

  // Debounced search — when the input has content, query by prefix; when
  // cleared, fall back to the recent-25 list. 300ms feels responsive
  // without firing a query on every keystroke.
  useEffect(() => {
    const trimmed = bannedSearchQuery.trim();
    if (!trimmed) {
      if (isSearching) {
        setIsSearching(false);
        fetchRecentBans();
      }
      return;
    }
    setIsSearching(true);
    const t = setTimeout(() => {
      searchBansByEmail(trimmed);
    }, 300);
    return () => clearTimeout(t);
  }, [bannedSearchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh whichever view is active (search results or recent-25). Used
  // by pull-to-refresh AND by the post-action callbacks (ban / unban /
  // strike / mute) — so the list reflects the write immediately.
  const refreshBannedList = useCallback(() => {
    const trimmed = bannedSearchQuery.trim();
    if (trimmed) {
      searchBansByEmail(trimmed);
    } else {
      fetchRecentBans();
    }
  }, [bannedSearchQuery, searchBansByEmail, fetchRecentBans]);

  const onRefresh = () => {
    setRefreshing(true);
    refreshBannedList();
  };

  // ─────────────────────────────────────────────
  // Strike filter is still client-side over the loaded slice (recent-25 OR
  // search-50). Search itself is now server-side, so no substring filter
  // here — `allBannedUsers` already reflects the query result.
  const filteredBannedUsers = useMemo(() => {
    if (strikeFilter === 'all') return allBannedUsers;
    // Mutes carry no strike, so they need their own bucket now that they
    // are no longer filtered out of the list entirely.
    if (strikeFilter === 'mute') return allBannedUsers.filter((u) => (u.strikeCount || 0) < 1);
    if (strikeFilter === '1') return allBannedUsers.filter((u) => u.strikeCount === 1);
    if (strikeFilter === '2') return allBannedUsers.filter((u) => u.strikeCount === 2);
    if (strikeFilter === '3+') return allBannedUsers.filter((u) => u.strikeCount >= 3);
    return allBannedUsers;
  }, [allBannedUsers, strikeFilter]);

  // Search Data (for the "Search DB" tab)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [userBanStatus, setUserBanStatus] = useState({});

  // Modal
  const [selectedUser, setSelectedUser] = useState(null);

  // User Details
  const [userDetails, setUserDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Reviews
  const [reviews, setReviews] = useState([]);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [hasMoreReviews, setHasMoreReviews] = useState(true);
  const [lastReviewKey, setLastReviewKey] = useState(null);

  // Moderation history for the open profile.
  // `currentSanction` is the live RTDB record (what is being enforced RIGHT
  // NOW); `modHistory` + `modCounts` come from the Supabase audit log (what
  // has EVER been done). These are different questions and the old screen
  // conflated them — it read the single live record and labelled it
  // "Strike History", so it could never show more than one entry, showed a
  // mute as if it were a strike, and went blank the moment someone was
  // unbanned.
  const [currentSanction, setCurrentSanction] = useState(null);
  const [modHistory, setModHistory] = useState([]);
  const [modCounts, setModCounts] = useState(null);
  const [modHistoryLoading, setModHistoryLoading] = useState(false);
  const [modHistoryCursor, setModHistoryCursor] = useState(null);
  const [modHistoryHasMore, setModHistoryHasMore] = useState(false);
  // Same distinction as the Mod Log tab: "no history" and "the audit table
  // isn't deployed" look identical on screen otherwise.
  const [modSchemaMissing, setModSchemaMissing] = useState(false);

  // Reason capture. Ban/strike/mute from this screen used to record no
  // reason at all (worse: the dashboard passed a boolean into the
  // customReason slot, so records were literally saved with reason `true`).
  // Every action now goes through this prompt.
  const [pendingAction, setPendingAction] = useState(null); // {type, value, user}

  // Screenshots the acting mod attaches to the pending sanction. LOCAL uris
  // until Confirm — ModEvidencePicker explains why upload is deferred.
  const [actionEvidence, setActionEvidence] = useState([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  // Evidence already recorded on an audit row, opened from a thumbnail.
  const [evidenceViewer, setEvidenceViewer] = useState(null); // {urls, index}
  const [actionReason, setActionReason] = useState('');

  // Mute
  const [customMuteMinutes, setCustomMuteMinutes] = useState('');

  // Chat Viewer
  const [chatPerson1, setChatPerson1] = useState(null);
  const [chatPerson2, setChatPerson2] = useState(null);
  const [chatSearch1, setChatSearch1] = useState('');
  const [chatSearch2, setChatSearch2] = useState('');
  const [chatResults1, setChatResults1] = useState([]);
  const [chatResults2, setChatResults2] = useState([]);
  const [chatSearching1, setChatSearching1] = useState(false);
  const [chatSearching2, setChatSearching2] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [loadingChat, setLoadingChat] = useState(false);
  // The viewer used to load one fixed page of 300 and stop, with nothing
  // on screen to say so — a long conversation was silently truncated to
  // its tail, which is exactly the part an admin has already seen.
  const [chatOlderLoading, setChatOlderLoading] = useState(false);
  const [chatHasOlder, setChatHasOlder] = useState(false);
  const [chatError, setChatError] = useState(null);
  const chatCursorRef = React.useRef(null);   // oldest Supabase row loaded
  const chatLegacyLoadedRef = React.useRef(false); // RTDB history is one shot
  const [previewImage, setPreviewImage] = useState(null);

  // User Chats (Super Admin) — view all private chats of a single user
  const [userChatsInput, setUserChatsInput] = useState('');
  const [userChatsTarget, setUserChatsTarget] = useState(null);
  const [userChatsList, setUserChatsList] = useState([]);
  const [userChatsLoading, setUserChatsLoading] = useState(false);
  const [userChatsLoadingMore, setUserChatsLoadingMore] = useState(false);
  const [userChatsHasMore, setUserChatsHasMore] = useState(true);
  const userChatsCursorRef = React.useRef(null);

  // Polls Management
  const [polls, setPolls] = useState([]);
  const [loadingPolls, setLoadingPolls] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollImageUrl, setPollImageUrl] = useState('');
  const [creatingPoll, setCreatingPoll] = useState(false);
  const [uploadingPollImage, setUploadingPollImage] = useState(false);

  // ── Mod Log tab ──
  // Staff accountability view: who did how much, and the raw feed of what
  // was done. Both are server-aggregated / server-filtered rpcs — nothing
  // here downloads rows in order to count or filter them on the device.
  const [modLogView, setModLogView] = useState('leaderboard'); // 'leaderboard' | 'feed'
  const [modLogDays, setModLogDays] = useState(30);            // 7 | 30 | 90
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [feedItems, setFeedItems] = useState([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedCursor, setFeedCursor] = useState(null);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedActionFilter, setFeedActionFilter] = useState(null); // null | 'mute' | 'strike' | 'ban' | 'unban'
  const [feedActorFilter, setFeedActorFilter] = useState(null);   // {uid, name} — set by tapping a leaderboard row
  // True when Supabase says the mod_actions table/rpcs do not exist, i.e.
  // supabase/029_mod_actions.sql has not been applied. Tracked separately
  // from "no results" because the two look identical on screen and an
  // admin has no way to tell them apart otherwise.
  const [modLogSchemaMissing, setModLogSchemaMissing] = useState(false);

  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const rows = await fetchModLeaderboard({ days: modLogDays, limit: 50 });
      setLeaderboard(rows);
      setModLogSchemaMissing(!!rows.schemaMissing);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [modLogDays]);

  const loadFeed = useCallback(async (reset = true) => {
    setFeedLoading(true);
    try {
      const page = await fetchRecentModActions({
        action: feedActionFilter,
        actorUid: feedActorFilter?.uid || null,
        days: modLogDays,
        cursor: reset ? null : feedCursor,
        limit: 30,
      });
      setFeedItems((prev) => (reset ? page.items : [...prev, ...page.items]));
      setFeedCursor(page.cursor);
      setFeedHasMore(page.hasMore);
      setModLogSchemaMissing(!!page.schemaMissing);
    } finally {
      setFeedLoading(false);
    }
  }, [feedActionFilter, feedActorFilter, modLogDays, feedCursor]);

  // Load on tab entry and whenever a filter changes. No realtime
  // subscription and no polling — staff pull this when they open it.
  useEffect(() => {
    if (activeTab !== 'modLog') return;
    if (modLogView === 'leaderboard') loadLeaderboard();
    else loadFeed(true);
  }, [activeTab, modLogView, modLogDays, feedActionFilter, feedActorFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // JMD Access (owner/admin only) — delegate the "Make Junior Mod" power.
  // Source of truth is RTDB /jmd_granters/{uid}; every device live-subscribes to
  // its own leaf in GlobelStats, so grants and revokes take effect immediately.
  const [jmdGranters, setJmdGranters] = useState([]);
  const [jmdGrantersLoading, setJmdGrantersLoading] = useState(false);
  const [jmdSearchQuery, setJmdSearchQuery] = useState('');
  const [jmdSearchResults, setJmdSearchResults] = useState([]);
  const [jmdSearching, setJmdSearching] = useState(false);
  const [jmdSaving, setJmdSaving] = useState(null); // uid currently being written

  // ─────────────────────────────────────────────
  // Search Users (RTDB) — fool-proof: email, special chars, case-insensitive
  const handleSearch = async () => {
    const raw = searchQuery.trim();
    if (!raw) return;

    Keyboard.dismiss();
    setLoadingSearch(true);
    setHasSearched(true);
    setSearchResults([]);
    setUserBanStatus({});

    try {
      const results = [];
      const seen = new Set();
      const isEmailSearch = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) || raw.includes('(dot)');
      const isIdSearch = looksLikeUserId(raw);

      if (isIdSearch) {
        // ── ID SEARCH: direct lookup by Firebase user key ──
        const userRef = ref(db, `users/${raw}`);
        const userSnap = await get(userRef);
        if (userSnap.exists()) {
          const u = userSnap.val();
          const id = u.id || raw;
          seen.add(id);
          results.push({
            isBanned: false, id,
            displayName: u.displayName || u.userName || 'Unknown',
            email: u.email, avatar: getAvatarSafe(u),
            robloxUsername: u.robloxUsername,
            isAdmin: u.admin || false, isModerator: u.isModerator || false,
          });
        }
      } else if (isEmailSearch) {
        // ── EMAIL SEARCH: exact lookup by encoded key ──
        const email = raw.toLowerCase().trim();
        const encodedEmail = email.replace(/\./g, '(dot)');

        // Direct key lookup first (fastest)
        const directRef = ref(db, `users/${encodedEmail}`);
        const directSnap = await get(directRef);
        if (directSnap.exists()) {
          const u = directSnap.val();
          const id = u.id || encodedEmail;
          seen.add(id);
          results.push({
            isBanned: false, id,
            displayName: u.displayName || u.userName || 'Unknown',
            email: u.email, avatar: getAvatarSafe(u),
            robloxUsername: u.robloxUsername,
            isAdmin: u.admin || false, isModerator: u.isModerator || false,
          });
        }

        // Fallback: Supabase identity lookup by email / decoded email.
        // (The old RTDB orderByChild('email') query had NO .indexOn
        // backing it, so the server streamed the ENTIRE /users node and
        // filtered client-side on every admin email search.)
        if (results.length === 0) {
          const rows = await searchIdentityByEmail(raw, 10);
          const ids = rows.map(r => r?.uid).filter(id => id && !BAD_KEYS.has(id) && !seen.has(id));
          const [rolesMap, rbxMap] = await Promise.all([
            getRolesBatch(ids).catch(() => new Map()),
            getRobloxBatch(ids).catch(() => new Map()),
          ]);
          for (const r of rows) {
            const id = r?.uid;
            if (!id || BAD_KEYS.has(id) || seen.has(id)) continue;
            seen.add(id);
            const roles = rolesMap.get(id);
            results.push({
              isBanned: false, id,
              displayName: r.displayName || 'Unknown',
              email: r.decodedEmail || r.email, avatar: getAvatarSafe(r),
              robloxUsername: rbxMap.get(id)?.robloxUsername,
              isAdmin: roles?.isAdmin || false, isModerator: roles?.isModerator || false,
            });
          }
        }
      } else {
        // ── NAME SEARCH — Supabase ilike (server-side contains, case-
        // insensitive, symbols included). Replaces 4 RTDB variant queries
        // (each downloading up to 50 FULL user objects) + a 500-user
        // broad-scan fallback (~1 MB per search).
        const rows = await searchIdentityByName(raw, 50);
        const ids = rows.map(r => r?.uid).filter(id => id && !BAD_KEYS.has(id) && !seen.has(id));
        const [rolesMap, rbxMap] = await Promise.all([
          getRolesBatch(ids).catch(() => new Map()),
          getRobloxBatch(ids).catch(() => new Map()),
        ]);
        for (const r of rows) {
          const id = r?.uid;
          if (!id || BAD_KEYS.has(id) || seen.has(id)) continue;
          if (seen.size >= 50) break;
          seen.add(id);
          const roles = rolesMap.get(id);
          results.push({
            isBanned: false, id,
            displayName: r.displayName || 'Unknown',
            email: r.decodedEmail || r.email, avatar: getAvatarSafe(r),
            robloxUsername: rbxMap.get(id)?.robloxUsername,
            isAdmin: roles?.isAdmin || false, isModerator: roles?.isModerator || false,
          });
        }
      }

      setSearchResults(results.slice(0, 50));
    } catch (err) {
      console.error('Search error:', err);
      Alert.alert('Search Failed', err.message || 'An unexpected error occurred.');
    } finally {
      setLoadingSearch(false);
    }
  };

  // ✅ Check if a user is banned directly from Firebase
  const checkUserBanStatus = useCallback(async (email) => {
    if (!email || !db) return null;

    try {
      // Was `em.replace(/\./g,'(dot)')` with no lowercasing, while the
      // write path lowercases — so a banned user with any capital in their
      // email showed up as ACTIVE here.
      const encodedEmail = encodeEmailKey(email);
      const banRef = ref(db, `banned_users_by_email/${encodedEmail}`);
      const snapshot = await get(banRef);

      if (snapshot.exists()) {
        const banData = snapshot.val() || {};
        // Nothing deletes expired records — a 5-minute mute from March is
        // still sitting in RTDB today. Treating `exists()` as "banned"
        // meant the Search tab showed those users as BANNED forever.
        const until = banData.bannedUntil;
        const isActive = until === 'permanent' || (typeof until === 'number' && until > Date.now());
        return {
          ...banData,
          isBanned: isActive,
          // A mute is a record with no strike (muteUser never increments).
          isMute: isActive && (banData.strikeCount || 0) < 1,
          email,
          encodedEmail,
        };
      }
      return null;
    } catch (err) {
      console.error('Error checking ban status:', err);
      return null;
    }
  }, [db]);

  // Admin-only: flip the global moderator ban/mute kill switch.
  // Writes RTDB /mod_controls_enabled; GlobelStats live-subscribes so every
  // moderator's device picks up the change. Admins are never affected.
  const handleToggleModControls = useCallback(async (next) => {
    try {
      await set(ref(db, 'mod_controls_enabled'), next);
    } catch (e) {
      Alert.alert('Error', 'Could not update moderator controls. Check your write permissions.');
    }
  }, [db]);

  // ─────────────────────────────────────────────
  // JMD Access — owner/admin delegates the "Make Junior Mod" power.
  const fetchJmdGranters = useCallback(async () => {
    setJmdGrantersLoading(true);
    try {
      const snap = await get(ref(db, 'jmd_granters'));
      const val = snap.exists() ? snap.val() : {};
      const rows = Object.entries(val || {})
        .filter(([uid, v]) => uid && !BAD_KEYS.has(uid) && v !== false && v != null)
        .map(([uid, v]) => ({
          id: uid,
          // Legacy/plain `true` values carry no profile — fall back to the UID.
          displayName: (typeof v === 'object' && v.displayName) || uid,
          avatar: (typeof v === 'object' && v.avatar) || DEFAULT_AVATAR,
          grantedAt: (typeof v === 'object' && v.grantedAt) || null,
          grantedByName: (typeof v === 'object' && v.grantedByName) || null,
        }))
        .sort((a, b) => (toMillisSafe(b.grantedAt) || 0) - (toMillisSafe(a.grantedAt) || 0));
      setJmdGranters(rows);
    } catch (err) {
      Alert.alert('Error', 'Could not load JMD access list. Check your read permissions.');
    } finally {
      setJmdGrantersLoading(false);
    }
  }, [db]);

  // Name-prefix search (same indexed query the chat viewer uses) plus a direct
  // UID lookup, so the owner can paste a user ID copied from a profile.
  const searchJmdUser = useCallback(async (text) => {
    const raw = (text || '').trim();
    if (!raw) { setJmdSearchResults([]); return; }
    Keyboard.dismiss();
    setJmdSearching(true);
    try {
      const seen = new Set();
      const results = [];

      if (looksLikeUserId(raw)) {
        const snap = await get(ref(db, `users/${raw}`));
        if (snap.exists()) {
          const u = snap.val();
          const id = u.id || raw;
          seen.add(id);
          results.push({
            id,
            displayName: u.displayName || u.userName || 'Unknown',
            avatar: getAvatarSafe(u),
            email: u.email,
            isModerator: !!u.isModerator,
            isAdmin: !!u.admin,
          });
        }
      }

      const lower = sanitizeSearchQuery(raw.toLowerCase());
      if (lower) {
        const upperFirst = lower.charAt(0).toUpperCase() + lower.slice(1);
        const variants = lower === upperFirst ? [lower] : [lower, upperFirst];
        for (const v of variants) {
          const q = query(
            ref(db, 'users'),
            orderByChild('displayName'),
            startAt(v),
            endAt(v + '\uf8ff'),
            limitToFirst(10)
          );
          const snapshot = await get(q);
          if (!snapshot.exists()) continue;
          for (const u of Object.values(snapshot.val() || {})) {
            const id = u?.id;
            if (!id || BAD_KEYS.has(id) || seen.has(id)) continue;
            seen.add(id);
            results.push({
              id,
              displayName: u.displayName || u.userName || 'Unknown',
              avatar: getAvatarSafe(u),
              email: u.email,
              isModerator: !!u.isModerator,
              isAdmin: !!u.admin,
            });
          }
        }
      }

      setJmdSearchResults(results.slice(0, 10));
    } catch (err) {
      Alert.alert('Error', 'Search failed. Try a user ID instead.');
    } finally {
      setJmdSearching(false);
    }
  }, [db]);

  const handleGrantJmdAccess = useCallback(async (userItem) => {
    if (!userItem?.id) return;
    if (jmdGranters.some((g) => g.id === userItem.id)) {
      Alert.alert('Already granted', `${userItem.displayName} can already make Junior Mods.`);
      return;
    }
    const confirmed = await new Promise((resolve) => {
      Alert.alert(
        'Grant JMD Access',
        `Allow ${userItem.displayName} to make and remove Junior Mods?\n\nThis gives them no other staff power.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Grant', onPress: () => resolve(true) },
        ]
      );
    });
    if (!confirmed) return;

    setJmdSaving(userItem.id);
    try {
      await set(ref(db, `jmd_granters/${userItem.id}`), {
        displayName: userItem.displayName || 'Unknown',
        avatar: userItem.avatar || DEFAULT_AVATAR,
        grantedAt: Date.now(),
        grantedBy: currentUser?.id || null,
        grantedByName: currentUser?.userName || currentUser?.displayName || 'Owner',
      });
      setJmdGranters((prev) => [
        {
          id: userItem.id,
          displayName: userItem.displayName || 'Unknown',
          avatar: userItem.avatar || DEFAULT_AVATAR,
          grantedAt: Date.now(),
          grantedByName: currentUser?.userName || currentUser?.displayName || 'Owner',
        },
        ...prev,
      ]);
      setJmdSearchResults([]);
      setJmdSearchQuery('');
      Alert.alert('Granted', `${userItem.displayName} can now make Junior Mods.`);
    } catch (err) {
      Alert.alert('Error', 'Could not grant access. Check your write permissions.');
    } finally {
      setJmdSaving(null);
    }
  }, [db, jmdGranters, currentUser]);

  const handleRevokeJmdAccess = useCallback(async (granter) => {
    if (!granter?.id) return;
    const confirmed = await new Promise((resolve) => {
      Alert.alert('Revoke JMD Access', `Remove ${granter.displayName}'s permission to make Junior Mods?`, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Revoke', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
    if (!confirmed) return;

    setJmdSaving(granter.id);
    try {
      await set(ref(db, `jmd_granters/${granter.id}`), null);
      setJmdGranters((prev) => prev.filter((g) => g.id !== granter.id));
    } catch (err) {
      Alert.alert('Error', 'Could not revoke access. Check your write permissions.');
    } finally {
      setJmdSaving(null);
    }
  }, [db]);

  // ─────────────────────────────────────────────
  // ✅ Fallback compute rating summary directly from reviews (Fix rating 0 issue)
  const computeSummaryFromReviews = useCallback(async (firestoreDB, userId) => {
    const reviewsRef = collection(firestoreDB, 'reviews');
    const q = firestoreQuery(reviewsRef, where('toUserId', '==', userId));
    const snap = await getDocs(q);

    let count = 0;
    let sum = 0;

    snap.docs.forEach((d) => {
      const data = d.data();
      const rating = parseRatingSafe(data?.rating);
      if (rating > 0) {
        count++;
        sum += rating;
      }
    });

    return { rating: count ? sum / count : 0, ratingCount: count };
  }, []);

  // ─────────────────────────────────────────────
  // Fetch User Details (RTDB basic + Firestore rating summary with fallback)
  const fetchUserDetails = useCallback(async (userId) => {
    if (!userId) return;
    setLoadingDetails(true);

    try {
      // RTDB: basic info
      const userRef = ref(db, `users/${userId}`);
      const userSnap = await get(userRef);
      const userData = userSnap.exists() ? userSnap.val() : null;

      // Firestore: summary
      const firestoreDB = getFirestore();
      const summaryRef = doc(firestoreDB, 'user_ratings_summary', userId);
      const summarySnap = await getDoc(summaryRef);

      let rating = 0;
      let ratingCount = 0;

      if (summarySnap.exists()) {
        const s = summarySnap.data();
        rating = parseRatingSafe(s?.averageRating);
        ratingCount = typeof s?.count === 'number' ? s.count : Number(s?.count) || 0;
      }

      // ✅ fallback if summary missing OR empty
      if (!summarySnap.exists() || ratingCount === 0) {
        const fallback = await computeSummaryFromReviews(firestoreDB, userId);
        rating = fallback.rating;
        ratingCount = fallback.ratingCount;
      }

      setUserDetails({
        createdAt: userData?.createdAt || null,
        isPro: userData?.isPro || false,
        rating,
        ratingCount,
        robloxUsername: userData?.robloxUsername || null,
      });
    } catch (err) {
      console.error('Error fetching user details:', err);
      setUserDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  }, [db, computeSummaryFromReviews]);

  // ─────────────────────────────────────────────
  // Fetch Reviews (Firestore) — ✅ fixed fields + ✅ fixed dates + ✅ fixed rating parsing
  const fetchReviews = useCallback(async (userId, reset = false) => {
    if (!userId) return;
    if (!reset && !hasMoreReviews) return;

    setLoadingReviews(true);
    try {
      const firestoreDB = getFirestore();
      const reviewsRef = collection(firestoreDB, 'reviews');
      const limitSize = 2;

      let q;
      if (reset) {
        setReviews([]);
        setLastReviewKey(null);
        setHasMoreReviews(true);

        q = firestoreQuery(
          reviewsRef,
          where('toUserId', '==', userId),
          orderBy('createdAt', 'desc'),
          limit(limitSize)
        );
      } else {
        if (!lastReviewKey) return;
        q = firestoreQuery(
          reviewsRef,
          where('toUserId', '==', userId),
          orderBy('createdAt', 'desc'),
          startAfter(lastReviewKey),
          limit(limitSize)
        );
      }

      const snap = await getDocs(q);

      if (snap.empty) {
        if (reset) setReviews([]);
        setHasMoreReviews(false);
        return;
      }

      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setLastReviewKey(snap.docs[snap.docs.length - 1]);
      setHasMoreReviews(snap.docs.length >= limitSize);

      setReviews((prev) => (reset ? list : [...prev, ...list]));
    } catch (err) {
      console.error('Error fetching reviews from Firestore:', err);
    } finally {
      setLoadingReviews(false);
    }
  }, [hasMoreReviews, lastReviewKey]);

  // ─────────────────────────────────────────────
  // Current sanction — the LIVE RTDB record. This is what is being
  // enforced right now, and it is exactly one thing: the most recent
  // mute/strike/ban, because every write set()s the same key. Read it for
  // "what is in force", never for "what has happened".
  const fetchCurrentSanction = useCallback(async (email) => {
    if (!email) { setCurrentSanction(null); return; }
    try {
      const snapshot = await get(ref(db, `banned_users_by_email/${encodeEmailKey(email)}`));
      if (!snapshot.exists()) { setCurrentSanction(null); return; }

      const data = snapshot.val() || {};
      const until = data.bannedUntil;
      const isActive = until === 'permanent' || (typeof until === 'number' && until > Date.now());

      // bannedBy holds a uid on newer records and a display name on older
      // ones. Resolve only when it looks like a uid — one cached profile
      // read, not a per-row fan-out.
      let appliedByName = typeof data.bannedBy === 'string' ? data.bannedBy : data.bannedBy?.displayName || null;
      if (appliedByName && looksLikeUserId(appliedByName)) {
        try {
          const cached = await getOrFetchProfile(db, appliedByName);
          appliedByName = cached?.displayName || appliedByName;
        } catch { /* keep the raw id */ }
      }

      // A record with strikeCount 0 is a mute (muteUser preserves the
      // existing count and never increments). The old screen rendered it
      // under "Strike History" as though it were a strike.
      const kind = (data.strikeCount || 0) > 0 ? 'strike' : 'mute';

      setCurrentSanction({
        kind,
        isActive,
        strikeCount: data.strikeCount || 0,
        // The reason was being written as the boolean `true` by this
        // screen's own miswired call. Refuse to render that as text.
        reason: typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim() : null,
        appliedAt: data.bannedAt || data.appliedAt || null,
        appliedBy: appliedByName,
        bannedUntil: until ?? null,
      });
    } catch {
      setCurrentSanction(null);
    }
  }, [db]);

  // ─────────────────────────────────────────────
  // Moderation history — the append-only Supabase audit log (029). This is
  // the "how many times was this person muted / struck / banned, by whom,
  // and why" view. Counts are aggregated server-side (one row back), so
  // opening a profile never downloads a timeline just to count it.
  const fetchModRecord = useCallback(async (email, uid, reset = true) => {
    if (!email && !uid) return;
    setModHistoryLoading(true);
    try {
      const [counts, page] = await Promise.all([
        reset ? fetchUserModCounts({ email, uid }) : Promise.resolve(null),
        fetchUserModHistory({ email, uid, cursor: reset ? null : modHistoryCursor, limit: 25 }),
      ]);
      if (counts) setModCounts(counts);
      setModHistory((prev) => (reset ? page.items : [...prev, ...page.items]));
      setModHistoryCursor(page.cursor);
      setModHistoryHasMore(page.hasMore);
      setModSchemaMissing(!!page.schemaMissing);
    } finally {
      setModHistoryLoading(false);
    }
  }, [modHistoryCursor]);

  // ─────────────────────────────────────────────
  // Delete a Review (Admin can delete any, Mod cannot delete mod/admin reviews)
  const handleDeleteReview = useCallback(async (review) => {
    if (!review?.id || !selectedUser?.id) return;

    // If current user is a mod (not admin), check if the reviewer is also a mod/admin
    if (!isAdmin && isModerator && review.fromUserId) {
      try {
        const reviewerRef = ref(db, `users/${review.fromUserId}`);
        const reviewerSnap = await get(reviewerRef);
        if (reviewerSnap.exists()) {
          const reviewerData = reviewerSnap.val();
          if (reviewerData?.isModerator || reviewerData?.admin) {
            Alert.alert('Restricted', 'Moderators cannot delete reviews from other moderators or admins.');
            return;
          }
        }
      } catch (err) {
        console.error('Error checking reviewer status:', err);
      }
    }

    Alert.alert(
      'Delete Review',
      `Are you sure you want to delete this review${review.userName ? ` by ${review.userName}` : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const firestoreDB = getFirestore();
              const reviewRef = doc(firestoreDB, 'reviews', review.id);

              // Get the rating before deleting so we can update the summary
              const ratingToRemove = parseRatingSafe(review?.rating);

              // Delete the review document
              await deleteDoc(reviewRef);

              // Update the ratings summary
              const summaryRef = doc(firestoreDB, 'user_ratings_summary', selectedUser.id);
              const summarySnap = await getDoc(summaryRef);

              if (summarySnap.exists()) {
                const s = summarySnap.data();
                const oldAvg = s?.averageRating || 0;
                const oldCount = s?.count || 0;

                if (oldCount <= 1) {
                  // Last review — reset summary
                  await setDoc(summaryRef, { averageRating: 0, count: 0 }, { merge: true });
                } else {
                  const newCount = oldCount - 1;
                  const newAvg = ((oldAvg * oldCount) - ratingToRemove) / newCount;
                  await setDoc(summaryRef, {
                    averageRating: parseFloat(newAvg.toFixed(2)),
                    count: newCount,
                  }, { merge: true });
                }
              }

              // Remove from local state
              setReviews((prev) => prev.filter((r) => r.id !== review.id));

              // Refresh user details to update displayed rating
              fetchUserDetails(selectedUser.id);

              Alert.alert('Deleted', 'Review has been removed.');
            } catch (err) {
              console.error('Delete review error:', err);
              Alert.alert('Error', 'Could not delete review.');
            }
          },
        },
      ]
    );
  }, [selectedUser, fetchUserDetails, isAdmin, isModerator, db]);

  const handleSelectUser = useCallback(async (userItem) => {
    setSelectedUser(userItem);
    setUserDetails(null);
    setReviews([]);
    setCurrentSanction(null);
    setModHistory([]);
    setModCounts(null);
    setModHistoryCursor(null);
    setModHistoryHasMore(false);
    setModSchemaMissing(false);
    setHasMoreReviews(true);
    setLastReviewKey(null);

    if (userItem.id) {
      fetchUserDetails(userItem.id);
      fetchReviews(userItem.id, true);
    }
    if (userItem.email) {
      fetchCurrentSanction(userItem.email);
    }
    // The audit log is keyed by email but matches on uid too, so a record
    // written before the user had a uid on file still resolves.
    if (userItem.email || userItem.id) {
      fetchModRecord(userItem.email, userItem.id, true);
    }
  }, [fetchUserDetails, fetchReviews, fetchCurrentSanction, fetchModRecord]);

  // Re-read both sides after an action so the open profile reflects the
  // write without the admin having to close and reopen it.
  const refreshOpenProfile = useCallback((userItem) => {
    if (!userItem) return;
    if (userItem.email) fetchCurrentSanction(userItem.email);
    if (userItem.email || userItem.id) fetchModRecord(userItem.email, userItem.id, true);
  }, [fetchCurrentSanction, fetchModRecord]);

  // ─────────────────────────────────────────────
  // Actions
  // Identity of whoever is taking the action, stamped onto both the RTDB
  // record and the audit-log row. `role` records the authority the action
  // was taken under — a moderator ban and an admin ban are not the same
  // event, and the history should not have to guess later.
  const actorInfo = useMemo(() => ({
    id: currentUser?.id,
    displayName: currentUser?.userName || currentUser?.displayName || 'Admin',
    avatar: currentUser?.avatar,
    role: isAdmin ? 'admin' : (isModerator ? 'moderator' : (isBabyMod ? 'baby_mod' : null)),
  }), [currentUser?.id, currentUser?.userName, currentUser?.displayName, currentUser?.avatar, isAdmin, isModerator, isBabyMod]);

  // Every punitive action opens the reason prompt first. Reasons were
  // previously never collected on this screen, which is why the banned
  // list is full of records reading "Strike 1" and nothing else — and why
  // nobody could answer "what did they actually do?" a week later.
  const requestAction = useCallback((type, value, userItem) => {
    if (type !== 'unban' && !canBanMute) {
      Alert.alert('Disabled', 'Moderator ban & mute are currently turned off by an admin.');
      return;
    }
    if (!userItem?.email) {
      Alert.alert('Error', 'User has no email associated — ban records are keyed by email.');
      return;
    }
    setActionReason('');
    setPendingAction({ type, value, user: userItem });
  }, [canBanMute]);

  const handleUnban = useCallback(async (userItem, reason) => {
    const email = userItem.email || decodeEmail(userItem.encodedEmail);
    if (!email) return;

    try {
      const success = await unbanUserWithEmail(email, true, actorInfo, reason || null, 'admin_dashboard');
      if (success) {
        refreshBannedList();
        refreshOpenProfile(userItem);
        setSelectedUser((prev) => (prev ? { ...prev, isBanned: false } : prev));
        setSearchResults((prev) => prev.map((u) => (u.email === email ? { ...u, isBanned: false } : u)));
        // Mark as explicitly-checked-and-clear rather than deleting the
        // key: an absent key means "never checked" to renderItem, which
        // would make it re-query RTDB on every single re-render.
        setUserBanStatus((prev) => ({ ...prev, [email]: null }));
      }
    } catch (err) {
      Alert.alert('Error', 'Could not unban user.');
    }
  }, [actorInfo, refreshBannedList, refreshOpenProfile]);

  const handleBan = useCallback(async (userItem, reason, evidenceUrls = null) => {
    const userInfo = {
      id: userItem.id,
      displayName: userItem.displayName,
      avatar: userItem.avatar,
      email: userItem.email,
    };

    // Argument order matters and was wrong here: this call used to pass
    // `isStaff` into BOTH the customReason and a seventh, non-existent
    // slot — so every ban from this dashboard was saved with
    // `reason: true`, which rendered as an empty reason everywhere.
    const success = await banUserwithEmail(
      userItem.email,
      isAdmin,
      userItem.id,
      userInfo,
      actorInfo,
      reason || null,
      'admin_dashboard',
      evidenceUrls,
    );
    if (success) {
      refreshBannedList();
      refreshOpenProfile(userItem);
      setSelectedUser((prev) => (prev ? { ...prev, isBanned: true } : prev));
      setSearchResults((prev) => prev.map((u) => (u.email === userItem.email ? { ...u, isBanned: true } : u)));
      checkUserBanStatus(userItem.email).then((banData) => {
        setUserBanStatus((prev) => ({ ...prev, [userItem.email]: banData }));
      });
    }
  }, [isAdmin, actorInfo, refreshBannedList, refreshOpenProfile, checkUserBanStatus]);

  const handleSetStrike = useCallback(async (userItem, strikeCount, reason, evidenceUrls = null) => {
    const userInfo = {
      id: userItem.id,
      displayName: userItem.displayName || userItem.sender,
      avatar: userItem.avatar,
    };

    // Same miswiring as handleBan: `isStaff` was landing in the
    // customReason slot.
    const success = await setUserStrike(
      userItem.email,
      strikeCount,
      userItem.id,
      true,
      actorInfo,
      userInfo,
      reason || null,
      'admin_dashboard',
      evidenceUrls,
    );
    if (success) {
      refreshBannedList();
      refreshOpenProfile(userItem);
      setSelectedUser((prev) => (prev ? { ...prev, isBanned: true } : prev));
      setSearchResults((prev) => prev.map((u) => (u.email === userItem.email ? { ...u, isBanned: true } : u)));
      checkUserBanStatus(userItem.email).then((banData) => {
        setUserBanStatus((prev) => ({ ...prev, [userItem.email]: banData }));
      });
    }
  }, [actorInfo, refreshBannedList, refreshOpenProfile, checkUserBanStatus]);

  const handleMuteUser = useCallback(async (userItem, minutes, reason, evidenceUrls = null) => {
    const userInfo = {
      id: userItem.id,
      displayName: userItem.displayName,
      avatar: userItem.avatar,
    };

    const success = await muteUser(
      userItem.email,
      minutes,
      userInfo,
      actorInfo,
      true,
      reason || null,
      'admin_dashboard',
      evidenceUrls,
    );
    if (success) {
      refreshBannedList();
      refreshOpenProfile(userItem);
      setSearchResults((prev) => prev.map((u) => (u.email === userItem.email ? { ...u, isBanned: true } : u)));
      checkUserBanStatus(userItem.email).then((banData) => {
        setUserBanStatus((prev) => ({ ...prev, [userItem.email]: banData }));
      });
    }
  }, [actorInfo, refreshBannedList, refreshOpenProfile, checkUserBanStatus]);

  // Runs whatever the reason prompt was opened for.
  const confirmPendingAction = useCallback(async () => {
    if (!pendingAction || evidenceBusy) return;
    const { type, value, user: target } = pendingAction;
    const reason = actionReason.trim();

    // Upload BEFORE the modal closes. uploadEvidence throws, and at this
    // moment the mod still has the screenshots in hand — closing first would
    // apply the sanction with the proof silently dropped and no way to
    // reattach it afterwards. The sanction is NOT applied if this fails.
    let evidenceUrls = null;
    if (actionEvidence.length > 0) {
      setEvidenceBusy(true);
      try {
        evidenceUrls = await uploadEvidence(actionEvidence);
      } catch (e) {
        setEvidenceBusy(false);
        Alert.alert(
          'Screenshots did not upload',
          `${e?.message || 'Upload failed.'}\n\nNothing has been applied. Try again, or remove the screenshots to proceed without them.`,
        );
        return;
      }
      setEvidenceBusy(false);
    }

    Keyboard.dismiss();
    setPendingAction(null);
    setActionReason('');
    setActionEvidence([]);

    if (type === 'ban') await handleBan(target, reason, evidenceUrls);
    else if (type === 'strike') await handleSetStrike(target, value, reason, evidenceUrls);
    else if (type === 'mute') await handleMuteUser(target, value, reason, evidenceUrls);
    else if (type === 'unban') await handleUnban(target, reason);
  }, [pendingAction, actionReason, actionEvidence, evidenceBusy, handleBan, handleSetStrike, handleMuteUser, handleUnban]);


  // ─────────────────────────────────────────────
  // Chat Viewer — search users for person slots
  // Resolves a free-text query to users, for every people-picker on this
  // screen (chat viewer slots, User Chats target).
  //
  // This used to be an RTDB orderByChild('displayName') prefix query run
  // twice (lowercase + Capitalized). Three problems, all of which made the
  // chat viewer feel broken:
  //   * PREFIX ONLY — "pro" never found "xXPROxX".
  //   * CASE SENSITIVE beyond those two hand-rolled variants, so most
  //     real usernames (mixed case, symbols) simply did not come back.
  //   * It downloaded up to 10 FULL user objects per variant, per search,
  //     straight off RTDB — the exact pattern the main Search DB tab was
  //     migrated away from for cost.
  // Now it shares that migrated path: Supabase ilike (server-side,
  // case-insensitive, substring), plus direct lookups for a pasted uid or
  // a full email.
  const resolveUsers = useCallback(async (raw) => {
    const text = (raw || '').trim();
    if (!text) return [];

    // Pasted Firebase uid — direct lookup, no search.
    if (looksLikeUserId(text)) {
      try {
        const snap = await get(ref(db, `users/${text}`));
        if (snap.exists()) {
          const u = snap.val() || {};
          return [{
            id: u.id || text,
            displayName: u.displayName || u.userName || 'Unknown',
            avatar: getAvatarSafe(u),
            email: u.email || null,
          }];
        }
      } catch { /* fall through to name search */ }
      return [];
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
    const rows = isEmail
      ? await searchIdentityByEmail(text, 10).catch(() => [])
      : await searchIdentityByName(text, 10).catch(() => []);

    const seen = new Set();
    const out = [];
    for (const r of rows || []) {
      const id = r?.uid;
      if (!id || BAD_KEYS.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        displayName: r.displayName || 'Unknown',
        avatar: getAvatarSafe(r),
        // Carry the email through: the profile modal needs it to ban, and
        // a picker result that arrives without one produces a user you can
        // look at but not action.
        email: r.decodedEmail || r.email || null,
      });
    }
    return out;
  }, [db]);

  const searchChatUser = useCallback(async (text, slot) => {
    const setSearching = slot === 1 ? setChatSearching1 : setChatSearching2;
    const setResults = slot === 1 ? setChatResults1 : setChatResults2;

    if (!text || text.trim().length < 1) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      setResults(await resolveUsers(text));
    } catch (err) {
      console.error('Chat user search error:', err);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [resolveUsers]);

  // Load Private Chat between two selected users.
  //
  // Paged. `reset` loads the newest page and the (frozen) RTDB history;
  // subsequent calls page further back through Supabase only, because the
  // RTDB subtree is pre-cut history that arrives whole on the first load
  // and never grows.
  const CHAT_PAGE_SIZE = 100;

  const loadChat = useCallback(async (reset = true) => {
    if (!chatPerson1?.id || !chatPerson2?.id) {
      Alert.alert('Error', 'Please select both users first.');
      return;
    }
    if (chatPerson1.id === chatPerson2.id) {
      Alert.alert('Error', 'Please select two different users.');
      return;
    }
    if (!reset && (chatOlderLoading || !chatHasOlder)) return;

    Keyboard.dismiss();
    if (reset) {
      setLoadingChat(true);
      setChatMessages([]);
      setChatError(null);
      chatCursorRef.current = null;
      chatLegacyLoadedRef.current = false;
      setChatHasOlder(false);
    } else {
      setChatOlderLoading(true);
    }

    try {
      const id1 = chatPerson1.id;
      const id2 = chatPerson2.id;
      const chatKey = id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;

      // Two stores, because the Phase 5 cut split this conversation in half:
      //   - Supabase public.private_messages — every message sent by a
      //     post-cut build. Authoritative from the cut onward. Read through
      //     the admin RPC (024) because the table's RLS is participant-only,
      //     so a direct query from an admin returns zero rows.
      //   - RTDB /private_messages/{chatKey}/messages — pre-cut history, plus
      //     the bridge window. Frozen: nothing writes here any more.
      // Reading only RTDB is what broke this screen — chats that started
      // after the cut have no RTDB subtree at all and rendered as empty.
      const [supaMsgs, rtdbSnap] = await Promise.all([
        adminLoadPrivateMessages(chatKey, {
          limit: CHAT_PAGE_SIZE,
          before: chatCursorRef.current,
        }).catch((err) => {
          // Surfaced below rather than swallowed — a 42501 here means the
          // caller isn't recognised as an admin server-side, which is a
          // config problem, not an empty chat.
          console.error('Supabase admin chat load failed:', err?.message);
          throw err;
        }),
        // RTDB history is the oldest material there is, so it only needs
        // fetching once — on the first page, or on the page that runs out
        // of Supabase rows.
        chatLegacyLoadedRef.current
          ? Promise.resolve(null)
          : get(query(ref(db, `private_messages/${chatKey}/messages`), orderByChild('timestamp')))
              .catch(() => null),
      ]);

      // The rpc returns newest-first; remember the oldest row as the cursor.
      const oldest = (supaMsgs || [])[supaMsgs.length - 1];
      if (oldest) {
        chatCursorRef.current = { createdAt: new Date(oldest.timestamp).toISOString(), id: oldest.id };
      }
      const moreSupabase = (supaMsgs || []).length >= CHAT_PAGE_SIZE;

      // Backfilled rows carry the original push key in rtdb_key, so the
      // same message present in both stores collapses to one bubble.
      const legacy = [];
      if (rtdbSnap?.exists()) {
        chatLegacyLoadedRef.current = true;
        const seenRtdbKeys = new Set(
          (supaMsgs || []).map((m) => m.rtdbKey).filter(Boolean),
        );
        for (const [key, value] of Object.entries(rtdbSnap.val() || {})) {
          if (seenRtdbKeys.has(key)) continue;
          legacy.push({ id: key, ...value, legacy: true });
        }
      } else if (rtdbSnap !== null) {
        chatLegacyLoadedRef.current = true;
      }

      setChatMessages((prev) => {
        const merged = [...prev, ...(supaMsgs || []), ...legacy];
        // Dedupe on id — a page boundary or the legacy merge can otherwise
        // hand FlatList two rows with the same key.
        const seen = new Set();
        return merged
          .filter((m) => {
            const key = m?.id;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) => (a?.timestamp || 0) - (b?.timestamp || 0));
      });

      // Only Supabase pages; once it is exhausted the legacy block is all
      // that is left and it arrived in full.
      setChatHasOlder(moreSupabase);
    } catch (err) {
      console.error('Chat load error:', err);
      const denied = err?.code === '42501' || /not authorized|unauthenticated/i.test(err?.message || '');
      const msg = denied
        ? 'Your account is not recognised as an admin by the database. Apply supabase/024_admin_private_messages.sql.'
        : 'Could not load chat. Check selections and try again.';
      // Held in state as well as alerted: the list used to fall back to
      // "No messages found between these users" after a failed load, which
      // reads as "these two never talked" when it means "the read failed".
      setChatError(msg);
      Alert.alert('Error', msg);
    } finally {
      setLoadingChat(false);
      setChatOlderLoading(false);
    }
  }, [db, chatPerson1, chatPerson2, chatOlderLoading, chatHasOlder]);

  // Delete the entire private conversation between the two selected users.
  //
  // Two-store delete:
  //   - RTDB: drops /private_messages/{chatKey} (pre-cut history and the
  //     trade/post attachments) and any legacy /chat_meta_data inbox rows
  //     from old-app users. Done in one atomic multi-path update.
  //   - Supabase: drops both chat_meta_data rows via admin_delete_chat_pair
  //     (013) AND every message row via admin_delete_private_chat (024).
  //     The message delete was missing: post-cut bodies live only in
  //     Supabase, so clearing the inbox rows hid the conversation from
  //     both users' chat lists while leaving the messages in place and
  //     still readable — PrivateChat loads by chat_id, not via the inbox.
  //     The dialog promises permanent deletion, so it has to be permanent.
  //
  // Gated to admins at the UI.
  const deletePrivateChat = useCallback(async () => {
    if (!chatPerson1?.id || !chatPerson2?.id) {
      Alert.alert('Error', 'Please select both users first.');
      return;
    }
    if (chatPerson1.id === chatPerson2.id) {
      Alert.alert('Error', 'Please select two different users.');
      return;
    }

    const id1 = chatPerson1.id;
    const id2 = chatPerson2.id;
    const chatKey = id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;
    const name1 = chatPerson1.displayName || id1;
    const name2 = chatPerson2.displayName || id2;

    const confirm = await new Promise((resolve) => {
      Alert.alert(
        '⚠️ Delete Conversation',
        `This will permanently delete the entire chat between "${name1}" and "${name2}".\n\nThis includes all messages, unread counters, last-read markers, trade/post attachments, and the inbox entries on both sides.\n\nThis action CANNOT be undone.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
        ]
      );
    });
    if (!confirm) return;

    setLoadingChat(true);
    try {
      const updates = {};
      updates[`private_messages/${chatKey}`] = null;
      updates[`chat_meta_data/${id1}/${id2}`] = null;
      updates[`chat_meta_data/${id2}/${id1}`] = null;
      await update(ref(db), updates);

      // Supabase side — required for new-app users whose inbox rows
      // never existed in RTDB and so won't be cleaned by the mirror CF.
      // Messages first: if the inbox delete fails we'd rather be left with
      // an orphaned inbox row pointing at nothing than with hidden-but-live
      // message bodies the admin believes are gone.
      const removed = await adminDeletePrivateChat(chatKey);
      await adminDeleteChatPair(id1, id2);

      setChatMessages([]);
      Alert.alert('Deleted', `Conversation removed. ${removed} message(s) deleted.`);
    } catch (err) {
      console.error('Chat delete error:', err);
      Alert.alert('Error', 'Could not delete chat. Try again.');
    } finally {
      setLoadingChat(false);
    }
  }, [db, chatPerson1, chatPerson2]);

  // ─────────────────────────────────────────────
  // User Chats Viewer — paginated list of all chats for a single user.
  // Reads via the admin_list_user_chats RPC (013_admin_chat_meta.sql),
  // which is the only path that bypasses chat_meta_data's
  // owner-only RLS. Cursor semantics match the prior RTDB query:
  // first page passes null, subsequent pages pass the oldest row's
  // timestamp from the previous response.
  const fetchUserChats = useCallback(async (targetUser, reset = false) => {
    if (!targetUser?.id) return;
    try {
      if (reset) {
        setUserChatsLoading(true);
        userChatsCursorRef.current = null;
        setUserChatsHasMore(true);
      } else {
        if (!userChatsHasMore || userChatsLoadingMore || userChatsLoading) return;
        setUserChatsLoadingMore(true);
      }

      const cursor = userChatsCursorRef.current;
      const rows = await adminListUserChats(targetUser.id, cursor, USER_CHATS_PAGE_SIZE);

      if (!rows || rows.length === 0) {
        setUserChatsHasMore(false);
        if (reset) setUserChatsList([]);
        return;
      }

      const items = rows.map((r) => ({
        partnerId: r.partnerId,
        chatId: r.chatId,
        lastMessage: r.lastMessage || '',
        timestamp: r.timestamp || 0,
        unreadCount: r.unreadCount || 0,
        partnerName: r.receiverName || 'Unknown',
        partnerAvatar: r.receiverAvatar || DEFAULT_AVATAR,
      }));

      // RPC already orders desc on timestamp_ms, but a stable client-side
      // sort guards against null/missing values landing out of order.
      items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      if (items.length > 0) {
        userChatsCursorRef.current = items[items.length - 1].timestamp || 0;
      }
      if (items.length < USER_CHATS_PAGE_SIZE) setUserChatsHasMore(false);

      setUserChatsList((prev) => {
        const merged = reset ? items : [...prev, ...items];
        const seen = new Set();
        return merged.filter((c) => {
          if (!c.partnerId || seen.has(c.partnerId)) return false;
          seen.add(c.partnerId);
          return true;
        });
      });
    } catch (err) {
      console.warn('[AdminDashboard] fetchUserChats error:', err?.message);
      // A 42501 from _require_admin() is a config problem, not an empty
      // inbox. Swallowing it here is what made this tab look like the
      // user simply had no chats.
      const denied = err?.code === '42501' || /not authorized|unauthenticated/i.test(err?.message || '');
      if (denied) {
        setUserChatsHasMore(false);
        Alert.alert(
          'Not authorized',
          'The database does not recognise this account as an admin. Apply supabase/024_admin_private_messages.sql.',
        );
      }
    } finally {
      setUserChatsLoading(false);
      setUserChatsLoadingMore(false);
    }
  }, [userChatsHasMore, userChatsLoadingMore, userChatsLoading]);

  // Resolve whatever the admin typed into a target user.
  //
  // This used to demand a raw Firebase uid and reject anything else with
  // "Not a valid Firebase user ID" — so using the tab meant going to
  // another tab first, finding the person, copying their id, and coming
  // back. It now takes a name, an email or a uid, and shows a picker when
  // a name matches more than one person.
  const [userChatsResults, setUserChatsResults] = useState([]);

  const selectUserChatsTarget = useCallback((target) => {
    setUserChatsResults([]);
    setUserChatsInput('');
    setUserChatsTarget(target);
    setUserChatsList([]);
    userChatsCursorRef.current = null;
    setUserChatsHasMore(true);
    fetchUserChats(target, true);
  }, [fetchUserChats]);

  const loadUserChatsForInput = useCallback(async () => {
    const raw = userChatsInput.trim();
    if (!raw) { Alert.alert('Error', 'Enter a name, email or user ID.'); return; }

    Keyboard.dismiss();
    setUserChatsLoading(true);
    setUserChatsResults([]);
    try {
      const matches = await resolveUsers(raw);
      if (matches.length === 0) {
        Alert.alert('Not Found', 'No user matches that name, email or ID.');
        return;
      }
      if (matches.length === 1) {
        selectUserChatsTarget(matches[0]);
        return;
      }
      setUserChatsResults(matches);
    } catch (err) {
      console.error('User chats lookup error:', err);
      Alert.alert('Error', 'Could not look up that user.');
    } finally {
      setUserChatsLoading(false);
    }
  }, [userChatsInput, resolveUsers, selectUserChatsTarget]);

  const clearUserChatsTarget = useCallback(() => {
    setUserChatsTarget(null);
    setUserChatsInput('');
    setUserChatsResults([]);
    setUserChatsList([]);
    userChatsCursorRef.current = null;
    setUserChatsHasMore(true);
  }, []);

  const openChatFromUserChats = useCallback((entry) => {
    if (!userChatsTarget?.id || !entry?.partnerId) return;
    const partner = {
      id: entry.partnerId,
      displayName: entry.partnerName || 'Unknown',
      avatar: entry.partnerAvatar || DEFAULT_AVATAR,
      email: null,
    };
    setChatPerson1(userChatsTarget);
    setChatPerson2(partner);
    setChatSearch1(''); setChatSearch2('');
    setChatResults1([]); setChatResults2([]);
    setActiveTab('chatViewer');
  }, [userChatsTarget]);

  // Auto-load chat when arriving at chatViewer via openChatFromUserChats
  useEffect(() => {
    if (activeTab === 'chatViewer' && chatPerson1?.id && chatPerson2?.id && chatMessages.length === 0 && !loadingChat) {
      loadChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, chatPerson1?.id, chatPerson2?.id]);

  // ─────────────────────────────────────────────
  // Polls Management
  const fetchPolls = useCallback(async () => {
    setLoadingPolls(true);
    try {
      const firestoreDB = getFirestore();
      const pollsRef = collection(firestoreDB, 'polls');
      const q = firestoreQuery(pollsRef, orderBy('createdAt', 'desc'), limit(10));
      const snapshot = await getDocs(q);
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPolls(list);
    } catch (err) {
      console.error('Fetch polls error:', err);
    } finally {
      setLoadingPolls(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'polls') fetchPolls();
  }, [activeTab, fetchPolls]);

  useEffect(() => {
    if (activeTab === 'jmdAccess' && isAdmin) fetchJmdGranters();
  }, [activeTab, isAdmin, fetchJmdGranters]);

  const handleCreatePoll = useCallback(async () => {
    const q = pollQuestion.trim();
    const opts = pollOptions.map((o) => o.trim()).filter((o) => o.length > 0);
    if (!q) { Alert.alert('Error', 'Please enter a question.'); return; }
    if (opts.length < 2) { Alert.alert('Error', 'Please add at least 2 options.'); return; }

    // Check max 3 active
    const activeCount = polls.filter((p) => p.active).length;
    if (activeCount >= 3) {
      Alert.alert('Limit Reached', 'Maximum 3 active polls allowed. Deactivate one first.');
      return;
    }

    setCreatingPoll(true);
    try {
      const firestoreDB = getFirestore();
      const pollsRef = collection(firestoreDB, 'polls');
      const newPoll = {
        question: q,
        options: opts.map((text) => ({ text, votes: 0 })),
        totalVotes: 0,
        voters: {},
        active: true,
        createdAt: Timestamp.now(),
        createdBy: currentUser?.id || 'admin',
        imageUrl: pollImageUrl.trim() || null,
      };
      await addDoc(pollsRef, newPoll);
      setPollQuestion('');
      setPollOptions(['', '']);
      setPollImageUrl('');
      Alert.alert('Success', 'Poll created!');
      fetchPolls();
    } catch (err) {
      console.error('Create poll error:', err);
      Alert.alert('Error', 'Could not create poll.');
    } finally {
      setCreatingPoll(false);
    }
  }, [pollQuestion, pollOptions, pollImageUrl, polls, currentUser, fetchPolls]);

  // 🐰 Upload poll image to Bunny CDN
  const handlePickPollImage = useCallback(async () => {
    setUploadingPollImage(true);

    let response;
    try {
      response = await launchImageLibrary({
        mediaType: 'photo', selectionLimit: 1, quality: 0.8, maxWidth: 1920, maxHeight: 1920,
      });
    } catch (err) {
      console.error('Image picker launch error:', err);
      setUploadingPollImage(false);
      return;
    }

    try {
      if (!response || response.didCancel || response.errorCode) { setUploadingPollImage(false); return; }
      const asset = response?.assets?.[0];
      if (!asset?.uri) { setUploadingPollImage(false); return; }

      let imageUri = asset.uri;
      const fileSize = asset.fileSize || 0;
      if (fileSize > 1024 * 1024) {
        const result = await safeCompressImage(imageUri, {
          maxWidth: 1024, quality: 0.7, returnableOutputType: 'uri',
        });
        imageUri = result.uri;
      }

      const localPath = imageUri.startsWith('file://') ? imageUri.replace('file://', '') : imageUri;
      const base64 = await RNFS.readFile(localPath, 'base64');
      const bytes = base64ToBytes(base64);
      const fileName = `poll_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      const remotePath = `polls/${fileName}`;

      const res = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`, {
        method: 'PUT',
        headers: { AccessKey: BUNNY_ACCESS_KEY, 'Content-Type': 'image/jpeg' },
        body: bytes,
      });

      if (!res.ok) throw new Error('Upload failed');
      const cdnUrl = `${BUNNY_CDN_BASE}/${remotePath}`;
      setPollImageUrl(cdnUrl);
    } catch (err) {
      console.error('Poll image upload error:', err);
      Alert.alert('Error', 'Could not upload image.');
    } finally {
      setUploadingPollImage(false);
    }
  }, []);

  const handleDeletePoll = useCallback(async (pollId) => {
    Alert.alert('Delete Poll', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            const firestoreDB = getFirestore();
            await deleteDoc(doc(firestoreDB, 'polls', pollId));
            setPolls((prev) => prev.filter((p) => p.id !== pollId));
          } catch (err) {
            Alert.alert('Error', 'Could not delete poll.');
          }
        },
      },
    ]);
  }, []);

  const handleTogglePollActive = useCallback(async (pollItem) => {
    if (!pollItem.active) {
      // Check max 3 before activating
      const activeCount = polls.filter((p) => p.active).length;
      if (activeCount >= 3) {
        Alert.alert('Limit Reached', 'Maximum 3 active polls. Deactivate one first.');
        return;
      }
    }
    try {
      const firestoreDB = getFirestore();
      await updateDoc(doc(firestoreDB, 'polls', pollItem.id), { active: !pollItem.active });
      setPolls((prev) => prev.map((p) => p.id === pollItem.id ? { ...p, active: !p.active } : p));
    } catch (err) {
      Alert.alert('Error', 'Could not update poll.');
    }
  }, [polls]);

  // Render Item (fix avatar)
  // Fetches ban status for a search row exactly once per email.
  //
  // This used to live inline in renderItem, firing an RTDB get() DURING
  // render — and it only wrote to the cache when the user turned out to be
  // banned. For everyone NOT banned (the overwhelming majority) the key
  // was never set, `hasOwnProperty` stayed false, and the next render
  // fired the query again. On a 50-result search that is an unbounded
  // stream of RTDB reads for as long as the tab is open, billed per
  // download. Now: an effect (not render), and a `null` is cached as a
  // real answer so a miss is remembered.
  const pendingBanChecks = React.useRef(new Set());

  useEffect(() => {
    if (activeTab !== 'search' || searchResults.length === 0) return;

    const toCheck = searchResults
      .map((u) => u.email)
      .filter((email) =>
        email &&
        !Object.prototype.hasOwnProperty.call(userBanStatus, email) &&
        !pendingBanChecks.current.has(email));

    if (toCheck.length === 0) return;
    toCheck.forEach((email) => pendingBanChecks.current.add(email));

    let cancelled = false;
    Promise.all(toCheck.map((email) =>
      checkUserBanStatus(email).then((banData) => [email, banData])
    )).then((pairs) => {
      pendingBanChecks.current.clear();
      if (cancelled) return;
      setUserBanStatus((prev) => {
        const next = { ...prev };
        // Cache misses as null — that is the answer, not the absence of one.
        pairs.forEach(([email, banData]) => { next[email] = banData; });
        return next;
      });
    });

    return () => { cancelled = true; };
  }, [activeTab, searchResults, userBanStatus, checkUserBanStatus]);

  // Shown wherever the audit log would otherwise render a bare empty
  // state. An empty Mod Log has two very different causes and an admin
  // cannot tell them apart from an empty list alone.
  const SetupNotice = () => (
    <View style={[styles.panel, {
      backgroundColor: tint(HUE.warn, '12'),
      borderColor: tint(HUE.warn, '45'),
      marginHorizontal: 0,
    }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACE.sm }}>
        <Ionicons name="construct-outline" size={16} color={HUE.warn} style={{ marginRight: 7 }} />
        <Text style={{ color: HUE.warn, fontWeight: '700', fontSize: 13 }}>
          Audit log not set up yet
        </Text>
      </View>
      <Text style={{ color: C.textMuted, fontSize: 12.5, lineHeight: 18 }}>
        The moderation history database table does not exist. Apply{' '}
        <Text style={{ fontWeight: '700', color: C.text }}>supabase/029_mod_actions.sql</Text>{' '}
        in the Supabase SQL editor, then reopen this tab.
      </Text>
      <Text style={{ color: C.textFaint, fontSize: 11.5, marginTop: SPACE.sm, lineHeight: 17 }}>
        Bans, mutes and strikes still work normally — they just are not being
        recorded to history until this is applied.
      </Text>
    </View>
  );

  const renderItem = ({ item }) => {
    let isBanned = item.isBanned;
    let banInfo = null;

    if (activeTab === 'search') {
      const cachedBan = userBanStatus[item.email];
      if (cachedBan) {
        isBanned = !!cachedBan.isBanned;
        banInfo = cachedBan;
      } else {
        // Fall back to the already-loaded banned list before querying.
        const foundBan = allBannedUsers.find((b) => b.email === item.email);
        if (foundBan) {
          isBanned = true;
          banInfo = foundBan;
        }
      }
    } else {
      banInfo = item;
    }

    const merged = { ...item, ...(banInfo || {}), isBanned };
    const avatarUri = getAvatarSafe(merged);
    // A mute is a live restriction with no strike behind it. Showing it as
    // "BANNED" overstated it; showing it as "ACTIVE" (what the banned-list
    // builder did by skipping strikeCount < 1) hid it entirely.
    const isMuted = isBanned && (merged.strikeCount || 0) < 1;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleSelectUser(merged)}
        style={[
          styles.card,
          { backgroundColor: C.surface, borderColor: C.border }
        ]}
      >
        <Image source={{ uri: avatarUri }} style={styles.avatar} />
        <View style={styles.cardContent}>
          <Text style={[styles.name, { color: C.text }]} numberOfLines={1}>
            {merged.displayName}
          </Text>
          <Text style={[styles.email, { color: C.textMuted }]} numberOfLines={1}>
            {merged.email || merged.decodedEmail || '—'}
          </Text>
        </View>

        <View style={styles.actionContainer}>
          {(() => {
            const st = isMuted
              ? { hue: HUE.mute, label: 'MUTED' }
              : isBanned
                ? { hue: HUE.danger, label: 'BANNED' }
                : { hue: HUE.success, label: 'ACTIVE' };
            return (
              <View style={[styles.statusChip, { backgroundColor: tint(st.hue), borderColor: tint(st.hue, '40') }]}>
                <Text style={[styles.statusChipText, { color: st.hue }]}>{st.label}</Text>
              </View>
            );
          })()}
          <Ionicons name="ellipsis-vertical" size={20} color={C.textFaint} style={{ marginLeft: 8 }} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: C.bg, paddingTop: SPACE.md }]}>
      {/* Tabs — was eight near-identical 8-line blocks; one list now, so a
          style change happens in one place instead of eight. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={styles.tabContainer}
      >
        {[
          { key: 'banned',     label: 'Restrictions' },
          { key: 'search',     label: 'Search DB' },
          { key: 'modLog',     label: 'Mod Log' },
          { key: 'chatViewer', label: 'Chat Viewer' },
          { key: 'userChats',  label: 'User Chats', adminOnly: true },
          { key: 'polls',      label: 'Polls' },
          { key: 'statusFeed', label: 'Statuses' },
          { key: 'jmdAccess',  label: 'JMD Access', adminOnly: true },
        ]
          .filter((t) => !t.adminOnly || isAdmin)
          .map((t) => {
            const on = activeTab === t.key;
            return (
              <TouchableOpacity
                key={t.key}
                onPress={() => setActiveTab(t.key)}
                style={[styles.tab, {
                  backgroundColor: on ? HUE.accent : C.surface,
                  borderColor: on ? HUE.accent : C.border,
                }]}
              >
                <Text style={[styles.tabText, { color: on ? '#FFF' : C.textMuted }]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
      </ScrollView>

      {/* Admin-only: moderator ban/mute kill switch. Hidden from moderators. */}
      {isAdmin && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            paddingVertical: 10,
            marginHorizontal: SPACE.lg,
            // Had marginTop but NO marginBottom, so the next control in
            // every tab was drawn flush against its bottom edge.
            marginBottom: SPACE.md,
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderColor: modControlsEnabled ? C.border : tint(HUE.warn, '55'),
            backgroundColor: modControlsEnabled ? C.surface : tint(HUE.warn, '12'),
          }}
        >
          {/* An OFF state is a live restriction on the whole mod team, so
              it is tinted rather than left looking like an idle row. */}
          <Ionicons
            name={modControlsEnabled ? 'shield-checkmark' : 'shield-outline'}
            size={18}
            color={modControlsEnabled ? HUE.success : HUE.warn}
            style={{ marginRight: 10 }}
          />
          <View style={{ flex: 1, paddingRight: SPACE.md }}>
            <Text style={{ fontSize: 13.5, fontWeight: '600', color: C.text }}>
              Moderator ban &amp; mute
            </Text>
            <Text style={{ fontSize: 11.5, marginTop: 1, color: C.textMuted }}>
              {modControlsEnabled
                ? 'Moderators can ban & mute'
                : 'Disabled for moderators — admins unaffected'}
            </Text>
          </View>
          <Switch
            value={modControlsEnabled}
            onValueChange={handleToggleModControls}
            trackColor={{ false: '#767577', true: HUE.success }}
            thumbColor="#FFF"
          />
        </View>
      )}

      {activeTab === 'search' && (
        <View style={styles.searchContainer}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by display name..."
            placeholderTextColor={C.textFaint}
            style={[styles.searchInput, { backgroundColor: C.surface, color: C.text }]}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
          />
          <TouchableOpacity onPress={handleSearch} style={styles.searchBtn}>
            <Ionicons name="search" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      )}

      {/* Content */}
      {activeTab === 'banned' ? (
        <View style={{ flex: 1 }}>
          <View style={styles.searchContainer}>
            <TextInput
              value={bannedSearchQuery}
              onChangeText={setBannedSearchQuery}
              placeholder="Search by email prefix..."
              placeholderTextColor={C.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.searchInput, { backgroundColor: C.fieldBg, color: C.text, borderColor: C.border }]}
            />
            <View style={styles.searchBtn}>
              <Ionicons name="search" size={20} color="#FFF" />
            </View>
          </View>

          {/* Section label — clarifies that the list is bounded */}
          <View style={{ paddingHorizontal: 16, marginBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              {/* "Active restrictions", not "bans" — the list now includes
                  live mutes, which it used to drop on the floor. */}
              {isSearching
                ? `Search results · ${allBannedUsers.length}`
                : `Active restrictions · ${allBannedUsers.length}${bansHasMore ? '+' : ''}`}
            </Text>
            {loadingBanned && (
              <ActivityIndicator size="small" color="#007AFF" />
            )}
          </View>

          {/* Restriction filter pills. Horizontally scrollable — five pills
              no longer fit a phone width in a fixed row. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0, marginBottom: 10 }}
            contentContainerStyle={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8 }}
          >
            {[
              { key: 'all', label: 'All' },
              { key: 'mute', label: 'Muted' },
              { key: '1', label: 'Strike 1' },
              { key: '2', label: 'Strike 2' },
              { key: '3+', label: 'Permanent' },
            ].map((f) => {
              const isActive = strikeFilter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  onPress={() => setStrikeFilter(f.key)}
                  style={{
                    paddingHorizontal: 13, paddingVertical: 6, borderRadius: RADIUS.pill,
                    backgroundColor: isActive ? HUE.accent : C.surface,
                    borderWidth: 1, borderColor: isActive ? HUE.accent : C.border,
                  }}
                >
                  <Text style={{
                    fontSize: 12, fontWeight: '600',
                    color: isActive ? '#FFF' : C.textMuted,
                  }}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {loadingBanned && !refreshing && allBannedUsers.length === 0 ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={filteredBannedUsers}
              keyExtractor={(item) => item.encodedEmail}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.text} />}
              contentContainerStyle={[styles.listContent, { paddingBottom: 80 + insets.bottom }]}
              renderItem={renderItem}
              onEndReachedThreshold={0.4}
              onEndReached={() => {
                // Paging applies to the default roster only; a search is
                // already a bounded 50-result query.
                if (!isSearching && bansHasMore && !loadingBanned && !loadingMoreBans) {
                  fetchRecentBans(false);
                }
              }}
              ListFooterComponent={
                isSearching ? null : loadingMoreBans ? (
                  <ActivityIndicator size="small" color={HUE.accent} style={{ marginVertical: SPACE.lg }} />
                ) : !bansHasMore && allBannedUsers.length > 0 ? (
                  <Text style={{ color: C.textFaint, fontSize: 11.5, textAlign: 'center', paddingVertical: SPACE.lg }}>
                    End of list — {allBannedUsers.length} active restriction{allBannedUsers.length !== 1 ? 's' : ''}
                  </Text>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="shield-checkmark-outline" size={48} color={C.textFaint} />
                  <Text style={[styles.emptyText, { color: C.textFaint }]}>
                    {isSearching
                      ? 'No matching restrictions for that email prefix'
                      : strikeFilter !== 'all'
                        ? 'Nothing matches that filter in the current slice'
                        : 'No active restrictions'}
                  </Text>
                </View>
              }
            />
          )}
        </View>
      ) : activeTab === 'search' ? (
        <View style={{ flex: 1 }}>
          {loadingSearch ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item, index) => item.id || item.email || `search-${index}`}
              contentContainerStyle={[styles.listContent, { paddingBottom: 80 + insets.bottom }]}
              renderItem={renderItem}
              ListEmptyComponent={
                hasSearched ? (
                  <View style={styles.emptyState}>
                    <Text style={[styles.emptyText, { color: C.textFaint }]}>No users found.</Text>
                  </View>
                ) : (
                  <View style={styles.emptyState}>
                    <Ionicons name="search-outline" size={48} color={C.textFaint} />
                    <Text style={[styles.emptyText, { color: C.textFaint }]}>Enter name to search database</Text>
                  </View>
                )
              }
            />
          )}
        </View>
      ) : activeTab === 'modLog' ? (
        <View style={{ flex: 1 }}>
          {/* Leaderboard vs raw feed */}
          {/* Segmented control — a single track with an inset selected
              segment, rather than two free-floating buttons that read as
              two unrelated actions. */}
          <View style={{
            flexDirection: 'row', marginHorizontal: SPACE.lg, marginBottom: SPACE.md,
            padding: 3, borderRadius: RADIUS.md,
            backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
          }}>
            {[
              { key: 'leaderboard', label: 'By moderator' },
              { key: 'feed', label: 'Recent actions' },
            ].map((v) => {
              const on = modLogView === v.key;
              return (
                <TouchableOpacity
                  key={v.key}
                  onPress={() => setModLogView(v.key)}
                  style={{
                    flex: 1, paddingVertical: 8, borderRadius: RADIUS.sm, alignItems: 'center',
                    backgroundColor: on ? C.surface : 'transparent',
                    borderWidth: 1, borderColor: on ? C.border : 'transparent',
                  }}
                >
                  <Text style={{
                    fontSize: 13, fontWeight: '700',
                    color: on ? C.text : C.textMuted,
                  }}>{v.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Time window. Bounded by design — every rpc scans by
              created_at, so a window is what keeps the query cheap. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, flexShrink: 0, marginBottom: 10 }}
            contentContainerStyle={{ flexDirection: 'row', paddingHorizontal: 16, gap: 8 }}
          >
            {[{ d: 7, l: '7 days' }, { d: 30, l: '30 days' }, { d: 90, l: '90 days' }].map((w) => (
              <TouchableOpacity
                key={w.d}
                onPress={() => setModLogDays(w.d)}
                style={{
                  paddingHorizontal: 13, paddingVertical: 6, borderRadius: RADIUS.pill,
                  backgroundColor: modLogDays === w.d ? HUE.accent : C.surface,
                  borderWidth: 1, borderColor: modLogDays === w.d ? HUE.accent : C.border,
                }}
              >
                <Text style={{
                  fontSize: 12, fontWeight: '600',
                  color: modLogDays === w.d ? '#FFF' : C.textMuted,
                }}>{w.l}</Text>
              </TouchableOpacity>
            ))}

            {modLogView === 'feed' && [
              { k: null, l: 'All' },
              { k: 'ban', l: 'Bans' },
              { k: 'strike', l: 'Strikes' },
              { k: 'mute', l: 'Mutes' },
              { k: 'unban', l: 'Unbans' },
            ].map((f) => (
              <TouchableOpacity
                key={f.k || 'all'}
                onPress={() => setFeedActionFilter(f.k)}
                style={{
                  paddingHorizontal: 13, paddingVertical: 6, borderRadius: RADIUS.pill,
                  backgroundColor: feedActionFilter === f.k ? HUE.mute : C.surface,
                  borderWidth: 1, borderColor: feedActionFilter === f.k ? HUE.mute : C.border,
                }}
              >
                <Text style={{
                  fontSize: 12, fontWeight: '600',
                  color: feedActionFilter === f.k ? '#FFF' : C.textMuted,
                }}>{f.l}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Active actor filter, set by tapping a leaderboard row. */}
          {modLogView === 'feed' && feedActorFilter && (
            <TouchableOpacity
              onPress={() => setFeedActorFilter(null)}
              style={{
                flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 10,
                paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                backgroundColor: C.surface,
              }}
            >
              <Ionicons name="person" size={14} color="#007AFF" style={{ marginRight: 6 }} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: C.text, flex: 1 }} numberOfLines={1}>
                Only actions by {feedActorFilter.name}
              </Text>
              <Ionicons name="close-circle" size={18} color={C.textFaint} />
            </TouchableOpacity>
          )}

          {modLogView === 'leaderboard' ? (
            leaderboardLoading && leaderboard.length === 0 ? (
              <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={leaderboard}
                keyExtractor={(item) => item.actorUid}
                contentContainerStyle={[styles.listContent, { paddingBottom: 80 + insets.bottom }]}
                refreshControl={
                  <RefreshControl refreshing={leaderboardLoading} onRefresh={loadLeaderboard} tintColor={C.text} />
                }
                ListEmptyComponent={
                  modLogSchemaMissing ? (
                    <View style={{ paddingTop: SPACE.sm }}><SetupNotice /></View>
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons name="shield-outline" size={44} color={C.textFaint} />
                      <Text style={[styles.emptyText, { color: C.textFaint }]}>
                        No moderation actions in this window
                      </Text>
                    </View>
                  )
                }
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => {
                      setFeedActorFilter({ uid: item.actorUid, name: item.actorName });
                      setFeedActionFilter(null);
                      setModLogView('feed');
                    }}
                    style={[
                      styles.card,
                      { backgroundColor: C.surface, borderColor: C.border, alignItems: 'flex-start' },
                    ]}
                  >
                    <View style={{
                      width: 30, height: 30, borderRadius: 15, marginTop: 2,
                      justifyContent: 'center', alignItems: 'center',
                      backgroundColor: index === 0 ? '#FFD70030' : (C.border),
                    }}>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: index === 0 ? '#B8860B' : (C.textMuted) }}>
                        {index + 1}
                      </Text>
                    </View>

                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[styles.name, { color: C.text, flexShrink: 1 }]} numberOfLines={1}>
                          {item.actorName}
                        </Text>
                        {item.actorRole && (
                          <View style={{
                            marginLeft: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5,
                            backgroundColor: item.actorRole === 'admin' ? '#FF3B3020' : '#007AFF20',
                          }}>
                            <Text style={{
                              fontSize: 9, fontWeight: '700',
                              color: item.actorRole === 'admin' ? HUE.danger : HUE.accent,
                            }}>
                              {item.actorRole.replace('_', ' ').toUpperCase()}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Raw action count AND distinct people touched.
                          Ten mutes on one repeat offender is not ten
                          people moderated, and ranking on the raw number
                          alone would flatter whoever spams short mutes. */}
                      <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 3 }}>
                        {item.totalCount} action{item.totalCount !== 1 ? 's' : ''} · {item.distinctTargets} user{item.distinctTargets !== 1 ? 's' : ''}
                        {item.lastActionAt ? ` · last ${timeAgo(item.lastActionAt)}` : ''}
                      </Text>

                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {[
                          { l: 'ban', n: item.banCount },
                          { l: 'strike', n: item.strikeCount },
                          { l: 'mute', n: item.muteCount },
                          { l: 'unban', n: item.unbanCount },
                        ].filter((x) => x.n > 0).map((x) => (
                          <View key={x.l} style={{
                            flexDirection: 'row', alignItems: 'center',
                            paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                            backgroundColor: `${ACTION_META[x.l].color}18`,
                          }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: ACTION_META[x.l].color }}>
                              {x.n} {x.n === 1 ? ACTION_META[x.l].noun.replace(/s$/, '') : ACTION_META[x.l].noun}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    <Ionicons name="chevron-forward" size={18} color={C.textFaint} style={{ marginTop: 6 }} />
                  </TouchableOpacity>
                )}
              />
            )
          ) : (
            feedLoading && feedItems.length === 0 ? (
              <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
            ) : (
              <FlatList
                data={feedItems}
                keyExtractor={(item) => item.id}
                contentContainerStyle={[styles.listContent, { paddingBottom: 80 + insets.bottom }]}
                refreshControl={
                  <RefreshControl refreshing={feedLoading} onRefresh={() => loadFeed(true)} tintColor={C.text} />
                }
                onEndReachedThreshold={0.5}
                onEndReached={() => { if (feedHasMore && !feedLoading) loadFeed(false); }}
                ListFooterComponent={
                  feedLoading && feedItems.length > 0
                    ? <ActivityIndicator size="small" color="#007AFF" style={{ marginVertical: 16 }} />
                    : null
                }
                ListEmptyComponent={
                  modLogSchemaMissing ? (
                    <View style={{ paddingTop: SPACE.sm }}><SetupNotice /></View>
                  ) : (
                    <View style={styles.emptyState}>
                      <Ionicons name="document-text-outline" size={44} color={C.textFaint} />
                      <Text style={[styles.emptyText, { color: C.textFaint }]}>
                        No actions match these filters
                      </Text>
                    </View>
                  )
                }
                renderItem={({ item }) => {
                  const meta = ACTION_META[item.action] || { label: item.action, icon: 'ellipse', color: '#888' };
                  return (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      // Tapping an entry opens the target's profile, where
                      // their full history lives.
                      onPress={() => handleSelectUser({
                        id: item.targetUid,
                        email: item.targetEmail,
                        displayName: item.targetName || item.targetEmail,
                      })}
                      style={[
                        styles.card,
                        {
                          backgroundColor: C.surface,
                          borderColor: C.border,
                          alignItems: 'flex-start',
                          borderLeftWidth: 3, borderLeftColor: meta.color,
                        },
                      ]}
                    >
                      <Ionicons name={meta.icon} size={20} color={meta.color} style={{ marginTop: 3 }} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: meta.color }}>
                          {meta.label}
                          {item.action === 'mute' && item.durationMinutes ? ` · ${item.durationMinutes} min` : ''}
                          {item.action === 'strike' && item.strikeCount ? ` ${item.strikeCount}` : ''}
                          {item.isPermanent ? ' · permanent' : ''}
                        </Text>
                        <Text style={[styles.name, { color: C.text, fontSize: 14, marginTop: 2 }]} numberOfLines={1}>
                          {item.targetName || item.targetEmail}
                        </Text>
                        <Text style={{ fontSize: 12, color: C.text, marginTop: 4 }}>
                          {item.reason || 'No reason recorded'}
                        </Text>
                        <Text style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                          By {item.actorName || 'Unknown'}
                          {item.actorRole ? ` (${item.actorRole.replace('_', ' ')})` : ''}
                          {' · '}{SOURCE_LABEL[item.source] || item.source}
                          {item.createdAt ? ` · ${timeAgo(item.createdAt)}` : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )
          )}
        </View>
      ) : activeTab === 'chatViewer' ? (
        <View style={{ flex: 1 }}>
          {/* Person Selectors */}
          <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>

            {/* Person 1 */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Person 1</Text>
              {chatPerson1 ? (
                <View style={[styles.selectedPersonCard, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <Image source={{ uri: chatPerson1.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#DDD' }} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: C.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{chatPerson1.displayName}</Text>
                    <Text style={{ color: C.textFaint, fontSize: 11 }} numberOfLines={1}>{chatPerson1.email || chatPerson1.id}</Text>
                  </View>
                  <TouchableOpacity onPress={() => { setChatPerson1(null); setChatSearch1(''); setChatResults1([]); setChatMessages([]); }} style={{ padding: 4 }}>
                    <Ionicons name="close-circle" size={22} color={C.textFaint} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <View style={styles.searchContainer}>
                    <TextInput
                      value={chatSearch1}
                      onChangeText={setChatSearch1}
                      placeholder="Search user..."
                      placeholderTextColor={C.textFaint}
                      style={[styles.searchInput, { backgroundColor: C.fieldBg, color: C.text, borderColor: C.border }]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      onSubmitEditing={() => searchChatUser(chatSearch1, 1)}
                    />
                    {chatSearching1 ? (
                      <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 8 }} />
                    ) : (
                      <TouchableOpacity style={[styles.searchBtn, { backgroundColor: HUE.mute }]} onPress={() => searchChatUser(chatSearch1, 1)}>
                        <Ionicons name="person-outline" size={18} color="#FFF" />
                      </TouchableOpacity>
                    )}
                  </View>
                  {chatResults1.length > 0 && (
                    <View style={[styles.chatDropdown, { backgroundColor: C.surface, borderColor: C.border }]}>
                      {chatResults1.map((u) => (
                        <TouchableOpacity
                          key={u.id}
                          onPress={() => { setChatPerson1(u); setChatSearch1(''); setChatResults1([]); }}
                          style={[styles.chatDropdownItem, { borderBottomColor: C.border }]}
                        >
                          <Image source={{ uri: u.avatar }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#DDD' }} />
                          <View style={{ flex: 1, marginLeft: 8 }}>
                            <Text style={{ color: C.text, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{u.displayName}</Text>
                            <Text style={{ color: C.textFaint, fontSize: 11 }} numberOfLines={1}>{u.email || u.id}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Person 2 */}
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Person 2</Text>
              {chatPerson2 ? (
                <View style={[styles.selectedPersonCard, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <Image source={{ uri: chatPerson2.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#DDD' }} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={{ color: C.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{chatPerson2.displayName}</Text>
                    <Text style={{ color: C.textFaint, fontSize: 11 }} numberOfLines={1}>{chatPerson2.email || chatPerson2.id}</Text>
                  </View>
                  <TouchableOpacity onPress={() => { setChatPerson2(null); setChatSearch2(''); setChatResults2([]); setChatMessages([]); }} style={{ padding: 4 }}>
                    <Ionicons name="close-circle" size={22} color={C.textFaint} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <View style={styles.searchContainer}>
                    <TextInput
                      value={chatSearch2}
                      onChangeText={setChatSearch2}
                      placeholder="Search user..."
                      placeholderTextColor={C.textFaint}
                      style={[styles.searchInput, { backgroundColor: C.fieldBg, color: C.text, borderColor: C.border }]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="search"
                      onSubmitEditing={() => searchChatUser(chatSearch2, 2)}
                    />
                    {chatSearching2 ? (
                      <ActivityIndicator size="small" color="#007AFF" style={{ marginLeft: 8 }} />
                    ) : (
                      <TouchableOpacity style={[styles.searchBtn, { backgroundColor: '#AF52DE' }]} onPress={() => searchChatUser(chatSearch2, 2)}>
                        <Ionicons name="person-outline" size={18} color="#FFF" />
                      </TouchableOpacity>
                    )}
                  </View>
                  {chatResults2.length > 0 && (
                    <View style={[styles.chatDropdown, { backgroundColor: C.surface, borderColor: C.border }]}>
                      {chatResults2.map((u) => (
                        <TouchableOpacity
                          key={u.id}
                          onPress={() => { setChatPerson2(u); setChatSearch2(''); setChatResults2([]); }}
                          style={[styles.chatDropdownItem, { borderBottomColor: C.border }]}
                        >
                          <Image source={{ uri: u.avatar }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#DDD' }} />
                          <View style={{ flex: 1, marginLeft: 8 }}>
                            <Text style={{ color: C.text, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{u.displayName}</Text>
                            <Text style={{ color: C.textFaint, fontSize: 11 }} numberOfLines={1}>{u.email || u.id}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>

            {/* Load Chat Button */}
            {chatPerson1 && chatPerson2 && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: HUE.accent, height: 46, borderRadius: 14, marginBottom: 0 }]}
                onPress={() => loadChat(true)}
              >
                <Ionicons name="chatbubbles" size={18} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={[styles.buttonText, { fontSize: 15 }]}>View Conversation</Text>
              </TouchableOpacity>
            )}

            {/* Delete Conversation — admin + owner UID only */}
            {chatPerson1 && chatPerson2 && isAdmin && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: '#dc262618', borderWidth: 1, borderColor: '#dc262640', height: 42, borderRadius: 12, marginTop: 8, marginBottom: 0 }]}
                onPress={deletePrivateChat}
                disabled={loadingChat}
              >
                <Ionicons name="trash-outline" size={16} color="#dc2626" style={{ marginRight: 8 }} />
                <Text style={[styles.buttonText, { fontSize: 14, color: '#dc2626', fontWeight: '700' }]}>Delete Conversation</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Chat Messages */}
          {loadingChat ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={chatMessages}
              keyExtractor={(item) => String(item.id)}
              contentContainerStyle={[styles.listContent, { paddingTop: 4, paddingBottom: 80 + insets.bottom }]}
              // Messages are oldest-first, so "older" is at the TOP — the
              // control to fetch more belongs in the header, not the footer.
              ListHeaderComponent={
                chatMessages.length === 0 ? null : chatHasOlder ? (
                  <TouchableOpacity
                    onPress={() => loadChat(false)}
                    disabled={chatOlderLoading}
                    style={{
                      paddingVertical: 10, marginBottom: 8, borderRadius: 10, alignItems: 'center',
                      backgroundColor: C.surface,
                    }}
                  >
                    {chatOlderLoading
                      ? <ActivityIndicator size="small" color="#007AFF" />
                      : <Text style={{ color: HUE.accent, fontWeight: '600', fontSize: 13 }}>Load older messages</Text>}
                  </TouchableOpacity>
                ) : (
                  <Text style={{ color: C.textFaint, fontSize: 11, textAlign: 'center', marginBottom: 8 }}>
                    Beginning of conversation
                  </Text>
                )
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons
                    name={chatError ? 'alert-circle-outline' : 'chatbubbles-outline'}
                    size={48}
                    color={chatError ? HUE.danger : (C.textFaint)}
                  />
                  {/* An error is not an empty conversation. Saying "no
                      messages found" after a failed read told admins the two
                      users had never spoken. */}
                  <Text style={[styles.emptyText, { color: chatError ? HUE.danger : (C.textFaint), textAlign: 'center' }]}>
                    {chatError
                      ? chatError
                      : chatPerson1 && chatPerson2
                        ? 'No messages found between these users'
                        : 'Search and select two users to view their chat'}
                  </Text>
                  {chatError && (
                    <TouchableOpacity onPress={() => loadChat(true)} style={{ marginTop: 14 }}>
                      <Text style={{ color: HUE.accent, fontWeight: '700' }}>Retry</Text>
                    </TouchableOpacity>
                  )}
                </View>
              }
              renderItem={({ item }) => {
                const isPerson1 = item.senderId === chatPerson1?.id;
                const senderName = isPerson1 ? chatPerson1?.displayName : chatPerson2?.displayName;
                const time = item.timestamp ? new Date(item.timestamp).toLocaleString() : '';
                return (
                  <View style={[styles.chatBubble, {
                    backgroundColor: isPerson1 ? (isDark ? '#0A3D62' : '#DCF8C6') : (C.surface),
                    alignSelf: isPerson1 ? 'flex-end' : 'flex-start',
                    borderColor: isPerson1 ? (isDark ? '#1A5276' : '#B8E6A0') : (C.border),
                  }]}>
                    <Text style={{ color: isPerson1 ? '#5DADE2' : '#AF52DE', fontSize: 11, fontWeight: '700', marginBottom: 3 }}>
                      {senderName || item.senderId || 'Unknown'}
                      {item.deleted ? <Text style={{ color: '#dc2626', fontWeight: '700' }}>  · deleted by user</Text> : null}
                      {item.legacy ? <Text style={{ color: C.textFaint, fontWeight: '600' }}>  · legacy</Text> : null}
                    </Text>
                    {/* Quoted message. Present on replies and previously
                        not rendered at all, which made half of every
                        argument in a reported chat impossible to follow. */}
                    {item.replyTo ? (
                      <View style={{
                        borderLeftWidth: 2, borderLeftColor: C.textFaint,
                        paddingLeft: 8, marginBottom: 6, opacity: 0.8,
                      }}>
                        <Text style={{ color: C.textMuted, fontSize: 11 }} numberOfLines={2}>
                          ↩ {typeof item.replyTo === 'string'
                              ? item.replyTo
                              : (item.replyTo?.text || item.replyTo?.message || 'Replied to a message')}
                        </Text>
                      </View>
                    ) : null}

                    {item.text ? (
                      <Text style={{ color: C.text, fontSize: 14, lineHeight: 20 }}>{item.text}</Text>
                    ) : null}

                    {/* imageUrl is the single-image field; imageUrls is the
                        multi-image one. Only the first was rendered, so a
                        message carrying a gallery — often exactly what gets
                        reported — showed up as an empty bubble. */}
                    {(() => {
                      const urls = [
                        ...(item.imageUrl ? [item.imageUrl] : []),
                        ...(Array.isArray(item.imageUrls) ? item.imageUrls : []),
                      ].filter((u, i, arr) => u && arr.indexOf(u) === i);
                      if (urls.length === 0) return null;
                      return (
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                          {urls.map((url) => (
                            <TouchableOpacity key={url} activeOpacity={0.85} onPress={() => setPreviewImage(url)}>
                              <Image
                                source={{ uri: url }}
                                style={{
                                  width: urls.length > 1 ? 96 : 200,
                                  height: urls.length > 1 ? 96 : 200,
                                  borderRadius: 8,
                                  backgroundColor: C.surfaceAlt,
                                }}
                                resizeMode="cover"
                              />
                            </TouchableOpacity>
                          ))}
                        </View>
                      );
                    })()}
                    {item.fruits && item.fruits.length > 0 ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                        <Ionicons name="paw-outline" size={14} color="#FF9500" />
                        <Text style={{ color: HUE.warn, fontSize: 12, marginLeft: 4 }}>{item.fruits.length} pet(s)</Text>
                      </View>
                    ) : null}
                    <Text style={{ color: C.textFaint, fontSize: 10, marginTop: 4, textAlign: 'right' }}>
                      {time}
                    </Text>
                  </View>
                );
              }}
            />
          )}
        </View>
      ) : activeTab === 'userChats' && isAdmin ? (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Target User</Text>
            {userChatsTarget ? (
              <View style={[styles.selectedPersonCard, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Image source={{ uri: userChatsTarget.avatar }} style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#DDD' }} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ color: C.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{userChatsTarget.displayName}</Text>
                  <Text style={{ color: C.textFaint, fontSize: 11 }} numberOfLines={1}>{userChatsTarget.email || userChatsTarget.id}</Text>
                </View>
                <TouchableOpacity onPress={clearUserChatsTarget} style={{ padding: 4 }}>
                  <Ionicons name="close-circle" size={22} color={C.textFaint} />
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.searchContainer}>
                <TextInput
                  value={userChatsInput}
                  onChangeText={setUserChatsInput}
                  placeholder="Name, email or user ID..."
                  placeholderTextColor={C.textFaint}
                  style={[styles.searchInput, { backgroundColor: C.fieldBg, color: C.text, borderColor: C.border }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={loadUserChatsForInput}
                />
                <TouchableOpacity style={[styles.searchBtn, { backgroundColor: HUE.success }]} onPress={loadUserChatsForInput}>
                  <Ionicons name="search" size={20} color="#FFF" />
                </TouchableOpacity>
              </View>
            )}

            {/* Disambiguation picker — shown only when a name matched
                several people. */}
            {userChatsResults.length > 0 && (
              <View style={[styles.chatDropdown, { backgroundColor: C.surface, borderColor: C.border }]}>
                {userChatsResults.map((u) => (
                  <TouchableOpacity
                    key={u.id}
                    onPress={() => selectUserChatsTarget(u)}
                    style={[styles.chatDropdownItem, { borderBottomColor: C.border }]}
                  >
                    <Image source={{ uri: u.avatar }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#DDD' }} />
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      <Text style={{ color: C.text, fontSize: 14, fontWeight: '500' }} numberOfLines={1}>{u.displayName}</Text>
                      <Text style={{ color: C.textFaint, fontSize: 11 }} numberOfLines={1}>{u.email || u.id}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {userChatsLoading && userChatsList.length === 0 ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={userChatsList}
              keyExtractor={(item) => item.partnerId}
              contentContainerStyle={[styles.listContent, { paddingBottom: 80 + insets.bottom }]}
              onEndReachedThreshold={0.3}
              onEndReached={() => {
                if (userChatsTarget && userChatsHasMore && !userChatsLoadingMore && !userChatsLoading) {
                  fetchUserChats(userChatsTarget, false);
                }
              }}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="chatbubbles-outline" size={48} color={C.textFaint} />
                  <Text style={[styles.emptyText, { color: C.textFaint }]}>
                    {userChatsTarget ? 'No private chats for this user' : 'Search a name, email or user ID to view all their private chats'}
                  </Text>
                </View>
              }
              ListFooterComponent={
                userChatsLoadingMore ? (
                  <ActivityIndicator size="small" color="#007AFF" style={{ marginVertical: 12 }} />
                ) : null
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => openChatFromUserChats(item)}
                  style={[styles.card, { backgroundColor: C.surface, borderColor: C.border }]}
                >
                  <Image source={{ uri: item.partnerAvatar }} style={styles.avatar} />
                  <View style={styles.cardContent}>
                    <Text style={[styles.name, { color: C.text }]} numberOfLines={1}>
                      {item.partnerName}
                    </Text>
                    <Text style={[styles.email, { color: C.textMuted }]} numberOfLines={1}>
                      {item.lastMessage || '—'}
                    </Text>
                    <Text style={{ color: C.textFaint, fontSize: 11, marginTop: 2 }}>
                      {item.timestamp ? timeAgo(item.timestamp) : ''}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={C.textFaint} />
                </TouchableOpacity>
              )}
            />
          )}
        </View>
      ) : activeTab === 'polls' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          {/* Create Poll Form */}
          <View style={[styles.pollFormCard, { backgroundColor: C.surface, borderColor: C.border }]}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', marginBottom: 12 }}>Create New Poll</Text>

            <TextInput
              value={pollQuestion}
              onChangeText={setPollQuestion}
              placeholder="Poll question..."
              placeholderTextColor={C.textFaint}
              style={[styles.pollInput, { backgroundColor: C.border, color: C.text }]}
              multiline
            />

            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Options</Text>
            {pollOptions.map((opt, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <TextInput
                  value={opt}
                  onChangeText={(text) => {
                    const updated = [...pollOptions];
                    updated[i] = text;
                    setPollOptions(updated);
                  }}
                  placeholder={`Option ${i + 1}`}
                  placeholderTextColor={C.textFaint}
                  style={[styles.pollInput, { flex: 1, backgroundColor: C.border, color: C.text }]}
                />
                {pollOptions.length > 2 && (
                  <TouchableOpacity
                    onPress={() => setPollOptions(pollOptions.filter((_, ix) => ix !== i))}
                    style={{ padding: 6, marginLeft: 4 }}
                  >
                    <Ionicons name="close-circle" size={20} color="#FF3B30" />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {pollOptions.length < 6 && (
              <TouchableOpacity
                onPress={() => setPollOptions([...pollOptions, ''])}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
              >
                <Ionicons name="add-circle" size={20} color="#007AFF" />
                <Text style={{ color: HUE.accent, marginLeft: 6, fontSize: 13, fontWeight: '500' }}>Add Option</Text>
              </TouchableOpacity>
            )}

            <Text style={{ color: C.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 6, marginTop: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Image (optional)</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
              <TextInput
                value={pollImageUrl}
                onChangeText={setPollImageUrl}
                placeholder="Paste URL or upload below"
                placeholderTextColor={C.textFaint}
                style={[styles.pollInput, { flex: 1, backgroundColor: C.border, color: C.text, marginBottom: 0 }]}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {pollImageUrl ? (
                <TouchableOpacity onPress={() => setPollImageUrl('')} style={{ padding: 6, marginLeft: 4 }}>
                  <Ionicons name="close-circle" size={20} color="#FF3B30" />
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={handlePickPollImage}
              disabled={uploadingPollImage}
              style={[styles.actionButton, { backgroundColor: HUE.accent, height: 38, borderRadius: 10, marginBottom: 6 }]}
            >
              {uploadingPollImage ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="cloud-upload-outline" size={16} color="#FFF" style={{ marginRight: 6 }} />
                  <Text style={[styles.buttonText, { fontSize: 13 }]}>Upload from Gallery</Text>
                </>
              )}
            </TouchableOpacity>
            {pollImageUrl ? (
              <Image source={{ uri: pollImageUrl }} style={{ width: '100%', height: 120, borderRadius: 10, marginBottom: 6, backgroundColor: '#DDD' }} resizeMode="cover" />
            ) : null}

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: HUE.mute, marginTop: 12, height: 46, borderRadius: 14 }]}
              onPress={handleCreatePoll}
              disabled={creatingPoll}
            >
              {creatingPoll ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Ionicons name="add-circle" size={18} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={[styles.buttonText, { fontSize: 15 }]}>Create Poll</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Existing Polls */}
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', marginTop: 20, marginBottom: 12 }}>Existing Polls</Text>

          {loadingPolls ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
          ) : polls.length === 0 ? (
            <Text style={{ color: C.textFaint, textAlign: 'center', paddingVertical: 20 }}>No polls created yet</Text>
          ) : (
            polls.map((p) => (
              <View key={p.id} style={[styles.pollListCard, { backgroundColor: C.surface, borderColor: C.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <View style={[styles.pollStatusBadge, { backgroundColor: p.active ? '#34C75920' : '#FF3B3020' }]}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.active ? HUE.success : HUE.danger, marginRight: 4 }} />
                    <Text style={{ color: p.active ? HUE.success : HUE.danger, fontSize: 10, fontWeight: '700' }}>{p.active ? 'ACTIVE' : 'INACTIVE'}</Text>
                  </View>
                  <Text style={{ color: C.textFaint, fontSize: 11, marginLeft: 'auto' }}>
                    {p.totalVotes || 0} votes
                  </Text>
                </View>
                <Text style={{ color: C.text, fontSize: 15, fontWeight: '600', marginBottom: 4 }} numberOfLines={2}>{p.question}</Text>
                <Text style={{ color: C.textFaint, fontSize: 12, marginBottom: 8 }}>
                  {(p.options || []).map((o) => o.text).join(' • ')}
                </Text>
                <View style={{ flexDirection: 'row' }}>
                  <TouchableOpacity
                    onPress={() => handleTogglePollActive(p)}
                    style={[styles.pollActionBtn, { backgroundColor: p.active ? '#FF950020' : '#34C75920' }]}
                  >
                    <Ionicons name={p.active ? 'pause-circle' : 'play-circle'} size={16} color={p.active ? HUE.warn : HUE.success} />
                    <Text style={{ color: p.active ? HUE.warn : HUE.success, fontSize: 12, fontWeight: '600', marginLeft: 4 }}>
                      {p.active ? 'Deactivate' : 'Activate'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDeletePoll(p.id)}
                    style={[styles.pollActionBtn, { backgroundColor: '#FF3B3020', marginLeft: 8 }]}
                  >
                    <Ionicons name="trash-outline" size={16} color="#FF3B30" />
                    <Text style={{ color: HUE.danger, fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      ) : activeTab === 'statusFeed' ? (
        <View style={{ flex: 1 }}>
          {statusLoading && statusList.length === 0 ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 40 }} />
          ) : (
            <FlatList
              data={statusList}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
              refreshControl={
                <RefreshControl
                  refreshing={statusLoading}
                  onRefresh={() => fetchStatusFeed(true)}
                  tintColor={C.text}
                />
              }
              onEndReached={() => fetchStatusFeed(false)}
              onEndReachedThreshold={0.4}
              ListEmptyComponent={
                <Text style={{ color: C.textMuted, textAlign: 'center', marginTop: 40 }}>
                  No statuses found.
                </Text>
              }
              ListFooterComponent={
                statusLoadingMore ? (
                  <ActivityIndicator size="small" color="#007AFF" style={{ marginVertical: 12 }} />
                ) : !statusHasMore && statusList.length > 0 ? (
                  <Text style={{ color: C.textFaint, textAlign: 'center', fontSize: 11, marginTop: 8 }}>
                    End of feed
                  </Text>
                ) : null
              }
              renderItem={({ item }) => {
                const created = timeAgo(item.createdAt);
                const viewers = Array.isArray(item.viewedBy) ? item.viewedBy.length : 0;
                return (
                  <View style={{
                    backgroundColor: C.surface,
                    borderRadius: 12,
                    padding: 12,
                    marginBottom: 10,
                    borderWidth: 1,
                    borderColor: C.border,
                  }}>
                    {/* Header: avatar + name + date */}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setStatusProfileUser({
                        senderId: item.userId,
                        id: item.userId,
                        sender: item.userName,
                        avatar: item.userAvatar,
                      })}
                      style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
                    >
                      <Image
                        source={{ uri: item.userAvatar || DEFAULT_AVATAR }}
                        style={{ width: 36, height: 36, borderRadius: 18, marginRight: 10 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.text, fontWeight: '600', fontSize: 14 }} numberOfLines={1}>
                          {item.userName || 'Unknown'}
                        </Text>
                        <Text style={{ color: C.textMuted, fontSize: 11 }}>
                          {created} {item.type || 'text'} {viewers} views
                        </Text>
                      </View>
                      <Ionicons name="person-circle-outline" size={20} color={C.textFaint} />
                    </TouchableOpacity>

                    {/* Caption */}
                    {!!item.caption && (
                      <Text style={{ color: C.text, fontSize: 13, marginBottom: 8 }} numberOfLines={4}>
                        {item.caption}
                      </Text>
                    )}

                    {/* Image */}
                    {!!item.imageUrl && (
                      <Image
                        source={{ uri: item.imageUrl }}
                        style={{ width: '100%', height: 160, borderRadius: 8, marginBottom: 8, backgroundColor: C.surfaceAlt }}
                        resizeMode="cover"
                      />
                    )}

                    {/* Poll preview */}
                    {Array.isArray(item.pollOptions) && item.pollOptions.length > 0 && (
                      <View style={{ marginBottom: 8 }}>
                        {item.pollOptions.map((opt, i) => (
                          <Text key={i} style={{ color: C.textMuted, fontSize: 12 }}>{opt}</Text>
                        ))}
                      </View>
                    )}

                    {/* Actions */}
                    <View style={{ flexDirection: 'row', marginTop: 4 }}>
                      <TouchableOpacity
                        onPress={() => handleAdminDeleteStatus(item.id)}
                        style={{
                          flexDirection: 'row', alignItems: 'center',
                          backgroundColor: '#FF3B3020',
                          paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                        }}
                      >
                        <Ionicons name="trash-outline" size={14} color="#FF3B30" />
                        <Text style={{ color: HUE.danger, fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Delete</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          Clipboard.setString(item.userId || '');
                          Alert.alert('Copied', 'User ID copied.');
                        }}
                        style={{
                          flexDirection: 'row', alignItems: 'center',
                          backgroundColor: C.border,
                          paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, marginLeft: 8,
                        }}
                      >
                        <Ionicons name="copy-outline" size={14} color={C.textMuted} />
                        <Text style={{ color: C.textMuted, fontSize: 12, fontWeight: '600', marginLeft: 4 }}>Copy ID</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }}
            />
          )}
        </View>
      ) : activeTab === 'jmdAccess' && isAdmin ? (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
            <Text style={{ fontSize: 12, color: C.textMuted, lineHeight: 17 }}>
              Anyone listed here can make and remove Junior Mods from a user's profile.
              It grants no other staff power, and you can revoke it at any time.
            </Text>
          </View>

          <View style={styles.searchContainer}>
            <TextInput
              value={jmdSearchQuery}
              onChangeText={setJmdSearchQuery}
              placeholder="Search by display name or paste a user ID..."
              placeholderTextColor={C.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.searchInput, { backgroundColor: C.fieldBg, color: C.text, borderColor: C.border }]}
              returnKeyType="search"
              onSubmitEditing={() => searchJmdUser(jmdSearchQuery)}
            />
            <TouchableOpacity onPress={() => searchJmdUser(jmdSearchQuery)} style={styles.searchBtn}>
              <Ionicons name="search" size={20} color="#FFF" />
            </TouchableOpacity>
          </View>

          {jmdSearching && <ActivityIndicator size="small" color="#007AFF" style={{ marginBottom: 8 }} />}

          {jmdSearchResults.length > 0 && (
            <View style={{ paddingHorizontal: 12, marginBottom: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>
                Search results
              </Text>
              {jmdSearchResults.map((u) => {
                const alreadyGranted = jmdGranters.some((g) => g.id === u.id);
                return (
                  <View
                    key={u.id}
                    style={[styles.card, { backgroundColor: C.surface, borderColor: C.border }]}
                  >
                    <Image source={{ uri: getAvatarSafe(u) }} style={styles.avatar} />
                    <View style={styles.cardContent}>
                      <Text style={[styles.name, { color: C.text }]} numberOfLines={1}>
                        {u.displayName}
                      </Text>
                      <Text style={[styles.email, { color: C.textMuted }]} numberOfLines={1}>
                        {u.isAdmin ? 'Admin' : u.isModerator ? 'Moderator' : 'Member'} · {u.id}
                      </Text>
                    </View>
                    <TouchableOpacity
                      disabled={alreadyGranted || jmdSaving === u.id}
                      onPress={() => handleGrantJmdAccess(u)}
                      style={{
                        paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
                        backgroundColor: alreadyGranted ? (C.border) : HUE.accent,
                        opacity: jmdSaving === u.id ? 0.5 : 1,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: alreadyGranted ? (C.textMuted) : '#FFF' }}>
                        {alreadyGranted ? 'Granted' : 'Grant'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}

          <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Allowed to make Junior Mods · {jmdGranters.length}
            </Text>
          </View>

          {jmdGrantersLoading && jmdGranters.length === 0 ? (
            <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 24 }} />
          ) : (
            <FlatList
              data={jmdGranters}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40 }}
              refreshControl={
                <RefreshControl
                  refreshing={jmdGrantersLoading}
                  onRefresh={fetchJmdGranters}
                  tintColor={C.text}
                />
              }
              ListEmptyComponent={
                <Text style={{ color: C.textMuted, textAlign: 'center', marginTop: 32, fontSize: 13 }}>
                  Nobody has this permission yet.{'\n'}Search a user above to grant it.
                </Text>
              }
              renderItem={({ item }) => (
                <View style={[styles.card, { backgroundColor: C.surface, borderColor: C.border }]}>
                  <Image source={{ uri: getAvatarSafe(item) }} style={styles.avatar} />
                  <View style={styles.cardContent}>
                    <Text style={[styles.name, { color: C.text }]} numberOfLines={1}>
                      {item.displayName}
                    </Text>
                    <Text style={[styles.email, { color: C.textMuted }]} numberOfLines={1}>
                      {item.grantedAt ? `Granted ${timeAgo(item.grantedAt)}` : 'Granted'}
                      {item.grantedByName ? ` by ${item.grantedByName}` : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    disabled={jmdSaving === item.id}
                    onPress={() => handleRevokeJmdAccess(item)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8,
                      backgroundColor: '#FF3B3015', borderWidth: 1, borderColor: '#FF3B3040',
                      opacity: jmdSaving === item.id ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: HUE.danger }}>Revoke</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          )}
        </View>
      ) : null}

      {/* Modal */}
      <Modal
        visible={!!selectedUser}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setSelectedUser(null)}
      >
        <View style={[
          styles.modalContainer,
          {
            backgroundColor: C.bg,
            // Without this the header sat under the status bar and the
            // avatar was clipped by the notch.
            paddingTop: insets.top,
          },
        ]}>
          {selectedUser && (
            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: C.text }]}>User Details</Text>
                <TouchableOpacity onPress={() => setSelectedUser(null)} style={styles.modalCloseBtn}>
                  <Ionicons name="close" size={24} color={C.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Identity — horizontal, not a centred stack.
                  A 64px avatar centred above name, email, an ID chip and a
                  status pill burned most of the first screen before a
                  single fact appeared. Side-by-side puts identity and
                  status in the same glance and leaves room for the record
                  underneath. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACE.lg }}>
                <Image source={{ uri: getAvatarSafe(selectedUser) }} style={styles.avatarLarge} />
                <View style={{ flex: 1, marginLeft: SPACE.md }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <Text style={[styles.modalName, { color: C.text, textAlign: 'left' }]} numberOfLines={1}>
                      {selectedUser.displayName}
                    </Text>
                    {userDetails?.isPro && (
                      <View style={[styles.proBadge, { marginTop: 0 }]}>
                        <Ionicons name="star" size={10} color={HUE.gold} />
                        <Text style={{ color: HUE.gold, fontWeight: '700', marginLeft: 3, fontSize: 10 }}>PRO</Text>
                      </View>
                    )}
                  </View>

                  <Text style={[styles.modalEmail, { color: C.textMuted, textAlign: 'left' }]} numberOfLines={1}>
                    {selectedUser.email || selectedUser.decodedEmail}
                  </Text>

                  {/* Status sits with the name — it is the single most
                      important thing about this person on this screen. */}
                  {currentSanction?.isActive ? (() => {
                    const hue = currentSanction.kind === 'mute' ? HUE.mute : HUE.danger;
                    return (
                      <View style={{ flexDirection: 'row', marginTop: 6 }}>
                        <View style={[styles.statusChip, { backgroundColor: tint(hue), borderColor: tint(hue, '40') }]}>
                          <Text style={[styles.statusChipText, { color: hue }]}>
                            {currentSanction.kind === 'mute' ? 'MUTED' : `STRIKE ${currentSanction.strikeCount}`}
                            {currentSanction.bannedUntil === 'permanent' ? ' · PERMANENT' : ''}
                          </Text>
                        </View>
                      </View>
                    );
                  })() : (
                    <View style={{ flexDirection: 'row', marginTop: 6 }}>
                      <View style={[styles.statusChip, { backgroundColor: tint(HUE.success), borderColor: tint(HUE.success, '40') }]}>
                        <Text style={[styles.statusChipText, { color: HUE.success }]}>NO RESTRICTIONS</Text>
                      </View>
                    </View>
                  )}
                </View>
              </View>

              {selectedUser.id && (
                <TouchableOpacity
                  onPress={() => {
                    Clipboard.setString(selectedUser.id);
                    Alert.alert('Copied', 'User ID copied to clipboard.');
                  }}
                  style={[styles.idChip, { backgroundColor: C.surfaceAlt, alignSelf: 'flex-start', marginTop: 0, marginBottom: SPACE.lg }]}
                >
                  <Ionicons name="copy-outline" size={12} color={C.textFaint} style={{ marginRight: 5 }} />
                  <Text style={{ color: C.textMuted, fontSize: 11 }} numberOfLines={1}>
                    {selectedUser.id}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Account facts — a compact 3-up strip rather than three
                  stacked rows in a tall card. Same information, a third of
                  the height, and the numbers line up so they can be
                  compared at a glance. */}
              {loadingDetails ? (
                <ActivityIndicator size="small" color={HUE.accent} style={{ marginBottom: SPACE.lg }} />
              ) : userDetails && (
                <View style={{ flexDirection: 'row', gap: SPACE.sm, marginBottom: SPACE.lg }}>
                  {[
                    {
                      icon: 'calendar-outline',
                      hue: C.textMuted,
                      value: userDetails.createdAt
                        ? new Date(toMillisSafe(userDetails.createdAt) || userDetails.createdAt)
                            .toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                        : '—',
                      label: 'Member since',
                    },
                    {
                      icon: 'star',
                      hue: HUE.gold,
                      value: `${parseRatingSafe(userDetails.rating).toFixed(1)}`,
                      label: `${userDetails.ratingCount || 0} review${(userDetails.ratingCount || 0) !== 1 ? 's' : ''}`,
                    },
                    {
                      icon: 'game-controller-outline',
                      hue: C.textMuted,
                      value: userDetails.robloxUsername || '—',
                      label: 'Roblox',
                    },
                  ].map((f) => (
                    <View
                      key={f.label}
                      style={{
                        flex: 1, paddingVertical: SPACE.md, paddingHorizontal: SPACE.sm,
                        borderRadius: RADIUS.md, alignItems: 'center',
                        backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
                      }}
                    >
                      <Ionicons name={f.icon} size={14} color={f.hue} />
                      <Text
                        style={{ color: C.text, fontSize: 13, fontWeight: '700', marginTop: 5 }}
                        numberOfLines={1}
                      >
                        {f.value}
                      </Text>
                      <Text style={{ color: C.textFaint, fontSize: 10, marginTop: 1 }} numberOfLines={1}>
                        {f.label}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Reviews. Wrapped in the same panel as every other block so
                  the modal reads as a stack of cards rather than headings
                  floating over the page background — and the empty case is
                  one muted line instead of a 16px-padded void. */}
              <View style={[styles.panel, { backgroundColor: C.surface, borderColor: C.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: reviews.length === 0 ? 0 : SPACE.md }}>
                  <Text style={[styles.sectionLabel, { color: C.textMuted, marginBottom: 0, flex: 1 }]}>Reviews</Text>
                  {reviews.length === 0 && !loadingReviews && (
                    <Text style={{ color: C.textFaint, fontSize: 12 }}>None</Text>
                  )}
                </View>

                {reviews.length === 0 && !loadingReviews ? null : (
                  reviews.map((review) => {
                    const ratingVal = parseRatingSafe(review?.rating);
                    const reviewText = (review?.review ?? review?.comment ?? review?.text ?? '').toString().trim();
                    const reviewer = (review?.userName ?? review?.reviewerName ?? '').toString().trim();
                    const dateText = formatDateSafe(review?.createdAt) || formatDateSafe(review?.updatedAt) || '';

                    return (
                      <View key={review.id} style={[styles.reviewCard, { backgroundColor: C.surfaceAlt, borderColor: C.border }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                          <Ionicons name="star" size={14} color={HUE.gold} />
                          <Text style={{ color: C.text, marginLeft: 4, fontWeight: '600' }}>
                            {ratingVal || 0}
                          </Text>
                          <Text style={{ color: C.textFaint, marginLeft: 'auto', fontSize: 11 }}>
                            {dateText || '—'}
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleDeleteReview(review)}
                            style={{ marginLeft: 10, padding: 4 }}
                          >
                            <Ionicons name="trash-outline" size={16} color={HUE.danger} />
                          </TouchableOpacity>
                        </View>

                        <Text style={{ color: C.text }}>
                          {reviewText || 'No comment'}
                        </Text>

                        {!!reviewer && (
                          <Text style={{ color: C.textMuted, fontSize: 11, marginTop: 4 }}>
                            — {reviewer}
                          </Text>
                        )}
                      </View>
                    );
                  })
                )}

                {loadingReviews && <ActivityIndicator size="small" color={HUE.accent} style={{ marginTop: SPACE.sm }} />}

                {hasMoreReviews && reviews.length > 0 && !loadingReviews && (
                  <TouchableOpacity style={styles.loadMoreBtn} onPress={() => fetchReviews(selectedUser.id, false)}>
                    <Text style={{ color: HUE.accent, fontWeight: '600', fontSize: 12.5 }}>Load more reviews</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* ── Moderation record ───────────────────────────────
                  One panel, because an admin asking "what has this person
                  done?" wants the live sanction, the tallies and the
                  timeline together — they were three separate cards with
                  their own headings and 24px gaps, so answering that
                  question meant scrolling past two of them.

                  Still two data sources, and the distinction matters:
                    · what is in force RIGHT NOW  → live RTDB record
                    · what has EVER been done     → Supabase audit log
                  The old screen showed only the first and called it
                  "Strike History". */}
              <View style={[styles.panel, { backgroundColor: C.surface, borderColor: C.border }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: SPACE.md }}>
                  <Text style={[styles.sectionLabel, { color: C.textMuted, marginBottom: 0, flex: 1 }]}>
                    Moderation record
                  </Text>
                  {modCounts && modCounts.totalCount > 0 && (
                    <Text style={{ color: C.textFaint, fontSize: 11 }}>
                      {modCounts.totalCount} action{modCounts.totalCount !== 1 ? 's' : ''} · {modCounts.distinctActors} staff
                    </Text>
                  )}
                </View>

                {/* Live sanction */}
                {currentSanction && (() => {
                  const active = currentSanction.isActive;
                  const hue = !active ? HUE.success
                    : currentSanction.kind === 'mute' ? HUE.mute
                    : currentSanction.strikeCount >= 3 ? HUE.danger
                    : currentSanction.strikeCount === 2 ? HUE.warnMid
                    : HUE.warn;
                  return (
                    <View style={{
                      backgroundColor: tint(hue, '12'), borderRadius: RADIUS.md,
                      borderWidth: 1, borderColor: tint(hue, '33'),
                      padding: SPACE.md, marginBottom: SPACE.md,
                    }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={[styles.strikeBadge, { backgroundColor: hue }]}>
                          <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 10 }}>
                            {!active ? 'EXPIRED'
                              : currentSanction.kind === 'mute' ? 'MUTED'
                              : `STRIKE ${currentSanction.strikeCount}`}
                          </Text>
                        </View>
                        <Text style={{ color: C.text, fontSize: 12, fontWeight: '600', marginLeft: SPACE.sm, flex: 1 }} numberOfLines={1}>
                          {currentSanction.bannedUntil === 'permanent'
                            ? 'Permanent'
                            : active
                              ? `Until ${new Date(currentSanction.bannedUntil).toLocaleString()}`
                              : `Ended ${timeAgo(currentSanction.bannedUntil)}`}
                        </Text>
                      </View>
                      <Text style={{ color: C.text, marginTop: 7, fontSize: 13, lineHeight: 18 }}>
                        {currentSanction.reason || 'No reason recorded'}
                      </Text>
                      <Text style={{ color: C.textFaint, fontSize: 11, marginTop: 4 }}>
                        {currentSanction.appliedBy ? `By ${currentSanction.appliedBy}` : 'Applied by unknown'}
                        {currentSanction.appliedAt ? ` · ${timeAgo(currentSanction.appliedAt)}` : ''}
                      </Text>
                    </View>
                  );
                })()}

                {/* Tallies — server-aggregated, one row back. */}
                {modCounts && (
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: SPACE.md }}>
                    {[
                      { label: 'Mutes', value: modCounts.muteCount, hue: HUE.mute },
                      { label: 'Strikes', value: modCounts.strikeCount, hue: HUE.warn },
                      { label: 'Bans', value: modCounts.banCount, hue: HUE.danger },
                      { label: 'Unbans', value: modCounts.unbanCount, hue: HUE.success },
                    ].map((c) => (
                      <View
                        key={c.label}
                        style={{
                          flex: 1, alignItems: 'center', paddingVertical: SPACE.sm,
                          borderRadius: RADIUS.sm,
                          backgroundColor: c.value > 0 ? tint(c.hue, '12') : C.surfaceAlt,
                          borderWidth: 1,
                          borderColor: c.value > 0 ? tint(c.hue, '33') : C.border,
                        }}
                      >
                        <Text style={{ fontSize: 17, fontWeight: '800', color: c.value > 0 ? c.hue : C.textFaint }}>
                          {c.value}
                        </Text>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: C.textFaint, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                          {c.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Timeline */}
                {modHistoryLoading && modHistory.length === 0 ? (
                  <ActivityIndicator size="small" color={HUE.accent} style={{ marginVertical: SPACE.md }} />
                ) : modSchemaMissing ? (
                  <SetupNotice />
                ) : modHistory.length === 0 ? (
                  <Text style={{ color: C.textFaint, textAlign: 'center', paddingVertical: SPACE.md, fontSize: 12, lineHeight: 17 }}>
                    No recorded actions yet.{'\n'}
                    History starts from the release that added the audit log — earlier
                    actions were never recorded anywhere.
                  </Text>
                ) : (
                  <>
                    <View style={{ height: 1, backgroundColor: C.border, marginBottom: SPACE.md }} />
                    {modHistory.map((a, i) => {
                      const meta = ACTION_META[a.action] || { label: a.action, icon: 'ellipse', color: C.textMuted };
                      return (
                        <View
                          key={a.id}
                          style={{
                            flexDirection: 'row',
                            paddingBottom: SPACE.md,
                            marginBottom: i === modHistory.length - 1 ? 0 : SPACE.md,
                            borderBottomWidth: i === modHistory.length - 1 ? 0 : 1,
                            borderBottomColor: C.border,
                          }}
                        >
                          {/* Timeline rail — a coloured dot per entry reads
                              faster than a repeated boxed card. */}
                          <View style={{ alignItems: 'center', width: 22, paddingTop: 2 }}>
                            <View style={{
                              width: 8, height: 8, borderRadius: 4, backgroundColor: meta.color,
                            }} />
                          </View>

                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                              <Text style={{ color: meta.color, fontWeight: '700', fontSize: 12 }}>
                                {meta.label}
                                {a.action === 'mute' && a.durationMinutes ? ` · ${a.durationMinutes} min` : ''}
                                {a.action === 'strike' && a.strikeCount ? ` ${a.strikeCount}` : ''}
                                {a.isPermanent ? ' · permanent' : ''}
                              </Text>
                              <Text style={{ color: C.textFaint, marginLeft: 'auto', fontSize: 10.5 }}>
                                {a.createdAt ? timeAgo(a.createdAt) : ''}
                              </Text>
                            </View>

                            <Text style={{ color: C.text, marginTop: 3, fontSize: 12.5, lineHeight: 17 }}>
                              {a.reason || 'No reason recorded'}
                            </Text>

                            <Text style={{ color: C.textFaint, fontSize: 10.5, marginTop: 3 }}>
                              {a.actorName || 'Unknown'}
                              {a.actorRole ? ` · ${a.actorRole.replace('_', ' ')}` : ''}
                              {' · '}{SOURCE_LABEL[a.source] || a.source}
                            </Text>

                            {/* Proof the acting mod attached (030). Thumbnails
                                rather than a count, because "is there anything
                                here?" is answered by looking, and a reason with
                                a screenshot behind it reads differently from
                                one without. Opens full screen, one at a time. */}
                            {a.evidenceUrls?.length > 0 && (
                              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: 8 }}>
                                {a.evidenceUrls.map((url, idx) => (
                                  <TouchableOpacity
                                    key={`${a.id}-ev-${idx}`}
                                    onPress={() => setEvidenceViewer({ urls: a.evidenceUrls, index: idx })}
                                    activeOpacity={0.8}
                                  >
                                    <Image
                                      source={{ uri: url }}
                                      style={{
                                        width: 52, height: 52, borderRadius: 6,
                                        borderWidth: 1, borderColor: C.border,
                                      }}
                                    />
                                  </TouchableOpacity>
                                ))}
                                <Text style={{ color: C.textFaint, fontSize: 10, marginBottom: 3 }}>
                                  tap to view
                                </Text>
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}

                    {modHistoryHasMore && (
                      <TouchableOpacity
                        onPress={() => fetchModRecord(selectedUser?.email, selectedUser?.id, false)}
                        disabled={modHistoryLoading}
                        style={{ paddingTop: SPACE.md, alignItems: 'center' }}
                      >
                        {modHistoryLoading
                          ? <ActivityIndicator size="small" color={HUE.accent} />
                          : <Text style={{ color: HUE.accent, fontWeight: '600', fontSize: 12.5 }}>Load older actions</Text>}
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>

              {/* ── Actions ──────────────────────────────────────────
                  Every control that changes this user's state lives here,
                  in one labelled block at the end.

                  The Ban button used to sit directly under the name, above
                  any information about the person — the most destructive
                  control on the screen was the first thing an admin could
                  hit, before they had seen a single reason, review or prior
                  action. Reading now comes first; acting comes last.

                  All four go through requestAction, which collects a
                  reason before anything is written. */}
              <View style={[styles.panel, { backgroundColor: C.surface, borderColor: C.border }]}>
                <Text style={[styles.sectionLabel, { color: C.textMuted }]}>Moderation actions</Text>

                {/* Unban / Ban. Driven by the freshly-read live record so the
                    button matches reality — the list row it came from can be
                    minutes stale, which is how admins ended up pressing "Ban"
                    on someone already banned. */}
                <View style={{ marginTop: 20, marginBottom: 16 }}>
                  {currentSanction?.isActive ? (
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: HUE.success }]}
                      onPress={() => requestAction('unban', null, selectedUser)}
                    >
                      <Ionicons name="checkmark-circle-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                      <Text style={styles.buttonText}>
                        {currentSanction.kind === 'mute' ? 'Remove Mute' : 'Unban User'}
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.actionButton, { backgroundColor: HUE.danger }]}
                      onPress={() => requestAction('ban', null, selectedUser)}
                    >
                      <Ionicons name="ban-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                      <Text style={styles.buttonText}>Ban User</Text>
                    </TouchableOpacity>
                  )}
                </View>


                <View style={{ height: 1, backgroundColor: C.border, marginBottom: SPACE.lg }} />

                <View style={{ marginTop: 0 }}>
                <Text style={{ color: C.textFaint, fontSize: 11.5, marginBottom: SPACE.sm }}>
                  Mute — temporary silence, adds no strike
                </Text>
                <View style={{ flexDirection: 'row', marginBottom: SPACE.sm, gap: SPACE.sm }}>
                  <TouchableOpacity style={[styles.strikeButton, { backgroundColor: HUE.mute }]} onPress={() => requestAction('mute', 5, selectedUser)}>
                    <Ionicons name="volume-mute" size={15} color="#FFF" />
                    <Text style={[styles.buttonText, { fontSize: 13.5 }]}>5 min</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.strikeButton, { backgroundColor: '#AF52DE' }]} onPress={() => requestAction('mute', 10, selectedUser)}>
                    <Ionicons name="volume-mute" size={15} color="#FFF" />
                    <Text style={[styles.buttonText, { fontSize: 13.5 }]}>10 min</Text>
                  </TouchableOpacity>
                  {/* Was an unlabelled grey box showing only the word "Min",
                      which read as a disabled third button rather than an
                      input. */}
                  <View style={[styles.strikeButton, {
                    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border, gap: 0,
                  }]}>
                    <Text style={{ color: C.textFaint, fontSize: 9.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Custom
                    </Text>
                    <TextInput
                      value={customMuteMinutes}
                      onChangeText={setCustomMuteMinutes}
                      placeholder="min"
                      placeholderTextColor={C.textFaint}
                      keyboardType="number-pad"
                      style={{ color: C.text, fontSize: 15, fontWeight: '700', textAlign: 'center', width: '100%', paddingVertical: 0 }}
                      maxLength={4}
                    />
                  </View>
                </View>
                {customMuteMinutes.trim().length > 0 && (
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: HUE.mute, height: 40, marginBottom: 8 }]}
                    onPress={() => {
                      const mins = parseInt(customMuteMinutes, 10);
                      if (mins > 0) {
                        requestAction('mute', mins, selectedUser);
                        setCustomMuteMinutes('');
                      } else {
                        Alert.alert('Error', 'Enter a valid number of minutes.');
                      }
                    }}
                  >
                    <Ionicons name="volume-mute" size={16} color="#FFF" style={{ marginRight: 6 }} />
                    <Text style={[styles.buttonText, { fontSize: 14 }]}>Mute for {customMuteMinutes} min</Text>
                  </TouchableOpacity>
                )}
              </View>

                {/* Strike buttons. Durations come from STRIKE_TIERS, which
                    sits next to the ladder setUserStrike actually applies —
                    these labels used to read "3 hours / 3 days", matching
                    nothing in the code. */}
                <View style={{ marginTop: SPACE.lg }}>
                  <Text style={{ color: C.textFaint, fontSize: 11.5, marginBottom: SPACE.sm }}>
                    Apply strike — escalates the ban ladder
                  </Text>
                  <View style={{ flexDirection: 'row', gap: SPACE.sm }}>
                    {STRIKE_TIERS.map((tier) => (
                      <TouchableOpacity
                        key={tier.count}
                        style={[styles.strikeButton, { backgroundColor: tier.color }]}
                        onPress={() => requestAction('strike', tier.count, selectedUser)}
                      >
                        <Text style={[styles.buttonText, { fontSize: 14 }]}>{tier.label}</Text>
                        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 10.5, fontWeight: '600' }}>{tier.duration}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              {/* Clears the system navigation bar. This was a flat 40,
                  which left "12 hours / 24 hours / Permanent" under the
                  nav bar on any device with gesture or button navigation. */}
              <View style={{ height: 40 + insets.bottom }} />
            </ScrollView>
          )}
        </View>
      </Modal>

      {/* Reason prompt — every punitive action passes through here.
          Reasons are what make the history worth reading: "Strike 2" with
          no reason tells the next moderator nothing, and this screen used
          to record exactly that (or worse, the boolean `true`). */}
      <Modal
        visible={!!pendingAction}
        transparent
        animationType="fade"
        onRequestClose={() => { setPendingAction(null); setActionEvidence([]); }}
      >
        <View style={{
          flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center',
          paddingHorizontal: 24,
          paddingTop: 24 + insets.top,
          paddingBottom: 24 + insets.bottom,
        }}>
          <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 20 }}>
            {(() => {
              if (!pendingAction) return null;
              const { type, value, user: target } = pendingAction;
              const title =
                type === 'ban' ? 'Ban User'
                : type === 'unban' ? 'Lift Restriction'
                : type === 'mute' ? `Mute for ${value} min`
                : `Apply Strike ${value}`;
              const consequence =
                type === 'strike' ? (STRIKE_TIERS.find((t) => t.count === value)?.duration || '')
                : type === 'ban' ? 'Escalates on the strike ladder (12h → 24h → permanent)'
                : type === 'mute' ? `Silenced for ${value} minute${value !== 1 ? 's' : ''}, no strike`
                : 'Clears the ban / mute and any mirrored device ban';

              return (
                <>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: C.text }}>{title}</Text>
                  <Text style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }} numberOfLines={1}>
                    {target?.displayName || 'User'} · {target?.email || '—'}
                  </Text>
                  <Text style={{ fontSize: 12, color: C.textMuted, marginTop: 8 }}>{consequence}</Text>

                  <TextInput
                    value={actionReason}
                    onChangeText={setActionReason}
                    placeholder="Reason (shown in this user's history)"
                    placeholderTextColor={C.textFaint}
                    multiline
                    maxLength={300}
                    style={{
                      marginTop: 14, minHeight: 72, borderRadius: 10, padding: 12,
                      textAlignVertical: 'top', fontSize: 14,
                      backgroundColor: C.border,
                      color: C.text,
                    }}
                  />

                  {/* Quick reasons — the point is that a reason gets
                      recorded at all, so make the common ones one tap. */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {['Spam', 'Scamming', 'Harassment', 'Inappropriate content', 'Ban evasion'].map((r) => (
                      <TouchableOpacity
                        key={r}
                        onPress={() => setActionReason(r)}
                        style={{
                          paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
                          backgroundColor: actionReason === r ? HUE.accent : (C.border),
                        }}
                      >
                        <Text style={{
                          fontSize: 11, fontWeight: '600',
                          color: actionReason === r ? '#FFF' : (C.textMuted),
                        }}>{r}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Proof. Not offered for an unban: there is nothing to
                      evidence in lifting a sanction, and the reason field
                      already carries the justification. */}
                  {type !== 'unban' && (
                    <ModEvidencePicker
                      uris={actionEvidence}
                      onChange={setActionEvidence}
                      isDark={isDark}
                      disabled={evidenceBusy}
                    />
                  )}

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
                    <TouchableOpacity
                      disabled={evidenceBusy}
                      onPress={() => { setPendingAction(null); setActionReason(''); setActionEvidence([]); }}
                      style={{
                        flex: 1, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center',
                        backgroundColor: C.border,
                      }}
                    >
                      <Text style={{ fontWeight: '600', color: C.text }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={confirmPendingAction}
                      disabled={evidenceBusy}
                      style={{
                        flex: 1, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center',
                        backgroundColor: type === 'unban' ? HUE.success : HUE.danger,
                        opacity: evidenceBusy ? 0.7 : 1,
                      }}
                    >
                      {evidenceBusy
                        ? <ActivityIndicator size="small" color="#FFF" />
                        : <Text style={{ fontWeight: '700', color: '#FFF' }}>Confirm</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      {/* Evidence on a moderation action — one screenshot at a time. */}
      <EvidenceViewer
        visible={!!evidenceViewer}
        urls={evidenceViewer?.urls || []}
        startIndex={evidenceViewer?.index || 0}
        onClose={() => setEvidenceViewer(null)}
      />

      {/* Full-screen image preview */}
      <Modal
        visible={!!previewImage}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewImage(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setPreviewImage(null)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' }}
        >
          {previewImage ? (
            <Image
              source={{ uri: previewImage }}
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
          ) : null}
          <TouchableOpacity
            onPress={() => setPreviewImage(null)}
            style={{ position: 'absolute', top: 16 + insets.top, right: 20, padding: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20 }}
          >
            <Ionicons name="close" size={28} color="#FFF" />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },

  // ── Tabs ──
  // Were text links with a 2px underline: the active state was easy to
  // miss and the row gave no hint that it scrolled. Pills read as a
  // control, and a partially-visible pill at the edge advertises the
  // scroll.
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.md,
    gap: SPACE.sm,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  tabText: { fontSize: 13.5, fontWeight: '600', letterSpacing: 0.1 },

  // ── Search ──
  searchContainer: { flexDirection: 'row', paddingHorizontal: SPACE.lg, marginBottom: SPACE.md, gap: SPACE.sm },
  searchInput: {
    flex: 1, height: 44, borderRadius: RADIUS.md,
    paddingHorizontal: 14, fontSize: 15, borderWidth: 1,
  },
  searchBtn: {
    width: 44, height: 44, backgroundColor: HUE.accent,
    borderRadius: RADIUS.md, justifyContent: 'center', alignItems: 'center',
  },

  listContent: { paddingHorizontal: SPACE.lg, paddingBottom: 80 },

  // ── Section label ──
  // Small, tracked, muted. A section heading should name the block
  // without competing with the content inside it — the old 16px bold
  // headings sat at the same visual weight as the data.
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: SPACE.sm,
  },

  // ── List cards ──
  card: {
    flexDirection: 'row', alignItems: 'center',
    padding: SPACE.md, borderRadius: RADIUS.lg,
    marginBottom: SPACE.sm, borderWidth: 1,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#DDD' },
  cardContent: { flex: 1, marginLeft: SPACE.md, marginRight: SPACE.sm },
  name: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  email: { fontSize: 12.5, marginTop: 2 },
  actionContainer: { flexDirection: 'row', alignItems: 'center' },

  // Tinted status chips instead of saturated fills.
  statusChip: {
    paddingHorizontal: SPACE.sm, paddingVertical: 4,
    borderRadius: RADIUS.sm, borderWidth: 1,
  },
  statusChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  // ── Modal shell ──
  modalContainer: { flex: 1 },
  modalContent: { paddingHorizontal: SPACE.lg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: SPACE.md,
  },
  modalTitle: { fontSize: 16, fontWeight: '700' },
  modalCloseBtn: { padding: SPACE.xs },

  // Identity block — avatar was 90px and pushed everything below the
  // fold before a single fact about the user appeared.
  identityBlock: { alignItems: 'center', paddingBottom: SPACE.lg },
  avatarLarge: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#DDD', marginBottom: SPACE.md },
  modalName: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3, textAlign: 'center' },
  modalEmail: { fontSize: 13, marginTop: 2, textAlign: 'center' },
  idChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SPACE.sm, paddingVertical: 5,
    borderRadius: RADIUS.sm, marginTop: SPACE.md, maxWidth: '100%',
  },

  // ── Panels ──
  panel: {
    borderRadius: RADIUS.lg, borderWidth: 1,
    padding: SPACE.lg, marginBottom: SPACE.lg,
  },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7 },

  sectionContainer: { marginBottom: SPACE.xl },

  reviewCard: { padding: SPACE.md, borderRadius: RADIUS.md, marginBottom: SPACE.sm, borderWidth: 1 },
  strikeCard: { padding: SPACE.md, borderRadius: RADIUS.md, marginBottom: SPACE.sm, borderWidth: 1 },
  strikeBadge: { paddingHorizontal: SPACE.sm, paddingVertical: 3, borderRadius: 6 },

  // ── Buttons ──
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.1 },
  actionButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    width: '100%', height: 48, borderRadius: RADIUS.md, marginBottom: SPACE.md,
  },
  strikeButton: {
    flex: 1, height: 56, borderRadius: RADIUS.md,
    justifyContent: 'center', alignItems: 'center', gap: 2,
  },

  // ── Misc ──
  emptyState: { alignItems: 'center', marginTop: 56, paddingHorizontal: SPACE.xl },
  emptyText: { marginTop: SPACE.md, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  proBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: tint(HUE.gold, '22'),
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: RADIUS.pill, marginTop: SPACE.sm,
  },

  infoBadge: { paddingHorizontal: SPACE.md, paddingVertical: 6, borderRadius: RADIUS.pill, marginTop: SPACE.md },

  loadMoreBtn: { alignItems: 'center', paddingVertical: 10 },

  chatBubble: { maxWidth: '82%', padding: SPACE.md, borderRadius: RADIUS.lg, marginBottom: SPACE.sm, borderWidth: 1 },
  selectedPersonCard: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: RADIUS.md, borderWidth: 1 },
  chatDropdown: { borderRadius: RADIUS.md, borderWidth: 1, marginTop: SPACE.xs, overflow: 'hidden' },
  chatDropdownItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1 },

  pollFormCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACE.lg },
  pollInput: { borderRadius: RADIUS.md, paddingHorizontal: SPACE.md, paddingVertical: 10, fontSize: 14, marginBottom: SPACE.xs, borderWidth: 1 },
  pollListCard: { borderRadius: RADIUS.lg, borderWidth: 1, padding: 14, marginBottom: SPACE.sm },
  pollStatusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SPACE.sm, paddingVertical: 3, borderRadius: RADIUS.sm },
  pollActionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: RADIUS.sm },
});

export default AdminDashboard;
