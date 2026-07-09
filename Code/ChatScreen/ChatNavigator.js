import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
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

const Stack = createNativeStackNavigator();

export const ChatStack = ({ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { user, appdatabase } = useGlobalState();
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const [unreadcount, setunreadcount] = useState(0);
  const { localState } = useLocalState()
  const { t } = useTranslation();
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupUnreadCount, setGroupUnreadCount] = useState(0); // Total unread count for groups
  const unreadDebounceRef = useRef(null);
  const groupDebounceRef = useRef(null);
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
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setunreadcount(0);
      return;
    }

    let totalUnread = 0;
    const unreadCounts = new Map();

    const recalcUnread = () => {
      totalUnread = Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0);
      if (unreadDebounceRef.current) clearTimeout(unreadDebounceRef.current);
      unreadDebounceRef.current = setTimeout(() => {
        InteractionManager.runAfterInteractions(() => setunreadcount(totalUnread));
      }, 500);
    };

    const handleUpsert = (chatData) => {
      if (!chatData || !chatData.partnerId) return;
      const chatPartnerId = chatData.partnerId;
      const isBlocked = Array.isArray(bannedUsers) && bannedUsers.includes(chatPartnerId);
      const rawUnread = chatData.unreadCount || 0;

      // Block-user safety reset: zero the badge in Supabase directly.
      // Fire-and-forget — the realtime channel will reconcile state
      // on the resulting UPDATE.
      if (isBlocked && rawUnread > 0) {
        resetUnreadCount(user.id, chatPartnerId).catch((error) => {
          console.error("Error resetting unread count:", error);
        });
        unreadCounts.set(chatPartnerId, 0);
      } else {
        unreadCounts.set(chatPartnerId, isBlocked ? 0 : rawUnread);
      }

      recalcUnread();
    };

    const handleRemove = (partnerId) => {
      unreadCounts.delete(partnerId);
      recalcUnread();
    };

    const unsubscribe = subscribeToChatMetaShared(user.id, {
      onUpsert: handleUpsert,
      onRemove: handleRemove,
    });

    return () => {
      unsubscribe();
      if (unreadDebounceRef.current) clearTimeout(unreadDebounceRef.current);
    };
  }, [user?.id, appdatabase, bannedUsers]);

  // Group list reads off Supabase (group_meta_data table). Writes
  // (createGroupChat, acceptGroupInvite, sendGroupMessage's per-member
  // fan-out, mute toggles) stay on RTDB so notifyGroupMessage and
  // /activeGroupChats presence are unaffected. mirrorGroupMetaToSupabase
  // tails those writes into this table.
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setGroups([]);
      setGroupsLoading(false);
      return;
    }

    setGroupsLoading(true);
    const groupsMap = new Map();

    const recalcAndSetState = () => {
      if (groupDebounceRef.current) clearTimeout(groupDebounceRef.current);
      groupDebounceRef.current = setTimeout(() => {
        InteractionManager.runAfterInteractions(() => {
          const sortedGroups = Array.from(groupsMap.values()).sort(
            (a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp
          );
          setGroups(sortedGroups);
          const totalGroupUnread = sortedGroups.reduce((sum, group) => sum + (group.unreadCount || 0), 0);
          setGroupUnreadCount(totalGroupUnread);
        });
      }, 300);
    };

    const handleUpsert = (g) => {
      if (!g || !g.groupId) return;
      groupsMap.set(g.groupId, {
        groupId: g.groupId,
        groupName: g.groupName || 'Group',
        groupAvatar: g.groupAvatar || null,
        lastMessage: g.lastMessage || 'No messages yet',
        lastMessageTimestamp: g.lastMessageTimestamp || 0,
        unreadCount: g.unreadCount || 0,
        memberCount: g.memberCount || 0,
        createdBy: g.createdBy || null,
        // muted rides the same Supabase row — GroupsScreen derives its
        // mute map from this instead of N one-off RTDB reads per render
        // of the groups list.
        muted: !!g.muted,
      });
      recalcAndSetState();
    };

    const handleRemove = (groupId) => {
      groupsMap.delete(groupId);
      recalcAndSetState();
    };

    const unsubscribe = subscribeToGroupMetaShared(user.id, {
      onUpsert: handleUpsert,
      onRemove: handleRemove,
      // Initial load + first SUBSCRIBED both landed → safe to drop the
      // spinner even if the user has zero groups (no rows ever delivered).
      onReady: () => setGroupsLoading(false),
    });

    return () => {
      unsubscribe();
      if (groupDebounceRef.current) clearTimeout(groupDebounceRef.current);
    };
  }, [user?.id, appdatabase]);

  // ✅ COST-OPTIMIZED: No re-fetch on navigation return
  // Listeners update state continuously via debounce — state is always current
  // Removed 2x full get() calls that fired every time user navigated back
  const handleNavigationStateChange = useCallback((e) => {
    const state = e?.data?.state;
    if (!state) return;
    const currentRoute = state.routes?.[state.index]?.name;
    isInChildScreenRef.current = currentRoute !== 'GroupChat';
  }, []);

  const [onlineUsersVisible, setOnlineUsersVisible] = useState(false);

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
        unreadcount={unreadcount}
        setunreadcount={setunreadcount}
        groupUnreadCount={groupUnreadCount}
        setGroupUnreadCount={setGroupUnreadCount}
        triggerHapticFeedback={triggerHapticFeedback}
        onOnlineUsersPress={() => setOnlineUsersVisible(true)}
      />
    ),
    headerRightContainerStyle: {
      paddingRight: 0,
      marginRight: 0,
    },
  }), [selectedTheme, unreadcount, setunreadcount, groupUnreadCount, setGroupUnreadCount, triggerHapticFeedback, user?.id, t]);

  return (
    <Stack.Navigator screenOptions={headerOptions} screenListeners={{ state: handleNavigationStateChange }}>
      <Stack.Screen
        name="GroupChat"
        options={getGroupChatOptions}
      >
        {() => (
          <ChatScreen
            {...{ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, setBannedUsers, triggerHapticFeedback, unreadcount, setunreadcount, onlineUsersVisible, setOnlineUsersVisible }}
          />
        )}
      </Stack.Screen>

      {/* ✅ Optimized: Pass `chats` & `setChats` via `screenProps` instead of inline function */}
      <Stack.Screen
        name="Inbox"
        options={{ title: 'Inbox' }}
      >
        {props => <InboxScreen {...props} bannedUsers={bannedUsers} />}
      </Stack.Screen>

      <Stack.Screen
        name="Groups"
        options={{ title: 'Groups' }}
      >
        {props => <GroupsScreen {...props} groups={groups} setGroups={setGroups} groupsLoading={groupsLoading} />}
      </Stack.Screen>

      <Stack.Screen
        name="GroupChatDetail"
        options={({ route, navigation }) => ({
          headerBackVisible: true,
          headerTitle: () => {
            // This will be set dynamically by GroupChatScreen
            return null;
          },
          headerRight: () => {
            // This will be set dynamically by GroupChatScreen
            return null;
          },
        })}
      >
        {(props) => <GroupChatScreen {...props} />}
      </Stack.Screen>

      <Stack.Screen
        name="BlockedUsers"
        options={{ title: 'Blocked Users' }} >
        {props => <BlockedUsersScreen {...props} bannedUsers={bannedUsers} />}
      </Stack.Screen>

      <Stack.Screen
        name="PrivateChat"
        options={({ route }) => ({
          headerTitle: () => (
            <PrivateChatHeader
              selectedUser={route.params?.selectedUser}
              selectedTheme={selectedTheme}
              bannedUsers={bannedUsers}
              isDrawerVisible={isDrawerVisible}
              setIsDrawerVisible={setIsDrawerVisible}
            />
          ),
        })}
      >
        {(props) => (
          <PrivateChatScreen
            {...props}
            bannedUsers={bannedUsers}
            isDrawerVisible={isDrawerVisible}
            setIsDrawerVisible={setIsDrawerVisible}
          />
        )}
      </Stack.Screen>
      <Stack.Screen
        name="ImageViewerScreenChat"
        component={ImageViewerScreenChat}
        options={{ title: 'Image' }}
      />



      <Stack.Screen
        name="AdminDashboard"
        component={AdminDashboard}
        options={{ title: 'Admin Dashboard' }}
      />
    </Stack.Navigator>
  );
};
