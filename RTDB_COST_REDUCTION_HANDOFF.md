# RTDB Cost Reduction — Handoff

Last updated: 2026-05-24. Previous worker: Claude (this chat).

## Why this work exists

After the chat-to-Supabase migration (see [RTDB_MIGRATION_HANDOFF.md](RTDB_MIGRATION_HANDOFF.md)) the RTDB bill was still high. A 7.3-minute `firebase database:profile` against `adoptme-7b50c` captured **~950 MB/day** of download bandwidth and **~31M ops/day**. The goal of this round was to drive that number down without breaking functionality and without big refactors.

Final expected reduction after deploy + Bunny settings: **~50% (≈400-500 MB/day saved)**.

## Source data — bandwidth report (7.3 min sample)

Sorted by total bytes. Use this to prioritise any follow-up work.

| Path | Bytes/7min | Reads | Avg per read |
|---|---|---|---|
| `/users/$uid/$uid/activeItems` | 1.51 MB | 15,517 | 97 B |
| `/analytics` | 904 KB | 5 | 180 KB |
| `/users/$uid` (whole record) | 601 KB | 315 | 1.91 KB |
| `/users/$uid/$uid` (mixed fields) | 587 KB | 45,419 | 12 B |
| `/image_url` | 295 KB | 12,846 | 23 B |
| `/users` (root scan) | 288 KB | 10 | 28.88 KB |
| `/server` | 93 KB | 231 | 403 B |
| `/private_messages/$uid/trade` | 89 KB | 313 | 283 B |
| `/banned_users_by_email/$uid` | 85 KB | 6,839 | 12 B |
| `/like_counter` | 46 KB | 23 | 2 KB |
| `/private_messages/$uid/lastRead/$uid` | 28 KB | 759 | 36 B |

To re-run: `firebase database:profile --project adoptme-7b50c` interactively, then press Enter after a few minutes. The `-d <ms>` non-interactive mode is buggy and won't write output to file — capture by piping or pasting console output.

## Code changes shipped this round

All in one branch. Verify with `git status` — expect 10 modified + 1 new file (`supabase/016_user_cosmetics_active.sql`).

| # | Change | File:Line | Why |
|---|---|---|---|
| 1 | Removed `/banned_devices/{fp}` listener inside `useBanStatus` | [Code/ChatScreen/utils.js:829](Code/ChatScreen/utils.js#L829) | Was 100% denied (no rule in PRESENCE_RULES.json). Listener always returned `false` so removing it is behaviour-neutral. `isAssociatedBan` has no callers. |
| 2 | Skip `/image_url` fetch when `ls.imgurl` is already in MMKV | [Code/GlobelStats.js:566](Code/GlobelStats.js#L566) | Was being re-fetched every 3 min inside `fetchStockData` even though it never changes. |
| 3 | Removed RTDB `unread` set from `setActiveChat` | [Code/ChatScreen/utils.js:298](Code/ChatScreen/utils.js#L298) | Both PrivateChat and GroupChat already call `resetUnreadCount` / `resetGroupUnreadCount` on Supabase. The RTDB write was a dual-write. |
| 4 | `OnlineUsersList`: only fetch `isPlaying` in `gameInvite` mode; `lastGameWinAt` from profileCache | [Code/ChatScreen/GroupChat/OnlineUsersList.jsx:146](Code/ChatScreen/GroupChat/OnlineUsersList.jsx#L146) | Was 2 RTDB reads per online user per modal open. `isPlaying` is only displayed in gameInvite UI. Cold-cache trophy badge degrades gracefully. |
| 5 | `PrivateChatHeader`: `lastGameWinAt` + `profileFrame` from profileCache instead of RTDB | [Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx](Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx) | Same pattern — 2 RTDB reads per chat open eliminated. |
| 6 | `BottomDrawer`: `lastGameWinAt` from profileCache | [Code/ChatScreen/GroupChat/BottomDrawer.jsx:388](Code/ChatScreen/GroupChat/BottomDrawer.jsx#L388) | 1 RTDB read per drawer open eliminated. |
| 7 | **NEW** SQL migration: add 5 jsonb columns to `user_cosmetics` for active shop items | [supabase/016_user_cosmetics_active.sql](supabase/016_user_cosmetics_active.sql) | Lets cosmetic frame/bubble/text-color etc. be read from Supabase instead of `/users/{uid}/shop/activeItems` on RTDB. |
| 8 | Mirror CF: extended `mirrorCosmetics` to fan out `shop/activeItems` → new columns | [functions/mirrorUsersToSupabase.js:159-193](functions/mirrorUsersToSupabase.js#L159) | Trigger is `/users/{uid}` onWrite so the after-snapshot already contains `shop.activeItems`. New `activeItemsChanged()` guard prevents redundant upserts. |
| 9 | `fromCosmeticsRow` exposes the 5 new fields | [Code/Supabase/userBackend.js:209](Code/Supabase/userBackend.js#L209) | Mapper for the Supabase client. |
| 10 | profileCache builds `shopItems` from `cosmeticsRow` instead of fetching RTDB shop | [Code/Helper/profileCache.js:88-122](Code/Helper/profileCache.js#L88) | Eliminates 1 RTDB read per profile cache miss. The downstream `expiresAt` filter is unchanged so cosmetic timeouts still work. |
| 11 | BadgesScreen: full `/users/{uid}` fetch → `getIdentity()` + `getBadges()` | [Code/SettingScreen/BadgesScreen.js:296](Code/SettingScreen/BadgesScreen.js#L296) | `computeBadges` only needs `createdAt` from the user record; was downloading ~1.9 KB to use 8 bytes. Both pieces are in Supabase already. |
| 12 | HDwallpaper: `/like_counter` and `/pic_numbers` `onValue` → one-time `get` | [Code/ValuesScreen/HDwallpaper.js:48,73](Code/ValuesScreen/HDwallpaper.js#L48) | The `like_counter` listener re-broadcast the entire node every time anyone liked anything anywhere. `pic_numbers` is admin-only updates. Own likes still update via local `setItems`. |

### Behaviour trade-offs introduced

Worth knowing before someone hunts a "bug":
- **Device-ban listener removed.** Email ban still enforced. Device-only bans (banned user re-signs up with new email on same device) are no longer detected client-side — but the rule was missing so this never worked anyway. Server-side enforcement on writes is the path forward if needed.
- **Cold profileCache** for an OTHER user → no trophy badge, no profile frame, no chat bubble bg, no custom text color, no tradeCardBg, no banner. Resolves on next profile fetch (chat scroll, drawer open, etc.) and persists in MMKV for 30 min.
- **HDwallpaper:** other users' like counts only refresh on screen open, not live.

## Deploy steps — required to realise the savings

**Order matters.** Each step depends on the previous one being live.

```bash
# 1. SQL migration — must be FIRST. Otherwise the CF upsert in step 2 fails on missing columns.
#    Apply via Supabase dashboard SQL editor, or psql with the project connection string.
psql "$SUPABASE_DB_URL" < supabase/016_user_cosmetics_active.sql

# 2. Deploy mirror CF — starts populating the new columns from RTDB writes.
firebase deploy --only functions:mirrorUsersToSupabase --project adoptme-7b50c

# 3. Backfill (OPTIONAL but recommended) — see "Outstanding work" section below.

# 4. Ship the client build. iOS + Android via existing release pipeline.
#    profileCache will start reading from Supabase; users with no mirrored
#    cosmetics yet see defaults until a write fires (or backfill runs).
```

## Bunny CDN — settings change (not a code change)

The `/analytics` 178 MB/day RTDB cost was misdiagnosed as a code issue. It's actually the Bunny pull-zone for `analytics.b-cdn.net` pulling from RTDB on cache miss. Origin URL is `https://adoptme-7b50c-default-rtdb.firebaseio.com/analytics.json`.

In Bunny dashboard for the **analytics** pull zone:

1. **Caching → Origin shield → Enable**, pick the region closest to `us-central1` (likely Washington, DC or LA). Biggest single win — cuts multi-PoP origin pulls by 10-50x.
2. **Caching → Request coalescing → Enable**. Prevents thundering herd on cold cache (especially right after each 12h CF run).
3. **Caching → Browser cache expiration time → Override: 1 hour** (currently "do not cache"). Doesn't cut RTDB but reduces Bunny request count and overall traffic.

Leave alone:
- Cache expiration time: 12 hours (matches CF schedule, perfect)
- Query string sort: ON
- Smart Cache: OFF (override is set, doesn't matter)

Expected: RTDB pulls drop from ~700/day to ~2-10/day → **178 MB/day → ~2 MB/day**.

The [functions/README.md](functions/README.md#L283) section on `aggregateTradeAnalytics` documents a "manual copy to Bunny" workflow that is **obsolete** — Bunny pulls automatically via the pull zone. Worth cleaning up that section when convenient.

## Outstanding work (in priority order)

### 1. Backfill script for `user_cosmetics` active items

The mirror CF only fires on new `/users/{uid}` writes. Existing users won't have their `profile_frame` / `chat_bubble_bg` / etc. populated in Supabase until they (or someone else) triggers a write. Until then, OTHER users won't see their cosmetics in chat.

A one-off backfill script — pattern lives in [scripts/backfill-users-to-supabase.js](scripts/backfill-users-to-supabase.js). Walk all `/users/{uid}/shop/activeItems` nodes, build cosmetics rows, upsert in batches. Should be ~50 lines.

Without backfill, the migration self-heals over time but the first few weeks see degraded cosmetics for inactive users.

### 2. lastRead / read receipts migration

`/private_messages/$chatKey/lastRead/$userId` is still on RTDB ([Code/ChatScreen/utils.js:946-987](Code/ChatScreen/utils.js#L946)). Listener + writer for blue-tick read receipts. Per profile: ~759 reads / 7 min, ~28 KB → ~5 MB/day. Small bandwidth but every chat session uses it.

Needed:
- Add `last_read_ms` column(s) to `chat_meta_data` (one per side of the pair, or a separate table).
- SQL: pattern matches `last_read_at_ms` already present in `group_meta_data` (see [supabase/003_chat_metadata.sql:63](supabase/003_chat_metadata.sql#L63)).
- Supabase RPC for updating own lastRead.
- Realtime channel for the partner's lastRead (or piggyback on `chat_meta_data` realtime if the column is added there).
- Replace the RTDB calls in `updateLastRead` / `useOtherLastRead`.

### 3. `/group_meta_data` direct RTDB writes

[Code/ChatScreen/utils/groupUtils.js](Code/ChatScreen/utils/groupUtils.js) has ~55 references to `group_meta_data/{userId}/{groupId}/...` — create group, join, edit name, mute, etc. all do multi-path RTDB updates that fan out to every member. The mirror CF copies them to Supabase, so reads are already on Supabase. But the writes are expensive (scale with group size) and the mirror CF doubles the work.

Needed:
- Supabase RPCs for each group operation (createGroupMeta, joinGroupMeta, updateGroupName, updateGroupDescription, updateGroupAvatar, removeGroupMember, etc.).
- Pattern: see [supabase/011_fanout_group_meta.sql](supabase/011_fanout_group_meta.sql) which already does this for messages.
- Then phase out RTDB writes from groupUtils.js once old-app readers have died off (see Supabase mirror CF for the deprecation gating model).

Significant work, deferred because old-app users still read these RTDB nodes directly.

### 4. `/users/{uid}/lastActivity` heartbeat

Per the original [RTDB_MIGRATION_HANDOFF.md](RTDB_MIGRATION_HANDOFF.md), this is "the biggest remaining cost lever, not addressed this session." Writes to `/users/{uid}/lastActivity` every 6 hours per user from [Code/GlobelStats.js:504](Code/GlobelStats.js#L504). Each write fires `mirrorUsersToSupabase` even though no mirrored field changed — wasteful CF invocations.

Options:
- Move heartbeat to Supabase directly (RPC that updates `user_identity.last_activity_ms`).
- Add a fast-path early-return in mirrorUsersToSupabase when only `lastActivity` changed.
- Skip CF entirely for these writes via a separate dedicated path.

### 5. Per-field badge checks in `badgeUtils.js`

[Code/ChatScreen/GroupChat/badgeUtils.js](Code/ChatScreen/GroupChat/badgeUtils.js) lines 577, 585, 609, 662, 681 each do `get(ref(badges/$type))` before awarding. Low bandwidth (12 B per read) but many ops. Could be replaced with Supabase `INSERT ... ON CONFLICT DO NOTHING` against `user_badges`.

### 6. iOS image-rendering crash (low priority)

`facebook::react::ImageResponseObserverCoordinator::nativeImageResponseProgress` EXC_BAD_ACCESS — 36 events / 1 user (`game_slayer165`) on iOS 26.4.2 beta. Triggered by App Open Ad lifecycle (see Crashlytics breadcrumbs at 05:24:17 GADFullScreenAdViewController → crash at 05:24:28). RN 0.83.4 new-arch race condition that's likely fixed in a later RN release. Wait/watch; revisit if it spreads to more users or stays after RN bump.

### 7. Cleanup tasks

- [functions/README.md:283-336](functions/README.md#L283) documents the obsolete "manual copy to Bunny" workflow for analytics. Replace with a note that Bunny pulls automatically from the pull zone.
- Admin `/users` root scans in [Code/AppHelper/AdminDashboard.js:529,567,599,1087](Code/AppHelper/AdminDashboard.js#L529) and [Code/AppHelper/SocialDashboard.js](Code/AppHelper/SocialDashboard.js) could be replaced with Supabase `searchIdentityByName` / `searchIdentityByEmail` (already exported from [Code/Supabase/userBackend.js](Code/Supabase/userBackend.js)). User said only 4 mods so low priority, but it's the right shape of fix and would also cut ~57 MB/day in the rare case admin searches spike.

## How to verify the savings

After SQL + CF deploy + client ship + Bunny settings:

1. Wait at least 24h (need enough traffic to populate cosmetics via natural writes, or run backfill).
2. Run `firebase database:profile --project adoptme-7b50c` interactively for ~10 min during a busy period.
3. Check the Bandwidth Report. Expect:
   - `/users/$uid/$uid/activeItems` to drop from 1.51 MB → near 0
   - `/image_url` to drop from 295 KB → near 0
   - `/analytics` related origin pulls (visible in Bunny dashboard, not this profile) to drop ~99%
   - `/like_counter`, `/pic_numbers` listener writes to drop
4. Cross-check Bunny dashboard for the analytics pull zone: cache hit % should rise above 95.52% after settings change.

If `/users/$uid/$uid/activeItems` is still high, the mirror CF likely isn't firing or the SQL migration didn't apply — check Supabase table for populated `profile_frame` rows: `select count(*) from user_cosmetics where profile_frame is not null`.

## What was investigated but not changed

For context, so a new agent doesn't waste time re-discovering:

- **`/users` root scans** (10 reads at 27.8 ms each in profile, total ~288 KB). Comes from admin/social search using `query(ref(db, 'users'), orderByChild('displayName'), limitToFirst(500))`. User confirmed only 4 mods, rare usage, low priority.
- **`/users/$uid` (whole record) reads** (315 / 7min). Sources: profileCache fallback (rare), BottomDrawer fallback (rare), admin tools (rare). BadgesScreen was the only non-admin/non-fallback caller — fixed.
- **`/users/$uid/$uid` (45,419 mixed field reads)** mostly came from `activeItems` (15,517) — fixed by Supabase migration. Remainder are scattered field reads (petParent, sparkle, onFire, etc.) from badge-check flows.
- **/api, /factor, /server, /single_offer_wall, /free_translation** — fetched once per provider mount (in `GlobelStats.js`). Combined ~1500 reads / 7 min but tiny payloads. Not worth caching client-side; cost was minor.

## Files modified this round

```
M  Code/ChatScreen/GroupChat/BottomDrawer.jsx
M  Code/ChatScreen/GroupChat/OnlineUsersList.jsx
M  Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx
M  Code/ChatScreen/utils.js
M  Code/GlobelStats.js
M  Code/Helper/profileCache.js
M  Code/SettingScreen/BadgesScreen.js
M  Code/Supabase/userBackend.js
M  Code/ValuesScreen/HDwallpaper.js
M  functions/mirrorUsersToSupabase.js
?? supabase/016_user_cosmetics_active.sql
```

Not yet committed. No tests run (project has no test suite for the touched code paths).
