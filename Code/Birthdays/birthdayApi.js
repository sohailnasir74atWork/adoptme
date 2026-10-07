/**
 * birthdayApi.js — Birthdays server calls (supabase/049–051) + caches.
 *
 * The server only ever returns month and day, never a year or an age, and
 * only for players who show their birthday (on by default, 050) and are 13
 * or older. Your own birthday comes back to you whatever the setting.
 *
 * Built to cost almost nothing (owner, 2026-10-07):
 *   - birthday_home (051) is the ONE call behind Home, Settings and the chat
 *     🎂: your birthday plus [uid, month, day] for today's birthdays — a few
 *     KB, no names or photos. Kept on the phone (MMKV) for the local day and
 *     refreshed at most every HOME_TTL_MS, so a cold start reads nothing.
 *   - list_birthdays (names, photos, wish counts; up to 200 rows) only when
 *     the Birthdays screen opens. Kept on the phone for LIST_TTL_MS and shown
 *     instantly from there while it refreshes.
 *   - Neither cache crosses midnight: each day's birthdays are different.
 *     New players or a changed birthday appear within one refresh window.
 *   - Your own actions (a wish, Show/Hide, a correction) update the caches
 *     at once, without waiting for a refresh.
 *
 * Development: when the server functions are missing, or nobody is signed
 * in, __DEV__ builds fall back to birthdayMock.js so every screen can be
 * previewed. Release builds never switch to the mock.
 */

import { getAuth, getIdToken } from '@react-native-firebase/auth';
import { supabase } from '../Supabase/client';
import config from '../Helper/Environment';
import { daysUntilBirthday } from './birthdayDate';

const HOME_TTL_MS = 2 * 60 * 60 * 1000;
const LIST_TTL_MS = 30 * 60 * 1000;
const PUBLIC_TTL_MS = 12 * 60 * 60 * 1000;
const RETRY_AFTER_FAIL_MS = 10 * 60 * 1000;

export const WISH_TEMPLATES = ['hbd', 'party', 'pets', 'cake'];
export const WISH_EMOJI = { hbd: '🎂', party: '🎉', pets: '🐾', cake: '🎁' };

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'birthdays' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}

let currentUid = null;
let homeCache = null;              // { at, uid, day, data }   data = my birthday + today
let listCache = null;              // { at, uid, day, days, data }
const publicCache = new Map();     // uid -> { at, data }
let mock = null;

// uids whose (shown) birthday is today on this phone: drives the chat 🎂.
let todaySet = new Set();
const listeners = new Set();
const emit = () => listeners.forEach((l) => { try { l(); } catch (_) {} });
export const onBirthdaysChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const fresh = (c, ttl) => !!c && c.uid === currentUid && c.day === localDay() && Date.now() - c.at < ttl;

const readSaved = (key) => {
  try {
    const raw = storage.getString(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
};
const save = (key, value) => {
  if (mock || !currentUid) return; // never persist the sample data
  try { storage.set(key, JSON.stringify(value)); } catch (_) {}
};
const forget = (key) => { try { storage.remove(key); } catch (_) {} };
const homeKey = () => `home:${currentUid}`;
const listKey = () => `list:${currentUid}`;

const isMissingFunction = (error) =>
  !!error && (error.code === 'PGRST202' || /Could not find the function|does not exist/i.test(error.message || ''));

const switchToMock = (why) => {
  if (!mock) {
    mock = require('./birthdayMock').default;
    console.log(`[Birthdays] ${why}: using the local mock`);
  }
  return mock;
};

async function call(fn, args) {
  if (mock) return mock[fn](args);
  // Signed out (or the account not loaded yet): answer from the mock for this
  // call only, so the real server takes over as soon as the user is known.
  if (__DEV__ && !currentUid) return require('./birthdayMock').default[fn](args);
  const { data, error } = await supabase.rpc(fn, args || {});
  if (error) {
    if (__DEV__) console.log(`[Birthdays] ${fn} failed: ${error.code} ${error.message}`);
    if (__DEV__ && isMissingFunction(error) && fn !== 'birthday_home') return switchToMock('not deployed')[fn](args);
    throw error;
  }
  return data;
}

export const isBirthdayMockActive = () => !!mock;
export const getBirthdayMock = () => mock;

/** __DEV__ only: switch this session to the sample data (long-press the 🎂 on the Birthdays screen). */
export const enableBirthdayPreview = () => {
  if (!__DEV__) return;
  switchToMock('preview');
  homeCache = null;
  listCache = null;
  publicCache.clear();
  emit();
};

const applyToday = (today) => {
  todaySet = new Set((today || [])
    .filter((r) => Array.isArray(r) && daysUntilBirthday(r[1], r[2]) === 0)
    .map((r) => r[0]));
};

/** Scope caches to the signed-in player (null after sign-out). */
export const setBirthdayUser = (uid) => {
  if ((uid || null) === currentUid) return;
  currentUid = uid || null;
  homeCache = null;
  listCache = null;
  publicCache.clear();
  todaySet = new Set();
  todayLoad = null;
  todayLoadFailedAt = 0;
  // A cold start reads the saved copy instead of the network.
  if (currentUid) {
    const h = readSaved(homeKey());
    if (h && h.day === localDay()) {
      homeCache = { ...h, uid: currentUid };
      applyToday(h.data?.today);
    }
    const l = readSaved(listKey());
    if (l && l.day === localDay()) listCache = { ...l, uid: currentUid };
  }
  emit();
};

/** Drop every cache (the dev preview switch). */
export const invalidateBirthdays = () => {
  homeCache = null;
  listCache = null;
  publicCache.clear();
  if (currentUid) { forget(homeKey()); forget(listKey()); }
  emit();
};

/** Map a server error to an i18n key under birthdays.err.* */
export const birthdayErrorKey = (e) => {
  const m = String(e?.message || e || '');
  if (/already wished/.test(m)) return 'already_wished';
  if (/not their birthday/.test(m)) return 'not_today';
  if (/cannot wish/.test(m)) return 'cannot_wish';
  if (/sign in required|sign_in/.test(m)) return 'sign_in';
  if (/age_change/.test(m)) return 'age_change';
  if (/already_edited/.test(m)) return 'already_edited';
  if (/bad_date|bad_request|same/.test(m)) return 'bad_date';
  return 'generic';
};

// birthday_home, or — on a server without 051 — the two older calls.
async function fetchHome() {
  try {
    return await call('birthday_home');
  } catch (e) {
    if (!isMissingFunction(e)) throw e;
    const [me, rows] = await Promise.all([call('get_my_birthday'), call('list_birthdays', { p_days: 0 })]);
    return { ...me, today: (rows || []).map((r) => [r.uid, r.month, r.day]) };
  }
}

/**
 * Your birthday + today's birthdays, one small call:
 * { month, day, show, asked, minor, giftReady, giftOpened, wishCount, wishes, canEdit,
 *   today: [[uid, month, day], ...] }
 */
export async function getBirthdayHome({ force = false } = {}) {
  if (!force && fresh(homeCache, HOME_TTL_MS)) return homeCache.data;
  const data = await fetchHome();
  homeCache = { at: Date.now(), uid: currentUid, day: localDay(), data };
  save(homeKey(), homeCache);
  applyToday(data?.today);
  emit();
  return data;
}

/** Your own birthday (the same small call as Home). */
export const getMyBirthday = (opts) => getBirthdayHome(opts);

export const peekMyBirthday = () => (homeCache && homeCache.uid === currentUid ? homeCache.data : null);

/** How many shown players (not you) have a birthday today on this phone. */
export const todayBirthdayCount = (selfUid) => [...todaySet].filter((u) => u !== selfUid).length;

const patchHome = (patch) => {
  if (!homeCache?.data) return;
  homeCache = { ...homeCache, data: { ...homeCache.data, ...patch } };
  save(homeKey(), homeCache);
};

/** Turn "Show my birthday" on or off. */
export async function setBirthdayVisibility(show) {
  const data = await call('set_birthday_visibility', { p_show: !!show });
  patchHome({ show: !!data?.show, asked: true });
  // Your own row may appear in or leave today's list.
  listCache = null;
  if (currentUid) forget(listKey());
  homeCache = homeCache ? { ...homeCache, at: 0 } : null;
  emit();
  return data;
}

/**
 * Shown players with a birthday within `days` days (today included), soonest
 * first: [{ uid, name, avatar, month, day, daysUntil, wishes, wished }].
 * For the Birthdays screen only.
 */
export async function listBirthdays({ days = 7, force = false } = {}) {
  if (!force && fresh(listCache, LIST_TTL_MS) && listCache.days >= days) {
    return listCache.data.filter((b) => b.daysUntil <= days);
  }
  const rows = await call('list_birthdays', { p_days: days });
  // Days are counted on the phone's calendar, not the server's UTC one.
  const data = (rows || [])
    .map((b) => ({ ...b, daysUntil: daysUntilBirthday(b.month, b.day) }))
    .filter((b) => b.daysUntil != null && b.daysUntil <= days)
    .sort((a, b) => a.daysUntil - b.daysUntil || String(a.name).localeCompare(String(b.name)));
  listCache = { at: Date.now(), uid: currentUid, day: localDay(), days, data };
  save(listKey(), listCache);
  emit();
  return data;
}

/** The saved list for an instant first paint (may be up to LIST_TTL_MS old), or null. */
export const peekBirthdayList = () =>
  (listCache && listCache.uid === currentUid && listCache.day === localDay() ? listCache.data : null);

/** { month, day } for a profile, or null (hidden / under 13 / unknown). */
export async function getPublicBirthday(uid) {
  if (!uid) return null;
  const hit = publicCache.get(uid);
  if (hit && Date.now() - hit.at < PUBLIC_TTL_MS) return hit.data;
  const data = (await call('get_public_birthday', { p_uid: uid })) || null;
  publicCache.set(uid, { at: Date.now(), data });
  return data;
}

/** One templated wish per player per birthday. Returns { wishes }. */
export async function sendBirthdayWish(toUid, template) {
  const data = await call('send_birthday_wish', { p_to: toUid, p_template: template });
  if (listCache) {
    listCache = {
      ...listCache,
      data: listCache.data.map((b) => (b.uid === toUid ? { ...b, wished: true, wishes: data?.wishes ?? b.wishes + 1 } : b)),
    };
    save(listKey(), listCache);
  }
  emit();
  return data;
}

/**
 * Correct your birthday (day, month and year), once. functions/updateBirthday.js
 * does it: the RTDB rules keep the date write-once for the app. It refuses a
 * change into an older age group. Resolves { dateOfBirth }.
 */
export async function updateMyBirthday(year, month, day) {
  let data;
  if (__DEV__ && (mock || !currentUid)) {
    data = await require('./birthdayMock').default.update_my_birthday({ year, month, day });
  } else {
    const user = getAuth().currentUser;
    if (!user) throw new Error('sign in required');
    const token = await getIdToken(user);
    const res = await fetch(`${config.cloudFunctionsUrl}/updateBirthday`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ year, month, day }),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `http ${res.status}`);
  }
  homeCache = null;
  listCache = null;
  publicCache.clear();
  if (currentUid) { forget(homeKey()); forget(listKey()); }
  emit();
  return data;
}

/** True when this player has a (shown) birthday today. */
export const isBirthdayTodayUid = (uid) => !!uid && todaySet.has(uid);

// For the chat 🎂 badges: the Home call, at most once per app session (it is
// usually cached already). Every chat row asks, so a failure waits 10 min.
let todayLoad = null;
let todayLoadFailedAt = 0;
export const ensureBirthdaysTodayLoaded = () => {
  if (!currentUid && !__DEV__) return Promise.resolve();
  if (!todayLoad && Date.now() - todayLoadFailedAt > RETRY_AFTER_FAIL_MS) {
    todayLoad = getBirthdayHome().catch(() => {
      todayLoad = null;
      todayLoadFailedAt = Date.now();
    });
  }
  return todayLoad || Promise.resolve();
};
