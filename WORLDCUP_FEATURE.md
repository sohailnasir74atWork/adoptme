# World Cup 2026 Predictor — Phase 1 (handoff)

A daily **prediction game** (not a live-scores product) themed on the FIFA World Cup
2026 (11 Jun → 19 Jul 2026). Users pick winners, see what the community thinks, and
come back to find out if they called it. Built to fit existing app conventions:
RNFirebase Firestore, `useThemeColors`, the "More" top-tabs, and the v1 scheduled-CF
pattern. **All data lives in Firestore** (zero Supabase realtime impact).

## What shipped

| File | Purpose |
|---|---|
| `Code/WorldCup/WorldCupScreen.jsx` | The screen: today strip, prediction cards w/ voting, recent results |
| `Code/WorldCup/worldCupHelpers.js` | Pure helpers (flag emoji, formatting, % math, pick outcome) |
| `Code/ValuesScreen/TopTabs.js` | Adds "World Cup" as the **first** tab under the **More** bottom tab |
| `Code/HomeTab/HomeTabScreen.jsx` | Adds a "World Cup" ⚽ quick-action tile on Home → jumps to More |
| `functions/fetchWorldCupData.js` | The data updater (scheduled + on-demand). **You deploy this.** |

## Firestore schema (the contract)

```
wc2026_meta/feed         → { today:[Match], upcoming:[Match], recent:[Match], generatedAt, source }
wc2026_predictions/{id}  → { home:Number, draw:Number, away:Number }   // incremented by clients
wc2026_user_picks/{uid}  → { picks:{ [matchId]: 'home'|'draw'|'away' }, updatedAt }
```

`Match = { id, date, kickoffISO, group, round, ground, status, team1, team2, code1, code2,
score1, score2, votes:{home,draw,away} }` — `status` is `scheduled|live|finished`, `codeN`
is an ISO-3166 alpha-2 (or null for placeholders like "Winner Group A").

**Cost design:** the whole screen reads from **one** doc (`wc2026_meta/feed`) via a single
`onSnapshot` + one `getDoc` for the user's own picks. Votes write to **per-match** docs
(`wc2026_predictions/{id}`) to spread write load past Firestore's ~1 write/sec/doc limit.
The CF folds the tallies back into the feed doc, so showing community % costs no extra reads.

## Deploy steps (your CF environment)

1. Copy `functions/fetchWorldCupData.js` into your deploy env and add its exports to your
   `index.js` (this repo's `functions/index.js` lives in your separate env):
   ```js
   const wc = require('./fetchWorldCupData');
   exports.fetchWorldCupDataScheduled = wc.fetchWorldCupDataScheduled; // pubsub, every 30 min
   exports.fetchWorldCupDataNow = wc.fetchWorldCupDataNow;             // https, manual seed
   ```
2. Deploy: `firebase deploy --only functions:fetchWorldCupDataScheduled,functions:fetchWorldCupDataNow`
3. **Seed immediately** (don't wait 30 min for the first schedule): open
   `https://us-central1-adoptme-7b50c.cloudfunctions.net/fetchWorldCupDataNow` once.
   It returns `{ ok:true, today, upcoming, recent }` and the screen populates.

No Firestore composite index is required (all reads are single-doc).

## Firestore security rules to add

```
match /wc2026_meta/{doc}        { allow read: if true;  allow write: if false; } // CF-only via admin
match /wc2026_predictions/{id}  { allow read: if true;
                                  allow write: if request.auth != null; }        // authed increments
match /wc2026_user_picks/{uid}  { allow read, write: if request.auth != null
                                                     && request.auth.uid == uid; }
match /wc2026_scores/{uid}      { allow read: if true;                            // leaderboard inputs
                                  allow write: if request.auth != null
                                               && request.auth.uid == uid; }
```
(`wc2026_meta` is written by the Admin SDK, which bypasses rules — `write:false` just blocks clients.)

## Phase 2: scoring & leaderboard (self-score + leaderboard)

- **Points:** 10 per correct pick (`POINTS_PER_CORRECT`). The CF writes a compact
  `results` map (matchId → winner) into `wc2026_meta/feed`; the client computes each
  user's score **on-device for free** from `picks × results` — no scoring fan-out, no
  per-match reads.
- **Leaderboard:** each client self-reports its score to `wc2026_scores/{uid}` (1 write
  only when the score changes). A scheduled CF builds the top-100 cache at
  `wc2026_meta/leaderboard`, which every client reads as **one** doc.
  - Cost note: the CF's `orderBy('points').limit(100)` bills only the **100 docs
    returned**, not the whole collection — so it stays cheap at any player count.
  - Trust: scores are client-reported (acceptable for this audience); can be made
    server-authoritative later if abuse appears.

Wire the extra export too:
```js
exports.updateWorldCupLeaderboard = wc.updateWorldCupLeaderboard; // pubsub, hourly
```
Deploy adds: `firebase deploy --only functions:updateWorldCupLeaderboard`

## Phase 3: champion pick · share card · highlights

- **Predict the Champion** — pick the tournament winner from `feed.teams` (a unique
  team list the CF now adds). Stored in the **existing** `wc2026_user_picks/{uid}` doc
  (new `champion` field) — so **no new collection and no new rule needed**.
- **Share card** — a branded card (champion + points + picks) captured with
  `react-native-view-shot` and shared via `react-native-share` (same libs/pattern as
  `ShareTradeModal`). Renders & shares **on-device** — zero server cost. Free user-acquisition loop.
- **Highlights** — a "▶ Highlights" button on finished matches that deep-links to a
  **YouTube search** (`Linking.openURL`). No embedding → rights-safe, zero cost.

**Deploy impact: none beyond Phase 2.** Phase 3 adds no new Cloud Function and no new
Firestore collection/rule — only the `teams[]` field in the feed (already produced by
the redeployed `fetchWorldCupData`) plus JS-only client changes (ship in the next build).

## Monetization on the screen

- **Rewarded "2× points" boost** — on a voted, pre-kickoff prediction card: *"🔥 Double my
  points · watch ad"*. Non-Pro watches a rewarded ad (`RewardedAdManager.show()`); Pro gets
  it free (no ad). Earned boosts are stored in `wc2026_user_picks/{uid}.boosts` and doubled
  on-device by `computeScore` when that pick wins. Opt-in only.
- **Native ad cards** — two full-width `<NativeAdCard>` slots (after "Make Your Picks" and
  after "Results"). They collapse to nothing when unfilled, so no empty boxes.
- **Banner** — one collapsible banner under the hero (already present).
- All ad surfaces are **Pro-gated** (`localState.isPro` → no native cards, free boost).
- Biggest earner is indirect: the daily-habit loop lifts DAU/session frequency, multiplying
  ad impressions app-wide. (`RewardedAdManager` is already initialised in `App.js`.)

## Kill switch (retire the feature after the tournament)

A single RTDB boolean hides the **entire** feature (the More→World Cup tab *and* the
Home tile) — read once at app start in `GlobelStats` and exposed as `worldCupEnabled`.

- **Default = ON.** The feature shows unless the flag is explicitly `false`. A missing
  node, a denied read, or being offline all leave it ON (it never vanishes by accident).
- **To retire it:** set RTDB `/worldcup_enabled = false` (Firebase console or backend).
  Takes effect on each user's next app launch.

⚠️ **Required RTDB rule** (rules here are per-node with no root default-read, so a new
node is denied until you add this — without it the switch can't be read and the feature
just stays ON):
```
"worldcup_enabled": { ".read": true, ".write": false }
```
The read is fully isolated in its own effect, so even without the rule it can NEVER
affect the other remote flags (`api`, `free_translation`, `single_offer_wall`).

(Local helper to flip it while testing: `node functions/setWorldCupFlag.local.js false|true|delete`.)

## Local test helpers (NOT deployed)
- `functions/seedWorldCup.local.js` — `node functions/seedWorldCup.local.js` seeds the feed doc.
- `functions/seedWorldCupDemoLeaderboard.local.js` — seeds 5 demo score rows + builds the
  leaderboard cache to preview the UI. Undo with `--clean`. **Delete the `demo_*` rows
  (or run --clean) before release.**

## Data source & upgrade path

- **Default:** `openfootball/worldcup.json` — public domain, **no API key**, works on deploy.
  Results can lag the live match by a few hours; fine for a prediction game.
- **Fresher data:** set env `WC_SOURCE_URL` to any endpoint returning the same `{matches:[...]}`
  shape, or implement an API-Football adapter in `buildMatches()` (guard on `APIFOOTBALL_KEY`).
  API-Football's free tier (100 req/day) is plenty since only the CF calls it.

## Roadmap (not in Phase 1)

- **Phase 2 — retention loop:** award points when a match finishes (new CF triggered on the
  feed/result), prediction streaks, a leaderboard (reuse `updateLeaderboardCache` pattern),
  a "watch ad to 2× points" rewarded hook, and two opt-in pushes ("lock your picks", "you
  called it!"). Picks are already persisted in `wc2026_user_picks` for retroactive scoring.
- **Phase 3 — knockouts (from ~28 Jun):** one-shot bracket challenge + shareable result card
  for WhatsApp/Instagram; highlight link-outs (official YouTube) on finished matches.

## Notes / guardrails

- Audience is kids/teens (`MaxAdContentRating.T`): **no betting odds, no real money** — points/XP only.
- Voting is **locked** after one pick per match (no vote-changing) — simplest correct UX for MVP.
- Live scores are intentionally coarse (30-min refresh); we don't compete with FotMob/TikTok.
