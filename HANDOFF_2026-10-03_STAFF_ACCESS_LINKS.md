# Handoff 2026-10-03: hand-appointed MOD / JMD, Staff Access, links switch

Owner's ask (2026-10-03): an admin could not make anyone MOD or JMD because
the election bar (squad friends, age, clean record) blocked it. Wanted:

1. Admins appoint MOD / JMD directly, no bar. Only admins.
2. An admin can authorise someone else to do the same (the old "JMD Access"
   switch in the Admin Dashboard), and that person can then appoint too.
3. A second admin switch that lets **every** player share emails and links
   in chat.
4. A new Android bundle with a bumped version.

## What changed

| Piece | File | Change |
|---|---|---|
| Make Mod / Make Junior Mod chips | `Code/ChatScreen/GroupChat/ProfileAdminActions.jsx` | Back, next to the Remove chips. Shown to admins and to Staff Access granters; a granter who is not staff gets a "Staff Access" panel with only these chips (no strikes, mutes, badges, delete). "Make Junior Mod" is not offered for a sitting MOD. |
| Handlers | `Code/ChatScreen/GroupChat/BottomDrawer.jsx` | `handlePromoteModerator` (via `utils.makeModerator`) and `handleMakeBabyMod` restored from commit 2b24ba2. `canManageModerator` / `canManageBabyMod` = `isAdmin || canGrantJmd`. The Mod Tools panel opens for grant-only users too. |
| `makeModerator` | `Code/ChatScreen/utils.js` | Also writes `isBabyMod: null`: a JMD promoted to MOD leaves the JMD seat, same as `runStaffElections.applyDecisions`. |
| Grant flag | `Code/GlobelStats.js` | `canGrantJmd`: live leaf listener on `/jmd_granters/{uid}` (fail closed). |
| Staff Access tab | `Code/AppHelper/AdminDashboard.js` | Admin-only tab (`staffAccess`), restored from 2b24ba2 with new copy: search by name / UID, Grant, Revoke; writes `/jmd_granters/{uid}` with profile + `grantedAt` / `grantedBy`. |
| Links switch | `Code/AppHelper/AdminDashboard.js` | Admin-only row "Links & emails in chat" under the moderator ban/mute row, on every tab. Writes `/links_allowed` (boolean). ON is tinted orange: it is the unusual state. |
| Switch plumbing | `Code/Helper/linksSwitch.js` (new), `Code/GlobelStats.js` | GlobelStats subscribes `/links_allowed` and calls `setLinksAllowed`; also exposes `linksAllowed` in context. The module has no imports so there is no cycle. |
| Link check | `Code/Helper/ContentModeration.js` | `validateContent` skips the link check while `areLinksAllowed()` is true. Covers group, private and design-comment inputs without touching them. |
| Explicit link check | `Code/ChatScreen/GroupChat/GroupMessageInput.jsx` | The "YouTube / TikTok only" check also yields to `linksAllowed`. |
| RTDB rules | `database.rules.json` | `/users/$userId` write: `isModerator` and `isBabyMod` may also change when `root.child('jmd_granters').child(auth.uid).exists()` (the carve-out 2b24ba2 removed). New `/links_allowed`: public read, admin-only boolean write (same rule as `/elections_enabled`). **DEPLOYED 2026-10-03** by the owner; live fetched afterwards and identical to the repo. |
| Version | `android/app/build.gradle` | 1.15.45 (171). |
| Test | `__tests__/linksSwitch.test.js` | Switch off: links and emails rejected as `link`; on: they pass, profanity and off-platform words still fail; only `true` turns it on. |
| Docs | `STAFF_ELECTIONS.md` | Admins section, "Where it lives", deploy status and order updated. |

### What the links switch does not do

The blocklist's OFF-PLATFORM CONTACT category (`discord`, `snapchat`,
`whatsapp`, `telegram`, "add me on discord", ...) is a kid-safety rule, not a
link rule, and the switch leaves it alone. With the switch ON a player can
send `kid@gmail.com` or `https://example.com`, but `discord.gg/abc` is still
rejected, as `offplatform`. If the owner wants the switch to lift that too,
`validateContent` is the one place to change (skip hits whose category is
`offplatform` while `areLinksAllowed()`), and the row's copy should say so.

### Elections interplay

- `runStaffElections` never strips a flag it did not set: it applies admin
  decisions and closes the term of an elected holder whose flag is gone. A
  hand-appointed MOD / JMD keeps the role until someone removes it.
- A hand-appointed holder has no `staff_terms` row: no term expiry, no
  winner push, and the Elections screen's "sitting team" (from terms) will
  not list them. The Moderators screen (RTDB / Firestore mirror) will.
- The Supabase roles mirror still runs: every write stamps `rolesUpdatedAt`.

## Deploy

Live RTDB rules were fetched (`npx firebase database:get /.settings/rules
--project adoptme-7b50c`) and compared node by node with the repo before the
edit: identical. So the only live change is the one in this diff.

1. ~~**RTDB rules**~~ Done 2026-10-03 by the owner
   (`npx firebase deploy --only database --project adoptme-7b50c`); live
   rules re-fetched afterwards and identical to the repo. Staff Access grants
   and the links switch now work from the dashboard. Today's store build is
   unaffected: it has neither feature, and the carve-out only widens who may
   write two flags.
2. **Play Console upload** (owner): see the build row below.
3. **Supabase**: nothing. **Functions**: nothing.

## Verification

- `npx eslint` per file against the pre-change baseline (`-f unix`): every
  touched file unchanged except `AdminDashboard.js` +14, all
  `react-native/no-inline-styles` warnings in the restored tab, the same
  pattern as the rest of that file.
- `npx jest`: 26 passed / 4 failed suites, 432 passed / 2 failed tests. The
  4 failing suites are the pre-existing `App.test.tsx` and
  `safeChat.test.js`, each counted twice because of the stale worktree under
  `.claude/worktrees/`. Baseline before the change: 25 / 4, 428 / 2.
- `__tests__/linksSwitch.test.js`: 4 tests, pass.

## Build

| Piece | State |
|---|---|
| Android 1.15.45 (171) | **BUILT 2026-10-03** with `./gradlew :app:assembleRelease :app:bundleRelease`. AAB 69,904,268 bytes at `android/app/build/outputs/bundle/release/app-release.aab`, copy at `~/Downloads/adoptme-values-1.15.45-171.aab`. `aapt2 dump badging` on the APK: `versionCode='171' versionName='1.15.45'`, native code for all four ABIs (arm64-v8a, armeabi-v7a, x86, x86_64); the AAB carries the same four `base/lib/` folders. **Upload to Play Console: owner.** |
| Smoke test | Release APK installed on the Pixel 9 API 35 emulator (the old 169 build there was signed differently, so it was uninstalled first), launched with `am start`: MainActivity resumed, process still alive after 15 s, logcat has no FATAL / AndroidRuntime / ReactNativeJS / SoLoader error, and the welcome screen rendered. Mod Tools, Staff Access and the links switch need an admin account and were not exercised on the emulator. |
| Gradle noise | The filtered gradle log ends with a Kotlin compiler stack trace under `exception: return DefaultReactActivityDelegate(...)` from `MainActivity.kt`. It is the deprecation warning printed by the Kotlin daemon; the build exited 0 and produced both artifacts. |

## Home performance pass (same day, same build)

Owner's report: after the Pet Cards screens (opening packs, making
wallpapers) the main screen feels laggy.

**Measured** on the Pixel 9 API 35 emulator, release build, signed in, with
`adb shell dumpsys gfxinfo com.adoptmevaluescalc reset` then a 10 s idle:
Home drew **516 frames in 10 s** with nothing touched (median 36 ms, emulator
GPU). An idle screen should draw almost none. Three things on Home never
rested while it was in front: the hero level Lottie (loops), the star-badge
pulse (`Animated.loop`, forever while a star is claimable) and the Pet Cards
pack pulse (`Animated.loop`, forever while a pack is ready, also under the
other tabs and under the card screens). The avatar frame is static SVG and
is not a source.

The Pet Cards data side is lean (one cached call per screen, no realtime,
memoized cards, tuned album list). What leaks into Home from a card visit is
image memory: 1024 px art in the viewer and pack opening, 2048 px art
(16 MB decoded each) in wallpapers, plus the 1290×2796 / 3840×2160 snapshot
on save, which evicts Home's own images and makes it re-decode them.

| Change | File |
|---|---|
| Hero Lottie plays 5 s after each Home focus, then holds its last frame; pauses on blur as before | `Code/HomeTab/HomeTabScreen.jsx` (`HERO_LOTTIE_PLAY_MS`) |
| Star pulse: 4 cycles per focus, only while Home is focused | `Code/HomeTab/HomeTabScreen.jsx` (`HOME_PULSE_CYCLES`) |
| Pack pulse: 4 cycles per focus, only while Home is focused | `Code/PetCards/PetCardsHomeCard.jsx` (`PULSE_CYCLES`) |
| Wallpaper pet art capped at 1024 px (no more 2048) | `Code/PetCards/wallpaperStyles.jsx` (`artFor`) |

Still as before, by design: card layers use CSS gradients and two or three
`mixBlendMode` layers each, which is heavy on the album and pack screens
themselves but unmounts on leaving. `Code/Helper/shimmerDriver.js` starts one
app-lifetime `Animated.loop` the first time a shimmer badge pill mounts (chat);
untouched here.

**Result**, same emulator, same signed-in Home (pack ready, star claimable),
10 s idle, `gfxinfo reset` before each window:

| Build | Frames in 10 s |
|---|---|
| Before | 516 / 556 (two runs) |
| After, first window (hero still in its 5 s) | 95 |
| After, second window | 1 |

The 1.15.45 (171) artifacts were rebuilt with these changes: APK
45,341,414 bytes, AAB 69,902,387 bytes, copy refreshed at
`~/Downloads/adoptme-values-1.15.45-171.aab`. Installed over the previous
171 on the emulator (same signature, sign-in kept), launched to Home, no
crash. Not exercised: a wallpaper save on this build (needs the Pet Cards
album with owned cards).
