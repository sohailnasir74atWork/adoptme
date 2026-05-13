/**
 * notifyGroupMessageLegacy — RTDB-triggered FCM push for group chats.
 *
 * Restored pre-Phase-5 notify function under a new name so old app
 * builds (which still write to RTDB /group_meta_data) keep getting
 * group push notifications until they update.
 *
 * New app builds use the HTTPS notifyGroupMessage CF via Supabase
 * webhook. Both coexist without duplicating because each user is on
 * exactly one app version.
 *
 * Delete this function when old-app DAU is negligible.
 *
 * Deployment:
 *   firebase deploy --only functions:notifyGroupMessageLegacy --project adoptme-7b50c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.notifyGroupMessageLegacy = functions.database
  .ref('/group_meta_data/{userId}/{groupId}/unreadCount')
  .onWrite(async (change, context) => {
    const { userId, groupId } = context.params;

    const beforeUnread = change.before.val();
    const afterUnread = change.after.val();

    if (!afterUnread || afterUnread <= beforeUnread) {
      return null;
    }

    const [activeGroupSnap, groupMetaSnap, fcmTokenSnap] = await Promise.all([
      admin.database().ref(`/activeGroupChats/${groupId}/${userId}`).once('value'),
      admin.database().ref(`/group_meta_data/${userId}/${groupId}`).once('value'),
      admin.database().ref(`/users/${userId}/fcmToken`).once('value'),
    ]);

    if (activeGroupSnap.exists() && activeGroupSnap.val() === true) {
      return null;
    }

    if (!groupMetaSnap.exists()) {
      return null;
    }

    const groupMeta = groupMetaSnap.val();
    const { lastMessage, lastMessageSenderName, groupName } = groupMeta;

    const notificationTitle = groupName || 'Group Chat';
    const notificationBody = lastMessageSenderName
      ? `${lastMessageSenderName}: ${lastMessage || 'New message'}`
      : (lastMessage || 'You have a new message.');

    const fcmToken = fcmTokenSnap.val();
    if (!fcmToken) {
      return null;
    }

    const prefsSnap = await admin.database().ref(`/users/${userId}/notificationSettings`).once('value');
    const prefs = prefsSnap.val() || {};
    if (prefs.groupChatNotifications === false) {
      return null;
    }

    const mutedSnap = await admin.database().ref(`/group_meta_data/${userId}/${groupId}/muted`).once('value');
    if (mutedSnap.exists() && mutedSnap.val() === true) {
      return null;
    }

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
        taype: 'groupMessage',
      },
      token: fcmToken,
      android: {
        priority: 'high',
        notification: { channelId: 'default', sound: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    try {
      await admin.messaging().send(payload);
    } catch (error) {
      console.error('[notifyGroupMessageLegacy] Failed to send:', error);
      if (error.code === 'messaging/invalid-registration-token'
       || error.code === 'messaging/registration-token-not-registered') {
        try { await admin.database().ref(`/users/${userId}/fcmToken`).remove(); } catch {}
      }
    }

    return null;
  });
