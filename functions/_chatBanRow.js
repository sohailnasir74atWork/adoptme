/**
 * Pure helpers shared by functions/mirrorBansToSupabase.js and
 * scripts/backfillChatBans.js — ONE definition of how an RTDB
 * banned_users_by_email record becomes a public.chat_bans row
 * (supabase/045_chat_ban_enforcement.sql).
 *
 * No requires on purpose: the backfill script loads this from outside the
 * functions/ package.
 */

// Same shape as encodeEmailForBan() in Code/ChatScreen/utils.js and
// public.chat_ban_key() in 045. RTDB keys are already encoded; this only
// lowercases the legacy mixed-case keys that unbanUserWithEmail still
// cleans up ("keyOriginal"), so they land on the key Postgres derives from
// the token's email.
const canonicalBanKey = (rawKey) => String(rawKey || '').trim().toLowerCase();

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * RTDB record → chat_bans row (without updated_at / source_event_at), or null
 * when the value is not a ban record at all.
 *
 * bannedUntil semantics match GlobelStats' listener exactly:
 *   'permanent'     → banned forever
 *   number (ms)     → banned until then
 *   anything else   → not banned (row is still written; it is simply inert)
 */
function buildChatBanRow(emailKey, record) {
  if (!record || typeof record !== 'object') return null;

  const until = record.bannedUntil;
  const reason = typeof record.reason === 'string' ? record.reason.slice(0, 500) : null;

  return {
    email_key: emailKey,
    user_id: typeof record.userId === 'string' && record.userId.length > 0 ? record.userId : null,
    banned_until_ms: isFiniteNumber(until) ? Math.trunc(until) : null,
    permanent: until === 'permanent',
    strike_count: isFiniteNumber(record.strikeCount) ? Math.trunc(record.strikeCount) : null,
    reason,
  };
}

/**
 * The fields that decide enforcement. Two records with the same fingerprint
 * enforce identically, so a write that leaves it unchanged (stampBanTimestamp
 * adding bannedAt, mirrorBanToDevice adding deviceIds) needs no mirroring.
 */
function enforcementFingerprint(row) {
  if (!row) return 'none';
  return JSON.stringify([
    row.user_id, row.banned_until_ms, row.permanent, row.strike_count, row.reason,
  ]);
}

/** Is the row an active ban at `nowMs`? */
function isActiveBan(row, nowMs) {
  if (!row) return false;
  return row.permanent === true || (isFiniteNumber(row.banned_until_ms) && row.banned_until_ms > nowMs);
}

module.exports = {
  canonicalBanKey,
  buildChatBanRow,
  enforcementFingerprint,
  isActiveBan,
};
