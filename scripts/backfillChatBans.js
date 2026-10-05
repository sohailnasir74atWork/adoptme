#!/usr/bin/env node
/**
 * backfillChatBans.js
 *
 * One-shot seed (and later, reconciliation) for supabase/045_chat_ban_enforcement.sql:
 *
 *   RTDB /banned_users_by_email/*  →  public.chat_bans
 *   RTDB /links_allowed            →  public.chat_settings('links_allowed')
 *
 * functions/mirrorBansToSupabase.js keeps both in sync from the moment it is
 * deployed; this script copies everything that already existed before that.
 * Row shape comes from functions/_chatBanRow.js, the same module the Cloud
 * Function uses, so the two cannot drift.
 *
 * WHAT IT WRITES
 *   * Only ACTIVE bans by default (permanent, or bannedUntil in the future).
 *     ~700 of the ~2,700 records are long-expired mutes; copying them adds
 *     rows the triggers would ignore anyway. --include-expired copies all.
 *   * INSERT-ONLY by default (ON CONFLICT DO NOTHING). Rows already written by
 *     the Cloud Function reflect a staff action and are left alone — RTDB may
 *     hold non-staff edits the function deliberately refused (see the header
 *     of mirrorBansToSupabase.js). --overwrite replaces them with RTDB's
 *     current state instead.
 *   * links_allowed is always written (only admins can write that leaf).
 *   * Mixed-case legacy keys are stored under their lowercase form; when both
 *     exist, the lowercase record wins.
 *
 * OPTIONAL
 *   --prune  delete chat_bans rows whose key no longer exists in RTDB at all.
 *            CAUTION: a banned user can delete their own RTDB record (the
 *            rules allow it), and the function intentionally keeps their
 *            server-side ban. --prune lifts those too. Use it only to clear a
 *            missed staff unban, after checking the dry-run list.
 *
 * USAGE
 *   # dry run (default) — prints what it WOULD write, writes nothing
 *   SUPABASE_URL=https://kvtbtzhtcaanhjblyick.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
 *     node scripts/backfillChatBans.js
 *
 *   # execute
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfillChatBans.js --apply
 *
 * Prereqs:
 *   1. serviceAccount.json at project root.
 *   2. supabase/045_chat_ban_enforcement.sql STEP 1 applied (tables exist).
 *   3. firebase-admin + @supabase/supabase-js: resolved from the project root
 *      or, failing that, from functions/node_modules.
 *
 * Idempotent: safe to re-run.
 */

const path = require('path');

// The repo root has no firebase-admin; functions/ does.
function need(mod) {
  try {
    return require(mod);
  } catch (_) {
    return require(path.join(__dirname, '..', 'functions', 'node_modules', mod));
  }
}

const admin = need('firebase-admin');
const { createClient } = need('@supabase/supabase-js');
const {
  canonicalBanKey,
  buildChatBanRow,
  isActiveBan,
} = require('../functions/_chatBanRow');

const APPLY = process.argv.includes('--apply');
const OVERWRITE = process.argv.includes('--overwrite');
const INCLUDE_EXPIRED = process.argv.includes('--include-expired');
const PRUNE = process.argv.includes('--prune');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json');
let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT_PATH}`);
  console.error('   Download it from Firebase Console → Project Settings');
  console.error('   → Service Accounts → Generate new private key.\n');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.\n');
  process.exit(1);
}

const RTDB_URL =
  process.env.RTDB_URL ||
  `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: RTDB_URL,
});

// Same `ws` workaround as functions/_supabaseAdmin.js, for Node < 22.
let realtimeOpts = {};
try { realtimeOpts = { realtime: { transport: need('ws') } }; } catch (_) { /* Node 22+ has WebSocket */ }

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  ...realtimeOpts,
});

const BATCH_SIZE = 500;

// Stronger of two rows for the same canonical key (legacy duplicates).
function stronger(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.permanent !== b.permanent) return a.permanent ? a : b;
  return (b.banned_until_ms || 0) > (a.banned_until_ms || 0) ? b : a;
}

(async () => {
  const db = admin.database();
  const nowMs = Date.now();

  // ---- links_allowed ------------------------------------------------
  const linksSnap = await db.ref('links_allowed').get();
  const linksAllowed = linksSnap.val() === true;

  // ---- banned_users_by_email ----------------------------------------
  const snap = await db.ref('banned_users_by_email').get();
  const all = snap.val() || {};
  const rawKeys = Object.keys(all);

  const stats = {
    rtdbRecords: rawKeys.length,
    notARecord: 0,
    legacyKeys: 0,
    legacyShadowed: 0,
    active: 0,
    expiredSkipped: 0,
    toWrite: 0,
  };

  const exact = new Map();   // canonical key → row, from lowercase nodes
  const legacy = new Map();  // canonical key → row, from mixed-case nodes
  for (const raw of rawKeys) {
    const key = canonicalBanKey(raw);
    const row = key ? buildChatBanRow(key, all[raw]) : null;
    if (!row) { stats.notARecord++; continue; }
    if (raw === key) {
      exact.set(key, row);
    } else {
      stats.legacyKeys++;
      legacy.set(key, stronger(legacy.get(key), row));
    }
  }
  for (const [key, row] of legacy) {
    if (exact.has(key)) { stats.legacyShadowed++; continue; }
    exact.set(key, row);
  }

  const rtdbKeys = new Set(exact.keys());
  const rows = [];
  for (const row of exact.values()) {
    if (isActiveBan(row, nowMs)) {
      stats.active++;
    } else if (!INCLUDE_EXPIRED) {
      stats.expiredSkipped++;
      continue;
    }
    rows.push({ ...row, source_event_at: null, updated_at: new Date().toISOString() });
  }
  stats.toWrite = rows.length;

  // ---- prune candidates ---------------------------------------------
  let pruneKeys = [];
  if (PRUNE) {
    const existing = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('chat_bans')
        .select('email_key')
        .order('email_key')
        .range(from, from + 999);
      if (error) throw new Error(`chat_bans read failed: ${error.message}`);
      existing.push(...data.map((r) => r.email_key));
      if (data.length < 1000) break;
    }
    pruneKeys = existing.filter((k) => !rtdbKeys.has(k));
  }

  console.log(JSON.stringify(stats, null, 1));
  console.log(`\nlinks_allowed in RTDB: ${linksAllowed} → chat_settings.links_allowed`);
  console.log(`${rows.length} chat_bans rows would be ${OVERWRITE ? 'upserted (overwrite)' : 'inserted (existing rows kept)'}.`);
  if (rows.length > 0) {
    console.log('\nSample:');
    for (const r of rows.slice(0, 5)) {
      console.log(`  ${r.email_key}  uid=${r.user_id}  ${r.permanent ? 'permanent' : new Date(r.banned_until_ms || 0).toISOString()}  strike=${r.strike_count}`);
    }
  }
  if (PRUNE) {
    console.log(`\n--prune: ${pruneKeys.length} chat_bans rows have no RTDB record and would be DELETED:`);
    for (const k of pruneKeys.slice(0, 50)) console.log(`  ${k}`);
    if (pruneKeys.length > 50) console.log(`  … and ${pruneKeys.length - 50} more`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to execute.');
    process.exit(0);
  }

  // ---- write ---------------------------------------------------------
  {
    const { error } = await supabase
      .from('chat_settings')
      .upsert({ key: 'links_allowed', enabled: linksAllowed, updated_at: new Date().toISOString() },
        { onConflict: 'key' });
    if (error) throw new Error(`chat_settings upsert failed: ${error.message}`);
    console.log(`\n✅ chat_settings.links_allowed = ${linksAllowed}`);
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('chat_bans')
      .upsert(chunk, { onConflict: 'email_key', ignoreDuplicates: !OVERWRITE });
    if (error) throw new Error(`chat_bans upsert failed at ${i}: ${error.message}`);
    written += chunk.length;
    console.log(`  chat_bans ${written}/${rows.length}`);
  }

  if (PRUNE && pruneKeys.length > 0) {
    // Small chunks: the keys travel in the URL (?email_key=in.(...)).
    for (let i = 0; i < pruneKeys.length; i += 100) {
      const chunk = pruneKeys.slice(i, i + 100);
      const { error } = await supabase.from('chat_bans').delete().in('email_key', chunk);
      if (error) throw new Error(`chat_bans prune failed at ${i}: ${error.message}`);
    }
    console.log(`  pruned ${pruneKeys.length} rows`);
  }

  console.log('\nDone.');
  process.exit(0);
})().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
