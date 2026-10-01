/**
 * squad.js — Squad (invite friends, earn Pro) client helpers.
 *
 * Server side: supabase/034_squad.sql. Everything that matters (who counts,
 * Pro days, ranks) is decided there; this file only:
 *   - captures the invite code from the Play install link (Android),
 *   - applies a pending code once the new player signs in,
 *   - pings once a day for squad participants (that is what makes a pending
 *     friend count and what brings earned Pro to the phone),
 *   - keeps Squad Pro so LocalGlobelStats can merge it into isPro.
 *
 * Rewards are Pro PASSES (036_squad_passes.sql): kept on the server, started
 * with activatePass() whenever the player wants. Only an activated pass sets
 * proUntil; the app keeps the open-pass count for the Home badge.
 *
 * Squad Pro is kept per uid; `setSquadUser(uid)` says whose it is right now
 * (null after sign-out), so a shared phone never lends Pro to the next account.
 */

import { Platform } from 'react-native';
import { supabase } from '../Supabase/client';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'squad' });
} catch (e) {
  const mem = new Map();
  storage = {
    getString: (k) => mem.get(k),
    getNumber: (k) => mem.get(k),
    getBoolean: (k) => mem.get(k),
    set: (k, v) => mem.set(k, v),
    remove: (k) => mem.delete(k),
  };
}

// Kept in step with _squad_step_days / _squad_rank in 034_squad.sql.
export const STEPS = [
  { n: 1, days: 3 },
  { n: 3, days: 14 },
  { n: 10, days: 30 },
  { n: 25, days: 90 },
];
export const RANKS = [
  // Art for each rank: Code/Squad/SquadBadge.jsx (Code/Assets/badges/squad_*.webp).
  { n: 50, key: 'icon', color: '#06B6D4' },
  { n: 25, key: 'legend', color: '#D97706' },
  { n: 10, key: 'leader', color: '#64748B' },
  { n: 3, key: 'recruiter', color: '#B8692F' },
];
export const FRIEND_PRO_DAYS = 3;
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const PING_EVERY_MS = 12 * 60 * 60 * 1000;
// An inviter whose friends are about to count checks more often, so the
// reward push ("your Pro is already on") is true by the time they look.
const PING_AWAITING_MS = 30 * 60 * 1000;
const AWAIT_MS = 3 * 24 * 60 * 60 * 1000;
const utcDay = (ms) => Math.floor(ms / 86400000);
const SQUAD_TTL_MS = 5 * 60 * 1000;
const BOARD_TTL_MS = 30 * 60 * 1000;
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.adoptmevaluescalc';
const IOS_URL = 'https://apps.apple.com/app/id6745400111';

export const rankFor = (count) => RANKS.find((r) => (Number(count) || 0) >= r.n) || null;
export const nextRank = (count) => [...RANKS].reverse().find((r) => (Number(count) || 0) < r.n) || null;
export const nextStep = (count) => STEPS.find((s) => (Number(count) || 0) < s.n) || null;

/** "ab c-12x" -> "ABC12X"; null unless it is a valid squad code. */
export const normalizeCode = (raw) => {
  const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(c) ? c : null;
};

/** Play referrer "squad=ABC123&utm_source=x" (maybe URL-encoded) -> "ABC123". */
export const codeFromReferrer = (ref) => {
  if (!ref || typeof ref !== 'string') return null;
  let s = ref;
  try { s = decodeURIComponent(ref); } catch (e) { /* keep raw */ }
  const m = s.match(/(?:^|[&?])squad=([A-Za-z0-9]+)/);
  return m ? normalizeCode(m[1]) : null;
};

export const inviteLinks = (code) => ({
  android: `${PLAY_URL}&referrer=${encodeURIComponent(`squad=${code}`)}`,
  ios: IOS_URL,
});

// ── Who is signed in, and their Squad Pro ─────────────────────────────────

// Remembered across launches: RevenueCat answers before the signed-in user
// loads, and without this the isPro merge saw "nobody" and dropped a Squad
// Pro player to free (launch ad included) until login finished. Cleared only
// by a real sign-out (GlobelStats calls setSquadUser(null)).
let currentUid = storage.getString('lastUid') || null;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });

export const onSquadProChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const setSquadUser = (uid) => {
  const next = uid || null;
  if (next) storage.set('lastUid', next);
  else storage.remove('lastUid');
  if (next === currentUid) return;
  currentUid = next;
  emit();
};

/** Re-run the isPro merge (e.g. when earned Squad Pro just ran out). */
export const refreshSquadPro = () => emit();

export const getSquadProUntil = (uid = currentUid) => (uid ? storage.getNumber(`proUntil_${uid}`) || 0 : 0);

export const isSquadProActive = (uid = currentUid) => getSquadProUntil(uid) > Date.now();

// ── Pro passes (count only; the list comes with get_my_squad) ──────────────

const passListeners = new Set();
export const onSquadPassesChange = (fn) => {
  passListeners.add(fn);
  return () => passListeners.delete(fn);
};
export const getPassCount = (uid = currentUid) => (uid ? storage.getNumber(`passes_${uid}`) || 0 : 0);
const setPassCount = (uid, n) => {
  if (!uid || typeof n !== 'number' || !Number.isFinite(n)) return;
  const before = getPassCount(uid);
  storage.set(`passes_${uid}`, n);
  if (before !== n) passListeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
};

const saveStatus = (uid, data, { participant = true } = {}) => {
  if (!uid || !data) return;
  setPassCount(uid, data.passes);
  const until = data.proUntil ? Date.parse(data.proUntil) : 0;
  const before = getSquadProUntil(uid);
  storage.set(`proUntil_${uid}`, Number.isFinite(until) ? until : 0);
  if (typeof data.pending === 'boolean') storage.set(`pending_${uid}`, data.pending);
  if (participant) storage.set(`participant_${uid}`, true);
  if (before !== getSquadProUntil(uid)) emit();
};

// ── Device id (anti self-invite) ──────────────────────────────────────────

const deviceId = async () => {
  try {
    const { getDeviceFingerprint } = require('./deviceFingerprint');
    return (await getDeviceFingerprint()) || null;
  } catch (e) {
    return null;
  }
};

// Funnel events (Firebase Analytics, via growthAnalytics): join, count, pass
// activation. No uids, names or codes are sent. Never throws.
const track = (event, params) => {
  try { require('./growthAnalytics').trackGrowthEvent(event, params); } catch (e) { /* ignore */ }
};

const langOf = () => {
  try {
    const l = String(require('../../i18n').default.language || 'en').slice(0, 2);
    return ['en', 'ru', 'es', 'fr', 'de', 'ar'].includes(l) ? l : 'en';
  } catch (e) {
    return 'en';
  }
};

// ── Invite code from the install link (Android) ───────────────────────────

export const getPendingCode = () => storage.getString('pendingCode') || null;
export const setPendingCode = (code) => {
  const c = normalizeCode(code);
  if (c) storage.set('pendingCode', c);
  else storage.remove('pendingCode');
};

/**
 * Once per install: read Play's install referrer and keep a squad code.
 * Callers share one promise, so "apply after sign-in" never races the read.
 */
let referrerPromise = null;
export const captureInstallReferrer = () => {
  if (referrerPromise) return referrerPromise;
  referrerPromise = (async () => {
    if (Platform.OS !== 'android' || storage.getBoolean('referrerChecked')) return null;
    try {
      const DeviceInfo = require('react-native-device-info');
      const read = DeviceInfo.getInstallReferrer || DeviceInfo.default?.getInstallReferrer;
      const ref = await read();
      storage.set('referrerChecked', true);
      const code = codeFromReferrer(ref);
      if (code) setPendingCode(code);
      return code;
    } catch (e) {
      return null; // try again next launch
    }
  })();
  return referrerPromise;
};

// Reasons the server gives that will never succeed on a retry.
const FINAL = new Set(['bad_code', 'own_code', 'not_new', 'device_used', 'already_joined', 'loop', 'device']);

/**
 * Join a squad. Returns {ok, reason?, inviterName?}; throws on network errors.
 * `source`: 'typed' (Squad screen) or 'link' (Play install referrer).
 */
export const joinSquad = async (uid, code, { source = 'typed' } = {}) => {
  const c = normalizeCode(code);
  if (!uid) return { ok: false, reason: 'signin' };
  if (!c) return { ok: false, reason: 'bad_code' };
  const device = await deviceId();
  if (!device) return { ok: false, reason: 'device' };
  const { data, error } = await supabase.rpc('join_squad', { p_code: c, p_device: device });
  if (error) throw error;
  const res = data || { ok: false, reason: 'unknown' };
  track('squad_join', { ok: res.ok ? 1 : 0, reason: res.ok ? 'ok' : String(res.reason || 'unknown'), source });
  if (res.ok) {
    storage.set(`pending_${uid}`, true);
    storage.set(`participant_${uid}`, true);
    storage.remove(`squad_${uid}`);
  }
  return res;
};

/** Apply the code captured from the install link, once, after sign-in. */
export const applyPendingCode = async (uid) => {
  const code = getPendingCode();
  if (!uid || !code) return null;
  try {
    const res = await joinSquad(uid, code, { source: 'link' });
    if (res.ok || FINAL.has(res.reason)) setPendingCode(null);
    return res;
  } catch (e) {
    return null; // offline: keep the code, try next launch
  }
};

// ── Daily ping ────────────────────────────────────────────────────────────

const pingDue = (uid, last) => {
  const now = Date.now();
  if (now - last >= PING_EVERY_MS) return true;
  // A pending friend counts on their next UTC day; don't make them also wait
  // out 12 h (joined 23:00, back at 08:00 = counts now, not at 11:00).
  if (storage.getBoolean(`pending_${uid}`) && utcDay(now) > utcDay(last)) return true;
  if ((storage.getNumber(`awaitUntil_${uid}`) || 0) > now && now - last >= PING_AWAITING_MS) return true;
  return false;
};

/**
 * Squad participants ping at most every 12 h unless forced (sooner while a
 * friend is about to count). Anyone else pings once per install, so Pro
 * earned before a reinstall or on another phone comes back without first
 * opening the Squad screen; squad_ping changes nothing for non-members.
 */
export const squadPing = async (uid, { force = false } = {}) => {
  if (!uid) return null;
  const participant = !!storage.getBoolean(`participant_${uid}`);
  if (!participant && storage.getBoolean(`checked_${uid}`)) return null;
  const last = storage.getNumber(`pingAt_${uid}`) || 0;
  if (participant && !force && !pingDue(uid, last)) return null;
  try {
    const { data, error } = await supabase.rpc('squad_ping', { p_device: await deviceId() });
    if (error) throw error;
    storage.set(`pingAt_${uid}`, Date.now());
    storage.set(`checked_${uid}`, true);
    const involved = participant || !!(data && (data.proUntil || data.direct > 0 || data.pending));
    saveStatus(uid, data, { participant: involved });
    if (data?.qualified) {
      storage.remove(`squad_${uid}`);
      track('squad_friend_counted', {}); // logged on the friend's phone
    }
    return data;
  } catch (e) {
    console.warn('[squad] ping failed:', e?.message);
    return null;
  }
};

// ── Screen data ───────────────────────────────────────────────────────────

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
const writeCache = (key, data) => storage.set(key, JSON.stringify({ at: Date.now(), data }));

export const getMySquad = async (uid, { force = false } = {}) => {
  if (!uid) return null;
  if (!force) {
    const cached = readCache(`squad_${uid}`, SQUAD_TTL_MS);
    if (cached) return cached;
  }
  const { data, error } = await supabase.rpc('get_my_squad', { p_device: await deviceId(), p_lang: langOf() });
  if (error) throw error;
  writeCache(`squad_${uid}`, data);
  saveStatus(uid, {
    proUntil: data?.proUntil,
    pending: data?.joined ? data.joined.status === 'pending' : undefined,
    passes: Array.isArray(data?.passes) ? data.passes.length : undefined, // absent before 036
  });
  if ((data?.members || []).some((m) => m.status === 'pending')) storage.set(`awaitUntil_${uid}`, Date.now() + AWAIT_MS);
  else storage.remove(`awaitUntil_${uid}`);
  return data;
};

/**
 * Start one of my passes now. Pro runs from now, or from the end of the Pro
 * already running. Returns {ok, days?, proUntil?, reason?}; throws on network.
 */
export const activatePass = async (uid, passId) => {
  if (!uid) return { ok: false, reason: 'signin' };
  const { data, error } = await supabase.rpc('activate_squad_pass', { p_id: passId });
  if (error) throw error;
  const res = data || { ok: false, reason: 'unknown' };
  storage.remove(`squad_${uid}`);
  if (res.ok) saveStatus(uid, { proUntil: res.proUntil, passes: res.passes });
  track(res.ok ? 'squad_pass_activated' : 'squad_pass_failed', res.ok ? { days: Number(res.days) || 0 } : { reason: String(res.reason || 'unknown') });
  return res;
};

/**
 * A squad push arrived or was tapped (FrontendNotificationHandling). A friend
 * joining means rewards may follow soon; a qualified friend or a reward
 * means the server already moved: drop the cached screen and fetch Pro now.
 */
export const onSquadPush = (kind) => {
  const uid = currentUid;
  if (!uid) return Promise.resolve(null);
  storage.set(`participant_${uid}`, true);
  storage.remove(`squad_${uid}`);
  if (kind === 'member_joined') {
    storage.set(`awaitUntil_${uid}`, Date.now() + AWAIT_MS);
    return Promise.resolve(null);
  }
  storage.remove(`pingAt_${uid}`); // if this ping fails, the next one is not throttled
  return squadPing(uid, { force: true });
};

export const getSquadLeaderboard = async ({ force = false } = {}) => {
  if (!force) {
    const cached = readCache('board', BOARD_TTL_MS);
    if (cached) return cached;
  }
  const { data, error } = await supabase.rpc('squad_leaderboard');
  if (error) throw error;
  const list = Array.isArray(data) ? data : [];
  writeCache('board', list);
  return list;
};
