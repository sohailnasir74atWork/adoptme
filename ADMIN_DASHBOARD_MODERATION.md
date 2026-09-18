# Admin Dashboard — moderation audit & fixes (2026-09-17)

Three things happened in this pass:

1. **A moderation audit log was added.** The app previously kept no history
   of moderation at all. Every mute, strike and ban overwrote the same
   single record, and an unban deleted it.
2. **Defects were fixed** in the dashboard and the moderation functions it
   calls — the reason "some data is not being shown correctly". The worst
   was that the Banned List showed **0 while 2,000 users were banned**
   (section 3b).
3. **A design pass** on the dashboard, and an app-wide safe-area fix
   (section 3c).

---

## 1. Why there was no history

Every moderation action writes to **one** RTDB key:

```
banned_users_by_email/{lowercased-email-with-(dot)}
```

…with `set()`, which replaces the whole node. So:

| Action | Effect on the record |
|---|---|
| Mute | overwrites it (and used to wipe an active ban) |
| Strike | overwrites it |
| Ban | overwrites it |
| Unban | **deletes** it |

That record is the **enforcement state** — "what is in force right now". It
is a perfectly good answer to that question and it has not changed: old app
builds in the field read it, so it stays exactly as it was.

What it can never be is a **history**. That is why the old "Strike History"
section was hardcoded to a single row with `id: 'current'`.

### The split

| Question | Source |
|---|---|
| What is in force **right now**? | RTDB `banned_users_by_email` (unchanged) |
| What has **ever** been done, by whom, why? | Supabase `public.mod_actions` (new) |

`mod_actions` is append-only. There is no client UPDATE or DELETE policy at
all, so a moderator cannot rewrite or erase their own record.

---

## 2. Deployment status (2026-09-17)

| Step | State |
|---|---|
| `supabase/029_mod_actions.sql` | **APPLIED** — audit log live, recording from 2026-09-17 |
| RTDB rules (`bannedUntil` index) | **DEPLOYED** — diffed live vs repo first; one added line |
| `scripts/backfill-ban-timestamps.js` | **RUN** — 2,348 records gained `bannedAt`; now reports 0 pending |
| `functions:stampBanTimestamp` | **DEPLOYED** — keeps `bannedAt` self-healing for old builds |

Details of the original deployment steps follow.

## 2b. What had to be deployed

**Supabase — apply `supabase/029_mod_actions.sql`.** Paste it into the SQL
editor. It creates:

- `public.mod_actions` + four indexes
- `public.is_mod_staff()` — admin / moderator / **baby mod** / email allowlist
  (wider than the existing `is_staff()`, which is admin+moderator only;
  baby mods can ban, so their actions have to be recordable)
- `mod_actions_for_user` — one user's timeline, keyset-paginated
- `mod_action_counts_for_user` — aggregate counts, one row
- `mod_leaderboard` — per-moderator totals over a window
- `mod_actions_recent` — global feed with server-side filters
- `retention_mod_actions` + a weekly cron (400-day window)

**RTDB rules** — `bannedUntil` was added to `.indexOn` on
`banned_users_by_email`. (The live rules were diffed against the repo
first: identical except for that one line.) Nothing else about RTDB
changed — the enforcement node keeps its existing shape.

⚠️ The email allowlist in `is_mod_staff()` must stay in sync with
`GlobelStats.js`, `is_staff()` in 020, and `_require_admin()` in 024.

Until the migration is applied the app still works: every log write is
fire-and-forget and swallows its error, so a ban succeeds whether or not it
was recorded. The history views will simply be empty.

---

## 3. Cost

Cost was a hard constraint, so:

- **`mod_actions` is NOT in the realtime publication.** Realtime messages
  are the largest Supabase line item on the sibling projects (31 M messages
  / $67.50 on blox_fruit). A moderation log has no reason to push to
  devices; staff pull it when they open the tab. `replica identity` is left
  at `default` so even an accidental publication add carries no payload.
- **Names are denormalized onto each row** (`actor_name`, `target_name`).
  Reads need no join and — more importantly — no RTDB `profileCache`
  warm-up per row, which is what the banned-list view still pays. It is
  also more correct: the name is preserved as it was at the time.
- **Every read is an rpc that aggregates or paginates server-side.** The
  counts row on a profile is computed in Postgres; the client never
  downloads a timeline in order to count it. Feed filters are applied in
  the query, so a filtered page costs *less* than an unfiltered one.
- **Every window is bounded** (leaderboard and feed default to 30 days,
  capped at 365) so each query is served by `idx_mod_actions_created`.
- **Volume is one row per moderation action** — order tens per day. The
  retention job exists so the table can never become a surprise.

Net effect on Firebase spend is **negative** (i.e. it goes down), because of
the two read bugs fixed below.

---

## 3b. The empty Banned List — root cause

The list showed **0 while 2,000 users were banned**. Measured on production:

```
2,695 records total
  2,000 active — every one of them PERMANENT
  1,999 of those 2,000 had NO `bannedAt` field
    695 expired — short mutes, the only records carrying `bannedAt`
```

The list queried `orderByChild('bannedAt').limitToLast(25)`. RTDB sorts
records missing the ordering key **first**, so `limitToLast` could only ever
reach the 695 expired mutes — which the active-filter then dropped.

Cause: `setUserStrike` wrote `appliedAt` and never `bannedAt`, while
`banUserwithEmail` and `muteUser` both wrote `bannedAt`. Three fixes:

1. `setUserStrike` now writes both (`bannedAt` for the query, `appliedAt`
   so nothing reading existing records has to change).
2. `scripts/backfill-ban-timestamps.js` stamped `bannedAt` onto the 2,348
   existing records — 2,243 exactly from `appliedAt`, 105 derived from
   `bannedUntil` minus the tier duration, 2 unsalvageable.
   **`functions/stampBanTimestamp.js`** (deployed 2026-09-17) then made this
   self-healing: an RTDB `onWrite` trigger stamps `bannedAt` on any record
   that arrives without one, so moderators still on the old store build no
   longer produce invisible strikes. The script is now an audit tool, not a
   chore.
3. The list is now **paged** (40 per page, keyset on `bannedAt`), so
   "Load more" reaches every banned user instead of stopping at 25. Each
   page is still a bounded query — this never becomes a full-node download.

Verified on device: 38 → 78 → 152 as the list scrolled.

## 3c. Safe-area / edge-to-edge

`targetSdkVersion 36` means Android draws edge-to-edge and insets nothing
automatically. The dashboard handled insets **nowhere**, so the strike
buttons' durations sat under the system navigation bar.

Audited the whole app for modals that touch a screen edge. Before: 2 of 6
full-screen modals and 11 of 11 bottom sheets had no inset handling. All
now use `useSafeAreaInsets`:

- Full-screen: `AdminDashboard`, `UploadModal`, `OfferWall`
- Bottom sheets: `BottomDrawer`, `GroupChatScreen`, `GroupsScreen`,
  `OnlineUsersList`, `LeaderboardModal`, `ChatRuleModal`, `PetsModel`,
  `PrivateMessageInput`, `InviteUsersModal`, `EditProfileModal`
- Also `Setting.jsx` — both tab ScrollViews had no bottom padding at all,
  so the last card was clipped.

Several used a hardcoded `Platform.OS === 'ios' ? 34 : 20` guess. An
Android 3-button navigation bar is 48dp, so 20 was never enough.

Incidental find: `EditProfileModal.js` references `Platform` without
importing it — a guaranteed `ReferenceError` on render. It has no
importers (dead code), so it had never been hit. Import added.

## 4. Defects fixed

### Cost

| # | Defect |
|---|---|
| 1 | **Unbounded RTDB read loop on the Search tab.** `renderItem` fired `checkUserBanStatus` *during render*, and only cached the result when the user turned out to be banned. For everyone not banned — the overwhelming majority — the cache key was never set, so the next render fired the query again, forever. On a 50-result search that is a continuous stream of billed RTDB reads for as long as the tab is open. Now it is an effect, batched, and a miss is cached as `null` (a real answer, not the absence of one). |
| 2 | **Chat-viewer user search downloaded full user objects from RTDB.** Two `orderByChild('displayName')` prefix queries per search, each pulling up to 10 complete user records. Replaced with the Supabase identity search the main Search DB tab was already migrated to. |

### Data shown incorrectly

| # | Defect |
|---|---|
| 3 | **Ban/strike reasons were written as the boolean `true`.** `handleBan` and `handleSetStrike` passed `isStaff` into the `customReason` argument slot (and a seventh argument that does not exist). `reason: customReason \|\| 'Strike N'` therefore stored `true`, which renders as blank. Every ban and strike issued from this dashboard has a corrupt reason. Argument order fixed; readers now refuse to print a non-string reason. |
| 4 | **Strikes never appeared in "Recent bans".** `setUserStrike` wrote `appliedAt`; the list queries `orderByChild('bannedAt').limitToLast(25)`. RTDB sorts records missing the key first, so `limitToLast` never reached them. `bannedAt` is now written alongside `appliedAt`. |
| 5 | **Banned/strike status was invisible for any email containing a capital letter.** Writes lowercase the email before encoding (`encodeEmailForBan`); `checkUserBanStatus` and `fetchStrikeHistory` did not. They read a key that had never been written. One `encodeEmailKey` helper now does it in one place. |
| 6 | **Mutes were hidden from the dashboard entirely.** The list builder skipped `strikeCount < 1`, commented "skip expired mutes" — but a mute *never* carries a strike, expired or not. An admin could mute someone and then find them nowhere. Visibility is now decided by expiry, with a MUTED badge and its own filter pill. |
| 7 | **Expired restrictions showed as active forever.** Nothing deletes expired records, and `checkUserBanStatus` treated `exists()` as "banned" — so a five-minute mute from March still showed BANNED today. |
| 8 | **Strike buttons advertised the wrong durations** — "3 hours / 3 days / Permanent". The actual ladder is 12 hours / 24 hours / permanent. Labels now come from `STRIKE_TIERS`, which sits next to the behaviour. |
| 9 | **A mute silently released a banned user.** Mute and ban share one record and mute used `set()`, so muting someone serving a permanent ban replaced it with a five-minute `bannedUntil`. Mute now refuses to shorten a longer existing sanction and says why. |

### Other

| # | Defect |
|---|---|
| 10 | **Auto-ban leaked to the reporter.** `ReportModal.js` called `banUserwithEmail(email, userId)` — the userId landed in the `isAdmin` slot, so the *reporting user* got a "User Banned — Strike N applied" alert, and the ban record was saved with `userId: null`. |
| 11 | **Private chat viewer** — see below. |

---

## 5. Private chat viewer

- **User search rewritten** (defect 2). It was prefix-only and
  case-sensitive, so "pro" never found "xXPROxX" and most real usernames
  simply did not come back. Now: Supabase `ilike` substring search, plus
  direct lookup for a pasted uid or a full email.
- **Pagination.** It loaded one fixed page of 300 messages and stopped,
  with nothing on screen to say so — a long conversation was silently
  truncated to its tail, which is the part an admin has already seen.
  Now 100 per page with "Load older messages" and a "Beginning of
  conversation" marker.
- **Multi-image messages rendered as empty bubbles.** Only `imageUrl` was
  drawn; `imageUrls` (the gallery field) was ignored. Both render now.
- **Replies lost their quoted message**, making half of a reported
  argument impossible to follow. `replyTo` now renders.
- **A failed load claimed the users had never spoken.** The empty state
  said "No messages found between these users" after an auth error. Errors
  now show as errors, with a Retry.
- **The User Chats tab demanded a raw Firebase uid** and rejected anything
  else. It now accepts a name, an email or a uid, with a picker when a name
  matches several people.

---

## 6. What admins get

**Per-user profile** — open anyone from any list:

- **Currently In Force** — the live record, correctly labelled as mute vs
  strike vs expired, with its real reason and who applied it.
- **Moderation History** — counts (mutes / strikes / bans / unbans), then
  the full timeline: what, why, by whom, under what role, from where
  (dashboard / chat / automatic), paginated.

**Mod Log tab** — two views:

- **By moderator** — the "who bans how many people" leaderboard. Shows both
  raw action count *and* distinct users touched, because ten mutes on one
  repeat offender is not ten people moderated, and ranking on the raw
  number alone flatters whoever spams short mutes. Tap a row to filter the
  feed to that moderator.
- **Recent actions** — the global feed, filterable by action type,
  moderator and window. Tap an entry to open that user's profile.

**Reason prompt** — every ban, strike, mute and unban now collects a reason
before it is written, with one-tap common reasons. This is what makes the
history worth reading: "Strike 2" with no reason tells the next moderator
nothing, and that is exactly what the dashboard recorded before.

---

## 7. Known gaps

- **History starts now.** Actions taken before this release were never
  recorded anywhere and cannot be backfilled — the data does not exist.
  The empty state says so rather than implying a clean record.
- **Auto-bans no longer escalate strikes.** Fixing defect 10 required
  passing `false` for `isAdmin`, which in `banUserwithEmail` controls *both*
  the alert and strike escalation — the two are conflated in one parameter.
  A repeat auto-ban now re-applies the existing tier instead of climbing
  it. Splitting that parameter is the clean fix if escalation is wanted.
- **`banned_users_by_email` is world-writable** in `database.rules.json`
  (`.write: true`), as are most nodes. Out of scope here, but it means the
  RTDB enforcement record is not protected server-side. The Supabase audit
  log *is* — insert requires staff, and there is no update or delete path.
