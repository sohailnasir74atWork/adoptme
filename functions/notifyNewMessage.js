const admin = require("firebase-admin");
const functions = require("firebase-functions/v1");

admin.initializeApp();

exports.notifyNewMessage = functions.database
  .ref("/chat_meta_data/{userId}/{chatPartnerId}/unreadCount")
  .onWrite(async (change, context) => {
    const { userId, chatPartnerId } = context.params;

    const beforeUnread = change.before.val();
    const afterUnread = change.after.val();

    if (!afterUnread || afterUnread <= beforeUnread) {
      return null;
    }

    // ── Step 1: Cheap checks first (tiny reads — boolean, string, null) ──
    const [activeUserSnap, mutedSnap, fcmTokenSnap] = await Promise.all([
      admin.database().ref(`/activeChats/${userId}`).once("value"),
      admin.database().ref(`/chat_meta_data/${userId}/${chatPartnerId}/muted`).once("value"),
      admin.database().ref(`/users/${userId}/fcmToken`).once("value"),
    ]);

    if (activeUserSnap.exists()) return null;
    if (mutedSnap.val() === true) return null;

    const fcmToken = fcmTokenSnap.val();
    if (!fcmToken) return null;

    // ── Step 2: Only now fetch the fields we need for the notification ──
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
      console.error("❌ Failed to send notification:", error);
    }

    return null;
  });
