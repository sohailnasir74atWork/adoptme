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
import { ref, update, get, onChildAdded, onChildChanged, onChildRemoved } from '@react-native-firebase/database';
import CommunityChatHeader from './GroupChat/CommunityChatHeader';
import AdminDashboard from '../AppHelper/AdminDashboard';
import { useTranslation } from 'react-i18next';

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
    animation: 'fade',
    animationDuration: 200,
  }), [selectedTheme]);


  // ✅ COST-OPTIMIZED: Child listeners only — no redundant get() call
  // onChildAdded fires once per existing child on attach, serving as initial load
  // Removes duplicate download that get() + onChildAdded caused (was 2x bandwidth)
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setunreadcount(0);
      return;
    }

    const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);
    let totalUnread = 0;
    const unreadCounts = new Map();

    const recalcUnread = () => {
      totalUnread = Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0);
      if (unreadDebounceRef.current) clearTimeout(unreadDebounceRef.current);
      unreadDebounceRef.current = setTimeout(() => {
        InteractionManager.runAfterInteractions(() => setunreadcount(totalUnread));
      }, 500);
    };

    const handleChildChange = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const chatData = snapshot.val();
      if (!chatData || typeof chatData !== 'object') return;

      const chatPartnerId = snapshot.key;
      const isBlocked = Array.isArray(bannedUsers) && bannedUsers.includes(chatPartnerId);
      const rawUnread = chatData?.unreadCount || 0;

      if (isBlocked && rawUnread > 0) {
        update(
          ref(appdatabase, `chat_meta_data/${user.id}/${chatPartnerId}`),
          { unreadCount: 0 }
        ).catch((error) => {
          console.error("Error resetting unread count:", error);
        });
        unreadCounts.set(chatPartnerId, 0);
      } else {
        unreadCounts.set(chatPartnerId, isBlocked ? 0 : rawUnread);
      }

      recalcUnread();
    };

    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      unreadCounts.delete(snapshot.key);
      recalcUnread();
    };

    // onChildAdded fires for each existing child on attach — no separate get() needed
    const unsubChatsAdded = onChildAdded(userChatsRef, handleChildChange);
    const unsubChatsChanged = onChildChanged(userChatsRef, handleChildChange);
    const unsubChatsRemoved = onChildRemoved(userChatsRef, handleChildRemoved);

    return () => {
      unsubChatsAdded();
      unsubChatsChanged();
      unsubChatsRemoved();
      if (unreadDebounceRef.current) clearTimeout(unreadDebounceRef.current);
    };
  }, [user?.id, appdatabase, bannedUsers]);

  // ✅ COST-OPTIMIZED: Child listeners + one-time empty-check to clear loading
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setGroups([]);
      setGroupsLoading(false);
      return;
    }

    setGroupsLoading(true);
    const userGroupsRef = ref(appdatabase, `group_meta_data/${user.id}`);
    const groupsMap = new Map();

    const parseGroupData = (groupId, groupData) => {
      if (!groupData || typeof groupData !== 'object') return null;
      return {
        groupId,
        groupName: groupData.groupName || 'Group',
        groupAvatar: groupData.groupAvatar || null,
        lastMessage: groupData.lastMessage || 'No messages yet',
        lastMessageTimestamp: groupData.lastMessageTimestamp || 0,
        unreadCount: groupData.unreadCount || 0,
        memberCount: groupData.memberCount || 0,
        createdBy: groupData.createdBy || null,
      };
    };

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
          setGroupsLoading(false);
        });
      }, 300);
    };

    // ✅ One-time check: if no group data exists, clear loading immediately
    // This fixes the infinite loading bug when user has no groups
    // (onChildAdded never fires for empty data)
    get(userGroupsRef).then((snapshot) => {
      if (!snapshot.exists()) {
        setGroups([]);
        setGroupsLoading(false);
      }
      // If data exists, onChildAdded will handle it and clear loading via recalcAndSetState
    }).catch((error) => {
      console.error('Error checking group data:', error);
      setGroupsLoading(false);
    });

    // onChildAdded fires for each existing group on attach — serves as initial load
    const handleChildAddedOrChanged = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      const parsed = parseGroupData(snapshot.key, snapshot.val());
      if (parsed) {
        groupsMap.set(snapshot.key, parsed);
        recalcAndSetState();
      }
    };

    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      groupsMap.delete(snapshot.key);
      recalcAndSetState();
    };

    const unsubGroupsAdded = onChildAdded(userGroupsRef, handleChildAddedOrChanged);
    const unsubGroupsChanged = onChildChanged(userGroupsRef, handleChildAddedOrChanged);
    const unsubGroupsRemoved = onChildRemoved(userGroupsRef, handleChildRemoved);

    return () => {
      unsubGroupsAdded();
      unsubGroupsChanged();
      unsubGroupsRemoved();
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
