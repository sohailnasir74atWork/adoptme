import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Alert,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Platform,
  ScrollView,
  StyleSheet as RNStyleSheet,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import SignInDrawer from '../../Firebase/SigninDrawer';
import ChatHeaderContent from './ChatHeaderContent';
import MessagesList from './MessagesList';
import MessageInput from './MessageInput';
import { getStyles } from '../Style';
import { banUser, unbanUser } from '../utils';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import ProfileBottomDrawer from './BottomDrawer';
import leoProfanity from 'leo-profanity';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useLocalState } from '../../LocalGlobelStats';
import database, { onValue, ref } from '@react-native-firebase/database';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import {
  loadMessages as sbLoadMessages,
  loadMessagesSince as sbLoadMessagesSince,
  subscribeToMessages as sbSubscribeToMessages,
  sendMessage as sbSendMessage,
  toggleReaction as sbToggleReaction,
  loadReactionsFor as sbLoadReactionsFor,
  getPinnedMessages as sbGetPinnedMessages,
  subscribeToPinned as sbSubscribeToPinned,
  pinMessage as sbPinMessage,
  unpinMessage as sbUnpinMessage,
  clearPinnedForRoom as sbClearPinnedForRoom,
  softDeleteMessage as sbSoftDeleteMessage,
  softDeleteMessagesBySender as sbSoftDeleteMessagesBySender,
  roomIdFromRtdbPath,
  resetRealtimeAndAuth as sbResetRealtimeAndAuth,
  ensureRealtimeAuth as sbEnsureRealtimeAuth,
} from '../../Supabase/chatBackend';
import { uuidv4 } from '../../Supabase/uuid';
import { useTranslation } from 'react-i18next';
import { mixpanel } from '../../AppHelper/MixPenel';
import BannerAdComponent from '../../Ads/bannerAds';
import { showMessage } from 'react-native-flash-message';
import PetModal from '../PrivateChat/PetsModel';

import { incrementAndCheckBadge, MESSAGE_BADGE_THRESHOLDS } from './badgeUtils';
import { seedCurrentUser, getCachedProfile } from '../../Helper/profileCache';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (e) {
  console.warn('[Trader] MMKV not available:', e.message);
  storage = {
    getString: () => undefined,
    set: () => {},
  };
}
leoProfanity.add(['hell', 'shit']);
leoProfanity.loadDictionary('en');

const CHANNELS = [
  { id: 'en', label: 'English', flag: '🇺🇸', path: 'chat_new' },
  { id: 'es', label: 'Español', flag: '🇪🇸', path: 'chat_es' },
  { id: 'pt', label: 'Português', flag: '🇧🇷', path: 'chat_pt' },
  { id: 'fr', label: 'Français', flag: '🇫🇷', path: 'chat_fr' },
  { id: 'de', label: 'Deutsch', flag: '🇩🇪', path: 'chat_de' },
  { id: 'tr', label: 'Türkçe', flag: '🇹🇷', path: 'chat_tr' },
  { id: 'it', label: 'Italiano', flag: '🇮🇹', path: 'chat_it' },
  { id: 'hy', label: 'Հայերեն', flag: '🇦🇲', path: 'chat_hy' },
  { id: 'ar', label: 'العربية', flag: '🇸🇦', path: 'chat_ar' },
  { id: 'ja', label: '日本語', flag: '🇯🇵', path: 'chat_ja' },
  { id: 'ko', label: '한국어', flag: '🇰🇷', path: 'chat_ko' },
  { id: 'ru', label: 'Русский', flag: '🇷🇺', path: 'chat_ru' },
];

const ChatScreen = ({ selectedTheme, bannedUsers, modalVisibleChatinfo, setChatFocused,
  setModalVisibleChatinfo, unreadcount, setunreadcount, onlineUsersVisible, setOnlineUsersVisible }) => {
  const { user, theme, appdatabase, setUser, isAdmin, currentUserEmail } = useGlobalState();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [lastLoadedKey, setLastLoadedKey] = useState(null);
  const [isSigninDrawerVisible, setIsSigninDrawerVisible] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null); // Store the selected user's details
  const [isCooldown, setIsCooldown] = useState(false);
  const [signinMessage, setSigninMessage] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const { t, i18n } = useTranslation();
  const [pendingMessages, setPendingMessages] = useState([]);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [strikeInfo, setStrikeInfo] = useState(null);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [selectedFruits, setSelectedFruits] = useState([]);
  const [device, setDevice] = useState(null)


  const [selectedEmoji, setSelectedEmoji] = useState(null);

  // Firebase auth state — the *real* signal that the Supabase JWT is
  // available. `useGlobalState().user` hydrates from MMKV before Firebase
  // finishes restoring `currentUser` on cold-start, so it can't be used
  // as the trigger for (re)subscribing the realtime channel — see the
  // realtime effect below.
  const [firebaseUid, setFirebaseUid] = useState(
    () => getAuth().currentUser?.uid || null,
  );
  useEffect(() => {
    const unsub = onAuthStateChanged(getAuth(), (u) => {
      setFirebaseUid(u?.uid || null);
    });
    return unsub;
  }, []);

  // ✅ Remember user's preferred chat language (persisted in MMKV)
  const [activeChannel, setActiveChannel] = useState(() => {
    const savedId = storage.getString('preferred_chat_lang');
    if (savedId) {
      const found = CHANNELS.find(c => c.id === savedId);
      if (found) return found;
    }
    // Fallback: match app language, then English
    const lang = (i18n.language || 'en').split('-')[0];
    return CHANNELS.find(c => c.id === lang) || CHANNELS[0];
  });

  // ✅ Reorder channels: put user's preferred language first
  const orderedChannels = useMemo(() => {
    const idx = CHANNELS.findIndex(c => c.id === activeChannel.id);
    if (idx <= 0) return CHANNELS;
    return [CHANNELS[idx], ...CHANNELS.slice(0, idx), ...CHANNELS.slice(idx + 1)];
  }, [activeChannel.id]);

  // ✅ Track last sent message to prevent duplicates (session-based, no Firebase cost)
  const lastSentMessageRef = useRef(null);
  // ✅ OPTIMIZED: Track newest message to skip initial download in listener
  const newestMessageIdRef = useRef(null);
  const hasInitializedRef = useRef(false);
  const initialLoadDoneRef = useRef(false); // ✅ Track if initial load is complete (prevents duplicate messages)

  // Cursor of the newest server-confirmed message we've seen in this room.
  // Used by the gap-fill fetch on reconnect. Optimistic placeholders do
  // NOT advance this cursor — only rows that came back from the server.
  const newestCursorRef = useRef(null); // { createdAt: ISO, id }

  // In-memory retry queue for sends that failed (network hiccup). Capped
  // so a long offline session can't grow unbounded.
  const RETRY_QUEUE_CAP = 50;
  const retryQueueRef = useRef([]); // [{ roomId, message }]
  const flushingRef = useRef(false);

  // Debounced gap-fill trigger: multiple reconnect signals (channel
  // SUBSCRIBED recovery, app foreground, etc.) fold into one fetch.
  const gapFillTimerRef = useRef(null);
  const lastRealtimeStatusRef = useRef(null);

  // CHANNEL_ERROR / TIMED_OUT recovery. Supabase Realtime does NOT
  // auto-reheal a channel that hits CHANNEL_ERROR (e.g. InvalidJWTToken
  // when the Firebase ID token expires across a laptop sleep, or when
  // cold-start auth race causes the WS to handshake without a token).
  // We force a resubscribe with exponential backoff — the new channel
  // re-invokes client.js's accessToken callback, which getIdToken
  // auto-refreshes if the cached token is stale.
  const channelErrorAttemptsRef = useRef(0);
  const channelRetryTimerRef = useRef(null);
  const [resubKey, setResubKey] = useState(0);

  const flatListRef = useRef();

  // ✅ Ref to track isAtBottom without triggering re-renders in listener
  const isAtBottomRef = useRef(isAtBottom);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
    if (isAtBottom && pendingMessages.length > 0) {
      setMessages((prev) => [...pendingMessages, ...prev]);
      setPendingMessages([]);
    }
  }, [isAtBottom, pendingMessages]);

  // ✅ PHASE 0B: Seed current user's profile into cache on mount
  // This ensures the user's OWN slim messages show correct avatar/name
  useEffect(() => {
    if (user?.id) {
      seedCurrentUser(user, localState, appdatabase);
      // Sync own cosmetics to MMKV (once, if stale)
      const { syncMyCosmetics } = require('../../Helper/cosmeticsCache');
      syncMyCosmetics(appdatabase, user.id);
    }
  }, [user?.id, user?.avatar]);


  const INITIAL_PAGE_SIZE = 5; // ✅ Initial load: 5 messages
  const PAGE_SIZE = 10; // ✅ Pagination: load 10 messages per batch
  const PENDING_CAP = 50;

  const navigation = useNavigation()
  // ✅ Memoize openProfileDrawer
  const openProfileDrawer = useCallback(async (userData) => {
    if (!userData || !userData.senderId) return;

    // ✅ Enrich with cached avatar so drawer shows it instantly (no flash)
    const cached = getCachedProfile(userData.senderId);
    const enriched = cached?.avatar && !userData.avatar
      ? { ...userData, avatar: cached.avatar }
      : userData;

    setSelectedUser(enriched);
    setIsDrawerVisible(true);
  }, []);

  // ✅ Memoize closeProfileDrawer
  const closeProfileDrawer = useCallback(() => {
    setIsDrawerVisible(false);
  }, []);

  // ✅ Memoize toggleDrawer
  const toggleDrawer = useCallback(async (userData = null) => {
    setSelectedUser(userData);
    setIsDrawerVisible((prev) => !prev);
  }, []);

  // ✅ Memoize startPrivateChat
  const startPrivateChat = useCallback(() => {
    const callbackfunction = () => {
      closeProfileDrawer();
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('PrivateChat', { selectedUser, selectedTheme });
      }
      mixpanel.track("Inbox Chat");
    };
    // ✅ Removed navigation ad - exit ads are shown when leaving chat instead
    callbackfunction();
  }, [selectedUser, selectedTheme, closeProfileDrawer]);

  const roomId = useMemo(() => roomIdFromRtdbPath(activeChannel.path), [activeChannel.path]);

  const styles = useMemo(() => getStyles(theme === 'dark'), [theme]);




  const validateMessage = useCallback((message) => {
    const text = (message?.text ?? "").toString();
    const trimmed = text.trim();

    const hasFruits = Array.isArray(message?.fruits) && message.fruits.length > 0;
    const hasGif = !!message?.gif;

    const hasContent = trimmed.length > 0 || hasFruits || hasGif;

    return {
      ...message,
      sender: (message?.sender ?? t("chat.anonymous")).toString().trim() || t("chat.anonymous"),
      text: trimmed, // keep trimmed text, but don't force empty for fruits-only
      // ✅ do NOT invent fake timestamps
      timestamp:
        typeof message?.timestamp === "number"
          ? message.timestamp
          : Date.now(), // fallback only if missing
      // Optional: if message is truly empty (shouldn't exist), mark it
      _invalid: !hasContent,
    };
  }, []);


  const loadMessages = useCallback(
    async (reset = false) => {
      try {
        if (reset) {

          setLoading(true);
          setLastLoadedKey(null); // Reset pagination key
        }



        // ✅ Use INITIAL_PAGE_SIZE for first load, PAGE_SIZE for pagination
        const limitSize = reset ? INITIAL_PAGE_SIZE : PAGE_SIZE;
        const beforeCursor = reset ? null : lastLoadedKey;
        const fetched = await sbLoadMessages(roomId, { limit: limitSize, before: beforeCursor });





        // ✅ Safety check for bannedUsers array
        const bannedIds = Array.isArray(bannedUsers)
          ? bannedUsers.map(u => (typeof u === 'string' ? u : u?.id)).filter(Boolean)
          : [];
        const parsedMessages = fetched
          .map(m => validateMessage(m))
          .filter(m => m?.senderId && !bannedIds.includes(m.senderId));

        // Hydrate reactions in one batched query.
        const reactionMap = await sbLoadReactionsFor(parsedMessages.map(m => m.id));
        parsedMessages.forEach(m => { m.reactions = reactionMap[m.id] || {}; });



        if (parsedMessages.length === 0 && !reset) {

          setLastLoadedKey(null);
          return;
        }

        if (reset) {
          setMessages(parsedMessages);
          // Anchor the gap-fill cursor at the newest server message so
          // subsequent reconnects know where to resume from.
          if (parsedMessages.length > 0) {
            const newest = parsedMessages[0];
            newestCursorRef.current = {
              createdAt: new Date(newest.timestamp).toISOString(),
              id: newest.id,
            };
          } else {
            newestCursorRef.current = null;
          }
        } else {
          setMessages((prev) => [...prev, ...parsedMessages]);
        }

        if (parsedMessages.length > 0) {
          // Composite cursor: Postgres created_at (ms → ISO) + row id.
          const last = parsedMessages[parsedMessages.length - 1];
          setLastLoadedKey({ createdAt: new Date(last.timestamp).toISOString(), id: last.id });
        }
      } catch (error) {
        console.error('[loadMessages] error:', error?.message || error);
      } finally {
        if (reset) setLoading(false);
      }
    },
    [roomId, lastLoadedKey, validateMessage, bannedUsers]
  );
  // Fetch messages newer than our anchor cursor and merge them in.
  // Called on realtime recovery (channel went CHANNEL_ERROR/TIMED_OUT/
  // CLOSED and came back SUBSCRIBED) to backfill any INSERTs that fired
  // while we were disconnected — those events are NOT replayed by
  // Supabase Realtime, so without this the chat silently drops messages.
  //
  // Pages forward if the result hits the limit (someone might have sent
  // >200 messages while we were away). Bounded by MAX_PAGES to avoid
  // runaway loops on a mis-advancing cursor.
  const gapFillSince = useCallback(async () => {
    if (!roomId) return;
    if (!initialLoadDoneRef.current) return; // initial load hasn't anchored yet
    try {
      const GAP_PAGE_SIZE = 200;
      const MAX_PAGES = 5; // hard ceiling: 1000 messages max per recovery
      let cursor = newestCursorRef.current;
      if (!cursor) return;

      for (let i = 0; i < MAX_PAGES; i++) {
        const fetched = await sbLoadMessagesSince(roomId, cursor, { limit: GAP_PAGE_SIZE });
        if (!fetched.length) return;

        const bannedIds = Array.isArray(bannedUsers)
          ? bannedUsers.map(u => (typeof u === 'string' ? u : u?.id)).filter(Boolean)
          : [];
        const filtered = fetched
          .map(m => validateMessage(m))
          .filter(m => m?.senderId && !bannedIds.includes(m.senderId));

        if (filtered.length) {
          // Hydrate reactions for the new rows.
          const reactionMap = await sbLoadReactionsFor(filtered.map(m => m.id));
          filtered.forEach(m => { m.reactions = reactionMap[m.id] || {}; });

          setMessages((prev) => {
            const byId = new Set(prev.map(m => String(m.id)));
            const byClientId = new Set(prev.map(m => m.clientMsgId).filter(Boolean));
            const toAdd = filtered.filter(m => {
              if (byId.has(String(m.id))) return false;
              if (m.clientMsgId && byClientId.has(m.clientMsgId)) return false;
              return true;
            });
            if (!toAdd.length) return prev;
            // Replace any optimistic placeholders whose server row we just fetched.
            const merged = prev.map((m) => {
              if (!m._pending || !m.clientMsgId) return m;
              const real = filtered.find(r => r.clientMsgId === m.clientMsgId);
              return real ? { ...real } : m;
            });
            return [...toAdd, ...merged].sort(
              (a, b) => (b?.timestamp || 0) - (a?.timestamp || 0),
            );
          });

          // Advance cursor to the newest row we just merged.
          const newest = filtered[0];
          newestCursorRef.current = {
            createdAt: new Date(newest.timestamp).toISOString(),
            id: newest.id,
          };
        }

        if (fetched.length < GAP_PAGE_SIZE) return; // drained
        cursor = {
          createdAt: new Date(fetched[0].timestamp).toISOString(),
          id: fetched[0].id,
        };
      }
    } catch (error) {
      console.error('[gapFill] failed:', error?.message || error);
    }
  }, [roomId, bannedUsers, validateMessage]);

  // Debounce the gap-fill so a burst of status transitions or network
  // events collapses to a single fetch.
  const scheduleGapFill = useCallback(() => {
    if (gapFillTimerRef.current) clearTimeout(gapFillTimerRef.current);
    gapFillTimerRef.current = setTimeout(() => {
      gapFillTimerRef.current = null;
      gapFillSince();
    }, 800);
  }, [gapFillSince]);

  // Flush any sends that failed while offline. Idempotent on the server
  // via UNIQUE(room_id, client_msg_id) — a successful-but-timed-out
  // attempt won't produce a duplicate row on retry.
  const flushRetryQueue = useCallback(async () => {
    if (flushingRef.current) return;
    if (!retryQueueRef.current.length) return;
    flushingRef.current = true;
    try {
      while (retryQueueRef.current.length) {
        const item = retryQueueRef.current[0];
        try {
          const saved = await sbSendMessage(item.roomId, item.message);
          // Replace the optimistic placeholder with the real row.
          setMessages((prev) => prev.map(m =>
            m.clientMsgId === item.message.clientMsgId
              ? { ...saved, reactions: m.reactions || {} }
              : m,
          ));
          retryQueueRef.current.shift();
        } catch (error) {
          console.warn('[retryQueue] still failing:', error?.message || error);
          // Stop draining — we'll try again on the next reconnect signal.
          break;
        }
      }
    } finally {
      flushingRef.current = false;
    }
  }, []);

  // Hoisted so pin/unpin/clear handlers can trigger it directly instead of
  // relying only on Realtime (which can be flaky for DELETE without
  // REPLICA IDENTITY FULL on the table).
  const fetchPinned = useCallback(async () => {
    if (!roomId) return;
    try {
      const list = await sbGetPinnedMessages(roomId);
      // `firebaseKey` name preserved for the existing UI (ChatHeaderContent).
      setPinnedMessages(list.map(p => ({ firebaseKey: p.pinId, ...p })));
    } catch (error) {
      console.error('[pinned] load failed:', error?.message || error);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    fetchPinned();
    const unsub = sbSubscribeToPinned(roomId, { onChange: fetchPinned });
    return () => { unsub(); };
  }, [roomId, fetchPinned]);

  // ✅ Channel switch handler — resets state for new channel
  const handleChannelSwitch = useCallback((channel) => {
    if (channel.id === activeChannel.id) return;
    // ✅ Save preference to MMKV
    storage.set('preferred_chat_lang', channel.id);
    setActiveChannel(channel);
    setMessages([]);
    setPendingMessages([]);
    setLastLoadedKey(null);
    setReplyTo(null);
    setInput('');
    newestMessageIdRef.current = null;
    hasInitializedRef.current = false;
    initialLoadDoneRef.current = false;
    lastSentMessageRef.current = null;
    newestCursorRef.current = null;
    retryQueueRef.current = [];
    lastRealtimeStatusRef.current = null;
    channelErrorAttemptsRef.current = 0;
    if (gapFillTimerRef.current) {
      clearTimeout(gapFillTimerRef.current);
      gapFillTimerRef.current = null;
    }
    if (channelRetryTimerRef.current) {
      clearTimeout(channelRetryTimerRef.current);
      channelRetryTimerRef.current = null;
    }
  }, [activeChannel.id]);

  // ✅ Initial setup (runs once on mount)
  useEffect(() => {
    if (setChatFocused && typeof setChatFocused === 'function') {
      setChatFocused(false);
    }
    setDevice(Platform.OS);
  }, [setChatFocused]);

  // Initial + on-switch load. Uses the unified `loadMessages(true)` path
  // instead of an inline duplicate of the same query.
  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    (async () => {
      await loadMessages(true);
      if (!cancelled) initialLoadDoneRef.current = true;
    })();
    return () => { cancelled = true; };
    // loadMessages is memoised on [roomId, lastLoadedKey, ...]. We intentionally
    // only re-run on roomId change (channel switch); including loadMessages in
    // deps would re-trigger whenever lastLoadedKey mutates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // Realtime INSERT stream. Supabase Postgres Changes fires on every new row
  // in `messages` for this room, filling the same role as the old
  // onValue(limitToLast 1) listener — no race with initial load.
  //
  // Wrapped in useFocusEffect (not plain useEffect) so the WebSocket only
  // stays open while the chat tab is focused. Tab-switching to Home /
  // Profile / etc. now tears down the channel and saves battery + data.
  // On re-focus, the existing onStatus → scheduleGapFill path backfills
  // any messages that landed during the blur window.
  useFocusEffect(
    useCallback(() => {
    if (!roomId) return;

    // Advance the gap-fill cursor whenever a realtime-delivered row lands
    // on screen, so reconnects resume from the last thing we actually saw.
    const advanceCursor = (msg) => {
      const t = typeof msg?.timestamp === 'number' ? msg.timestamp : Date.now();
      const current = newestCursorRef.current;
      if (!current || new Date(current.createdAt).getTime() < t) {
        newestCursorRef.current = { createdAt: new Date(t).toISOString(), id: msg.id };
      }
    };

    let cancelled = false;
    let unsubscribe = () => {};

    const subscribeCallbacks = {
      onInsert: (newMessage) => {
        if (!newMessage || !newMessage.id) return;

        const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
        if (banned.includes(newMessage.senderId)) return;

        advanceCursor(newMessage);

        let shouldQueue = false;
        setMessages((prev) => {
          if (!Array.isArray(prev) || prev.length === 0) return [newMessage];

          // Dedup by primary id (echo of our own insert) OR by clientMsgId
          // (upgrading an optimistic placeholder to the real server row).
          const existingIdx = prev.findIndex((m) => {
            if (String(m?.id) === String(newMessage.id)) return true;
            if (newMessage.clientMsgId && m?.clientMsgId === newMessage.clientMsgId) return true;
            return false;
          });

          if (existingIdx !== -1) {
            const existing = prev[existingIdx];
            const merged = { ...newMessage, reactions: existing.reactions || {} };
            const copy = prev.slice();
            copy[existingIdx] = merged;
            return copy;
          }

          if (isAtBottomRef.current) {
            newestMessageIdRef.current = newMessage.id;
            return [newMessage, ...prev];
          }
          shouldQueue = true;
          return prev;
        });

        if (shouldQueue) {
          setPendingMessages((prevPending) => {
            const pendingIds = new Set(prevPending.map((msg) => msg?.id).filter(Boolean));
            if (pendingIds.has(newMessage.id)) return prevPending;
            const next = [newMessage, ...prevPending];
            // Cap so a long scrollback session can't grow pending unboundedly.
            return next.length > PENDING_CAP ? next.slice(0, PENDING_CAP) : next;
          });
        }
      },
      onUpdate: (updated) => {
        if (!updated?.id) return;
        // Moderation soft-deletes set deleted=true; let them disappear.
        if (updated.deleted) {
          setMessages(prev => prev.filter(m => String(m.id) !== String(updated.id)));
          return;
        }
        setMessages(prev => prev.map(m => (String(m.id) === String(updated.id) ? { ...m, ...updated, reactions: m.reactions } : m)));
      },
      onDelete: (deletedId) => {
        if (!deletedId) return;
        setMessages(prev => prev.filter(m => String(m.id) !== String(deletedId)));
      },
      onStatus: (status, err) => {
        const prev = lastRealtimeStatusRef.current;
        lastRealtimeStatusRef.current = status;

        if (status === 'SUBSCRIBED') {
          // Every SUBSCRIBED transition (including the first one) triggers
          // a gap-fill. The first-subscribe case matters on cold-start: if
          // Firebase auth was still resolving when we opened the WebSocket,
          // the channel was authed unauth and RLS dropped any INSERTs that
          // landed in that window — this backfills them.
          if (prev !== 'SUBSCRIBED') {
            scheduleGapFill();
            flushRetryQueue();
          }
          // Reset retry budget so future errors get a fresh backoff.
          channelErrorAttemptsRef.current = 0;
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const attempts = channelErrorAttemptsRef.current;
          if (attempts >= 5) return; // give up — log already shows the cause
          channelErrorAttemptsRef.current = attempts + 1;
          const delay = Math.min(2000 * Math.pow(2, attempts), 30000);
          if (channelRetryTimerRef.current) clearTimeout(channelRetryTimerRef.current);
          channelRetryTimerRef.current = setTimeout(async () => {
            channelRetryTimerRef.current = null;
            // Hard-reset the socket + force-refresh Firebase token before
            // resubscribing — otherwise the new channel inherits the
            // wedged WS and stale JWT and fails the same way.
            await sbResetRealtimeAndAuth();
            setResubKey((k) => k + 1);
          }, delay);
        }
      },
    };

    // Pre-flight the realtime auth so the channel JOIN goes out with a
    // valid JWT in its payload. supabase-js's internal connect-time auth
    // is fire-and-forget; if the WS opens before our async accessToken
    // callback resolves, the channel joins unauth and gets rejected
    // with InvalidJWTToken. Awaiting setAuth() here closes that race.
    sbEnsureRealtimeAuth().finally(() => {
      if (cancelled) return;
      unsubscribe = sbSubscribeToMessages(roomId, subscribeCallbacks);
    });

    return () => {
      cancelled = true;
      unsubscribe();
      hasInitializedRef.current = false;
      lastRealtimeStatusRef.current = null;
      if (channelRetryTimerRef.current) {
        clearTimeout(channelRetryTimerRef.current);
        channelRetryTimerRef.current = null;
      }
    };
    // firebaseUid (not user?.id) is the trigger: useGlobalState().user is
    // hydrated from MMKV before Firebase finishes restoring currentUser
    // on cold-start, so user?.id flips truthy *before* the Supabase JWT
    // is available. Anonymous viewers stay subscribed (firebaseUid=null
    // is a stable value, channel opens once with no JWT — RLS allows
    // anon reads). Logged-in users on cold-start may briefly open a
    // pre-auth channel, but onAuthStateChanged fires within seconds,
    // flips firebaseUid, this effect re-runs, the pre-auth channel is
    // torn down, and a new one opens with the token attached. The
    // existing onStatus → scheduleGapFill path then backfills anything
    // missed during the window.
    }, [roomId, bannedUsers, scheduleGapFill, flushRetryQueue, firebaseUid, resubKey])
  );

  // (Reactions realtime intentionally omitted — see chatBackend.js comment.
  // Self-reactions are optimistic; other users' reactions refresh on
  // pagination or re-entering the room.)





  const handleLoadMore = useCallback(async () => {
    // ✅ Fixed: use && instead of &
    if (!user?.id && !signinMessage) {
      Alert.alert(
        t('misc.loginToStartChat'),
        t('misc.loginRequired'),
        [{ text: t('chat.ok'), onPress: () => setIsSigninDrawerVisible(true) }]
      );
      setSigninMessage(true);
      return;
    }

    if (!loading && lastLoadedKey) {
      await loadMessages(false);
    } else {

    }
  }, [user?.id, signinMessage, loading, lastLoadedKey, loadMessages, t]);




  // Admin soft-delete (marks deleted=true, RLS permits any authenticated
  // user; client UI gates to admins/mods). Soft-delete triggers a
  // Realtime UPDATE event → onUpdate handler filters the row out of the
  // local list for everyone subscribed.
  const handleDeleteOne = useCallback(async (messageId) => {
    if (!messageId || !user?.id) return;
    try {
      await sbSoftDeleteMessage(messageId, user.id);
      // Also drop locally in case realtime UPDATE misses the acting admin.
      setMessages(prev => prev.filter(m => String(m.id) !== String(messageId)));
    } catch (error) {
      console.error('[delete] failed:', error?.message || error);
      Alert.alert(t('home.alert.error'), t('chat.delete_error') || 'Failed to delete message');
    }
  }, [user?.id, t]);

  const handleDeleteAllFromSender = useCallback(async (senderId) => {
    if (!roomId || !senderId || !user?.id) return;
    try {
      const { count } = await sbSoftDeleteMessagesBySender(roomId, senderId, {
        limit: 60, deletedBy: user.id,
      });
      // Optimistic local cleanup — realtime UPDATEs will reconcile for everyone.
      setMessages(prev => prev.filter(m => String(m.senderId) !== String(senderId)));
      if (count === 0) {
        Alert.alert('No messages', 'This user has no recent messages to remove.');
      }
    } catch (error) {
      console.error('[delete-all] failed:', error?.message || error);
      Alert.alert(t('home.alert.error'), t('chat.delete_error') || 'Failed to remove messages');
    }
  }, [roomId, user?.id, t]);

  const handlePinMessage = async (message) => {
    if (!roomId || !message?.id || !user?.id) return;
    try {
      await sbPinMessage(roomId, message.id, user.id);
      fetchPinned();
    } catch (error) {
      console.error('[pin] failed:', error?.message || error);
      Alert.alert(t('home.alert.error'), t('chat.pin_error'));
    }
  };

  const unpinSingleMessage = async (pinId) => {
    if (!pinId) return;
    try {
      await sbUnpinMessage(pinId);
      fetchPinned();
    } catch (error) {
      console.error('[unpin] failed:', error?.message || error);
      Alert.alert(t('home.alert.error'), t('chat.unpin_error'));
    }
  };

  const clearAllPinnedMessages = async () => {
    if (!roomId) return;
    try {
      await sbClearPinnedForRoom(roomId);
      fetchPinned();
    } catch (error) {
      console.error('[clear pins] failed:', error?.message || error);
      Alert.alert(t('home.alert.error'), t('chat.clear_pins_error'));
    }
  };

  const handleLoginSuccess = () => {
    setIsSigninDrawerVisible(false);
  };



  useEffect(() => {
    if (!currentUserEmail || !appdatabase) return;

    const encodedEmail = currentUserEmail.toLowerCase().trim().replace(/\./g, '(dot)');
    const banRef = ref(appdatabase, `banned_users_by_email/${encodedEmail}`);

    const unsubscribe = onValue(banRef, (snapshot) => {
      const banData = snapshot.val();
      setStrikeInfo(banData && typeof banData === 'object' ? banData : null);
    });

    return () => unsubscribe();
  }, [currentUserEmail, appdatabase]);


  const handleRefresh = async () => {
    setRefreshing(true);
    await loadMessages(true);
    // Manual realtime recovery: if the channel is wedged (e.g. cold-start
    // CHANNEL_ERROR that retries couldn't recover from, or the user just
    // came back from a long sleep), pull-to-refresh now also forces a
    // socket reset + JWT refresh + resubscribe. This gives the user an
    // explicit escape hatch instead of having to relaunch the app.
    if (lastRealtimeStatusRef.current !== 'SUBSCRIBED') {
      try {
        await sbResetRealtimeAndAuth();
        channelErrorAttemptsRef.current = 0;
        setResubKey((k) => k + 1);
      } catch (e) {
        console.warn('[refresh] realtime recovery failed:', e?.message || e);
      }
    }
    setRefreshing(false);
  };

  // Handle reaction to a message
  const handleReaction = useCallback(async (messageId, emoji) => {
    if (!messageId || !user?.id) return;

    // Optimistic update — Supabase realtime will confirm/correct.
    setMessages(prev => prev.map(m => {
      if (String(m.id) !== String(messageId)) return m;
      const current = m.reactions?.[user.id];
      const newReactions = { ...(m.reactions || {}) };
      if (current === emoji) delete newReactions[user.id];
      else newReactions[user.id] = emoji;
      return { ...m, reactions: newReactions };
    }));

    try {
      await sbToggleReaction(messageId, user.id, emoji);
    } catch (error) {
      console.error('Error toggling reaction:', error?.message || error);
    }
  }, [user?.id]);

  // expects to be called like:


  const handleSendMessage = async (replyToArg, trimmedInputArg, fruits, emojiUrl) => {
    const hasEmoji = !!emojiUrl;
    const hasFruits = Array.isArray(fruits) && fruits.length > 0;

    const MAX_CHARACTERS = 250;
    const MESSAGE_COOLDOWN = 100; // ms
    const LINK_REGEX = /(https?:\/\/[^\s]+)/i; // no "g" flag

    // Must be logged in
    if (!user?.id || !currentUserEmail) {
      showMessage({
        message: t('chat.not_logged_in'),
        description: t('chat.must_be_logged_in_to_send'),
        type: 'danger',
      });
      return;
    }

    // ---- Strike / ban checks ----
    if (strikeInfo) {
      const { strikeCount, bannedUntil } = strikeInfo;
      const now = Date.now();

      // Permanent ban
      if (bannedUntil === 'permanent') {
        showMessage({
          message: t('chat.permanently_banned_title'),
          description: t('chat.permanently_banned_message'),
          type: 'danger',
        });
        return;
      }

      // Temporary ban (timestamp in ms)
      if (typeof bannedUntil === 'number' && now < bannedUntil) {
        const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeLeftText =
          hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        showMessage({
          message: t('chat.strike_title', { count: strikeCount }),
          description: t('chat.strike_message', { time: timeLeftText }),
          type: 'warning',
          duration: 5000,
        });
        return;
      }
    }

    // Use the argument, not external state
    const trimmedInput = (trimmedInputArg || '').trim();

    // ✅ Validate fruits count - maximum 18 fruits allowed
    if (hasFruits && fruits.length > 9) {
      Alert.alert(t('home.alert.error'), t('chat.max_pets_error'));
      return;
    }

    // Disallow empty text + no fruits
    if (!trimmedInput && !hasFruits && !emojiUrl) {
      Alert.alert(t('home.alert.error'), t('chat.cannot_empty'));
      return;
    }

    // Profanity check
    if (trimmedInput && leoProfanity.check(trimmedInput)) {
      Alert.alert(t('home.alert.error'), t('misc.inappropriateLanguage'));
      return;
    }

    // Length check
    if (trimmedInput.length > MAX_CHARACTERS) {
      Alert.alert(t('home.alert.error'), t('misc.messageTooLong'));
      return;
    }

    // Cooldown check
    if (isCooldown) {
      Alert.alert(t('home.alert.error'), t('misc.sendingTooQuickly'));
      return;
    }

    // ✅ Duplicate message check - prevent copy-paste spam (no Firebase cost, client-side only)
    const currentMessage = {
      text: trimmedInput,
      fruits: hasFruits ? JSON.stringify(fruits.sort((a, b) => (a?.id || '').localeCompare(b?.id || ''))) : null,
      emoji: emojiUrl || null,
    };

    if (lastSentMessageRef.current) {
      const lastMessage = lastSentMessageRef.current;
      const isDuplicate =
        lastMessage.text === currentMessage.text &&
        lastMessage.fruits === currentMessage.fruits &&
        lastMessage.emoji === currentMessage.emoji;

      if (isDuplicate) {
        Alert.alert(
          t('home.alert.error'),
          t('chat.cannot_send_duplicate'),
        );
        return;
      }
    }

    // Link check (only for non-pro & non-admin)
    const containsLink = trimmedInput ? LINK_REGEX.test(trimmedInput) : false;


    if (!roomId) {
      console.error('❌ No roomId for current channel');
      return;
    }

    const myProfile = getCachedProfile(user.id);
    const myCosmetics = require('../../Helper/cosmeticsCache').getMyCosmetics();

    const avatar = user.avatar || myProfile?.avatar || null;
    const isPro = !!localState?.isPro || !!myProfile?.isPro;
    const verified = !!user.robloxUsernameVerified || !!myProfile?.robloxUsernameVerified;
    const topBadge = myProfile?.topBadge || null;
    const hasWin = !!(myProfile?.hasRecentGameWin || (myProfile?.lastGameWinAt && Date.now() - myProfile.lastGameWinAt <= 24 * 60 * 60 * 1000));
    const frame = myCosmetics?.profileFrame || myProfile?.profileFrame || null;
    const txtColor = myCosmetics?.chatTextColor?.color || myProfile?.chatTextColor || null;
    const bubbleBg = myCosmetics?.chatBubbleBg || myProfile?.chatBubbleBg || null;

    // Client-generated id for idempotent retries. Server enforces
    // UNIQUE(room_id, client_msg_id), so resends never duplicate.
    const clientMsgId = uuidv4();

    const payload = {
      clientMsgId,
      text: trimmedInput || null,
      senderId: user.id,
      sender: user.displayName || t('chat.anonymous'),
      avatar,
      isPro,
      robloxUsernameVerified: verified,
      topBadge,
      hasRecentGameWin: hasWin,
      profileFrame: frame,
      chatTextColor: txtColor,
      chatBubbleBg: bubbleBg,
      replyTo: replyToArg ? { id: replyToArg.id, text: replyToArg.text } : null,
      containsLink,
      isAdmin: !!isAdmin,
      isModerator: !!user?.isModerator,
      isBabyMod: !!user?.isBabyMod,
      isTrusted: !!user?.isTrusted,
      isCMSR: !!user?.isCMSR,
      isHelper: !!user?.isHelper,
      strikeCount: strikeInfo?.strikeCount ?? null,
      fruits: hasFruits ? fruits : [],
      gif: hasEmoji ? emojiUrl : null,
      flage: user.flage || null,
      OS: Platform.OS,
    };

    // Optimistic placeholder. Uses a tmp: prefix so the real server id
    // (a Postgres UUID) never collides. The realtime INSERT echo and/or
    // the REST response will upgrade this row via clientMsgId match.
    const optimistic = {
      id: `tmp:${clientMsgId}`,
      clientMsgId,
      timestamp: Date.now(),
      reactions: {},
      _pending: true,
      roomId,
      ...payload,
    };

    setMessages(prev => [optimistic, ...prev]);

    // Reset input immediately so typing feels instant.
    setInput('');
    setReplyTo(null);
    lastSentMessageRef.current = currentMessage;
    setIsCooldown(true);
    setTimeout(() => setIsCooldown(false), MESSAGE_COOLDOWN);

    try {
      const saved = await sbSendMessage(roomId, payload);
      // Upgrade the optimistic placeholder to the server row. The
      // realtime INSERT handler may beat us to it; both paths use
      // clientMsgId matching and are idempotent.
      setMessages(prev => prev.map(m =>
        m.clientMsgId === clientMsgId
          ? { ...saved, reactions: m.reactions || {} }
          : m,
      ));

      // 🏅 Track message count & award chatty badge (fire-and-forget)
      incrementAndCheckBadge(appdatabase, user.id, 'messageCount', MESSAGE_BADGE_THRESHOLDS);
    } catch (error) {
      console.warn('Send failed, queueing for retry:', error?.message || error);
      // Mark optimistic as failed + queue for retry on reconnect.
      setMessages(prev => prev.map(m =>
        m.clientMsgId === clientMsgId ? { ...m, _pending: false, _failed: true } : m,
      ));
      if (retryQueueRef.current.length < RETRY_QUEUE_CAP) {
        retryQueueRef.current.push({ roomId, message: payload });
      } else {
        Alert.alert(t('home.alert.error'), t('chat.send_error'));
      }
    }
  };



  return (
    <>
      <GestureHandlerRootView>

        <View style={styles.container}>
          {/* ✅ Channel Pill Switcher */}
          <ScrollView
            horizontal
            maxHeight={Platform.OS === 'ios' ? 50 : 35}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={channelTabStyles.scrollContent}
          >
            {orderedChannels.map((channel) => {
              const isActive = channel.id === activeChannel.id;
              return (
                <TouchableOpacity
                  key={channel.id}
                  style={[
                    channelTabStyles.pill,
                    isActive
                      ? { backgroundColor: config.colors.primary, borderColor: config.colors.primary }
                      : { backgroundColor: 'transparent', borderColor: theme === 'dark' ? '#444' : '#ccc' },
                  ]}
                  onPress={() => handleChannelSwitch(channel)}
                  activeOpacity={0.8}
                >
                  <Text style={{ fontSize: 13, marginRight: 5 }}>{channel.flag}</Text>
                  <Text
                    style={[
                      channelTabStyles.pillText,
                      { color: isActive ? '#fff' : (theme === 'dark' ? '#aaa' : '#666') },
                      isActive && channelTabStyles.pillTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {channel.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <ChatHeaderContent
            pinnedMessages={pinnedMessages}
            onUnpinMessage={unpinSingleMessage}
            selectedTheme={selectedTheme}
            modalVisibleChatinfo={modalVisibleChatinfo}
            setModalVisibleChatinfo={setModalVisibleChatinfo}
            triggerHapticFeedback={triggerHapticFeedback}
            onlineUsersVisible={onlineUsersVisible}
            setOnlineUsersVisible={setOnlineUsersVisible}
          />

          <ConditionalKeyboardWrapper style={{ flex: 1 }} chatscreen={true}>
            {loading ? (
              <ActivityIndicator size="large" color="#1E88E5" style={{ flex: 1 }} />
            ) : (
              <MessagesList
                messages={messages}
                user={user}
                flatListRef={flatListRef}
                isDarkMode={theme === 'dark'}
                onPinMessage={handlePinMessage}
                onDeleteMessage={handleDeleteOne}
                // isAdmin={isAdmin}
                refreshing={refreshing}
                onRefresh={handleRefresh}
                onDeleteAllMessage={handleDeleteAllFromSender}
                handleLoadMore={handleLoadMore}
                onReply={(message) => { setReplyTo(message); triggerHapticFeedback('impactLight'); }} // Pass selected message to MessageInput
                banUser={banUser}
                // makeadmin={makeAdmin}
                // onReport={onReport}
                // removeAdmin={removeAdmin}
                unbanUser={unbanUser}
                // isOwner={isOwner}
                isAtBottom={isAtBottom}
                setIsAtBottom={setIsAtBottom}
                pendingCount={pendingMessages.length}
                // toggleDrawer={toggleDrawer}
                setMessages={setMessages}
                isAdmin={isAdmin}
                toggleDrawer={openProfileDrawer}
                onReaction={handleReaction}
                supabaseRoomId={roomId}

              />
            )}
            {!localState.isPro && <BannerAdComponent />}
            {user.id ? (
              <MessageInput
                input={input}
                setInput={setInput}
                handleSendMessage={handleSendMessage}
                selectedTheme={selectedTheme}
                replyTo={replyTo} // Pass reply context to MessageInput
                onCancelReply={() => setReplyTo(null)} // Clear reply context
                petModalVisible={petModalVisible}
                setPetModalVisible={setPetModalVisible}
                selectedFruits={selectedFruits}
                setSelectedFruits={setSelectedFruits}
                selectedEmoji={selectedEmoji}
                setSelectedEmoji={setSelectedEmoji}
                activeChannelId={activeChannel.id}
              />
            ) : (
              <TouchableOpacity
                style={styles.login}
                onPress={() => {
                  setIsSigninDrawerVisible(true); triggerHapticFeedback('impactLight');
                }}
              >
                <Text style={styles.loginText}>{t('misc.loginToStartChat')}</Text>
              </TouchableOpacity>

            )}
            <PetModal
              fromChat={true}
              visible={petModalVisible}
              onClose={() => setPetModalVisible(false)}
              selectedFruits={selectedFruits}
              setSelectedFruits={setSelectedFruits}




            />
          </ConditionalKeyboardWrapper>

          <SignInDrawer
            visible={isSigninDrawerVisible}
            onClose={handleLoginSuccess}
            selectedTheme={selectedTheme}
            message={t('misc.loginRequired')}
            screen='Chat'

          />
        </View>
        <ProfileBottomDrawer
          isVisible={isDrawerVisible}
          toggleModal={closeProfileDrawer}
          startChat={startPrivateChat}
          selectedUser={selectedUser}
          isOnline={false}
          bannedUsers={bannedUsers}
        />
      </GestureHandlerRootView>


      {/* {!localState.isPro && <View style={{ alignSelf: 'center' }}>
        {isAdVisible && (
          <BannerAd
            unitId={bannerAdUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            onAdLoaded={() => setIsAdVisible(true)}
            onAdFailedToLoad={() => setIsAdVisible(false)}
            requestOptions={{
              requestNonPersonalizedAdsOnly: true,
            }}
          />
        )}
      </View>} */}
    </>
  );
};

const channelTabStyles = RNStyleSheet.create({
  scrollContent: {
    paddingHorizontal: 12,
    // paddingVertical: 3,
    alignItems: 'center',
    gap: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 10.5,
    fontWeight: '500',
  },
  pillTextActive: {
    fontWeight: '700',
  },
});

export default React.memo(ChatScreen);
