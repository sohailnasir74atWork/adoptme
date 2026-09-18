// Moderation audit log — client access to public.mod_actions (029).
//
// WHY THIS EXISTS
// RTDB keeps ONE live record per banned email
// (banned_users_by_email/{encodedEmail}), written with set(). Every mute,
// strike and ban overwrites the last one, and an unban deletes it. That
// record is the ENFORCEMENT state and it stays exactly as it is — old app
// builds in the field read it. What it can never be is a history, which
// is why the dashboard's "Strike History" only ever had one row in it.
//
// This module is the history side: append-only rows in Supabase.
//
// COST RULES THIS MODULE KEEPS (see 029_mod_actions.sql for the full note)
//  * No realtime subscription. Ever. Realtime messages are the biggest
//    Supabase line item on the sibling projects; a mod log has no reason
//    to push.
//  * Reads are rpc calls that aggregate/paginate server-side, so we never
//    download rows to count them client-side.
//  * Rows carry denormalized actor/target names, so rendering a timeline
//    costs zero extra RTDB profile reads.
//  * logModAction NEVER throws and is never awaited on the moderation
//    path — a log failure must not fail or slow down a real ban.

import { supabase } from './client';

const MOD_ACTIONS = 'mod_actions';

// RTDB stores emails encoded as `name(dot)domain(dot)tld`, and the ban
// write path lowercases. Normalise both shapes to one canonical form so a
// record written from any call site is findable from any other — the
// dashboard's missing .toLowerCase() on read is precisely what made
// strike history come back empty for users with a capital in their email.
export const normalizeEmail = (email) => {
  if (!email || typeof email !== 'string') return null;
  const decoded = email.replace(/\(dot\)/g, '.');
  const clean = decoded.trim().toLowerCase();
  return clean.length > 0 ? clean : null;
};

// Maps the client's role flags onto the enum the table accepts.
export const resolveActorRole = ({ isAdmin, isModerator, isBabyMod } = {}) => {
  if (isAdmin) return 'admin';
  if (isModerator) return 'moderator';
  if (isBabyMod) return 'baby_mod';
  return null;
};

/**
 * Append one moderation action to the log.
 *
 * Fire-and-forget by design: callers should NOT await this on the
 * moderation path. It resolves to true/false and never rejects, so a
 * Supabase outage, an RLS refusal, or an offline device degrades to
 * "the ban worked but wasn't logged" rather than "the ban failed".
 *
 * @param {object}  entry
 * @param {string}  entry.action        'mute' | 'strike' | 'ban' | 'unban'
 * @param {string}  entry.targetEmail   required — any encoding/casing
 * @param {string} [entry.targetUid]
 * @param {string} [entry.targetName]
 * @param {string} [entry.reason]
 * @param {number} [entry.strikeCount]
 * @param {number} [entry.durationMinutes]  mute only
 * @param {number|'permanent'} [entry.bannedUntil]
 * @param {string} [entry.actorUid]
 * @param {string} [entry.actorName]
 * @param {string} [entry.actorRole]    'admin' | 'moderator' | 'baby_mod' | 'system'
 * @param {string} [entry.source]       'admin_dashboard' | 'group_chat' | 'report' | 'auto'
 * @returns {Promise<boolean>}
 */
export const logModAction = async (entry = {}) => {
  try {
    const targetEmail = normalizeEmail(entry.targetEmail);
    const action = entry.action;

    // Bad input is a caller bug, not a runtime failure — swallow it the
    // same way, but say so in the console so it surfaces in development.
    if (!targetEmail || !['mute', 'strike', 'ban', 'unban'].includes(action)) {
      console.warn('[modLog] skipped — invalid entry', { action, targetEmail });
      return false;
    }

    const isPermanent = entry.bannedUntil === 'permanent';
    const bannedUntilMs =
      typeof entry.bannedUntil === 'number' && Number.isFinite(entry.bannedUntil)
        ? Math.round(entry.bannedUntil)
        : null;

    // `reason` has been arriving as a boolean from one call site (the
    // dashboard passed isStaff into the customReason slot), which wrote
    // `true` into the record and rendered as a blank reason. Coerce
    // defensively so the log can never inherit that shape.
    const rawReason = entry.reason;
    const reason =
      typeof rawReason === 'string' && rawReason.trim().length > 0
        ? rawReason.trim().slice(0, 500)
        : null;

    const row = {
      action,
      target_email: targetEmail,
      target_uid: entry.targetUid || null,
      target_name: entry.targetName || null,
      reason,
      strike_count: Number.isFinite(entry.strikeCount) ? entry.strikeCount : null,
      duration_minutes: Number.isFinite(entry.durationMinutes) ? entry.durationMinutes : null,
      banned_until_ms: bannedUntilMs,
      is_permanent: isPermanent,
      actor_uid: entry.actorUid || null,
      actor_name: entry.actorName || null,
      actor_role: entry.actorRole || null,
      source: entry.source || 'unknown',
    };

    const { error } = await supabase.from(MOD_ACTIONS).insert(row);
    if (error) {
      console.warn('[modLog] insert failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[modLog] insert threw:', err?.message);
    return false;
  }
};

// True when Postgres is telling us the table or rpc simply does not exist
// yet — i.e. supabase/029_mod_actions.sql has not been applied.
//
// This matters for the UI: "the migration isn't deployed" and "nobody has
// been moderated this week" produce the same empty list, and an admin
// staring at an empty Mod Log deserves to know which one they are looking
// at. PostgREST reports an unknown table as PGRST205/PGRST202 and Postgres
// itself as 42P01 (undefined_table) / 42883 (undefined_function).
export const isMissingSchemaError = (err) => {
  const code = err?.code || '';
  if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code)) return true;
  const msg = (err?.message || '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('could not find the function');
};

// Normalises an rpc row into the shape the dashboard renders. Keeping the
// mapping here means the UI never touches snake_case column names.
const mapAction = (r) => ({
  id: r.id,
  action: r.action,
  targetUid: r.target_uid,
  targetEmail: r.target_email,
  targetName: r.target_name,
  reason: r.reason,
  strikeCount: r.strike_count,
  durationMinutes: r.duration_minutes,
  bannedUntilMs: r.banned_until_ms,
  isPermanent: !!r.is_permanent,
  actorUid: r.actor_uid,
  actorName: r.actor_name,
  actorRole: r.actor_role,
  source: r.source,
  createdAt: r.created_at ? Date.parse(r.created_at) : null,
  // Raw cursor values — keyset pagination pages on (created_at, id).
  _cursorCreated: r.created_at,
  _cursorId: r.id,
});

/**
 * One user's moderation timeline, newest first.
 * @returns {Promise<{items: Array, hasMore: boolean, cursor: object|null}>}
 */
export const fetchUserModHistory = async (
  { email, uid, cursor = null, limit = 50 } = {}
) => {
  try {
    const { data, error } = await supabase.rpc('mod_actions_for_user', {
      p_email: normalizeEmail(email),
      p_uid: uid || null,
      p_cursor_created: cursor?.created || null,
      p_cursor_id: cursor?.id || null,
      p_limit: limit,
    });
    if (error) throw error;

    const items = (data || []).map(mapAction);
    const last = items[items.length - 1];
    return {
      items,
      hasMore: items.length >= limit,
      cursor: last ? { created: last._cursorCreated, id: last._cursorId } : null,
      schemaMissing: false,
    };
  } catch (err) {
    console.warn('[modLog] fetchUserModHistory failed:', err?.message);
    return { items: [], hasMore: false, cursor: null, schemaMissing: isMissingSchemaError(err) };
  }
};

/**
 * Aggregate counts for one user — computed server-side, one row back.
 * Returns zeros rather than null on failure so callers can render
 * unconditionally.
 */
export const fetchUserModCounts = async ({ email, uid } = {}) => {
  const empty = {
    muteCount: 0, strikeCount: 0, banCount: 0, unbanCount: 0, totalCount: 0,
    firstActionAt: null, lastActionAt: null, lastAction: null,
    lastReason: null, lastActorName: null, distinctActors: 0,
  };
  try {
    const { data, error } = await supabase.rpc('mod_action_counts_for_user', {
      p_email: normalizeEmail(email),
      p_uid: uid || null,
    });
    if (error) throw error;

    const r = Array.isArray(data) ? data[0] : data;
    if (!r) return empty;

    return {
      muteCount: Number(r.mute_count) || 0,
      strikeCount: Number(r.strike_count) || 0,
      banCount: Number(r.ban_count) || 0,
      unbanCount: Number(r.unban_count) || 0,
      totalCount: Number(r.total_count) || 0,
      firstActionAt: r.first_action_at ? Date.parse(r.first_action_at) : null,
      lastActionAt: r.last_action_at ? Date.parse(r.last_action_at) : null,
      lastAction: r.last_action || null,
      lastReason: r.last_reason || null,
      lastActorName: r.last_actor_name || null,
      distinctActors: Number(r.distinct_actors) || 0,
    };
  } catch (err) {
    console.warn('[modLog] fetchUserModCounts failed:', err?.message);
    return { ...empty, schemaMissing: isMissingSchemaError(err) };
  }
};

/**
 * Per-moderator totals over a window — "who banned how many people".
 * `distinctTargets` is deliberately reported alongside `totalCount`:
 * ten mutes on one repeat offender is not ten people moderated.
 */
export const fetchModLeaderboard = async ({ days = 30, limit = 50 } = {}) => {
  try {
    const { data, error } = await supabase.rpc('mod_leaderboard', {
      p_days: days,
      p_limit: limit,
    });
    if (error) throw error;

    return (data || []).map((r) => ({
      actorUid: r.actor_uid,
      actorName: r.actor_name || 'Unknown',
      actorRole: r.actor_role,
      banCount: Number(r.ban_count) || 0,
      strikeCount: Number(r.strike_count) || 0,
      muteCount: Number(r.mute_count) || 0,
      unbanCount: Number(r.unban_count) || 0,
      totalCount: Number(r.total_count) || 0,
      distinctTargets: Number(r.distinct_targets) || 0,
      lastActionAt: r.last_action_at ? Date.parse(r.last_action_at) : null,
    }));
  } catch (err) {
    console.warn('[modLog] fetchModLeaderboard failed:', err?.message);
    const out = [];
    out.schemaMissing = isMissingSchemaError(err);
    return out;
  }
};

/**
 * Global recent-actions feed with optional action / actor filters.
 * Filters are applied server-side, so a filtered page costs less than an
 * unfiltered one rather than the same.
 */
export const fetchRecentModActions = async (
  { action = null, actorUid = null, days = 30, cursor = null, limit = 30 } = {}
) => {
  try {
    const { data, error } = await supabase.rpc('mod_actions_recent', {
      p_action: action,
      p_actor_uid: actorUid,
      p_days: days,
      p_cursor_created: cursor?.created || null,
      p_cursor_id: cursor?.id || null,
      p_limit: limit,
    });
    if (error) throw error;

    const items = (data || []).map(mapAction);
    const last = items[items.length - 1];
    return {
      items,
      hasMore: items.length >= limit,
      cursor: last ? { created: last._cursorCreated, id: last._cursorId } : null,
      schemaMissing: false,
    };
  } catch (err) {
    console.warn('[modLog] fetchRecentModActions failed:', err?.message);
    return { items: [], hasMore: false, cursor: null, schemaMissing: isMissingSchemaError(err) };
  }
};
