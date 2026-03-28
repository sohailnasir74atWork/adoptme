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
  }), [selectedTheme]);


  // ✅ OPTIMIZED: Use child listeners instead of full value listener to reduce data download
  // Listen to individual chat unreadCount changes instead of downloading entire chat_meta_data
  // Only tracks unread counts - full chat list is loaded in InboxScreen when focused
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setunreadcount(0);
      return;
    }

    const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);
    let totalUnread = 0;
    const unreadCounts = new Map(); // Track unread counts per chat
    let initialLoadDone = false; // Skip onChildAdded events until initial load completes

    // ✅ OPTIMIZED: Use child_added and child_changed to listen to individual chats
    // This only downloads data when a specific chat changes, not the entire metadata
    const handleChildChange = (snapshot, isAddedEvent = false) => {
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

      // Skip duplicate setState from onChildAdded for existing children —
      // loadInitialCounts already set the count synchronously
      if (isAddedEvent && !initialLoadDone) return;

      // ✅ Skip expensive setState if user is inside a child screen (chat, inbox, etc.)
      // Counts still accumulate in the Map — they'll be applied when user returns
      if (isInChildScreenRef.current) return;

      // Recalculate total — debounced to batch rapid Firebase events
      totalUnread = Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0);
      if (unreadDebounceRef.current) clearTimeout(unreadDebounceRef.current);
      unreadDebounceRef.current = setTimeout(() => {
        InteractionManager.runAfterInteractions(() => setunreadcount(totalUnread));
      }, 500);
    };

    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      unreadCounts.delete(snapshot.key);
      if (isInChildScreenRef.current) return;
      totalUnread = Array.from(unreadCounts.values()).reduce((sum, count) => sum + count, 0);
      if (unreadDebounceRef.current) clearTimeout(unreadDebounceRef.current);
      unreadDebounceRef.current = setTimeout(() => {
        InteractionManager.runAfterInteractions(() => setunreadcount(totalUnread));
      }, 500);
    };

    // Initial load: fetch only unreadCount fields for each chat (lighter than full data)
    const loadInitialCounts = async () => {
      try {
        const snapshot = await get(userChatsRef);
        if (!snapshot.exists()) {
          setunreadcount(0);
          return;
        }

        const fetchedData = snapshot.val();
        if (!fetchedData || typeof fetchedData !== 'object') {
          setunreadcount(0);
          return;
        }

        const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
        totalUnread = 0;

        Object.entries(fetchedData).forEach(([chatPartnerId, chatData]) => {
          if (!chatData || typeof chatData !== 'object') return;
          const isBlocked = banned.includes(chatPartnerId);
          const rawUnread = chatData?.unreadCount || 0;
          const count = isBlocked ? 0 : rawUnread;
          unreadCounts.set(chatPartnerId, count);
          totalUnread += count;
        });

        setunreadcount(totalUnread);
      } catch (error) {
        console.error("❌ Error loading initial unread counts:", error);
        setunreadcount(0);
      }
      initialLoadDone = true;
    };

    loadInitialCounts();

    // Listen to individual chat changes
    const unsubChatsAdded = onChildAdded(userChatsRef, (snap) => handleChildChange(snap, true));
    const unsubChatsChanged = onChildChanged(userChatsRef, (snap) => handleChildChange(snap, false));
    const unsubChatsRemoved = onChildRemoved(userChatsRef, handleChildRemoved);

    // ✅ Proper cleanup
    return () => {
      unsubChatsAdded();
      unsubChatsChanged();
      unsubChatsRemoved();
      if (unreadDebounceRef.current) clearTimeout(unreadDebounceRef.current);
    };
  }, [user?.id, appdatabase, bannedUsers]);

  // ✅ OPTIMIZED: Use child listeners instead of value listener to avoid re-downloading all group metadata
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setGroups([]);
      return;
    }

    setGroupsLoading(true);
    const userGroupsRef = ref(appdatabase, `group_meta_data/${user.id}`);
    const groupsMap = new Map(); // Track groups by ID for efficient updates
    let groupInitialLoadDone = false;

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
      // ✅ Skip expensive sort + setState if user is inside a child screen
      if (isInChildScreenRef.current) return;
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

    // Initial load to populate the map
    const loadInitialGroups = async () => {
      try {
        const snapshot = await get(userGroupsRef);
        if (!snapshot.exists()) {
          setGroups([]);
          setGroupUnreadCount(0);
          setGroupsLoading(false);
          return;
        }

        const fetchedData = snapshot.val();
        if (!fetchedData || typeof fetchedData !== 'object') {
          setGroups([]);
          setGroupUnreadCount(0);
          setGroupsLoading(false);
          return;
        }

        Object.entries(fetchedData).forEach(([groupId, groupData]) => {
          const parsed = parseGroupData(groupId, groupData);
          if (parsed) groupsMap.set(groupId, parsed);
        });

        recalcAndSetState();
        setGroupsLoading(false);
      } catch (error) {
        console.error('Error loading initial groups:', error);
        setGroupsLoading(false);
      }
      groupInitialLoadDone = true;
    };

    loadInitialGroups();

    // Listen to individual group changes (only downloads the changed group, not all)
    const handleChildAddedOrChanged = (snapshot, isAddedEvent = false) => {
      if (!snapshot || !snapshot.key) return;
      const parsed = parseGroupData(snapshot.key, snapshot.val());
      if (parsed) {
        groupsMap.set(snapshot.key, parsed);
        // Skip duplicate setState from onChildAdded for existing children
        if (isAddedEvent && !groupInitialLoadDone) return;
        recalcAndSetState();
      }
    };

    const handleChildRemoved = (snapshot) => {
      if (!snapshot || !snapshot.key) return;
      groupsMap.delete(snapshot.key);
      recalcAndSetState();
    };

    const unsubGroupsAdded = onChildAdded(userGroupsRef, (snap) => handleChildAddedOrChanged(snap, true));
    const unsubGroupsChanged = onChildChanged(userGroupsRef, (snap) => handleChildAddedOrChanged(snap, false));
    const unsubGroupsRemoved = onChildRemoved(userGroupsRef, handleChildRemoved);

    return () => {
      unsubGroupsAdded();
      unsubGroupsChanged();
      unsubGroupsRemoved();
      if (groupDebounceRef.current) clearTimeout(groupDebounceRef.current);
    };
  }, [user?.id, appdatabase]);

  // ✅ FIX: Track when user enters/leaves child screens to pause badge setState
  // Listeners still accumulate data in Maps — counts flush when user returns to root
  const pendingRefreshRef = useRef(false);
  const handleNavigationStateChange = useCallback((e) => {
    const state = e?.data?.state;
    if (!state) return;
    const currentRoute = state.routes?.[state.index]?.name;
    const wasInChild = isInChildScreenRef.current;
    isInChildScreenRef.current = currentRoute !== 'GroupChat';

    // ✅ When returning to root, flush any accumulated badge counts
    // Clear pending debounce timers to prevent concurrent setState during navigation transition
    if (unreadDebounceRef.current) clearTimeout(unreadDebounceRef.current);
    if (groupDebounceRef.current) clearTimeout(groupDebounceRef.current);

    if (wasInChild && !isInChildScreenRef.current) {
      pendingRefreshRef.current = true;
      // Re-fetch counts from Firebase to sync badges (lightweight get)
      if (user?.id && appdatabase) {
        InteractionManager.runAfterInteractions(async () => {
          try {
            const chatSnap = await get(ref(appdatabase, `chat_meta_data/${user.id}`));
            if (chatSnap.exists()) {
              const data = chatSnap.val();
              const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
              let total = 0;
              Object.entries(data).forEach(([id, chat]) => {
                if (!banned.includes(id)) total += (chat?.unreadCount || 0);
              });
              setunreadcount(total);
            }

            const groupSnap = await get(ref(appdatabase, `group_meta_data/${user.id}`));
            if (groupSnap.exists()) {
              const data = groupSnap.val();
              let totalGroupUnread = 0;
              const sortedGroups = Object.entries(data)
                .map(([id, g]) => {
                  if (!g || typeof g !== 'object') return null;
                  totalGroupUnread += (g.unreadCount || 0);
                  return { groupId: id, groupName: g.groupName || 'Group', groupAvatar: g.groupAvatar || null, lastMessage: g.lastMessage || 'No messages yet', lastMessageTimestamp: g.lastMessageTimestamp || 0, unreadCount: g.unreadCount || 0, memberCount: g.memberCount || 0, createdBy: g.createdBy || null };
                })
                .filter(Boolean)
                .sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
              setGroups(sortedGroups);
              setGroupUnreadCount(totalGroupUnread);
            }
          } catch (err) {
            console.error('Error refreshing counts on return:', err);
          }
          pendingRefreshRef.current = false;
        });
      }
    }
  }, [user?.id, appdatabase, bannedUsers]);

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
