/**
 * Cloud Function: Send push notifications for group chat messages
 * 
 * This function triggers when group_meta_data/{userId}/{groupId}/unreadCount changes,
 * similar to the existing notifyNewMessage for private chats.
 * 
 * Deployment:
 * firebase deploy --only functions:notifyGroupMessage
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

exports.notifyGroupMessage = functions.database
  .ref('/group_meta_data/{userId}/{groupId}/unreadCount')
  .onWrite(async (change, context) => {
    const { userId, groupId } = context.params;
    console.log(`🛠 Group notification triggered: user=${userId}, group=${groupId}`);

    const beforeUnread = change.before.val();
    const afterUnread = change.after.val();

    // Only send notification if unread count increased
    if (!afterUnread || afterUnread <= beforeUnread) {
      console.log('⚠️ No increase in unreadCount. Skipping...');
      return null;
    }

    console.log(`✅ Group unread count increased to ${afterUnread}`);

    // Fetch all data in parallel to reduce latency
    const [activeGroupSnap, groupMetaSnap, fcmTokenSnap] = await Promise.all([
      admin.database().ref(`/activeGroupChats/${groupId}/${userId}`).once('value'),
      admin.database().ref(`/group_meta_data/${userId}/${groupId}`).once('value'),
      admin.database().ref(`/users/${userId}/fcmToken`).once('value'),
    ]);

    // Check if user is active in this group chat
    if (activeGroupSnap.exists() && activeGroupSnap.val() === true) {
      console.log(`🚫 User ${userId} is active in group ${groupId}. No notification sent.`);
      return null;
    }

    if (!groupMetaSnap.exists()) {
      console.log('⚠️ Group metadata not found. Skipping...');
      return null;
    }

    const groupMeta = groupMetaSnap.val();
    const { lastMessage, lastMessageSenderName, groupName } = groupMeta;

    // Get group name from metadata or use default
    const notificationTitle = groupName || 'Group Chat';
    const notificationBody = lastMessageSenderName 
      ? `${lastMessageSenderName}: ${lastMessage || 'New message'}`
      : (lastMessage || 'You have a new message.');

    const fcmToken = fcmTokenSnap.val();
    if (!fcmToken) {
      console.log(`⚠️ Missing FCM token for user: ${userId}`);
      return null;
    }

    // Check user's notification preferences
    const prefsSnap = await admin.database().ref(`/users/${userId}/notificationSettings`).once('value');
    const prefs = prefsSnap.val() || {};
    
    if (prefs.groupChatNotifications === false) {
      console.log(`User ${userId} has disabled group chat notifications`);
      return null;
    }

    // ✅ Check if this specific group is muted
    const mutedSnap = await admin.database().ref(`/group_meta_data/${userId}/${groupId}/muted`).once('value');
    const isMuted = mutedSnap.exists() && mutedSnap.val() === true;
    
    if (isMuted) {
      console.log(`🔇 Group ${groupId} is muted for user ${userId}. FCM notification skipped (unread count still increments).`);
      return null;
    }

    console.log(`📡 Sending push notification to: ${fcmToken}`);

    const payload = {
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        type: 'groupChat',
        groupId: groupId || '',
        senderId: groupMeta.lastMessageSenderId || '',
        timestamp: groupMeta.lastMessageTimestamp ? groupMeta.lastMessageTimestamp.toString() : Date.now().toString(),
        taype: 'groupMessage', // Note: keeping typo for consistency with existing code
      },
      token: fcmToken,
      android: {
        priority: 'high',
        notification: {
          channelId: 'default',
          sound: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    try {
      await admin.messaging().send(payload);
      console.log(`✅ Notification successfully sent to ${userId} for group ${groupId}`);
    } catch (error) {
      console.error('❌ Failed to send notification:', error);
      
      // If token is invalid, remove it
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        console.log(`Removing invalid token for user ${userId}`);
        await admin.database().ref(`/users/${userId}/fcmToken`).remove();
      }
    }

    return null;
  });

