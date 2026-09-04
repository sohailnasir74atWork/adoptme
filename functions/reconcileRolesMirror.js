/**
 * reconcileRolesMirror — every 6 hours, make Supabase `user_roles` agree with
 * RTDB `/users/{uid}` role flags (RTDB is the source of truth).
 *
 * Why (2026-09-04): every screen trusts the Supabase roles row over RTDB and
 * only falls back when the row is MISSING. When the mirror Cloud Function is
 * down (it crashed for ~20 h on 2026-09-02/03), role removals made in that
 * window never reach Supabase, and a repeat removal is a no-op RTDB write that
 * fires no trigger — so the stale role "comes back" forever. This job is the
 * safety net: it diffs the true-sets in both stores and re-upserts any drift.
 *
 * Cost: one indexed RTDB query per flag (6 tiny queries) + one Supabase select
 * of rows with any flag true (a few dozen rows) + upserts only for drift.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) admin.initializeApp();

// RTDB flag → Supabase column. Every flag here has an `.indexOn` entry under
// /users in the RTDB rules, so `orderByChild(flag).equalTo(true)` is cheap.
const FLAGS = [
  { rtdb: 'admin',       col: 'is_admin' },
  { rtdb: 'isModerator', col: 'is_moderator' },
  { rtdb: 'isBabyMod',   col: 'is_baby_mod' },
  { rtdb: 'isTrusted',   col: 'is_trusted' },
  { rtdb: 'isCMSR',      col: 'is_cmsr' },
  { rtdb: 'isHelper',    col: 'is_helper' },
];

exports.reconcileRolesMirror = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '256MB',
    timeoutSeconds: 120,
  })
  .pubsub.schedule('every 6 hours')
  .onRun(async () => {
    const db = admin.database();
    const supabase = getSupabaseAdmin();

    // 1) Truth: uids that hold each flag in RTDB.
    const truth = {}; // uid -> { col: true }
    for (const { rtdb, col } of FLAGS) {
      const snap = await db.ref('users').orderByChild(rtdb).equalTo(true).once('value');
      snap.forEach((child) => {
        (truth[child.key] = truth[child.key] || {})[col] = true;
      });
    }

    // 2) Mirror: every Supabase row with any flag true.
    const orFilter = FLAGS.map((f) => `${f.col}.eq.true`).join(',');
    const { data: rows, error } = await supabase
      .from('user_roles')
      .select('uid,' + FLAGS.map((f) => f.col).join(','))
      .or(orFilter);
    if (error) {
      console.error('[reconcileRoles] select failed:', error.message);
      return null;
    }
    const mirror = {};
    for (const r of rows || []) mirror[r.uid] = r;

    // 3) Diff. A uid drifts if any flag differs in either direction.
    const drifted = [];
    const uids = new Set([...Object.keys(truth), ...Object.keys(mirror)]);
    for (const uid of uids) {
      const t = truth[uid] || {};
      const m = mirror[uid] || {};
      if (FLAGS.some((f) => !!t[f.col] !== !!m[f.col])) {
        const row = { uid, updated_at: new Date().toISOString() };
        for (const f of FLAGS) row[f.col] = !!t[f.col];
        drifted.push(row);
      }
    }

    if (drifted.length === 0) {
      console.log(`[reconcileRoles] in sync (${Object.keys(truth).length} role holders)`);
      return null;
    }
    const { error: upErr } = await supabase
      .from('user_roles')
      .upsert(drifted, { onConflict: 'uid' });
    if (upErr) console.error('[reconcileRoles] upsert failed:', upErr.message);
    else console.log(`[reconcileRoles] repaired ${drifted.length} drifted row(s):`, drifted.map((d) => d.uid).join(', '));
    return null;
  });
