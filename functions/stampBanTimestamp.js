/**
 * Cloud Function: guarantee every ban record carries `bannedAt`.
 *
 * WHY THIS EXISTS
 * The admin dashboard lists active restrictions with
 * `orderByChild('bannedAt')`. RTDB sorts records **missing** the ordering
 * key FIRST, so `limitToLast` never reaches them — a record without
 * `bannedAt` is invisible to that query no matter how many pages you load.
 *
 * `setUserStrike` used to write `appliedAt` and never `bannedAt`, which is
 * why the Banned List showed 0 while 2,000 users were banned. The client is
 * fixed (Code/ChatScreen/utils.js writes both), and the existing 2,348
 * records were backfilled by scripts/backfill-ban-timestamps.js on
 * 2026-09-17.
 *
 * But the client fix only lives in a build carrying it. Every moderator
 * still on the STORE BUILD keeps writing `appliedAt` only — so their
 * strikes keep landing without `bannedAt` and stay invisible until someone
 * re-runs the backfill by hand. This function removes that manual step:
 * it stamps the field server-side, for every build, old and new, forever.
 *
 * WHAT IT DOES
 * On any write to /banned_users_by_email/{key}, if the record exists and
 * has no numeric `bannedAt`, derive one and write it back:
 *   1. `appliedAt`  — what setUserStrike wrote. Exact.
 *   2. `bannedUntil` minus the tier duration (strike 1 = 12h, 2 = 24h).
 *      Approximate, but correctly ordered relative to its neighbours.
 *   3. event timestamp — last resort for a permanent ban with no other
 *      time on it. Right to within one function invocation.
 *
 * Nothing else is touched: not `bannedUntil`, not `strikeCount`, not
 * `reason`. Enforcement behaviour is completely unchanged — this only makes
 * an existing record reachable by an indexed query.
 *
 * COST / LOOP SAFETY
 * Moderation volume is order tens of writes per day, so invocations are
 * negligible. The write-back re-triggers this function exactly once, and
 * that second pass sees a numeric `bannedAt` and returns immediately — so
 * it terminates after one extra no-op invocation, never loops.
 *
 * Deployment:
 *   firebase deploy --only functions:stampBanTimestamp --project adoptme-7b50c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

// Mirrors the ladder in setUserStrike (Code/ChatScreen/utils.js):
// strike 1 = 12h, strike 2 = 24h. Strike 3+ is permanent and therefore has
// no derivable start time.
const TIER_MS = { 1: 12 * 60 * 60 * 1000, 2: 24 * 60 * 60 * 1000 };

const isPositiveNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * Best available creation time for a ban record, or null if the record
 * shouldn't be stamped.
 * Exported for unit testing.
 */
function deriveBannedAt(record, eventTimeMs) {
  if (!record || typeof record !== 'object') return null;

  // Already good — nothing to do.
  if (isPositiveNumber(record.bannedAt)) return null;

  // 1. The field setUserStrike actually wrote.
  if (isPositiveNumber(record.appliedAt)) return record.appliedAt;

  // 2. Derive from the expiry and the tier's duration.
  const tier = TIER_MS[record.strikeCount];
  if (tier && isPositiveNumber(record.bannedUntil)) {
    const derived = record.bannedUntil - tier;
    if (derived > 0) return derived;
  }

  // 3. Last resort: when this write happened. Only off by the function's
  //    own latency, and far better than leaving the record unqueryable.
  if (isPositiveNumber(eventTimeMs)) return eventTimeMs;

  return null;
}

exports.deriveBannedAt = deriveBannedAt;

exports.stampBanTimestamp = functions
  .runWith({
    memory: '128MB',      // reads one small record, writes one leaf
    timeoutSeconds: 30,
  })
  .database.ref('/banned_users_by_email/{key}')
  .onWrite(async (change, context) => {
    // Unban deletes the node — nothing to stamp.
    if (!change.after.exists()) return null;

    const record = change.after.val();
    if (!record || typeof record !== 'object') return null;

    // Fast exit on the self-triggered second pass, and on every write from
    // a client that already sets the field.
    if (isPositiveNumber(record.bannedAt)) return null;

    const eventTimeMs = Date.parse(context.timestamp);
    const bannedAt = deriveBannedAt(record, Number.isNaN(eventTimeMs) ? Date.now() : eventTimeMs);
    if (bannedAt === null) return null;

    try {
      // Write the single leaf, not the whole record — a set() here would
      // race with a concurrent moderation action and could clobber it.
      await change.after.ref.child('bannedAt').set(bannedAt);
      functions.logger.info('[stampBanTimestamp] stamped', {
        key: context.params.key,
        bannedAt,
        source: isPositiveNumber(record.appliedAt) ? 'appliedAt'
          : TIER_MS[record.strikeCount] ? 'derived-from-bannedUntil'
          : 'event-time',
      });
    } catch (err) {
      // Best-effort: a failure here leaves the record exactly as the client
      // wrote it (enforcement intact, just not listed). The next write to
      // this record retries.
      functions.logger.error('[stampBanTimestamp] write failed', {
        key: context.params.key,
        error: err?.message,
      });
    }

    return null;
  });
