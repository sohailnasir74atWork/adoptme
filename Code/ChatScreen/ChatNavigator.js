import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatScreen from './GroupChat/Trader';
import PrivateChatScreen from './PrivateChat/PrivateChat';
import InboxScreen from './GroupChat/InboxScreen';
import GroupsScreen from './GroupChat/GroupsScreen';
import GroupChatScreen from './GroupChat/GroupChatScreen';
import { useGlobalState } from '../GlobelStats';
import PrivateChatHeader from './PrivateChat/PrivateChatHeader';
import BlockedUsersScreen from './PrivateChat/BlockUserList';
import { useHaptic } from '../Helper/HepticFeedBack';
import { useLocalState } from '../LocalGlobelStats';
import ImageViewerScreenChat from './PrivateChat/ImageViewer';
import CommunityChatHeader from './GroupChat/CommunityChatHeader';
import AdminDashboard from '../AppHelper/AdminDashboard';
import { useTranslation } from 'react-i18next';
import { subscribeToChatMetaShared, resetUnreadCount } from '../Supabase/chatMetaBackend';
import { subscribeToGroupMetaShared } from '../Supabase/groupMetaBackend';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  setDmUnread, removeDmUnread, clearDmUnread,
  setGroupUnread, removeGroupUnread, clearGroupUnread,
} from './chatBadgeStore';

const Stack = createNativeStackNavigator();

// GroupChatScreen sets its own header title and buttons.
const groupChatDetailOptions = {
  headerBackVisible: true,
  headerTitle: () => null,
  headerRight: () => null,
};

// A busy group updates every member's group_meta_data row on every message.
// The groups list is redrawn at most this often while such updates stream in.
const GROUPS_FLUSH_MS = 400;

const ADMIN_DASHBOARD_OPTIONS = { title: 'Admin Dashboard' };

export const ChatStack = ({ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { user, appdatabase } = useGlobalState();
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const { localState } = useLocalState()
  const { t } = useTranslation();
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsReconnecting, setGroupsReconnecting] = useState(false);
  const isInChildScreenRef = useRef(false); // Track if user is in a child screen (chat, inbox, etc.)
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!user?.id) return;
    // ✅ Safety check: ensure bannedUsers is an array
    const banned = Array.isArray(localState.bannedUsers) ? localState.bannedUsers : [];
    setBannedUsers(banned);
  }, [user?.id, localState.bannedUsers]);


  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontWeight: 'bold', fontSize: 24 },
    headerBackTitleVisible: false,
    // Reliable status-bar inset — the public chat's header icons (headerRight =
    // CommunityChatHeader) drew under the status bar on edge-to-edge devices
    // because the native-stack default inset detection returned 0 there.
    headerStatusBarHeight: insets.top,
    animation: 'fade',
    animationDuration: 200,
  }), [selectedTheme, insets.top]);


  // Phase 5 clean-cut: chat_meta_data is Supabase-only for new app
  // builds — reads via subscribeToChatMeta, the block-user reset below
  // writes via resetUnreadCount. Old-app builds still write RTDB and
  // the mirror CF replays those rows into Supabase, so the unread
  // tally stays consistent across versions during rollout.
  // Behaviour matches the previous RTDB child listeners: each existing
  // row arrives once via the initial load, then realtime
  // INSERT/UPDATE/DELETE keep the unread tally fresh.
  //
  // Counts go to chatBadgeStore, not ChatStack state: a state update here
  // re-rendered the whole stack (and every mounted chat screen, since this
  // app does not freeze screens) once per incoming message. The old 500 ms +
  // idle debounce cut the redraws but held the badge back during a burst.
  //
  // Read the banned list through a ref inside the subscription handler so a
  // change to `bannedUsers` (array identity changes on every localState
  // update) does NOT tear down and re-create the realtime channel. Each
  // re-create is a new server-side subscription + a full initial load.
  const bannedUsersRef = useRef(bannedUsers);
  bannedUsersRef.current = bannedUsers;

  useEffect(() => {
    clearDmUnread();
    if (!user?.id || !appdatabase) return;

    const handleUpsert = (chatData) => {
      if (!chatData || !chatData.partnerId) return;
      const chatPartnerId = chatData.partnerId;
      const bannedNow = bannedUsersRef.current;
      const isBlocked = Array.isArray(bannedNow) && bannedNow.includes(chatPartnerId);
      const rawUnread = chatData.unreadCount || 0;

      // Block-user safety reset: zero the badge in Supabase directly.
      // Fire-and-forget — the realtime channel will reconcile state
      // on the resulting UPDATE.
      if (isBlocked && rawUnread > 0) {
        resetUnreadCount(user.id, chatPartnerId).catch((error) => {
          console.error("Error resetting unread count:", error);
        });
      }

      setDmUnread(chatPartnerId, isBlocked ? 0 : rawUnread);
    };

    const handleRemove = (partnerId) => {
      if (!partnerId) return;
      removeDmUnread(partnerId);
    };

    const unsubscribe = subscribeToChatMetaShared(user.id, {
      onUpsert: handleUpsert,
      onRemove: handleRemove,
    });

    return () => {
      unsubscribe();
      clearDmUnread();
    };
    // bannedUsers intentionally omitted: read via bannedUsersRef (see above).
  }, [user?.id, appdatabase]);

  // Group list reads off Supabase (group_meta_data table). Writes
  // (createGroupChat, acceptGroupInvite, sendGroupMessage's per-member
  // fan-out, mute toggles) stay on RTDB so notifyGroupMessage and
  // /activeGroupChats presence are unaffected. mirrorGroupMetaToSupabase
  // tails those writes into this table.
  useEffect(() => {
    clearGroupUnread();
    if (!user?.id || !appdatabase) {
      setGroups([]);
      setGroupsLoading(false);
      return;
    }

    setGroupsLoading(true);
    const groupsMap = new Map();
    let reconnectTimer = null;
    let flushTimer = null;
    let listShown = false; // the first load has been painted

    const flushGroups = () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      listShown = true;
      setGroups(Array.from(groupsMap.values()).sort(
        (a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp
      ));
    };

    // The badge updates per row (chatBadgeStore, cheap); the list is redrawn
    // at most every GROUPS_FLUSH_MS. This used to restart a 300 ms timer on
    // every row, so a busy group kept the list (and the badge) from updating
    // until it went quiet. Rows that arrive before the first load is painted
    // wait for it.
    const scheduleGroupsFlush = () => {
      if (!listShown || flushTimer) return;
      flushTimer = setTimeout(flushGroups, GROUPS_FLUSH_MS);
    };

    // Drop the skeleton with whatever rows are in hand.
    const finishLoading = () => {
      flushGroups();
      setGroupsLoading(false);
    };
    // Backstop: the initial load waits on a Firebase token + one Supabase
    // request, and nothing may hold the skeleton forever (2026-10-14 reports).
    const loadingFallback = setTimeout(finishLoading, 5000);

    const handleUpsert = (g) => {
      if (!g || !g.groupId) return;
      groupsMap.set(g.groupId, {
        groupId: g.groupId,
        // Missing name / preview are filled with translated labels where
        // GroupsScreen renders them, not stored here as English text.
        groupName: g.groupName || null,
        groupAvatar: g.groupAvatar || null,
        lastMessage: g.lastMessage || null,
        lastMessageTimestamp: g.lastMessageTimestamp || 0,
        unreadCount: g.unreadCount || 0,
        memberCount: g.memberCount || 0,
        createdBy: g.createdBy || null,
        // muted rides the same Supabase row — GroupsScreen derives its
        // mute map from this instead of N one-off RTDB reads per render
        // of the groups list.
        muted: !!g.muted,
      });
      setGroupUnread(g.groupId, g.unreadCount || 0);
      scheduleGroupsFlush();
    };

    const handleRemove = (groupId) => {
      if (!groupId) return;
      groupsMap.delete(groupId);
      removeGroupUnread(groupId);
      scheduleGroupsFlush();
    };

    const unsubscribe = subscribeToGroupMetaShared(user.id, {
      onUpsert: handleUpsert,
      onRemove: handleRemove,
      // Initial load + first SUBSCRIBED both landed → safe to drop the
      // spinner even if the user has zero groups (no rows ever delivered).
      onReady: () => {
        clearTimeout(loadingFallback);
        finishLoading();
      },
      // Same reconnecting pill as the inbox: only after >1.5 s degraded.
      onStatus: (status) => {
        if (status === 'SUBSCRIBED') {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = null;
          setGroupsReconnecting(false);
          return;
        }
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            setGroupsReconnecting(true);
          }, 1500);
        }
      },
    });

    return () => {
      unsubscribe();
      clearTimeout(loadingFallback);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setGroupsReconnecting(false);
      if (flushTimer) clearTimeout(flushTimer);
      clearGroupUnread();
    };
  }, [user?.id, appdatabase]);

  // ✅ COST-OPTIMIZED: No re-fetch on navigation return
  // Listeners update state continuously — state is always current
  // Removed 2x full get() calls that fired every time user navigated back
  const handleNavigationStateChange = useCallback((e) => {
    const state = e?.data?.state;
    if (!state) return;
    const currentRoute = state.routes?.[state.index]?.name;
    isInChildScreenRef.current = currentRoute !== 'GroupChat';
  }, []);

  const screenListeners = useMemo(() => ({ state: handleNavigationStateChange }), [handleNavigationStateChange]);

  const [onlineUsersVisible, setOnlineUsersVisible] = useState(false);
  const openOnlineUsers = useCallback(() => setOnlineUsersVisible(true), []);

  const getGroupChatOptions = useCallback(({ navigation }) => ({
    // Show "Community Chat" title only when NOT logged in
    title: user?.id ? '' : t('chat.community_chat'),
    headerTitleAlign: 'left',
    headerTitleStyle: {
      fontWeight: 'bold',
      fontSize: 24,
    },
    headerTitleContainerStyle: {
      left: 0,
      paddingLeft: 0,
    },
    headerRight: () => (
      <CommunityChatHeader
        selectedTheme={selectedTheme}
        triggerHapticFeedback={triggerHapticFeedback}
        onOnlineUsersPress={openOnlineUsers}
      />
    ),
    headerRightContainerStyle: {
      paddingRight: 0,
      marginRight: 0,
    },
  }), [selectedTheme, triggerHapticFeedback, openOnlineUsers, user?.id, t]);

  const inboxOptions = useMemo(() => ({ title: t('misc.inbox') }), [t]);
  const groupsOptions = useMemo(() => ({ title: t('chat.groups') }), [t]);
  const blockedUsersOptions = useMemo(() => ({ title: t('chat.blocked_users') }), [t]);
  const imageViewerOptions = useMemo(() => ({ title: t('inbox.image_viewer_title') }), [t]);

  // Screen render functions are memoized on purpose. React Navigation skips
  // re-rendering a screen only when its render function is the same one as
  // last time; inline arrows here were new on every ChatStack render, so
  // every mounted chat screen re-rendered with it (no enableFreeze in this
  // app) — the public chat under the Inbox, the DM screen itself.
  const renderGroupChat = useCallback(() => (
    <ChatScreen
      {...{ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, setBannedUsers, triggerHapticFeedback, onlineUsersVisible, setOnlineUsersVisible }}
    />
  ), [selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, triggerHapticFeedback, onlineUsersVisible]);

  const renderInbox = useCallback(
    (props) => <InboxScreen {...props} bannedUsers={bannedUsers} />,
    [bannedUsers]
  );

  const renderGroups = useCallback(
    (props) => <GroupsScreen {...props} groups={groups} setGroups={setGroups} groupsLoading={groupsLoading} groupsReconnecting={groupsReconnecting} />,
    [groups, groupsLoading, groupsReconnecting]
  );

  const renderGroupChatDetail = useCallback((props) => <GroupChatScreen {...props} />, []);

  const renderBlockedUsers = useCallback(
    (props) => <BlockedUsersScreen {...props} bannedUsers={bannedUsers} />,
    [bannedUsers]
  );

  const getPrivateChatOptions = useCallback(({ route }) => ({
    headerTitle: () => (
      <PrivateChatHeader
        // New header per player, so nothing from the previous chat carries over.
        key={route.params?.selectedUser?.senderId || 'none'}
        selectedUser={route.params?.selectedUser}
        selectedTheme={selectedTheme}
        bannedUsers={bannedUsers}
        isDrawerVisible={isDrawerVisible}
        setIsDrawerVisible={setIsDrawerVisible}
      />
    ),
  }), [selectedTheme, bannedUsers, isDrawerVisible]);

  const renderPrivateChat = useCallback((props) => (
    <PrivateChatScreen
      // New screen per player: params changing in place (a quick second tap)
      // left the previous player's state behind.
      key={props.route?.params?.selectedUser?.senderId || 'none'}
      {...props}
      bannedUsers={bannedUsers}
      isDrawerVisible={isDrawerVisible}
      setIsDrawerVisible={setIsDrawerVisible}
    />
  ), [bannedUsers, isDrawerVisible]);

  return (
    <Stack.Navigator screenOptions={headerOptions} screenListeners={screenListeners}>
      <Stack.Screen
        name="GroupChat"
        options={getGroupChatOptions}
      >
        {renderGroupChat}
      </Stack.Screen>

      {/* InboxScreen manages its own state — only needs bannedUsers */}
      <Stack.Screen
        name="Inbox"
        options={inboxOptions}
      >
        {renderInbox}
      </Stack.Screen>

      <Stack.Screen
        name="Groups"
        options={groupsOptions}
      >
        {renderGroups}
      </Stack.Screen>

      <Stack.Screen
        name="GroupChatDetail"
        options={groupChatDetailOptions}
      >
        {renderGroupChatDetail}
      </Stack.Screen>

      <Stack.Screen
        name="BlockedUsers"
        options={blockedUsersOptions} >
        {renderBlockedUsers}
      </Stack.Screen>

      <Stack.Screen
        name="PrivateChat"
        options={getPrivateChatOptions}
      >
        {renderPrivateChat}
      </Stack.Screen>
      <Stack.Screen
        name="ImageViewerScreenChat"
        component={ImageViewerScreenChat}
        options={imageViewerOptions}
      />



      <Stack.Screen
        name="AdminDashboard"
        component={AdminDashboard}
        options={ADMIN_DASHBOARD_OPTIONS}
      />
    </Stack.Navigator>
  );
};
