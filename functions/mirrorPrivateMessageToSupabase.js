/**
 * mirrorPrivateMessageToSupabase — RTDB → Supabase bridge for the
 * 2-day cross-version chat window after the Phase 5 cut.
 *
 * OLD app builds still write messages to RTDB
 *   /private_messages/{chatId}/messages/{messageId}
 * NEW app builds read from Supabase public.private_messages.
 *
 * This function tails the RTDB writes and inserts each one into
 * Supabase so NEW apps see messages sent by users still on the old
 * version.
 *
 * Pair: mirrorPrivateMessageToRtdb (Supabase → RTDB).
 *
 * Loop prevention:
 *   - Insert sets rtdb_key = the RTDB push key. notifyNewMessage and
 *     mirrorPrivateMessageToRtdb both skip rows where rtdb_key is non-null.
 *   - Skip RTDB writes whose value carries `_mirroredFromSupabase: true`
 *     (defensive — Supabase→RTDB messages are written under sb_* keys
 *     so the prefix check below already handles them).
 *
 * Trigger: onCreate (not onWrite). OLD app does set() once and never
 * edits; on remove() we leave the Supabase row alone — moderation is
 * handled by the Supabase soft-delete path, not by mirroring deletes.
 *
 * Required secrets (already set for the existing mirror CFs):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Deployment (single-function deploy from the deploy directory):
 *   1. Copy this file's contents into
 *      /Volumes/Sohail/cloud functions/cloud function for adoptme/Firebase/functions/index.js
 *   2. firebase deploy --only functions:mirrorPrivateMessageToSupabase --project adoptme-7b50c
 *
 * Removal after the 2-day bridge:
 *   firebase functions:delete mirrorPrivateMessageToSupabase --project adoptme-7b50c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

// chat_id is [a,b].sort().join('_'). Firebase UIDs are alphanumeric
// (no underscores), so prefix/suffix matching against senderId is safe
// and avoids depending on split('_').
function recipientFromChat(chatId, senderId) {
  if (!chatId || !senderId) return null;
  if (chatId.startsWith(senderId + '_')) return chatId.slice(senderId.length + 1);
  if (chatId.endsWith('_' + senderId)) return chatId.slice(0, chatId.length - senderId.length - 1);
  return null;
}

exports.mirrorPrivateMessageToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 30,
  })
  .database.ref('/private_messages/{chatId}/messages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const { chatId, messageId } = context.params;

    // Loop guard 1: messages we wrote from Supabase use sb_ keys.
    if (typeof messageId === 'string' && messageId.startsWith('sb_')) {
      return null;
    }

    const v = snapshot.val();
    if (!v || typeof v !== 'object') return null;

    // Loop guard 2: explicit marker (defensive).
    if (v._mirroredFromSupabase === true) return null;

    const senderId = v.senderId;
    if (!senderId || typeof senderId !== 'string') {
      console.warn('[mirrorPrivateMessageToSupabase] no senderId', { chatId, messageId });
      return null;
    }

    const recipientId = recipientFromChat(chatId, senderId);
    if (!recipientId) {
      console.warn('[mirrorPrivateMessageToSupabase] sender not in chatId', { chatId, senderId });
      return null;
    }

    // OLD app uses Date.now() as both the timestamp field and the RTDB key.
    // Prefer the field; fall back to the key if it's parseable.
    let createdAtMs = typeof v.timestamp === 'number' ? v.timestamp : null;
    if (createdAtMs == null) {
      const fromKey = Number(messageId);
      if (Number.isFinite(fromKey) && fromKey > 0) createdAtMs = fromKey;
    }
    if (createdAtMs == null) createdAtMs = Date.now();

    const row = {
      chat_id: chatId,
      rtdb_key: messageId,
      sender_id: senderId,
      recipient_id: recipientId,
      text: typeof v.text === 'string' ? v.text : null,
      image_url: typeof v.imageUrl === 'string' ? v.imageUrl : null,
      image_urls: Array.isArray(v.imageUrls) ? v.imageUrls : null,
      fruits: Array.isArray(v.fruits) ? v.fruits : [],
      reply_to: v.replyTo && typeof v.replyTo === 'object' ? v.replyTo : null,
      os: typeof v.os === 'string' ? v.os : null,
      created_at: new Date(createdAtMs).toISOString(),
    };

    const supabase = getSupabaseAdmin();
    // Plain INSERT. The unique index on (chat_id, rtdb_key) is PARTIAL
    // (WHERE rtdb_key IS NOT NULL), which Postgres can't infer from an
    // ON CONFLICT (col, col) clause — only full unique constraints work
    // that way. So we let a retry collide naturally and swallow 23505.
    const { error } = await supabase
      .from('private_messages')
      .insert(row);

    if (error) {
      // 23505 (unique violation) on a replayed event is fine.
      if (error.code === '23505') return null;
      console.error('[mirrorPrivateMessageToSupabase] insert failed:', error.message, { chatId, messageId });
    }
    return null;
  });
