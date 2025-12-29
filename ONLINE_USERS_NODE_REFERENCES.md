# `online_users_node` References Found

## ✅ Already Updated
- `Code/ChatScreen/GroupChat/OnlineUsersList.jsx` - ✅ Now uses RTDB `presence` node

## ❌ Still Using `online_users_node` (Need Update)

### 1. **Code/ChatScreen/GroupChat/GroupChatScreen.jsx**
   - **Line 142**: `fetchOnlineMembers()` - Gets online group members
   - **Line 210**: `fetchPendingInvitations()` - Fallback to get user display names
   - **Action**: Update to query RTDB `presence` node instead

### 2. **Code/ChatScreen/utils/groupUtils.js**
   - **Line 177**: `addMembersToGroup()` - Fallback to get user data
   - **Line 291**: Another fallback usage
   - **Line 747**: Another fallback usage
   - **Action**: Update to query RTDB `users/{uid}` directly instead

### 3. **Code/ValuesScreen/PetGuessingGame/utils/gameInviteSystem.js**
   - **Line 651**: `getOnlineUserIdsForInvite()` - Gets online user IDs
   - **Line 680**: `getMoreOnlineUserIds()` - Gets more online user IDs
   - **Line 719**: `fetchUserDetailsForInvite()` - Fetches user details
   - **Action**: Update to query RTDB `presence` node and `users/{uid}` instead

## 📝 Documentation/Comments (No Action Needed)
- `functions/README.md` - Documentation
- `GROUP_CHAT_IMPLEMENTATION_GUIDE.md` - Documentation
- `Code/SettingScreen/Setting.jsx` - Just a comment (line 688)

## 🔧 Cloud Functions (May Keep or Remove)
- `functions/syncOnlineStatusToFirestore.js` - Syncs RTDB to Firestore (you may want to keep this for backward compatibility or remove it)
- `functions/cleanupOnlineUsers.js` - Cleans up Firestore document (you may want to remove this if not using Firestore anymore)

## Summary
**3 main code files need updating:**
1. `GroupChatScreen.jsx` - 2 usages
2. `groupUtils.js` - 3 usages  
3. `gameInviteSystem.js` - 3 usages

**Total: 8 code usages to update**

