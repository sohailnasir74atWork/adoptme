# Cloud Functions

## Setup

1. Install Firebase CLI:
```bash
npm install -g firebase-tools
```

2. Initialize Firebase Functions (if not already done):
```bash
firebase init functions
```

3. Install dependencies:
```bash
cd functions
npm install
```

## Functions

### syncOnlineStatusToFirestore

Realtime Database-triggered Cloud Function that synchronizes user online status from RTDB to Firestore, maintaining a list of online users with their profile data and badges.

**How it works:**
- Triggers automatically when `users/{uid}/online` changes in Realtime Database
- When a user comes online, fetches their profile data from RTDB `users/{uid}` including:
  - Basic info: `displayName`, `avatar`
  - Badges: `isPro`, `robloxUsernameVerified`, `lastGameWinAt`
  - Admin info: Checks user email via Auth API to determine `isAdmin` status
  - Platform: `OS` (if available in RTDB)
- Updates Firestore `online_users_node/list` document with:
  - `users`: Object mapping user IDs to their profile data (user IDs are the keys)
  - `updatedAt`: Timestamp of last update
- When a user goes offline, removes them from the list

**Deployment:**
```bash
firebase deploy --only functions:syncOnlineStatusToFirestore
```

**Automatic Trigger:**
This function is automatically triggered when a user's online status changes in RTDB. No client-side code needed.

**Data Structure in Firestore:**
```javascript
{
  users: {
    'uid1': {
      id: 'uid1',
      displayName: 'User Name',
      avatar: 'https://...',
      isPro: true,
      robloxUsernameVerified: true,
      lastGameWinAt: 1234567890,
      isAdmin: false,
      OS: 'ios' // or 'android' or null
    },
    'uid2': {
      id: 'uid2',
      displayName: 'Another User',
      avatar: 'https://...',
      isPro: false,
      robloxUsernameVerified: false,
      lastGameWinAt: null,
      isAdmin: false,
      OS: 'android'
    },
    ...
  },
  updatedAt: Timestamp
}
```

**Note:** User IDs are obtained from `Object.keys(users)` - no redundant `userIds` array or `count` field needed.

### notifyPostComment

Firestore-triggered Cloud Function to send push notifications when someone comments on a design post.

**How it works:**
- Triggers automatically when a new comment is created in `designPosts/{postId}/comments/{commentId}`
- Sends notifications to:
  1. The post creator (if they didn't comment themselves)
  2. All previous commenters on that post (excluding the new commenter)
- Limits to last 100 comments and max 50 users to notify (cost optimization)
- Respects user notification preferences (`postCommentNotifications`)

**Deployment:**
```bash
firebase deploy --only functions:notifyPostComment
```

**Automatic Trigger:**
This function is automatically triggered when a new comment is added to any design post. No client-side code needed.

**Notification Payload:**
- For post creator: "New Comment on Your Post" - "{Commenter Name} commented on your post: '{post description}'"
- For previous commenters: "New Comment on Post" - "{Commenter Name} also commented on '{post description}'"
- Data: `{ type: 'postComment', postId: '...', commentId: '...', commenterId: '...', commenterName: '...', timestamp: '...' }`

**Cost Optimizations:**
- Limits comment reads to last 100 comments (prevents expensive reads on popular posts)
- Limits notifications to max 50 users (prevents excessive notification costs)
- Batches RTDB reads for better performance
- Early exit if only creator has commented

**Notes:**
- Uses Firestore transactions to ensure data consistency
- Automatically removes users from the list when they go offline
- Includes all badge information needed for `OnlineUsersList.jsx` display
- `OS` field may be `null` if not stored in RTDB (platform icon won't show in that case)
- Admin status is determined by checking user email against admin email list

### cleanupGroupInvitations

Cleans up expired group invitations from Firestore.

**Deployment:**
```bash
firebase deploy --only functions:cleanupGroupInvitations
```

**Manual Trigger:**
```bash
curl https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/cleanupGroupInvitations
```

**Schedule (using Cloud Scheduler):**
```bash
gcloud scheduler jobs create http cleanup-group-invitations \
  --schedule="0 * * * *" \
  --uri="https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/cleanupGroupInvitations" \
  --http-method=GET \
  --time-zone="UTC"
```

### notifyGroupMessage

Database-triggered Cloud Function to send push notifications for group chat messages. Works exactly like the existing `notifyNewMessage` for private chats.

**How it works:**
- Triggers automatically when `group_meta_data/{userId}/{groupId}/unreadCount` changes
- Checks if the user is active in the group chat (`activeGroupChats/{groupId}/{userId}`)
- Only sends notification if unread count increased AND user is not active
- Gets FCM token from `users/{userId}/fcmToken`
- Respects user notification preferences

**Deployment:**
```bash
firebase deploy --only functions:notifyGroupMessage
```

**Automatic Trigger:**
This function is automatically triggered when a group message is sent and the unread count increases for inactive members. No client-side code needed - it works exactly like your existing private chat notifications.

**Notification Payload:**
- Title: Group name (from `group_meta_data`)
- Body: "{Sender Name}: {Message preview}"
- Data: `{ type: 'groupChat', groupId: '...', senderId: '...', timestamp: '...', taype: 'groupMessage' }`

**Notes:**
- Notifications are only sent to users who are not currently viewing the group chat
- The sender never receives a notification (their unreadCount stays at 0)
- Invalid FCM tokens are automatically cleaned up
- Users can disable group chat notifications via `users/{userId}/notificationSettings/groupChatNotifications`
- Works exactly like your existing `notifyNewMessage` function pattern

### notifyGroupInvitation

Firestore-triggered Cloud Function to send push notifications when a user receives a group invitation.

**How it works:**
- Triggers automatically when a new document is created in `group_invitations` collection
- Only sends notification if invitation status is 'pending' and not expired
- Gets FCM token from `users/{userId}/fcmToken`
- Respects user notification preferences

**Deployment:**
```bash
firebase deploy --only functions:notifyGroupInvitation
```

**Automatic Trigger:**
This function is automatically triggered when `sendGroupInvite` creates a new invitation in Firestore. No client-side code needed.

**Notification Payload:**
- Title: "Group Invitation"
- Body: "{Inviter Name} invited you to join \"{Group Name}\""
- Data: `{ type: 'groupInvitation', inviteId: '...', groupId: '...', invitedBy: '...', groupName: '...', timestamp: '...' }`

**Notes:**
- Only sends notifications for pending, non-expired invitations
- Invalid FCM tokens are automatically cleaned up
- Users can disable group invitation notifications via `users/{userId}/notificationSettings/groupInvitationNotifications`

### notifyGroupJoinRequest

Firestore-triggered Cloud Function to send push notifications when a group creator receives a join request.

**How it works:**
- Triggers automatically when a new document is created in `group_join_requests` collection
- Only sends notification if request status is 'pending'
- Gets FCM token from `users/{creatorId}/fcmToken`
- Respects user notification preferences (`groupJoinRequestNotifications`)

**Deployment:**
```bash
firebase deploy --only functions:notifyGroupJoinRequest
```

**Automatic Trigger:**
This function is automatically triggered when `sendJoinRequest` creates a new join request in Firestore. No client-side code needed.

**Notification Payload:**
- Title: "Join Request"
- Body: "{Requester Name} wants to join \"{Group Name}\""
- Data: `{ type: 'groupJoinRequest', requestId: '...', groupId: '...', requesterId: '...', groupName: '...', timestamp: '...' }`

**Notes:**
- Only sends notifications for pending join requests
- Invalid FCM tokens are automatically cleaned up
- Users can disable join request notifications via `users/{userId}/notificationSettings/groupJoinRequestNotifications`

### cleanupOnlineUsers

Scheduled Cloud Function that deletes the `online_users_node/list` document every 10 minutes.

**How it works:**
- Runs automatically every 10 minutes via Cloud Scheduler
- Deletes the `online_users_node/list` document to reset online users
- Helps clean up stale data and ensures fresh online status tracking
- The `syncOnlineStatusToFirestore` function will rebuild the list as users come online

**Deployment:**
```bash
firebase deploy --only functions:cleanupOnlineUsers
```

**Automatic Schedule:**
- Runs every 10 minutes automatically once deployed
- No manual configuration needed
- Uses UTC timezone

**Notes:**
- The document will be automatically recreated by `syncOnlineStatusToFirestore` when users come online
- This periodic cleanup ensures the online users list stays fresh and doesn't accumulate stale data
- If the document doesn't exist, the function logs a message and continues (no error)

### clearPresenceNode

Scheduled Cloud Function that clears the entire `presence` node in Firebase Realtime Database every 20 minutes.

**How it works:**
- Runs automatically every 20 minutes via Cloud Scheduler
- Clears the entire `presence/{uid}` node in Realtime Database
- Helps clean up stale presence data and ensures only truly active users remain
- Active users will automatically re-establish their presence when the app is in foreground

**Deployment:**
```bash
firebase deploy --only functions:clearPresenceNode
```

**Automatic Schedule:**
- Runs every 20 minutes automatically once deployed
- No manual configuration needed
- Uses UTC timezone

**Notes:**
- The presence node will be automatically repopulated by active users through the client-side presence tracking in `GlobelStats.js`
- This periodic cleanup ensures the presence node doesn't accumulate stale data from users who disconnected without proper cleanup
- If the presence node is already empty, the function logs a message and continues (no error)
- Users who are actively using the app will immediately re-establish their presence after the cleanup

## Notes

- Invitations expire after 7 days (as set in `groupUtils.js`)
- The function checks `expiresAt` timestamp against current time
- Only pending invitations are cleaned up (accepted/declined are left for history)

