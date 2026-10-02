# CMSR split: House CMSR and Art CMSR, 2026-10-03

Follows BADGE_RAIL_HANDOFF_2026-10-02.md. **Uncommitted** (the owner commits).

## Why

There are two kinds of commissioner, house builders and artists. Both badges
are called "CMSR" and must look different: one house icon, one art icon, as
tiny PNGs like every other UI icon (no vector-icon glyphs, no emoji).

## What changed

### Data

- `users/{uid}/isCMSR` stays and now means **House CMSR**. The 12 existing
  holders keep their badge unchanged.
- New leaf `users/{uid}/isArtCMSR` = **Art CMSR**. A player can hold both.
- Supabase `user_roles.is_art_cmsr` (`supabase/042_art_cmsr.sql`), written by
  `functions/mirrorUsersToSupabase.js`, repaired by
  `functions/reconcileRolesMirror.js` (same as `is_helper`, 014).
  `functions/sendUpdateNoticeMessage.js` also lists the flag, but that function
  is not in production (deploy.sh refuses it); the edit keeps the template honest.
- RTDB rule (`database.rules.json`): `isArtCMSR` is MOD-grantable with the
  same 3-squad gate as `isCMSR`, and indexed under `/users` because the
  reconcile query orders by it.

### UI

- Rail keys `cmsr_house` and `cmsr_art` (`Code/Helper/badgeRail.js`). Order:
  `admin > mod > jmd > trusted > cmsr_house > cmsr_art > helper > squad > verified`.
- Icons `assets/role-badges/cmsr_house.png` (orange disc, white house) and
  `cmsr_art.png` (rose disc, white palette), with @2x/@3x, drawn by
  `scripts/role-badges/make-cmsr-icons.mjs` (same approach as the Pet Cards
  icons). The old medal `cmsr.png` is deleted; nothing referenced it.
- Both pills use the one label `badges.roles.cmsr` ("CMSR"). Tints: house
  orange `#EA580C`, art rose `#E11D48` (`Code/Helper/UserBadgePill.jsx`).
- Profile drawer admin chips: "Make / Remove House CMSR" and "Make / Remove
  Art CMSR" (`ProfileAdminActions.jsx`; handlers in `BottomDrawer.jsx` copy the
  Helper ones: one atomic update with `rolesUpdatedAt`).
- Elections charter (`Code/Elections/RoleCharter.jsx`): two rows both named
  CMSR, blurbs `elections.badge_cmsr_house` / `elections.badge_cmsr_art` in all
  six languages (replaces `elections.badge_cmsr`).
- Leaderboard CMSR tab lists holders of either flag: `getCmsrRoster` queries
  `is_cmsr OR is_art_cmsr`, and falls back to `is_cmsr` alone if the column
  does not exist yet (`Code/Supabase/userBackend.js`).
- Every place that carried `isCMSR` now also carries `isArtCMSR`: profileCache
  (fetch, message seed, resolve, own seed), GlobelStats (own user projection and
  roles row), PrivateChatHeader, OnlineUsersList, chatBackend (`role_flags` on
  messages both ways), Trader (message payload), HomeScreen / DesignMainScreen
  (trade and post author snapshot), PostCard / Trades / GroupMessageList /
  MessagesList (rail user object), BottomDrawer (all three fetch paths).
- Scripts know the column: `backfill-user-roles.js`, `parity-check-users.js`,
  `backfill-users-to-supabase.js`. No backfill is needed, nobody holds the flag yet.

### Left alone, on purpose

- `functions/syncRosterMaintenance.js` still seeds the RTDB `/cmsr` roster from
  `isCMSR` only. No client reads `/cmsr` any more (the leaderboard reads
  Supabase), so a deploy there would change nothing a user sees.
- `functions/syncBadgeRoster.js` is not deployed; untouched.
- `PRESENCE_RULES.json` is a stale local snapshot (it lacks `admin` and
  `isHelper` too). `firebase.json` deploys `database.rules.json`.

## Deployed 2026-10-03 (owner ran the commands, session verified each)

| Step | Result |
|---|---|
| `scripts/role-badges/apply042.sh` | **DONE.** Column and index present; 168,923 `user_roles` rows; 12 House CMSR holders untouched; 0 Art CMSR holders. |
| RTDB rules | **DONE.** Live ruleset re-read after the release: identical to the repo, `isArtCMSR` in `.indexOn`, the grant clause present. |
| `mirrorUsersToSupabase`, `reconcileRolesMirror` | **DONE**, both "Successful update operation" (1st gen, us-central1). |
| App build | Not released. |

**Node runtime, resolved.** The first functions deploy put both on **Node 20**
because `functions/package.json` declared `"node": "20"` while all 39 other live
functions run on Node 22 (Node 20 is decommissioned 2026-10-30). The manifest now
says `"node": "22"` and the owner re-ran the deploy: GCP reports both on
`nodejs22` (versions 17 and 5). Note the CLI still prints "updating Node.js 20
(1st Gen) function" and the Node 20 deprecation warning during that run: it
labels the function as it *was*, not what it deploys. Trust `gcloud functions
describe` / `firebase functions:list` after the operation completes.

## Deploy order (owner)

Pre-flight done on 2026-10-03 from this checkout (the session itself could
not deploy: the auto-mode permission classifier blocks production deploys):

- Live RTDB rules fetched (`firebase database:get /.settings/rules`) and
  compared: identical to HEAD; the working tree differs only in
  `users/.indexOn` and `users/$userId/.write`, the two intended changes.
- `mirrorUsersToSupabase` and `reconcileRolesMirror` are both live (v1,
  us-central1, Node 22). `./functions-deploy/deploy.sh --dry-run` stages both
  and exports exactly those two. The only pending hunks in the two modules are
  the `isArtCMSR` / `is_art_cmsr` lines.
- Firebase CLI is signed in as the owner; `~/.supabase/access-token` and
  `supabase/.temp/project-ref` are present.

1. **Supabase**: `./scripts/role-badges/apply042.sh` (Management API, one
   transaction, prints before/after checks; `--check` is read-only). First,
   because the mirror upsert names the column.
2. **RTDB rules**: `npx firebase deploy --only database --project adoptme-7b50c`.
   Before the functions: `reconcileRolesMirror` runs
   `orderByChild('isArtCMSR')` every 6 h and without the index RTDB downloads
   the whole `/users` node to filter.
3. **Functions**: `./functions-deploy/deploy.sh mirrorUsersToSupabase reconcileRolesMirror`
   (from this checkout, so the uncommitted hunks ship). Not
   `sendUpdateNoticeMessage`: that module was removed from production in
   2026-07 and the deploy script refuses it; its `isArtCMSR: false` edit is
   only there so the file stays a faithful template.
4. Ship the app build.

Until step 1 lands, an Art CMSR grant is still written to RTDB and shows
through the RTDB fallback paths, and the leaderboard CMSR tab shows House
CMSRs only. Until step 2 lands, a MOD's Art CMSR grant is rejected by the rule
(admins are never gated).

## Checks

- jest: `__tests__/badgeRail.test.js` 12/12, with a new case (house from
  `isCMSR`, art from `isArtCMSR`, both wearable). Full run: the same two
  pre-existing failures (`safeChat`, ESM `App.test.tsx`), listed twice because
  `.claude/worktrees/clever-kare-747463/` is collected as well.
- `react-native bundle --dev false` builds; both PNGs land at mdpi / xhdpi /
  xxhdpi in the asset output.
- eslint: no new errors. Per touched file the error count equals HEAD
  (68 in total across the 23 files: 62 `react-hooks/exhaustive-deps`, 6
  `no-dupe-keys` in old stylesheets), all pre-existing.
- i18n: `badge_cmsr_house` and `badge_cmsr_art` present and translated in all
  six languages; `badge_cmsr` gone from all six.
- Not seen on a device: granting needs an admin or MOD account. The two new
  handlers mirror the Helper handlers line for line.
