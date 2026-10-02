/**
 * staffElections.js — Staff elections (MOD / JMD) client helpers.
 *
 * Server side: supabase/038_staff_elections.sql decides everything (who may
 * run, who may vote, who wins); functions/runStaffElections.js writes the
 * winners' roles into RTDB. This file only calls the RPCs, caches the
 * screen data, and works out phases/countdowns for display.
 *
 * Badges: a MOD may give Trusted / CMSR / Helper only to a player with
 * BADGE_MIN_SQUAD squad friends. The RTDB rule enforces it (from
 * /squad_size); canGrantBadge() is the matching UI check.
 */

import { supabase } from '../Supabase/client';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'elections' });
} catch (e) {
  const mem = new Map();
  storage = {
    getString: (k) => mem.get(k),
    set: (k, v) => mem.set(k, v),
    remove: (k) => mem.delete(k),
  };
}

// Kept in step with _staff_rules / _staff_limits in 038_staff_elections.sql.
// The screen prefers the server's copy (staff_elections_get returns both).
export const ROLE_RULES = {
  mod: { seats: 4, minSquad: 10, minVotes: 10, termDays: 60, nominateHours: 72, voteHours: 96 },
  jmd: { seats: 6, minSquad: 3, minVotes: 3, termDays: 30, nominateHours: 72, voteHours: 96 },
};
export const ROLES = ['mod', 'jmd'];
export const BADGE_MIN_SQUAD = 3;
export const VOTER_MIN_DAYS = 7;
export const CLEAN_RECORD_DAYS = 30;
export const PITCH_MAX = 160;

const GET_TTL_MS = 2 * 60 * 1000;
const BRIEF_TTL_MS = 6 * 60 * 60 * 1000;

/** Can this viewer give a badge to a player with `targetSquad` squad friends? */
export const canGrantBadge = ({ isAdmin = false, targetSquad = 0 } = {}) =>
  !!isAdmin || (Number(targetSquad) || 0) >= BADGE_MIN_SQUAD;

const ms = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Phase from the calendar, same as _staff_phase on the server. The server's
 * `phase` wins when present; this is for cached data that may have aged
 * (Home card) and for ticking countdowns.
 */
export const phaseOf = (e, now = Date.now()) => {
  if (!e) return null;
  if (e.phase === 'finalized' || e.phase === 'cancelled') return e.phase;
  if (now < ms(e.nominationsAt)) return 'upcoming';
  if (now < ms(e.votingAt)) return 'nominations';
  if (now < ms(e.closesAt)) return 'voting';
  return 'counting';
};

/** The moment the current phase ends (null when nothing is ticking). */
export const phaseEndsAt = (e, now = Date.now()) => {
  switch (phaseOf(e, now)) {
    case 'upcoming': return ms(e.nominationsAt);
    case 'nominations': return ms(e.votingAt);
    case 'voting': return ms(e.closesAt);
    default: return null;
  }
};

/** Split a duration for "2d 4h" style labels. */
export const splitDuration = (msLeft) => {
  const m = Math.max(0, Math.floor(msLeft / 60000));
  return { d: Math.floor(m / 1440), h: Math.floor((m % 1440) / 60), m: m % 60 };
};

/**
 * What the Home card should advertise: an election taking entries or votes.
 * Voting beats nominations (that's when every player can act).
 */
export const homeHighlight = (brief, now = Date.now()) => {
  const live = (Array.isArray(brief) ? brief : [])
    .map((e) => ({ ...e, phase: phaseOf(e, now) }))
    .filter((e) => e.phase === 'nominations' || e.phase === 'voting');
  if (!live.length) return null;
  live.sort((a, b) => (a.phase === b.phase
    ? (a.role === 'mod' ? -1 : 1)
    : (a.phase === 'voting' ? -1 : 1)));
  return { ...live[0], endsAt: phaseEndsAt(live[0], now) };
};

/** How far the caller is from running for each role. */
export const eligibility = (data) => {
  const me = data?.me || {};
  const rules = data?.rules || ROLE_RULES;
  const squad = Number(me.squad) || 0;
  const out = {};
  for (const role of ROLES) {
    const need = Math.max(0, (rules[role]?.minSquad ?? ROLE_RULES[role].minSquad) - squad);
    out[role] = {
      need,
      ok: need === 0 && me.cleanRecord !== false && !(role === 'jmd' && me.isMod),
    };
  }
  const minDays = data?.limits?.voterMinDays ?? VOTER_MIN_DAYS;
  out.vote = {
    ok: (Number(me.accountDays) || 0) >= minDays && !me.banned,
    daysLeft: Math.max(0, minDays - (Number(me.accountDays) || 0)),
  };
  return out;
};

// ── Cache ─────────────────────────────────────────────────────────────────

const readCache = (key, ttl) => {
  try {
    const raw = storage.getString(key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    return Date.now() - at < ttl ? data : null;
  } catch (e) {
    return null;
  }
};
const writeCache = (key, data) => {
  try { storage.set(key, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* ignore */ }
};
const dropCaches = (uid) => {
  storage.remove('brief');
  if (uid) storage.remove(`get_${uid}`);
};

const track = (event, params) => {
  try { require('./growthAnalytics').trackGrowthEvent(event, params); } catch (e) { /* ignore */ }
};

const deviceId = async () => {
  try {
    const { getDeviceFingerprint } = require('./deviceFingerprint');
    return (await getDeviceFingerprint()) || null;
  } catch (e) {
    return null;
  }
};

// ── Reads ─────────────────────────────────────────────────────────────────

/** The Elections screen: elections, the sitting team, and what I may do. */
export const getElections = async (uid, { force = false } = {}) => {
  if (!uid) return null;
  if (!force) {
    const cached = readCache(`get_${uid}`, GET_TTL_MS);
    if (cached) return cached;
  }
  const { data, error } = await supabase.rpc('staff_elections_get');
  if (error) throw error;
  writeCache(`get_${uid}`, data);
  // The screen just saw every open election; the Home card can reuse it.
  writeCache('brief', (data?.elections || [])
    .filter((e) => e.phase !== 'finalized' && e.phase !== 'cancelled')
    .map(({ id, role, nominationsAt, votingAt, closesAt }) => ({ id, role, nominationsAt, votingAt, closesAt })));
  return data;
};

/** Open elections' calendar only (Home card). Never throws. */
export const getBrief = async ({ force = false } = {}) => {
  if (!force) {
    const cached = readCache('brief', BRIEF_TTL_MS);
    if (cached) return cached;
  }
  try {
    const { data, error } = await supabase.rpc('staff_elections_brief');
    if (error) throw error;
    const list = Array.isArray(data) ? data : [];
    writeCache('brief', list);
    return list;
  } catch (e) {
    return [];
  }
};

// ── Actions. Each returns {ok, reason?, ...}; throws on network errors. ────

export const runForRole = async (uid, electionId, pitch) => {
  const { data, error } = await supabase.rpc('staff_run', {
    p_election: electionId,
    p_pitch: String(pitch || '').slice(0, PITCH_MAX),
  });
  if (error) throw error;
  dropCaches(uid);
  const res = data || { ok: false, reason: 'unknown' };
  track('election_run', { ok: res.ok ? 1 : 0, reason: res.ok ? 'ok' : String(res.reason || 'unknown') });
  return res;
};

export const withdraw = async (uid, electionId) => {
  const { data, error } = await supabase.rpc('staff_withdraw', { p_election: electionId });
  if (error) throw error;
  dropCaches(uid);
  return data || { ok: false };
};

export const castVote = async (uid, electionId, candidateUid) => {
  const device = await deviceId();
  if (!device) return { ok: false, reason: 'device' };
  const { data, error } = await supabase.rpc('staff_vote', {
    p_election: electionId,
    p_candidate: candidateUid,
    p_device: device,
  });
  if (error) throw error;
  dropCaches(uid);
  const res = data || { ok: false, reason: 'unknown' };
  track('election_vote', { ok: res.ok ? 1 : 0, reason: res.ok ? 'ok' : String(res.reason || 'unknown') });
  return res;
};

// Admin only (the server checks; these just call).
export const adminOpen = async (uid, role, seats) => {
  const { data, error } = await supabase.rpc('staff_admin_open', { p_role: role, p_seats: seats ?? null });
  if (error) throw error;
  dropCaches(uid);
  return data || { ok: false };
};

export const adminCancel = async (uid, electionId) => {
  const { data, error } = await supabase.rpc('staff_admin_cancel', { p_election: electionId });
  if (error) throw error;
  dropCaches(uid);
  return data || { ok: false };
};

export const adminDisqualify = async (uid, electionId, candidateUid) => {
  const { data, error } = await supabase.rpc('staff_admin_disqualify', { p_election: electionId, p_uid: candidateUid });
  if (error) throw error;
  dropCaches(uid);
  return data || { ok: false };
};
