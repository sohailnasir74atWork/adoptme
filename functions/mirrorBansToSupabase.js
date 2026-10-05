/**
 * Cloud Functions: mirror chat bans and the links switch into Supabase, so
 * Postgres can enforce them (supabase/045_chat_ban_enforcement.sql).
 *
 *   RTDB /banned_users_by_email/{emailKey}  →  public.chat_bans
 *   RTDB /links_allowed                     →  public.chat_settings('links_allowed')
 *
 * RTDB stays the SOURCE OF TRUTH: the app, the admin dashboard and every old
 * build keep reading and writing it unchanged. These functions only copy.
 *
 * WHY
 * The app enforces bans client-side, from RTDB. The website writes chat
 * straight to Supabase with the user's Firebase ID token, where nothing knew
 * about bans — a user banned in the app could keep chatting there. With this
 * mirror, 045's BEFORE INSERT triggers reject the send for every client.
 *
 * ONLY STAFF DECISIONS ARE MIRRORED  (read this before "simplifying" it)
 * database.rules.json lets ANY client — signed in or not — write or delete
 * banned_users_by_email/{key} as long as the record is not about a staff
 * member. That is needed by nothing in the app (every ban/mute/strike/unban
 * path is staff-only — see canStaffBanMute in Code/ChatScreen/utils.js), but
 * it means a banned user can delete their own record with one REST call. A
 * blind mirror would copy that delete and lift the server-side ban too,
 * making this whole feature pointless.
 *
 * So a change is mirrored only when it was written by:
 *   * the Admin SDK (context.authType === 'ADMIN') — other Cloud Functions,
 *     scripts, an admin website using the service account; or
 *   * a signed-in staff user: users/{uid}/admin|isAdmin|isSeniorMod|
 *     isModerator|isBabyMod === true, or a verified owner email — the same
 *     staff set database.rules.json uses for this node.
 * Changes by anyone else are logged and ignored; Supabase keeps the last
 * staff-made state. Consequence worth knowing: a non-staff edit is visible in
 * the app (which reads RTDB) but not on the server. A self-deleted ban
 * therefore still blocks sends server-side, and an app user in that state
 * sees USER_BANNED from the database.
 *
 * WHAT COUNTS AS A CHANGE
 * Only the enforcement fields (userId, bannedUntil, strikeCount, reason — see
 * _chatBanRow.js). Writes that leave them identical are skipped, which:
 *   * makes stampBanTimestamp's `bannedAt` write-back a no-op here (no loop:
 *     this function never writes to RTDB at all);
 *   * ignores mirrorBanToDevice's deviceId/deviceIds update;
 *   * stops a staff write that touches other leaves from "laundering" an
 *     earlier ignored non-staff edit into Supabase.
 *
 * ORDERING
 * RTDB events can arrive out of order. Each row stores the RTDB event time
 * (source_event_at); an event older than the row's is dropped. A ban event
 * that arrives after its own unban's delete can still re-create the row —
 * rare (needs ban + unban within the same second or two); re-run
 * scripts/backfillChatBans.js to reconcile.
 *
 * LEGACY KEYS
 * Mixed-case keys (pre-lowercasing builds) are stored under their lowercase
 * form, the one 045 derives from the token's email. If the lowercase node
 * exists in RTDB it is authoritative and the legacy node is ignored.
 *
 * Failure handling: same as the other mirrors — log, never throw (no
 * retries). The backfill script is the reconciliation tool.
 *
 * Deployment:
 *   firebase deploy --only functions:mirrorBansToSupabase,functions:mirrorLinksAllowedToSupabase --project adoptme-7b50c
 *   (Secrets SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY already exist; reused.)
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');
const {
  canonicalBanKey,
  buildChatBanRow,
  enforcementFingerprint,
} = require('./_chatBanRow');

if (!admin.apps.length) {
  admin.initializeApp();
}

// Keep in sync with database.rules.json (banned_users_by_email / links_allowed),
// is_staff() in supabase/039 and GlobelStats.js.
const OWNER_EMAILS = new Set([
  'thesolanalabs@gmail.com',
  'sohailnasir74business@gmail.com',
  'sohailnasir74@gmail.com',
]);

// users/{uid} flags that make a writer staff for this node — the same set the
// banned_users_by_email .read rule grants (minus jmd_granters, who can read
// the list but have no ban/unban action in the app).
const STAFF_FLAGS = ['admin', 'isAdmin', 'isSeniorMod', 'isModerator', 'isBabyMod'];

/**
 * Was this RTDB write made by the Admin SDK or a staff member?
 * Exported for unit testing.
 */
async function isTrustedWriter(context) {
  if (context.authType === 'ADMIN') return true;
  if (context.authType !== 'USER') return false;

  const uid = context.auth && context.auth.uid;
  if (!uid) return false;

  const token = (context.auth && context.auth.token) || {};
  if (token.email_verified === true && OWNER_EMAILS.has(String(token.email || '').toLowerCase())) {
    return true;
  }

  // Leaf reads, not users/{uid}: that record is large and read on a hot path
  // elsewhere; five tiny reads in parallel are cheaper.
  const db = admin.database();
  const flags = await Promise.all(
    STAFF_FLAGS.map((f) =>
      db.ref(`users/${uid}/${f}`).once('value')
        .then((s) => s.val() === true)
        .catch(() => false)),
  );
  return flags.some(Boolean);
}

exports.isTrustedWriter = isTrustedWriter;

exports.mirrorBansToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '128MB',      // one small record, one row
    timeoutSeconds: 30,
  })
  .database.ref('/banned_users_by_email/{emailKey}')
  .onWrite(async (change, context) => {
    const rawKey = context.params.emailKey;
    const key = canonicalBanKey(rawKey);
    if (!key) return null;

    const beforeRow = change.before.exists() ? buildChatBanRow(key, change.before.val()) : null;
    const afterRow = change.after.exists() ? buildChatBanRow(key, change.after.val()) : null;

    // bannedAt stamps, deviceId tags, etc. — nothing enforcement-relevant.
    if (enforcementFingerprint(beforeRow) === enforcementFingerprint(afterRow)) return null;

    const trusted = await isTrustedWriter(context);
    if (!trusted) {
      functions.logger.warn('[mirrorBans] ignored change by non-staff writer', {
        key,
        authType: context.authType,
        uid: context.auth?.uid || null,
        op: !afterRow ? 'delete' : (!beforeRow ? 'create' : 'update'),
      });
      return null;
    }

    // Legacy mixed-case node: the lowercase node, if present, is the record.
    if (rawKey !== key) {
      try {
        const canon = await admin.database().ref(`banned_users_by_email/${key}`).once('value');
        if (canon.exists()) {
          functions.logger.info('[mirrorBans] legacy key shadowed by lowercase node; skipped', { rawKey, key });
          return null;
        }
      } catch (err) {
        functions.logger.error('[mirrorBans] legacy key check failed', { rawKey, error: err?.message });
        return null;
      }
    }

    const parsed = Date.parse(context.timestamp);
    const eventMs = Number.isNaN(parsed) ? Date.now() : parsed;
    const eventIso = new Date(eventMs).toISOString();
    const supabase = getSupabaseAdmin();

    // Ordering guard: never let an older event overwrite a newer one.
    const { data: existing, error: readErr } = await supabase
      .from('chat_bans')
      .select('source_event_at')
      .eq('email_key', key)
      .maybeSingle();
    if (readErr) {
      // Proceed without the guard — a stale write is far less likely than
      // the harm of dropping a real ban/unban.
      functions.logger.warn('[mirrorBans] ordering read failed; writing anyway', { key, error: readErr.message });
    } else if (existing?.source_event_at && Date.parse(existing.source_event_at) > eventMs) {
      functions.logger.info('[mirrorBans] out-of-order event dropped', {
        key, eventAt: eventIso, rowAt: existing.source_event_at,
      });
      return null;
    }

    if (!afterRow) {
      // Unban (node deleted) — or a non-object value, which is no ban either.
      const { error } = await supabase.from('chat_bans').delete().eq('email_key', key);
      if (error) {
        functions.logger.error('[mirrorBans] delete failed', { key, error: error.message });
      }
      return null;
    }

    const { error } = await supabase
      .from('chat_bans')
      .upsert({
        ...afterRow,
        source_event_at: eventIso,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'email_key' });
    if (error) {
      functions.logger.error('[mirrorBans] upsert failed', { key, error: error.message });
    }
    return null;
  });

// --------------------------------------------------------------------
// /links_allowed → chat_settings('links_allowed')
//
// Only admins / owners can write this leaf (database.rules.json), so there is
// no trust question. The CURRENT value is re-read rather than taken from the
// event, which makes duplicate and out-of-order deliveries harmless. Only an
// explicit `true` turns links on — same as linksSwitch.js.
// --------------------------------------------------------------------
exports.mirrorLinksAllowedToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '128MB',
    timeoutSeconds: 30,
  })
  .database.ref('/links_allowed')
  .onWrite(async () => {
    let enabled;
    try {
      const snap = await admin.database().ref('links_allowed').once('value');
      enabled = snap.val() === true;
    } catch (err) {
      functions.logger.error('[mirrorLinksAllowed] RTDB read failed', { error: err?.message });
      return null;
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('chat_settings')
      .upsert({
        key: 'links_allowed',
        enabled,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    if (error) {
      functions.logger.error('[mirrorLinksAllowed] upsert failed', { enabled, error: error.message });
    } else {
      functions.logger.info('[mirrorLinksAllowed] mirrored', { enabled });
    }
    return null;
  });
