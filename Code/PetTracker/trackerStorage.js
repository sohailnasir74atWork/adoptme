/**
 * trackerStorage.js — local-first persistence for the Pet Aging Tracker.
 *
 * Everything lives in a dedicated MMKV instance ('pet-tracker'); a "+1 task"
 * tap must never become a server write (see PET_AGE_TRACKER_PLAN.md §4.5).
 * A tiny listener set lets the home card and screens stay in sync without
 * any context/provider plumbing.
 */

import {
  addTasksToSlot,
  finishStage,
  setSlot,
  buildSlots,
  localDateKey,
  slotDone,
} from './agingMath';

let store = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  store = createMMKV({ id: 'pet-tracker' });
} catch (e) {
  console.warn('[trackerStorage] MMKV not available:', e.message);
}

const GRINDS_KEY = 'grinds';
const SESSIONS_KEY = 'sessions';
const DAILY_GOAL_KEY = 'daily_goal';
const SESSION_KEEP_DAYS = 45;

const readJSON = (key, fallback) => {
  try {
    const raw = store?.getString(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const writeJSON = (key, value) => {
  try {
    store?.set(key, JSON.stringify(value));
  } catch (e) {
    console.warn('[trackerStorage] write failed:', e.message);
  }
};

// ── Change listeners ───────────────────────────────────────────────────

const listeners = new Set();
export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const notify = () => listeners.forEach((fn) => { try { fn(); } catch {} });

// ── Grinds ─────────────────────────────────────────────────────────────

// Cached snapshot so getGrinds() is referentially stable between writes —
// required by useSyncExternalStore and avoids a JSON.parse per render.
let grindsCache = null;

export const getGrinds = () => {
  if (!grindsCache) grindsCache = readJSON(GRINDS_KEY, []);
  return grindsCache;
};

export const getGrind = (id) => getGrinds().find((g) => g.id === id) || null;

const saveGrinds = (grinds) => {
  grindsCache = grinds;
  writeJSON(GRINDS_KEY, grinds);
  notify();
};

export const createGrind = ({ petKey, petName, imageUrl, rarity, goal }) => {
  const grind = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    petKey,
    petName,
    imageUrl: imageUrl || '',
    rarity,
    goal,
    tasksPerDay: 30,
    potionsOwned: 0,
    slots: buildSlots(goal),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveGrinds([grind, ...getGrinds()]);
  return grind;
};

export const deleteGrind = (id) => {
  saveGrinds(getGrinds().filter((g) => g.id !== id));
};

const mutateGrind = (id, mutate) => {
  let updated = null;
  const grinds = getGrinds().map((g) => {
    if (g.id !== id) return g;
    updated = { ...mutate(g), updatedAt: Date.now() };
    return updated;
  });
  if (updated) saveGrinds(grinds);
  return updated;
};

export const updateGrindFields = (id, fields) => mutateGrind(id, (g) => ({ ...g, ...fields }));

/** Log n tasks on one slot; today's session counter gets the APPLIED delta
 *  (a +30 potion on a slot with 5 tasks left must only count 5). */
export const logTasks = (id, slotIndex, n, cfg) =>
  mutateGrind(id, (g) => {
    const slots = g.slots.slice();
    const before = slots[slotIndex];
    const after = addTasksToSlot(g.rarity, before, n, cfg);
    const delta = slotDone(g.rarity, after, cfg) - slotDone(g.rarity, before, cfg);
    if (delta > 0) bumpToday(delta);
    slots[slotIndex] = after;
    return { ...g, slots };
  });

/** Complete the slot's current stage; counts the finished tasks toward today. */
export const logFinishStage = (id, slotIndex, cfg) =>
  mutateGrind(id, (g) => {
    const slots = g.slots.slice();
    const before = slots[slotIndex];
    const after = finishStage(g.rarity, before, cfg);
    const delta = slotDone(g.rarity, after, cfg) - slotDone(g.rarity, before, cfg);
    if (delta > 0) bumpToday(delta);
    slots[slotIndex] = after;
    return { ...g, slots };
  });

/** Direct edit from the slot editor (corrections do NOT touch sessions). */
export const editSlot = (id, slotIndex, stage, tasksDone, cfg) =>
  mutateGrind(id, (g) => {
    const slots = g.slots.slice();
    slots[slotIndex] = setSlot(g.rarity, slots[slotIndex], stage, tasksDone, cfg);
    return { ...g, slots };
  });

// ── Daily sessions ─────────────────────────────────────────────────────

export const getSessions = () => readJSON(SESSIONS_KEY, {});

const pruneSessions = (sessions) => {
  const cutoff = Date.now() - SESSION_KEEP_DAYS * 24 * 60 * 60 * 1000;
  const cutoffKey = localDateKey(cutoff);
  const pruned = {};
  Object.keys(sessions).forEach((k) => {
    if (k >= cutoffKey) pruned[k] = sessions[k];
  });
  return pruned;
};

export const bumpToday = (n = 1) => {
  if (n <= 0) return;
  const sessions = pruneSessions(getSessions());
  const key = localDateKey();
  sessions[key] = (sessions[key] || 0) + Math.round(n);
  writeJSON(SESSIONS_KEY, sessions);
};

export const todayCount = () => getSessions()[localDateKey()] || 0;

// ── Daily goal ─────────────────────────────────────────────────────────

export const getDailyGoal = () => {
  const v = store?.getNumber(DAILY_GOAL_KEY);
  return v && v > 0 ? v : 40;
};

export const setDailyGoal = (n) => {
  try {
    store?.set(DAILY_GOAL_KEY, Math.max(5, Math.min(500, Math.round(n))));
  } catch {}
  notify();
};
