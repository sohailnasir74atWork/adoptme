/**
 * notifyNewMessageLegacy — RTDB-triggered FCM push for private chats.
 *
 * This is the pre-Phase-5 notify function, restored under a new name so
 * that old app builds (which still write to RTDB /chat_meta_data) keep
 * receiving push notifications until they update.
 *
 * The new HTTPS notifyNewMessage handles new-app builds via Supabase
 * webhook. Both coexist without duplicating notifications because:
 *   - Old app writes RTDB /chat_meta_data/.../unreadCount  → this CF
 *   - New app writes Supabase private_messages INSERT      → notifyNewMessage HTTPS
 * Each user is on exactly one app version, so they hit exactly one path.
 *
 * Delete this function when old-app DAU is negligible.
 *
 * Deployment:
 *   firebase deploy --only functions:notifyNewMessageLegacy --project adoptme-7b50c
 */

const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

if (!admin.apps.length) {
  admin.initializeApp();
}

exports.notifyNewMessageLegacy = functions.database
  .ref("/chat_meta_data/{userId}/{chatPartnerId}/unreadCount")
  .onWrite(async (change, context) => {
    const { userId, chatPartnerId } = context.params;

    const beforeUnread = change.before.val();
    const afterUnread = change.after.val();

    if (!afterUnread || afterUnread <= beforeUnread) {
      return null;
    }

    const [activeUserSnap, mutedSnap, fcmTokenSnap] = await Promise.all([
      admin.database().ref(`/activeChats/${userId}`).once("value"),
      admin.database().ref(`/chat_meta_data/${userId}/${chatPartnerId}/muted`).once("value"),
      admin.database().ref(`/users/${userId}/fcmToken`).once("value"),
    ]);

    if (activeUserSnap.exists()) return null;
    if (mutedSnap.val() === true) return null;

    const fcmToken = fcmTokenSnap.val();
    if (!fcmToken) return null;

    const [nameSnap, msgSnap, chatIdSnap, tsSnap, receiverIdSnap] = await Promise.all([
      admin.database().ref(`/chat_meta_data/${userId}/${chatPartnerId}/receiverName`).once("value"),
      admin.database().ref(`/chat_meta_data/${userId}/${chatPartnerId}/lastMessage`).once("value"),
      admin.database().ref(`/chat_meta_data/${userId}/${chatPartnerId}/chatId`).once("value"),
      admin.database().ref(`/chat_meta_data/${userId}/${chatPartnerId}/timestamp`).once("value"),
      admin.database().ref(`/chat_meta_data/${userId}/${chatPartnerId}/receiverId`).once("value"),
    ]);

    const receiverId = receiverIdSnap.val();
    if (receiverId !== chatPartnerId) return null;

    const payload = {
      notification: {
        title: nameSnap.val() || "New Message",
        body: msgSnap.val() || "You have a new message.",
      },
      data: {
        chatId: chatIdSnap.val() || "",
        senderId: chatPartnerId,
        timestamp: tsSnap.val() ? tsSnap.val().toString() : Date.now().toString(),
      },
      token: fcmToken,
    };

    try {
      await admin.messaging().send(payload);
    } catch (error) {
      console.error("[notifyNewMessageLegacy] Failed to send:", error);
      if (error.code === 'messaging/invalid-registration-token'
       || error.code === 'messaging/registration-token-not-registered') {
        try { await admin.database().ref(`/users/${userId}/fcmToken`).remove(); } catch {}
      }
    }

    return null;
  });
