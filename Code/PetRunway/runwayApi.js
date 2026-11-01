/**
 * runwayApi.js — Pet Runway events on Supabase (supabase/061_pet_runway_events.sql).
 *
 * Players: runway_calendar (approved events, cached 6 h on the phone per account; guests and
 * offline players get [] and the game keeps its built-in daily ideas).
 * Staff: runway_events_staff / _save / _approve / _cancel. The server decides who may do what
 * (MODs and admins create drafts, admins approve and cancel); the app only hides buttons.
 */

import { supabase } from '../Supabase/client';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'pet_runway' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k) };
}

const CALENDAR_TTL_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 864e5;

/** 'YYYY-MM-DD' (UTC) for today + n days. */
export const isoDay = (n = 0, now = Date.now()) => new Date((Math.floor(now / DAY_MS) + n) * DAY_MS).toISOString().slice(0, 10);
/** Whole days from a to b ('YYYY-MM-DD'). */
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

const isMissingFunction = (error) =>
  !!error && (error.code === 'PGRST202' || /Could not find the function|does not exist/i.test(error.message || ''));

async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args || {});
  if (error) throw error;
  return data;
}

/** Map a server error to a key under pet_runway_events.err_* */
export const errorKey = (e) => {
  if (isMissingFunction(e)) return 'err_not_ready';
  const m = String(e?.message || e || '');
  for (const k of ['overlap', 'bad_dates', 'not_staff', 'not_admin', 'not_yours', 'not_draft', 'sign_in']) {
    if (m.includes(k)) return k === 'bad_dates' ? 'err_dates' : k === 'sign_in' ? 'err_signin' : `err_${k}`;
  }
  return 'err_generic';
};

const calKey = (uid) => `calendar:${uid}`;

/** Cached calendar (may be stale); [] when there is none. */
export function cachedCalendar(uid) {
  if (!uid) return [];
  try {
    const c = JSON.parse(storage.getString(calKey(uid)) || 'null');
    return c && Array.isArray(c.list) ? c.list : [];
  } catch (e) {
    return [];
  }
}

/** Approved events from yesterday to 30 days ahead; cached 6 h unless force. */
export async function loadCalendar(uid, force = false) {
  if (!uid) return [];
  try {
    const c = JSON.parse(storage.getString(calKey(uid)) || 'null');
    if (!force && c && Array.isArray(c.list) && Date.now() - c.at < CALENDAR_TTL_MS) return c.list;
  } catch (e) { /* refetch */ }
  try {
    const list = await call('runway_calendar', { p_from: isoDay(-1), p_to: isoDay(30) });
    const clean = Array.isArray(list) ? list : [];
    storage.set(calKey(uid), JSON.stringify({ at: Date.now(), list: clean }));
    return clean;
  } catch (e) {
    return cachedCalendar(uid); // offline, or 061 not deployed yet
  }
}

export const staffEvents = () => call('runway_events_staff');

export const saveEvent = (e) => call('runway_event_save', {
  p_id: e.id || null,
  p_theme: e.theme,
  p_start: e.starts_on,
  p_end: e.ends_on,
  p_featured: { scenes: e.scenes || [], items: e.items || [] },
  p_style: { stamp: e.stamp || 'classic', banner: e.banner || '#FF4F9A' },
  p_prize: e.prize_tier === 'big' ? 'big' : 'normal',
  p_note: e.note || null,
});

export const approveEvent = (id) => call('runway_event_approve', { p_id: id });
export const cancelEvent = (id, reason) => call('runway_event_cancel', { p_id: id, p_reason: reason || null });
