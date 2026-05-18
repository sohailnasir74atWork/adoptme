// User profile backend — Supabase mirror of the RTDB /users/{uid} subtree
// split across 8 tables (user_identity, user_roblox, user_roles,
// user_cosmetics, user_notifications, user_settings, user_badges,
// user_blocks). See supabase/004_users_split.sql + the field mapping doc.
//
// READ-ONLY from the client. RTDB stays the source of truth for /users —
// the app keeps writing to /users/{uid} as today, mirrorUsersToSupabase
// (Cloud Function) tails those writes and upserts here. This module only
// provides reads, so flipping a caller from RTDB→Supabase is a one-line
// transport change without touching any write paths or the 7 RTDB-trigger
// CFs that depend on /users.
//
// Wave 1: getIdentity (displayName, avatar, ...).
// Wave 2: getRoles (is_admin/is_moderator/...) + getCosmetics (is_pro, top_badge).
// Wave 3: getSettings + getNotifications (reminder toggles, mute_trade_notifs,
//         is_token_invalid, notification_settings JSONB).
// Wave 4: getBlocks (Set<blockedUid>) + getBadges (Map<badgeId, {...}>).
//
// Convention: snake_case on the wire, camelCase shape returned to callers
// (matches what existing UI code already consumes from RTDB).
//
// Only fcmToken stays on RTDB this phase — every notification CF reads it
// directly. Everything else under /users/{uid} is in Supabase now.

import { supabase } from './client';

// -----------------------------------------------------------------
// Row mappers — DB snake_case → UI camelCase
// -----------------------------------------------------------------

export function fromIdentityRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    displayName: row.display_name ?? null,
    avatar: row.avatar ?? null,
    email: row.email ?? null,
    decodedEmail: row.decoded_email ?? null,
    flag: row.flag ?? null,
    dateOfBirth: row.date_of_birth ?? null,
    OS: row.os ?? null,
    createdAt: row.created_at_ms ?? null,
    lastActivity: row.last_activity_ms ?? null,
    lastProfileEditAt: row.last_profile_edit_ms ?? null,
  };
}

// -----------------------------------------------------------------
// Single-uid identity read.
//
// Returns null on not-found OR on Supabase error — callers must treat
// null as "fall back to RTDB" rather than "user doesn't exist". This
// matches the failure mode of the current RTDB getOrFetchProfile,
// which also returns null on missing/error and lets the caller decide.
// -----------------------------------------------------------------
export async function getIdentity(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_identity')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    // Don't spam logs in normal "not found" case (PGRST116 is no-rows).
    if (error.code !== 'PGRST116') {
      console.warn('[userBackend] getIdentity error:', error.message);
    }
    return null;
  }
  return fromIdentityRow(data);
}

// -----------------------------------------------------------------
// Batch identity read — for warmProfileCache and any future bulk
// "fetch N senders for a chat page" path. Single round-trip, far
// cheaper than N parallel RTDB reads.
//
// Input:  array of uids (deduped internally)
// Output: Map<uid, identity> — only contains entries that existed
//         in Supabase. Missing uids omitted (callers fall back to
//         RTDB per-uid for those).
// -----------------------------------------------------------------
export async function getIdentityBatch(uids) {
  return _batchByUid('user_identity', uids, fromIdentityRow);
}

// -----------------------------------------------------------------
// Identity search — replaces RTDB orderByChild('displayName')/email
// + 500-row broad-scan fallback that powered OnlineUsersList's
// "invite offline user" picker. ilike does case-insensitive contains
// in one query, no variant-permutation or client-side filtering.
// -----------------------------------------------------------------
export async function searchIdentityByName(term, limit = 50) {
  if (!term || term.trim().length < 2) return [];
  const { data, error } = await supabase
    .from('user_identity')
    .select('*')
    .ilike('display_name', `%${term.trim()}%`)
    .limit(limit);
  if (error) {
    console.warn('[userBackend] searchIdentityByName error:', error.message);
    return [];
  }
  return (data || []).map(fromIdentityRow).filter(Boolean);
}

// Email lookup. Three exact-match queries in parallel:
//   - uid (legacy users whose RTDB key IS the encoded email)
//   - email
//   - decoded_email
// Caller may pass either real form (foo@bar.com) or RTDB-encoded form
// (foo(dot)bar(dot)com); we normalize both ways before querying.
export async function searchIdentityByEmail(emailOrEncoded, limit = 10) {
  if (!emailOrEncoded) return [];
  const raw = emailOrEncoded.trim().toLowerCase();
  const decoded = raw.replace(/\(dot\)/g, '.');
  const encoded = decoded.replace(/\./g, '(dot)');
  const results = await Promise.all([
    supabase.from('user_identity').select('*').eq('uid', encoded).limit(1),
    supabase.from('user_identity').select('*').eq('email', decoded).limit(limit),
    supabase.from('user_identity').select('*').eq('decoded_email', decoded).limit(limit),
  ]);
  const merged = new Map();
  for (const { data, error } of results) {
    if (error) continue;
    for (const row of data || []) {
      const mapped = fromIdentityRow(row);
      if (mapped && !merged.has(mapped.uid)) merged.set(mapped.uid, mapped);
    }
  }
  return Array.from(merged.values());
}

// -----------------------------------------------------------------
// Role rosters — leaderboard "Trusted" / "CMSR" tabs used to read
// RTDB /trusted and /cmsr nodes (maintained by sync CFs). With Phase
// 4 mirroring complete, the same set is queryable directly from
// user_roles (sparse partial indexes on is_trusted / is_cmsr already
// exist per supabase/004_users_split.sql). Two-step: pick uids by
// role flag, then getIdentityBatch for displayName/avatar. Returns
// rows shaped the same way the LeaderboardScreen UI already expects.
// -----------------------------------------------------------------
async function _getRoster(roleColumn, { limit, offset } = {}) {
  const lim = Number.isFinite(limit) && limit > 0 ? limit : 25;
  const off = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const { data, error } = await supabase
    .from('user_roles')
    .select(`uid, updated_at`)
    .eq(roleColumn, true)
    .order('updated_at', { ascending: false })
    .range(off, off + lim - 1);
  if (error) {
    console.warn(`[userBackend] _getRoster(${roleColumn}) error:`, error.message);
    return [];
  }
  const rows = data || [];
  if (rows.length === 0) return [];

  const uids = rows.map((r) => r.uid).filter(Boolean);
  const identityMap = await getIdentityBatch(uids).catch(() => new Map());

  const roleLabel = roleColumn === 'is_trusted' ? 'trusted'
    : roleColumn === 'is_cmsr' ? 'cmsr'
    : roleColumn;

  return rows.map((r) => {
    const ident = identityMap.get(r.uid);
    return {
      userId: r.uid,
      displayName: ident?.displayName || 'Unknown',
      avatar: ident?.avatar || null,
      role: roleLabel,
      updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0,
    };
  });
}

// Paginated. Caller passes { limit, offset }; result length < limit means
// no more pages. Order is updated_at desc (most recently promoted first).
export async function getTrustedRoster(opts = {}) {
  return _getRoster('is_trusted', opts);
}

export async function getCmsrRoster(opts = {}) {
  return _getRoster('is_cmsr', opts);
}

export async function getHelperRoster(opts = {}) {
  return _getRoster('is_helper', opts);
}

// =================================================================
// WAVE 2 — roles + cosmetics
// =================================================================

export function fromRolesRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    isAdmin: !!row.is_admin,
    isModerator: !!row.is_moderator,
    isBabyMod: !!row.is_baby_mod,
    isTrusted: !!row.is_trusted,
    isCMSR: !!row.is_cmsr,
    isHelper: !!row.is_helper,
  };
}

export function fromCosmeticsRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    topBadge: row.top_badge ?? null,
    isPro: !!row.is_pro,
  };
}

export async function getRoles(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_roles')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') {
      console.warn('[userBackend] getRoles error:', error.message);
    }
    return null;
  }
  return fromRolesRow(data);
}

export async function getCosmetics(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_cosmetics')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') {
      console.warn('[userBackend] getCosmetics error:', error.message);
    }
    return null;
  }
  return fromCosmeticsRow(data);
}

export async function getRolesBatch(uids) {
  return _batchByUid('user_roles', uids, fromRolesRow);
}

export async function getCosmeticsBatch(uids) {
  return _batchByUid('user_cosmetics', uids, fromCosmeticsRow);
}

// =================================================================
// WAVE 2b — roblox
// Public-read. Used by chat headers, online list, social dashboard.
// =================================================================

export function fromRobloxRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    robloxUsername: row.roblox_username ?? null,
    robloxUserId: row.roblox_user_id ?? null,
    robloxUsernameVerified: !!row.roblox_username_verified,
  };
}

export async function getRoblox(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_roblox')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') {
      console.warn('[userBackend] getRoblox error:', error.message);
    }
    return null;
  }
  return fromRobloxRow(data);
}

export async function getRobloxBatch(uids) {
  return _batchByUid('user_roblox', uids, fromRobloxRow);
}

// =================================================================
// WAVE 3 — settings + notifications
//
// Both tables are owner-only in RLS (see 004_users_split.sql) — only the
// authenticated firebase_uid() can read its own row. So no batch flavour:
// nobody else can read these anyway, and we never need to look them up
// for other users.
// =================================================================

export function fromSettingsRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    isReminderEnabled: !!row.is_reminder_enabled,
    isSelectedReminderEnabled: !!row.is_selected_reminder_enabled,
  };
}

export function fromNotificationsRow(row) {
  if (!row) return null;
  return {
    uid: row.uid,
    isTokenInvalid: !!row.is_token_invalid,
    muteTradeNotifs: !!row.mute_trade_notifs,
    // notification_settings is JSONB. Pass through as-is so callers see
    // the same shape RTDB returned ({ notifyMessages, notifyGroupMessages,
    // groupChatNotifications, ... } — keys vary).
    notificationSettings: row.notification_settings ?? null,
  };
}

export async function getSettings(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') {
      console.warn('[userBackend] getSettings error:', error.message);
    }
    return null;
  }
  return fromSettingsRow(data);
}

export async function getNotifications(uid) {
  if (!uid) return null;
  const { data, error } = await supabase
    .from('user_notifications')
    .select('*')
    .eq('uid', uid)
    .maybeSingle();
  if (error) {
    if (error.code !== 'PGRST116') {
      console.warn('[userBackend] getNotifications error:', error.message);
    }
    return null;
  }
  return fromNotificationsRow(data);
}

// =================================================================
// WAVE 4 — blocks + badges (relational tables — multi-row per uid)
//
// user_blocks  is owner-only RLS (only the blocker reads their own list).
// user_badges  is public-read (chat / drawer renders other users' badges).
// =================================================================

// Returns Set<blockedUid> for the given uid. Empty Set on miss.
export async function getBlocks(uid) {
  if (!uid) return new Set();
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_uid')
    .eq('uid', uid);
  if (error) {
    console.warn('[userBackend] getBlocks error:', error.message);
    return null; // null signals "fall back to RTDB" — empty Set is a real result
  }
  const out = new Set();
  for (const row of data || []) {
    if (row?.blocked_uid) out.add(row.blocked_uid);
  }
  return out;
}

// Returns Map<badgeId, { earnedAtMs, metadata }> for the given uid.
// Empty Map on miss.
export async function getBadges(uid) {
  if (!uid) return new Map();
  const { data, error } = await supabase
    .from('user_badges')
    .select('badge_id, earned_at_ms, metadata')
    .eq('uid', uid);
  if (error) {
    console.warn('[userBackend] getBadges error:', error.message);
    return null; // null signals "fall back to RTDB"
  }
  const out = new Map();
  for (const row of data || []) {
    if (!row?.badge_id) continue;
    out.set(row.badge_id, {
      earnedAtMs: row.earned_at_ms ?? null,
      metadata: row.metadata ?? null,
    });
  }
  return out;
}

// Batch: Map<uid, Map<badgeId, {...}>>. Used by leaderboard / drawer
// when showing badges for a list of users in one round-trip.
export async function getBadgesBatch(uids) {
  const result = new Map();
  if (!Array.isArray(uids) || uids.length === 0) return result;

  const dedup = [...new Set(uids.filter(Boolean))];
  if (dedup.length === 0) return result;

  const CHUNK = 200;
  for (let i = 0; i < dedup.length; i += CHUNK) {
    const slice = dedup.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from('user_badges')
      .select('uid, badge_id, earned_at_ms, metadata')
      .in('uid', slice);
    if (error) {
      console.warn('[userBackend] getBadgesBatch chunk failed:', error.message);
      continue;
    }
    for (const row of data || []) {
      if (!row?.uid || !row?.badge_id) continue;
      let inner = result.get(row.uid);
      if (!inner) {
        inner = new Map();
        result.set(row.uid, inner);
      }
      inner.set(row.badge_id, {
        earnedAtMs: row.earned_at_ms ?? null,
        metadata: row.metadata ?? null,
      });
    }
  }
  return result;
}

// =================================================================
// Internal helper — generic batch-by-uid reader.
// All migrated tables share the (uid PK, multi-row IN(...)) shape,
// so we factor the chunk-and-merge logic out instead of duplicating
// it per table.
// =================================================================
async function _batchByUid(table, uids, mapRow) {
  const result = new Map();
  if (!Array.isArray(uids) || uids.length === 0) return result;

  const dedup = [...new Set(uids.filter(Boolean))];
  if (dedup.length === 0) return result;

  // Supabase URL length caps us around ~500 ids per .in() (URL-encoded).
  // Chunk to be safe.
  const CHUNK = 200;
  for (let i = 0; i < dedup.length; i += CHUNK) {
    const slice = dedup.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .in('uid', slice);
    if (error) {
      console.warn(`[userBackend] _batchByUid(${table}) chunk failed:`, error.message);
      continue; // partial result is fine — caller falls back per-uid
    }
    for (const row of data || []) {
      const mapped = mapRow(row);
      if (mapped) result.set(mapped.uid, mapped);
    }
  }
  return result;
}
