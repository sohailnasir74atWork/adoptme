# Pet Aging & Growing Tracker — Feature Plan

Competitor apps ship this as a paid feature. We ship it free (or teaser-locked) as a
retention driver: it turns the weeks-long Neon/Mega grind into a checklist with a
finish line, and the live task clock gives kids a reason to open the app every session.

---

## 1. What the tool does (elevator)

A kid picks a pet, tells the app what they're grinding for (Full Grown / Neon / Mega),
and the app tracks every copy of that pet across the grind:

- "You need 3 more Full Grown Frost Dragons — ~610 tasks left — about 12 days at your pace."
- Live task clock: "🏕️ Camping in 4 min", "🏥 Sick task at :30."
- Progress rings per pet slot, potion equivalents, and a daily-pace estimate.

Everything is client-side math over a small static table. No backend writes.

---

## 2. Game mechanics the tool is built on (verified July 2026)

### 2.1 Growth stages & task counts per rarity

Stages: Newborn → Junior → Pre-Teen → Teen → Post-Teen → Full Grown.
Neon stages (same task counts, renamed): Reborn → Twinkle → Sparkle → Flare → Sunshine → Luminous.

Tasks required to COMPLETE each stage:

| Rarity     | Newborn | Junior | Pre-Teen | Teen | Post-Teen | Total FG |
|------------|---------|--------|----------|------|-----------|----------|
| Common     | 3       | 6      | 11       | 16   | 20        | **56**   |
| Uncommon   | 5       | 9      | 15       | 20   | 31        | **80**   |
| Rare       | 10      | 14     | 21       | 30   | 45        | **120**  |
| Ultra-Rare | 10      | 15     | 25       | 41   | 69        | **160**  |
| Legendary  | 15      | 26     | 43       | 72   | 119       | **275**  |

- Neon = 4 Full Grown pets of the same type → total = 4 × FG total.
- Mega Neon = 4 Luminous neons = 16 Full Grown pets → total = 16 × FG total
  (Legendary Mega = 4,400 tasks).
- Age-Up Potion ≈ 30 tasks (Legendary FG ≈ 10 potions).
- Community pace baselines: casual ≈ 30 tasks/day, grinder 100+/day.
- Pet Pen (June 2026): AFK-ages up to 4 pets; completes whole levels.

### 2.2 Task types

- **Blue (anytime):** Hungry, Thirsty, Sleepy, Dirty + pet-only: Catch, Potty, Ride,
  Walk, Pet Me. Every task = 1 point regardless of type.
- **Orange (clock-based):**
  - Camping — every real hour at **:27 and :57** (always paired with Sleepy)
  - Sick/Hospital — at **:00 and :30**
  - One rotation task per in-game day (10 real minutes, days start at :00/:10/:20…):
    **Bored → School → Beach Party → Pizza Party → Salon** (fixed cycle; app learns the
    phase by asking the kid which orange task they last got).

Sources: adoptme.fandom.com (Gameplay, Neon Pets, Mega Neons + task-schedule threads),
progameguides.com, findingdulcinea.com, bloxultra.com calculator. Two+ sources agree on
every number above.

---

## 3. User experience

### 3.1 Entry points

1. **Home tab promo card** (like the competitor's screenshot): "Pet Aging & Growing
   Tracker — Plan Neon & Mega grinds" → navigates to tracker. Placed under Market
   Overview.
2. Optional: quick-action icon on home + a link from a pet's detail sheet in Values
   ("Track this pet ▸" — pre-fills the pet).

### 3.2 Screens

**A. My Grinds (list screen)**
- Cards: pet image + name, goal badge (FG / Neon / Mega), overall progress ring,
  "tasks left" + "≈ days left".
- Empty state: friendly explainer + "Start a grind" CTA.
- FAB / header button → New Grind.

**B. New Grind (modal or screen)**
1. Pick pet — reuse existing pet search/list + images from values data;
   `item.rarity` auto-fills rarity (manual override picker for safety).
2. Pick goal — Full Grown (1 pet) / Neon (4) / Mega (16), with task totals shown
   live as they choose.
3. Optional: mark pets they already have ("I already have 2 Full Grown") via
   quick-add.

**C. Grind detail**
- Header: pet image, goal, big progress ring with **percentage first**
  ("78% · 213 tasks left") — % everywhere, raw numbers second.
- **Slot grid**: 1, 4, or 16 tiles. Each tile = pet copy with stage name + a real
  progress bar (`██████░░░░ Teen 12/72`), not just numbers.
- **Fast input — never force hundreds of +1 taps** (top review finding):
  - Increment chips: **+1 · +5 · +10**
  - **Age-Up Potion (+30)**
  - **Finish stage** (completes remaining tasks in current stage)
  - Long-press bar → type exact tasksDone (fix mistakes)
  - Optional task-type chips (🏕️ Camping ✓, 🍕 Pizza ✓ …) — each adds +1 and
    feeds session stats/rotation phase for free
- Summary row: % · tasks left · potion equivalent · ETA.
- **Smart recommendation line** (pure client rule): "3 Full Grown, 1 Teen — age
  the Teen next, ≈2 days." Always suggest the slot closest to done.
- Pace for ETA: measured pace when history exists (see 3.4), else preset chips
  "Chill ~30/day · Regular ~60 · Grinder ~100+".
- **Pet Pen toggle**: dual estimate "Grinding: 12 days · with Pet Pen: ~7 days"
  (multiplier comes from CDN config so we can tune it; clearly labeled estimate).
- Mega view groups slots 4×4 ("Neon #1…#4") so the kid sees which neon is closest.
- **Potion planner**: kid enters how many Age-Up Potions they own (manual — no
  game inventory API exists); app shows "Use 8 → 35 tasks left."

**D. Task Clock (tab within tracker, or collapsible card on grind detail)**
- Live countdowns from device clock: next Camping (:27/:57), next Sick (:00/:30),
  next rotation task (every 10 min) with predicted type once the kid taps
  "which orange task did you just get?" once per session.
- Per-task tips ("Dirty → bathtub at home", "Bored → playground or piano").
- Optional toggle: "Remind me before Camping" → notifee local notification
  ~3 min before :27/:57 (only while enabled; auto-expire after a few hours so we
  never spam overnight).
- **Motivational notifications** (all local, all opt-in, hard-capped ~2/day):
  - Milestone: "Only 14 tasks until Full Grown! 🎉" (scheduled client-side when a
    slot crosses a threshold)
  - Pace: "18 more tasks today keeps you on track for Saturday." (from daily goal)
  - Copy lives in i18n; cadence caps in CDN config so we can dial down remotely.

### 3.3 Daily grind sessions & history (biggest retention lever)

Lifetime progress alone isn't sticky — daily goals are.

- **Today's Grind card**: every logged task also increments today's counter.
  `Today ███████░░░ 27/40 · 68%`. Kid sets their own daily goal (default from
  pace preset). Confetti + XP on hitting it.
- **Grind history**: last 30 days of daily counts (tiny MMKV map
  `{ '2026-07-19': 48, ... }`). Simple bar list: "Yesterday 48 · Monday 35 ·
  Weekly average 46/day."
- **Measured pace → smarter ETA**: once ≥3 active days exist, ETA switches from
  the preset to the kid's real average ("Your pace: 43/day → 8.2 days"), which
  keeps estimates honest and personal. Falls back to preset if they lapse.
- **Streaks** (optional v1.2): reuse the existing streak/XP patterns.

### 3.4 Home tab live card

Once a grind exists, the promo card upgrades to a **live mini-widget** (no
navigation needed to get value):

```
🐉 Frost Dragon   73%
🏕️ Camping in 8m · 82 tasks left     Continue →
```

Reads straight from MMKV — instant, offline, zero network. A true OS
home-screen widget (Android AppWidget / iOS WidgetKit) is native work in a bare
RN app — parked as a future enhancement, NOT in v1.x scope.

### 3.5 Gamification hooks (reuse existing systems)

- Award app XP (`xpUtils`) for daily tracker check-ins / completing a stage.
- Confetti (existing lottie assets) when a slot hits Full Grown / grind completes.
- Share card ("I finished my Mega Frost Dragon grind! 🎉") → existing share flow.

---

## 4. Architecture

### 4.1 Math engine — `Code/PetTracker/agingMath.js` (pure functions)

```js
STAGE_TASKS = {
  common:    [3, 6, 11, 16, 20],
  uncommon:  [5, 9, 15, 20, 31],
  rare:      [10, 14, 21, 30, 45],
  'ultra-rare': [10, 15, 25, 41, 69],
  legendary: [15, 26, 43, 72, 119],
}
GOAL_PETS = { fullgrown: 1, neon: 4, mega: 16 }
POTION_TASKS = 30

tasksForRarity(rarity)            // sum of stage array
remainingForSlot(rarity, stageIndex, tasksDoneInStage)
remainingForGrind(grind)          // sum over slots + un-started slots
progressPct(grind)                // shown everywhere, numbers second
measuredPace(sessions)            // avg of active days; null if < 3 days
etaDays(remaining, pace)          // pace = measuredPace ?? tasksPerDay preset
etaWithPetPen(remaining, pace, config.petPenMultiplier)
potionEquivalent(remaining)       // ceil(remaining / 30)
applyPotions(grind, count)        // potion planner math
recommendNextSlot(grind)          // closest-to-done slot + reason string
nextClockEvents(now, rotationPhase) // camping/sick/rotation countdowns
```

Unit-testable in isolation (jest is already configured).

### 4.2 Storage — local-first MMKV

New MMKV instance `pet-tracker`:

```js
grinds: [{
  id, petKey, petName, imageUrl, rarity,
  goal: 'fullgrown' | 'neon' | 'mega',
  tasksPerDay: 30,                          // preset fallback pace
  potionsOwned: 0,                          // manual potion planner
  usePetPen: false,
  slots: [{ stage: 0-5, tasksDone: n }],   // length 1/4/16
  createdAt, updatedAt,
}]
sessions: { '2026-07-19': 27, ... }         // daily task counts, ~30 days kept
dailyGoal: 40
rotationPhase: { taskIndex, atMs }          // last-seen orange task, for prediction
```

- No login required — works logged-out (like TrendingPets).
- v2 (optional): sync `grinds` as ONE JSON blob under the user's existing RTDB
  profile node, written on change (debounced) and read once at login. Explicitly
  NOT Supabase — no new tables, no RLS, and above all no realtime channels (the
  Supabase bill is realtime-driven). Not MVP.

### 4.3 Remote config — how numbers stay correct WITHOUT app releases

This is the "keep it updated" half. The table and the clock schedule are game data
that Adopt Me occasionally rebalances, so they must not be hardcoded-only.

1. **Bundled default** `Code/PetTracker/agingConfig.default.json` — app always works
   offline / first launch.
2. **CDN override** — new file on the existing BunnyCDN (same pattern as
   `check-diff-adoptme.b-cdn.net/diff.json`), e.g.
   `https://<zone>.b-cdn.net/aging-config.json`:

```json
{
  "version": 3,
  "updatedAt": "2026-07-19",
  "stageTasks": { "common": [3,6,11,16,20], ... },
  "potionTasks": 30,
  "paceOptions": [30, 60, 100],
  "clock": {
    "enabled": true,
    "campingMinutes": [27, 57],
    "sickMinutes": [0, 30],
    "dayLengthMin": 10,
    "rotation": ["bored","school","beach_party","pizza_party","salon"]
  },
  "notes": ""
}
```

3. **Fetch layer** — copy the proven `analyticsDataHelper` pattern: MMKV cache +
   TTL (24 h is plenty) + in-flight dedup + silent fallback to bundled default on
   any fetch/parse error. Higher `version` wins. **Fetch lazily** — only when the
   tracker (or its home card) first mounts, never at app boot, so cold-start
   network burst doesn't grow.
4. **Kill switches — inside the CDN JSON, NOT new RTDB paths** (cost decision):
   - `"enabled": false` at the top level hides the whole feature;
     `clock.enabled: false` hides just the task clock (wrong clock predictions are
     worse than none).
   - Living in the CDN config we already fetch means zero extra RTDB
     listeners/bandwidth. Only fall back to an RTDB flag if we ever need
     sub-minute reaction time (we won't for this).

### 4.4 Update/verification routine (operational)

- **Watch sources:** Adopt Me patch notes (X/@PlayAdoptMe, adoptme.com/news),
  adoptme.fandom.com wiki "Ages"/"Ailments" pages, big community threads. Trigger
  words: "pet XP", "aging", "needs", "tasks", "Pet Pen".
- **Cadence:** 5-minute check after every major Adopt Me update (they ship weekly
  Thursdays; aging rebalances are rare — a few times a year).
- **On change:** edit `aging-config.json` on the CDN, bump `version` — every app
  picks it up within the TTL. No store release, no CF deploy.
- **Assisted:** a monthly Claude scheduled task can re-run the verification
  searches and flag drift against the current JSON (ask and I'll set it up).
- In-app safety valve: tiny "numbers look wrong?" link → prefilled feedback,
  so players themselves become the alarm.

---

## 4.5 Infra cost budget (design constraint, not afterthought)

Target: the feature adds ≈ $0/month at current scale. How each bill stays flat:

| Service | Usage by this feature | Cost impact |
|---------|----------------------|-------------|
| **Supabase** | **None.** No tables, no RLS, no realtime channels, no functions. All progress is device-local MMKV. | $0 |
| **Firebase RTDB** | **None in MVP.** Kill switches live in the CDN JSON (no new listeners). v2 sync, if ever built, is one debounced JSON blob per user under the existing profile node — bandwidth measured in bytes. | $0 (MVP) |
| **Cloud Functions / FCM** | **None.** Reminders are notifee LOCAL notifications scheduled on-device; no push pipeline, no scheduled CFs. | $0 |
| **Firestore** | None. | $0 |
| **BunnyCDN** | One ~1 KB minified `aging-config.json`, fetched at most once per 24 h per active user, only when the tracker mounts. 100k DAU ≈ ~3 GB/mo ≈ pennies. Pet images reuse the existing values-CDN URLs already cached by the app. | ~ $0 |

Standing rules for anyone extending the feature:
- Never subscribe a realtime channel for tracker data.
- Never add a per-user server write path for progress ticks (a "+1 task" must stay
  a local MMKV write; kids tap it hundreds of times).
- New remote data goes in the existing CDN JSON, versioned — not a new endpoint,
  not RTDB.

## 5. i18n

~25 new keys under `tracker.*` in all 5 files (en/ar/de/es/fr), following existing
tone (informal de/es, vous-form fr). Includes stage names, task names, goal names,
CTA/teaser strings, notification copy. Stage/task names come from the game and stay
recognizable — translate the UI copy, keep proper nouns ("Neon", "Mega") as-is.

## 6. Monetization / positioning

- **Free + teaser beats paywall here**: competitor charges, so "free grind tracker"
  is an acquisition/retention story (ASO keywords: "adopt me neon tracker",
  "mega neon calculator").
- Natural upsells without paywalling the core: Pro removes banner on tracker
  screens (existing behavior), rewarded ad to unlock >2 simultaneous grinds or
  camping notifications, home-card lock teaser (same pattern as Market Overview).

## 7. Build phases

| Phase | Scope | Est. |
|-------|-------|------|
| **MVP** | agingMath + bundled config, My Grinds + New Grind + Grind Detail with fast input (+1/+5/+10/potion/finish-stage), visual bars + % everywhere, daily-goal ring + sessions history + measured-pace ETA, home live card, i18n, jest tests for math | 2–3 days |
| **v1.1** | Task Clock + rotation prediction + camping reminders, CDN config override + kill switches, recommendation line, potion planner, Pet Pen dual ETA | ~1 day |
| **v1.2** | Motivational notifications, streaks + XP/confetti/share hooks, rewarded-ad gates, profile sync (RTDB blob) | ~1 day |
| Future | Native OS home-screen widget (AppWidget/WidgetKit) — separate native effort | — |

Daily sessions moved INTO the MVP deliberately: it's the single biggest
daily-open driver and costs little once the input layer exists.

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Game rebalances task counts (it happened in late 2025) | CDN config override, version field, bundled fallback |
| Orange-task timing/rotation is community lore, not a stable API — historically has shifted | Treat the clock as best-effort: `clock.enabled` kill switch, schedule values in CDN config, clock is additive so core math never depends on it |
| Pet Pen aging rate unknown/variable | Shown as clearly-labeled estimate; multiplier lives in CDN config |
| Kids mis-tap progress | stage stepper is forgiving (can go back), long-press to edit tasksDone directly |
| Notification fatigue / stores' kids policies | reminders strictly opt-in, auto-expire, local-only (no push infra) |
| Rarity data missing for some pets | manual rarity picker fallback in New Grind |
