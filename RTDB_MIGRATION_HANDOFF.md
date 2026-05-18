# RTDB Cost-Reduction Update — Handoff

Last touched: 2026-05-18 (clean-cut completed: RTDB chat write rules locked so old-app users get a hard send error in both private and group; `chat_meta_data` writes also locked; verified the planned "bridge" Cloud Functions were never deployed so the originally planned teardown is a no-op; deprecation-notice scheduled CF text rewritten + auto-stop guard added).

---

## 2026-05-18 — clean-cut completed

### RTDB rules locked (forces old-app users to update)
The following RTDB rule changes have been applied in Firebase Console:

| Path | `.write` | Why |
|---|---|---|
| `group_messages` | `false` (top-level) | Blocks old-app group sends. Old app errors with PERMISSION_DENIED → user sees send fail. New-app group send is on Supabase, unaffected. |
| `private_messages/$chatId/messages` | `false` (granular) | Blocks old-app private message body writes. Old app errors → user sees send fail. New-app private send is on Supabase, unaffected. |
| `private_messages/$chatId/unread` | `true` | Kept open — new app's [Code/ChatScreen/utils.js:310](Code/ChatScreen/utils.js#L310) unread zero-out still needs to write here. |
| `private_messages/$chatId/lastRead` | `true` | Kept open — new app's read-receipt blue-tick at [Code/ChatScreen/utils.js:997](Code/ChatScreen/utils.js#L997) (write) + [Code/ChatScreen/utils.js:1018](Code/ChatScreen/utils.js#L1018) (listener) still needs this. New↔New read receipts still work. |
| `chat_meta_data` | `false` | Blocks old-app inbox-row updates so old sends produce zero side effects (no ghost push to new-app users via `notifyNewMessageLegacy`). New-app client code does NOT write to RTDB `chat_meta_data` directly (writes go through Supabase RPC `send_private_chat_meta`), so this is safe. Audit-confirmed 2026-05-18: only AdminDashboard delete + BottomDrawer account-delete still touch RTDB `chat_meta_data`; both already dual-write to Supabase. |
| `group_meta_data` | `true` (kept open) | New-app [Code/ChatScreen/utils/groupUtils.js](Code/ChatScreen/utils/groupUtils.js) still writes here directly for group create / join / member edits / mute / accept-invite. Per-user-per-group state has NOT been migrated to Supabase yet; locking this would break group create/join. |
| `private_chat_new`, `private_chat` | `false` | No client code writes these in either old or new app (audited 2026-05-18). Locked for hygiene. |

**Cost of the kept-open `chat_meta_data` rule reversion:** there was a brief window when `chat_meta_data` was first locked and immediately reverted because group create/join were broken. Resolution was to lock `chat_meta_data` (which new app doesn't write to anyway) and keep `group_meta_data` open (which new app DOES write to). See "What still needs a follow-up migration" below.

### Resulting cross-version chat matrix

| Direction | Private | Group |
|---|---|---|
| Old → Old | ✅ works (both RTDB) | ❌ PERMISSION_DENIED (rule) |
| Old → New | ❌ PERMISSION_DENIED (rule) — visible error | ❌ PERMISSION_DENIED — visible error |
| New → Old | ❌ silently invisible (no Supabase→RTDB bridge) | ❌ silently invisible |
| New → New | ✅ Supabase | ✅ Supabase |

Old-app users will see send errors on private + group, prompting them to update. They retain RTDB-only chat with other old users in private, but cannot send in groups at all.

### "Bridge" Cloud Functions were never deployed
`CHAT_BRIDGE_2DAY.md` documents 3 mirror functions that were supposedly deployed 2026-05-16 — but `firebase functions:list --project adoptme-7b50c` on 2026-05-18 shows **none of them exist** in the project:

- ❌ `mirrorPrivateMessageToSupabase` (RTDB→Supabase private msg bridge)
- ❌ `mirrorPrivateMessageToRtdb` (Supabase→RTDB private msg bridge)
- ❌ `mirrorChatMetaToRtdb` (Supabase→RTDB chat_meta bridge)
- ❌ `mirrorChatMetaToSupabase` (RTDB→Supabase chat_meta — was supposed to be modified, but also not deployed)

The source files exist in [functions/mirrorPrivateMessageToSupabase.js](functions/mirrorPrivateMessageToSupabase.js), [functions/mirrorPrivateMessageToRtdb.js](functions/mirrorPrivateMessageToRtdb.js), [functions/mirrorChatMetaToRtdb.js](functions/mirrorChatMetaToRtdb.js), [functions/mirrorChatMetaToSupabase.js](functions/mirrorChatMetaToSupabase.js) but the deploy step on 2026-05-16 either failed silently or was never run. **The cross-version private bridge described in `CHAT_BRIDGE_2DAY.md` was therefore a no-op the entire window** — old-app users have been cut off from new-app users in private chat since Phase 5 went live, not just from today's rule lock. The rule lock just makes the failure explicit (PERMISSION_DENIED) instead of silent.

**Implication:** no teardown is needed for those 3 functions. There is nothing to delete.

### Cloud Functions to delete (now dead due to rule locks)

Both are RTDB ref.write triggers on paths that are now write-locked at the rule level. They can never fire again — pure dead weight:

```bash
firebase functions:delete notifyNewMessageLegacy notifyGroupMessageLegacy \
  --region us-central1 --project adoptme-7b50c --force
```

- `notifyNewMessageLegacy` — triggered on `chat_meta_data/.../unreadCount` writes. With `chat_meta_data` rule write:false, no client write can trigger it. (Admin SDK from CFs could, but no CF writes that path.)
- `notifyGroupMessageLegacy` — triggered on `group_meta_data/.../unread` writes. `group_meta_data` is still write:true so it COULD fire, but it would push for stale RTDB group state that nobody updates anymore. Functionally dead.

`cleanupOldPrivateChats` (scheduled CF) is also wind-down candidate — with `private_messages/$chatId/messages` write-locked, no new chats accumulate. The CF still works (Admin SDK bypasses rules) but operates on shrinking data. Leave it running for now to clean up the legacy backlog; delete later when RTDB private_messages tree is small enough.

### Deprecation push CF updated
[functions/sendUpdateNoticeMessage.js](functions/sendUpdateNoticeMessage.js) text rewritten to lead with the symptom users will actually see: "Can't send messages in group or private chat?" → that means you're on an older version → update. Added auto-stop guard so the function no-ops after 2026-05-19 00:00 Asia/Karachi (one cache-window past the rule-lock date). Function itself should be deleted manually in Firebase once you're satisfied old-app DAU has drained.

### What still needs a follow-up migration

The clean cut is functional, but these RTDB paths are still actively used by the **new** app and would block a future "delete the RTDB chat tree entirely" goal:

1. **`group_meta_data/$userId/$groupId/*`** — per-user-per-group state (unread count, lastRead, mute, member metadata). Written by `groupUtils.js` for create/join/edit/mute/accept-invite. Read by Inbox + GroupsScreen for unread badges. No Supabase equivalent table exists yet. Migrating requires adding a `group_meta_data` table to Supabase (similar shape to private `chat_meta_data` table) + porting all `groupUtils.js` writes + the InboxScreen reads.
2. **`private_messages/$chatId/lastRead/$userId`** — new app's read-receipt blue tick. Writer: [Code/ChatScreen/utils.js:997](Code/ChatScreen/utils.js#L997). Listener: [Code/ChatScreen/utils.js:1018](Code/ChatScreen/utils.js#L1018). Move to Supabase `chat_meta_data` table (add a `lastRead` column) or a separate `chat_read_receipts` table. Realtime via Supabase channel.
3. **`private_messages/$chatId/unread/$userId`** — unread zero-out at [Code/ChatScreen/utils.js:310](Code/ChatScreen/utils.js#L310). Should be on Supabase already (the `reset_unread` RPC exists in `chatMetaBackend`) — this RTDB write looks like a leftover. Confirm with grep and delete if dual-writing.

### Working-tree drift
Significant uncommitted changes remain in working tree (Phase 5 client + Phase 5 server + today's notice/auto-stop edit + many session-old read migrations). Commit before further work.

---

## 2026-05-15 — session changes

### Group M3 fully validated on device
User confirmed group chat send/receive **and** reactions working end-to-end. SQL 012 (`supabase/012_group_message_reactions.sql`) is therefore confirmed applied in Supabase. `toggle_group_reaction` RPC live. M3 task closed; remaining work is just committing the working tree.

### User backfill re-run (one-shot, 65 min)
[scripts/backfill-users-to-supabase.js](scripts/backfill-users-to-supabase.js) re-executed locally to pick up users that were created/edited between the prior backfill (2026-05-04, 125,887 users) and today.

Run command (key pulled from Firebase secrets):
```bash
KEY=$(firebase functions:secrets:access SUPABASE_SERVICE_ROLE_KEY | tail -1)
NODE_PATH=/Volumes/Sohail/AI_Projects/adoptme-jan7/functions/node_modules \
SUPABASE_URL=https://kvtbtzhtcaanhjblyick.supabase.co \
SUPABASE_SERVICE_ROLE_KEY="$KEY" \
node scripts/backfill-users-to-supabase.js
```

Final Supabase row counts (post-run):

| Table | Backfill processed | Supabase count | Delta from script |
|---|---|---|---|
| user_identity | 129,269 | 129,288 | +19 (mirror CF during run) |
| user_roles | 129,269 | 129,270 | +1 |
| user_cosmetics | 129,269 | 129,288 | +19 |
| user_roblox | 129,269 | 129,270 | +1 |
| user_notifications | 129,269 | 129,284 | +15 |
| user_settings | 129,269 | 129,270 | +1 |
| user_badges | 16,179 buffered | 16,188 | +9 |
| user_blocks | 8,457 buffered | 8,463 | +6 |

Deltas are users newly mirrored via the mirror CF during the run (new signups + `lastActivity` heartbeats). Coverage is now ~100% across the 8 split tables; the per-screen RTDB fallback paths added below will almost never fire.

**Run gotcha:** the script needs `firebase-admin` + `@supabase/supabase-js` resolvable. They live in `functions/node_modules`, not at the project root — so set `NODE_PATH=functions/node_modules` when running from the repo root, or `cd functions && node ../scripts/backfill-users-to-supabase.js`. If you forget, you get `Cannot find module 'firebase-admin'`.

**Output buffering gotcha:** don't pipe through `| tail -100`; pipes buffer the script's stdout until exit. Run unbuffered and tail the output file separately if you want to watch progress.

### Read-side Supabase migrations shipped
Goal: eliminate per-user RTDB reads on hot client paths now that backfill has full coverage. **Writes are unchanged** — RTDB stays the source of truth, mirror CF still propagates.

| File | Before (RTDB) | After |
|---|---|---|
| [Code/ChatScreen/GroupChat/OnlineUsersList.jsx](Code/ChatScreen/GroupChat/OnlineUsersList.jsx) `loadUserBatch` | 10 narrow `get()` calls **per user** | `getIdentityBatch` + `getRolesBatch` + `getCosmeticsBatch` + `getRobloxBatch` (one round-trip each, page-wide). Per-user RTDB reduced to 2 calls (`isPlaying`, `lastGameWinAt` — game state, not mirrored). |
| [Code/ChatScreen/GroupChat/OnlineUsersList.jsx](Code/ChatScreen/GroupChat/OnlineUsersList.jsx) `searchUsers` | Variant-permutation + 500-row broad-scan fallback on `users/displayName` orderByChild | Supabase `ILIKE` for names (case-insensitive native), 3 parallel `eq` queries for emails (`uid`/`email`/`decoded_email`), single `getIdentity` for IDs. Then `getRolesBatch + getCosmeticsBatch + getRobloxBatch` enrichment. |
| [Code/Helper/profileCache.js](Code/Helper/profileCache.js) `getOrFetchProfile` | 4 Supabase + **12 RTDB always** (9 mirrored-field fallbacks + game state + shop) | 4 Supabase + 3 RTDB (game state + shop only). RTDB fallback for mirrored fields now fires **only when the corresponding Supabase table returned null** (mirror lag / pre-backfill case). Common case: 9 fewer RTDB reads per cache miss. |
| [Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx](Code/ChatScreen/PrivateChat/PrivateChatHeader.jsx) `fetchUserData` | 7 RTDB reads + 3 conditional roblox reads | `getRoles` + `getCosmetics` + `getRoblox` + 2 RTDB (`lastGameWinAt`, `profileFrame`). Selective fallback per missing Supabase row. |
| [Code/ChatScreen/PrivateChat/BlockUserList.jsx](Code/ChatScreen/PrivateChat/BlockUserList.jsx) | 3 RTDB reads × N blocked users | One `getIdentityBatch` for the whole list. Also dropped the read of the dead `users/{uid}/profileFrame` path (always null per 004 field-mapping; frame is on shop subtree). |
| [Code/ChatScreen/GroupChat/GroupsScreen.jsx](Code/ChatScreen/GroupChat/GroupsScreen.jsx) (3 spots: per-group creator + 2 list-of-creators) | 1-2 RTDB reads per group | `getIdentity` for single creator; `getIdentityBatch` for list-of-creators. |
| [Code/ChatScreen/GroupChat/GroupChatScreen.jsx](Code/ChatScreen/GroupChat/GroupChatScreen.jsx) (pending-invite metadata fallback) | 2 RTDB reads per invited user | One `getIdentity` per invited user. |

[Code/ChatScreen/GroupChat/BottomDrawer.jsx](Code/ChatScreen/GroupChat/BottomDrawer.jsx) was **already** migrated (kill-switch `BOTTOM_DRAWER_CACHE_ENABLED = true` in prod). Untouched this session.

### New helpers in userBackend.js
[Code/Supabase/userBackend.js](Code/Supabase/userBackend.js) gained:
- `searchIdentityByName(term, limit = 50)` — Postgres `ILIKE` against `user_identity.display_name`. Case-insensitive by definition; replaces the RTDB variant-permutation dance.
- `searchIdentityByEmail(emailOrEncoded, limit = 10)` — 3 parallel exact-match queries against `uid` (legacy encoded-email keys), `email`, `decoded_email`. Normalizes between `foo@bar.com` and `foo(dot)bar(dot)com`.

### Side-effect: pre-existing isAdmin bug fixed
`OnlineUsersList.loadUserBatch` previously read `users/{uid}/isAdmin` (the **dead** RTDB path per [supabase/004_users_split_FIELD_MAPPING.md](supabase/004_users_split_FIELD_MAPPING.md)). The canonical path is `users/{uid}/admin` (renamed to `is_admin` in Supabase `user_roles`). After the swap, the admin badge in OnlineUsersList actually works.

### Defensive: FlatList duplicate-key dedup
Intermittent "Encountered two children with the same key" warnings in chat and groups screens. **Symptom**, not root cause — the underlying data state occasionally contains two items with the same id (race between realtime onInsert and pagination, channel resubscribe replay, Firestore cursor boundary overlap, etc.). Patched the last hop before each FlatList renders:

- [Code/ChatScreen/PrivateChat/PrivateMessageList.jsx](Code/ChatScreen/PrivateChat/PrivateMessageList.jsx) — `filteredMessages` dedups by `id`.
- [Code/ChatScreen/GroupChat/GroupMessageList.jsx](Code/ChatScreen/GroupChat/GroupMessageList.jsx) — `filteredMessages` dedups by `id` before sorting.
- [Code/ChatScreen/GroupChat/InboxScreen.jsx](Code/ChatScreen/GroupChat/InboxScreen.jsx) — `filteredChats` dedups by `chatId`.
- [Code/ChatScreen/GroupChat/GroupsScreen.jsx](Code/ChatScreen/GroupChat/GroupsScreen.jsx) — `filteredGroups` dedups by `groupId`; new `dedupedAllGroups` / `dedupedInvitations` / `dedupedJoinRequests` useMemos feed the other three FlatLists.

This silences the redbox regardless of which producer is emitting duplicates. The real fix is still owed (most likely the `getAllGroups` paginator boundary in `loadMoreGroups`, and the message-list realtime+pagination race window). Track that separately if it shows up again.

### Other fixes
- **CreateGroupModal init-effect race** ([Code/ChatScreen/GroupChat/CreateGroupModal.jsx:97-114](Code/ChatScreen/GroupChat/CreateGroupModal.jsx#L97-L114)) — modal opened with empty `selectedMemberIds` if the parent's `selectedUsers` memo hadn't propagated yet. Init effect now includes `selectedUsers` + `user?.id` in deps and only latches the "initialized" ref once it captured non-empty data, so a stale-empty first run re-tries when the prop populates.
- **ATT redbox** (`Tried to resolve a promise more than once`) — `react-native-tracking-transparency@0.1.2` has a known double-resolve bug when the system dialog is interrupted (app loses/regains focus while prompt is up). Added [App.js](App.js) module-level `ensureAttRequested()` helper: short-circuits on already-determined status, caches in-flight promise so concurrent callers share it. The native lib bug remains; this guards us against ever hitting the buggy path.
- **GroupsScreen popup menu dark-mode text** ([Code/ChatScreen/GroupChat/GroupsScreen.jsx:805-832](Code/ChatScreen/GroupChat/GroupsScreen.jsx#L805-L832)) — four menu items ("Group Info", "Mute Notifications", "Update Group Icon", "Edit") had no `color` prop, defaulting to black against the dark `#1e293b` menu background. Set to `c.text`.

### Pending / verify on device
1. **Commit working tree** — group M3 client changes + group reactions backend (`Code/Supabase/groupMessagesBackend.js`, `Code/Supabase/privateMessagesBackend.js`) + all of today's read migrations + bug fixes are uncommitted.
2. **Real-search smoke test on Search Database tab** — confirm typing partial names returns expected users (was failing before the backfill re-run because some users had no Supabase row).
3. **`lastActivity` heartbeat write** — biggest remaining cost lever; still on RTDB, fires per app launch per user, triggers mirror CF each time. Not addressed this session. See [Code/GlobelStats.js:482](Code/GlobelStats.js#L482). Options: debounce server-side, move to a Supabase RPC, or batch.

---

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
| 7 | Phase 5 — SQL 005–011 applied + HTTPS notify CFs deployed | ✅ 2026-05-13 — ⏳ Supabase Database Webhook config + validation + M3 client swap pending |

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

## Phase 5 plan: notification trigger swap (SUPERSEDED — see M1 section at end)

**This section described the original clean-cut migration (force-update, old apps go silent). Direction changed 2026-05-12 to a backward-compatible two-way bridge — old + new app versions coexist indefinitely. Notification functions DO NOT need to be rewritten as HTTPS endpoints under the new plan; they stay RTDB-triggered on `chat_meta_data.unreadCount` because new-app clients still bump that. Kept below for context.**


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

---

## Phase 5 (clean-cut, Blox_Fruit pattern — IMPLEMENTED 2026-05-12)

Direction changed mid-day on 2026-05-12 from the original two-way bridge plan (now reverted) to a full clean-cut Blox_Fruit-style migration. Old app builds keep working on RTDB but will not see new-app messages or metadata after this ships. Accepted tradeoff per user direction — no min-version enforcement either.

### Architecture

```
OLD APP (RTDB only)                          NEW APP (Supabase only)
   │                                              │
   ▼                                              ▼
RTDB /private_messages                  Supabase private_messages    ◄── notifyNewMessage (HTTPS webhook on INSERT)
RTDB /group_messages                    Supabase group_messages      ◄── notifyGroupMessage (HTTPS webhook on INSERT)
RTDB /chat_meta_data    ───mirror───►   Supabase chat_meta_data
RTDB /group_meta_data   ───mirror───►   Supabase group_meta_data
                            (old-app writes only)
```

- Existing `mirrorChatMetaToSupabase` / `mirrorGroupMetaToSupabase` CFs stay deployed — they only matter now for old-app writes (RTDB → Supabase). New-app writes hit Supabase directly via RPC.
- `/activeChats`, `/activeGroupChats`, `/users/{uid}/fcmToken`, `/users/{uid}/notificationSettings` stay on RTDB. Notification CFs read them from there via Firebase Admin SDK.
- No bridge functions. No backward-compat between old and new app for messages or metadata. Old and new users effectively partition.

### Files added / changed

| File | Role |
|---|---|
| [supabase/005_private_messages.sql](supabase/005_private_messages.sql) | `private_messages` table + RLS + realtime publication. `rtdb_key` column for backfill idempotency. |
| [supabase/006_group_messages.sql](supabase/006_group_messages.sql) | `group_messages` table + `is_group_member()` SECURITY DEFINER helper + RLS. |
| [supabase/007_meta_writable.sql](supabase/007_meta_writable.sql) | Open INSERT/UPDATE/DELETE policies on `chat_meta_data` + `group_meta_data` for participants (Phase 2 was service-role only). |
| [supabase/008_meta_rpcs.sql](supabase/008_meta_rpcs.sql) | `increment_chat_unread` + `increment_group_unread` atomic helpers. |
| [supabase/009_send_private_chat_meta.sql](supabase/009_send_private_chat_meta.sql) | Atomic two-sided pair-write RPC for private chat meta. Preserves `muted`. |
| [supabase/010_send_group_message.sql](supabase/010_send_group_message.sql) | Idempotent group message insert RPC (bypasses RLS edge case on first-send). |
| [supabase/011_fanout_group_meta.sql](supabase/011_fanout_group_meta.sql) | Bulk fan-out RPC: upsert group_meta_data for every member + unread bump for non-senders. |
| [functions/notifyNewMessage.js](functions/notifyNewMessage.js) | **REWRITTEN** as HTTPS webhook on `private_messages` INSERT. Still reads `/activeChats`, fcmToken, muted from RTDB. |
| [functions/notifyGroupMessage.js](functions/notifyGroupMessage.js) | **REWRITTEN** as HTTPS webhook on `group_messages` INSERT. Reads Firestore memberIds + RTDB presence + tokens. |

### Deployment steps

| Step | State |
|---|---|
| 1. SQL files 005–011 applied in Supabase | ✅ done 2026-05-13 |
| 2. `SUPABASE_WEBHOOK_SECRET` set as Firebase secret | ✅ done 2026-05-12 (value at `.secrets/SUPABASE_WEBHOOK_SECRET.txt`, gitignored) |
| 3. Old RTDB-triggered notify CFs deleted + redeployed as HTTPS | ✅ done 2026-05-13 — both `notifyNewMessage` and `notifyGroupMessage` live as HTTPS triggers in `adoptme-7b50c`, region `us-central1` |
| 4. Supabase Database Webhooks (private_messages + group_messages) | ❌ **pending** — config values below |
| 5. Server-side validation (Tests 1–4) | ❌ pending (do after step 4) |
| 6. M3 client swap | ❌ pending (see below) |
| 7. App build + ship | ❌ pending |

**Step 3 gotcha — what bit us 2026-05-13:** the deploy of the rewritten functions silently kept the old `ref.write` trigger because the old functions weren't deleted first. Firebase won't change trigger type on the same function name — it just keeps the old trigger and the deploy reports success. **Always delete first when swapping trigger types:**
```bash
firebase functions:delete notifyNewMessage notifyGroupMessage --region us-central1 --force --project adoptme-7b50c
firebase deploy --only functions:notifyNewMessage,functions:notifyGroupMessage --project adoptme-7b50c
```

**Step 3 secondary gotcha:** if you run any deploy from this repo with a wrong default project, it can land in `fruiteblocks` (Blox_Fruit's Firebase project) instead. On 2026-05-13 this happened — two orphan functions got created in `fruiteblocks` and had to be deleted with `firebase functions:delete ... --project fruiteblocks --force`. Blox_Fruit's real notification functions (`notifyPrivateMessage`, `notifyGroupNewMessage`) were untouched because they have different names. **Always pass `--project adoptme-7b50c` explicitly** when deploying from this repo.

**Step 4 — Configure two Supabase Database Webhooks** (Dashboard → Database → Webhooks → Create):

Webhook 1 — new private messages
- Name: `notify_new_private_message`
- Table: `public.private_messages`
- Events: INSERT only
- Type: HTTP Request, Method POST
- URL: `https://us-central1-adoptme-7b50c.cloudfunctions.net/notifyNewMessage`
- Header: `x-webhook-secret = <value from .secrets/SUPABASE_WEBHOOK_SECRET.txt>`
- Timeout: 5000 ms

Webhook 2 — new group messages
- Name: `notify_new_group_message`
- Table: `public.group_messages`
- Events: INSERT only
- Type: HTTP Request, Method POST
- URL: `https://us-central1-adoptme-7b50c.cloudfunctions.net/notifyGroupMessage`
- Header: `x-webhook-secret = <same value>`
- Timeout: 10000 ms (group fan-out can read many fcmTokens)

### Validation (server-side, before client swap)

**Test 1 — Private notification round-trip:**
- From Supabase SQL editor, insert a row directly (use real Firebase UIDs):
  ```sql
  insert into private_messages (chat_id, sender_id, recipient_id, text)
  values ('uidA_uidB', 'uidA', 'uidB', 'webhook test');
  ```
- Within ~2 seconds confirm `notifyNewMessage` CF logs a successful invocation and an FCM push lands on the recipient device.

**Test 2 — Group notification round-trip:** same approach against `group_messages`, with a `group_id` matching a real Firestore group.

**Test 3 — Mute + active-chat suppression:** with the recipient inside the chat (setActiveChat triggered) or with muted=true in chat_meta_data, repeat Test 1 and confirm CF returns 200 "Skipped" without sending FCM.

**Test 4 — RPC sanity (sender flow):**
- From an authenticated client (or curl with a real Firebase ID token), invoke `send_private_chat_meta` RPC. Verify both sender + receiver rows appear with correct unread_count (0 for sender, 1 for receiver).
- Invoke `send_group_message` + `fanout_group_message_meta` with a real group. Verify all members' `group_meta_data` rows update.

### What this ship does NOT include

- **No backfill.** Historical RTDB messages do not get copied to Supabase — new app starts with empty `private_messages` / `group_messages` views. If user wants the last 30 days backfilled, that's an optional separate task (Blox_Fruit pattern, ~half day).
- **No client swap.** PrivateChat.jsx, GroupChatScreen.jsx, groupUtils.js still read/write RTDB today. M3 ships those changes in the next app build.
- **Existing mirror CFs (mirrorChatMetaToSupabase / mirrorGroupMetaToSupabase) stay deployed.** They handle old-app RTDB writes → Supabase mirror so new-app users at least see what old-app users do on the metadata side. Eventually retire when old-app DAU is negligible.

### Legacy notify CFs (deployed 2026-05-13 — keeps old-app push notifications working)

When the old `notifyNewMessage` / `notifyGroupMessage` RTDB triggers were deleted (to make room for the HTTPS replacements), **old-app users instantly lost all chat push notifications** — they still write to RTDB but nothing listened. Mirror CFs only copy metadata; they don't fire FCM.

Fix: re-deployed the pre-Phase-5 RTDB-triggered code under new names so it coexists with the HTTPS CFs.

| Function | Trigger | File | For |
|---|---|---|---|
| `notifyNewMessage` | HTTPS (Supabase webhook) | [functions/notifyNewMessage.js](functions/notifyNewMessage.js) | new app |
| `notifyNewMessageLegacy` | RTDB `/chat_meta_data/.../unreadCount` | [functions/notifyNewMessageLegacy.js](functions/notifyNewMessageLegacy.js) | old app |
| `notifyGroupMessage` | HTTPS (Supabase webhook) | [functions/notifyGroupMessage.js](functions/notifyGroupMessage.js) | new app |
| `notifyGroupMessageLegacy` | RTDB `/group_meta_data/.../unreadCount` | [functions/notifyGroupMessageLegacy.js](functions/notifyGroupMessageLegacy.js) | old app |

No duplicate FCM risk: each user is on exactly one app version, so they hit exactly one path. Old app only writes to RTDB → only legacy fires. New app only writes to Supabase → only HTTPS fires.

**Delete the legacy pair when old-app DAU is negligible** (~5% threshold suggested):
```bash
firebase functions:delete notifyNewMessageLegacy notifyGroupMessageLegacy --region us-central1 --force --project adoptme-7b50c
```

### Client work pending (M3 — separate task, before app ship)

| File | Change |
|---|---|
| `Code/ChatScreen/PrivateChat/PrivateChat.jsx` | Replace RTDB `/private_messages` read/write with Supabase realtime subscribe + `send_private_chat_meta` RPC. Stop writing `chat_meta_data` to RTDB. |
| `Code/ChatScreen/PrivateChat/PrivateMessageList.jsx` | Switch pagination from RTDB orderByKey to Supabase `(chat_id, created_at, id)` cursor. |
| `Code/ChatScreen/GroupChat/GroupChatScreen.jsx` | Same swap for group messages. |
| `Code/ChatScreen/utils/groupUtils.js` | `sendGroupMessage` becomes: `send_group_message` RPC + `fanout_group_message_meta` RPC; remove RTDB multi-path update. |
| `Code/ChatScreen/ReportPopUp.jsx` | Update private/group report path to call Supabase UPDATE (set deleted=true OR bump report_count) instead of RTDB. |
| `Code/Supabase/privateMessagesBackend.js` (new) | Realtime subscribe + send helpers. Copy from Blox_Fruit. |
| `Code/Supabase/groupMessagesBackend.js` (new) | Same for group. |

---

## Session 2026-05-13 (cont'd) — audit + private-chat M3 partial + cleanup

### M3 state after this session

| Chat type | Client swap | Status |
|---|---|---|
| Private | `PrivateChat.jsx` | ✅ Swapped — **MODIFIED in working tree, NOT COMMITTED**. Uses `Code/Supabase/privateMessagesBackend.js` (untracked, ready). Reads + writes go to Supabase. |
| Group | `GroupChatScreen.jsx`, `groupUtils.sendGroupMessage` | ✅ Swapped 2026-05-14 — **MODIFIED in working tree, NOT COMMITTED**. Reactions handled via SQL 012 + `toggleGroupReaction`. |

Working tree at end of session:
```
M Code/ChatScreen/GroupChat/GroupChatScreen.jsx
M Code/ChatScreen/PrivateChat/PrivateChat.jsx
M Code/ChatScreen/utils/groupUtils.js
M Code/Supabase/groupMessagesBackend.js
M RTDB_MIGRATION_HANDOFF.md
?? Code/Supabase/groupMessagesBackend.js  (initial create from previous session was untracked)
?? Code/Supabase/privateMessagesBackend.js
?? supabase/012_group_message_reactions.sql
```

### Reactions resolution 2026-05-14 — Option A taken

Decision: jsonb column on `group_messages` + atomic toggle RPC (not a separate table). Rationale:
- Group chat is group-scoped, not global → no Realtime-fanout problem that forced public chat to a separate `message_reactions` table.
- Reactions ride along the existing UPDATE realtime broadcast on `group_messages`, so cross-user reactions sync for free without a second subscription.
- Shape `{[userId]: emoji}` matches the RTDB layout exactly — UI renderer (`GroupMessageList` / `MessageActionDrawer`) unchanged.

Files added / changed for reactions:
- [supabase/012_group_message_reactions.sql](supabase/012_group_message_reactions.sql) — `ALTER TABLE ... ADD COLUMN reactions jsonb default '{}'` + `toggle_group_reaction(message_id, emoji)` SECURITY DEFINER RPC. Inline membership check (same trust model as `send_group_message`). Tap-same-emoji = clear (matches prior RTDB semantics).
- [Code/Supabase/groupMessagesBackend.js](Code/Supabase/groupMessagesBackend.js) — `fromGroupMessageRow` now maps `reactions` field; new `toggleGroupReaction(messageId, emoji)` helper.
- [Code/ChatScreen/GroupChat/GroupChatScreen.jsx](Code/ChatScreen/GroupChat/GroupChatScreen.jsx) `handleReaction` — optimistic-applies tap-same-removes locally, then calls Supabase RPC; realtime UPDATE delivers cross-user state.

### Group M3 swap details 2026-05-14

Files modified (all working-tree, uncommitted):
- [Code/ChatScreen/GroupChat/GroupChatScreen.jsx](Code/ChatScreen/GroupChat/GroupChatScreen.jsx) — pagination (`loadGroupMessages`), realtime (`subscribeToGroupMessages`), soft-delete single + by-sender (admin mod actions), reactions, removed the RTDB `group_meta_data` write on chat-open (Supabase-only — `resetGroupUnreadCount` covers it). Optimistic-insert on send removed; realtime feeds own messages back (same pattern as PrivateChat).
- [Code/ChatScreen/utils/groupUtils.js](Code/ChatScreen/utils/groupUtils.js) — `sendGroupMessage` rewritten: Firestore member list fetch retained, but message body now goes through the Supabase `send_group_message` RPC and meta fan-out through `fanout_group_message_meta` RPC. Return shape `{success, messageKey, timestamp, message}` is back-compatible with the existing call site in GroupChatScreen. Also: the three whole-group RTDB removes in `leaveGroup` (×2) and `deleteGroup` (×1) now ALSO call `softDeleteAllInGroup` against Supabase so deletes don't leave orphan rows there. RTDB removes stay because old-app writes still land in RTDB.
- [Code/Supabase/groupMessagesBackend.js](Code/Supabase/groupMessagesBackend.js) — reactions mapper + `toggleGroupReaction` helper (see above).

Files NOT changed (still RTDB or N/A):
- `Code/ChatScreen/ReportPopUp.jsx` — group chat reporting is **not currently wired** (`GroupMessageList` passes `onReport` to `MessageActionDrawer` but `GroupChatScreen.jsx` doesn't pass anything for it). Skipped this file. If group reports get wired later, follow PrivateChat's pattern: pass `reportGroupMessage` from `groupMessagesBackend.js`.

### ⏳ STILL PENDING before app ship (group M3)

1. **Apply SQL 012 in Supabase** — `supabase/012_group_message_reactions.sql`. Single migration: `ALTER TABLE` is fast, RPC create is instant. Default `'{}'::jsonb` backfills existing rows. SQL editor rollback rule applies (whole migration aborts on any error) — file only has 2 statements + 1 grant, low risk.
2. **Smoke-test toggle_group_reaction** from SQL editor or the app once 012 is live:
   ```sql
   select * from public.toggle_group_reaction('<some-message-uuid>'::uuid, '👍');
   select * from public.toggle_group_reaction('<some-message-uuid>'::uuid, '👍');  -- should clear (existing == new)
   ```
3. **Smoke-test send + fan-out RPCs from the app** — send a group message from a new build; confirm `group_messages` row appears, `group_meta_data` rows for all members get the `last_message` / unread bump, and `notifyGroupMessage` webhook fires (push lands on other members).
4. **Confirm Supabase realtime fires UPDATE on reactions** — toggle a reaction on one device, verify another member's device receives the row UPDATE event. If it doesn't, check `alter table group_messages replica identity full` is set (it is, in 006_group_messages.sql).
5. Once validated end-to-end: commit the working-tree changes + ship the build.

### Cross-version cost note after group ship

Old-app users still write RTDB `group_messages` and `group_meta_data`. Mirror CF (`mirrorGroupMetaToSupabase`) still copies their meta into Supabase so new-app users see at least the old-app inbox previews. There is no reverse mirror, so:
- Old → New: notification ✅, inbox preview ✅ (via meta mirror), message body ❌ (only in RTDB).
- New → Old: notification ✅ (FCM tokens still on RTDB), inbox preview ❌, message body ❌.

This is the same split-brain reality already documented for private chat. The option-B reverse mirror reconsideration applies equally to groups.

### Cross-version chat behavior — confirmed from code audit

Code audit (all 39 deployed CFs in `adoptme-7b50c` reviewed) confirms **no Supabase → RTDB bridge exists**. Mirrors are all one-way (RTDB → Supabase). So after both PrivateChat.jsx + GroupChatScreen.jsx M3 ship:

| Test scenario | Notification | Message body | Inbox preview |
|---|---|---|---|
| Old app → New app | ✅ delivers | ❌ missing | ✅ updates (via existing mirror CF) |
| New app → Old app | ✅ delivers | ❌ missing | ❌ stays stale |

Notification CFs (`notifyNewMessage` HTTPS, `notifyGroupMessage` HTTPS) read FCM tokens from RTDB `/users/{uid}/fcmToken` — that's why pushes still reach old-app users when a new-app user sends. But the message body is never written to the old app's RTDB read path, and Supabase chat_meta_data never gets reverse-mirrored to RTDB, so the old-app user sees the push banner but nothing in-app when they tap it.

### User position on force-update (2026-05-13)

User explicitly rejected min-version / force-update — "min version means I launch a version and all users shift to that, not going to happen soon." So cross-version pairs will be in the split-brain state above for an **extended** period after ship (weeks to months while app-store auto-updates trickle).

Options discussed, no decision yet:
- **A. Staged Play Store rollout** + accept short-term breakage. Cheapest, no code changes.
- **B. One-way Supabase → RTDB bridge** for chat_meta + message bodies (build the reverse mirrors the user explicitly didn't want to build on 2026-05-12). Keeps ~70% of bandwidth savings (reads still go to Supabase) and restores cross-version chat. User has previously built + reverted this — reconsider given the no-force-update reality.
- **C. Kill chat in old app via remote-config flag** — only viable if shipped old-app code already reads a config flag for chat. Need to check `Code/` for such a hook.

Next agent: surface this trade-off again before app ship.

### Cloud Functions cleanup performed in this session

Deleted from `adoptme-7b50c`:
- `refreshModProfiles` — stale; replaced by `refreshAllRosters` in [functions/syncRosterMaintenance.js](functions/syncRosterMaintenance.js)
- `manualUpdateGameLeaderboard` — orphan (GCS source already missing, 404 on download attempt)
- `updateGameLeaderboardCache` — orphan (same — required `gcloud functions delete` after `firebase functions:delete` got stuck on scheduler 404)

**Pending: re-deploy `seedModRoster`** from current local [functions/syncModRoster.js](functions/syncModRoster.js). Deployed source is the pre-refactor version. Low urgency (one-time seed, mods roster already populated, runs as no-op on schedule):
```bash
firebase deploy --only functions:seedModRoster --project adoptme-7b50c
```

After downloading all 39 deployed function sources via `gcloud functions ... :generateDownloadUrl` and diffing them against local: **32 byte-identical to local, 1 differs by trailing newline only, 4 shared via multi-export source files, 2 are the stale ones above**. Local `functions/` is the authoritative source.

`functions/syncBadgeRoster.js` (exports `syncRoleTrusted` + `syncRoleCMSR`) is **local-only — neither function is deployed**. User says "pending — will deploy later". Don't delete.

### Tooling state

- `gcloud` CLI installed this session (`brew install --cask google-cloud-sdk`, v567.0.0)
- Authed as `sohailnasir74business@gmail.com`, default project `adoptme-7b50c`
- Useful for: downloading deployed CF source (Firebase CLI doesn't support this), force-deleting functions when `firebase functions:delete` gets stuck on Cloud Scheduler 404
- Download trick: `curl -sX POST -H "Authorization: Bearer $(gcloud auth print-access-token)" 'https://cloudfunctions.googleapis.com/v2/projects/<PROJ>/locations/us-central1/functions/<FN>:generateDownloadUrl' -d '{}'` → returns signed GCS URL → `curl -L` to download the zip. v2 endpoint works for both v1 and v2 deployed functions. **Single-quote the URL** — the colon trips up zsh/bash unquoted.
