/**
 * Cloud Function: Send push notifications for group invitations
 * 
 * This function triggers when a new group invitation is created in Firestore.
 * It sends a push notification to the invited user.
 * 
 * Deployment:
 * firebase deploy --only functions:notifyGroupInvitation
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

exports.notifyGroupInvitation = functions.firestore
  .document('group_invitations/{inviteId}')
  .onCreate(async (snap, context) => {
    const inviteData = snap.data();
    const { inviteId } = context.params;

    console.log(`🛠 Group invitation notification triggered: inviteId=${inviteId}`);

    // Only send notification for pending invitations
    if (inviteData.status !== 'pending') {
      console.log('⚠️ Invitation status is not pending. Skipping...');
      return null;
    }

    // Check if invitation is expired
    if (inviteData.expiresAt && Date.now() > inviteData.expiresAt) {
      console.log('⚠️ Invitation already expired. Skipping...');
      return null;
    }

    const invitedUserId = inviteData.invitedUserId;
    const groupId = inviteData.groupId;
    const groupName = inviteData.groupName || 'Group';
    const inviterName = inviteData.invitedByDisplayName || 'Someone';

    if (!invitedUserId) {
      console.log('⚠️ Missing invitedUserId. Skipping...');
      return null;
    }

    console.log(`✅ Processing invitation for user: ${invitedUserId}, group: ${groupId}`);

    // Fetch FCM token and notification preferences in parallel
    const [fcmTokenSnap, prefsSnap] = await Promise.all([
      admin.database().ref(`/users/${invitedUserId}/fcmToken`).once('value'),
      admin.database().ref(`/users/${invitedUserId}/notificationSettings`).once('value'),
    ]);

    const fcmToken = fcmTokenSnap.val();
    if (!fcmToken) {
      console.log(`⚠️ Missing FCM token for user: ${invitedUserId}`);
      return null;
    }

    // Check user's notification preferences
    const prefs = prefsSnap.val() || {};
    if (prefs.groupInvitationNotifications === false) {
      console.log(`User ${invitedUserId} has disabled group invitation notifications`);
      return null;
    }

    // Build notification message
    const notificationTitle = 'Group Invitation';
    const notificationBody = `${inviterName} invited you to join "${groupName}"`;

    console.log(`📡 Sending push notification to: ${fcmToken}`);

    const payload = {
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        type: 'groupInvitation',
        inviteId: inviteId || '',
        groupId: groupId || '',
        invitedBy: inviteData.invitedBy || '',
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
      console.log(`✅ Notification successfully sent to ${invitedUserId} for group invitation ${inviteId}`);
    } catch (error) {
      console.error('❌ Failed to send notification:', error);
      
      // If token is invalid, remove it
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        console.log(`Removing invalid token for user ${invitedUserId}`);
        await admin.database().ref(`/users/${invitedUserId}/fcmToken`).remove();
      }
    }

    return null;
  });

