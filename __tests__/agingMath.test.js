import {
  tasksForRarity,
  normalizeRarity,
  buildSlots,
  petEquivalents,
  slotDone,
  slotRemaining,
  addTasksToSlot,
  finishStage,
  setSlot,
  grindTotals,
  potionEquivalent,
  applyPotions,
  etaDays,
  recommendNextSlot,
  measuredPace,
  localDateKey,
  FULL_GROWN_STAGE,
} from '../Code/PetTracker/agingMath';

const slot = (stage, tasksDone, kind = 'pet', group = 0) => ({ kind, group, stage, tasksDone });

describe('rarity tables', () => {
  test('totals match community-verified numbers', () => {
    expect(tasksForRarity('common')).toBe(56);
    expect(tasksForRarity('uncommon')).toBe(80);
    expect(tasksForRarity('rare')).toBe(120);
    expect(tasksForRarity('ultra-rare')).toBe(160);
    expect(tasksForRarity('legendary')).toBe(275);
  });

  test('unknown rarity falls back to legendary table', () => {
    expect(normalizeRarity('Premium')).toBeNull();
    expect(tasksForRarity('premium')).toBe(275);
  });

  test('rarity normalization is case/space tolerant', () => {
    expect(normalizeRarity(' Ultra-Rare ')).toBe('ultra-rare');
    expect(tasksForRarity('LEGENDARY')).toBe(275);
  });
});

describe('goal structure', () => {
  test('full grown = 1 slot, neon = 4 pet slots', () => {
    expect(buildSlots('fullgrown')).toHaveLength(1);
    const neon = buildSlots('neon');
    expect(neon).toHaveLength(4);
    expect(neon.every((s) => s.kind === 'pet')).toBe(true);
  });

  test('mega = 4 groups of 4 pets + 1 neon slot (neon re-aging counted)', () => {
    const mega = buildSlots('mega');
    expect(mega).toHaveLength(20);
    expect(mega.filter((s) => s.kind === 'pet')).toHaveLength(16);
    expect(mega.filter((s) => s.kind === 'neon')).toHaveLength(4);
    [0, 1, 2, 3].forEach((g) => {
      expect(mega.filter((s) => s.group === g)).toHaveLength(5);
    });
  });

  test('pet-equivalent totals: legendary neon 1100, legendary mega 5500', () => {
    expect(petEquivalents('neon') * tasksForRarity('legendary')).toBe(1100);
    expect(petEquivalents('mega') * tasksForRarity('legendary')).toBe(5500);
  });
});

describe('slot math', () => {
  test('done/remaining inside a stage', () => {
    // common junior (stage 1): 3 done in newborn + 2 in junior
    expect(slotDone('common', slot(1, 2))).toBe(5);
    expect(slotRemaining('common', slot(1, 2))).toBe(51);
  });

  test('full grown slot has zero remaining', () => {
    expect(slotRemaining('legendary', slot(FULL_GROWN_STAGE, 0))).toBe(0);
  });

  test('addTasks carries across stage boundaries', () => {
    // common newborn needs 3 → +5 lands at junior with 2 done
    const next = addTasksToSlot('common', slot(0, 0), 5);
    expect(next.stage).toBe(1);
    expect(next.tasksDone).toBe(2);
  });

  test('addTasks clamps at full grown', () => {
    const next = addTasksToSlot('common', slot(0, 0), 999);
    expect(next.stage).toBe(FULL_GROWN_STAGE);
    expect(next.tasksDone).toBe(0);
    expect(slotRemaining('common', next)).toBe(0);
  });

  test('finishStage completes exactly the current stage', () => {
    // rare teen (stage 3) needs 30, 10 done → finish → post-teen 0
    const next = finishStage('rare', slot(3, 10));
    expect(next.stage).toBe(4);
    expect(next.tasksDone).toBe(0);
  });

  test('setSlot clamps tasksDone below stage completion', () => {
    const s = setSlot('common', slot(0, 0), 1, 999); // junior max 6 → clamp to 5
    expect(s.stage).toBe(1);
    expect(s.tasksDone).toBe(5);
  });
});

describe('grind aggregates', () => {
  test('progress percent and remaining', () => {
    const grind = { rarity: 'common', goal: 'fullgrown', slots: [slot(FULL_GROWN_STAGE, 0)] };
    expect(grindTotals(grind)).toMatchObject({ total: 56, done: 56, remaining: 0, pct: 100 });
  });

  test('mega grind total uses 20 pet-equivalents', () => {
    const grind = { rarity: 'legendary', goal: 'mega', slots: buildSlots('mega') };
    expect(grindTotals(grind).total).toBe(5500);
  });

  test('potions round up and apply', () => {
    expect(potionEquivalent(31)).toBe(2);
    expect(applyPotions(100, 2)).toBe(40);
    expect(applyPotions(50, 9)).toBe(0);
  });

  test('eta needs a positive pace', () => {
    expect(etaDays(213, 43)).toBe(5);
    expect(etaDays(213, 0)).toBeNull();
  });

  test('recommendation picks the closest-to-done unfinished slot', () => {
    const grind = {
      rarity: 'common',
      goal: 'neon',
      slots: [slot(FULL_GROWN_STAGE, 0), slot(1, 2), slot(4, 10), slot(0, 0)],
    };
    expect(recommendNextSlot(grind).index).toBe(2); // post-teen, 10 remaining
  });
});

describe('measured pace', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  test('averages active days within the window', () => {
    const sessions = {
      [localDateKey(now)]: 40,
      [localDateKey(now - DAY)]: 50,
      [localDateKey(now - 2 * DAY)]: 30,
    };
    expect(measuredPace(sessions, { now })).toBe(40);
  });

  test('returns null under 3 active days', () => {
    const sessions = { [localDateKey(now)]: 40, [localDateKey(now - DAY)]: 50 };
    expect(measuredPace(sessions, { now })).toBeNull();
  });

  test('ignores days outside the window', () => {
    const sessions = {
      [localDateKey(now)]: 10,
      [localDateKey(now - DAY)]: 10,
      [localDateKey(now - 20 * DAY)]: 900,
    };
    expect(measuredPace(sessions, { now })).toBeNull();
  });
});
