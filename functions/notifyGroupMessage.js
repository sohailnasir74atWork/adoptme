/**
 * notifyGroupMessage — HTTPS webhook handler for new group messages.
 *
 * Triggered by a Supabase Database Webhook configured in
 *   Dashboard -> Database -> Webhooks
 *   Table:  public.group_messages
 *   Event:  INSERT
 *   Method: POST
 *   URL:    <this CF's HTTPS URL>
 *   Header: x-webhook-secret = <SUPABASE_WEBHOOK_SECRET>
 *
 * Reads (mostly unchanged from the old RTDB-triggered version):
 *   - Firestore /groups/{groupId}.memberIds   group membership
 *   - /activeGroupChats/{groupId}/{userId}    presence-based push suppression
 *   - /users/{userId}/fcmToken                FCM device token
 *   - /users/{userId}/notificationSettings    per-user master toggle
 *   - Supabase group_meta_data                per-user muted flag + group_name
 *
 * Replaces the old RTDB onWrite trigger at
 *   /group_meta_data/{userId}/{groupId}/unreadCount
 *
 * Required secrets:
 *   firebase functions:secrets:set SUPABASE_WEBHOOK_SECRET
 *
 * Deployment:
 *   firebase deploy --only functions:notifyGroupMessage
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

function validateWebhookOrSend(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return null;
  }
  const expected = (process.env.SUPABASE_WEBHOOK_SECRET || '').trim();
  const got = (req.headers['x-webhook-secret'] || '').trim();
  if (!expected || got !== expected) {
    res.status(401).send('Unauthorized');
    return null;
  }
  const { type, record } = req.body || {};
  if (type !== 'INSERT' || !record) {
    res.status(200).send('Skipped: not an INSERT');
    return null;
  }
  return record;
}

function previewFor(r) {
  if (r.text && String(r.text).trim()) return r.text;
  if (r.image_url || (Array.isArray(r.image_urls) && r.image_urls.length > 0)) return '📷 Photo';
  if (Array.isArray(r.fruits) && r.fruits.length > 0) {
    return r.fruits.length === 1 ? '🐾 Sent a pet' : `🐾 Sent ${r.fruits.length} pets`;
  }
  return 'New message';
}

exports.notifyGroupMessage = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_WEBHOOK_SECRET'],
    memory: '256MB',
    timeoutSeconds: 60,
  })
  .https.onRequest(async (req, res) => {
    const record = validateWebhookOrSend(req, res);
    if (!record) return;

    const groupId = record.group_id;
    const senderId = record.sender_id;
    if (!groupId || !senderId) {
      res.status(200).send('Skipped: missing group/sender');
      return;
    }

    try {
      // Membership still lives in Firestore — no replication.
      const groupDoc = await admin.firestore().doc(`groups/${groupId}`).get();
      if (!groupDoc.exists) {
        res.status(200).send('Skipped: group not found');
        return;
      }
      const groupData = groupDoc.data() || {};
      const memberIds = (groupData.memberIds || []).filter((id) => id && id !== senderId);
      if (memberIds.length === 0) {
        res.status(200).send('Skipped: no other members');
        return;
      }

      // Parallel: mute flags + group_name (Supabase) AND active-chat
      // presence (RTDB) for every member.
      const supabase = getSupabaseAdmin();
      const [metaResult, activeGroupSnap] = await Promise.all([
        supabase
          .from('group_meta_data')
          .select('user_id, muted, group_name')
          .eq('group_id', groupId)
          .in('user_id', memberIds),
        admin.database().ref(`/activeGroupChats/${groupId}`).once('value'),
      ]);

      const mutedSet = new Set();
      let groupName = groupData.name || 'Group Chat';
      for (const r of metaResult?.data || []) {
        if (r.muted) mutedSet.add(r.user_id);
        if (r.group_name) groupName = r.group_name;
      }

      const activeMap = activeGroupSnap.val() || {};
      const activeSet = new Set(
        Object.keys(activeMap).filter((uid) => activeMap[uid] === true),
      );

      const wantTokenFor = memberIds.filter(
        (id) => !mutedSet.has(id) && !activeSet.has(id),
      );
      if (wantTokenFor.length === 0) {
        res.status(200).send('Skipped: all muted or active in chat');
        return;
      }

      // Parallel fcmToken + per-user notificationSettings reads. One bad
      // record shouldn't kill the rest.
      const userReads = await Promise.all(
        wantTokenFor.map((uid) =>
          Promise.all([
            admin.database().ref(`/users/${uid}/fcmToken`).once('value').catch(() => null),
            admin.database().ref(`/users/${uid}/notificationSettings`).once('value').catch(() => null),
          ]).then(([tokenSnap, prefsSnap]) => ({
            uid,
            token: tokenSnap?.val(),
            prefs: prefsSnap?.val() || {},
          })),
        ),
      );

      const tokens = [];
      const tokensToUid = new Map();
      for (const u of userReads) {
        if (u.prefs && u.prefs.groupChatNotifications === false) continue;
        if (!u.token || typeof u.token !== 'string') continue;
        tokens.push(u.token);
        tokensToUid.set(u.token, u.uid);
      }
      if (tokens.length === 0) {
        res.status(200).send('Skipped: no fcm tokens');
        return;
      }

      const senderName = record.sender_name || 'Someone';
      const messageBody = previewFor(record);

      // sendEachForMulticast handles per-token errors so one bad token
      // doesn't tank the rest of the fan-out.
      const result = await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: groupName,
          body: `${senderName}: ${messageBody}`,
        },
        data: {
          type: 'groupChat',
          groupId: String(groupId),
          senderId: String(senderId),
          messageId: String(record.id || ''),
          timestamp: record.created_at
            ? String(Date.parse(record.created_at))
            : String(Date.now()),
        },
        android: {
          priority: 'high',
          notification: { channelId: 'default', sound: 'default' },
        },
        apns: {
          payload: { aps: { sound: 'default', badge: 1 } },
        },
      });

      // Prune dead tokens — same behaviour the old function had per-token.
      if (result?.responses) {
        const cleanup = [];
        result.responses.forEach((resp, i) => {
          if (resp.success) return;
          const code = resp.error?.code;
          if (code === 'messaging/invalid-registration-token'
           || code === 'messaging/registration-token-not-registered') {
            const uid = tokensToUid.get(tokens[i]);
            if (uid) cleanup.push(admin.database().ref(`/users/${uid}/fcmToken`).remove().catch(() => {}));
          }
        });
        if (cleanup.length > 0) await Promise.all(cleanup);
      }

      res.status(200).send('OK');
    } catch (err) {
      console.error('[notifyGroupMessage] error:', err);
      res.status(500).send('Error');
    }
  });
