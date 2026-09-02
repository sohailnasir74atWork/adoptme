# Cost Optimization Audit — 2026-09-02

Covers **both consumers of the same backend**: the React Native app
(`RunningApps/adoptme-jan7`) and the Next.js site
(`RunningWebsites/adoptme-web`). Firebase project `adoptme-7b50c`,
Supabase project `kvtbtzhtcaanhjblyick`.

Follow-up to `COST_OPTIMIZATION_2026-07.md`. The July deletions all landed —
`sendDeprecationCountdown`, `sendUpdateNoticeMessage`, `notify*Legacy`,
`mirrorChatMeta*`, `mirrorPrivateMessage*`, `syncModRoster`,
`syncModUsersToRTDB` are gone from `functions:list`, and `/xlsData` is gone
from the RTDB root. This pass is measured, not estimated.

---

## 0. Measured baseline

Cloud Monitoring, 7 days (2026-08-26 → 2026-09-02), plus a live 10-minute
`firebase database:profile` run on 2026-09-02.

| Meter | 7-day | ≈ /month | Free tier | ≈ Billed /month |
|---|---:|---:|---|---:|
| RTDB egress | 7.98 GB | 34.2 GB | 10 GB | **$24** |
| Firestore reads | 8,798,425 | 37.7 M | 50k/day | **$22** |
| Cloud Functions invocations | 1,258,731 | 5.4 M | 2M/mo | **$4.50** |
| Firestore writes | 173,239 | 0.74 M | 20k/day | $0.26 |
| RTDB storage | 1.07 GB | — | 1 GB | $0.35 |

Scale markers: **161,881** users in RTDB `/users`; RTDB concurrent
connections peak **354**, avg **155**; **6.3 M** RTDB listen/unlisten ops per
day; **8.3 M** RTDB API hits per day.

**Where the money actually is: RTDB egress and Firestore reads (~$46/mo of
~$51/mo metered).** Cloud Functions is only ~$4.50/mo even at 5.4 M
invocations, so F1 below is a large *volume* win and a modest *dollar* win —
the invocation count is the most alarming number in this document and close to
the least expensive one.

**Total realistic saving: ≈ $12–18/month on Firebase, ≈ $0 on Supabase.**
Sized per fix in §2, with the reasoning for the Supabase zero.

---

## 1. Findings

### F1 — `_st` server-time probe writes into `/users/{uid}`, driving 92% of all Cloud Function invocations
**Severity: high volume / low dollars · Effort: one line · Risk: none**

`getServerTime()` (`Code/Helper/serverTime.js:39`) probes server time by
writing `serverTimestamp()` to **`users/{uid}/_st`** and reading it back.
`warmServerTime` runs on every app start *and* every foreground return
(`Code/GlobelStats.js:780-783`).

Every one of those writes fires `mirrorUsersToSupabase`, which is an
`onWrite` on the whole `/users/{uid}` row — it loads before+after and runs 9
mirror checks, all of which no-op because `_st` is not a mirrored field.

Evidence — the two numbers match almost exactly:

| Source | Rate |
|---|---|
| Profile: `/users/$id/_st` writes | 872 / 10 min |
| Profile: `/users/anon/_st` writes | 268 / 10 min |
| ⇒ combined | ~164,000 / day |
| Monitoring: `mirrorUsersToSupabase` | 1,156,152 / 7 d = **165,000 / day** |

`mirrorUsersToSupabase` is **1,156,152 of 1,258,731** total invocations = 92%.
p50 execution 104 ms, p95 234 ms, 512 MB.

Note the `anon` bucket: logged-out users all probe the *same* path
`users/anon/_st` (38k invocations/day) and have created a junk `/users/anon`
record.

**Fix** — move the probe off the mirrored subtree. `_st` is referenced
nowhere else: not in `functions/`, not in the web app, and it is not in any
mirror field list.

```js
// Code/Helper/serverTime.js:39
const probeRef = ref(db, `_serverTime/${uid}`);   // was: users/${uid}/_st
```

Then add an RTDB rule (rules are **console-only** — the repo's
`PRESENCE_RULES.json` is a local snapshot, so this must be pasted by hand):

```json
"_serverTime": {
  "$uid": { ".read": "auth != null || $uid === 'anon'", ".write": true }
}
```

**Effect:** −5.0 M invocations/month (−92%), which drops Cloud Functions
under every free tier (~−$4.50/mo); −164k RTDB writes/day inside `/users`;
and it stops polluting `/users` with a field that has nothing to do with user
data. Probe semantics are byte-for-byte identical.

While you're in there: `mirrorModsRoster` (`mirrorUsersToSupabase.js:304`) is
called with `before = null` for brand-new users, which skips its guard and
issues a pointless `mods/{uid}.remove()` on every account creation.

---

### F2 — `/users` is world-readable without authentication
**Severity: critical (uncapped cost + PII) · Effort: rules edit · Risk: breaks old app builds**

Verified against production with an unauthenticated `curl`:

```
GET https://adoptme-7b50c-default-rtdb.firebaseio.com/users.json?orderBy="$key"&limitToFirst=1
→ {"000tFTBJ...":{"_st":...,"avatar":"...","dateOfBirth":"2011-08-24",
   "decodedEmail":"...","deviceId":"...","displayName":"...",
   "email":"...","fcmToken":"..."}}
```

`/presence` correctly returns `Permission denied`; `/users` does not.

Two problems, one root cause:

1. **Uncapped cost.** `/users` is ~161,881 records averaging ~5.6 KB (the
   profile caught individual records up to **65 KB**). A single anonymous
   `GET /users.json` downloads roughly **900 MB**, billed at $1/GB. There is
   no rate limit. This is the same class of leak as `/xlsData` in the July
   pass, which was ~5 GB/day before it was locked.
2. **PII exposure.** Email, decoded email, date of birth, device ID and FCM
   token for every user, publicly readable. FCM tokens in particular allow
   push to arbitrary users.

The repo snapshot also shows `users/$userId` with `".write": true`. I did
**not** test that against production (it would modify live data), but the
`.read` entry in the same block matched production exactly — treat it as
likely live and confirm in the console.

**Fix** (console → Realtime Database → Rules):

```json
"users": {
  ".read": false,
  "$userId": {
    ".read": "auth != null",
    ".write": "auth != null && auth.uid === $userId"
  }
}
```

Two things to check before applying:
- Admin/moderator tooling writes other users' role flags
  (`BottomDrawer.jsx:1309-1450`). Those need either a role condition in the
  rule or a move to an Admin-SDK callable.
- Public profile fields already come from the Supabase mirror
  (`user_identity` / `user_roles` / `user_cosmetics`), so ordinary app reads
  do not need broad `/users` read. Old app builds that still read RTDB
  directly will degrade — the same clean-cut policy already applied to
  `/xlsData` and to chat.

---

### F3 — `cleanupOldPrivateChats` times out every night and deletes nothing; 480k dead shells in `/private_messages`
**Severity: high · Effort: medium · Risk: low**

Production logs, three consecutive nights:

```
2026-08-31T04:00  Found 479173 private chat conversations to check.
2026-08-31T04:09  Function execution took 539146 ms, finished with status: 'timeout'
2026-09-01T04:00  Found 479627 ...
2026-09-01T04:09  ... 538313 ms, status: 'timeout'
2026-09-02T04:00  Found 479970 ...
2026-09-02T04:09  ... 538405 ms, status: 'timeout'
```

Zero `✅ deleted` lines in any run. The function loops **sequentially** over
every chat key (`cleanupOldPrivateChats.js:80-110`), one
`orderByKey().endAt().limitToFirst(500).once('value')` per key. At ~480k keys
it cannot finish inside the 540 s cap, so it dies partway through the *same
alphabetical prefix* every night — the tail is never cleaned, and retention
is effectively not enforced.

Worse, most of that work is against nodes that hold no messages at all. I
sampled 60 keys evenly across the node:

| Shape under `private_messages/{chatKey}` | Count |
|---|---:|
| has a `messages` child | 20 / 60 |
| **only** `lastRead` / `unread` / `trade` / `post` metadata | **40 / 60** |

Extrapolated: **~320,000 of the 480,048 keys are metadata-only shells** whose
messages are long gone. They keep the parent key alive forever, and the node
grows ~400/day.

Each run also downloads the 31 MB shallow key list and burns the full
540 s × 512 MB.

**Fix:**
1. One-off script: delete any `private_messages/{chatKey}` with no `messages`
   child (~320k keys). Check whether `lastRead`/`unread` are still read by
   any client first — the RN app reads private-chat state from Supabase now,
   so these are very likely orphans.
2. Rewrite the loop with a persisted cursor (store the last processed key in
   RTDB, resume next run) and a parallelism of ~20, so it makes forward
   progress instead of restarting from the top.
3. Strategic: private chat lives in Supabase now. Consider retiring the RTDB
   `/private_messages` tree entirely rather than maintaining a cleanup for it.

---

### F4 — `mirrorRoles` never writes on account creation, so users registered since May fall back to 6 RTDB reads per profile open
**Severity: medium · Effort: one-off backfill · Risk: none · DONE 2026-09-02**

> **Corrected 2026-09-02.** This was first written as "no `user_roles` row is
> ever created for ordinary users." That was wrong. Checking the table directly
> found **128,985 rows already present, every one stamped
> `2026-05-14T16:39:15.197Z`** — a bulk backfill someone ran in May, covering
> ~80% of users. The true finding is narrower: the mirror doesn't write on
> *account creation*, so the ~33,000 users who registered after that backfill
> had no row and did hit the fallback.
>
> The supporting inference was also unsound. I argued from role flags being read
> ~7× more often than `isPro` in the profiler, but those are two different code
> paths (drawer fallback vs. login fallback) fired at different rates, so the
> ratio doesn't isolate this. Treat the impact as "~20% of users on the drawer
> path", not "~100%".
>
> **Resolved.** `mirrorRoles` now writes on create, and
> `scripts/backfill-user-roles.js` was run on 2026-09-02: **161,915 rows
> written in 5.6 min, 71 users hold at least one role.** Coverage is now 100%,
> so the fallback should stop firing entirely.

`mirrorRoles` (`mirrorUsersToSupabase.js:139-140`) returns early unless one of
`admin / isModerator / isBabyMod / isTrusted / isCMSR / isHelper`
**changes**. On account creation `before` is `{}` and a new user has none of
those keys, so `anyKeyChanged` is false and **no row is written for them**.

`getRoles()` therefore returns `null` for essentially every user, and
`BottomDrawer.jsx:418-425` takes its per-row RTDB fallback — 6 leaf reads per
profile-drawer open. The profile confirms it, and the asymmetry is the
giveaway:

| Path | events / 10 min |
|---|---:|
| `/users/$id/admin` | 2,402 |
| `/users/$id/isModerator` | 2,394 |
| `/users/$id/isTrusted` | 2,392 |
| `/users/$id/isCMSR` | 2,390 |
| `/users/$id/isHelper` | 2,390 |
| `/users/$id/isBabyMod` | 1,782 |
| `/users/$id/isPro` (cosmetics row, often present) | **328** |

Role flags are read ~7× more often than `isPro` — because the cosmetics row
usually exists and the roles row never does. That is **~172,000 fallback
reads/day**, plus the full 65 KB `/users/{uid}` reads that happen when *all*
Supabase rows are missing.

**Fix:**
1. One-off backfill: insert an all-false `user_roles` row for all 161,881
   uids. `getRoles()` then returns a row and the fallback stops firing.
2. Make `mirrorRoles` also write when `before` is null (new user), so this
   never re-accumulates.

The existing fallback stays as a safety net — it just stops being the common
path. This is what makes the July login/drawer optimizations actually pay
off; right now they mostly miss.

---

### F5 — Supabase chat tables have no retention at all, while RTDB does
**Severity: medium, compounding · Effort: one migration · Risk: policy call**

RTDB retention is enforced by three scheduled functions — public chat 3 days
(`cleanupOldPublicChats.js:41`), private 20 days
(`cleanupOldPrivateChats.js:31`), group keep-last-300
(`cleanupGroupChatMessages.js:32`). **None of them touch Supabase** — grep of
all three shows only `admin.database()` calls.

There is no `pg_cron` job and no retention clause anywhere in
`supabase/*.sql`. Live chat now lives in Supabase, so `messages`,
`private_messages` and `group_messages` grow forever.

Volume, from the notify-function invocation counts:
`notifyNewMessage` 54,379/7d ≈ **7,800 private messages/day**;
`notifyGroupMessage` 15,684/7d ≈ **2,240 group messages/day**.
Public `messages` is currently 25,067 rows.

≈10k rows/day ⇒ ~3.6 M rows/year, growing DB size, backup size, WAL volume
and index depth indefinitely.

**Fix:** a `pg_cron` job mirroring the RTDB policy. Run this first to see
where you actually stand:

```sql
select relname,
       pg_size_pretty(pg_total_relation_size(relid)) as total,
       n_live_tup
from pg_catalog.pg_statio_user_tables
join pg_stat_user_tables using (relid)
order by pg_total_relation_size(relid) desc
limit 20;
```

---

### F6 — Web: `TradeList` polls Firestore every 30 s forever, including in hidden tabs
**Severity: high (scales with traffic) · Effort: small · Risk: none**

`adoptme-web/src/components/trades/TradeList.tsx:108`:

```ts
pollRef.current = setInterval(() => { fetchAllTrades(true); }, POLL_INTERVAL); // 30s
```

`fetchAllTrades` runs `getTrades({}, 10)` — **10 document reads every 30
seconds per open tab**, whether or not anything changed, and with no
`visibilitychange` gating anywhere in the file. A tab left open for an hour
costs 1,200 reads and returns the same 10 trades 120 times.

This is strictly worse than the realtime alternative: `onTradesSnapshot`
already exists at `src/lib/firebase/firestore.ts:72` and has **no callers**.
A snapshot listener costs 10 reads once plus 1 read per genuinely new trade.

**Fix** — either is fine, do at least the first:
1. Gate the interval on `document.visibilityState === 'visible'` and refetch
   once on `visibilitychange`. Background tabs stop billing.
2. Replace the poll with the existing `onTradesSnapshot`. Cheaper *and* more
   real-time.

The site is a public SEO property, so this is the web finding that scales
worst with traffic growth.

**How big is it today?** Smaller than the code suggests. Hourly Firestore reads
trough at 18,579/hr against a 222,062/hr peak — a poll with many always-open
tabs would hold that floor much higher, so this is currently a minority of
reads (est. $1–5/mo). Worth fixing anyway: it costs the same whether ten people
or ten thousand are on the page, it returns identical data 120 times an hour,
and it ships without an app release. Web traffic isn't instrumented here — if
you have analytics for `/trades` concurrency, that would pin the number.

---

### F7 — Web: `ChatRoomList` reads RTDB `group_meta_data/{uid}` with `onValue`, bypassing the Supabase path
**Severity: medium (cost) + correctness bug · Effort: 3 lines · Risk: none**

`adoptme-web/src/components/chat/ChatRoomList.tsx:58`:

```ts
const userGroupsRef = ref(database, `group_meta_data/${user.id}`);
const unsub = onValue(userGroupsRef, ...);
```

Two problems:

1. **Cost.** `onValue` on a parent node re-downloads *the entire node* on
   every child change — the classic RTDB trap. The project already has the
   fix: `onGroupMetaData()` (`src/lib/firebase/database.ts:373`) routes to
   `supaSubscribeToGroupMeta` when Supabase is configured and only falls back
   to `onValue` otherwise. `ChatRoomList` skips that wrapper and goes
   straight to RTDB.

2. **Correctness.** New group messages fan out into **Supabase**
   `group_meta_data` via `fanout_group_message_meta` (migration 022). The
   RTDB copy is only written by group create / invite-accept / join-approve
   and mirrored *outward* by `mirrorGroupMetaToSupabase`. So the RTDB node
   this component reads has **stale `lastMessage` and `unreadCount`** —
   web users see outdated previews and wrong unread badges.

**Fix:** call `onGroupMetaData(user.id, cb)` instead. Fixes both at once.

Related divergence worth a look: the web writes chat presence to
`users/{userId}/activeChat` (`database.ts:578`, and triggers F1's mirror on
every chat open/close), while the RN app uses a separate `/activeChats/{uid}`
node (`ChatScreen/utils.js:309`). The web's `sendPrivateChatMessage` then
reads `users/{otherUserId}/activeChat` (`database.ts:552`) to decide whether
to push — so web↔app "is the recipient already in this chat?" suppression is
reading a node the app no longer writes.

---

### F8 — `following` query re-fetched uncached in two of three call sites
**Severity: low · Effort: trivial · Risk: none**

> **Corrected 2026-09-02.** This was first written up as "up to 200 document
> reads per screen mount," which is the query's *cap*, not its cost. A count
> of the collection puts the real figure at ~3 docs. Sized correctly this is a
> ~$1/month item, not a headline one — it has been moved down the priority
> list accordingly.

The same query — `where('followerId','==',uid), limit(200)` — runs in three
places:

| Call site | Cached? |
|---|---|
| `Code/Design/StatusFeed.js:306` | ✅ MMKV, 1 h TTL, invalidated on follow/unfollow (`:951`, `:964`) |
| `Code/Trades/Trades.jsx:383` | ❌ every mount |
| `Code/Design/DesignMainScreen.js:168` | ❌ every mount |

Firestore bills per document **returned**, and the `following` collection holds
only **19,534 docs across all users** — so the average user follows ~3 people
and each uncached refetch costs ~3 reads, not 200. `limit(200)` is a ceiling
that is never approached.

Still worth fixing — it is duplicated work against a cache that already exists
and already invalidates correctly — but it is a tidy-up, not a saving.

**Fix:** extract StatusFeed's `following_ids` cache helper and call it from
all three.

---

### F9 — Cloud Functions still running for disabled or superseded features
**Severity: low · Effort: trivial**

- **`fetchWorldCupDataScheduled`** — 335 invocations/week. RTDB
  `worldcup_enabled` is **`false`**, and `fetchWorldCupData.js:277` never
  checks the flag: it pulls the openfootball JSON from GitHub and writes RTDB
  48×/day for a feature that is off. Same for `updateWorldCupLeaderboard`
  (168/week). Delete both, or add a flag check.
- **`sendScheduledPromoMessageMM2`** — 504/week, posting a promo into RTDB
  `chat_new` (the legacy tree only old clients read). Flagged as optional in
  July; still live.
- **`syncModRole_Moderator` / `syncModRole_BabyMod`** — still deployed, and
  now duplicate `mirrorModsRoster` inside `mirrorUsersToSupabase`. Low volume
  (14/week combined) but two code paths writing `mods/{uid}` is a
  correctness hazard, not just waste.

---

### F10 — RTDB egress is dominated by listener *churn*, not payload
**Severity: medium · Effort: medium · Risk: low**

Profile totals for the 600 s window: **21,859 `listener-listen` + 21,841
`listener-unlisten`** — i.e. ~6.3 M listen ops/day, almost perfectly paired.
In RTDB a one-shot `get()` *is* a listen+unlisten pair, so this is
`get()`-per-mount churn, not long-lived subscriptions.

Measured payload is only ~331 MB/day against 1.14 GB/day of metered egress —
the ~3× gap is per-operation protocol and connection overhead. **Reducing the
number of operations matters more here than reducing bytes.**

Hottest paths (events per 10 min, listen+unlisten pairs):

| Path | events | note |
|---|---:|---|
| `/users/$id/xp` | 7,153 | live `onValue` in `HomeTabScreen.jsx:168` re-arms on every Home-tab mount, plus `getUserXP` call sites |
| `/users/$id/shop/activeItems` | 6,892 | see below |
| `/users/$id/_st` | 3,147 | F1 |
| role flags (6 paths) | ~14,000 | F4 |
| `/users/$id` (full record) | 327 | 0.91 MB — up to 65 KB per record |

The `shop/activeItems` one is a clean dedup: `cosmeticsCache.syncMyCosmetics`
reads that exact path behind a 10-minute MMKV TTL
(`Code/Helper/cosmeticsCache.js:28,91`) — but
`profileCache.seedCurrentUser` reads **the same path directly with no cache**
(`Code/Helper/profileCache.js:421`), and it runs on every chat-screen mount.
Route `seedCurrentUser` through `syncMyCosmetics` and the second read
disappears.

Also worth ~1 GB/month: `valueAlertsPoll` (670/week ≈ every 15 min) reads and
rewrites `value_alerts/snapshot`, a **367 KB** blob, every run — the two
largest single events in the entire profile. Admin-SDK traffic is 0.724 MB /
10 min, mostly this.

---

### F11 — Smaller items

- **Duplicate Firestore listeners.** `group_invitations`
  (`invitedUserId == me && status == pending`) and `group_join_requests`
  (`creatorId == me`) are each subscribed in **both**
  `CommunityChatHeader.jsx:50,81` and `GroupsScreen.jsx:147,225`.
  `CommunityChatHeader` is the GroupChat screen's `headerRight`
  (`ChatNavigator.js:216`), so in a stack navigator both can be mounted at
  once. Every Firestore query bills a minimum of 1 read even when it returns
  nothing.
- **Supabase realtime bindings.** Each meta channel registers three separate
  `postgres_changes` bindings (INSERT / UPDATE / DELETE) on the same table
  with the same filter — `groupMetaBackend.js:127-160`, and the same shape in
  `chatMetaBackend.js` and in the web mirrors. The Realtime server evaluates
  every binding against every WAL record for that table. One
  `event: '*'` binding cuts that filter work ~3× at identical delivery
  volume.
- **Web landmine.** `getOnlineUsersWithData` (`database.ts:183`) falls back to
  `get(ref(database, 'users'))` — the **entire** ~900 MB node — if
  `isSupabaseConfigured()` is ever false. Today Supabase is configured so
  this is dormant; one missing env var on a deploy turns it into a
  per-visitor 900 MB download. Replace the fallback with an empty result.

---

## 2. What this actually saves

### Firebase — ≈ $12–18/month, from ~$51/mo metered down to ~$33–39/mo

| Fix | Saving / mo | Confidence |
|---|---:|---|
| **F1** `_st` — Functions fall under every free tier, plus ~5% of RTDB ops | **$5–6** | High — invocation count and write rate both measured, and they agree |
| **F4** backfill `user_roles` — −172k reads/day, fewer 65 KB full-record reads | **$2–3** | Med-high |
| **F10** cosmetics read dedup + the 367 KB `value_alerts` blob every 15 min | **$1.5–2** | Medium |
| **F3** cleanup fix + shell deletion — egress, and storage back under the 1 GB free tier | **$1–1.5** | High |
| **F6** gate the web trade poll | **$1–5** | Low — scales with site traffic, which isn't instrumented here |
| **F8** `following` cache reuse | **$0.5–1** | Medium (revised down — see F8) |
| **F9** dead schedulers | **<$0.20** | High |

**F2 saves $0 today and is still the first thing to do.** Across the whole
10-minute profile every byte came from legitimate app clients — nobody is
currently scraping `/users`. Its value is capping a tail risk that has no
ceiling: one scraper pulling `/users.json` hourly is 21.6 GB/day ≈
**$650/month**, and there is nothing in the rules to stop it. Treat it as
insurance plus a PII fix, not a line item.

### Supabase — realistically $0/month

Not measured. There is no service-role key on the dev machine and RLS blocks
the anon key on every table except public `messages` (25,067 rows), so this is
reasoning rather than telemetry.

Supabase billing is **plan-tier dominated** — Pro is a flat fee that includes
250 GB egress, 8 GB database and ~5 M realtime messages. Nothing found here
suggests any of those is close: ~10k chat rows/day, and migration 022 already
halved realtime deliveries in July. **Below a quota, these fixes reduce cash by
nothing.** F5 and F11 buy headroom and prevent a future tier jump or compute
add-on upgrade — that is the actual argument for them, and F5 compounds at
~3.6 M rows/year.

To convert this into a real number, check **Supabase → Reports → Usage** for
egress GB, database size and realtime message count against the plan's
included amounts. If any sits above ~70%, F5 and F11 move up sharply. If all
are comfortably under, they can wait for the next time that code is touched.

### Why Firestore has no big win in it

Worth recording so this isn't re-investigated later. Hourly read counts track
real user activity — trough **18,579/hr** at 07:31 UTC against a peak of
**222,062/hr**. A runaway listener or dominant poll would hold the trough much
closer to the median; it doesn't. Collection sizes are small:

```
reviews              108,442 docs
following             19,534
trades_new             2,396
designPosts              771
group_invitations        474
statuses                  39
```

`reviews` is by far the largest and was the obvious suspect, but every query
against it is bounded (`limit(5/20/100)`), and the rating path is properly
gated: summary doc → RTDB `averageRatings` → a 100-doc scan only as a last
resort, which then writes a summary so it cannot recur for that user.

The ~1.26 M reads/day are mostly legitimate paginated product usage — trades
browsing, feed, review pagination. Beyond F6 there is no structural saving
here without cutting functionality.

---

## 3. Suggested order

Ranked by money the order is F1 → F4 → F10 → F3. Ranked by risk, F2 is first
regardless — it is the only finding with an unbounded downside.

| # | Item | Effort | Why here |
|---|---|---|---|
| 1 | **F2** lock `/users` rules | rules | uncapped cost + live PII exposure |
| 2 | **F1** move `_st` off `/users` | 1 line | −92% of invocations, zero risk, biggest measured saving |
| 3 | **F4** backfill `user_roles` | script | −172k RTDB reads/day |
| 4 | **F6** gate web trade polling | small | small today, but the only cost that grows linearly with site traffic — and ships without an app release |
| 5 | **F3** fix / retire private-chat cleanup | medium | broken today; unblocks retention |
| 6 | **F10** cache reuse + `value_alerts` blob | small | −RTDB ops |
| 7 | **F7** web `ChatRoomList` → Supabase | 3 lines | ~$0, but fixes a live stale-data bug |
| 8 | **F5** Supabase retention | migration | compounding; $0 until a quota is neared |
| 9 | **F8**, **F9**, **F11** cleanup | trivial | tidy-up |

---

## 4. Verify after applying

- **Functions:** `mirrorUsersToSupabase` should drop from ~165k/day to under
  10k/day within a day of the F1 build shipping. Total project invocations
  should fall under the 2 M/month free tier.
- **RTDB egress:** console → Realtime Database → Usage. Expect a step down
  after F2 (rules, immediate), and a second after the F4 backfill and the F1
  + F10 build.
- **Firestore reads:** should drop within hours of the F6 web deploy — that
  one needs no app release.
- **`cleanupOldPrivateChats`:** logs should show a completed run with a
  non-zero deleted count instead of `status: 'timeout'`.
- **Functional smoke test:** app start and foreground (server-time-gated
  daily rewards, ad cooldowns, translation cap still correct); profile drawer
  shows correct role pills; group list shows correct last message and unread
  badge on **web**; trades list still refreshes; login on a brand-new
  account.
