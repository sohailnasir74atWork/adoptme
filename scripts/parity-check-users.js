// Spot-check parity between RTDB /users/{uid} and the Supabase split tables
// (user_identity, user_roblox, user_roles, user_cosmetics).
//
// Picks N random uids from RTDB, fetches the same uid from each Supabase
// table, and prints a diff for every mismatched field. Read-only — never
// writes.
//
// Run:
//   SUPABASE_URL=https://kvtbtzhtcaanhjblyick.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
//   node scripts/parity-check-users.js
//
// Optional env:
//   SAMPLE_SIZE=20            (default: 20)
//   FAIL_THRESHOLD=2          (default: 2 — exit non-zero if more than this many uids mismatch in same field)
//
// Prereqs (same as backfill-users-to-supabase.js):
//   1. serviceAccount.json at project root.
//   2. SUPABASE_SERVICE_ROLE_KEY in env.

const path = require('path');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccount.json');

let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT_PATH);
} catch (e) {
  console.error(`\n[FAIL] Could not load ${SERVICE_ACCOUNT_PATH}`);
  console.error('       Download it from Firebase Console -> Project Settings');
  console.error('       -> Service Accounts -> Generate new private key.\n');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n[FAIL] Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in env.\n');
  process.exit(1);
}

const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || '20', 10);
const FAIL_THRESHOLD = parseInt(process.env.FAIL_THRESHOLD || '2', 10);

const RTDB_URL =
  process.env.RTDB_URL ||
  `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: RTDB_URL,
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rtdb = admin.database();

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

// Pick N random uids from RTDB. We do this by sampling with shallow
// listing instead of pulling the whole /users blob (which is huge).
async function pickRandomUids(n) {
  // shallow=true returns just keys at the root, not values.
  // Doing this through the Firebase Admin SDK requires a REST call.
  const url = `${RTDB_URL}/users.json?shallow=true&auth=${(await admin.credential.applicationDefault().getAccessToken().catch(() => ({}))).access_token || ''}`;
  // Simpler: use the admin SDK directly with a low-cost query — limit to a
  // reasonable upper bound and pick at random from that. For 125k users
  // this is the only honest way without listing all keys.
  // We'll use limitToFirst on a random orderByKey starting point.
  const allKeysSnap = await rtdb.ref('/users').orderByKey().limitToFirst(2000).once('value');
  const keys = Object.keys(allKeysSnap.val() || {});
  if (keys.length === 0) return [];
  // Shuffle Fisher-Yates and take first n
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.slice(0, n);
}

async function readRtdbUser(uid) {
  const snap = await rtdb.ref(`/users/${uid}`).once('value');
  return snap.exists() ? snap.val() : null;
}

async function readSupabaseUser(uid) {
  const [identity, roblox, roles, cosmetics] = await Promise.all([
    supabase.from('user_identity').select('*').eq('uid', uid).maybeSingle(),
    supabase.from('user_roblox').select('*').eq('uid', uid).maybeSingle(),
    supabase.from('user_roles').select('*').eq('uid', uid).maybeSingle(),
    supabase.from('user_cosmetics').select('*').eq('uid', uid).maybeSingle(),
  ]);
  return {
    identity: identity.data || null,
    roblox: roblox.data || null,
    roles: roles.data || null,
    cosmetics: cosmetics.data || null,
  };
}

// Field-by-field comparison. Each entry: [rtdbKey, supabaseTable, supabaseCol, transformFn?]
// transformFn lets us match the mirror's coercion (asBool, asNumber, asString).
const asBool = (v) => v === true;
const asNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asString = (v) => (typeof v === 'string' ? v : null);
const asRobloxId = (v) => (v == null ? null : String(v));

const FIELD_MAP = [
  // identity
  ['displayName',           'identity',  'display_name',         asString],
  ['avatar',                'identity',  'avatar',               asString],
  ['email',                 'identity',  'email',                asString],
  ['decodedEmail',          'identity',  'decoded_email',        asString],
  ['flage',                 'identity',  'flag',                 asString],          // typo->fix in mirror
  ['dateOfBirth',           'identity',  'date_of_birth',        asString],
  ['OS',                    'identity',  'os',                   asString],
  ['createdAt',             'identity',  'created_at_ms',        asNumber],
  ['lastActivity',          'identity',  'last_activity_ms',     asNumber],
  ['lastProfileEditAt',     'identity',  'last_profile_edit_ms', asNumber],
  // roblox
  ['robloxUsername',        'roblox',    'roblox_username',          asString],
  ['robloxUserId',          'roblox',    'roblox_user_id',           asRobloxId],
  ['robloxUsernameVerified','roblox',    'roblox_username_verified', asBool],
  // roles
  ['admin',                 'roles',     'is_admin',             asBool],            // rename
  ['isModerator',           'roles',     'is_moderator',         asBool],
  ['isBabyMod',             'roles',     'is_baby_mod',          asBool],
  ['isTrusted',             'roles',     'is_trusted',           asBool],
  ['isCMSR',                'roles',     'is_cmsr',              asBool],
  // cosmetics
  ['topBadge',              'cosmetics', 'top_badge',            asString],
  ['isPro',                 'cosmetics', 'is_pro',               asBool],
];

function compare(uid, rtdb, supabase) {
  const mismatches = [];
  for (const [rKey, sTable, sCol, transform] of FIELD_MAP) {
    const rRaw = rtdb ? rtdb[rKey] : null;
    const rExpected = transform(rRaw);

    const sRow = supabase[sTable];
    const sActual = sRow ? sRow[sCol] : null;

    // Treat null/undefined as equal. Booleans default to false in DB
    // (NOT NULL DEFAULT false in roles/cosmetics), so RTDB-null and
    // Supabase-false should also count as equal for booleans.
    const equal =
      (rExpected === sActual) ||
      (rExpected == null && sActual == null) ||
      (transform === asBool && (rExpected || false) === (sActual || false));

    if (!equal) {
      mismatches.push({
        uid,
        field: rKey,
        rtdb: rExpected,
        supabase: sActual,
        table: sTable,
      });
    }
  }
  return mismatches;
}

// --------------------------------------------------------------------
// Main
// --------------------------------------------------------------------

(async () => {
  console.log(`\n[parity-check] sampling ${SAMPLE_SIZE} uids from RTDB...`);
  const uids = await pickRandomUids(SAMPLE_SIZE);
  if (uids.length === 0) {
    console.log('[parity-check] no uids found in /users — DB empty?');
    process.exit(1);
  }
  console.log(`[parity-check] picked ${uids.length} uids. Comparing...\n`);

  const allMismatches = [];
  let usersMissingFromSupabase = 0;
  let usersMissingFromRtdb = 0;

  for (const uid of uids) {
    const [rtdbUser, supabaseUser] = await Promise.all([
      readRtdbUser(uid),
      readSupabaseUser(uid),
    ]);

    if (!rtdbUser && !supabaseUser) continue;
    if (!rtdbUser) { usersMissingFromRtdb++; continue; }
    if (!supabaseUser.identity && !supabaseUser.roles && !supabaseUser.cosmetics) {
      usersMissingFromSupabase++;
      console.log(`[MISS] ${uid} — exists in RTDB but no Supabase rows yet.`);
      continue;
    }

    const m = compare(uid, rtdbUser, supabaseUser);
    if (m.length > 0) {
      console.log(`[DIFF] ${uid}:`);
      for (const d of m) {
        console.log(`         ${d.table}.${d.field}: rtdb=${JSON.stringify(d.rtdb)} supabase=${JSON.stringify(d.supabase)}`);
      }
      allMismatches.push(...m);
    } else {
      console.log(`[OK]   ${uid}`);
    }
  }

  console.log('\n--- summary ---');
  console.log(`uids checked:              ${uids.length}`);
  console.log(`uids missing in Supabase:  ${usersMissingFromSupabase}`);
  console.log(`uids missing in RTDB:      ${usersMissingFromRtdb}`);
  console.log(`field mismatches:          ${allMismatches.length}`);

  // Group mismatches by field — if the same field is wrong for many uids,
  // that's a mirror-CF bug, not random staleness.
  if (allMismatches.length > 0) {
    const byField = new Map();
    for (const m of allMismatches) {
      const key = `${m.table}.${m.field}`;
      byField.set(key, (byField.get(key) || 0) + 1);
    }
    const sorted = [...byField.entries()].sort((a, b) => b[1] - a[1]);
    console.log('\n--- mismatches by field ---');
    for (const [k, count] of sorted) {
      const flag = count > FAIL_THRESHOLD ? '  <-- HOT' : '';
      console.log(`${k}: ${count}${flag}`);
    }
  }

  // Exit code: 0 if everything's clean, 1 if any field crossed FAIL_THRESHOLD,
  // 2 if too many uids missing from Supabase.
  let exitCode = 0;
  if (usersMissingFromSupabase > Math.max(1, Math.floor(SAMPLE_SIZE * 0.1))) {
    console.log('\n[FAIL] Too many uids missing from Supabase (>10% of sample). Mirror or backfill problem.');
    exitCode = 2;
  } else if (allMismatches.length > 0) {
    const byFieldVals = [...new Map(allMismatches.map(m => [`${m.table}.${m.field}`, 0])).keys()];
    const counts = {};
    for (const m of allMismatches) {
      const k = `${m.table}.${m.field}`;
      counts[k] = (counts[k] || 0) + 1;
    }
    const hotFields = Object.entries(counts).filter(([_, c]) => c > FAIL_THRESHOLD);
    if (hotFields.length > 0) {
      console.log(`\n[FAIL] ${hotFields.length} field(s) mismatched in >${FAIL_THRESHOLD} uids — looks like a mirror bug.`);
      exitCode = 1;
    } else {
      console.log('\n[OK]   Some random staleness, no systematic field mismatches. Acceptable.');
    }
  } else {
    console.log('\n[OK]   All sampled uids match.');
  }

  process.exit(exitCode);
})().catch((e) => {
  console.error('\n[FAIL] script crashed:', e);
  process.exit(3);
});
