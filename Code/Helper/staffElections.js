/**
 * staffElections.js — Staff elections (MOD / JMD) client helpers.
 *
 * Server side: supabase/038_staff_elections.sql + 040_staff_applications.sql
 * + 041_staff_admin_final.sql decide everything (who may apply, who may vote,
 * who met the bar). A closed race is only counted ('review' phase): an admin
 * appoints or removes people one by one in Admin Dashboard → Elections
 * (adminResults / adminDecide / adminFinish below), and
 * functions/runStaffElections.js writes those decisions into RTDB. This
 * file only calls the RPCs, caches the screen data, and works out
 * phases/countdowns for display.
 *
 * Applying (040): a player who meets the bar (squad friends, minimum age,
 * clean record) submits an application. It is 'pending' until an admin
 * approves it in Admin Dashboard → Elections; only 'approved' candidates
 * are on the ballot. 'rejected' can't re-apply in that election; 'expired'
 * means nobody decided before the election closed.
 *
 * Badges: a MOD may give Trusted / CMSR / Helper only to a player with
 * BADGE_MIN_SQUAD squad friends. The RTDB rule enforces it (from
 * /squad_size); canGrantBadge() is the matching UI check. A MOD an admin
 * lists in Admin Dashboard → Badge Access (RTDB /badge_granters/{uid}) skips
 * the squad bar, like an admin.
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

// Kept in step with _staff_rules / _staff_limits in 040_staff_applications.sql.
// The screen prefers the server's copy (staff_elections_get returns both).
export const ROLE_RULES = {
  mod: { seats: 4, minSquad: 5, minAge: 18, minVotes: 10, termDays: 60, nominateHours: 72, voteHours: 96 },
  jmd: { seats: 6, minSquad: 3, minAge: 16, minVotes: 3, termDays: 30, nominateHours: 72, voteHours: 96 },
};
export const ROLES = ['mod', 'jmd'];
export const APPLICATION_STATUSES = ['pending', 'approved', 'rejected', 'expired'];
// What an admin can decide about one player once a race is counted (041).
// 'appoint' and 'remove' are final for that election; 'none' can change later.
export const DECISION_KINDS = ['appoint', 'remove', 'none'];
export const BADGE_MIN_SQUAD = 3;
export const VOTER_MIN_DAYS = 7;
export const CLEAN_RECORD_DAYS = 30;
export const PITCH_MAX = 160;

const GET_TTL_MS = 2 * 60 * 1000;
const BRIEF_TTL_MS = 6 * 60 * 60 * 1000;

/** Can this viewer give a badge to a player with `targetSquad` squad friends? */
export const canGrantBadge = ({ isAdmin = false, anySquad = false, targetSquad = 0 } = {}) =>
  !!isAdmin || !!anySquad || (Number(targetSquad) || 0) >= BADGE_MIN_SQUAD;

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
  // 'review' = counted, waiting for an admin (041). Like the two others it
  // comes from the server's status, not from the calendar.
  if (e.phase === 'finalized' || e.phase === 'cancelled' || e.phase === 'review') return e.phase;
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

/**
 * Can the caller apply for each role, and why not. The server's verdict
 * (me.eligible, 040) wins; the local calculation covers cached data from
 * before it existed. `reasons` uses the server's words: squad, age,
 * age_unknown, record, already_mod.
 */
export const eligibility = (data) => {
  const me = data?.me || {};
  const rules = data?.rules || ROLE_RULES;
  const squad = Number(me.squad) || 0;
  const age = me.age === null || me.age === undefined || !Number.isFinite(Number(me.age)) ? null : Number(me.age);
  const out = {};
  for (const role of ROLES) {
    const minSquad = rules[role]?.minSquad ?? ROLE_RULES[role].minSquad;
    const minAge = rules[role]?.minAge ?? ROLE_RULES[role].minAge;
    const server = me.eligible?.[role];
    if (server && Array.isArray(server.reasons)) {
      out[role] = {
        ok: !!server.ok,
        reasons: server.reasons,
        need: Math.max(0, (server.minSquad ?? minSquad) - (Number(server.squad) || squad)),
        minAge: server.minAge ?? minAge,
      };
      continue;
    }
    const reasons = [];
    const need = Math.max(0, minSquad - squad);
    if (need > 0) reasons.push('squad');
    if (age === null) reasons.push('age_unknown');
    else if (age < minAge) reasons.push('age');
    if (me.cleanRecord === false || me.banned) reasons.push('record');
    if (role === 'jmd' && me.isMod) reasons.push('already_mod');
    out[role] = { ok: reasons.length === 0, reasons, need, minAge };
  }
  const minDays = data?.limits?.voterMinDays ?? VOTER_MIN_DAYS;
  out.vote = {
    ok: (Number(me.accountDays) || 0) >= minDays && !me.banned,
    daysLeft: Math.max(0, minDays - (Number(me.accountDays) || 0)),
  };
  return out;
};

/**
 * The one line to show for a role's eligibility: the first blocking reason
 * as an i18n key + params, or null when the player may apply.
 */
export const blockReasonKey = (elig, role) => {
  const e = elig?.[role];
  if (!e || e.ok) return null;
  switch (e.reasons?.[0]) {
    case 'squad': return { key: `elections.need_more_${role}`, count: e.need };
    case 'age': return { key: `elections.need_age_${role}`, count: e.minAge };
    case 'age_unknown': return { key: 'elections.need_dob' };
    case 'already_mod': return { key: 'elections.err_already_mod' };
    case 'record': return { key: 'elections.err_record' };
    default: return { key: 'elections.err_generic' };
  }
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
    .filter((e) => e.phase !== 'finalized' && e.phase !== 'cancelled' && e.phase !== 'review')
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

/** Every application in an open election, pending first (admin panel). */
export const adminApplications = async () => {
  const { data, error } = await supabase.rpc('staff_admin_applications');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
};

/** Approve or reject an application; the decision can be changed while the election is open. */
export const adminReview = async (uid, electionId, candidateUid, approve, note) => {
  const { data, error } = await supabase.rpc('staff_admin_review', {
    p_election: electionId,
    p_uid: candidateUid,
    p_approve: !!approve,
    p_note: String(note || '').trim().slice(0, 200) || null,
  });
  if (error) throw error;
  dropCaches(uid);
  const res = data || { ok: false, reason: 'unknown' };
  track('election_review', { ok: res.ok ? 1 : 0, decision: approve ? 'approve' : 'reject' });
  return res;
};

/**
 * The suggestion line for one counted election (041), from the server's
 * `suggestion` plus names. Pure: the panel renders it, the test checks it.
 * Only a suggestion: the admin appoints and removes by hand.
 */
export const reviewSuggestion = (el) => {
  const cands = Array.isArray(el?.candidates) ? el.candidates : [];
  const holders = Array.isArray(el?.holders) ? el.holders : [];
  const name = (uid) => (cands.find((c) => c.uid === uid) || holders.find((h) => h.uid === uid) || {}).name || uid;
  const appoint = (el?.suggestion?.appoint || []).map((uid) => ({ uid, name: name(uid), votes: (cands.find((c) => c.uid === uid) || {}).votes || 0 }));
  const remove = (el?.suggestion?.remove || []).map((uid) => ({ uid, name: name(uid) }));
  const qualified = cands.filter((c) => c.qualified);
  const bannedOut = qualified.filter((c) => c.check?.banned).length;
  const seats = Number(el?.seats) || 0;
  const minVotes = Number(el?.minVotes) || 0;
  let text;
  if (qualified.length === 0) {
    text = `Nobody reached ${minVotes} votes. Suggestion: keep the current team and start a new election when you are ready.`;
  } else {
    const who = appoint.map((a) => `${a.name} (${a.votes})`).join(', ');
    text = appoint.length
      ? `Suggestion: appoint ${who}`
      : 'Suggestion: appoint nobody';
    if (remove.length) text += `; remove ${remove.map((r) => r.name).join(', ')} (not re-elected)`;
    text += `. ${appoint.length} of ${seats} seat${seats === 1 ? '' : 's'} would be filled.`;
    if (bannedOut) text += ` ${bannedOut} qualified candidate${bannedOut === 1 ? ' is' : 's are'} banned right now and left out.`;
    text += ' Nothing changes until you tap.';
  }
  return { text, appoint, remove, seats, filled: appoint.length, qualified: qualified.length, bannedOut };
};

/** Counted elections waiting for a decision, with the suggestion, plus terms that ran out (admin panel). */
export const adminResults = async () => {
  const { data, error } = await supabase.rpc('staff_admin_results');
  if (error) throw error;
  return {
    elections: Array.isArray(data?.elections) ? data.elections : [],
    termAlerts: Array.isArray(data?.termAlerts) ? data.termAlerts : [],
  };
};

/** One decision about one player in a counted election: 'appoint' | 'remove' | 'none'. */
export const adminDecide = async (uid, electionId, targetUid, kind) => {
  const { data, error } = await supabase.rpc('staff_admin_decide', {
    p_election: electionId,
    p_uid: targetUid,
    p_kind: kind,
  });
  if (error) throw error;
  dropCaches(uid);
  const res = data || { ok: false, reason: 'unknown' };
  track('election_decide', { ok: res.ok ? 1 : 0, kind: String(kind), reason: res.ok ? 'ok' : String(res.reason || 'unknown') });
  return res;
};

/** Close the review of a counted election. Nothing is scheduled; an admin starts the next race. */
export const adminFinish = async (uid, electionId) => {
  const { data, error } = await supabase.rpc('staff_admin_finish', { p_election: electionId });
  if (error) throw error;
  dropCaches(uid);
  const res = data || { ok: false, reason: 'unknown' };
  track('election_finish', { ok: res.ok ? 1 : 0, appointed: Number(res.appointed) || 0, removed: Number(res.removed) || 0 });
  return res;
};

/** A player's standing (squad, age, record, roles, open application). Admins only; the server checks. */
export const adminEligibility = async (targetUid) => {
  if (!targetUid) return null;
  const { data, error } = await supabase.rpc('staff_admin_eligibility', { p_uid: targetUid });
  if (error) throw error;
  return data || null;
};
