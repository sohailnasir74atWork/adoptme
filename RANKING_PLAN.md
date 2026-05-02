# Play Store Ranking Plan — Adopt Me Values Calc

Generated 2026-05-02 from 28-day Play Console data + code audit.
Current build: **1.11.3 (versionCode 103)**.

---

## Diagnosis snapshot

| Lever | Status | Direction |
|-------|--------|-----------|
| Crash rate | 0.08-0.79% per version, **trending down** | ✅ |
| ANR rate | 248 active ANRs from FCM broadcast through v101 | ❌ |
| Slow start (warm) | 1.11.1: 4.32% — **best ever** | ✅ |
| Slow start (cold) | 1.11.1: 0.91% — **best ever** | ✅ |
| Listing conversion | 35-37% vs peer 38-39% | ⚠️ |
| LATAM acquisition | Brazil/Argentina/Chile/Venezuela -40% | ❌ |
| Low-conv markets | ID 19%, TR 17%, PK 15%, BD 11%, NG 9% | ❌ |
| App size (AAB) | 77 MB (download ~35-40 MB per ABI) | ⚠️ |
| Deprecated APIs | 4 edge-to-edge calls flagged for Android 15 | ⚠️ |

> **Note:** my earlier "warm-start regression" call was a mix-shift artifact. Per-version data shows 1.11.1 is your best build. No regression to fix.

---

## Top 6 active vitals issues (from `errorIssues:search`)

| # | Type | Cause | Reports | Last seen |
|---|------|-------|---------|-----------|
| 1 | ANR | `MessageQueue.nativePollOnce` — FCM broadcast | 141 | v101 |
| 2 | CRASH | Fabric `SurfaceMountingManager.getViewState` | 135 | **v103 (current)** |
| 3 | CRASH | `MainApplication.getPackages UnsatisfiedLinkError` | 107 | v101 |
| 4 | ANR | `MainApplication.onCreate` — FCM cold start | 66 | v101 |
| 5 | ANR | `BlendModeHelper`, `ReactTextView` input-dispatching | 62 | v103 |
| 6 | CRASH | RTDB `RejectedExecutionException` (executor exhausted) | 46 | v88 |

---

## Action plan — prioritized

### P0 — direct ranking lift (this week)

**You (Play Console / business work):**
- [ ] Localize Play listing for ID, TR, PK, BD, NG, EG (translated title + short desc + 3 screenshots)
- [ ] Investigate LATAM drop — Brazil/Argentina/Chile/Venezuela all -40%
- [ ] Replicate Apr 11 (1.8.9) listing — that day hit 45.54% conversion vs 35-37% baseline

**Code (this week):**
- [x] **Slim FCM background handler** — split into thin [index.js](index.js) (loaded on every wake, including FCM headless) + heavy [AppEntry.js](AppEntry.js) (lazy-required only in foreground). Kills 248 ongoing ANRs from `MainApplication.onCreate` boot via FCM broadcast.
- [ ] **Fix Fabric `getViewState` crash** — 135 crashes still on v103

### P1 — vitals + reproducible bugs + perf polish

- [ ] Fix `UnsatisfiedLinkError` ABI mismatch (146 crashes / 19 users) — likely native lib in only one ABI
- [ ] Consolidate RTDB listeners — fixes `RejectedExecutionException` + warm-start cost
- [ ] Fix input-dispatching ANRs in `BlendModeHelper` / `ReactTextView`
- [x] Lazy-load 14 eager screen imports in [App.js](App.js) — converted to `getComponent={() => require(...)}` for `<Stack.Screen>` entries and inline `require()` inside the function-children for screens needing custom props.
- [x] Defer ad/consent/in-app-update init out of first paint — `InterstitialAdManager.init`, `RewardedAdManager.init`, `checkForUpdate`, `handleUserConsent`, and `AppOpenAdManager.initAndShow` all moved into `requestIdleCallback` blocks.
- [x] Narrow `handleUserLogin` full `users/{uid}` read ([GlobelStats.js](Code/GlobelStats.js)) — replaced single fat read with parallel projection of ~25 leaf fields. Skips `shop/*`, `posts`, `blocked_users`, `levelRewards`, `dailyStars`, `fcmToken`.
- [x] Scope `GameResults` onValue listener to `/rewardPoints` only ([GameResults.jsx](Code/ValuesScreen/PetGuessingGame/components/GameResults.jsx)) — was re-downloading entire user record on every xp/dailyStars/shop subtree write.
- [ ] Replace `getOrFetchFullProfile` with 16-field projection cache ([profileCache.js:288](Code/Helper/profileCache.js#L288))

### P2 — app size & tech debt

- [ ] Drop `@react-native-firebase/firestore` if Supabase migration replaces it
- [ ] Evaluate removing Mixpanel in favor of Firebase Analytics
- [ ] Migrate `react-native-system-navigation-bar` → `react-native-edge-to-edge`
- [ ] Remove unused permissions (RECEIVE_BOOT_COMPLETED, FOREGROUND_SERVICE if unused)

### P3 — security & data infrastructure

- [ ] Move release keystore password out of [build.gradle](android/app/build.gradle) into `~/.gradle/gradle.properties`
- [ ] Grant SA `Storage Object Viewer` on `pubsite_prod_*` bucket (unblocks installs/uninstalls reports)
- [ ] Enable Firebase Crashlytics → BigQuery export

---

## How to refresh the data

```
node scripts/play-fetch.js     # pull vitals + reviews + crashes + anomalies
node scripts/play-summary.js   # per-version summary
```

Output: `analytics/<YYYY-MM-DD>/`

Inputs: service account key at `.secrets/play-sa-key.json` (gitignored).

---

## What's missing & how to unblock

| Data | Blocker | Fix |
|------|---------|-----|
| Installs/uninstalls by country & version | SA can't read `pubsite_prod_*` GCS bucket | Grant `Storage Object Viewer` (5 min) |
| Acquisition source breakdown (paid vs organic) | Not in API | Manual CSV export from Play Console |
| Full review history | Reviews API caps at 7 days | Manual export |
| iOS data | App Store Connect not wired up | Generate ASC API key when iOS becomes priority |
| Detailed crash stacks | API returns issue summary, not full stack | Either `errorReports:search` per id, or enable Crashlytics→BigQuery |
