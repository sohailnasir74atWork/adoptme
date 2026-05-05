# RTDB Cost-Reduction Update — Handoff

Last touched: 2026-05-04 (evening). Hand this to the next agent so nothing gets re-done or accidentally undone.

## Why this work exists

RTDB bill was ~$420/mo and trending up steeply (was $294 by day 21 of April). RTDB = 81% of total Firebase bill. **Bandwidth/egress is the cost driver, not ops.**

A 10-min RTDB profile (2026-04-28) revealed the heaviest paths:

| Path | Reads in 8.5 min | MB |
|---|---|---|
| `/users/$wildcard` | 1,687 (full obj fetch) | 4.38 MB |
| `/chat_meta_data/$wildcard` | 238 | 3.45 MB |
| `/users/$wildcard/$wildcard` | 91,222 (per-field) | 1.52 MB |
| `/users/$wildcard/$wildcard/activeItems` | 18,099 | 1.20 MB |
| `/banned_users_by_email/$wildcard` | 18,527 | 0.48 MB |
| `/private_messages/$wildcard/messages` | 393 | 0.15 MB |

Plan was 4 wins. **All done.** Phase 4 (`/users` split) fully complete — all 8 tables mirrored, all client waves (1–4) done, `user_roblox` client swap also done. **Pending: app ship.**

A second 20-min RTDB profile was captured 2026-05-04 16:21. Numbers used for cost estimates below.

---

## Status

| # | Task | Status |
|---|---|---|
| 1 | Narrow `profileCache.js` fetches | ✅ shipped |
| 2 | Add `.indexOn: ["completedAt"]` for `/tradeJournal/$uid` | ✅ deployed 2026-05-03 |
| 3 | Remove RTDB `/analytics` write | ❌ **deliberately skipped** — CDN sync pipeline depends on it |
| 4 | Mirror `chat_meta_data` + `group_meta_data` to Supabase | ✅ deployed + backfilled — ⏳ app ship pending |
| 5 | Mirror `/users/{uid}` into 8 Supabase tables — all client waves done | ✅ all code in — ⏳ app ship pending |
| 6 | Swap `user_roblox` client reads to Supabase | ✅ all 5 read sites swapped (profileCache, PrivateChatHeader, OnlineUsersList, SocialDashboard, BottomDrawer, GlobelStats login) |

---

## #1 — `profileCache.js` narrow fetch (DONE, no deploy needed — code change only)

[Code/Helper/profileCache.js](Code/Helper/profileCache.js) — `getOrFetchProfile` now does parallel narrow `get()` calls on the 11 specific fields chat actually renders + `shop/activeItems`, instead of pulling the whole `/users/$uid` subtree.

Expected impact: ~85% bandwidth drop per profile fetch — kills ~80% of the 4.38 MB / 91k-read pattern from the profile.

`getOrFetchFullProfile` (line ~250) is left alone on purpose — it's used by admin tools / BottomDrawer that legitimately need the whole user record.

## #2 — `/tradeJournal/$uid` index (DONE — needs rules deploy)

[PRESENCE_RULES.json](PRESENCE_RULES.json) — added `tradeJournal` block with `".indexOn": ["completedAt"]` per `$uid`. The current code in [Code/Engagement/TradeJournal.js](Code/Engagement/TradeJournal.js) sorts by `completedAt`, which was triggering full-scan reads.

**Deploy when convenient:** redeploy RTDB rules (Firebase Console → Realtime Database → Rules, paste contents of `PRESENCE_RULES.json`).

## #3 — `/analytics` RTDB write — SKIPPED ON PURPOSE

[functions/aggregateTradeAnalytics.js:444](functions/aggregateTradeAnalytics.js#L444) still writes the analytics blob to RTDB. **DO NOT remove it** — there's an out-of-band process that reads `/analytics` from RTDB and pushes to Bunny CDN (`https://analytics.b-cdn.net`). Removing the RTDB write breaks that pipeline. Cost saved (~$8/mo) doesn't justify the risk of breaking older app versions.

## #4 — Chat metadata mirror to Supabase (DEPLOYED, awaiting backfill)

### Architecture

**RTDB stays source of truth.** The app keeps writing `increment()`, mute toggles, lastMessage updates straight to RTDB. Two new Cloud Functions tail those writes and upsert/delete rows in Supabase. The client reads from Supabase via realtime channels.

```
Send msg → PrivateChat.jsx writes RTDB increment(unreadCount)
              │
              ├─► notifyNewMessage CF (UNCHANGED) ─► FCM push
              │
              └─► mirrorChatMetaToSupabase CF (NEW) ─► upsert Supabase row
                                                            │
ChatNavigator/InboxScreen ◄── Supabase realtime channel ◄───┘
```

This preserves: notification CFs, `/activeChats` + `/activeGroupChats` presence, old app-version compatibility, all existing client write paths.

### Files (all created / modified by this update)

**Schema:**
- [supabase/003_chat_metadata.sql](supabase/003_chat_metadata.sql) — `chat_meta_data` + `group_meta_data` tables, RLS (read-own), realtime publication, replica identity full.

**Cloud Functions:**
- [functions/_supabaseAdmin.js](functions/_supabaseAdmin.js) — memoised service-role client.
- [functions/mirrorChatMetaToSupabase.js](functions/mirrorChatMetaToSupabase.js) — RTDB onWrite at `/chat_meta_data/{ownerUid}/{partnerUid}` → upsert/delete Supabase.
- [functions/mirrorGroupMetaToSupabase.js](functions/mirrorGroupMetaToSupabase.js) — same for `/group_meta_data/{userId}/{groupId}`.
- [functions/package.json](functions/package.json) — added `@supabase/supabase-js`.

**Client modules (read-only; writes still on RTDB):**
- [Code/Supabase/chatMetaBackend.js](Code/Supabase/chatMetaBackend.js) — `subscribeToChatMeta(uid, {onUpsert, onRemove, onReady, onStatus})` matching the prior RTDB listener interface.
- [Code/Supabase/groupMetaBackend.js](Code/Supabase/groupMetaBackend.js) — same shape for groups.

**Listener swaps:**
- [Code/ChatScreen/ChatNavigator.js](Code/ChatScreen/ChatNavigator.js) — both `chat_meta_data` and `group_meta_data` listeners replaced with Supabase subs. Block-user reset `update()` still writes RTDB (mirror CF replays it back).
- [Code/ChatScreen/GroupChat/InboxScreen.jsx](Code/ChatScreen/GroupChat/InboxScreen.jsx) — `chat_meta_data` listener replaced with Supabase sub. Mute toggle still writes RTDB.

**Backfill script:**
- [scripts/backfill-chat-meta-to-supabase.js](scripts/backfill-chat-meta-to-supabase.js) — one-shot, idempotent (upsert), reads RTDB chat_meta_data + group_meta_data and writes Supabase.

### Deploy state (2026-04-29)

| Step | State |
|---|---|
| `supabase/003_chat_metadata.sql` applied | ✅ done |
| `cd functions && npm install` | ✅ done |
| Firebase secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` set | ✅ done |
| `mirrorChatMetaToSupabase` deployed | ✅ done |
| `mirrorGroupMetaToSupabase` deployed | ✅ done |
| Backfill script run | ✅ done 2026-04-29 — chat=606,931 / group=2,671 rows in Supabase (4-worker parallel run) |
| App build with new client code shipped | ❌ **not yet** |
| RTDB rules redeployed (`PRESENCE_RULES.json` w/ tradeJournal index) | ✅ done 2026-05-03 |

### Next steps for next agent

1. **Sanity-check live mirror** before backfill: send a real chat msg from a test account, then in Supabase SQL editor:
   ```sql
   select * from public.chat_meta_data order by updated_at desc limit 5;
   ```
   Should see the row within ~1–2s. If yes, mirror is healthy.

2. **Run the backfill** (exact command in [scripts/backfill-chat-meta-to-supabase.js](scripts/backfill-chat-meta-to-supabase.js) header). Without this, users only see chats from *new* messages after the deploy; older chat lists/groups are missing until someone sends another message.

3. **Build & ship the app.** Client code already reads from Supabase. Old app versions on the store keep reading from RTDB and continue to work fine — RTDB still gets every write.

4. **Deploy `PRESENCE_RULES.json`** so the `tradeJournal` index lands.

---

## ⚠️ DO NOT TOUCH / DO NOT UNDO

These are deliberate choices, not oversights. Touching them breaks production.

1. **Don't migrate any *write* path off RTDB.**
   - `PrivateChat.jsx` writes `unreadCount` `increment(1)` and `unreadCount: 0` reset → **must stay RTDB**. `notifyNewMessage` triggers on this. Move it and notifications die.
   - `groupUtils.js` per-member fan-out on send → **must stay RTDB** (`notifyGroupMessage` triggers).
   - `InboxScreen.jsx` mute toggle, blocked-user `unreadCount: 0` reset → **must stay RTDB**. Mirror CF replays them to Supabase.
   - `setActiveChat` / `setActiveGroupChat` (in `Code/ChatScreen/utils.js`) → **must stay RTDB**. Notification CFs read these for presence-based suppression.

2. **Don't remove the RTDB `/analytics` write** in [aggregateTradeAnalytics.js:444](functions/aggregateTradeAnalytics.js#L444). External CDN sync depends on it.

3. **Don't change `notifyNewMessage`, `notifyGroupMessage`** unless you're adding behavior — they read RTDB; the mirror is in addition to, not instead of.

4. **Don't broaden `profileCache.js` back to a full `/users/${uid}` fetch.** That's the bandwidth fire we just put out. If a new field is needed in chat rendering, ADD it to the explicit list at the top of `getOrFetchProfile` — don't go back to fetching the whole record.

5. **`/users` migration is IN PROGRESS — see Phase 4 below.** Backend (mirror CF, backfill of 125,961 users, 8 split tables) is DONE. Wave 1+2 client code (identity / roles / cosmetics swap in `profileCache.js`) is DONE and proven on a test device. Pending: ship the app build, then Wave 3 (settings + notifications) and Wave 4 (blocks + badges) in subsequent ships. **Do NOT touch the migrated tables, the mirror CF, or the field mapping doc unless you've read Phase 4.**

6. **Don't migrate `/private_messages` yet** — has `notifyNewMessage` Cloud Function trigger; needs Edge Function rewrite. Phase 5 (was Phase 3 in earlier numbering). User wants to do this AFTER the `/users` migration ships.

7. **Don't dual-write from the client.** The mirror CFs are the only writers to Supabase. Adding a client-side optimistic upsert is tempting but introduces race conditions with the CF.

8. **Don't add a unique constraint on `user_roblox.roblox_username` (verified)** — production RTDB intentionally allows the same Roblox username to be claimed by multiple verified Firebase UIDs (account recovery, lost password → new account, etc). Adding the constraint will block legitimate users + the mirror CF will fail forever on those rows. The original Phase 4 schema had this index; it was dropped 2026-05-04. See `supabase/004_users_split.sql` for the dropped-index note.

9. **Don't store `lastActivity` as ISO string anymore.** It's now `Date.now()` (ms epoch number) at [Code/GlobelStats.js:449](Code/GlobelStats.js#L449), mirrored to `user_identity.last_activity_ms` (bigint). [Code/LocalGlobelStats.js:60](Code/LocalGlobelStats.js#L60) tolerates both during the transition release window — don't simplify it back to one type until 100% adoption.

---

## Useful context for the next agent

---

## ⚠️ Supabase Operational Lessons (learned 2026-05-05)

### Incident: Disk IO Budget Exhausted → Supabase slowdown

**What happened:**
1. Phase 2 backfill (Apr 29) inserted 606,931 rows into `chat_meta_data` in one shot.
2. Phase 4 backfill (May 4) inserted ~1 million rows across 8 user tables.
3. The `mirrorChatMetaToSupabase` CF fires on every message sent — each upsert creates a dead tuple in Postgres (upsert = delete old + insert new internally).
4. Dead tuples accumulated to 73.7% of `chat_meta_data` because the default autovacuum threshold (20% of rows) = 125,000 dead rows needed before cleanup — never reached.
5. Postgres couldn't serve queries from memory → hit disk constantly → disk IO budget exhausted → Supabase throttled to 43 Mbps baseline → mirror CF lag → unread badge stuck.

**Fix applied (2026-05-05):**
- Ran `VACUUM ANALYZE` on `chat_meta_data` and `group_meta_data` via `npx supabase db query --linked`.
- Dead rows dropped from 73.7% → 0% immediately.
- Tightened autovacuum thresholds on both high-churn tables so this self-heals going forward.

**Autovacuum settings now applied:**
```sql
ALTER TABLE public.chat_meta_data SET (
  autovacuum_vacuum_scale_factor = 0.01,   -- vacuum after 1% dead rows (was 20%)
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_scale_factor = 0.01
);
ALTER TABLE public.group_meta_data SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_scale_factor = 0.01
);
```

### Rule: Always VACUUM after any bulk backfill

After every backfill script, run:
```bash
SUPABASE_ACCESS_TOKEN=<token> npx supabase db query --linked \
  "VACUUM ANALYZE public.<table_name>;"
```
Do this for every table the backfill touched. Don't skip it — Postgres won't autovacuum fast enough after a bulk insert.

### Rule: Monitor dead tuple bloat monthly

Run this in Supabase SQL editor once a month:
```sql
SELECT relname, n_dead_tup,
  round(n_dead_tup::numeric/(n_live_tup+n_dead_tup+1)*100,1) as dead_pct,
  last_autovacuum
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY n_dead_tup DESC;
```
**If any table shows >5% dead rows with no recent `last_autovacuum` → run VACUUM manually.**

### High-churn tables to watch (upsert-heavy, bloat-prone)

| Table | Why high churn | Mirror CF |
|---|---|---|
| `chat_meta_data` | Every private message = 1 upsert | `mirrorChatMetaToSupabase` |
| `group_meta_data` | Every group message = N upserts (1 per member) | `mirrorGroupMetaToSupabase` |
| `user_identity` | Every app launch writes `last_activity_ms` | `mirrorUsersToSupabase` |

All three now have tight autovacuum settings (1% threshold). If you add new mirror CFs for other tables (Phase 5: messages), apply the same autovacuum tuning immediately after creating the table.

### How to run VACUUM (SQL editor blocks it in a transaction)

The Supabase SQL editor wraps queries in a transaction — VACUUM can't run inside a transaction. Use the CLI instead:

```bash
# One-time setup (already done for this project)
SUPABASE_ACCESS_TOKEN=<your_pat> npx supabase link --project-ref kvtbtzhtcaanhjblyick

# Run VACUUM
SUPABASE_ACCESS_TOKEN=<your_pat> npx supabase db query --linked \
  "VACUUM ANALYZE public.chat_meta_data;"
```

Get a PAT from: supabase.com/dashboard/account/tokens. Revoke it after use.

### Unread badge lag — root cause and fix

During the disk IO incident, the mirror CF was slow → `unread_count` in Supabase lagged behind RTDB → badge didn't clear when user read a chat.

**Permanent fix (in build 1.11.10):** `resetUnreadCount()` in `chatMetaBackend.js` writes `unread_count=0` directly to Supabase when the user opens a chat — bypasses the mirror CF entirely for this one write. RTDB still gets the same write for the notification CF. This makes badge clearing instant regardless of mirror lag or disk IO pressure.

---

- **Supabase project ID:** `kvtbtzhtcaanhjblyick` (URL: `https://kvtbtzhtcaanhjblyick.supabase.co`)
- **Firebase project:** `adoptme-7b50c`
- **Phase 1 (public chat) is already on Supabase** — see [Code/Supabase/chatBackend.js](Code/Supabase/chatBackend.js) and [Code/ChatScreen/GroupChat/Trader.jsx](Code/ChatScreen/GroupChat/Trader.jsx). The phase 1 schema is in [supabase/schema.sql](supabase/schema.sql); phase 1 used a *clean-cut* approach (no dual-write). This phase (chat metadata) uses *RTDB-source-of-truth + CF mirror* because chat metadata has Cloud Function notification dependencies that public chat didn't.
- **Auth model:** Firebase ID token via Supabase Third-Party Auth. `public.firebase_uid()` SQL helper extracts the UID. Defined in [supabase/schema.sql](supabase/schema.sql).
- **`functions/index.js` does NOT exist.** Each function file is deployed individually via `firebase deploy --only functions:<name>`. Don't add an index.js unless you understand why it isn't there.
- **`firebase.json` has no `functions` section.** Functions deploy works via the user's own setup. Don't add a functions section without checking with them first.

## Cost estimate — what ships with the next build

Based on the 20-min RTDB profile captured 2026-05-04 16:21 UTC (~90 MB total downloaded).
Extrapolated to 30 days. RTDB egress billed at ~$1/GB.

### What the next build eliminates

| Path | 20-min MB | → daily GB | Status |
|---|---|---|---|
| `/users/$wildcard` (full-doc) | 6.33 MB | 13.6 GB | ✅ Supabase (profileCache + GlobelStats) |
| `/users/$wildcard/$wildcard` (per-field) | 1.66 MB | 3.6 GB | ✅ Supabase (profileCache) |
| `/users/$wildcard/$wildcard/activeItems` | 3.66 MB | 7.9 GB | ✅ Supabase (profileCache) |
| `/group_meta_data/$wildcard` | 0.57 MB | 1.2 GB | ✅ Supabase (InboxScreen / ChatNavigator) |
| `/chat_meta_data/$wildcard` | 0.06 MB | 0.1 GB | ✅ Supabase (InboxScreen / ChatNavigator) |
| **Total eliminatable** | **~12.3 MB** | **~26.4 GB/day** | |

At $1/GB → **~$790/month saved** once adoption ramps (assumes ~50% of users on new build immediately → ~$395/mo initial, full at ~100% adoption).

Note: the `chat_meta_data` and `group_meta_data` rows in the snapshot are residual — the server-side mirror is deployed but the app build hasn't shipped. Once it ships they collapse.

### What remains on RTDB after ship (still paying for)

| Path | 20-min MB | Reason still RTDB | Next action |
|---|---|---|---|
| `/xlsData` | 73.30 MB | **CF-only** (scheduledFunction.js reads entire node). Client already on CDN. | Investigate why 85 CF reads in 20 min (should be 0.1). Fix the CF to skip RTDB read when data unchanged. |
| `/private_messages/$wildcard/messages` | 0.58 MB | Phase 5 — needs notification trigger rewrite | After `/users` ships |
| `/private_messages/$wildcard/trade` | 0.16 MB | Phase 5 | After `/users` ships |
| `/private_messages/$wildcard/messages/$wildcard` | 0.16 MB | Phase 5 | After `/users` ships |
| `/private_messages/$wildcard/lastRead` | 0.05 MB | Phase 5 | After `/users` ships |
| `/private_messages/$wildcard/post` | 0.008 MB | Phase 5 | After `/users` ships |
| `/banned_users_by_email/$wildcard` | 0.54 MB | Chat ban checks (3 onValue listeners) | Supabase RPC — 3–4 days |
| `/analytics` | 0.54 MB | Deliberate — CDN sync pipeline | DO NOT TOUCH |
| `/image_url` | 0.17 MB | Global config read — tiny | Low priority |
| `/group_messages/…/messages` | ~0.40 MB | Phase 5 | After `/users` ships |
| `/activeChats/$wildcard` | 0.01 MB | Presence — intentional | Stay RTDB |
| `/server`, `/api`, `/like_counter` etc | ~0.20 MB | Config / misc | Low priority |

**Remaining after ship: ~76 MB / 20 min** — but **73 MB of that is `/xlsData`** (a CF bug, not user traffic). Excluding xlsData, remaining user-driven RTDB egress is ~**3 MB / 20 min** (~6.5 GB/day, ~$195/mo).

### Summary

| | Before any migration | After next ship |
|---|---|---|
| RTDB bill | ~$420/mo | ~$120–150/mo (estimated) |
| Biggest remaining cost | `/users` | `/xlsData` CF bug + `/private_messages` |
| Next best action | ship the build | fix xlsData CF then Phase 5 |

---

## Future RTDB-cost work (next phases)

Ranked by leverage — pick one as a unit, don't bundle:

1. **Fix `/xlsData` CF** — `scheduledFunction.js` reads the entire node (862 kB) on every run and apparently ran 85× in 20 min (should be once every 4 hours). Either a scheduling bug or a hot-loop. Fix: cache the last hash and skip the RTDB read if the source API returns no change. ~1 hour. **Biggest remaining cost driver.**
2. **`/private_messages` + `/group_messages` → Supabase (Phase 5)** — needs notification trigger rewrite. See "Phase 5 plan" below. 8–10 days. **User wants this NEXT after `/users` ships.**
3. **`/banned_users_by_email` lookups** — 0.54 MB / 43k reads in 20 min. Move to Supabase RPC or pre-loaded Set. 3–4 days.
4. **`/users/{uid}/shop` subtree → Supabase** — DEFERRED from Phase 4. Profile frames live here. 3–4 days.
5. **`/users/{uid}/{economy}` (rewardPoints, xp, dailyStars, levelRewards) → Supabase** — DEFERRED from Phase 4. Atomic counter concerns. 3–4 days.

---

## Phase 4: `/users/{uid}` split into Supabase (✅ COMPLETE — pending app ship)

All 8 tables mirrored, all client waves (1–4) done, `user_roblox` reads also swapped. Only the app build needs shipping.

`/users/$wildcard` was 6.33 MB / 3,067 reads in the 20-min profile — the #1 user-driven cost after xlsData. All client readers now prefer Supabase.

### Architecture (same RTDB-source pattern as Phase 2)

```
App writes /users/{uid}            (UNCHANGED — old apps + 14 CFs still work)
            │
            ├─► 7 RTDB-trigger CFs   (UNCHANGED — syncModRole_*, syncBadgeRoster, etc.)
            │
            └─► mirrorUsersToSupabase CF   (NEW)
                 │   reads change.after.val(), fans out to 8 split tables
                 ▼
                 user_identity / user_roblox / user_roles / user_cosmetics /
                 user_notifications / user_settings / user_badges / user_blocks
                          │
profileCache.js ──── reads identity + roles + cosmetics + roblox from Supabase ─┘
                     (RTDB falls back per-field if Supabase row missing)
```

### Path 2 scope (what's IN this phase)

8 tables. Excludes shop / economy / game state / fcmToken — those are deferred to future phases (see Future Work list above).

| Table | Purpose | RLS | Mirrored fields |
|---|---|---|---|
| `user_identity` | displayName, avatar, etc | public-read | displayName, avatar, email, decoded_email, flag (was `flage`), date_of_birth, OS, created_at_ms, last_activity_ms, last_profile_edit_ms |
| `user_roblox` | Roblox link | public-read | roblox_username, roblox_user_id (string), roblox_username_verified |
| `user_roles` | Mod / trust flags | public-read | is_admin (was `admin`), is_moderator, is_baby_mod, is_trusted, is_cmsr |
| `user_cosmetics` | Display state | public-read | top_badge, is_pro |
| `user_notifications` | Push prefs | owner-only | is_token_invalid, mute_trade_notifs, notification_settings (JSONB) |
| `user_settings` | Misc toggles | owner-only | is_reminder_enabled, is_selected_reminder_enabled |
| `user_badges` | Earned badges | public-read | (uid, badge_id, earned_at_ms, metadata JSONB) — relational |
| `user_blocks` | Block list | owner-only | (uid, blocked_uid, blocked_at_ms) — relational |

**Renames** (mirror translates RTDB→Supabase, both directions stay valid):
- RTDB `admin` → Supabase `is_admin` (canonicalize; RTDB `users/{uid}/isAdmin` is a dead path that always returns null — DON'T add an `isAdmin` field to RTDB)
- RTDB `flage` → Supabase `flag` (typo fix)
- RTDB `userName` → DROPPED (dead, no readers in source)

**Files**:
- Schema: [supabase/004_users_split.sql](supabase/004_users_split.sql)
- Field map: [supabase/004_users_split_FIELD_MAPPING.md](supabase/004_users_split_FIELD_MAPPING.md) (READ THIS before touching the mirror)
- Mirror CF: [functions/mirrorUsersToSupabase.js](functions/mirrorUsersToSupabase.js)
- Backfill: [scripts/backfill-users-to-supabase.js](scripts/backfill-users-to-supabase.js)
- Client backend: [Code/Supabase/userBackend.js](Code/Supabase/userBackend.js) — all 8 tables: `getIdentity`, `getRoles`, `getCosmetics`, `getRoblox`, `getSettings`, `getNotifications`, `getBlocks`, `getBadges` + batch variants
- Client consumer (chat profile): [Code/Helper/profileCache.js](Code/Helper/profileCache.js) — `getOrFetchProfile` races Supabase (identity + roles + cosmetics + roblox) + RTDB fallback
- Client consumers (roblox): [Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx](Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx), [Code/ChatScreen/GroupChat/OnlineUsersList.jsx](Code/ChatScreen/GroupChat/OnlineUsersList.jsx), [Code/ChatScreen/GroupChat/BottomDrawer.jsx](Code/ChatScreen/GroupChat/BottomDrawer.jsx), [Code/AppHelper/SocialDashboard.js](Code/AppHelper/SocialDashboard.js) — all swapped to `getRoblox` / `getRobloxBatch`
- Client consumer (notifications): [Code/Engagement/NotificationFeed.js](Code/Engagement/NotificationFeed.js) — `muteTradeNotifs` reads Supabase first
- Client consumer (blocks): [Code/GlobelStats.js](Code/GlobelStats.js) — seeds `localState.bannedUsers` from `user_blocks` at login
- Client consumer (badges): [Code/ChatScreen/GroupChat/BottomDrawer.jsx](Code/ChatScreen/GroupChat/BottomDrawer.jsx) — `getBadges` in parallel with `getOrFetchFullProfile`
- Own-user login: [Code/GlobelStats.js](Code/GlobelStats.js) — roblox fields removed from RTDB PROJECTION, fetched from `user_roblox` instead
- New writer: [Code/GlobelStats.js](Code/GlobelStats.js) — `lastActivity = Date.now()` on cold launch (was ISO string)
- Backward-compat read: [Code/LocalGlobelStats.js](Code/LocalGlobelStats.js) — tolerates ISO string from old MMKV during transition

### Deploy state (2026-05-04 — ALL CODE DONE)

| Step | State |
|---|---|
| `supabase/004_users_split.sql` applied | ✅ done |
| `mirrorUsersToSupabase` CF deployed | ✅ done — live, firing ~30×/min, all 'ok' |
| Backfill script run | ✅ done — 125,887 users. identity=125,961 / roblox=125,900 / roles=125,885 / cosmetics=125,961 / notifications=125,950 / settings=125,885 / badges=14,502 / blocks=7,505 |
| Wave 1 client (user_identity) | ✅ done |
| Wave 2 client (user_roles + user_cosmetics) | ✅ done |
| Wave 2b client (user_roblox — all 5 read sites) | ✅ done 2026-05-04 |
| Wave 3 client (user_notifications muteTradeNotifs) | ✅ done 2026-05-04 |
| Wave 4 client (user_badges + user_blocks login seed) | ✅ done 2026-05-04 |
| **App build shipped** | ❌ **PENDING — this is the only remaining step** |

### Backfill quirks the next agent should know

1. **Supabase SQL editor rolls back on partial failures.** If you ever re-apply `004_users_split.sql` and one statement errors, every preceding statement also gets rolled back. Apply in chunks (tables → indexes → RLS → policies → publication) to isolate failures.

2. **Original schema had a `unique(roblox_username) WHERE verified` constraint that broke the backfill.** Production has many users legitimately verified to the same Roblox name (account recovery, lost password). The constraint was dropped 2026-05-04 — see `004_users_split.sql` and DO NOT TOUCH #8.

3. **The mirror CF fires on every `/users/{uid}` write — including hot-path writes for fields we don't mirror** (rewardPoints increments, etc). Each per-table mirror function checks if its specific keys changed and skips otherwise. Acceptable cost — DON'T add per-field RTDB triggers, that fragments the deploy and complicates retries.

4. **The backfill script does ONE `get(users/{uid})` per user**, not per-field. Earlier version did 27 narrow gets per user and was 25× slower. Single-blob is fine for backfill — bandwidth on read is cheap relative to per-request latency.

5. **Backfill is idempotent.** Upserts on conflict; relational tables (`user_badges`, `user_blocks`) use `ignoreDuplicates` so re-running doesn't bump `earned_at_ms` / `blocked_at_ms`. Safe to rerun anytime.

6. **`last_activity_ms` was null for everyone after backfill.** Cause: client wrote ISO strings, mirror's `asNumber()` coerce rejected strings. Fixed by switching writer to `Date.now()` — but old app versions still write ISO strings, so they'll continue to land as null in Supabase until they update. That's expected — the app-ship is what makes this column populate.

### What Wave 3 + 4 need to do

**Wave 3** (settings + notifications):
- Add `getSettings`, `getNotifications` (+ batch versions) to `userBackend.js` — same pattern as Wave 2's `getRoles`/`getCosmetics`
- Add Supabase reads to whatever screens read `users/{uid}/notificationSettings` etc — likely Setting.jsx + the 5 notification CFs (only client reads change; CFs stay on RTDB this phase)
- Don't touch fcmToken — that's Phase 5

**Wave 4** (blocks + badges):
- Add `getBlocks(uid)` returning `Set<blockedUid>` — used by chat send guards in BottomDrawer / PrivateChatHeader / BlockUserList / GroupMessageInput / PrivateMessageInput
- Add `getBadges(uid)` returning `Map<badgeId, {earned_at, metadata}>` — used by BadgesScreen
- Both have RTDB fallback paths

### Cost expectation (when shipped + adopted)

Captures most of the ~$150-200/mo `/users` bandwidth target. Combined with Phase 2 (chat metadata), should bring the RTDB bill from ~$420/mo down significantly — exact number depends on adoption curve. Phase 5 (messages) adds only ~$5-15/mo on its own — see profiling sample.

---

## Phase 5 plan: notification trigger swap (DO NOT IMPLEMENT YET)

When messages are eventually moved off RTDB, `notifyNewMessage` and `notifyGroupMessage` stop firing — they're declared as `database.ref(...).onCreate(...)`, so no RTDB write = no invocation = silent app. **The body of the notification functions does NOT need to change. Only the trigger.**

### Why "just swap the trigger" works here

Everything the notification functions read still lives on RTDB (and is explicitly NOT migrating per "DO NOT TOUCH" #1):

- `/activeChats/$uid` — presence-based push suppression
- `/activeGroupChats/$uid` — same for groups
- `/users/$uid/fcmToken` — FCM device token (per "Don't migrate `/users` yet")
- `/users/$uid/notifyMessages`, `/users/$uid/notifyGroupMessages` — per-user mute prefs

So Firebase + Supabase coexist: Supabase becomes the messages DB and the *trigger source*; Firebase Admin SDK still does the FCM send and still reads presence/tokens from RTDB.

### Architecture (Phase 5, post-migration)

```
App writes msg → Supabase INSERT into private_messages
                    │
                    └─► Supabase Database Webhook (configured in Supabase dashboard)
                          │   POST https://us-central1-adoptme-7b50c.cloudfunctions.net/notifyNewMessage
                          │   body: { chatId, senderId, receiverId, text, sentAt, … }
                          ▼
                       Firebase HTTP function (existing notifyNewMessage, retriggered)
                          │
                          ├─► reads RTDB /activeChats/$receiverId       (unchanged ✅)
                          ├─► reads RTDB /users/$receiverId/fcmToken    (unchanged ✅)
                          ├─► reads RTDB /users/$receiverId/notifyMessages
                          └─► sends FCM push                            (unchanged ✅)
```

### The exact code change (recipe — DO NOT APPLY YET)

**Before** ([functions/notifyNewMessage.js](functions/notifyNewMessage.js)):
```js
exports.notifyNewMessage = functions
  .database.ref('/private_messages/{chatId}/messages/{msgId}')
  .onCreate(async (snapshot, context) => {
    const message = snapshot.val();
    const { chatId, msgId } = context.params;
    // …read /activeChats, read /users/$uid/fcmToken, send FCM
  });
```

**After:**
```js
exports.notifyNewMessage = functions
  .https.onRequest(async (req, res) => {
    // Verify the request is from Supabase — webhooks support a shared header secret.
    if (req.get('x-webhook-secret') !== process.env.SUPABASE_WEBHOOK_SECRET) {
      return res.status(401).send('unauthorized');
    }
    const { record } = req.body;  // Supabase wraps the new row in `record`
    const message = {
      senderId: record.sender_id,
      receiverId: record.receiver_id,
      text: record.text,
      sentAt: record.sent_at,
    };
    const chatId = record.chat_id;
    const msgId = record.id;
    // …same body as before — read /activeChats, /users/$uid/fcmToken, send FCM
    res.status(200).send('ok');
  });
```

The FCM-sending body is **literally copy-paste**. Same for `notifyGroupMessage`.

### Supabase webhook config

Supabase Dashboard → Database → Webhooks → Create:
- Table: `private_messages`
- Events: INSERT
- Type: HTTP Request
- URL: `https://us-central1-adoptme-7b50c.cloudfunctions.net/notifyNewMessage`
- HTTP Headers: `x-webhook-secret: <random secret you also set as a Firebase secret>`
- Same for `group_messages` → `notifyGroupMessage`.

### `unreadCount` in Phase 5

`PrivateChat.jsx` today calls RTDB `increment(unreadCount, 1)` — atomic on the RTDB server. After Phase 5, two clean options:

**Option A — Postgres trigger on the messages table** (recommended):
```sql
create or replace function bump_unread_on_msg() returns trigger language plpgsql as $$
begin
  insert into chat_meta_data (owner_uid, partner_uid, chat_id, last_message, timestamp_ms, unread_count, …)
  values (NEW.receiver_id, NEW.sender_id, NEW.chat_id, NEW.text, NEW.sent_at_ms, 1, …)
  on conflict (owner_uid, partner_uid)
  do update set
    last_message = excluded.last_message,
    timestamp_ms = excluded.timestamp_ms,
    unread_count = chat_meta_data.unread_count + 1;
  return NEW;
end $$;

create trigger bump_unread_after_msg_insert
after insert on private_messages
for each row execute function bump_unread_on_msg();
```
One INSERT into `private_messages` → trigger atomically updates `chat_meta_data.unread_count` AND fires the webhook for FCM. No client round-trip needed. This also means the Phase 5 webhook fully replaces the existing `mirrorChatMetaToSupabase` CF for the message-driven update path.

**Option B — RPC called from the HTTP function**, after the FCM send:
```js
await supabaseAdmin.rpc('bump_unread', { receiver: receiverId, sender: senderId });
```
Slightly slower (one extra round-trip from the HTTP function back to Supabase), but keeps the schema migration smaller.

Pick A for atomicity and lower latency.

### Migration order when Phase 5 starts

1. Create Supabase tables: `private_messages`, `group_messages` (+ indexes, RLS).
2. Build the `bump_unread_on_msg` trigger and parity-test it against current RTDB behaviour.
3. **Don't touch `notifyNewMessage` yet.** Add a *new* Cloud Function `notifyNewMessageHttp` (HTTPS) running side-by-side with the RTDB-triggered one. Wire Supabase webhook to it.
4. **Dual-write window** (~1 release): client writes message to BOTH RTDB and Supabase. Both notification paths fire — dedupe by message id at the FCM-send step (track a small in-memory recent-id set per function instance, or a Supabase row).
5. Verify in production for 1–2 weeks: pushes still landing, unread counts still correct, no double-notifications, no missing notifications.
6. Cut over: client stops writing RTDB messages.
7. Delete the old RTDB-triggered `notifyNewMessage`. Rename `notifyNewMessageHttp` → `notifyNewMessage`. Same for groups.
8. Decommission the `mirrorChatMetaToSupabase` CF only AFTER confirming the Postgres trigger fully covers what the mirror used to do (lastMessage / timestamp / unreadCount writes triggered by message inserts; mute toggle and blocked-user reset paths still need their own handling — see step 9).
9. Migrate the remaining RTDB writers to `chat_meta_data`: mute toggle in InboxScreen.jsx and blocked-user `unreadCount: 0` reset. These need direct Supabase UPDATEs (or RPCs) once the mirror CF is gone.

### Why we can't shortcut this

- Don't preemptively change the trigger now — it would silence notifications immediately.
- Don't dual-write from the *client* to mirror messages into Supabase before Phase 5 schema exists. There's nowhere to write to.
- Don't put the FCM-send logic in an Edge Function (Deno) — keep it in the existing Firebase function so Firebase Admin SDK + RTDB reads stay native. The Edge Function rewrite that #2 in the future-work list mentions is *not necessary* — the HTTP-trigger approach is simpler and reuses 100% of the existing FCM code.
