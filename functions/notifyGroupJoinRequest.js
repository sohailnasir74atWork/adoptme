/**
 * Cloud Function: Send push notifications for group join requests
 * 
 * This function triggers when a new join request is created in Firestore.
 * It sends a push notification to the group creator.
 * 
 * Deployment:
 * firebase deploy --only functions:notifyGroupJoinRequest
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

exports.notifyGroupJoinRequest = functions.firestore
  .document('group_join_requests/{requestId}')
  .onCreate(async (snap, context) => {
    const requestData = snap.data();
    const { requestId } = context.params;

    console.log(`🛠 Group join request notification triggered: requestId=${requestId}`);

    // Only send notification for pending requests
    if (requestData.status !== 'pending') {
      console.log('⚠️ Join request status is not pending. Skipping...');
      return null;
    }

    const creatorId = requestData.creatorId;
    const groupId = requestData.groupId;
    const groupName = requestData.groupName || 'Group';
    const requesterName = requestData.requesterDisplayName || 'Someone';

    if (!creatorId) {
      console.log('⚠️ Missing creatorId. Skipping...');
      return null;
    }

    // console.log(`✅ Processing join request for creator: ${creatorId}, group: ${groupId}`);

    // Fetch FCM token and notification preferences in parallel
    const [fcmTokenSnap, prefsSnap] = await Promise.all([
      admin.database().ref(`/users/${creatorId}/fcmToken`).once('value'),
      admin.database().ref(`/users/${creatorId}/notificationSettings`).once('value'),
    ]);

    const fcmToken = fcmTokenSnap.val();
    if (!fcmToken) {
      console.log(`⚠️ Missing FCM token for user: ${creatorId}`);
      return null;
    }

    // Check user's notification preferences
    const prefs = prefsSnap.val() || {};
    if (prefs.groupJoinRequestNotifications === false) {
      console.log(`User ${creatorId} has disabled group join request notifications`);
      return null;
    }

    // Build notification message
    const notificationTitle = 'Join Request';
    const notificationBody = `${requesterName} wants to join "${groupName}"`;

    console.log(`📡 Sending push notification to: ${fcmToken}`);

    const payload = {
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        type: 'groupJoinRequest',
        requestId: requestId || '',
        groupId: groupId || '',
        requesterId: requestData.requesterId || '',
        groupName: groupName || '',
        timestamp: Date.now().toString(),
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
      console.log(`✅ Notification successfully sent to ${creatorId} for join request ${requestId}`);
    } catch (error) {
      console.error('❌ Failed to send notification:', error);
      
      // If token is invalid, remove it
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        console.log(`Removing invalid token for user ${creatorId}`);
        await admin.database().ref(`/users/${creatorId}/fcmToken`).remove();
      }
    }

    return null;
  });

