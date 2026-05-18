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
    // ===================================================================
    // 2-DAY BRIDGE: DISABLED.
    //
    // During the bridge window, every private message — OLD-app sender
    // or NEW-app sender — lands in Supabase public.private_messages
    // (NEW app inserts directly; OLD app gets mirrored via
    // mirrorPrivateMessageToSupabase). notifyNewMessage fires off that
    // single Supabase INSERT and is now the sole push source.
    //
    // Why disable: the previous double-push prevention relied on a
    // persistent `_mirroredFromSupabase` marker on the RTDB row, which
    // leaked across OLD-app writes and silently broke pushes for OLD-
    // app sends after the first NEW-side mirror touched the row.
    //
    // Restore after teardown: revert this commit OR run
    //   firebase functions:delete notifyNewMessageLegacy
    // (it'll be re-enabled by the next deploy of the unmodified file).
    // ===================================================================
    return null;
    // eslint-disable-next-line no-unreachable
    const { userId, chatPartnerId } = context.params;

    const beforeUnread = change.before.val();
    const afterUnread = change.after.val();

    if (!afterUnread || afterUnread <= beforeUnread) {
      return null;
    }

    const [activeUserSnap, mutedSnap, fcmTokenSnap, mirroredSnap] = await Promise.all([
      admin.database().ref(`/activeChats/${userId}`).once("value"),
      admin.database().ref(`/chat_meta_data/${userId}/${chatPartnerId}/muted`).once("value"),
      admin.database().ref(`/users/${userId}/fcmToken`).once("value"),
      admin.database().ref(`/chat_meta_data/${userId}/${chatPartnerId}/_mirroredFromSupabase`).once("value"),
    ]);

    // Bridge guard: unread bump came from mirrorChatMetaToRtdb. The
    // original Supabase INSERT already fired notifyNewMessage → push.
    // Sending again here would be a duplicate.
    if (mirroredSnap.val() === true) return null;

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
