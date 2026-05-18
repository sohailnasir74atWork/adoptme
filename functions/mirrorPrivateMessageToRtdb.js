/**
 * mirrorPrivateMessageToRtdb — Supabase → RTDB bridge for the 2-day
 * cross-version chat window after the Phase 5 cut.
 *
 * NEW app builds insert into Supabase public.private_messages.
 * OLD app builds read from RTDB /private_messages/{chatId}/messages/{key}.
 *
 * This HTTPS webhook fires on Supabase INSERTs and writes the same
 * message into RTDB so OLD apps see messages sent by users on the
 * new version.
 *
 * Pair: mirrorPrivateMessageToSupabase (RTDB → Supabase).
 *
 * Loop prevention:
 *   - Skip if record.rtdb_key !== null (the row originated from RTDB
 *     via the sister mirror — looping it back would be a no-op anyway,
 *     but we exit early to save the round-trip).
 *   - RTDB write key is `sb_<uuid_no_dashes>` so the sister mirror's
 *     prefix check skips it.
 *   - RTDB payload includes `_mirroredFromSupabase: true` so any other
 *     RTDB-onWrite trigger (e.g. notifyNewMessageLegacy) can also skip.
 *
 * Webhook config (Supabase Dashboard → Database → Webhooks):
 *   Table:  public.private_messages
 *   Events: INSERT
 *   Type:   HTTP Request
 *   Method: POST
 *   URL:    <this CF's HTTPS URL after deploy>
 *   Header: x-webhook-secret = <SUPABASE_WEBHOOK_SECRET>
 *
 * Required secrets (already set):
 *   SUPABASE_WEBHOOK_SECRET (shared with notifyNewMessage)
 *
 * Deployment:
 *   1. Copy this file's contents into
 *      /Volumes/Sohail/cloud functions/cloud function for adoptme/Firebase/functions/index.js
 *   2. firebase deploy --only functions:mirrorPrivateMessageToRtdb --project adoptme-7b50c
 *   3. Grab the HTTPS URL from the deploy output and paste it into the
 *      Supabase webhook config above.
 *
 * Removal after the 2-day bridge:
 *   - Disable the Supabase webhook first (so no more POSTs land)
 *   - firebase functions:delete mirrorPrivateMessageToRtdb --project adoptme-7b50c
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
  if (type !== 'INSERT' || !record) {
    res.status(200).send('Skipped: not an INSERT');
    return null;
  }
  return record;
}

exports.mirrorPrivateMessageToRtdb = functions
  .runWith({
    secrets: ['SUPABASE_WEBHOOK_SECRET'],
    memory: '256MB',
    timeoutSeconds: 30,
  })
  .https.onRequest(async (req, res) => {
    const r = rejectInvalid(req, res);
    if (!r) return;

    // Loop guard: row came from the RTDB → Supabase mirror.
    if (r.rtdb_key) {
      res.status(200).send('Skipped: rtdb-origin');
      return;
    }
    if (r.deleted === true) {
      res.status(200).send('Skipped: soft-deleted at insert');
      return;
    }
    if (!r.id || !r.chat_id || !r.sender_id) {
      res.status(200).send('Skipped: missing id/chat_id/sender_id');
      return;
    }

    const rtdbKey = `sb_${String(r.id).replace(/-/g, '')}`;
    const tsMs = r.created_at ? Date.parse(r.created_at) : Date.now();

    const payload = {
      text: r.text || '',
      senderId: r.sender_id,
      timestamp: Number.isFinite(tsMs) ? tsMs : Date.now(),
      _mirroredFromSupabase: true,
    };

    if (r.image_url) payload.imageUrl = r.image_url;
    if (Array.isArray(r.image_urls) && r.image_urls.length > 0) {
      payload.imageUrls = r.image_urls;
      // Match OLD app convention: keep first image as imageUrl too.
      if (!payload.imageUrl) payload.imageUrl = r.image_urls[0];
    }
    if (Array.isArray(r.fruits) && r.fruits.length > 0) payload.fruits = r.fruits;
    if (r.reply_to && typeof r.reply_to === 'object') payload.replyTo = r.reply_to;

    try {
      await admin.database()
        .ref(`/private_messages/${r.chat_id}/messages/${rtdbKey}`)
        .set(payload);
      res.status(200).send('OK');
    } catch (err) {
      console.error('[mirrorPrivateMessageToRtdb] write failed:', err);
      // 200, not 500: Supabase webhooks retry on 5xx, and a transient
      // RTDB hiccup shouldn't cause cascading retries during the bridge.
      res.status(200).send('Error logged');
    }
  });
