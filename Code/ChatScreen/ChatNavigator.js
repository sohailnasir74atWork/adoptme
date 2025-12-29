import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
// import database from '@react-native-firebase/database';
import ImageViewerScreenChat from './PrivateChat/ImageViewer';
import { ref, update } from '@react-native-firebase/database';
import CommunityChatHeader from './GroupChat/CommunityChatHeader';

const Stack = createNativeStackNavigator();

export const ChatStack = ({ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo }) => {
  const { user, unreadMessagesCount, appdatabase } = useGlobalState();
  const [bannedUsers, setBannedUsers] = useState([]);
  const { triggerHapticFeedback } = useHaptic();
  const [chats, setChats] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreadcount, setunreadcount] = useState(0);
  const { localState, updateLocalState } = useLocalState()
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupUnreadCount, setGroupUnreadCount] = useState(0); // Total unread count for groups



  useEffect(() => {
    if (!user?.id) return;
    // ✅ Safety check: ensure bannedUsers is an array
    const banned = Array.isArray(localState.bannedUsers) ? localState.bannedUsers : [];
    setBannedUsers(banned);
  }, [user?.id, localState.bannedUsers]);


  const headerOptions = useMemo(() => ({
    headerStyle: { backgroundColor: selectedTheme.colors.background },
    headerTintColor: selectedTheme.colors.text,
    headerTitleStyle: { fontFamily: 'Lato-Bold', fontSize: 24 },
    headerBackTitleVisible: false,
  }), [selectedTheme]);


  // ✅ Move listener setup directly into useEffect for proper cleanup
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setChats([]);
      setunreadcount(0);
      return;
    }
  
    setLoading(true);
    const userChatsRef = ref(appdatabase, `chat_meta_data/${user.id}`);
  
    const onValueChange = userChatsRef.on('value', (snapshot) => {
      try {
        if (!snapshot.exists()) {
          setChats([]); 
          setunreadcount(0);
          setLoading(false);
          return;
        }
  
        const fetchedData = snapshot.val();
        if (!fetchedData || typeof fetchedData !== 'object') {
          setChats([]);
          setunreadcount(0);
          setLoading(false);
          return;
        }
  
        const updatedChats = Object.entries(fetchedData).map(([chatPartnerId, chatData]) => {
          // ✅ Safety check for chatData
          if (!chatData || typeof chatData !== 'object') {
            return null;
          }

          const isBlocked = Array.isArray(bannedUsers) && bannedUsers.includes(chatPartnerId);
          const rawUnread = chatData?.unreadCount || 0;
  
          // ✅ Reset unread count for blocked users with error handling
          if (isBlocked && rawUnread > 0) {
            update(
              ref(appdatabase, `chat_meta_data/${user.id}/${chatPartnerId}`),
              { unreadCount: 0 }
            ).catch((error) => {
              console.error("Error resetting unread count:", error);
            });
          }
          
          return {
            chatId: chatData.chatId,
            otherUserId: chatPartnerId,
            lastMessage: chatData.lastMessage || 'No messages yet',
            lastMessageTimestamp: chatData.timestamp || 0,
            unreadCount: isBlocked ? 0 : rawUnread,
            otherUserAvatar: chatData.receiverAvatar || 'https://example.com/default-avatar.jpg',
            otherUserName: chatData.receiverName || 'Anonymous',
          };
        }).filter(Boolean); // ✅ Remove null entries
  
        // ✅ Sort by latest message (newest first)
        const sortedChats = updatedChats.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
        setChats(sortedChats);
  
        // ✅ Calculate total unread count
        const totalUnread = sortedChats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);
        setunreadcount(totalUnread);
        setLoading(false);
      } catch (error) {
        console.error("❌ Error fetching chats:", error);
        setLoading(false);
      }
    });
  
    // ✅ Proper cleanup
    return () => {
      userChatsRef.off('value', onValueChange);
    };
  }, [user?.id, appdatabase, bannedUsers]);

  // ✅ Load groups from group_meta_data
  useEffect(() => {
    if (!user?.id || !appdatabase) {
      setGroups([]);
      return;
    }

    setGroupsLoading(true);
    const userGroupsRef = ref(appdatabase, `group_meta_data/${user.id}`);

    const onValueChange = userGroupsRef.on('value', (snapshot) => {
      try {
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

        const updatedGroups = Object.entries(fetchedData).map(([groupId, groupData]) => {
          if (!groupData || typeof groupData !== 'object') {
            return null;
          }

          return {
            groupId,
            groupName: groupData.groupName || 'Group',
            groupAvatar: groupData.groupAvatar || null,
            lastMessage: groupData.lastMessage || 'No messages yet',
            lastMessageTimestamp: groupData.lastMessageTimestamp || 0,
            unreadCount: groupData.unreadCount || 0,
            memberCount: groupData.memberCount || 0,
            createdBy: groupData.createdBy || null, // Add creator info
          };
        }).filter(Boolean);

        const sortedGroups = updatedGroups.sort(
          (a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp
        );
        setGroups(sortedGroups);
        
        // ✅ Calculate total group unread count
        const totalGroupUnread = sortedGroups.reduce((sum, group) => sum + (group.unreadCount || 0), 0);
        setGroupUnreadCount(totalGroupUnread);
        
        setGroupsLoading(false);
      } catch (error) {
        console.error('❌ Error fetching groups:', error);
        setGroupsLoading(false);
      }
    });

    return () => {
      userGroupsRef.off('value', onValueChange);
    };
  }, [user?.id, appdatabase]);

  const [onlineUsersVisible, setOnlineUsersVisible] = useState(false);

  const getGroupChatOptions = useCallback(() => ({
    title: '', // Hide title
    headerTitleAlign: 'left',
    headerTitleStyle: { 
      fontFamily: 'Lato-Bold', 
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
  }), [selectedTheme, unreadcount, setunreadcount, groupUnreadCount, setGroupUnreadCount, triggerHapticFeedback]);

  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen
        name="GroupChat"
        options={getGroupChatOptions}
      >
        {() => (
          <ChatScreen
            {...{ selectedTheme, setChatFocused, modalVisibleChatinfo, setModalVisibleChatinfo, bannedUsers, setBannedUsers, triggerHapticFeedback, unreadMessagesCount, unreadcount, setunreadcount, onlineUsersVisible, setOnlineUsersVisible }}
          />
        )}
      </Stack.Screen>

      {/* ✅ Optimized: Pass `chats` & `setChats` via `screenProps` instead of inline function */}
      <Stack.Screen
        name="Inbox"
        options={{ title: 'Inbox' }}
      >
        {props => <InboxScreen {...props} chats={chats} setChats={setChats} loading={loading} bannedUsers={bannedUsers} />}
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
    </Stack.Navigator>

  );
};
