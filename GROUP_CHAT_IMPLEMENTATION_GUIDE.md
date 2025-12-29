# Group Chat Implementation Guide

## 📊 Current Architecture Analysis

### Existing Chat Structure:
1. **Group Chat (Trader.jsx)**: 
   - Single global chat room
   - RTDB: `chat_new` for messages
   - RTDB: `pin_messages` for pinned messages
   - All users see the same messages

2. **Private Chat (PrivateChat.jsx)**:
   - 1-on-1 conversations
   - RTDB: `private_messages/{chatId}/messages` (chatId = sorted user IDs joined)
   - RTDB: `chat_meta_data/{userId}/{otherUserId}` for metadata (lastMessage, unreadCount, etc.)
   - Inbox shows all private chats from `chat_meta_data/{userId}`

3. **Online Users List (OnlineUsersList.jsx)**:
   - Firestore: `online_users_node/list` document
   - Contains: `userIds` array, `users` map with `{id, displayName, avatar}`
   - Already optimized for batch loading

---

## 🎯 Recommended Implementation Strategy

### **Option 1: Hybrid Approach (RECOMMENDED) ⭐**
**Best for: Low cost, optimized, scalable**

#### Data Structure:

**Firestore Collection: `groups`**
```javascript
groups/{groupId} = {
  id: "group_1234567890_abc",
  name: "My Group", // Optional, default to member names
  description: "", // Optional
  createdBy: "userId123",
  createdAt: Timestamp,
  updatedAt: Timestamp,
  memberCount: 3,
  members: {
    "userId1": {
      id: "userId1",
      displayName: "User 1",
      avatar: "url",
      role: "admin", // or "member"
      joinedAt: Timestamp
    },
    "userId2": { ... },
    "userId3": { ... }
  },
  memberIds: ["userId1", "userId2", "userId3"], // For queries
  lastMessage: "Hey everyone!",
  lastMessageTimestamp: Timestamp,
  lastMessageSenderId: "userId1",
  isActive: true
}
```

**RTDB: `group_messages/{groupId}/messages/{timestamp}`**
```javascript
group_messages/{groupId}/messages/{timestamp} = {
  text: "Hello group!",
  senderId: "userId1",
  sender: "User 1",
  avatar: "url",
  timestamp: 1234567890,
  fruits: [],
  gif: null,
  // ... same structure as private chat messages
}
```

**RTDB: `group_meta_data/{userId}/{groupId}`**
```javascript
group_meta_data/{userId}/{groupId} = {
  groupId: "group_123",
  groupName: "My Group",
  groupAvatar: "url", // Optional, could be first member's avatar
  lastMessage: "Hey everyone!",
  lastMessageTimestamp: 1234567890,
  unreadCount: 5,
  muted: false,
  leftAt: null // If user left, store timestamp
}
```

#### Why This Structure?
- ✅ **Firestore for metadata**: Efficient queries, indexed searches, low read cost
- ✅ **RTDB for messages**: Real-time updates, low latency, familiar pattern
- ✅ **Separate metadata per user**: Unread counts, mute status, personal settings
- ✅ **Minimal Firestore reads**: Only read group doc when needed, not on every message

---

### **Option 2: Pure Firestore**
**Pros**: Single database, simpler queries
**Cons**: Higher read costs for real-time messages, slower updates

### **Option 3: Pure RTDB**
**Pros**: Fast real-time, low latency
**Cons**: Harder to query groups by member, no indexed search

---

## 📍 Implementation Locations

### **1. Group Creation UI** 
**Location: `OnlineUsersList.jsx` or New Component**

**Best Option**: Add a "Create Group" button in `OnlineUsersList.jsx`
- User selects multiple users (checkboxes)
- Click "Create Group" button
- Opens modal to set group name (optional)
- Creates group in Firestore

**Alternative**: New screen `CreateGroupScreen.jsx` navigated from `OnlineUsersList.jsx`

### **2. Group Chat Screen**
**Location: New file `Code/ChatScreen/GroupChat/GroupChatScreen.jsx`**

**Pattern**: Similar to `PrivateChat.jsx` but:
- Loads messages from `group_messages/{groupId}/messages`
- Shows group members in header
- Handles group-specific features (add/remove members, leave group)

### **3. Group List/Inbox**
**Location: Extend `InboxScreen.jsx` or create `GroupsScreen.jsx`**

**Best Option**: Add tabs in `InboxScreen.jsx`:
- Tab 1: "Private Chats" (existing)
- Tab 2: "Groups" (new)

**Data Source**: Listen to `group_meta_data/{userId}` in RTDB (same pattern as private chats)

### **4. Navigation**
**Location: `ChatNavigator.js`**

Add new screen:
```javascript
<Stack.Screen
  name="GroupChat"
  component={GroupChatScreen}
  options={({ route }) => ({
    title: route.params?.groupName || 'Group Chat'
  })}
/>
```

---

## 🔧 Implementation Steps

### **Phase 1: Group Creation**

#### Step 1.1: Update `OnlineUsersList.jsx`
- Add "Create Group" button in header
- Add checkbox selection mode
- Allow selecting multiple users
- Pass selected users to creation modal

#### Step 1.2: Create `CreateGroupModal.jsx`
- Input for group name (optional)
- Show selected members
- Create group function

#### Step 1.3: Create `createGroup()` function
**Location: `Code/ChatScreen/utils/groupUtils.js` (new file)**

```javascript
// Firestore: Create group document
// RTDB: Initialize group_meta_data for each member
// Return groupId
```

### **Phase 2: Group Chat Screen**

#### Step 2.1: Create `GroupChatScreen.jsx`
- Similar structure to `PrivateChat.jsx`
- Load messages from `group_messages/{groupId}/messages`
- Show group members in header
- Handle sending messages to group

#### Step 2.2: Create `GroupMessageList.jsx`
- Similar to `PrivateMessageList.jsx`
- Display group messages
- Show sender name for each message

#### Step 2.3: Create `GroupMessageInput.jsx`
- Similar to `PrivateMessageInput.jsx`
- Send to group instead of individual

### **Phase 3: Group Management**

#### Step 3.1: Group Settings/Info
- View group members
- Add members (from online users)
- Remove members (admin only)
- Leave group
- Delete group (admin only)

#### Step 3.2: Update `InboxScreen.jsx`
- Add tabs for "Private" and "Groups"
- Load groups from `group_meta_data/{userId}`
- Display groups similar to private chats

### **Phase 4: Real-time Updates**

#### Step 4.1: Group Metadata Sync
- Listen to `groups/{groupId}` in Firestore for member changes
- Update `group_meta_data` in RTDB when group changes
- Handle member additions/removals

#### Step 4.2: Unread Count Management
- Update `group_meta_data/{userId}/{groupId}/unreadCount` on new messages
- Reset when user opens group chat
- Similar to private chat pattern

---

## 💰 Cost Optimization Strategies

### **Firestore Reads (Minimize)**:
1. ✅ **Batch Operations**: Use `batch()` for creating group + member metadata
2. ✅ **Single Document Reads**: Read `groups/{groupId}` only when needed
3. ✅ **Indexed Queries**: Use `memberIds` array for "groups I'm in" queries
4. ✅ **Cache Group Info**: Store group name/avatar in `group_meta_data` to avoid Firestore reads

### **RTDB Writes (Optimize)**:
1. ✅ **Message Structure**: Keep messages lightweight (same as private chat)
2. ✅ **Metadata Updates**: Only update `group_meta_data` when necessary (new message, member change)
3. ✅ **Cleanup**: Remove `group_meta_data` when user leaves group

### **Real-time Listeners (Minimize)**:
1. ✅ **Conditional Listening**: Only listen to active groups (user is viewing)
2. ✅ **Pagination**: Load messages in batches (20 at a time, like private chat)
3. ✅ **Unsubscribe**: Properly cleanup listeners when leaving group chat

---

## 🔔 Client-Side Notifications & Unread Count (No Cloud Functions)

### **Current Private Chat Pattern:**
Your existing code uses:
- **RTDB**: `/activeChats/{userId}` - Tracks which chat user is currently viewing
- **RTDB**: `users/{userId}/activeChat` - Also used to check if user is in chat
- **Logic**: When sending message, check if receiver is in chat → only increment unreadCount if NOT in chat

### **Group Chat Pattern (Client-Side):**

#### **1. Active Chat Tracking:**
```javascript
// When user opens group chat
setActiveGroupChat(userId, groupId) {
  // Set: /activeChats/{userId} = groupId
  // Also set: /activeGroupChats/{groupId}/{userId} = true (for batch checking)
}

// When user leaves group chat
clearActiveGroupChat(userId, groupId) {
  // Set: /activeChats/{userId} = null
  // Remove: /activeGroupChats/{groupId}/{userId}
}
```

#### **2. Sending Group Message (Client-Side Unread Logic):**
```javascript
async sendGroupMessage(groupId, messageData) {
  // 1. Save message to RTDB: group_messages/{groupId}/messages/{timestamp}
  
  // 2. Get all group members from Firestore (groups/{groupId}/memberIds)
  const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
  const memberIds = groupDoc.data().memberIds || [];
  
  // 3. Batch check which members are currently viewing this group
  // Option A: Check each /activeChats/{memberId} individually (simple but N reads)
  // Option B: Use /activeGroupChats/{groupId} node (1 read, but need to maintain it)
  
  // 4. Update group_meta_data for each member:
  for (const memberId of memberIds) {
    if (memberId === senderId) {
      // Sender: unreadCount = 0, update lastMessage
      await update(group_meta_data/{memberId}/{groupId}, {
        lastMessage: preview,
        timestamp: now,
        unreadCount: 0
      });
    } else {
      // Check if member is viewing this group
      const activeChatRef = ref(appdatabase, `/activeChats/${memberId}`);
      const snapshot = await get(activeChatRef);
      const isMemberInChat = snapshot.val() === groupId;
      
      // Update receiver's metadata
      await update(group_meta_data/{memberId}/{groupId}, {
        lastMessage: preview,
        timestamp: now,
        unreadCount: isMemberInChat ? 0 : increment(1)
      });
    }
  }
}
```

#### **3. Optimized Batch Check (Recommended):**
Instead of checking each member individually, maintain a node:
```javascript
// RTDB Structure:
activeGroupChats/{groupId} = {
  "userId1": true,
  "userId2": true,
  // Only members currently viewing this group
}

// When entering group:
await set(ref(appdatabase, `activeGroupChats/${groupId}/${userId}`), true);
await onDisconnect(ref(appdatabase, `activeGroupChats/${groupId}/${userId}`)).remove();

// When sending message:
const activeMembersRef = ref(appdatabase, `activeGroupChats/${groupId}`);
const activeMembersSnap = await get(activeMembersRef);
const activeMemberIds = activeMembersSnap.exists() 
  ? Object.keys(activeMembersSnap.val() || {}) 
  : [];

// Now update metadata:
for (const memberId of memberIds) {
  const isActive = activeMemberIds.includes(memberId);
  // Update unreadCount accordingly
}
```

#### **4. Group Chat Screen (useFocusEffect):**
```javascript
useFocusEffect(
  useCallback(() => {
    if (!user?.id || !groupId) return;

    // Set active chat
    setActiveChat(user.id, groupId); // Uses existing function
    setActiveGroupChat(user.id, groupId); // New function for batch checking
    
    // Reset unreadCount
    const groupMetaRef = ref(appdatabase, `group_meta_data/${user.id}/${groupId}`);
    update(groupMetaRef, { unreadCount: 0 });

    return () => {
      clearActiveChat(user.id);
      clearActiveGroupChat(user.id, groupId);
    };
  }, [user?.id, groupId])
);
```

#### **5. Helper Functions (Add to utils.js):**
```javascript
// Set active group chat (for batch checking)
export const setActiveGroupChat = async (userId, groupId) => {
  if (!userId || !groupId) return;
  
  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    await set(activeGroupRef, true);
    await onDisconnect(activeGroupRef).remove();
  } catch (error) {
    console.error('Failed to set active group chat:', error);
  }
};

// Clear active group chat
export const clearActiveGroupChat = async (userId, groupId) => {
  if (!userId || !groupId) return;
  
  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    await set(activeGroupRef, null);
  } catch (error) {
    console.error('Failed to clear active group chat:', error);
  }
};

// Check if user is in active group (for notifications)
export const isUserInActiveGroup = async (groupId, userId) => {
  if (!groupId || !userId) return false;
  
  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    const snapshot = await get(activeGroupRef);
    return snapshot.exists() && snapshot.val() === true;
  } catch (error) {
    console.error('Error checking active group:', error);
    return false;
  }
};
```

#### **6. Sending Group Message (Complete Function):**
```javascript
const sendGroupMessage = async (groupId, messageData) => {
  const timestamp = Date.now();
  const messageRef = ref(appdatabase, `group_messages/${groupId}/messages/${timestamp}`);
  
  // 1. Save message
  await set(messageRef, messageData);
  
  // 2. Get group members from Firestore
  const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
  if (!groupDoc.exists()) return;
  
  const groupData = groupDoc.data();
  const memberIds = groupData.memberIds || [];
  const lastMessagePreview = messageData.text || '📷 Photo' || '🐾 Pet(s)';
  
  // 3. Get active members (batch check)
  const activeGroupRef = ref(appdatabase, `activeGroupChats/${groupId}`);
  const activeMembersSnap = await get(activeGroupRef);
  const activeMemberIds = activeMembersSnap.exists()
    ? Object.keys(activeMembersSnap.val() || {})
    : [];
  
  // 4. Update metadata for all members
  const updates = {};
  for (const memberId of memberIds) {
    const isActive = activeMemberIds.includes(memberId);
    const isSender = memberId === user.id;
    
    updates[`group_meta_data/${memberId}/${groupId}/lastMessage`] = lastMessagePreview;
    updates[`group_meta_data/${memberId}/${groupId}/timestamp`] = timestamp;
    updates[`group_meta_data/${memberId}/${groupId}/lastMessageSenderId`] = user.id;
    
    if (isSender) {
      // Sender: always 0 unread
      updates[`group_meta_data/${memberId}/${groupId}/unreadCount`] = 0;
    } else {
      // Receiver: 0 if active, increment if not
      if (isActive) {
        updates[`group_meta_data/${memberId}/${groupId}/unreadCount`] = 0;
      } else {
        // Need to get current count first, then increment
        const currentMetaRef = ref(appdatabase, `group_meta_data/${memberId}/${groupId}`);
        const currentMetaSnap = await get(currentMetaRef);
        const currentUnread = currentMetaSnap.exists() 
          ? (currentMetaSnap.val().unreadCount || 0) 
          : 0;
        updates[`group_meta_data/${memberId}/${groupId}/unreadCount`] = currentUnread + 1;
      }
    }
  }
  
  // 5. Batch update all metadata
  await update(ref(appdatabase, '/'), updates);
};
```

#### **7. Cost Analysis:**
- **RTDB Reads**: 
  - 1 read for `activeGroupChats/{groupId}` (batch check all members)
  - N reads for current unreadCounts (only if incrementing)
  - **Total**: ~1-10 reads per message (depending on group size)
  
- **RTDB Writes**:
  - 1 write for message
  - N writes for metadata updates (one per member)
  - **Total**: ~N+1 writes per message

- **Firestore Reads**:
  - 1 read for group document (to get memberIds)
  - **Total**: 1 read per message

**Comparison to Cloud Function:**
- Cloud Function: 0 client reads, but costs server resources
- Client-Side: ~1-10 RTDB reads, but no server costs
- **Recommendation**: Client-side is fine for groups < 50 members

---

## 🔔 Client-Side Notifications & Unread Count (No Cloud Functions)

### **Current Private Chat Pattern:**
Your existing code uses:
- **RTDB**: `/activeChats/{userId}` - Tracks which chat user is currently viewing (set by `setActiveChat()`)
- **RTDB**: `users/{userId}/activeChat` - Also checked in `sendMessage()` (may be legacy or dual pattern)
- **Logic**: When sending message, check if receiver is in chat → only increment unreadCount if NOT in chat

### **Group Chat Pattern (Client-Side):**

#### **1. Active Chat Tracking:**
```javascript
// When user opens group chat (in GroupChatScreen.jsx)
useFocusEffect(
  useCallback(() => {
    if (!user?.id || !groupId) return;

    // Set active chat (uses existing function)
    setActiveChat(user.id, groupId); // Sets: /activeChats/{userId} = groupId
    
    // Also set in group-specific node for batch checking
    setActiveGroupChat(user.id, groupId); // Sets: /activeGroupChats/{groupId}/{userId} = true
    
    // Reset unreadCount when entering
    const groupMetaRef = ref(appdatabase, `group_meta_data/${user.id}/${groupId}`);
    update(groupMetaRef, { unreadCount: 0 });

    return () => {
      clearActiveChat(user.id);
      clearActiveGroupChat(user.id, groupId);
    };
  }, [user?.id, groupId])
);
```

#### **2. Helper Functions (Add to `Code/ChatScreen/utils.js`):**
```javascript
// Set active group chat (for efficient batch checking)
export const setActiveGroupChat = async (userId, groupId) => {
  if (!userId || !groupId) return;
  
  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    await set(activeGroupRef, true);
    await onDisconnect(activeGroupRef).remove(); // Auto-clear on disconnect
  } catch (error) {
    console.error('Failed to set active group chat:', error);
  }
};

// Clear active group chat
export const clearActiveGroupChat = async (userId, groupId) => {
  if (!userId || !groupId) return;
  
  try {
    const database = getDatabase();
    const activeGroupRef = ref(database, `activeGroupChats/${groupId}/${userId}`);
    await set(activeGroupRef, null);
  } catch (error) {
    console.error('Failed to clear active group chat:', error);
  }
};
```

#### **3. Sending Group Message (Client-Side Unread Logic):**
```javascript
// In GroupChatScreen.jsx or groupUtils.js
const sendGroupMessage = async (groupId, messageData) => {
  const timestamp = Date.now();
  const messageRef = ref(appdatabase, `group_messages/${groupId}/messages/${timestamp}`);
  
  // 1. Save message to RTDB
  await set(messageRef, messageData);
  
  // 2. Get group members from Firestore (1 read)
  const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
  if (!groupDoc.exists()) {
    console.error('Group not found');
    return;
  }
  
  const groupData = groupDoc.data();
  const memberIds = groupData.memberIds || [];
  const lastMessagePreview = messageData.text || (messageData.imageUrl ? '📷 Photo' : '🐾 Pet(s)');
  
  // 3. Batch check which members are currently viewing (1 read for all members)
  const activeGroupRef = ref(appdatabase, `activeGroupChats/${groupId}`);
  const activeMembersSnap = await get(activeGroupRef);
  const activeMemberIds = activeMembersSnap.exists()
    ? Object.keys(activeMembersSnap.val() || {})
    : [];
  
  // 4. Prepare batch updates for all members
  const updates = {};
  
  for (const memberId of memberIds) {
    const isActive = activeMemberIds.includes(memberId);
    const isSender = memberId === user.id;
    
    // Always update lastMessage and timestamp
    updates[`group_meta_data/${memberId}/${groupId}/lastMessage`] = lastMessagePreview;
    updates[`group_meta_data/${memberId}/${groupId}/timestamp`] = timestamp;
    updates[`group_meta_data/${groupId}/lastMessageSenderId`] = user.id;
    updates[`group_meta_data/${memberId}/${groupId}/lastMessageSenderName`] = user.displayName || 'Anonymous';
    
    if (isSender) {
      // Sender: always 0 unread
      updates[`group_meta_data/${memberId}/${groupId}/unreadCount`] = 0;
    } else if (isActive) {
      // Active member: 0 unread
      updates[`group_meta_data/${memberId}/${groupId}/unreadCount`] = 0;
    } else {
      // Inactive member: need to get current count and increment
      // We'll do this in a separate batch after getting current counts
    }
  }
  
  // 5. For inactive members, get current unreadCount first
  const inactiveMemberIds = memberIds.filter(
    id => id !== user.id && !activeMemberIds.includes(id)
  );
  
  if (inactiveMemberIds.length > 0) {
    // Batch read current unreadCounts (1 read per inactive member)
    const unreadCountPromises = inactiveMemberIds.map(async (memberId) => {
      const metaRef = ref(appdatabase, `group_meta_data/${memberId}/${groupId}`);
      const metaSnap = await get(metaRef);
      const currentUnread = metaSnap.exists() 
        ? (metaSnap.val().unreadCount || 0) 
        : 0;
      return { memberId, currentUnread };
    });
    
    const unreadCounts = await Promise.all(unreadCountPromises);
    
    // Add increment updates
    unreadCounts.forEach(({ memberId, currentUnread }) => {
      updates[`group_meta_data/${memberId}/${groupId}/unreadCount`] = currentUnread + 1;
    });
  }
  
  // 6. Batch update all metadata at once
  await update(ref(appdatabase, '/'), updates);
};
```

#### **4. Alternative: Simpler Approach (Check Individual activeChats):**
If you prefer to use existing `/activeChats/{userId}` pattern (no new node needed):
```javascript
const sendGroupMessage = async (groupId, messageData) => {
  // ... save message ...
  
  // Get members from Firestore
  const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
  const memberIds = groupDoc.data().memberIds || [];
  
  // Check each member's activeChat (N reads, but simpler)
  const activeChecks = await Promise.all(
    memberIds.map(async (memberId) => {
      if (memberId === user.id) return { memberId, isActive: true };
      
      const activeChatRef = ref(appdatabase, `/activeChats/${memberId}`);
      const snap = await get(activeChatRef);
      return { 
        memberId, 
        isActive: snap.exists() && snap.val() === groupId 
      };
    })
  );
  
  // Update metadata
  const updates = {};
  activeChecks.forEach(({ memberId, isActive }) => {
    // ... update logic ...
  });
  
  await update(ref(appdatabase, '/'), updates);
};
```

#### **5. Cost Comparison:**

**Option A: Batch Check (`activeGroupChats/{groupId}`)**
- RTDB Reads: 1 (for activeGroupChats) + N (for current unreadCounts of inactive members)
- RTDB Writes: 1 (message) + N (metadata updates)
- **Best for**: Groups with many active members

**Option B: Individual Check (`/activeChats/{userId}`)**
- RTDB Reads: N (one per member)
- RTDB Writes: 1 (message) + N (metadata updates)
- **Best for**: Small groups (< 10 members) or if you want to reuse existing pattern

**Recommendation**: Use Option A for groups > 5 members, Option B for smaller groups

#### **6. Notification Handling:**
Since you're not using Cloud Functions, handle notifications client-side:
```javascript
// In GroupChatScreen.jsx - Listen to new messages
useEffect(() => {
  if (!groupId || !user?.id) return;
  
  const messagesRef = ref(appdatabase, `group_messages/${groupId}/messages`);
  const listener = messagesRef.limitToLast(1).on('child_added', (snapshot) => {
    const newMessage = snapshot.val();
    
    // Only show notification if:
    // 1. User is NOT currently viewing this group
    // 2. Message is not from current user
    // 3. User is not banned from group
    
    if (newMessage.senderId !== user.id && !isViewingGroup) {
      // Show local notification (using notifee or similar)
      showGroupNotification(groupName, newMessage.text, groupId);
    }
  });
  
  return () => messagesRef.off('child_added', listener);
}, [groupId, user?.id, isViewingGroup]);
```

---

## 👥 Group Membership Management

### **1. Group Invitations System**

#### **Data Structure:**
```javascript
// Firestore: groups/{groupId}/invitations/{invitedUserId}
groups/{groupId}/invitations/{invitedUserId} = {
  invitedBy: "userId123", // Who sent the invite
  invitedUserId: "userId456",
  status: "pending" | "accepted" | "declined" | "expired",
  timestamp: Timestamp,
  expiresAt: Timestamp, // Optional: 7 days expiry
  invitedByDisplayName: "User 1",
  invitedByAvatar: "url"
}

// OR separate collection (cleaner):
group_invitations/{inviteId} = {
  groupId: "group_123",
  invitedBy: "userId123",
  invitedUserId: "userId456",
  status: "pending",
  timestamp: Timestamp,
  expiresAt: Timestamp,
  groupName: "My Group", // For notification display
  groupAvatar: "url"
}
```

#### **Invitation Flow:**
```javascript
// 1. Send Group Invitation
const sendGroupInvite = async (groupId, invitedUserId, inviterData) => {
  // Check if user is already in group
  const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
  const memberIds = groupDoc.data().memberIds || [];
  if (memberIds.includes(invitedUserId)) {
    return { success: false, error: 'User is already in group' };
  }
  
  // Check if pending invite exists
  const existingInvite = await getDocs(
    query(
      collection(firestoreDB, 'group_invitations'),
      where('groupId', '==', groupId),
      where('invitedUserId', '==', invitedUserId),
      where('status', '==', 'pending')
    )
  );
  
  if (!existingInvite.empty) {
    return { success: false, error: 'Invitation already sent' };
  }
  
  // Create invitation
  const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
  await addDoc(collection(firestoreDB, 'group_invitations'), {
    groupId,
    invitedBy: inviterData.id,
    invitedUserId,
    status: 'pending',
    timestamp: serverTimestamp(),
    expiresAt,
    groupName: groupDoc.data().name || 'Group',
    groupAvatar: groupDoc.data().avatar || null,
    invitedByDisplayName: inviterData.displayName,
    invitedByAvatar: inviterData.avatar
  });
  
  return { success: true };
};

// 2. Accept Group Invitation
const acceptGroupInvite = async (inviteId, userId) => {
  const inviteRef = doc(firestoreDB, 'group_invitations', inviteId);
  const inviteSnap = await getDoc(inviteRef);
  
  if (!inviteSnap.exists()) {
    return { success: false, error: 'Invitation not found' };
  }
  
  const inviteData = inviteSnap.data();
  
  // Validate
  if (inviteData.invitedUserId !== userId) {
    return { success: false, error: 'Not your invitation' };
  }
  
  if (inviteData.status !== 'pending') {
    return { success: false, error: 'Invitation already processed' };
  }
  
  if (Date.now() > inviteData.expiresAt) {
    return { success: false, error: 'Invitation expired' };
  }
  
  // Get group data
  const groupRef = doc(firestoreDB, 'groups', inviteData.groupId);
  const groupSnap = await getDoc(groupRef);
  
  if (!groupSnap.exists()) {
    return { success: false, error: 'Group not found' };
  }
  
  const groupData = groupSnap.data();
  
  // Check if already member
  if (groupData.memberIds?.includes(userId)) {
    // Mark invite as accepted anyway
    await updateDoc(inviteRef, { status: 'accepted' });
    return { success: false, error: 'Already in group' };
  }
  
  // Add user to group (transaction to prevent race conditions)
  await runTransaction(firestoreDB, async (transaction) => {
    const freshGroupSnap = await transaction.get(groupRef);
    const freshData = freshGroupSnap.data();
    
    // Double-check not already member
    if (freshData.memberIds?.includes(userId)) {
      throw new Error('Already in group');
    }
    
    // Add to members
    const newMemberIds = [...(freshData.memberIds || []), userId];
    const newMembers = {
      ...(freshData.members || {}),
      [userId]: {
        id: userId,
        displayName: user.displayName || 'Anonymous',
        avatar: user.avatar || null,
        role: 'member',
        joinedAt: serverTimestamp()
      }
    };
    
    transaction.update(groupRef, {
      memberIds: newMemberIds,
      members: newMembers,
      memberCount: newMemberIds.length,
      updatedAt: serverTimestamp()
    });
    
    // Mark invite as accepted
    transaction.update(inviteRef, { status: 'accepted' });
  });
  
  // Create group_meta_data for new member
  const groupMetaRef = ref(appdatabase, `group_meta_data/${userId}/${inviteData.groupId}`);
  await set(groupMetaRef, {
    groupId: inviteData.groupId,
    groupName: groupData.name || 'Group',
    groupAvatar: groupData.avatar || null,
    lastMessage: null,
    lastMessageTimestamp: 0,
    unreadCount: 0,
    muted: false,
    joinedAt: Date.now()
  });
  
  return { success: true, groupId: inviteData.groupId };
};

// 3. Decline Group Invitation
const declineGroupInvite = async (inviteId, userId) => {
  const inviteRef = doc(firestoreDB, 'group_invitations', inviteId);
  const inviteSnap = await getDoc(inviteRef);
  
  if (!inviteSnap.exists()) return { success: false };
  
  const inviteData = inviteSnap.data();
  if (inviteData.invitedUserId !== userId) {
    return { success: false, error: 'Not your invitation' };
  }
  
  await updateDoc(inviteRef, { status: 'declined' });
  return { success: true };
};
```

### **2. Group Joining (Direct Join - Optional)**

For public groups or groups with join links:
```javascript
const joinGroup = async (groupId, userId, userData) => {
  const groupRef = doc(firestoreDB, 'groups', groupId);
  
  return await runTransaction(firestoreDB, async (transaction) => {
    const groupSnap = await transaction.get(groupRef);
    if (!groupSnap.exists()) {
      throw new Error('Group not found');
    }
    
    const groupData = groupSnap.data();
    
    // Check if already member
    if (groupData.memberIds?.includes(userId)) {
      return { success: false, error: 'Already in group' };
    }
    
    // Check group settings (if private, require invite)
    if (groupData.isPrivate && !groupData.allowDirectJoin) {
      return { success: false, error: 'Group requires invitation' };
    }
    
    // Add member
    const newMemberIds = [...(groupData.memberIds || []), userId];
    const newMembers = {
      ...(groupData.members || {}),
      [userId]: {
        id: userId,
        displayName: userData.displayName,
        avatar: userData.avatar,
        role: 'member',
        joinedAt: serverTimestamp()
      }
    };
    
    transaction.update(groupRef, {
      memberIds: newMemberIds,
      members: newMembers,
      memberCount: newMemberIds.length,
      updatedAt: serverTimestamp()
    });
    
    return { success: true };
  });
};
```

### **3. Leaving Group**

```javascript
const leaveGroup = async (groupId, userId) => {
  const groupRef = doc(firestoreDB, 'groups', groupId);
  
  return await runTransaction(firestoreDB, async (transaction) => {
    const groupSnap = await transaction.get(groupRef);
    if (!groupSnap.exists()) {
      return { success: false, error: 'Group not found' };
    }
    
    const groupData = groupSnap.data();
    
    // Check if user is member
    if (!groupData.memberIds?.includes(userId)) {
      return { success: false, error: 'Not a member' };
    }
    
    // Remove from members
    const newMemberIds = groupData.memberIds.filter(id => id !== userId);
    const newMembers = { ...groupData.members };
    delete newMembers[userId];
    
    // If user is admin/creator, transfer ownership or delete group
    const userRole = groupData.members[userId]?.role;
    const isCreator = groupData.createdBy === userId;
    
    if (isCreator || userRole === 'admin') {
      // If only member left, delete group
      if (newMemberIds.length === 0) {
        transaction.delete(groupRef);
      } else {
        // Transfer ownership to first admin or first member
        const newOwnerId = newMemberIds.find(id => 
          groupData.members[id]?.role === 'admin'
        ) || newMemberIds[0];
        
        transaction.update(groupRef, {
          createdBy: newOwnerId,
          members: {
            ...newMembers,
            [newOwnerId]: {
              ...newMembers[newOwnerId],
              role: 'admin'
            }
          },
          memberIds: newMemberIds,
          members: newMembers,
          memberCount: newMemberIds.length,
          updatedAt: serverTimestamp()
        });
      }
    } else {
      // Regular member leaving
      transaction.update(groupRef, {
        memberIds: newMemberIds,
        members: newMembers,
        memberCount: newMemberIds.length,
        updatedAt: serverTimestamp()
      });
    }
    
    // Remove group_meta_data
    const groupMetaRef = ref(appdatabase, `group_meta_data/${userId}/${groupId}`);
    await set(groupMetaRef, null);
    
    // Clear active chat if user is viewing
    await clearActiveGroupChat(userId, groupId);
    
    return { success: true };
  });
};
```

### **4. Admin Roles & Permissions**

#### **Role Hierarchy:**
```javascript
// Roles in group:
{
  "creator": "userId123", // Group creator (highest authority)
  "admins": ["userId123", "userId456"], // Can manage group
  "members": ["userId789", "userId101"] // Regular members
}

// OR store in members object:
members: {
  "userId123": { role: "admin" }, // creator is also admin
  "userId456": { role: "admin" },
  "userId789": { role: "member" }
}
```

#### **Admin Authorities:**

**Creator (Highest Authority):**
- ✅ All admin permissions
- ✅ Delete group
- ✅ Transfer ownership
- ✅ Cannot be removed (unless transfers ownership first)

**Admin Permissions:**
- ✅ Add members (send invitations)
- ✅ Remove members (except creator)
- ✅ Promote members to admin
- ✅ Demote admins to members (except creator)
- ✅ Edit group name/description
- ✅ Change group avatar
- ✅ Mute/unmute members
- ✅ Pin/unpin messages
- ❌ Cannot delete group (only creator)
- ❌ Cannot remove creator
- ❌ Cannot transfer ownership

**Member Permissions:**
- ✅ Send messages
- ✅ View group info
- ✅ Leave group
- ✅ View members list
- ❌ Cannot manage group
- ❌ Cannot add/remove members

#### **Admin Functions:**

```javascript
// 1. Add Member (Admin only)
const addGroupMember = async (groupId, adminId, newMemberId, newMemberData) => {
  // Check admin permissions
  const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
  const groupData = groupDoc.data();
  const userRole = groupData.members[adminId]?.role;
  
  if (userRole !== 'admin' && groupData.createdBy !== adminId) {
    return { success: false, error: 'Admin access required' };
  }
  
  // Check if already member
  if (groupData.memberIds?.includes(newMemberId)) {
    return { success: false, error: 'Already in group' };
  }
  
  // Add member (same as joinGroup logic)
  // ...
};

// 2. Remove Member (Admin only, except creator)
const removeGroupMember = async (groupId, adminId, memberToRemoveId) => {
  const groupRef = doc(firestoreDB, 'groups', groupId);
  
  return await runTransaction(firestoreDB, async (transaction) => {
    const groupSnap = await transaction.get(groupRef);
    const groupData = groupSnap.data();
    
    // Check admin permissions
    const adminRole = groupData.members[adminId]?.role;
    if (adminRole !== 'admin' && groupData.createdBy !== adminId) {
      throw new Error('Admin access required');
    }
    
    // Cannot remove creator
    if (groupData.createdBy === memberToRemoveId) {
      throw new Error('Cannot remove group creator');
    }
    
    // Cannot remove yourself (use leaveGroup instead)
    if (adminId === memberToRemoveId) {
      throw new Error('Use leaveGroup to remove yourself');
    }
    
    // Remove member
    const newMemberIds = groupData.memberIds.filter(id => id !== memberToRemoveId);
    const newMembers = { ...groupData.members };
    delete newMembers[memberToRemoveId];
    
    transaction.update(groupRef, {
      memberIds: newMemberIds,
      members: newMembers,
      memberCount: newMemberIds.length,
      updatedAt: serverTimestamp()
    });
    
    // Remove group_meta_data
    const groupMetaRef = ref(appdatabase, `group_meta_data/${memberToRemoveId}/${groupId}`);
    await set(groupMetaRef, null);
    
    return { success: true };
  });
};

// 3. Promote to Admin (Creator/Admin only)
const promoteToAdmin = async (groupId, adminId, memberToPromoteId) => {
  const groupRef = doc(firestoreDB, 'groups', groupId);
  
  return await runTransaction(firestoreDB, async (transaction) => {
    const groupSnap = await transaction.get(groupRef);
    const groupData = groupSnap.data();
    
    // Check permissions (only creator or existing admin)
    const adminRole = groupData.members[adminId]?.role;
    const isCreator = groupData.createdBy === adminId;
    
    if (!isCreator && adminRole !== 'admin') {
      throw new Error('Admin access required');
    }
    
    // Check if member exists
    if (!groupData.memberIds?.includes(memberToPromoteId)) {
      throw new Error('User is not a member');
    }
    
    // Promote
    transaction.update(groupRef, {
      [`members.${memberToPromoteId}.role`]: 'admin',
      updatedAt: serverTimestamp()
    });
    
    return { success: true };
  });
};

// 4. Demote Admin (Creator only, cannot demote creator)
const demoteAdmin = async (groupId, creatorId, adminToDemoteId) => {
  const groupRef = doc(firestoreDB, 'groups', groupId);
  
  return await runTransaction(firestoreDB, async (transaction) => {
    const groupSnap = await transaction.get(groupRef);
    const groupData = groupSnap.data();
    
    // Only creator can demote
    if (groupData.createdBy !== creatorId) {
      throw new Error('Only creator can demote admins');
    }
    
    // Cannot demote creator
    if (groupData.createdBy === adminToDemoteId) {
      throw new Error('Cannot demote group creator');
    }
    
    // Demote
    transaction.update(groupRef, {
      [`members.${adminToDemoteId}.role`]: 'member',
      updatedAt: serverTimestamp()
    });
    
    return { success: true };
  });
};

// 5. Edit Group Info (Admin only)
const editGroupInfo = async (groupId, adminId, updates) => {
  const groupRef = doc(firestoreDB, 'groups', groupId);
  
  // Check admin permissions
  const groupDoc = await getDoc(groupRef);
  const groupData = groupDoc.data();
  const userRole = groupData.members[adminId]?.role;
  
  if (userRole !== 'admin' && groupData.createdBy !== adminId) {
    return { success: false, error: 'Admin access required' };
  }
  
  await updateDoc(groupRef, {
    ...updates, // { name, description, avatar }
    updatedAt: serverTimestamp()
  });
  
  // Update group_meta_data for all members (so they see new name)
  const memberIds = groupData.memberIds || [];
  const metaUpdates = {};
  memberIds.forEach(memberId => {
    if (updates.name) {
      metaUpdates[`group_meta_data/${memberId}/${groupId}/groupName`] = updates.name;
    }
    if (updates.avatar) {
      metaUpdates[`group_meta_data/${memberId}/${groupId}/groupAvatar`] = updates.avatar;
    }
  });
  
  if (Object.keys(metaUpdates).length > 0) {
    await update(ref(appdatabase, '/'), metaUpdates);
  }
  
  return { success: true };
};

// 6. Delete Group (Creator only)
const deleteGroup = async (groupId, creatorId) => {
  const groupRef = doc(firestoreDB, 'groups', groupId);
  
  return await runTransaction(firestoreDB, async (transaction) => {
    const groupSnap = await transaction.get(groupRef);
    if (!groupSnap.exists()) {
      return { success: false, error: 'Group not found' };
    }
    
    const groupData = groupSnap.data();
    
    // Only creator can delete
    if (groupData.createdBy !== creatorId) {
      throw new Error('Only creator can delete group');
    }
    
    // Delete group document
    transaction.delete(groupRef);
    
    // Delete all group_meta_data for all members
    const memberIds = groupData.memberIds || [];
    const deletePromises = memberIds.map(memberId => {
      const groupMetaRef = ref(appdatabase, `group_meta_data/${memberId}/${groupId}`);
      return set(groupMetaRef, null);
    });
    
    await Promise.all(deletePromises);
    
    // Delete all messages (optional - or archive them)
    const messagesRef = ref(appdatabase, `group_messages/${groupId}`);
    await set(messagesRef, null);
    
    return { success: true };
  });
};

// 7. Transfer Ownership (Creator only)
const transferOwnership = async (groupId, creatorId, newOwnerId) => {
  const groupRef = doc(firestoreDB, 'groups', groupId);
  
  return await runTransaction(firestoreDB, async (transaction) => {
    const groupSnap = await transaction.get(groupRef);
    const groupData = groupSnap.data();
    
    // Only creator can transfer
    if (groupData.createdBy !== creatorId) {
      throw new Error('Only creator can transfer ownership');
    }
    
    // New owner must be member
    if (!groupData.memberIds?.includes(newOwnerId)) {
      throw new Error('New owner must be a member');
    }
    
    // Transfer
    transaction.update(groupRef, {
      createdBy: newOwnerId,
      [`members.${newOwnerId}.role`]: 'admin', // Ensure new owner is admin
      updatedAt: serverTimestamp()
    });
    
    return { success: true };
  });
};

// 8. Mute/Unmute Member (Admin only)
const muteGroupMember = async (groupId, adminId, memberToMuteId, muted = true) => {
  // Check admin permissions
  const groupDoc = await getDoc(doc(firestoreDB, 'groups', groupId));
  const groupData = groupDoc.data();
  const userRole = groupData.members[adminId]?.role;
  
  if (userRole !== 'admin' && groupData.createdBy !== adminId) {
    return { success: false, error: 'Admin access required' };
  }
  
  // Update in group document
  await updateDoc(doc(firestoreDB, 'groups', groupId), {
    [`members.${memberToMuteId}.muted`]: muted,
    updatedAt: serverTimestamp()
  });
  
  // Also update in group_meta_data (for client-side checks)
  const groupMetaRef = ref(appdatabase, `group_meta_data/${memberToMuteId}/${groupId}`);
  await update(groupMetaRef, { muted });
  
  return { success: true };
};
```

### **5. Permission Check Helper**

```javascript
// In groupUtils.js
export const hasGroupPermission = (groupData, userId, permission) => {
  if (!groupData || !userId) return false;
  
  const userRole = groupData.members[userId]?.role;
  const isCreator = groupData.createdBy === userId;
  
  switch (permission) {
    case 'delete_group':
      return isCreator;
    
    case 'add_member':
    case 'remove_member':
    case 'promote_admin':
    case 'edit_group':
    case 'mute_member':
      return isCreator || userRole === 'admin';
    
    case 'send_message':
      return groupData.memberIds?.includes(userId) && 
             !groupData.members[userId]?.muted;
    
    case 'view_group':
      return groupData.memberIds?.includes(userId);
    
    default:
      return false;
  }
};
```

### **6. Group Settings**

```javascript
// Add to groups/{groupId} document:
{
  // ... existing fields ...
  isPrivate: false, // If true, requires invitation
  allowDirectJoin: true, // If false, only admins can add
  maxMembers: 50, // Optional limit
  allowMemberInvites: true, // If false, only admins can invite
  description: "Group description",
  avatar: "url", // Optional group avatar
  settings: {
    onlyAdminsCanSend: false, // If true, only admins can message
    allowFileSharing: true,
    allowPetSharing: true
  }
}
```

---

## 📐 Data Flow Example

### **Creating a Group:**
```
1. User selects 3 members in OnlineUsersList
2. Click "Create Group" → Opens CreateGroupModal
3. Enter group name (optional)
4. Call createGroup(firestoreDB, appdatabase, {
     creatorId: user.id,
     memberIds: [user.id, ...selectedIds],
     groupName: "My Group"
   })
5. Firestore: Create groups/{groupId} document
6. RTDB: Create group_meta_data/{userId}/{groupId} for each member
7. Navigate to GroupChatScreen with groupId
```

### **Sending a Message:**
```
1. User types message in GroupChatScreen
2. Call sendGroupMessage(appdatabase, groupId, messageData)
3. RTDB: Push to group_messages/{groupId}/messages/{timestamp}
4. RTDB: Update group_meta_data/{userId}/{groupId} for all members (lastMessage, timestamp)
5. RTDB: Increment unreadCount for members not currently viewing
```

### **Loading Group List:**
```
1. InboxScreen loads groups tab
2. Listen to RTDB: group_meta_data/{userId}
3. For each groupId, read group_meta_data/{userId}/{groupId}
4. Display groups sorted by lastMessageTimestamp
5. Show unreadCount badge
```

---

## 🎨 UI/UX Recommendations

### **Group Creation Flow:**
1. **OnlineUsersList**: Add "Create Group" button (top right)
2. **Selection Mode**: Toggle checkbox mode
3. **Selected Users**: Show count badge (e.g., "3 selected")
4. **Create Button**: Opens modal with:
   - Group name input (optional, default: "Group with User1, User2...")
   - Selected members list (with remove option)
   - "Create" button

### **Group Chat Screen:**
- Header: Group name + member count + settings icon
- Messages: Similar to private chat, but show sender name
- Input: Same as private chat (text, fruits, gif)
- Members: Tap header to see member list

### **Group List (Inbox):**
- Show group avatar (first member's avatar or group icon)
- Group name
- Last message preview
- Unread count badge
- Member count (e.g., "5 members")

---

## 🔒 Security & Validation

### **Firestore Security Rules** (to add):
```javascript
match /groups/{groupId} {
  allow read: if request.auth != null && 
    request.auth.uid in resource.data.memberIds;
  allow create: if request.auth != null && 
    request.auth.uid == request.resource.data.createdBy;
  allow update: if request.auth != null && 
    (request.auth.uid == resource.data.createdBy || 
     request.auth.uid in resource.data.members[request.auth.uid].role == 'admin');
}
```

### **RTDB Security Rules** (to add):
```javascript
{
  "group_messages": {
    "$groupId": {
      "messages": {
        ".read": "auth != null && root.child('groups').child($groupId).child('memberIds').hasChild(auth.uid)",
        ".write": "auth != null && root.child('groups').child($groupId).child('memberIds').hasChild(auth.uid)"
      }
    },
    "group_meta_data": {
      "$userId": {
        "$groupId": {
          ".read": "$userId === auth.uid",
          ".write": "$userId === auth.uid"
        }
      }
    }
  }
}
```

---

## 📝 File Structure

```
Code/ChatScreen/
├── GroupChat/
│   ├── Trader.jsx (existing - global chat)
│   ├── GroupChatScreen.jsx (NEW - individual group chat)
│   ├── GroupMessageList.jsx (NEW)
│   ├── GroupMessageInput.jsx (NEW)
│   ├── CreateGroupModal.jsx (NEW)
│   ├── GroupSettingsModal.jsx (NEW)
│   └── OnlineUsersList.jsx (UPDATE - add group creation)
├── utils/
│   ├── groupUtils.js (NEW - group creation, management)
│   └── ... (existing)
└── ChatNavigator.js (UPDATE - add GroupChat screen)
```

---

## ✅ Recommended Approach Summary

**Best Option**: **Hybrid (Firestore + RTDB)**

**Why:**
- ✅ Low Firestore read costs (only metadata)
- ✅ Fast real-time messages (RTDB)
- ✅ Efficient queries (Firestore indexes)
- ✅ Familiar pattern (same as private chat)
- ✅ Scalable (works for 1000+ groups)

**Implementation Order:**
1. Create `groupUtils.js` with `createGroup()` function
2. Update `OnlineUsersList.jsx` to add group creation UI
3. Create `GroupChatScreen.jsx` (similar to PrivateChat)
4. Add group list to `InboxScreen.jsx`
5. Add navigation route in `ChatNavigator.js`
6. Add group management features (add/remove members, leave)

**Estimated Cost:**
- **Firestore Reads**: ~1-2 per group creation, ~1 per group open
- **RTDB Reads**: Similar to private chat (pagination, real-time)
- **Firestore Writes**: Only on group creation/updates (rare)
- **RTDB Writes**: Same as private chat (messages, metadata)

---

## 🚀 Quick Start Checklist

- [ ] Create `Code/ChatScreen/utils/groupUtils.js`
- [ ] Update `OnlineUsersList.jsx` (add group creation button)
- [ ] Create `CreateGroupModal.jsx`
- [ ] Create `GroupChatScreen.jsx`
- [ ] Create `GroupMessageList.jsx`
- [ ] Create `GroupMessageInput.jsx`
- [ ] Update `InboxScreen.jsx` (add groups tab)
- [ ] Update `ChatNavigator.js` (add GroupChat route)
- [ ] Add Firestore security rules
- [ ] Add RTDB security rules
- [ ] Test group creation flow
- [ ] Test group messaging
- [ ] Test group management (add/remove members)

---

## 💡 Additional Features (Future)

- Group avatars (custom images)
- Group descriptions
- Admin roles (promote/demote)
- Group settings (mute, notifications)
- Group search
- Group invitations (like game invites)
- Group activity log

---

## 📊 Admin Permissions Summary Table

| Action | Creator | Admin | Member |
|--------|---------|-------|--------|
| **Send Messages** | ✅ | ✅ | ✅* |
| **View Group Info** | ✅ | ✅ | ✅ |
| **View Members** | ✅ | ✅ | ✅ |
| **Leave Group** | ✅ | ✅ | ✅ |
| **Send Invitations** | ✅ | ✅ | ✅** |
| **Add Members** | ✅ | ✅ | ❌ |
| **Remove Members** | ✅ | ✅* | ❌ |
| **Promote to Admin** | ✅ | ✅ | ❌ |
| **Demote Admin** | ✅ | ❌ | ❌ |
| **Edit Group Info** | ✅ | ✅ | ❌ |
| **Mute/Unmute Members** | ✅ | ✅ | ❌ |
| **Delete Group** | ✅ | ❌ | ❌ |
| **Transfer Ownership** | ✅ | ❌ | ❌ |

*Notes:*
- *Members can send messages unless muted by admin
- **Members can only invite if `allowMemberInvites` setting is enabled
- Admins cannot remove creator or demote creator
- Creator cannot be removed (must transfer ownership first)

---

## 🎨 UI/UX Implementation Recommendations

### **1. Group Invitation UI**

#### **Invite Modal (from OnlineUsersList):**
```javascript
// Similar to game invite modal
const GroupInviteModal = ({ visible, onClose, groupId }) => {
  // Show online users list
  // Allow selecting multiple users
  // Send invites in batch
  // Show pending invites with status
};
```

#### **Invitation Notification (Toast/In-App):**
```javascript
// Similar to game invite toast
const GroupInviteToast = ({ invite, onAccept, onDecline }) => {
  // Show group name, avatar, inviter name
  // Accept/Decline buttons
  // Auto-dismiss after 30 seconds
};
```

#### **Invitations Screen:**
```javascript
// New screen: GroupInvitationsScreen.jsx
// List all pending group invitations
// Show group info, inviter, timestamp
// Accept/Decline actions
// Filter expired invitations
```

### **2. Group Management UI**

#### **Group Info Screen:**
```javascript
// Show group details, members list, settings
// Admin actions (if admin):
//   - Add members button
//   - Remove member (long press)
//   - Promote/Demote (long press)
//   - Edit group info
//   - Delete group (creator only)
```

#### **Member List Component:**
```javascript
// Show all members with:
//   - Avatar, name, role badge (Admin/Creator)
//   - Online status
//   - Actions (if admin):
//     - Remove member
//     - Promote/Demote
//     - Mute/Unmute
```

### **3. Group Settings Screen**

```javascript
// Settings for admins:
//   - Group name
//   - Group description
//   - Group avatar
//   - Privacy (private/public)
//   - Allow direct join
//   - Allow member invites
//   - Max members
//   - Only admins can send messages
```

### **4. Navigation Flow**

```
OnlineUsersList
  └─> Create Group Modal
      └─> Select Members
          └─> Create Group
              └─> Navigate to GroupChatScreen

InboxScreen
  └─> Groups Tab
      └─> Group List
          └─> GroupChatScreen
              └─> Group Info (header button)
                  └─> GroupInfoScreen
                      ├─> Members List
                      ├─> Group Settings (admin only)
                      └─> Leave/Delete Group

GroupInvitationsScreen (new)
  └─> Pending Invites List
      └─> Accept/Decline
          └─> Navigate to GroupChatScreen
```

---

## 📋 Summary: Client-Side Notification & Unread Count Pattern

### **Key Points:**

1. **Active Chat Tracking:**
   - Use existing `/activeChats/{userId}` pattern (already in your code)
   - Add `/activeGroupChats/{groupId}/{userId}` for efficient batch checking
   - Set when entering group, clear when leaving (use `useFocusEffect`)

2. **Sending Messages:**
   - Save message to `group_messages/{groupId}/messages/{timestamp}`
   - Get group members from Firestore (1 read)
   - Check which members are active (1 read for batch, or N reads for individual)
   - Update `group_meta_data/{memberId}/{groupId}` for all members
   - Increment unreadCount only for inactive members

3. **Cost:**
   - **RTDB Reads**: 1-10 per message (depending on group size and approach)
   - **RTDB Writes**: N+1 per message (1 message + N metadata updates)
   - **Firestore Reads**: 1 per message (get memberIds)
   - **No Cloud Function costs**: All handled client-side

4. **Implementation:**
   - Reuse existing `setActiveChat()` / `clearActiveChat()` functions
   - Add new `setActiveGroupChat()` / `clearActiveGroupChat()` for batch checking
   - Use same pattern as private chat for consistency

---

## ⚠️ Areas Requiring Review & Attention

### **1. Security Rules (Needs Implementation)**
- ✅ Firestore rules structure provided but needs testing
- ✅ RTDB rules structure provided but needs validation
- ⚠️ **Action Required**: Test security rules in Firebase Console before production
- ⚠️ **Action Required**: Verify RTDB rules work with nested paths

### **2. Error Handling & Edge Cases**
- ⚠️ **Missing**: Network failure handling (what if Firestore read fails during message send?)
- ⚠️ **Missing**: Concurrent invite acceptance (multiple users accepting same invite)
- ⚠️ **Missing**: Group deletion while user is viewing (should show error/redirect)
- ⚠️ **Missing**: Member removal while they're in chat (should handle gracefully)
- ⚠️ **Missing**: App force-close during group creation (cleanup needed?)

### **3. Data Migration & Backward Compatibility**
- ⚠️ **Missing**: How to handle existing global chat (`Trader.jsx`)?
  - Keep both? (global + groups)
  - Migrate users to groups?
  - Deprecate global chat?
- ⚠️ **Missing**: Migration path for existing users

### **4. Performance & Optimization**
- ⚠️ **Review Needed**: Batch size for loading group members (currently N reads for unreadCounts)
- ⚠️ **Review Needed**: Should we cache group member list in RTDB to avoid Firestore reads?
- ⚠️ **Review Needed**: Pagination strategy for group messages (same as private chat?)
- ⚠️ **Missing**: Group list pagination (what if user is in 100+ groups?)

### **5. Real-time Sync Issues**
- ⚠️ **Missing**: What happens if group member list changes while sending message?
  - Current code reads once, but member could leave/join during send
  - Should we re-read or use transaction?
- ⚠️ **Missing**: Handling member role changes in real-time (admin demoted while viewing)
- ⚠️ **Missing**: Group name/avatar changes while user is in chat

### **6. Invitation System Details**
- ⚠️ **Missing**: Invitation expiration cleanup (Cloud Function or client-side cron?)
- ⚠️ **Missing**: Maximum pending invitations per user (prevent spam)
- ⚠️ **Missing**: Invitation rate limiting (prevent abuse)
- ⚠️ **Missing**: Bulk invitation limits (max users per invite batch)

### **7. Group Limits & Validation**
- ⚠️ **Missing**: Maximum group size enforcement (currently `maxMembers` is optional)
- ⚠️ **Missing**: Minimum group size (can creator leave if only 2 members?)
- ⚠️ **Missing**: Maximum groups per user (prevent spam)
- ⚠️ **Missing**: Group name length/character validation

### **8. Message Features**
- ⚠️ **Missing**: Message deletion (who can delete? sender only? admins?)
- ⚠️ **Missing**: Message editing (should groups support this?)
- ⚠️ **Missing**: Message reactions (like/dislike/emoji)
- ⚠️ **Missing**: Message replies/threading
- ⚠️ **Missing**: File/image sharing limits per group

### **9. Notification System**
- ⚠️ **Missing**: Push notification integration (FCM for group invites)
- ⚠️ **Missing**: Notification preferences per group (mute specific groups)
- ⚠️ **Missing**: Notification when added to group vs. invited
- ⚠️ **Missing**: Notification when removed from group

### **10. UI/UX Polish**
- ⚠️ **Missing**: Loading states for group creation
- ⚠️ **Missing**: Empty states (no groups, no members, etc.)
- ⚠️ **Missing**: Error messages (user-friendly, not technical)
- ⚠️ **Missing**: Offline support (queue messages when offline?)
- ⚠️ **Missing**: Typing indicators for groups
- ⚠️ **Missing**: Read receipts (who read the message?)

### **11. Testing Considerations**
- ⚠️ **Missing**: Unit tests for groupUtils functions
- ⚠️ **Missing**: Integration tests for invitation flow
- ⚠️ **Missing**: Stress tests (100+ members, rapid messages)
- ⚠️ **Missing**: Edge case tests (creator leaves, admin demoted, etc.)

### **12. Analytics & Monitoring**
- ⚠️ **Missing**: Track group creation events
- ⚠️ **Missing**: Track message send failures
- ⚠️ **Missing**: Monitor unread count accuracy
- ⚠️ **Missing**: Track invitation acceptance rates

### **13. Code Quality**
- ⚠️ **Review Needed**: All functions use proper error handling?
- ⚠️ **Review Needed**: All async operations have try/catch?
- ⚠️ **Review Needed**: Memory leaks (proper cleanup of listeners?)
- ⚠️ **Review Needed**: TypeScript types (if using TypeScript)

### **14. Documentation**
- ⚠️ **Missing**: API documentation for groupUtils functions
- ⚠️ **Missing**: Component props documentation
- ⚠️ **Missing**: Database schema documentation
- ⚠️ **Missing**: Deployment checklist

### **15. Cost Monitoring**
- ⚠️ **Missing**: How to monitor Firestore read costs
- ⚠️ **Missing**: How to monitor RTDB read/write costs
- ⚠️ **Missing**: Cost alerts/thresholds
- ⚠️ **Missing**: Cost optimization recommendations based on usage

---

## 🔍 Priority Review Checklist

### **High Priority (Before Launch):**
- [ ] Security rules tested and validated
- [ ] Error handling for network failures
- [ ] Group deletion edge cases handled
- [ ] Invitation expiration cleanup implemented
- [ ] Maximum group size enforced
- [ ] Message send failure handling
- [ ] Real-time member list sync issues resolved

### **Medium Priority (Post-Launch):**
- [ ] Group list pagination
- [ ] Message deletion functionality
- [ ] Push notifications for invites
- [ ] Typing indicators
- [ ] Offline support
- [ ] Analytics tracking

### **Low Priority (Future Enhancements):**
- [ ] Message reactions
- [ ] Message editing
- [ ] Read receipts
- [ ] Message threading
- [ ] Group search
- [ ] Group avatars

---

## 📝 Implementation Notes

### **Critical Decisions Needed:**
1. **Global Chat vs. Groups**: Decide if `Trader.jsx` (global chat) should coexist with groups or be replaced
2. **Invitation Cleanup**: Choose between Cloud Function or client-side cleanup for expired invites
3. **Member List Caching**: Decide if group member list should be cached in RTDB to reduce Firestore reads
4. **Message Pagination**: Confirm pagination strategy matches private chat (20 messages at a time?)
5. **Group Limits**: Set maximum group size, max groups per user, max pending invites

### **Recommended Next Steps:**
1. ✅ Review security rules with Firebase team/expert
2. ✅ Implement error handling for all async operations
3. ✅ Add loading states and empty states to UI
4. ✅ Test edge cases (creator leaves, member removed while in chat, etc.)
5. ✅ Set up cost monitoring and alerts
6. ✅ Create migration plan for existing global chat users
7. ✅ Document all functions and components
8. ✅ Set up analytics tracking

