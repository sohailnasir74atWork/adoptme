/**
 * mirrorChatMetaToRtdb — Supabase → RTDB bridge for chat_meta_data
 * during the 2-day cross-version window.
 *
 * Without this, OLD app inboxes never light up for chats started by
 * NEW app users post-Phase-5: the new app writes chat_meta_data to
 * Supabase only, and the OLD app reads inbox rows from RTDB.
 *
 * Pair: mirrorChatMetaToSupabase (RTDB → Supabase, already deployed).
 *
 * Loop prevention:
 *   - mirrorChatMetaToSupabase reads the current Supabase row and
 *     compares it to the RTDB row; if all fields match, it skips
 *     (diff-based, no persistent marker). This naturally stops the
 *     Supabase → RTDB → Supabase ping-pong without leaving residue.
 *   - notifyNewMessageLegacy is patched to skip unread bumps from
 *     mirrored writes (otherwise NEW app sends would double-push:
 *     once via notifyNewMessage on the Supabase INSERT, once via
 *     notifyNewMessageLegacy on the mirrored RTDB unreadCount bump).
 *     This still uses the `_mirroredFromSupabase: true` marker on the
 *     RTDB unread leaf — but it's set transiently per write here and
 *     the legacy CF only consults it for the push-decision, never
 *     persists it back.
 *
 * Webhook config (Supabase Dashboard → Database → Webhooks):
 *   Table:  public.chat_meta_data
 *   Events: INSERT, UPDATE
 *   Type:   HTTP Request
 *   Method: POST
 *   URL:    <this CF's HTTPS URL after deploy>
 *   Header: x-webhook-secret = <SUPABASE_WEBHOOK_SECRET>
 *
 * Deployment / removal: same single-function pattern as the other two
 * mirror functions. Disable the Supabase webhook BEFORE deleting the CF.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

function rejectInvalid(req, res) {
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
  if ((type !== 'INSERT' && type !== 'UPDATE') || !record) {
    res.status(200).send('Skipped: not INSERT/UPDATE');
    return null;
  }
  return record;
}

exports.mirrorChatMetaToRtdb = functions
  .runWith({
    secrets: ['SUPABASE_WEBHOOK_SECRET'],
    memory: '256MB',
    timeoutSeconds: 30,
  })
  .https.onRequest(async (req, res) => {
    const r = rejectInvalid(req, res);
    if (!r) return;

    if (!r.owner_uid || !r.partner_uid) {
      res.status(200).send('Skipped: missing owner/partner');
      return;
    }

    // Build the RTDB row in OLD-app shape. Use update() not set() so
    // we don't blow away fields the OLD app might have written
    // (lastRead, custom flags, etc.) that don't live in Supabase.
    //
    // NOTE: No `_mirroredFromSupabase` marker is written here. The
    // previous design wrote a persistent marker so notifyNewMessageLegacy
    // and mirrorChatMetaToSupabase could skip mirrored writes, but the
    // marker leaked across subsequent OLD-app writes and:
    //   - kept mirrorChatMetaToSupabase from ever re-syncing the row
    //     (76 NULL inbox rows discovered for user 925AXUhKYzf...)
    //   - kept notifyNewMessageLegacy from pushing for legitimate OLD→
    //     {anyone} sends after the first NEW-side interaction.
    // The replacement design: diff-based dedup in mirrorChatMetaToSupabase,
    // and notifyNewMessageLegacy is now a no-op so all pushes route
    // through notifyNewMessage (Supabase-side) regardless of origin.
    const updates = {};
    if (r.chat_id != null)         updates.chatId         = r.chat_id;
    if (r.receiver_id != null)     updates.receiverId     = r.receiver_id;
    if (r.last_message != null)    updates.lastMessage    = r.last_message;
    if (typeof r.timestamp_ms === 'number') updates.timestamp = r.timestamp_ms;
    if (typeof r.unread_count === 'number') updates.unreadCount = r.unread_count;
    if (r.receiver_name != null)   updates.receiverName   = r.receiver_name;
    if (r.receiver_avatar != null) updates.receiverAvatar = r.receiver_avatar;
    // muted is per-side; OLD app may have set it locally. Mirror only
    // when explicitly true on the Supabase side, never overwrite to false.
    if (r.muted === true) updates.muted = true;

    try {
      await admin.database()
        .ref(`/chat_meta_data/${r.owner_uid}/${r.partner_uid}`)
        .update(updates);
      res.status(200).send('OK');
    } catch (err) {
      console.error('[mirrorChatMetaToRtdb] update failed:', err);
      res.status(200).send('Error logged');
    }
  });
