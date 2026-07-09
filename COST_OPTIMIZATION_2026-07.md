# Cost Optimization Pass — 2026-07-09

Full-app audit (Supabase + Firebase) and fixes. App-code changes are done in
this repo; the sections marked **YOU APPLY** are deploy-side steps you run
from your deploy environment / consoles.

---

## 1. Supabase — app code (done, ships with next build)

| # | Change | Files | Why |
|---|---|---|---|
| S3 | `messages` fetches narrowed to `MSG_COLS`; gap-fill restructured: one 60-row page (was up to 5×200 wide rows), large gaps do a reset load instead of paging a backlog. The old paging loop could never fetch past page 1 anyway (cursor advanced to newest → later pages always empty). | `Code/Supabase/chatBackend.js`, `Code/ChatScreen/GroupChat/Trader.jsx` | Egress on the hottest table; every reconnect/refocus fired a wide 200-row query |
| S3 | `loadGroupMeta` narrowed to `GROUP_META_COLS` (was `select('*')` — missed the earlier chat_meta narrowing pass) | `Code/Supabase/groupMetaBackend.js` | Egress per session |
| S4 | `warmProfileCache` now uses the 4 batch queries for the whole uncached set (was 4 single-row queries × N users; 15 senders = 60 queries → 4) | `Code/Helper/profileCache.js` | Request count + DB compute |
| S5 | Pinned-messages channel focus-gated (torn down on tab blur; refetch on focus). Dead `subscribeToChatLastRead` removed. | `Trader.jsx`, `Code/Supabase/chatMetaBackend.js` | Peak realtime connections |
| — | Group mute now **dual-writes** Supabase `group_meta_data.muted` directly (+ keeps the RTDB leaf). Supabase is what `notifyGroupMessage` checks, so mute no longer depends on the mirror-CF round-trip. | `Code/Supabase/groupMetaBackend.js` (`setGroupMuted`), `GroupsScreen.jsx` | Correctness + enables mirror diet |

## 2. Supabase — SQL migrations (**YOU APPLY** in SQL editor, in order)

1. **`supabase/021_realtime_publication_cleanup.sql`**
   Drops all 8 `user_*` tables + `message_reactions` from the
   `supabase_realtime` publication and resets their replica identity to
   DEFAULT. **No client subscribes to any of them** — but every
   `mirrorUsersToSupabase` write (hottest path) was WAL-decoded FULL-row by
   the Realtime server for zero deliveries. Pure waste removal, zero
   functional impact. Verification query is at the bottom of the file.

2. **`supabase/022_fanout_single_write.sql`**
   `fanout_group_message_meta` now touches each member's row **once** per
   group message (preview fields + unread bump in a single upsert) instead
   of twice. Halves realtime deliveries to the always-on `group-meta`
   channels + halves WAL for the #2 realtime driver. Identical semantics
   (documented in-file), plus dedupes member ids (011 would have errored on
   duplicates).

## 3. Firebase — app code (done, ships with next build)

| # | Change | Files | Why |
|---|---|---|---|
| F1 | User search (Social + Admin dashboards) moved to Supabase `ilike` + batch lookups. Was: 4 RTDB variant queries × 50 FULL user objects + a **500-user (~1 MB) broad-scan fallback** per search; admin email search ran an **unindexed** full-`/users` scan. ID search now uses Supabase point reads (RTDB whole-node kept only as mirror-lag fallback). | `SocialDashboard.js`, `AdminDashboard.js` | #1 RTDB download driver in current code |
| F2 | Ban listeners consolidated: the 3 per-screen duplicates (Trader, GroupChatScreen, PrivateChat) now consume `strikeInfo` from GlobelStats context (the existing app-wide listener). Dead `useBanStatus` hook removed. Profiler showed 43k reads/20min from this family. | `Trader.jsx`, `GroupChatScreen.jsx`, `PrivateChat.jsx`, `ChatScreen/utils.js` | Read count |
| F3 | Whole-`users/{uid}` node reads → leaf/batch reads: game-invite list (was 1 whole node per online user), `awardGameWin` (whole node for one number), BottomDrawer badges fallback (whole record for the no-badges common case → badges leaf). | `gameInviteSystem.js`, `BottomDrawer.jsx` | Download bytes |
| F3 | Double get+onValue reads removed (onValue fires immediately): RewardCenter `prize` + `rewardPoints`, Setting star balance. | `RewardCenter.js`, `Setting.jsx` | Duplicate downloads |
| F3 | GroupsScreen mute map derived from the `groups` prop (Supabase-fed, `muted` now threaded through ChatNavigator) — was one RTDB read **per group** on every list change. | `GroupsScreen.jsx`, `ChatNavigator.js` | N+1 reads |

## 4. Cloud Functions (**YOU DEPLOY / DELETE**)

### 4a. Preflight — see what's actually deployed
```bash
firebase functions:list --project adoptme-7b50c
```
The 2026-05-18 audit found some bridge mirrors (mirrorPrivateMessageToSupabase,
mirrorPrivateMessageToRtdb, mirrorChatMetaToRtdb) were **never deployed** —
anything absent from this list needs no delete. Skip those lines below.

### 4b. Deploy (patched in this repo)
```bash
firebase deploy --only functions:mirrorUsersToSupabase --project adoptme-7b50c
```
`mirrorUsersToSupabase` absorbed the mods-roster sync (`mirrorModsRoster`
helper) — one invocation per `/users/{uid}` write instead of three.
(Reminder: always pass `--project adoptme-7b50c` — a past deploy without it
landed in the Blox Fruits project.)

### 4c. Delete — safe now (skip any not present in 4a's list)
```bash
# 1) URGENT — live leak: countdown ended mid-May, but this has been pushing
#    its "final" message into RTDB chat_new EVERY 3 MINUTES since (~480
#    junk messages/day, node growth + re-feeds every old-client listener).
# 2) sendUpdateNoticeMessage auto-expired 2026-05-19 but still no-op-invokes 288×/day.
firebase functions:delete sendDeprecationCountdown sendUpdateNoticeMessage \
  --region us-central1 --project adoptme-7b50c --force

# 3) syncModRoster absorbed into mirrorUsersToSupabase (deploy 4b FIRST, then delete).
# 4) syncModUsersToRTDB is dead weight: mirrors 5 hardcoded uids' whole user
#    nodes to RTDB /mod on every user write — NOTHING reads /mod (checked app + functions).
firebase functions:delete syncModRoster syncModUsersToRTDB \
  --region us-central1 --project adoptme-7b50c --force

# 5) Legacy notify pair (pre-Supabase push paths, superseded by
#    notifyNewMessage / notifyGroupMessage webhooks):
#    - notifyNewMessageLegacy is disabled in code but still bills an
#      invocation on every unreadCount write.
#    - notifyGroupMessageLegacy still has LIVE fan-out logic — if deployed
#      it double-pushes group messages.
firebase functions:delete notifyNewMessageLegacy notifyGroupMessageLegacy \
  --region us-central1 --project adoptme-7b50c --force

# 6) Bridge mirrors dead post-clean-cut (new app writes chat data to
#    Supabase directly; old-app sends are rule-locked). Per the 4a note,
#    mirrorPrivateMessageToSupabase may not exist; mirrorChatMetaToSupabase
#    WAS live (chat_id-derive patch deployed 2026-05-30) so it likely does.
firebase functions:delete mirrorPrivateMessageToSupabase mirrorChatMetaToSupabase \
  --region us-central1 --project adoptme-7b50c --force
```

### 4d. Delete — with one extra step (Supabase→RTDB mirrors, if deployed)
```bash
firebase functions:delete mirrorChatMetaToRtdb mirrorPrivateMessageToRtdb \
  --region us-central1 --project adoptme-7b50c --force
```
These fed new-app messages back to RTDB so OLD-app users could still read
them. Deleting them means old-version users stop seeing new private
messages entirely (they already can't send). Consistent with the clean-cut
policy you applied to sends.
**Also required:** in Supabase Dashboard → Database → Webhooks, delete the
webhooks pointing at these two function URLs, or they'll POST to dead
endpoints on every message and log failures forever. (Keep the webhooks for
`notifyNewMessage` / `notifyGroupMessage` — those are the live push paths.)

### 4e. KEEP — explicitly NOT deleted (differs from the original plan)
- **`mirrorGroupMetaToSupabase`** — NOT bridge-only. Group create, invite
  accept, and join approve still write `group_meta_data` to RTDB first
  (`groupUtils.js` multi-path updates); this mirror is what creates those
  rows in Supabase so the group appears in the inbox before its first
  message. Deleting it would break "new group shows in list". Mute no
  longer depends on it (dual-write above). Candidate for deletion only
  after group create/join flows write Supabase directly.
- `notifyNewMessage`, `notifyGroupMessage`, all cleanup_*/sync-role
  functions, `fetchWorldCupData*` — live and reasonably bounded.
- Optional review: `sendScheduledPromoMessageMM2` posts a promo into RTDB
  `chat_new` (the OLD chat tree only legacy clients see) every 20 min —
  delete if that promo no longer matters.

## 5. RTDB rules (**YOU APPLY** in Firebase console → Realtime Database → Rules)

`PRESENCE_RULES.json` in this repo is updated to match; apply the same two
diffs to production rules (the console is authoritative — this file is a
local snapshot):

1. **`/xlsData`: `.read: false, .write: false`** — the profiler's #1 path
   (73 MB / 20 min ≈ ~5 GB/day) is read only by OLD app versions; current
   app fetches values from Bunny CDN. Locking it cuts that download to
   zero. The `scheduledFunction` CF that writes it uses the Admin SDK and
   bypasses rules, so nothing server-side breaks; old-version users lose
   values data until they update (same policy as the chat clean-cut).
2. **`/users_server`: add `.indexOn: ["expiresAt"]`** (and confirm the prod
   read rule actually allows ServerScreen's `orderByChild('expiresAt')`
   query — the old snapshot claimed `.read: false`, which would have denied
   it entirely, so prod likely differs). Without the index the server
   filters the whole node per listener update.

## 6. Verify after applying

- Supabase → Reports → Realtime: messages/day and peak connections should
  drop within a day of the SQL + next app build (biggest chunks: 022 halves
  group-meta deliveries immediately, no build needed; 021 cuts decode load
  immediately).
- Supabase → Reports → Database egress: gap-fill + select narrowing show up
  after the build rolls out.
- Firebase console → RTDB usage: downloaded-bytes should step down
  immediately after the `/xlsData` rules lock (biggest single lever in this
  whole pass), again after the build (search + ban listeners + leaf reads).
- Cloud Functions invocations: `users/{uid}` trigger count −⅔ after 4a+4b;
  scheduled-function count −~550/day after the two deprecation deletes.
- Functional smoke test: send group message (unread badge + push still
  work), mute a group then have another member post (no push), open inbox
  fresh (groups appear), user search by name/symbol/ID in Social + Admin
  dashboards, open profile drawer of a user with no badges, RewardCenter +
  Settings balances, public chat reconnect after backgrounding.
