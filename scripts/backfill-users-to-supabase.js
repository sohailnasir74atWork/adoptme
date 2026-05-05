// One-shot backfill: copy existing RTDB /users/{uid} into the 8 split
// Supabase tables (user_identity, user_roblox, user_roles, user_cosmetics,
// user_notifications, user_settings, user_badges, user_blocks).
//
// Run BEFORE flipping any client to read from Supabase, so on first
// open every user already has their profile data populated.
//
// Idempotent — uses upsert, safe to re-run. Re-running won't reset
// earned_at_ms / blocked_at_ms because we use ignoreDuplicates on the
// relational tables.
//
// Run (single worker):
//   SUPABASE_URL=https://kvtbtzhtcaanhjblyick.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service-role> \
//   node scripts/backfill-users-to-supabase.js
//
// Run (4 parallel workers, partitioning by UID lexicographic prefix):
//   In 4 separate terminals:
//   WORKER_TAG=w1 RANGE_START='!' RANGE_END='9zzz' SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-users-to-supabase.js
//   WORKER_TAG=w2 RANGE_START='A'  RANGE_END='Mzzz' ... node scripts/backfill-users-to-supabase.js
//   WORKER_TAG=w3 RANGE_START='N'  RANGE_END='Zzzz' ... node scripts/backfill-users-to-supabase.js
//   WORKER_TAG=w4 RANGE_START='a'  RANGE_END='~'    ... node scripts/backfill-users-to-supabase.js
//
//   (Firebase UIDs are base64-ish: digits + upper + lower. Adjust ranges
//   based on your actual UID distribution if it's skewed.)
//
// Prereqs:
//   1. serviceAccount.json at project root.
//   2. SUPABASE_SERVICE_ROLE_KEY in env.
//   3. supabase/004_users_split.sql already applied.
//   4. firebase-admin + @supabase/supabase-js available (already in functions/).

const path = require('path');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --------------------------------------------------------------------
// Helpers (must match mirrorUsersToSupabase.js semantics exactly)
// --------------------------------------------------------------------

const nowIso = () => new Date().toISOString();
const asString = (v) => (typeof v === 'string' ? v : null);
const asBool = (v) => v === true;
const asNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asJsonb = (v) => (v && typeof v === 'object' ? v : null);

// --------------------------------------------------------------------
// Per-user → per-table row builders. Each returns null if the user has
// no relevant data for that table (we still write a row; nullable
// columns are OK and we want the uid present for join consistency).
// --------------------------------------------------------------------

function identityRow(uid, u) {
  return {
    uid,
    display_name: asString(u.displayName),
    avatar: asString(u.avatar),
    email: asString(u.email),
    decoded_email: asString(u.decodedEmail),
    flag: asString(u.flage),
    date_of_birth: asString(u.dateOfBirth),
    os: asString(u.OS),
    created_at_ms: asNumber(u.createdAt),
    last_activity_ms: asNumber(u.lastActivity),
    last_profile_edit_ms: asNumber(u.lastProfileEditAt),
    updated_at: nowIso(),
  };
}

function robloxRow(uid, u) {
  return {
    uid,
    roblox_username: asString(u.robloxUsername),
    roblox_user_id: u.robloxUserId == null ? null : String(u.robloxUserId),
    roblox_username_verified: asBool(u.robloxUsernameVerified),
    updated_at: nowIso(),
  };
}

function rolesRow(uid, u) {
  return {
    uid,
    is_admin: asBool(u.admin),
    is_moderator: asBool(u.isModerator),
    is_baby_mod: asBool(u.isBabyMod),
    is_trusted: asBool(u.isTrusted),
    is_cmsr: asBool(u.isCMSR),
    updated_at: nowIso(),
  };
}

function cosmeticsRow(uid, u) {
  return {
    uid,
    top_badge: asString(u.topBadge),
    is_pro: asBool(u.isPro),
    updated_at: nowIso(),
  };
}

function notificationsRow(uid, u) {
  return {
    uid,
    is_token_invalid: asBool(u.isTokenInvalid),
    mute_trade_notifs: asBool(u.muteTradeNotifs),
    notification_settings: asJsonb(u.notificationSettings),
    updated_at: nowIso(),
  };
}

function settingsRow(uid, u) {
  return {
    uid,
    is_reminder_enabled: asBool(u.isReminderEnabled),
    is_selected_reminder_enabled: asBool(u.isSelectedReminderEnabled),
    updated_at: nowIso(),
  };
}

function badgesRows(uid, u) {
  const m = (u && u.badges) || {};
  const now = Date.now();
  const out = [];
  for (const badgeId of Object.keys(m)) {
    if (m[badgeId] === true) {
      out.push({ uid, badge_id: badgeId, earned_at_ms: now, metadata: null });
    }
  }
  return out;
}

function blocksRows(uid, u) {
  const m = (u && u.blocked_users) || {};
  const now = Date.now();
  const out = [];
  for (const blockedUid of Object.keys(m)) {
    if (m[blockedUid] === true) {
      out.push({ uid, blocked_uid: blockedUid, blocked_at_ms: now });
    }
  }
  return out;
}

// --------------------------------------------------------------------
// Pagination + worker partitioning
// --------------------------------------------------------------------

const PAGE_USERS = parseInt(process.env.PAGE_USERS || '50', 10);  // smaller than chat-meta — /users rows are bigger
const FLUSH_AT = parseInt(process.env.FLUSH_AT || '200', 10);
const RANGE_START = process.env.RANGE_START || null;
const RANGE_END = process.env.RANGE_END || null;
const WORKER_TAG = process.env.WORKER_TAG || '';

const tag = WORKER_TAG ? `[${WORKER_TAG}] ` : '';

// --------------------------------------------------------------------
// Single-blob read — pull the entire /users/{uid} subtree once and
// extract the fields we want client-side.
//
// Earlier version did 27 narrow gets per user (25 leaves + 2 sub-collections)
// to avoid downloading huge shop/inventory subtrees. That made each user
// take ~500ms-1s of round-trip latency. Switching to one read per user
// drops that to ~50-100ms — typically 10x faster — at the cost of pulling
// shop/economy fields we then ignore. Since this is a one-shot backfill
// and bandwidth on read is cheap relative to the per-request overhead,
// the tradeoff is worth it.
//
// The mirror CF is unchanged — it still uses change.after.val() which is
// an entire-row snapshot anyway.
// --------------------------------------------------------------------

async function readNarrowUser(uid) {
  const snap = await admin.database().ref(`users/${uid}`).once('value');
  if (!snap.exists()) return null;
  const u = snap.val() || {};
  // Normalize the two sub-collections we use; everything else stays raw.
  u.badges = u.badges || {};
  u.blocked_users = u.blocked_users || {};
  return u;
}

// --------------------------------------------------------------------
// Upsert with retries — copied verbatim from chat-meta backfill,
// proven to survive transient Supabase edge blips on long runs.
// --------------------------------------------------------------------

async function upsertSlice(table, slice, opts) {
  if (!slice.length) return;
  const delays = [1000, 2000, 4000, 8000, 16000, 30000, 60000, 60000, 60000, 60000];
  let attempt = 0;
  while (true) {
    try {
      const { error } = await supabase.from(table).upsert(slice, opts);
      if (error) throw new Error(error.message);
      return;
    } catch (e) {
      attempt += 1;
      if (attempt > delays.length) {
        console.error(`\n❌ ${table} upsert failed after ${delays.length} retries:`, e.message);
        throw e;
      }
      const wait = delays[attempt - 1];
      process.stdout.write(`\n  ⚠️  ${table} upsert failed (${e.message}). retry ${attempt}/${delays.length} in ${wait}ms…\n`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// --------------------------------------------------------------------
// Main pagination loop — list /users keys page-by-page (key-only first
// to avoid pulling subtrees twice), then narrow-read each one.
// --------------------------------------------------------------------

async function backfillUsers() {
  console.log(`${tag}📥 Backfilling /users (page=${PAGE_USERS}, flush=${FLUSH_AT}, range=${RANGE_START || '∅'}…${RANGE_END || '∅'})`);
  const ref = admin.database().ref('users');

  let lastKey = null;
  let usersSeen = 0;
  let bufIdentity = [];
  let bufRoblox = [];
  let bufRoles = [];
  let bufCosmetics = [];
  let bufNotifications = [];
  let bufSettings = [];
  let bufBadges = [];
  let bufBlocks = [];

  const totals = { identity: 0, roblox: 0, roles: 0, cosmetics: 0, notifications: 0, settings: 0, badges: 0, blocks: 0 };

  async function flushAll(force) {
    const tasks = [];
    if (force || bufIdentity.length >= FLUSH_AT) {
      const slice = bufIdentity; bufIdentity = [];
      tasks.push(upsertSlice('user_identity', slice, { onConflict: 'uid' }).then(() => totals.identity += slice.length));
    }
    if (force || bufRoblox.length >= FLUSH_AT) {
      const slice = bufRoblox; bufRoblox = [];
      tasks.push(upsertSlice('user_roblox', slice, { onConflict: 'uid' }).then(() => totals.roblox += slice.length));
    }
    if (force || bufRoles.length >= FLUSH_AT) {
      const slice = bufRoles; bufRoles = [];
      tasks.push(upsertSlice('user_roles', slice, { onConflict: 'uid' }).then(() => totals.roles += slice.length));
    }
    if (force || bufCosmetics.length >= FLUSH_AT) {
      const slice = bufCosmetics; bufCosmetics = [];
      tasks.push(upsertSlice('user_cosmetics', slice, { onConflict: 'uid' }).then(() => totals.cosmetics += slice.length));
    }
    if (force || bufNotifications.length >= FLUSH_AT) {
      const slice = bufNotifications; bufNotifications = [];
      tasks.push(upsertSlice('user_notifications', slice, { onConflict: 'uid' }).then(() => totals.notifications += slice.length));
    }
    if (force || bufSettings.length >= FLUSH_AT) {
      const slice = bufSettings; bufSettings = [];
      tasks.push(upsertSlice('user_settings', slice, { onConflict: 'uid' }).then(() => totals.settings += slice.length));
    }
    if (force || bufBadges.length >= FLUSH_AT) {
      const slice = bufBadges; bufBadges = [];
      // ignoreDuplicates so re-running the backfill doesn't bump earned_at_ms.
      tasks.push(upsertSlice('user_badges', slice, { onConflict: 'uid,badge_id', ignoreDuplicates: true }).then(() => totals.badges += slice.length));
    }
    if (force || bufBlocks.length >= FLUSH_AT) {
      const slice = bufBlocks; bufBlocks = [];
      tasks.push(upsertSlice('user_blocks', slice, { onConflict: 'uid,blocked_uid', ignoreDuplicates: true }).then(() => totals.blocks += slice.length));
    }
    if (tasks.length) await Promise.all(tasks);
  }

  while (true) {
    // Key-only listing for this page. shallow:true would be ideal but
    // not supported via Admin SDK — workaround: orderByKey with
    // limitToFirst, but we still get values. To avoid pulling massive
    // user blobs in the listing query, we take only KEYS from this
    // shallow-ish read by deliberately ignoring its values (the page
    // payload IS bigger than ideal but still bounded by PAGE_USERS=50).
    let q = ref.orderByKey().limitToFirst(PAGE_USERS + (lastKey ? 1 : 0));
    if (lastKey) {
      q = q.startAt(lastKey);
    } else if (RANGE_START) {
      q = q.startAt(RANGE_START);
    }
    if (RANGE_END) q = q.endAt(RANGE_END);

    const snap = await q.once('value');
    const page = snap.val();
    if (!page) break;

    const allKeys = Object.keys(page);
    const keys = lastKey ? allKeys.filter((k) => k !== lastKey) : allKeys;
    if (keys.length === 0) break;

    // Process this page in parallel — single read per user, bounded by
    // page size. RTDB handles bursts of ~50 concurrent reads fine; the
    // per-page latency drops from sum-of-50 to max-of-50.
    const userBlobs = await Promise.all(
      keys.map(async (uid) => {
        try {
          const u = await readNarrowUser(uid);
          return [uid, u];
        } catch (e) {
          console.error(`${tag}⚠️  Failed read for ${uid}: ${e.message}`);
          return [uid, null];
        }
      }),
    );

    for (const [uid, u] of userBlobs) {
      if (!u) continue;  // deleted between page-list and read, or fetch failed

      bufIdentity.push(identityRow(uid, u));
      bufRoblox.push(robloxRow(uid, u));
      bufRoles.push(rolesRow(uid, u));
      bufCosmetics.push(cosmeticsRow(uid, u));
      bufNotifications.push(notificationsRow(uid, u));
      bufSettings.push(settingsRow(uid, u));
      bufBadges.push(...badgesRows(uid, u));
      bufBlocks.push(...blocksRows(uid, u));

      usersSeen += 1;
      if (usersSeen % 100 === 0) await flushAll(false);
    }

    process.stdout.write(`${tag}users=${usersSeen} flushed=${JSON.stringify(totals)}\n`);

    lastKey = allKeys[allKeys.length - 1];
    if (keys.length < PAGE_USERS) break;
  }

  // Final flush.
  await flushAll(true);

  console.log(`${tag}\n✅ Worker done. users=${usersSeen} totals=${JSON.stringify(totals)}`);
  return { usersSeen, totals };
}

(async () => {
  const t0 = Date.now();
  try {
    await backfillUsers();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${tag}⏱  Elapsed ${secs}s`);
    process.exit(0);
  } catch (e) {
    console.error(`${tag}❌ Backfill failed:`, e?.message || e);
    process.exit(1);
  }
})();
