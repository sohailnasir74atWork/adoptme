# Admin Dashboard & Moderation — Handoff

Last updated: 2026-09-17. Previous worker: Claude (this chat).

Companion doc: [ADMIN_DASHBOARD_MODERATION.md](ADMIN_DASHBOARD_MODERATION.md) — the
full defect-by-defect write-up. This file is the operational handoff: what
shipped, what is deployed, what is not committed, and what to do next.

---

## Why this work exists

The ask was "check the admin dashboard, some data is not being shown
correctly, and record who bans how many people / what a single user's
history is".

Two structural problems sat underneath that:

1. **The app kept no moderation history at all.** Every mute, strike and ban
   `set()`s the same single RTDB key, so each action overwrote the last one
   and an unban deleted it. The "Strike History" section was hardcoded to a
   single row with `id: 'current'` — it could never show more.
2. **The Banned List showed `0` while 2,000 users were banned.** Not "a few
   missing" — the list had never been able to display the ban roster.

Both are fixed. History now lives in Supabase; the list is paged and
reaches every record.

---

## Deployment status

| Item | State | Notes |
|---|---|---|
| `supabase/029_mod_actions.sql` | **APPLIED** by the user, 2026-09-17 | Verified on device: RPCs resolve, setup notice gone |
| RTDB rules — `bannedUntil` in `.indexOn` | **DEPLOYED** 2026-09-17 | Live rules were diffed against repo first; identical except this one line |
| `scripts/backfill-ban-timestamps.js --apply` | **RUN** 2026-09-17 | 2,348 records + 1 straggler; now reports 0 pending |
| `functions:stampBanTimestamp` | **DEPLOYED** 2026-09-17 | Makes the backfill permanently unnecessary — see below |
| App code | **NOT COMMITTED** | See "Uncommitted tree" below |
| Play/App Store build | **NOT BUILT** | Only a debug APK was installed on the emulator |

Nothing else needs deploying. The audit log starts recording from the
moment 029 was applied.

### No periodic work required

`stampBanTimestamp` (Cloud Function, RTDB `onWrite` on
`/banned_users_by_email/{key}`) stamps `bannedAt` onto any record that
arrives without one. This closes the loop for **all builds, old and new**:

- Moderators still on the **store build** write `appliedAt` only. The
  function fills in `bannedAt` server-side within seconds, so their strikes
  appear in the Restrictions list immediately.
- The client fix in `setUserStrike` (writes both fields) means the function
  fast-exits for anyone on the new build.

Verified in production 2026-09-17 with a throwaway record: stamped in
**~2.5 s**, took `appliedAt` exactly, and left `bannedUntil`, `reason` and
`strikeCount` untouched.

**Loop safety.** The write-back re-triggers the function once. That second
pass sees a numeric `bannedAt` and returns immediately — measured at **5 ms**
with no log line, versus 1,283 ms for the real stamp. It terminates after
one no-op; it does not loop.

`scripts/backfill-ban-timestamps.js` is kept for auditing (dry run reports
how many records lack `bannedAt`) but no longer needs running on a schedule.
It currently reports **0 pending**, with 2 unsalvageable records — permanent
bans carrying no timestamp of any kind, which would require inventing data.

---

## ⚠️ Uncommitted tree — two unrelated bodies of work

`git status` on branch `bump-android-138` (10 commits ahead of origin) shows
**two separate pieces of work mixed together**. Commit them separately.

### This session (admin dashboard / moderation / safe-area)

| File | What changed |
|---|---|
| [Code/AppHelper/AdminDashboard.js](Code/AppHelper/AdminDashboard.js) | Most of the work — see table below |
| [Code/ChatScreen/utils.js](Code/ChatScreen/utils.js) | Audit logging, `bannedAt` fix, mute-vs-ban guard |
| [Code/Supabase/modLogBackend.js](Code/Supabase/modLogBackend.js) | **NEW** — audit log client |
| [supabase/029_mod_actions.sql](supabase/029_mod_actions.sql) | **NEW** — the migration |
| [scripts/backfill-ban-timestamps.js](scripts/backfill-ban-timestamps.js) | **NEW** — one-off backfill (already run; now an audit tool) |
| [functions/stampBanTimestamp.js](functions/stampBanTimestamp.js) | **NEW** — RTDB trigger, deployed. Makes `bannedAt` self-healing |
| [functions/index.js](functions/index.js) | +1 export: `stampBanTimestamp` |
| [database.rules.json](database.rules.json) | +1 line: `bannedUntil` index |
| [Code/ChatScreen/GroupChat/BottomDrawer.jsx](Code/ChatScreen/GroupChat/BottomDrawer.jsx) | Actor role + `source` on mod calls; safe-area |
| [Code/ChatScreen/ReportPopUp.jsx](Code/ChatScreen/ReportPopUp.jsx) | Auto-ban tagged `source: 'report'` |
| [Code/Design/componenets/ReportModal.js](Code/Design/componenets/ReportModal.js) | Fixed argument-slot bug leaking bans to reporters |
| ChatRuleModal, GroupChatScreen, GroupsScreen, LeaderboardModal, OnlineUsersList, PetsModel, PrivateMessageInput, UploadModal, EditProfileModal, OfferWall, Setting, InviteUsersModal | **Safe-area only** — `useSafeAreaInsets` |
| [ADMIN_DASHBOARD_MODERATION.md](ADMIN_DASHBOARD_MODERATION.md) | **NEW** — defect write-up |

### NOT this session — pre-existing uncommitted work

These were already dirty when this session started and were **not touched**:

```
Code/GlobelStats.js            Code/Homescreen/HomeScreen.jsx
Code/LocalGlobelStats.js       Code/Trades/Trades.jsx
Code/ValuesScreen/ValueScreen.js
Code/ChatScreen/GroupChat/GroupMessageList.jsx
Code/ChatScreen/GroupChat/MessagesList.jsx
Code/ChatScreen/PrivateChat/PrivateMessageList.jsx
Code/Helper/valueSources.js (new)   __tests__/valueSources.test.js (new)
VALUE_SOURCES_HANDOFF.md (new)
```

That is the value-sources work — see [VALUE_SOURCES_HANDOFF.md](VALUE_SOURCES_HANDOFF.md).

To verify the split yourself:

```bash
git diff --stat $(git diff --name-only | grep -vE 'GlobelStats|HomeScreen|Trades|ValueScreen|MessageList|MessagesList')
```

---

## The two root causes, in one paragraph each

**No history.** RTDB `banned_users_by_email/{email}` is the *enforcement*
state — "what is in force right now" — and it is written with `set()`, so it
can only ever hold one record. It stays exactly as it is, because old app
builds in the field read it. The *history* is now a separate,
append-only Supabase table (`public.mod_actions`) with no client
UPDATE/DELETE policy, so a moderator cannot edit or erase their own record.

**Empty Banned List.** The list queried
`orderByChild('bannedAt').limitToLast(25)`. RTDB sorts records **missing**
the ordering key *first*, and `setUserStrike` wrote `appliedAt` but never
`bannedAt` — so 1,999 of the 2,000 active bans were unreachable, and
`limitToLast` only ever returned the 695 expired short mutes, which the
active-filter then dropped. Production measured at the time:

```
2,695 records — 2,000 active (all permanent), 695 expired
1,999 of the 2,000 active had NO bannedAt field
```

---

## Key defects fixed

Full list in [ADMIN_DASHBOARD_MODERATION.md §4](ADMIN_DASHBOARD_MODERATION.md).
The ones most likely to matter to you:

| # | Defect | Where |
|---|---|---|
| 1 | Ban/strike reasons were written as the **boolean `true`** — `isStaff` was passed into the `customReason` argument slot. Every dashboard-issued ban has a corrupt reason. | [AdminDashboard.js](Code/AppHelper/AdminDashboard.js) handlers |
| 2 | Strikes never reached "Recent bans" (`appliedAt` vs `bannedAt`) | [utils.js:708](Code/ChatScreen/utils.js#L708) |
| 3 | Banned status invisible for any email with a capital letter — writes lowercase the key, two readers did not | [AdminDashboard.js:122](Code/AppHelper/AdminDashboard.js#L122) `encodeEmailKey` |
| 4 | A 5-minute mute **silently released a permanently banned user** (shared record + `set()`) | [utils.js:766](Code/ChatScreen/utils.js#L766) |
| 5 | Mutes were hidden from the dashboard entirely (`strikeCount < 1` skip) | `buildBanRowsFromSnapshot` |
| 6 | Unbounded RTDB read loop on the Search tab — a query fired *during render*, and only cached hits, so non-banned rows re-queried forever | `renderItem` → effect |
| 7 | Strike buttons advertised "3 hours / 3 days"; the real ladder is 12h / 24h / permanent | [AdminDashboard.js:204](Code/AppHelper/AdminDashboard.js#L204) `STRIKE_TIERS` |
| 8 | Auto-ban alerted the **reporting user** ("User Banned — Strike N applied") and saved `userId: null` | [ReportModal.js](Code/Design/componenets/ReportModal.js) |
| 9 | Chat-viewer user search was prefix-only and case-sensitive — "pro" never found "xXPROxX" | [AdminDashboard.js:1596](Code/AppHelper/AdminDashboard.js#L1596) `resolveUsers` |

---

## What an admin gets now

- **Restrictions tab** — paged (40/page, keyset on `bannedAt`), reaches every
  banned user. Mutes visible with their own badge and filter.
- **Mod Log tab** — "By moderator" leaderboard (who banned how many; reports
  both raw actions *and* distinct users touched) and a filterable
  "Recent actions" feed.
- **User profile** — live sanction (reason, who, when), mute/strike/ban/unban
  tallies, and the full timeline with reason + actor + role + source.
- **Reason prompt** on every ban, strike, mute and unban, with one-tap common
  reasons.

---

## Cost notes

Cost was a hard constraint. The net effect on Firebase spend is **negative**
(it goes down), because of defect 6 above.

- `mod_actions` is **NOT** in the realtime publication, and `replica identity`
  is left at `default`. Realtime messages are the biggest Supabase line item
  across these apps — a moderation log has no business pushing to devices.
- Actor/target names are **denormalized** onto each row: no join, and no RTDB
  `profileCache` warm-up per row on read.
- Every read is a `SECURITY DEFINER` rpc that aggregates or paginates
  **server-side**. The client never downloads a timeline to count it.
- Every window is bounded (30-day default, 365 cap) so queries are served by
  `idx_mod_actions_created`. Retention job trims at 400 days.

---

## Known gaps / next steps

1. **History starts 2026-09-17.** The 2,000 existing bans have a *current*
   sanction (visible on their profile, from RTDB) but no per-action history.
   That data was never written anywhere and cannot be recovered.
2. **Auto-bans no longer escalate strikes.** Fixing defect 8 required passing
   `isAdmin: false`, and that single parameter controls *both* the alert and
   strike escalation. A repeat auto-ban now re-applies the existing tier
   instead of climbing it. Splitting that parameter in `banUserwithEmail` is
   the clean fix if escalation is wanted.
3. **`banned_users_by_email` is world-writable** (`.write: true`), as are most
   RTDB nodes. Out of scope here, but the enforcement record is not protected
   server-side. The Supabase audit log *is*.
4. **Email allowlist duplication.** `is_mod_staff()` (029) must stay in sync
   with `GlobelStats.js`, `is_staff()` (020) and `_require_admin()` (024).
   Four copies of the same three addresses.
5. **Not committed, not built for release.** Only a debug APK was installed
   on the emulator. Build a release APK and actually **install and launch it**
   before uploading — a debug build passing proves nothing about the release
   one, and these RN apps have historically crashed at launch in release
   builds only (ProGuard stripping).
6. **iOS not verified.** All device verification was on the Android emulator
   (Pixel 9 API 35). The safe-area changes use `useSafeAreaInsets`, which is
   correct on both, but the modals were not visually checked on iOS.
7. **Cloud Functions runtime is deprecated.** The deploy warned: Node.js 20
   was deprecated 2026-04-30 and is **decommissioned 2026-10-30**, after
   which no function in this project can be deployed without upgrading.
   `firebase-functions` is also flagged as outdated. Not caused by this work
   — it affects every function in the project — but it is a hard deadline
   roughly six weeks out, and `stampBanTimestamp` is now one of the
   functions that depends on it.

---

## How to verify it still works

```bash
# 1. Does the audit log schema exist?
#    Open the app → Admin Dashboard → Mod Log.
#    Orange "Audit log not set up yet" = 029 was rolled back.

# 2. Does the ban roster page?
#    Restrictions tab → scroll. The "ACTIVE RESTRICTIONS · N+" count
#    should climb (observed 38 → 78 → 152).

# 3. How many records are missing bannedAt? (dry run — writes nothing)
NODE_PATH=functions/node_modules \
RTDB_URL='https://adoptme-7b50c-default-rtdb.firebaseio.com' \
  node scripts/backfill-ban-timestamps.js
#    Expect 0. A non-zero number that keeps growing means the
#    stampBanTimestamp function has stopped firing.

# 4. Is the stamping function healthy?
npx firebase-tools functions:log --only stampBanTimestamp --project adoptme-7b50c
#    Healthy pattern per stamped record: one ~1s execution logging
#    "[stampBanTimestamp] stamped", followed by a ~5ms no-op (the
#    self-trigger fast-exiting). Many consecutive slow executions on the
#    same key would mean the loop guard has broken.
```

`NODE_PATH` is required: the script needs `firebase-admin`, which is only
installed in `functions/`, and Node resolves `node_modules` from the
**script's** directory — so `cd functions && node ../scripts/...` does *not*
work.

---

## Safe-area / edge-to-edge

`targetSdkVersion 36` means Android draws edge-to-edge and insets nothing.
Audited every modal that touches a screen edge:

| Before | After |
|---|---|
| 2 of 6 full-screen modals unhandled | 0 |
| 11 of 11 bottom sheets unhandled | 0 |

Several used a hardcoded `Platform.OS === 'ios' ? 34 : 20`. An Android
3-button nav bar is 48dp, so 20 was never enough. `Setting.jsx`'s two tab
ScrollViews had no bottom padding at all.

To re-run the audit, classify each `<Modal>` as full-screen (no
`transparent`) or bottom sheet (`justifyContent: 'flex-end'`) and check
whether the file references `useSafeAreaInsets`. Centred transparent
dialogs do **not** need insets — don't bulk-patch those.

Incidental: [EditProfileModal.js](Code/SettingScreen/EditProfileModal.js)
referenced `Platform` without importing it — a guaranteed `ReferenceError`
on render. It has no importers (dead code), so it had never been hit.
Import added; consider deleting the file.
