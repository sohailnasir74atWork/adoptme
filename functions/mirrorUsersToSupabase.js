/**
 * Cloud Function: mirror RTDB /users/{uid} into Supabase split tables.
 *
 * RTDB stays the SOURCE OF TRUTH. The app (and 14 other CFs) keep
 * reading/writing /users/{uid} unchanged. This function tails every
 * /users/{uid} write and fans the relevant fields out to 8 narrow
 * Supabase tables so new clients can read profile data without
 * pulling the full /users blob from RTDB.
 *
 * See:
 *   - supabase/004_users_split.sql                  — schema
 *   - supabase/004_users_split_FIELD_MAPPING.md     — field mapping
 *
 * Trigger: onWrite at /users/{uid} (the whole row), so we capture
 * every field change in one shot. We DON'T trigger per-leaf because
 * (a) it would create 8x more deployments, (b) reading the after-snapshot
 * once per write is already free.
 *
 * Cost note: this fires on EVERY /users write, including hot-path
 * writes to fields we don't mirror (rewardPoints, xp, dailyStars, shop).
 * Those fires no-op cheaply (each per-table function checks if its
 * fields changed and skips if not). Acceptable until measured otherwise.
 *
 * Failure handling: each per-table mirror is independent. If one
 * upsert fails, others still succeed. The next /users write will
 * retry the failed table. No dead-letter queue this phase — same
 * approach as mirrorChatMetaToSupabase.
 *
 * Deployment:
 *   firebase deploy --only functions:mirrorUsersToSupabase
 *   (Secrets SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY already set
 *    for Phase 2; reused here.)
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

const nowIso = () => new Date().toISOString();

const asString = (v) => (typeof v === 'string' ? v : null);
const asBool = (v) => v === true; // strict — RTDB sometimes stores 'true'/1; only literal true counts
const asNumber = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const asJsonb = (v) => (v && typeof v === 'object' ? v : null);

// Did any of the listed leaf keys change between before/after snapshots?
// Used to skip per-table upserts when the changed leaf isn't ours.
function anyKeyChanged(before, after, keys) {
  for (const k of keys) {
    if ((before?.[k] ?? null) !== (after?.[k] ?? null)) return true;
  }
  return false;
}

// Diff two RTDB objects-of-true (`{key1: true, key2: true}`) shape used
// by /users/{uid}/badges and /users/{uid}/blocked_users.
// Returns { toAdd: [keys], toRemove: [keys] } — never touches existing keys
// so earned_at_ms / blocked_at_ms stay stable.
function diffBoolMap(before, after) {
  const beforeKeys = new Set(Object.keys(before || {}));
  const afterKeys = new Set(Object.keys(after || {}));
  const toAdd = [];
  const toRemove = [];
  for (const k of afterKeys) {
    if (!beforeKeys.has(k) && (after[k] === true)) toAdd.push(k);
  }
  for (const k of beforeKeys) {
    if (!afterKeys.has(k)) toRemove.push(k);
  }
  return { toAdd, toRemove };
}

// --------------------------------------------------------------------
// Per-table mirrors
//
// Each takes (uid, before, after, supabase). Returns a Promise that
// resolves whether or not the mirror was needed. Errors are logged
// inside; never throw — we don't want one table failure to block the
// others (Promise.all rejects on first throw).
// --------------------------------------------------------------------

// ── user_identity_base (round 2, 2026-09) ─────────────────────────────
// supabase/031_private_identity.sql renames the table to user_identity_base
// and puts a masking VIEW called user_identity in its place, so every write
// goes to the base table. Until 031 has run the base name does not exist yet —
// fall back to the old name (still a table then), so this deploys safely
// before or after the SQL.
const isMissingRelation = (error) => {
  if (!error) return false;
  if (error.code === 'PGRST205' || error.code === '42P01') return true;
  const msg = error.message || '';
  return /user_identity_base/.test(msg) && /does not exist|schema cache/.test(msg);
};

async function onIdentityTable(supabase, run) {
  const result = await run(supabase.from('user_identity_base'));
  if (!isMissingRelation(result.error)) return result;
  return run(supabase.from('user_identity'));
}

// Email / decodedEmail / dateOfBirth are NOT identity keys any more: they
// live in users_private/{uid}, and mirrorUsersPrivateToSupabase (below) owns
// those three columns. An ordinary identity upsert leaves them out, so it can
// never null them.
const IDENTITY_KEYS = [
  'displayName', 'avatar', 'flage',
  'OS', 'createdAt', 'lastActivity', 'lastProfileEditAt',
];

const identityColumns = (u) => ({
  display_name: asString(u.displayName),
  avatar: asString(u.avatar),
  flag: asString(u.flage),               // typo fix: flage → flag
  os: asString(u.OS),
  created_at_ms: asNumber(u.createdAt),
  last_activity_ms: asNumber(u.lastActivity),
  last_profile_edit_ms: asNumber(u.lastProfileEditAt),
});

// Legacy copies that pre-round-2 builds still write to users/{uid}. Until
// privatizeUserPII is deployed (cutover) nothing moves them to users_private,
// and the Supabase safe-chat trigger (028) needs the DOB of every account an
// old build creates in the meantime — so a legacy value being WRITTEN still
// reaches the private columns. users_private wins wherever it has the field:
// its DOB is write-once, and an old build re-entering a different DOB must not
// overwrite it here.
const LEGACY_PII_KEYS = ['email', 'decodedEmail', 'dateOfBirth'];

const normalizeEmail = (v) => {
  if (typeof v !== 'string') return null;
  const e = v.trim().replace(/\(dot\)/g, '.').replace(/,/g, '.').toLowerCase();
  return e.includes('@') ? e : null;
};

// Private columns for an identity upsert: users_private first, then a legacy
// users/{uid} value for whatever users_private lacks — but only a value the
// account's owner wrote (users/$userId lets any signed-in user write another
// user's non-role fields, and a planted DOB or email must never reach the
// safe-chat trigger or the ban tools). Only columns with a value are returned.
async function privateColumns(uid, after, byOwner) {
  let priv = {};
  try {
    priv = (await admin.database().ref(`users_private/${uid}`).once('value')).val() || {};
  } catch (e) {
    console.error('[mirrorUsers/identity] users_private read failed', uid, e.message);
  }
  const cols = {};
  const legacy = byOwner ? after : {};
  const email = normalizeEmail(priv.email) || normalizeEmail(legacy.email) || normalizeEmail(legacy.decodedEmail);
  if (email) {
    cols.email = email;
    cols.decoded_email = email;
  }
  const dob = asString(priv.dateOfBirth) || asString(legacy.dateOfBirth);
  if (dob) cols.date_of_birth = dob;
  return cols;
}

async function mirrorIdentity(uid, before, after, supabase, isCreate = false, byOwner = false) {
  const identityChanged = anyKeyChanged(before, after, IDENTITY_KEYS);
  // Only a legacy value being WRITTEN, by the owner, counts. privatizeUserPII /
  // the migration REMOVING one must not cost an upsert per user.
  const legacyPiiChanged = byOwner && LEGACY_PII_KEYS.some(
    (k) => after?.[k] != null && (before?.[k] ?? null) !== after[k],
  );
  if (!identityChanged && !legacyPiiChanged) return;

  const row = { uid, ...identityColumns(after), updated_at: nowIso() };
  // On account creation users_private may already hold the email (new builds
  // write both at sign-up, in either order) — mirrorUsersPrivateToSupabase
  // skips a uid with no users/{uid} yet, so this is where those columns land.
  if (isCreate || legacyPiiChanged) Object.assign(row, await privateColumns(uid, after, byOwner));

  const { error } = await onIdentityTable(supabase, (t) => t.upsert(row, { onConflict: 'uid' }));
  if (error) console.error('[mirrorUsers/identity]', uid, error.message);
}

const ROBLOX_KEYS = ['robloxUsername', 'robloxUserId', 'robloxUsernameVerified'];
async function mirrorRoblox(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, ROBLOX_KEYS)) return;

  const row = {
    uid,
    roblox_username: asString(after.robloxUsername),
    // RTDB stores robloxUserId as either string or number historically — coerce.
    roblox_user_id:
      after.robloxUserId == null ? null : String(after.robloxUserId),
    roblox_username_verified: asBool(after.robloxUsernameVerified),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_roblox')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/roblox]', uid, error.message);
}

// `rolesUpdatedAt` is a stamp the admin UI writes alongside every role change
// (2026-09-04). It guarantees this mirror runs even when the flag's VALUE is
// unchanged — e.g. an admin re-removing a role whose Supabase copy went stale
// while this function was down. Without it a repeat removal is a no-op write,
// fires no trigger, and the stale `true` in user_roles lives forever.
const ROLES_KEYS = ['admin', 'isModerator', 'isBabyMod', 'isTrusted', 'isCMSR', 'isArtCMSR', 'isHelper', 'rolesUpdatedAt'];
// `isCreate` (2026-09-02, cost): an ordinary user never has ANY role key set,
// so anyKeyChanged() was always false and NO user_roles row was ever written
// for them. getRoles() then returned null on every client, and BottomDrawer's
// `!rolesRow` fallback fired six RTDB leaf reads on every profile-drawer open
// — ~172k reads/day, and the six role paths were the top read paths in the
// profiler by a factor of ~7 over isPro. Writing an all-false row at account
// creation makes the row exist, so the fallback stops being the common path.
// Existing users need the one-off backfill: scripts/backfill-user-roles.js.
// See COST_OPTIMIZATION_2026-09.md F4.
async function mirrorRoles(uid, before, after, supabase, isCreate = false) {
  if (!isCreate && !anyKeyChanged(before, after, ROLES_KEYS)) return;

  const row = {
    uid,
    is_admin: asBool(after.admin),             // rename: admin → is_admin
    is_moderator: asBool(after.isModerator),
    is_baby_mod: asBool(after.isBabyMod),
    is_trusted: asBool(after.isTrusted),
    is_cmsr: asBool(after.isCMSR),
    is_art_cmsr: asBool(after.isArtCMSR),     // 042_art_cmsr.sql
    is_helper: asBool(after.isHelper),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_roles')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/roles]', uid, error.message);
}

const COSMETICS_KEYS = ['topBadge', 'isPro'];
// Active shop items mirrored as jsonb so the client (profileCache) can
// do its own expiresAt check without us needing a re-mirror at expiry.
const ACTIVE_ITEM_KEYS = ['profileFrame', 'chatTextColor', 'tradeCardBg', 'profileBanner', 'chatBubbleBg'];

function activeItemsChanged(before, after) {
  const beforeItems = before?.shop?.activeItems || {};
  const afterItems  = after?.shop?.activeItems  || {};
  for (const k of ACTIVE_ITEM_KEYS) {
    // Active items are OBJECTS ({expiresAt, color, ...}); `!==` compared object
    // identity, which is always different between the before/after snapshots,
    // so every /users write for a user with any cosmetic re-upserted the row
    // (11 M needless user_cosmetics updates measured 2026-09). Compare by value.
    if (JSON.stringify(beforeItems[k] ?? null) !== JSON.stringify(afterItems[k] ?? null)) return true;
  }
  return false;
}

async function mirrorCosmetics(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, COSMETICS_KEYS) && !activeItemsChanged(before, after)) return;

  const activeItems = after?.shop?.activeItems || {};
  const row = {
    uid,
    top_badge: asString(after.topBadge),
    is_pro: asBool(after.isPro),
    profile_frame:   asJsonb(activeItems.profileFrame),
    chat_text_color: asJsonb(activeItems.chatTextColor),
    trade_card_bg:   asJsonb(activeItems.tradeCardBg),
    profile_banner:  asJsonb(activeItems.profileBanner),
    chat_bubble_bg:  asJsonb(activeItems.chatBubbleBg),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_cosmetics')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/cosmetics]', uid, error.message);
}

const NOTIFICATIONS_KEYS = ['isTokenInvalid', 'muteTradeNotifs', 'notificationSettings'];
async function mirrorNotifications(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, NOTIFICATIONS_KEYS)) return;

  const row = {
    uid,
    is_token_invalid: asBool(after.isTokenInvalid),
    mute_trade_notifs: asBool(after.muteTradeNotifs),
    notification_settings: asJsonb(after.notificationSettings),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_notifications')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/notifications]', uid, error.message);
}

const SETTINGS_KEYS = ['isReminderEnabled', 'isSelectedReminderEnabled', 'chatOffTrade', 'chatOffGeneral'];
async function mirrorSettings(uid, before, after, supabase) {
  if (!anyKeyChanged(before, after, SETTINGS_KEYS)) return;

  const row = {
    uid,
    is_reminder_enabled: asBool(after.isReminderEnabled),
    is_selected_reminder_enabled: asBool(after.isSelectedReminderEnabled),
    // Chat-availability switches — mirrored so the private_messages insert
    // trigger can reject blocked messages regardless of the sender's app version.
    chat_off_trade: asBool(after.chatOffTrade),
    chat_off_general: asBool(after.chatOffGeneral),
    updated_at: nowIso(),
  };

  const { error } = await supabase
    .from('user_settings')
    .upsert(row, { onConflict: 'uid' });
  if (error) console.error('[mirrorUsers/settings]', uid, error.message);
}

// Badges + blocks use the diff-then-add/remove strategy so we don't
// rewrite earned_at_ms / blocked_at_ms on every parent write.
async function mirrorBadges(uid, before, after, supabase) {
  const beforeBadges = (before && before.badges) || {};
  const afterBadges = (after && after.badges) || {};
  // Quick equality short-circuit. Most /users writes don't touch badges.
  if (beforeBadges === afterBadges) return;
  const { toAdd, toRemove } = diffBoolMap(beforeBadges, afterBadges);
  if (toAdd.length === 0 && toRemove.length === 0) return;

  const now = Date.now();
  if (toAdd.length > 0) {
    const rows = toAdd.map((badge_id) => ({
      uid,
      badge_id,
      earned_at_ms: now,
      metadata: null,
    }));
    const { error } = await supabase
      .from('user_badges')
      .upsert(rows, { onConflict: 'uid,badge_id', ignoreDuplicates: true });
    if (error) console.error('[mirrorUsers/badges add]', uid, error.message);
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('user_badges')
      .delete()
      .eq('uid', uid)
      .in('badge_id', toRemove);
    if (error) console.error('[mirrorUsers/badges remove]', uid, error.message);
  }
}

async function mirrorBlocks(uid, before, after, supabase) {
  const beforeBlocks = (before && before.blocked_users) || {};
  const afterBlocks = (after && after.blocked_users) || {};
  if (beforeBlocks === afterBlocks) return;
  const { toAdd, toRemove } = diffBoolMap(beforeBlocks, afterBlocks);
  if (toAdd.length === 0 && toRemove.length === 0) return;

  const now = Date.now();
  if (toAdd.length > 0) {
    const rows = toAdd.map((blocked_uid) => ({
      uid,
      blocked_uid,
      blocked_at_ms: now,
    }));
    const { error } = await supabase
      .from('user_blocks')
      .upsert(rows, { onConflict: 'uid,blocked_uid', ignoreDuplicates: true });
    if (error) console.error('[mirrorUsers/blocks add]', uid, error.message);
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('uid', uid)
      .in('blocked_uid', toRemove);
    if (error) console.error('[mirrorUsers/blocks remove]', uid, error.message);
  }
}

// --------------------------------------------------------------------
// Mods roster (RTDB mods/{uid}) — absorbed from syncModRoster so the
// roster rides THIS function's invocation instead of a second CF
// triggering on every /users/{uid} write. After deploying this, delete
// the old trigger:  firebase functions:delete syncModRoster
// (keep seedModRoster — it's the separate scheduled seeder).
// --------------------------------------------------------------------
async function mirrorModsRoster(uid, before, after) {
  const relevantFields = ['isModerator', 'isBabyMod', 'displayName', 'avatar'];
  if (before && !anyKeyChanged(before, after, relevantFields)) return;

  const isMod = after.isModerator === true;
  const isJmod = after.isBabyMod === true;
  // On account creation `before` is null, which skips the guard above — so a
  // brand-new ordinary user used to fall through to the ref.remove() below and
  // issue a pointless RTDB delete against a node that never existed. Nothing to
  // do here unless they actually hold a role. (2026-09-02)
  if (!before && !isMod && !isJmod) return;
  const ref = admin.database().ref(`mods/${uid}`);
  try {
    if (isMod || isJmod) {
      await ref.set({
        displayName: after.displayName || 'Unknown',
        avatar: after.avatar || '',
        role: isMod ? 'mod' : 'jmod',
        updatedAt: Date.now(),
      });
    } else {
      await ref.remove();
    }
  } catch (e) {
    console.error('[mirrorUsers/modsRoster]', uid, e.message);
  }
}

// On full /users/{uid} delete, drop rows from all 8 tables.
// Each delete is independent — if one fails, the others still go.
async function deleteAllForUser(uid, supabase) {
  const { error: identityError } = await onIdentityTable(supabase, (t) => t.delete().eq('uid', uid));
  if (identityError) console.error('[mirrorUsers/delete user_identity_base]', uid, identityError.message);
  const tables = [
    'user_roblox',
    'user_roles',
    'user_cosmetics',
    'user_notifications',
    'user_settings',
    'user_badges',
    'user_blocks',
  ];
  await Promise.all(
    tables.map(async (t) => {
      const { error } = await supabase.from(t).delete().eq('uid', uid);
      if (error) console.error(`[mirrorUsers/delete ${t}]`, uid, error.message);
    }),
  );
}

// --------------------------------------------------------------------
// Trigger
// --------------------------------------------------------------------

exports.mirrorUsersToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '512MB',     // bigger than chat-meta — we read the full /users row
    timeoutSeconds: 60,
  })
  .database.ref('/users/{uid}')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    const supabase = getSupabaseAdmin();

    // Full delete — propagate to every table + the mods roster. Account
    // deletion removes users/{uid}; the email / DOB in users_private/{uid}
    // (round 2) must go with it — the owner's own client can't delete that
    // node (rules), so it happens here.
    if (!change.after.exists()) {
      await Promise.all([
        deleteAllForUser(uid, supabase),
        admin.database().ref(`mods/${uid}`).remove().catch(() => {}),
        admin.database().ref(`users_private/${uid}`).remove().catch(() => {}),
      ]);
      return null;
    }

    const isCreate = !change.before.exists();
    const before = change.before.exists() ? change.before.val() : {};
    const after = change.after.val() || {};
    // The owner's own client or the Admin SDK — not another user writing into
    // this record (see privateColumns).
    const byOwner = context.authType === 'ADMIN' || context.auth?.uid === uid;

    // Run all per-table mirrors in parallel. Each catches its own errors
    // and logs — wrapping in Promise.allSettled would be belt-and-braces
    // but Promise.all is fine because no mirror function ever throws.
    await Promise.all([
      mirrorIdentity(uid, before, after, supabase, isCreate, byOwner),
      mirrorRoblox(uid, before, after, supabase),
      mirrorRoles(uid, before, after, supabase, isCreate),
      mirrorCosmetics(uid, before, after, supabase),
      mirrorNotifications(uid, before, after, supabase),
      mirrorSettings(uid, before, after, supabase),
      mirrorBadges(uid, before, after, supabase),
      mirrorBlocks(uid, before, after, supabase),
      mirrorModsRoster(uid, change.before.exists() ? before : null, after),
    ]);

    return null;
  });

// --------------------------------------------------------------------
// users_private/{uid} → user_identity_base (round 2, 2026-09)
//
// users_private holds { email, dateOfBirth } — owner + staff only
// (database.rules.json). This trigger owns the three private columns of
// user_identity_base; the user_identity VIEW (031) shows them to the owner
// and staff only. email and decoded_email both get the canonical form
// (lowercased, real dots), which is what every reader decodes to anyway.
//
// Deployable early, together with 031 and the mirror change above: nothing
// writes users_private until then except new builds, the website and the
// migration script.
//
// Deployment:
//   firebase deploy --only functions:mirrorUsersToSupabase,functions:mirrorUsersPrivateToSupabase --project adoptme-7b50c
// --------------------------------------------------------------------

const PRIVATE_KEYS = ['email', 'dateOfBirth'];

exports.mirrorUsersPrivateToSupabase = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '128MB',     // two small leaves
    timeoutSeconds: 30,
  })
  .database.ref('/users_private/{uid}')
  .onWrite(async (change, context) => {
    const { uid } = context.params;
    const supabase = getSupabaseAdmin();

    // Node removed (account deletion above, or an admin fix): clear the
    // columns. update(), not upsert — never create a row for a deleted user.
    if (!change.after.exists()) {
      const { error } = await onIdentityTable(supabase, (t) => t
        .update({ email: null, decoded_email: null, date_of_birth: null, updated_at: nowIso() })
        .eq('uid', uid));
      if (error) console.error('[mirrorUsersPrivate/clear]', uid, error.message);
      return null;
    }

    const before = change.before.exists() ? change.before.val() || {} : {};
    const after = change.after.val() || {};
    if (!anyKeyChanged(before, after, PRIVATE_KEYS)) return null;

    // Only columns with a value: a missing field must not null what the
    // legacy path (mirrorIdentity) already put there.
    const cols = {};
    const email = normalizeEmail(after.email);
    if (email) {
      cols.email = email;
      cols.decoded_email = email;
    }
    const dob = asString(after.dateOfBirth);
    if (dob) cols.date_of_birth = dob;
    if (!cols.email && !cols.date_of_birth) return null;

    // Update in place. NEVER create a row holding only these columns: the
    // app's login (every build) treats an existing identity row as the
    // profile, and one with no display_name / created_at_ms makes it
    // "self-heal" — renaming the user and overwriting users/{uid}/createdAt.
    const updated = await onIdentityTable(supabase, (t) => t
      .update({ ...cols, updated_at: nowIso() })
      .eq('uid', uid)
      .select('uid'));
    if (updated.error) {
      console.error('[mirrorUsersPrivate]', uid, updated.error.message);
      return null;
    }
    if (updated.data && updated.data.length > 0) return null;

    // No identity row yet: build the whole row from users/{uid}. If that node
    // doesn't exist yet either (sign-up wrote users_private first),
    // mirrorIdentity picks these columns up when users/{uid} is created.
    const leaves = await Promise.all(
      IDENTITY_KEYS.map((k) => admin.database().ref(`users/${uid}/${k}`).once('value').then((s) => s.val()).catch(() => null)),
    );
    if (leaves.every((v) => v == null)) return null;
    const u = {};
    IDENTITY_KEYS.forEach((k, i) => { u[k] = leaves[i]; });

    const { error } = await onIdentityTable(supabase, (t) => t.upsert(
      { uid, ...identityColumns(u), ...cols, updated_at: nowIso() },
      { onConflict: 'uid' },
    ));
    if (error) console.error('[mirrorUsersPrivate/create]', uid, error.message);
    return null;
  });
