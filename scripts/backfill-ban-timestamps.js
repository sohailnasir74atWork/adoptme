#!/usr/bin/env node
/**
 * backfill-ban-timestamps.js
 *
 * WHY
 * `setUserStrike` wrote `appliedAt` and no `bannedAt`, while every other
 * moderation write (banUserwithEmail, muteUser) wrote `bannedAt`. The admin
 * dashboard's list queries `orderByChild('bannedAt')`, and RTDB sorts
 * records missing the ordering key FIRST — so `limitToLast` could never
 * reach them.
 *
 * Measured on production 2026-09-17:
 *     2,695 records total
 *     2,000 active — ALL permanent, and 1,999 of them have NO bannedAt
 *       695 expired — short mutes, the only ones carrying bannedAt
 *
 * Net effect: the Banned List showed "0" while 2,000 users were banned.
 *
 * The dashboard now also queries the permanent roster by `bannedUntil`, so
 * it works WITHOUT this backfill. This script is the data cleanup: once
 * every record carries `bannedAt`, ordering by recency works everywhere and
 * the second query stops being load-bearing.
 *
 * WHAT IT WRITES
 * Exactly one new field per record: `bannedAt`. Nothing else is touched —
 * not `bannedUntil`, not `strikeCount`, not `reason`. Enforcement behaviour
 * is unchanged; this only makes existing records reachable by the
 * bannedAt-ordered query.
 *
 * Source of the value, in order of preference:
 *   1. `appliedAt`  — what setUserStrike wrote. Exact.
 *   2. derived from `bannedUntil` minus the tier's duration (12h / 24h),
 *      for timed records with neither timestamp. Approximate but ordered
 *      correctly relative to each other.
 *   3. skipped — a permanent record with no timestamp at all has nothing
 *      to derive from. Left alone rather than stamped with a fake date.
 *
 * USAGE
 *   # dry run (default) — prints what it WOULD write, writes nothing
 *   RTDB_URL='https://adoptme-7b50c-default-rtdb.firebaseio.com' \
 *     node scripts/backfill-ban-timestamps.js
 *
 *   # execute
 *   RTDB_URL='...' node scripts/backfill-ban-timestamps.js --apply
 *
 * Idempotent: a record that already has `bannedAt` is skipped, so it is
 * safe to re-run.
 */

const admin = require('firebase-admin');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const RTDB_URL = process.env.RTDB_URL;

if (!RTDB_URL) {
  console.error('Set RTDB_URL, e.g. https://adoptme-7b50c-default-rtdb.firebaseio.com');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, '..', 'serviceAccount.json'))),
  databaseURL: RTDB_URL,
});

// Mirrors the ladder in setUserStrike: strike 1 = 12h, strike 2 = 24h.
// Strike 3+ is permanent and therefore has no derivable start.
const TIER_MS = { 1: 12 * 60 * 60 * 1000, 2: 24 * 60 * 60 * 1000 };

// Writing 2,000+ paths in one update() is a single huge request; chunk it
// so a failure costs one batch, not the whole run.
const BATCH_SIZE = 200;

(async () => {
  const db = admin.database();
  const snap = await db.ref('banned_users_by_email').get();
  const all = snap.val() || {};
  const keys = Object.keys(all);

  const updates = {};
  const stats = { total: keys.length, already: 0, fromApplied: 0, derived: 0, skipped: 0 };

  for (const key of keys) {
    const rec = all[key];
    if (!rec || typeof rec !== 'object') { stats.skipped++; continue; }

    if (typeof rec.bannedAt === 'number') { stats.already++; continue; }

    if (typeof rec.appliedAt === 'number') {
      updates[`${key}/bannedAt`] = rec.appliedAt;
      stats.fromApplied++;
      continue;
    }

    const until = rec.bannedUntil;
    const tier = TIER_MS[rec.strikeCount];
    if (typeof until === 'number' && tier) {
      updates[`${key}/bannedAt`] = until - tier;
      stats.derived++;
      continue;
    }

    stats.skipped++;
  }

  const paths = Object.keys(updates);
  console.log(JSON.stringify(stats, null, 1));
  console.log(`\n${paths.length} records would gain a bannedAt.`);

  if (paths.length > 0) {
    console.log('\nSample:');
    for (const p of paths.slice(0, 5)) {
      console.log(`  ${p} = ${new Date(updates[p]).toISOString()}`);
    }
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to execute.');
    process.exit(0);
  }

  let written = 0;
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const chunk = paths.slice(i, i + BATCH_SIZE);
    const batch = {};
    for (const p of chunk) batch[p] = updates[p];
    await db.ref('banned_users_by_email').update(batch);
    written += chunk.length;
    console.log(`  wrote ${written}/${paths.length}`);
  }

  console.log(`\nDone. ${written} records updated.`);
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
