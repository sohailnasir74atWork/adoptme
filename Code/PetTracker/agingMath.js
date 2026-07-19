/**
 * agingMath.js — pure math for the Pet Aging & Growing Tracker.
 *
 * No React/React-Native imports so the whole module runs under plain jest.
 * All functions take an optional `cfg` (the aging config JSON) and fall back
 * to the bundled default, so a CDN-served override can be threaded through
 * later without touching call sites.
 *
 * Slot model: { kind: 'pet' | 'neon', group: number, stage: 0-5, tasksDone: n }
 *  - stage 0..4 are the five aging stages; stage 5 means Full Grown/Luminous.
 *  - tasksDone counts progress inside the CURRENT stage only.
 *  - Neon slots exist because combining 4 Full Grown pets yields a neon at
 *    Reborn that must itself be aged to Luminous before a Mega — most public
 *    calculators skip this and undercount Mega grinds by 4 pet-equivalents.
 */

import DEFAULT_CONFIG from './agingConfig.default.json';

export const REGULAR_STAGES = ['newborn', 'junior', 'preteen', 'teen', 'postteen', 'fullgrown'];
export const NEON_STAGES = ['reborn', 'twinkle', 'sparkle', 'flare', 'sunshine', 'luminous'];
export const RARITIES = ['common', 'uncommon', 'rare', 'ultra-rare', 'legendary'];
export const GOALS = ['fullgrown', 'neon', 'mega'];
export const FULL_GROWN_STAGE = 5;

export const normalizeRarity = (rarity) => {
  const key = String(rarity || '').toLowerCase().trim();
  return RARITIES.includes(key) ? key : null;
};

// Unknown rarities (premium, event, missing data) fall back to legendary —
// the conservative table — but callers should prefer asking the user.
export const stageTasksFor = (rarity, cfg = DEFAULT_CONFIG) => {
  const key = normalizeRarity(rarity);
  return (key && cfg.stageTasks[key]) || cfg.stageTasks.legendary;
};

export const tasksForRarity = (rarity, cfg = DEFAULT_CONFIG) =>
  stageTasksFor(rarity, cfg).reduce((a, b) => a + b, 0);

export const stageNamesFor = (kind) => (kind === 'neon' ? NEON_STAGES : REGULAR_STAGES);

// ── Slots ──────────────────────────────────────────────────────────────

export const buildSlots = (goal) => {
  if (goal === 'neon') {
    return Array.from({ length: 4 }, () => ({ kind: 'pet', group: 0, stage: 0, tasksDone: 0 }));
  }
  if (goal === 'mega') {
    const slots = [];
    for (let g = 0; g < 4; g++) {
      for (let i = 0; i < 4; i++) slots.push({ kind: 'pet', group: g, stage: 0, tasksDone: 0 });
      slots.push({ kind: 'neon', group: g, stage: 0, tasksDone: 0 });
    }
    return slots;
  }
  return [{ kind: 'pet', group: 0, stage: 0, tasksDone: 0 }];
};

// One "pet equivalent" = one full aging run of the rarity's task total.
// Mega is 20, not 16: the 4 neons must re-age to Luminous.
export const petEquivalents = (goal) =>
  goal === 'mega' ? 20 : goal === 'neon' ? 4 : 1;

export const slotDone = (rarity, slot, cfg = DEFAULT_CONFIG) => {
  const stages = stageTasksFor(rarity, cfg);
  if (slot.stage >= FULL_GROWN_STAGE) return stages.reduce((a, b) => a + b, 0);
  let done = 0;
  for (let i = 0; i < slot.stage; i++) done += stages[i];
  return done + Math.min(Math.max(slot.tasksDone, 0), stages[slot.stage]);
};

export const slotRemaining = (rarity, slot, cfg = DEFAULT_CONFIG) =>
  tasksForRarity(rarity, cfg) - slotDone(rarity, slot, cfg);

/**
 * Add n tasks to a slot, carrying across stage boundaries.
 * +10 on a slot that needs 3 more for the stage advances the stage and
 * puts the remaining 7 into the next one. Returns a NEW slot object.
 */
export const addTasksToSlot = (rarity, slot, n, cfg = DEFAULT_CONFIG) => {
  const stages = stageTasksFor(rarity, cfg);
  let stage = slot.stage;
  let tasksDone = slot.tasksDone;
  let left = Math.max(0, Math.round(n));

  while (left > 0 && stage < FULL_GROWN_STAGE) {
    const needed = stages[stage] - tasksDone;
    if (left >= needed) {
      left -= needed;
      stage += 1;
      tasksDone = 0;
    } else {
      tasksDone += left;
      left = 0;
    }
  }
  return { ...slot, stage, tasksDone: stage >= FULL_GROWN_STAGE ? 0 : tasksDone };
};

export const finishStage = (rarity, slot, cfg = DEFAULT_CONFIG) => {
  if (slot.stage >= FULL_GROWN_STAGE) return slot;
  const stages = stageTasksFor(rarity, cfg);
  return addTasksToSlot(rarity, slot, stages[slot.stage] - slot.tasksDone, cfg);
};

/** Set a slot directly (edit modal). Clamps tasksDone into the stage bounds. */
export const setSlot = (rarity, slot, stage, tasksDone, cfg = DEFAULT_CONFIG) => {
  const stages = stageTasksFor(rarity, cfg);
  const s = Math.min(Math.max(0, stage), FULL_GROWN_STAGE);
  if (s >= FULL_GROWN_STAGE) return { ...slot, stage: FULL_GROWN_STAGE, tasksDone: 0 };
  // A stage's counter can sit at most 1 below completion — completing it is a stage-up.
  const max = Math.max(0, stages[s] - 1);
  return { ...slot, stage: s, tasksDone: Math.min(Math.max(0, Math.round(tasksDone)), max) };
};

// ── Grind-level aggregates ─────────────────────────────────────────────

export const grindTotals = (grind, cfg = DEFAULT_CONFIG) => {
  const perPet = tasksForRarity(grind.rarity, cfg);
  const total = perPet * petEquivalents(grind.goal);
  const done = grind.slots.reduce((sum, s) => sum + slotDone(grind.rarity, s, cfg), 0);
  const remaining = total - done;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return { total, done, remaining, pct, perPet };
};

export const potionEquivalent = (remaining, cfg = DEFAULT_CONFIG) =>
  Math.max(0, Math.ceil(remaining / (cfg.potionTasks || 30)));

export const applyPotions = (remaining, count, cfg = DEFAULT_CONFIG) =>
  Math.max(0, remaining - Math.max(0, count) * (cfg.potionTasks || 30));

export const etaDays = (remaining, tasksPerDay) => {
  if (!tasksPerDay || tasksPerDay <= 0) return null;
  return Math.ceil(Math.max(0, remaining) / tasksPerDay);
};

/**
 * Recommend the next slot to work on: the not-finished slot closest to done.
 * Pet slots win ties against neon slots (you need the ingredients first).
 */
export const recommendNextSlot = (grind, cfg = DEFAULT_CONFIG) => {
  let best = null;
  grind.slots.forEach((slot, index) => {
    const remaining = slotRemaining(grind.rarity, slot, cfg);
    if (remaining <= 0) return;
    if (
      !best ||
      remaining < best.remaining ||
      (remaining === best.remaining && slot.kind === 'pet' && best.kind === 'neon')
    ) {
      best = { index, remaining, kind: slot.kind };
    }
  });
  return best;
};

// ── Sessions / measured pace ───────────────────────────────────────────

export const localDateKey = (ms = Date.now()) => {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

/**
 * Average tasks/day over the last `windowDays` calendar days (today included),
 * counting only active days. Needs >= minActiveDays to trust the number,
 * otherwise returns null and callers fall back to the preset pace.
 */
export const measuredPace = (sessions, { windowDays = 7, minActiveDays = 3, now = Date.now() } = {}) => {
  if (!sessions) return null;
  const counts = [];
  for (let i = 0; i < windowDays; i++) {
    const key = localDateKey(now - i * 24 * 60 * 60 * 1000);
    const c = sessions[key];
    if (typeof c === 'number' && c > 0) counts.push(c);
  }
  if (counts.length < minActiveDays) return null;
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  return Math.round(avg * 10) / 10;
};

export const DEFAULTS = DEFAULT_CONFIG;
