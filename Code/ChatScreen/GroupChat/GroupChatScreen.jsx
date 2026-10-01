import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  ActivityIndicator,
  Alert,
  Text,
  RefreshControl,
  TouchableOpacity,
  Modal,
  FlatList,
  Image,
} from 'react-native';
import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';
import { getStyles } from '../Style';
import GroupMessageInput from './GroupMessageInput';
import GroupMessageList from './GroupMessageList';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { setActiveChat, clearActiveChat, setActiveGroupChat, clearActiveGroupChat } from '../utils';
import { resetGroupUnreadCount } from '../../Supabase/groupMetaBackend';
import {
  loadGroupMessages,
  loadGroupMessagesSince,
  subscribeToGroupMessages,
  softDeleteGroupMessage,
  softDeleteGroupMessagesBySender,
  toggleGroupReaction,
} from '../../Supabase/groupMessagesBackend';
// RTDB still needed for /banned_users_by_email, /presence, and the
// legacy group_meta_data path. Message bodies + reactions are on Supabase.
import { get, ref } from '@react-native-firebase/database';
import { getIdentity } from '../../Supabase/userBackend';
import { useTranslation } from 'react-i18next';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { sendGroupMessage, removeMemberFromGroup, hasGroupPermission, getPendingInviteForGroup, acceptGroupInvite, declineGroupInvite, leaveGroup, makeMemberCreator } from '../utils/groupUtils';
import { doc, getDoc, onSnapshot, collection, query, where, getDocs } from '@react-native-firebase/firestore';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import Icon from 'react-native-vector-icons/Ionicons';
import { showSuccessMessage, showErrorMessage } from '../../Helper/MessageHelper';
import { validateContent } from '../../Helper/ContentModeration';
import { showMessage } from 'react-native-flash-message';
import ProfileBottomDrawer from './BottomDrawer';
import { useMessageTranslation } from '../../Helper/useMessageTranslation';
import { useLocalState } from '../../LocalGlobelStats';
import PetModal from '../PrivateChat/PetsModel';
import config from '../../Helper/Environment';
import { serverNowMs } from '../../Helper/serverTime';
import InterstitialAdManager from '../../Ads/IntAd';
import BannerAdComponent from '../../Ads/bannerAds';
import { seedCurrentUser, getCachedProfile } from '../../Helper/profileCache';


const INITIAL_PAGE_SIZE = 10; // ✅ Initial load: 10 messages
const PAGE_SIZE = 10; // ✅ Pagination: load 10 messages per batch
const MEMBER_STATUS_BATCH_SIZE = 5; // ✅ Load 5 member statuses at a time
// Cap the live in-memory list so a long session can't grow it unbounded
// (every insert re-sorts the whole array → JS-thread freeze over time).
// Scrolling past this re-fetches older pages from Supabase.
const MAX_LIVE = 150;

// Last messages seen per group, in memory for this app session, so reopening a
// group paints instantly while the fresh page loads (same scheme as
// PrivateChat). Keyed by viewer + group; only read after membership is
// confirmed (loadMessages bails for non-members).
const CACHE_MAX_GROUPS = 20;
const CACHE_PER_GROUP = 50;
const groupMessageCache = new Map(); // `${uid}:${groupId}` -> messages, newest first

const writeCachedGroupMessages = (key, msgs) => {
  if (!key || !Array.isArray(msgs) || msgs.length === 0) return;
  groupMessageCache.delete(key);
  groupMessageCache.set(key, msgs.slice(0, CACHE_PER_GROUP));
  if (groupMessageCache.size > CACHE_MAX_GROUPS) {
    groupMessageCache.delete(groupMessageCache.keys().next().value);
  }
};

const cursorOf = (m) => (m
  ? { createdAt: m.createdAt || new Date(m.timestamp).toISOString(), id: m.id }
  : null);

// Merge incoming rows into a newest-first list, skipping ones already present
// (by id or client_msg_id), and cap the live list.
const mergeIncoming = (prev, incoming) => {
  const list = Array.isArray(prev) ? prev : [];
  const ids = new Set();
  const clientIds = new Set();
  list.forEach((m) => {
    ids.add(String(m?.id));
    if (m?.clientMsgId) clientIds.add(String(m.clientMsgId));
  });
  const fresh = incoming.filter((m) => m
    && !ids.has(String(m.id))
    && !(m.clientMsgId && clientIds.has(String(m.clientMsgId))));
  if (fresh.length === 0) return list;
  const sorted = [...fresh, ...list].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
  return sorted.length > MAX_LIVE ? sorted.slice(0, MAX_LIVE) : sorted;
};

// A first page fetched while the membership check runs is used only if it is
// this fresh; anything older (e.g. the user joined much later) is refetched.
const PREFETCH_MAX_AGE_MS = 10000;

const GroupChatScreen = () => {
  const insets = useSafeAreaInsets();
  const route = useRoute();
  const navigation = useNavigation();
  const { groupId } = route.params || {};

  const { user, theme, appdatabase, firestoreDB, isAdmin, isRTDBConnected, isUserBlocked, deviceBanInfo, strikeInfo } = useGlobalState();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [groupData, setGroupData] = useState(null);
  const [isPaginating, setIsPaginating] = useState(false);
  const [onlineMembers, setOnlineMembers] = useState([]);
  const [loadedMemberStatuses, setLoadedMemberStatuses] = useState(new Set()); // Track which members' status we've checked
  const [loadingMemberStatuses, setLoadingMemberStatuses] = useState(false);
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [pendingInvite, setPendingInvite] = useState(null);
  const [pendingInvitations, setPendingInvitations] = useState([]); // All pending invitations for the group
  const [isMember, setIsMember] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUserForDrawer, setSelectedUserForDrawer] = useState(null);
  const [memberToMakeCreator, setMemberToMakeCreator] = useState(null);
  const [petModalVisible, setPetModalVisible] = useState(false);
  const [selectedFruits, setSelectedFruits] = useState([]);
  const [replyTo, setReplyTo] = useState(null); // Reply to message state
  const [highlightedMessageId, setHighlightedMessageId] = useState(null); // Highlighted message ID
  // strikeInfo comes from GlobelStats context (app-wide ban listener) —
  // the per-screen duplicate banned_users_by_email listener was removed.
  const flatListRef = useRef(null); // Ref for FlatList in GroupMessageList
  // Supabase composite cursor: { createdAt: ISO, id: uuid } of the oldest
  // message currently in `messages`. null when no older page known yet OR
  // end-of-history reached (handleLoadMore returns early when null).
  const oldestCursorRef = useRef(null);
  const messagesRef = useRef([]);
  const initialLoadDoneRef = useRef(false);
  const paginatingRef = useRef(false);
  // First page requested in parallel with the Firestore membership check —
  // { groupId, at, promise }. Saves a full round trip on every open.
  const prefetchRef = useRef(null);
  const previousGroupIdRef = useRef(null);
  const hasSentMessageRef = useRef(0); // ✅ Track number of messages sent (for exit ad)
  const chatEnterTimeRef = useRef(null); // ✅ Track when user entered chat (for exit ad)
  const highlightTimerRef = useRef(null); // Track highlight timeout for cleanup
  // Set true when another member's message lands while this group is focused.
  // fanout_group_message_meta bumps our unread_count server-side even though
  // we're reading live, so we reset once on blur — gated so quiet visits add
  // no extra write.
  const unreadWhileFocusedRef = useRef(false);

  const { t } = useTranslation();

  // ✅ Check if current user is banned — global gate covers email + device
  const isMeBanned = isUserBlocked;
  const myBanDetails = strikeInfo || deviceBanInfo;

  // ✅ PHASE 0B: Seed current user's profile into cache on mount
  useEffect(() => {
    if (user?.id) seedCurrentUser(user, null, appdatabase);
  }, [user?.id, user?.avatar]);

  // Message translation — same handler and same daily allowance the community
  // chat uses. GroupMessageList already supported an `onTranslate` prop; group
  // chat just never passed one, so the option never appeared. (2026-09-02)
  const { handleTranslate } = useMessageTranslation();

  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  // Start the first message page now instead of after the membership check.
  // Non-members never see it: loadMessages only consumes it once isMember is
  // true, and the group_messages RLS returns nothing to non-members anyway.
  useEffect(() => {
    if (!groupId || !user?.id) return;
    prefetchRef.current = {
      groupId,
      at: Date.now(),
      promise: loadGroupMessages(groupId, { limit: INITIAL_PAGE_SIZE }).catch(() => null),
    };
  }, [groupId, user?.id]);

  // Load group data from Firestore and check access
  useEffect(() => {
    if (!groupId || !firestoreDB || !user?.id) return;

    setCheckingAccess(true);
    const groupRef = doc(firestoreDB, 'groups', groupId);
    const unsubscribe = onSnapshot(
      groupRef,
      async (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setGroupData(data);

          // Check if user is a member
          const memberIds = data.memberIds || [];
          const userIsMember = memberIds.includes(user.id) || isAdmin || !!user?.isModerator;
          setIsMember(userIsMember);

          // If not a member, check for pending invitation
          if (!userIsMember) {
            const inviteResult = await getPendingInviteForGroup(firestoreDB, groupId, user.id);
            if (inviteResult.success) {
              setPendingInvite({
                id: inviteResult.inviteId,
                ...inviteResult.inviteData,
              });
            } else {
              setPendingInvite(null);
            }
          } else {
            setPendingInvite(null);
          }
        } else {
          Alert.alert(t('chat.error'), t('chat.group_not_found'));
          setGroupData(null);
        }
        setCheckingAccess(false);
      },
      (error) => {
        console.error('Error loading group data:', error);
        showErrorMessage(t('chat.error'), t('chat.group_load_failed'));
        setCheckingAccess(false);
      }
    );

    return () => unsubscribe();
  }, [groupId, firestoreDB, user?.id]);

  // ✅ Function to load a batch of member statuses
  const loadMemberStatusesBatch = useCallback(async (memberIds) => {
    if (!appdatabase || memberIds.length === 0 || loadingMemberStatuses) return;

    // ✅ Filter out already loaded members to prevent duplicate checks
    const unloadedIds = memberIds.filter(id => !loadedMemberStatuses.has(id));
    if (unloadedIds.length === 0) {
      // All members in this batch are already loaded, no need to fetch
      return;
    }

    setLoadingMemberStatuses(true);
    try {
      // ✅ Check each member's presence in parallel (only unloaded ones)
      const presencePromises = unloadedIds.map(async (memberId) => {
        try {
          const memberPresenceRef = ref(appdatabase, `presence/${memberId}`);
          const snapshot = await get(memberPresenceRef);
          const isOnline = snapshot.exists() && snapshot.val() === true;
          return { memberId, isOnline };
        } catch (error) {
          return { memberId, isOnline: false };
        }
      });

      const results = await Promise.all(presencePromises);

      // ✅ Update online members list
      setOnlineMembers((prev) => {
        const newSet = new Set(prev);
        results.forEach(({ memberId, isOnline }) => {
          if (isOnline) {
            newSet.add(memberId);
          } else {
            newSet.delete(memberId);
          }
        });
        return Array.from(newSet);
      });

      // ✅ Track which members we've loaded (only the ones we actually checked)
      setLoadedMemberStatuses((prev) => {
        const newSet = new Set(prev);
        unloadedIds.forEach((id) => newSet.add(id));
        return newSet;
      });
    } catch (error) {
      console.error('Error loading member statuses:', error);
    } finally {
      setLoadingMemberStatuses(false);
    }
  }, [appdatabase, loadingMemberStatuses, loadedMemberStatuses]);

  // ✅ Reset when modal closes
  useEffect(() => {
    if (!showMembersModal) {
      setOnlineMembers([]);
      setLoadedMemberStatuses(new Set());
      return;
    }
  }, [showMembersModal]);

  // ✅ Load first batch of member statuses when modal opens
  useEffect(() => {
    if (!showMembersModal || !groupData || !appdatabase || !user?.id) {
      return;
    }

    const groupMemberIds = groupData.memberIds || [];
    if (groupMemberIds.length === 0) {
      return;
    }

    // ✅ Load first batch of members' status
    const loadFirstBatch = async () => {
      const firstBatch = groupMemberIds.slice(0, MEMBER_STATUS_BATCH_SIZE);
      await loadMemberStatusesBatch(firstBatch);
    };

    loadFirstBatch();
  }, [showMembersModal, groupData, appdatabase, user?.id, loadMemberStatusesBatch]);

  // ✅ OPTIMIZED: Load pending invitations ONLY when members modal opens (lazy loading)
  const fetchPendingInvitations = useCallback(async () => {
    if (!groupId || !firestoreDB || !groupData || !appdatabase) {
      setPendingInvitations([]);
      return;
    }

    try {
      const invitationsQuery = query(
        collection(firestoreDB, 'group_invitations'),
        where('groupId', '==', groupId),
        where('status', '==', 'pending')
      );
      const snapshot = await getDocs(invitationsQuery);

      const invitations = [];
      const memberIds = groupData.memberIds || [];

      // ✅ OPTIMIZED: Use stored invited user data first, only fetch from RTDB users node if needed (lazy loading)
      let onlineUsersMap = null; // Lazy load only if needed

      // ✅ Process invitations - Show the INVITED USER's info (not the creator who sent it)
      for (const docSnapshot of snapshot.docs) {
        const data = docSnapshot.data();
        // Check if invitation is expired and user is not already a member
        if (data.expiresAt && Date.now() < data.expiresAt && !memberIds.includes(data.invitedUserId)) {
          // ✅ Priority: Use stored data first, then fallback to RTDB users node, then "Anonymous"
          const invitedUserId = data.invitedUserId;
          let displayName = 'Anonymous';
          let avatar = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

          // 1. First priority: Use stored data from invitation document (NO Firestore read needed)
          if (data.invitedUserDisplayName) {
            displayName = data.invitedUserDisplayName;
          }
          if (data.invitedUserAvatar) {
            avatar = data.invitedUserAvatar;
          }

          // 2. Fallback: lazy-load via Supabase identity (single row instead
          // of 2 RTDB reads). Only fires when invite doc lacked the stored fields.
          if (displayName === 'Anonymous' && invitedUserId && onlineUsersMap === null) {
            const ident = await getIdentity(invitedUserId).catch(() => null);
            if (ident && (ident.displayName || ident.avatar)) {
              onlineUsersMap = {
                [invitedUserId]: {
                  displayName: ident.displayName || 'Anonymous',
                  avatar: ident.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                },
              };
            } else {
              onlineUsersMap = {}; // mark loaded-empty to avoid retrying
            }
          }

          // 3. Use RTDB users node data if available
          if (displayName === 'Anonymous' && invitedUserId && onlineUsersMap) {
            const invitedUserData = onlineUsersMap[invitedUserId];
            if (invitedUserData) {
              displayName = invitedUserData.displayName || 'Anonymous';
              avatar = invitedUserData.avatar || avatar;
            }
          }

          invitations.push({
            id: docSnapshot.id,
            invitedUserId: invitedUserId, // The person who was invited
            displayName: displayName,
            avatar: avatar,
            invitedBy: data.invitedBy, // Store who sent the invitation (for reference)
          });
        }
      }
      setPendingInvitations(invitations);
    } catch (error) {
      console.error('Error fetching pending invitations:', error);
      setPendingInvitations([]);
    }
  }, [groupId, firestoreDB, groupData, appdatabase]);


  // ✅ Load pending invitations only when members modal opens AND user is creator
  useEffect(() => {
    if (!showMembersModal || !groupData || !user?.id) {
      setPendingInvitations([]);
      return;
    }

    // ✅ Only show pending invitations to creator
    const isCreator = groupData.createdBy === user.id;

    if (isCreator) {
      fetchPendingInvitations();
    } else {
      // Regular members don't see pending invitations
      setPendingInvitations([]);
    }
  }, [showMembersModal, fetchPendingInvitations, groupData, user?.id]);

  // Load messages with Supabase composite (created_at desc, id desc) cursor.
  // Mirrors PrivateChat — Supabase returns newest-first already, matching
  // the inverted-FlatList render order. The pagination cursor is
  // (createdAt ISO, id) of the oldest row in current state.
  const loadMessages = useCallback(
    async (reset = false) => {
      if (!groupId || !isMember) return;

      const cacheKey = user?.id ? `${user.id}:${groupId}` : null;
      if (reset) {
        initialLoadDoneRef.current = false;
        const cached = cacheKey ? groupMessageCache.get(cacheKey) : null;
        if (cached?.length) {
          // Paint the last-seen messages now; the fresh page merges in below.
          setMessages(cached);
          setLoading(false);
          oldestCursorRef.current = cursorOf(cached[cached.length - 1]);
        } else {
          setLoading(true);
          setMessages([]);
          oldestCursorRef.current = null;
        }
      } else {
        if (paginatingRef.current) return;
        paginatingRef.current = true;
        setIsPaginating(true);
      }

      try {
        const limitSize = reset ? INITIAL_PAGE_SIZE : PAGE_SIZE;
        const before = reset ? null : oldestCursorRef.current;

        let parsedMessages = null;
        const pre = prefetchRef.current;
        if (reset && pre && pre.groupId === groupId && Date.now() - pre.at < PREFETCH_MAX_AGE_MS) {
          prefetchRef.current = null;
          parsedMessages = await pre.promise;
        }
        if (!parsedMessages) {
          parsedMessages = await loadGroupMessages(groupId, { limit: limitSize, before });
        }

        if (parsedMessages.length === 0) {
          if (!reset) oldestCursorRef.current = null;
          return;
        }

        if (reset) {
          // Fresh newest page wins; rows outside its time range survive
          // (older cached history, newer realtime inserts). A row inside the
          // range but missing from it was deleted.
          const newestFresh = parsedMessages[0]?.timestamp || 0;
          const oldestFresh = parsedMessages[parsedMessages.length - 1]?.timestamp || 0;
          const freshIds = new Set(parsedMessages.map((m) => String(m?.id)));
          setMessages((prev) => {
            const keep = (Array.isArray(prev) ? prev : []).filter((m) => m
              && !freshIds.has(String(m.id))
              && ((m.timestamp || 0) < oldestFresh || (m.timestamp || 0) > newestFresh));
            const merged = [...parsedMessages, ...keep]
              .sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
            oldestCursorRef.current = cursorOf(merged[merged.length - 1]);
            return merged;
          });
          return;
        }

        setMessages((prev) => {
          if (!Array.isArray(prev)) return parsedMessages;
          const existingIds = new Set(prev.map((m) => String(m?.id)));
          const onlyNew = parsedMessages.filter((m) => !existingIds.has(String(m?.id)));
          const combined = [...prev, ...onlyNew];
          return combined.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
        });

        oldestCursorRef.current = cursorOf(parsedMessages[parsedMessages.length - 1]);
      } catch (err) {
        console.warn('Error loading messages:', err);
      } finally {
        if (reset) {
          setLoading(false);
          initialLoadDoneRef.current = true;
        } else {
          paginatingRef.current = false;
          setIsPaginating(false);
        }
      }
    },
    [groupId, isMember, user?.id],
  );

  // Load messages when groupId changes (only if user is a member)
  useEffect(() => {
    if (!groupId || !isMember) return;

    const currentGroupId = groupId;
    const previousGroupId = previousGroupIdRef.current;

    if (currentGroupId !== previousGroupId) {
      previousGroupIdRef.current = currentGroupId;
      loadMessages(true);
    } else if (previousGroupId === null) {
      previousGroupIdRef.current = currentGroupId;
      loadMessages(true);
    }
  }, [groupId, loadMessages, isMember]);

  // Supabase realtime stream for INSERT / UPDATE / DELETE on this group.
  // INSERTs feed all messages (own + others'); we don't optimistic-render
  // any more — same as PrivateChat. UPDATEs cover soft-deletes AND the
  // reactions jsonb edits (toggle_group_reaction touches the row), so
  // cross-user reactions sync automatically without a second subscription.
  // Hard DELETE is rare; remove by id when it fires.
  //
  // Realtime never replays what it missed: every SUBSCRIBED (re-focus, or the
  // rejoin after a background disconnect) fetches only rows newer than the
  // newest on screen. Without it, messages sent during the gap never showed
  // until the group was closed and reopened.
  useFocusEffect(
    useCallback(() => {
      if (!groupId || !isMember) return undefined;

      let active = true;
      let gapFillInFlight = false;
      const gapFill = () => {
        if (!active || gapFillInFlight || !initialLoadDoneRef.current) return;
        gapFillInFlight = true;
        loadGroupMessagesSince(groupId, cursorOf(messagesRef.current[0]), { limit: 50 })
          .then((rows) => {
            if (active && rows.length > 0) setMessages((prev) => mergeIncoming(prev, rows));
          })
          .catch((e) => console.warn('[GroupChat] gap-fill failed:', e?.message))
          .finally(() => { gapFillInFlight = false; });
      };

      const unsubscribe = subscribeToGroupMessages(groupId, {
        onStatus: (status) => {
          if (status === 'SUBSCRIBED') gapFill();
        },
        onInsert: (newMessage) => {
          if (!newMessage) return;
          // Another member's message bumped our unread_count server-side while
          // we're viewing — flag it so the blur cleanup clears it once.
          if (newMessage.senderId && newMessage.senderId !== user?.id) {
            unreadWhileFocusedRef.current = true;
          }
          setMessages((prev) => mergeIncoming(prev, [newMessage]));
        },
        onUpdate: (updated) => {
          if (!updated) return;
          setMessages((prev) => {
            if (!Array.isArray(prev)) return prev;
            if (updated.deleted) {
              return prev.filter((m) => String(m?.id) !== String(updated.id));
            }
            return prev.map((m) => (String(m?.id) === String(updated.id) ? updated : m));
          });
        },
        onDelete: (id) => {
          if (!id) return;
          setMessages((prev) =>
            Array.isArray(prev) ? prev.filter((m) => String(m?.id) !== String(id)) : prev,
          );
        },
      });

      return () => {
        active = false;
        unsubscribe();
      };
    }, [groupId, isMember, user?.id]),
  );

  // Set active chat and reset unread count
  useFocusEffect(
    useCallback(() => {
      if (!user?.id || !groupId) return;

      // Set active chat (both for private chat pattern and group batch checking)
      setActiveChat(user.id, groupId);
      setActiveGroupChat(user.id, groupId);

      // ✅ Reset refs when entering chat (for exit ad logic)
      hasSentMessageRef.current = 0;
      chatEnterTimeRef.current = Date.now();
      unreadWhileFocusedRef.current = false;

      // Only reset unread if user is an actual member (in memberIds).
      // Admins/mods can view groups without joining — skip writes to
      // prevent ghost entries in the "joined groups" list.
      const isRealMember = groupData?.memberIds?.includes(user.id);
      if (isRealMember) {
        // Phase 5 clean-cut: no RTDB group_meta_data write. The badge
        // reset goes straight to Supabase; static fields (name/avatar/
        // memberCount/createdBy) are seeded by the create/join flows and
        // the send fan-out, so chat-open doesn't need to re-write them.
        resetGroupUnreadCount(user.id, groupId);
      }

      return () => {
        clearActiveChat(user.id);
        clearActiveGroupChat(user.id, groupId);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        // Phantom-badge fix: messages received while viewing bumped our
        // unread_count. Clear once on blur, only if something arrived and
        // we're a real member (mirrors the enter-reset gate).
        if (unreadWhileFocusedRef.current) {
          unreadWhileFocusedRef.current = false;
          if (groupData?.memberIds?.includes(user.id)) {
            resetGroupUnreadCount(user.id, groupId);
          }
        }
      };
    }, [user?.id, groupId, appdatabase, groupData?.name, groupData?.avatar, groupData?.memberIds?.length, groupData?.createdBy])
  );

  // Handle refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMessages(true);
    setRefreshing(false);
  }, [loadMessages]);

  // Keep the session cache and the gap-fill ref in step with what's on screen.
  useEffect(() => {
    messagesRef.current = messages;
    if (user?.id && groupId && isMember) writeCachedGroupMessages(`${user.id}:${groupId}`, messages);
  }, [messages, user?.id, groupId, isMember]);

  // Handle load more
  const handleLoadMore = useCallback(() => {
    // Ref guard: onEndReached can fire twice before isPaginating re-renders.
    if (paginatingRef.current || !oldestCursorRef.current || !isMember) {
      return;
    }
    loadMessages(false);
  }, [loadMessages, isMember]);

  // Scroll to message function (for reply navigation)
  const scrollToMessage = useCallback(
    (targetId) => {
      if (!flatListRef?.current || !targetId) return;

      // Filtered messages are sorted descending (newest first) for inverted FlatList
      const filteredMessages = [...messages].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
      const index = filteredMessages.findIndex((m) => m.id === targetId);
      if (index === -1) return;

      try {
        flatListRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });

        // Highlight the scrolled-to message
        setHighlightedMessageId(targetId);

        // Clear any previous highlight timer before setting a new one
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          highlightTimerRef.current = null;
          setHighlightedMessageId((current) =>
            current === targetId ? null : current,
          );
        }, 1500);
      } catch (e) {
        console.log('scrollToIndex error:', e);
        // Fallback: try scrolling to offset
        try {
          const offset = index * 100; // Approximate height per message
          flatListRef.current.scrollToOffset({ offset, animated: true });
        } catch (e2) {
          console.log('scrollToOffset error:', e2);
        }
      }
    },
    [messages],
  );

  // Handle reply to message
  const handleReply = useCallback((message) => {
    setReplyTo({
      id: message.id,
      text: message.text || '',
      sender: message.sender || 'Anonymous',
      hasFruits: Array.isArray(message.fruits) && message.fruits.length > 0,
      fruitsCount: Array.isArray(message.fruits) ? message.fruits.length : 0,
      imageUrl: message.imageUrl || null,
    });
  }, []);

  // Cancel reply
  const handleCancelReply = useCallback(() => {
    setReplyTo(null);
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (text, image, fruits, replyToMessage) => {
      const trimmedText = (text || '').trim();
      // Handle both single image (string) and multiple images (array)
      const hasImage = !!image && (typeof image === 'string' || (Array.isArray(image) && image.length > 0));
      const hasFruits = Array.isArray(fruits) && fruits.length > 0;

      // Validate fruits count - maximum 18 fruits allowed
      if (hasFruits && fruits.length > 18) {
        showErrorMessage(t('home.alert.error'), t('chat.max_items_per_message', { max: 18 }));
        return;
      }

      // ✅ Ban check
      if (isMeBanned) {
        const reason = myBanDetails?.reason || 'Access Denied';
        showErrorMessage(t("chat.access_denied", { defaultValue: 'Access Denied' }), t("chat.banned_message", { defaultValue: `You are banned: ${reason}` }));
        return;
      }

      // ✅ Strike/Temporal Ban Check
      if (strikeInfo) {
        const { strikeCount, bannedUntil } = strikeInfo;
        // Server-time estimate — a raw Date.now() here let users roll the
        // device clock forward to slip past temp bans. (isMeBanned above is
        // the authoritative server-probed gate; this block is the friendly
        // time-remaining message.)
        const now = serverNowMs();

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
          const timeLeftText = hours > 0
            ? t('chat.duration_hours_minutes', { hours, minutes })
            : t('chat.duration_minutes', { minutes });

          showMessage({
            message: t('chat.strike_title', { count: strikeCount }),
            description: t('chat.strike_time_left', { time: timeLeftText }),
            type: 'warning',
            duration: 5000,
          });
          return;
        }
      }

      // Block only if there's no text, no image AND no fruits
      if (!trimmedText && !hasImage && !hasFruits) {
        showErrorMessage(t('home.alert.error'), t('chat.cannot_empty'));
        return;
      }

      // Safety checks
      if (!user?.id || !groupId || !appdatabase || !firestoreDB) {
        showErrorMessage(t('home.alert.error'), t('chat.rating_missing_data'));
        return;
      }

      // ✅ Content filter backstop (kid-safety) — profanity/abuse/NSFW words.
      // Input box already validates; this guards any other send path. Admins and
      // full moderators (not baby mods) bypass. Links handled at input layer.
      if (trimmedText) {
        const canBypassModeration = !!isAdmin || (!!user?.isModerator && !user?.isBabyMod);
        const validation = validateContent(trimmedText, { skipLinkCheck: true, skipAll: canBypassModeration });
        if (!validation.isValid) {
          showErrorMessage(t('chat.content_not_allowed', { defaultValue: 'Content Not Allowed' }), validation.reason || t('chat.inappropriate_content', { defaultValue: 'Inappropriate content detected.' }));
          return;
        }
      }

      // Connection check — catches WiFi networks that block Firebase WebSocket connections.
      // Without this, the message silently queues in the local RTDB buffer, appears sent
      // to the sender, but never reaches Firebase servers or other users.
      if (!isRTDBConnected) {
        showErrorMessage(t('chat.no_connection_title'), t('chat.no_connection_message'));
        return;
      }

      // Check if user is member and not muted
      if (groupData) {
        const isMember = groupData.memberIds?.includes(user.id);
        const isMuted = groupData.members?.[user.id]?.muted;

        if (!isMember && !isAdmin && !user?.isModerator) {
          showErrorMessage(t('chat.error'), t('chat.not_group_member'));
          return;
        }

        if (isMuted) {
          showErrorMessage(t('chat.error'), t('chat.muted_in_group'));
          return;
        }
      }

      // Check if user is creator
      const isCreator = groupData?.createdBy === user.id;

      // Build message payload (full profile — matches community chat)
      const messageData = {
        text: trimmedText,
        senderId: user.id,
        sender: user.displayName || 'Anonymous',
        avatar: user.avatar || null,
        timestamp: Date.now(),
        isPro: !!localState?.isPro,
        robloxUsernameVerified: user?.robloxUsernameVerified || false,
        isCreator: isCreator,
      };

      if (hasImage) {
        // Store as array if multiple images, single string if one image
        if (Array.isArray(image)) {
          messageData.imageUrls = image; // Array of image URLs
          messageData.imageUrl = image[0]; // Keep first for backward compatibility
        } else {
          messageData.imageUrl = image; // Single image URL
        }
      }

      if (hasFruits) {
        messageData.fruits = fruits;
      }

      // Add replyTo if replying to a message
      if (replyToMessage && replyToMessage.id) {
        messageData.replyTo = {
          id: replyToMessage.id,
          text: replyToMessage.text || '',
          sender: replyToMessage.sender || 'Anonymous',
          imageUrl: replyToMessage.imageUrl || null,
          imageUrls: replyToMessage.imageUrls || null, // Support multiple images in reply
          hasFruits: replyToMessage.hasFruits || false,
          fruitsCount: replyToMessage.fruitsCount || 0,
        };
      }

      try {
        const result = await sendGroupMessage(
          appdatabase,
          firestoreDB,
          groupId,
          messageData,
          {
            id: user.id,
            displayName: user.displayName || 'Anonymous',
            avatar: user.avatar || null,
          },
          groupData
        );

        if (!result.success) {
          showErrorMessage(t('chat.error'), result.error || t('chat.send_error'));
        } else {
          // No optimistic insert — Supabase realtime UPDATE/INSERT feeds
          // own message back into state (same pattern as PrivateChat).
          setReplyTo(null);
          hasSentMessageRef.current += 1;
        }
      } catch (error) {
        console.error('Error sending message:', error);
        Alert.alert(t('chat.error'), t('chat.send_error'));
      }
    },
    [user, groupId, appdatabase, firestoreDB, groupData, t, localState?.isPro, strikeInfo, isMeBanned, myBanDetails, isRTDBConnected, isAdmin]
  );

  // Soft-delete a single message in Supabase. The realtime UPDATE
  // (deleted=true) is what removes it from every member's UI; we don't
  // optimistic-prune because the subscription does it.
  const handleDeleteMessage = useCallback((messageId) => {
    if (!messageId) return;
    Alert.alert(
      t('chat.delete_message_title'),
      t('chat.delete_message_prompt'),
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: t('chat.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await softDeleteGroupMessage(messageId, user?.id || null);
              showSuccessMessage(t('chat.success'), t('chat.message_deleted'));
            } catch (error) {
              console.error('Error deleting message:', error);
              showErrorMessage(t('chat.error'), t('chat.delete_error'));
            }
          },
        },
      ]
    );
  }, [user?.id, t]);

  // Soft-delete the last N non-deleted messages from a sender. Limit 300
  // matches the old RTDB scan window so the moderation UX is identical.
  const handleDeleteAllMessages = useCallback((senderId) => {
    if (!groupId || !senderId) return;
    Alert.alert(
      'Delete All Messages',
      'Delete all messages from this user?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              const { count } = await softDeleteGroupMessagesBySender(groupId, senderId, {
                limit: 300,
                deletedBy: user?.id || null,
              });
              if (count > 0) {
                showSuccessMessage('Success', `Deleted ${count} messages`);
              }
            } catch (error) {
              console.error('Error deleting all messages:', error);
              showErrorMessage('Error', 'Failed to delete messages');
            }
          },
        },
      ]
    );
  }, [groupId, user?.id]);

  // Toggle caller's reaction via Supabase RPC. The RPC returns the updated
  // row so we can promote optimistic state to canonical immediately; the
  // realtime UPDATE delivers the same row to every other member.
  const handleReaction = useCallback(async (messageId, emoji) => {
    if (!messageId || !user?.id) return;

    // Optimistic update mirrors the prior RTDB tap-same-removes semantics.
    setMessages((prev) => prev.map((m) => {
      if (String(m.id) !== String(messageId)) return m;
      const current = m.reactions?.[user.id];
      const newReactions = { ...(m.reactions || {}) };
      if (current === emoji) {
        delete newReactions[user.id];
      } else {
        newReactions[user.id] = emoji;
      }
      return { ...m, reactions: newReactions };
    }));

    try {
      // Pass the new emoji unconditionally. The RPC interprets
      // existing == new as a clear, matching the optimistic path.
      await toggleGroupReaction(messageId, emoji);
    } catch (error) {
      console.error('Error toggling reaction:', error);
      // Realtime UPDATE will eventually correct the optimistic state if
      // the server rejected the change.
    }
  }, [user?.id]);

  // Handle remove member (admin action)
  const handleRemoveMember = useCallback(async (memberId, memberName) => {
    if (!user?.id || !groupId) return;

    Alert.alert(
      t('chat.remove_member_title'),
      memberName
        ? t('chat.remove_member_confirm', { name: memberName })
        : t('chat.remove_member_confirm_unnamed'),
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: t('chat.remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await removeMemberFromGroup(
                firestoreDB,
                appdatabase,
                groupId,
                memberId,
                user.id
              );

              if (result.success) {
                showSuccessMessage(t('chat.success'), t('chat.member_removed'));
              } else {
                showErrorMessage(t('chat.error'), result.error || t('chat.remove_member_failed'));
              }
            } catch (error) {
              console.error('Error removing member:', error);
              showErrorMessage(t('chat.error'), t('chat.remove_member_failed'));
            }
          },
        },
      ]
    );
  }, [user?.id, groupId, firestoreDB, appdatabase, t]);

  // ✅ Handle making a member creator (with warning)
  // ✅ iOS Fix: Close members modal first, then show Alert (nested modals cause freezing on iOS)
  const handleMakeCreator = useCallback((memberId, memberName) => {
    // Close members modal first to avoid nested modal issues on iOS
    setShowMembersModal(false);

    // Use setTimeout to ensure modal closes before showing alert
    setTimeout(() => {
      const displayMemberName = memberName || t('chat.anonymous');
      Alert.alert(
        t('chat.transfer_creator_title'),
        t('chat.transfer_creator_message', { name: displayMemberName }),
        [
          {
            text: t('chat.cancel'),
            style: 'cancel',
            onPress: () => {
              setMemberToMakeCreator(null);
            },
          },
          {
            text: t('chat.transfer_creator_button'),
            style: 'destructive',
            onPress: async () => {
              if (!groupId || !firestoreDB || !appdatabase || !user?.id) {
                return;
              }

              try {
                const result = await makeMemberCreator(
                  firestoreDB,
                  appdatabase,
                  groupId,
                  memberId,
                  user.id
                );

                if (result.success) {
                  showSuccessMessage(t('chat.success'), t('chat.transfer_creator_success', { name: displayMemberName }));
                  setMemberToMakeCreator(null);
                } else {
                  showErrorMessage(t('chat.error'), result.error || t('chat.transfer_creator_failed'));
                }
              } catch (error) {
                console.error('Error making member creator:', error);
                showErrorMessage(t('chat.error'), t('chat.transfer_creator_failed'));
              }
            },
          },
        ],
        { cancelable: true }
      );
    }, 300); // Small delay to ensure modal closes
  }, [groupId, firestoreDB, appdatabase, user?.id, t]);


  const memberCount = groupData?.memberCount || 0;
  const isCreator = groupData && groupData.createdBy === user?.id;

  // Handle accept invitation
  const handleAcceptInvite = useCallback(async () => {
    if (!pendingInvite || !user?.id) return;

    try {
      const result = await acceptGroupInvite(
        firestoreDB,
        appdatabase,
        pendingInvite.id,
        {
          id: user.id,
          displayName: user.displayName || 'Anonymous',
          avatar: user.avatar || null,
        }
      );

      if (result.success) {
        showSuccessMessage(t('chat.success'), t('chat.joined_group'));
        setPendingInvite(null);
        setIsMember(true);

        // 🐝 Track group joins for socialBee badge (5+ groups)
        try {
          const { incrementAndCheckBadge, GROUP_CHAT_BADGE_THRESHOLDS } = require('./badgeUtils');
          incrementAndCheckBadge(appdatabase, user.id, 'groupJoinCount', GROUP_CHAT_BADGE_THRESHOLDS);
        } catch (e) {}
      } else {
        showErrorMessage(t('chat.error'), result.error || t('chat.accept_invite_failed'));
      }
    } catch (error) {
      console.error('Error accepting invitation:', error);
      showErrorMessage(t('chat.error'), t('chat.accept_invite_failed'));
    }
  }, [pendingInvite, user, firestoreDB, appdatabase, t]);

  // Handle decline invitation
  const handleDeclineInvite = useCallback(async () => {
    if (!pendingInvite || !user?.id) return;

    Alert.alert(
      t('chat.decline_invite_title'),
      t('chat.decline_invite_confirm'),
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: t('chat.decline'),
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await declineGroupInvite(firestoreDB, pendingInvite.id, user.id);
              if (result.success) {
                showSuccessMessage(t('chat.success'), t('chat.invite_declined'));
                setPendingInvite(null);
                navigation.goBack();
              } else {
                showErrorMessage(t('chat.error'), result.error || t('chat.decline_invite_failed'));
              }
            } catch (error) {
              console.error('Error declining invitation:', error);
              showErrorMessage(t('chat.error'), t('chat.decline_invite_failed'));
            }
          },
        },
      ]
    );
  }, [pendingInvite, user, firestoreDB, navigation, t]);

  // Handle leave group
  const handleLeaveGroup = useCallback(() => {
    if (!groupId || !user?.id) return;

    Alert.alert(
      t('chat.leave_group_title'),
      t('chat.leave_group_confirm'),
      [
        { text: t('chat.cancel'), style: 'cancel' },
        {
          text: t('chat.leave'),
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await leaveGroup(firestoreDB, appdatabase, groupId, user.id);
              if (result.success) {
                showSuccessMessage(t('chat.success'), t('chat.left_group'));
                navigation.goBack();
              } else {
                showErrorMessage(t('chat.error'), result.error || t('chat.leave_group_failed'));
              }
            } catch (error) {
              console.error('Error leaving group:', error);
              showErrorMessage(t('chat.error'), t('chat.leave_group_failed'));
            }
          },
        },
      ]
    );
  }, [groupId, user?.id, firestoreDB, appdatabase, navigation, t]);

  // Handle user press to open profile drawer
  const handleUserPress = useCallback(async (userData) => {
    if (!userData || !userData.senderId) return;

    // ✅ Enrich with cached avatar so drawer shows it instantly (no flash)
    const cached = getCachedProfile(userData.senderId);
    const resolvedAvatar = userData.avatar || cached?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

    setSelectedUserForDrawer({
      senderId: userData.senderId,
      sender: userData.sender || 'Anonymous',
      avatar: resolvedAvatar,
    });

    setIsDrawerVisible(true);
  }, []);

  // Open a DM with the member whose profile drawer is showing.
  // selectedUserForDrawer is already { senderId, sender, avatar }, which is
  // exactly the shape PrivateChat reads from route.params.selectedUser
  // (it keys off selectedUser.senderId).
  const startPrivateChat = useCallback(() => {
    if (!selectedUserForDrawer?.senderId) return;
    // Tapping your own avatar opens the drawer too; a DM with yourself would
    // just be a broken screen, so close instead of navigating.
    if (selectedUserForDrawer.senderId === user?.id) {
      setIsDrawerVisible(false);
      return;
    }
    setIsDrawerVisible(false);
    if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('PrivateChat', {
        selectedUser: selectedUserForDrawer,
        selectedTheme: theme,
      });
    }
  }, [selectedUserForDrawer, navigation, theme, user?.id]);

  // Get banned users from local state
  const { localState } = useLocalState();
  const bannedUsers = useMemo(() => {
    return Array.isArray(localState?.bannedUsers) ? localState.bannedUsers : [];
  }, [localState?.bannedUsers]);

  // Update header with member info and leave button
  useEffect(() => {
    if (!groupData) return;

    const isCreator = groupData?.createdBy === user?.id;

    // Truncate group name for header (max 30 characters)
    const groupName = groupData.name || t('chat.group_chat_fallback');
    const truncatedGroupName = groupName.length > 30 ? groupName.substring(0, 30).trim() + '...' : groupName;

    navigation.setOptions({
      headerBackVisible: true,
      headerTitle: () => (
        <Text
          style={{
            fontSize: 18,
            fontWeight: 'bold',
            color: c.text,
            textAlign: 'center',
          }}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {truncatedGroupName}
        </Text>
      ),
      headerTitleAlign: 'center',
      headerRight: () => (
        <TouchableOpacity
          onPress={() => setShowMembersModal(true)}
          style={{ flexDirection: 'row', alignItems: 'center', marginRight: 15 }}
        >
          <Icon name="people" size={20} color={c.text} />
          <Text style={{ marginLeft: 6, color: c.text, fontWeight: '500', fontSize: 14 }}>
            {memberCount}
          </Text>
        </TouchableOpacity>
      ),
    });
  }, [groupData, memberCount, isDarkMode, navigation, isMember, handleLeaveGroup, user?.id, t]);

  if (!groupId) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.text}>{t('chat.group_id_missing')}</Text>
      </View>
    );
  }

  if (checkingAccess) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={[styles.text, { marginTop: 16 }]}>{t('chat.loading')}</Text>
      </View>
    );
  }

  // Show invitation acceptance screen if user has pending invitation
  if (pendingInvite && !isMember) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Icon name="mail-outline" size={64} color={isDarkMode ? '#8B5CF6' : '#8B5CF6'} />
        <Text style={[styles.text, { fontSize: 24, fontWeight: 'bold', marginTop: 20, marginBottom: 10 }]}>
          {t('chat.group_invitation_title')}
        </Text>
        <Text style={[styles.text, { fontSize: 16, textAlign: 'center', marginBottom: 30, opacity: 0.7 }]} numberOfLines={2} ellipsizeMode="tail">
          {groupData?.name
            ? t('chat.group_invite_message', {
              name: groupData.name.length > 25 ? groupData.name.substring(0, 25).trim() + '...' : groupData.name,
            })
            : t('chat.group_invite_message_unnamed')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 15 }}>
          <TouchableOpacity
            onPress={handleDeclineInvite}
            style={{
              paddingHorizontal: 30,
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: c.border,
            }}
          >
            <Text style={{ color: c.text, fontWeight: '500', }}>{t('chat.decline')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleAcceptInvite}
            style={{
              paddingHorizontal: 30,
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: '#8B5CF6',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '500', }}>{t('chat.accept')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Show access denied if not a member and no pending invitation
  if (!isMember && !pendingInvite) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <Icon name="lock-closed-outline" size={64} color={c.textSecondary} />
        <Text style={[styles.text, { fontSize: 24, fontWeight: 'bold', marginTop: 20, marginBottom: 10 }]}>
          {t('chat.access_denied')}
        </Text>
        <Text style={[styles.text, { fontSize: 16, textAlign: 'center', marginBottom: 30, opacity: 0.7 }]}>
          {t('chat.not_member_wait_invite')}
        </Text>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{
            paddingHorizontal: 30,
            paddingVertical: 12,
            borderRadius: 8,
            backgroundColor: '#8B5CF6',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '500', }}>{t('chat.go_back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading && messages.length === 0) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color="#8B5CF6" />
        <Text style={[styles.text, { marginTop: 16 }]}>{t('chat.loading_messages')}</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ConditionalKeyboardWrapper style={{ flex: 1 }} privatechatscreen={true}>
        <View style={[styles.container, { position: 'relative' }]}>
          {messages.length === 0 && !loading ? (
            // No messages yet - show empty state but keep input visible
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{t('chat.no_messages_yet')}</Text>
            </View>
          ) : (
            <GroupMessageList
              messages={messages}
              userId={user?.id}
              user={user}
              groupData={groupData}
              handleLoadMore={handleLoadMore}
              refreshing={refreshing}
              onRefresh={handleRefresh}
              loading={loading}
              isPaginating={isPaginating}
              onUserPress={handleUserPress}
              onReply={handleReply}
              scrollToMessage={scrollToMessage}
              highlightedMessageId={highlightedMessageId}
              flatListRef={flatListRef}
              onDeleteMessage={handleDeleteMessage}
              onDeleteAllMessages={handleDeleteAllMessages}
              onReaction={handleReaction}
              onTranslate={handleTranslate}
            />
          )}

          {!localState?.isPro && <BannerAdComponent />}

          <GroupMessageInput
            onSend={(text, image, fruits) => sendMessage(text, image, fruits, replyTo)}
            isBanned={isMeBanned}
            petModalVisible={petModalVisible}
            setPetModalVisible={setPetModalVisible}
            selectedFruits={selectedFruits}
            setSelectedFruits={setSelectedFruits}
            replyTo={replyTo}
            onCancelReply={handleCancelReply}
          />
        </View>
      </ConditionalKeyboardWrapper>

      {/* Members Modal */}
      <Modal
        visible={showMembersModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowMembersModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: isDarkMode ? '#1F2937' : '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', overflow: 'hidden', paddingBottom: insets.bottom }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: c.border }}>
              <Text style={{ fontSize: 20, fontWeight: 'bold', color: c.text }}>
                {t('chat.members_with_count', { number: memberCount })}
              </Text>
              <TouchableOpacity onPress={() => setShowMembersModal(false)}>
                <Icon name="close" size={24} color={c.text} />
              </TouchableOpacity>
            </View>

            <FlatList
              style={{ flexGrow: 1 }}
              contentContainerStyle={{ flexGrow: 0 }}
              data={[
                // Actual members (deduplicated to prevent duplicate key errors)
                ...[...new Set(groupData?.memberIds || [])].map(id => ({ type: 'member', id })),
                // Pending invitations (exclude users already in memberIds)
                ...pendingInvitations
                  .filter(inv => !(groupData?.memberIds || []).includes(inv.invitedUserId))
                  .map(inv => ({ type: 'pending', id: inv.invitedUserId, inviteData: inv }))
              ]}
              keyExtractor={(item) => `${item.type}-${item.id}`}
              onEndReached={() => {
                // ✅ Load next batch of member statuses on scroll
                // ✅ Prevent loading if already loading or if all members are loaded
                if (loadingMemberStatuses || !groupData?.memberIds) return;

                const allMemberIds = groupData.memberIds || [];
                const unloadedIds = allMemberIds.filter(id => !loadedMemberStatuses.has(id));

                // ✅ Only load if there are unloaded members
                if (unloadedIds.length > 0) {
                  const nextBatch = unloadedIds.slice(0, MEMBER_STATUS_BATCH_SIZE);
                  loadMemberStatusesBatch(nextBatch);
                }
              }}
              onEndReachedThreshold={0.5}
              scrollEnabled={true}
              nestedScrollEnabled={true}
              removeClippedSubviews={false}
              ListFooterComponent={
                loadingMemberStatuses ? (
                  <View style={{ padding: 10, alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={isDarkMode ? '#8B5CF6' : '#8B5CF6'} />
                  </View>
                ) : null
              }
              renderItem={({ item }) => {
                if (item.type === 'pending') {
                  // ✅ Render pending invitation - Shows the INVITED USER (the person who was invited)
                  const inviteData = item.inviteData;
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: c.border }}>
                      <Image
                        source={{ uri: inviteData.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                        style={{ width: 50, height: 50, borderRadius: 25, marginRight: 12, opacity: 0.6 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: '500', color: c.text }}>
                          {inviteData.displayName && inviteData.displayName !== 'Anonymous'
                            ? inviteData.displayName
                            : t('chat.anonymous')}
                        </Text>
                        <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2 }}>
                          {t('chat.invite_pending')}
                        </Text>
                      </View>
                    </View>
                  );
                }

                // Render actual member
                const memberId = item.id;
                const member = groupData?.members?.[memberId] || {};
                const isOnline = onlineMembers.includes(memberId);
                const isCurrentUser = memberId === user?.id;
                const isMemberCreator = groupData?.createdBy === memberId;
                const canRemove = isCreator && !isCurrentUser && !isMemberCreator;
                const canMakeCreator = isCreator && !isCurrentUser && !isMemberCreator;

                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 15, borderBottomWidth: 1, borderBottomColor: c.border }}>
                    <Image
                      source={{ uri: member.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
                      style={{ width: 50, height: 50, borderRadius: 25, marginRight: 12 }}
                    />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ fontSize: 16, fontWeight: '500', color: c.text }}>
                          {member.displayName || t('chat.anonymous')}
                        </Text>
                        {isOnline && (
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981', marginLeft: 8 }} />
                        )}
                      </View>
                      <Text style={{ fontSize: 12, color: c.textSecondary, marginTop: 2 }}>
                        {isMemberCreator
                          ? (isOnline ? t('chat.role_creator_online') : t('chat.role_creator'))
                          : (isOnline ? t('chat.role_member_online') : t('chat.role_member'))}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {canMakeCreator && (
                        <TouchableOpacity
                          onPress={() => handleMakeCreator(memberId, member.displayName)}
                          style={{ padding: 8 }}
                        >
                          <Icon name="star-outline" size={20} color="#F59E0B" />
                        </TouchableOpacity>
                      )}
                      {canRemove && (
                        <TouchableOpacity
                          onPress={() => handleRemoveMember(memberId, member.displayName)}
                          style={{ padding: 8 }}
                        >
                          <Icon name="trash-outline" size={20} color="#EF4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={{ padding: 40, alignItems: 'center' }}>
                  <Text style={{ color: c.textSecondary }}>{t('chat.no_members_found')}</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      {/* Profile Bottom Drawer */}
      {/* 2026-09-02: two fixes here.
          1. `startChat` was a no-op stub ("Navigate to private chat if needed"),
             so tapping Message in the drawer just closed it. It now navigates to
             PrivateChat, which lives in this same stack (ChatNavigator).
          2. `fromPvtChat` was hard-coded true. That flag exists to hide the
             Chat and Follow buttons when the drawer is opened FROM private chat
             (where DMing the person you're already DMing is meaningless) —
             copying it here hid both buttons in group chat as well. */}
      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={startPrivateChat}
        selectedUser={selectedUserForDrawer}
        isOnline={false}
        bannedUsers={bannedUsers}
      />

      <PetModal
        fromChat={true}
        visible={petModalVisible}
        onClose={() => setPetModalVisible(false)}
        selectedFruits={selectedFruits}
        setSelectedFruits={setSelectedFruits}
      />
    </GestureHandlerRootView>
  );
};

export default GroupChatScreen;

