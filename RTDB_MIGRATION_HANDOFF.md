# RTDB Cost-Reduction Update — Handoff

Last touched: 2026-04-29. Hand this to the next agent so nothing gets re-done or accidentally undone.

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

Plan was 4 wins. **#1, #2, #3 done. #4 deployed, awaiting backfill + app ship.** `/users` migration was explicitly deferred to a future phase.

---

## Status

| # | Task | Status |
|---|---|---|
| 1 | Narrow `profileCache.js` fetches | ✅ code in |
| 2 | Add `.indexOn: ["completedAt"]` for `/tradeJournal/$uid` | ✅ rules file updated |
| 3 | Remove RTDB `/analytics` write | ❌ **deliberately skipped** — CDN sync pipeline depends on it; cost saved is small (~$8/mo) |
| 4 | Mirror `chat_meta_data` + `group_meta_data` to Supabase | ✅ schema applied, mirror CFs deployed, client swapped — ⏳ backfill + app ship pending |

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
| RTDB rules redeployed (`PRESENCE_RULES.json` w/ tradeJournal index) | ❌ pending |

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

5. **Don't migrate `/users` yet** — it's the next-biggest win but requires schema redesign (split `users` into profile / settings / cosmetics tables) + RLS work + `profileCache.js` rewrite. Estimated 5–7 days. Do it as its own phase. The narrow-fetch fix in #1 buys time.

6. **Don't migrate `/private_messages` yet** — has `notifyNewMessage` Cloud Function trigger; needs Edge Function rewrite. Phase 3.

7. **Don't dual-write from the client.** The mirror CF is the only writer to Supabase chat metadata. Adding a client-side optimistic upsert is tempting (would kill the ~1–2s lag for the user's own sends) but introduces race conditions with the CF.

---

## Useful context for the next agent

- **Supabase project ID:** `kvtbtzhtcaanhjblyick` (URL: `https://kvtbtzhtcaanhjblyick.supabase.co`)
- **Firebase project:** `adoptme-7b50c`
- **Phase 1 (public chat) is already on Supabase** — see [Code/Supabase/chatBackend.js](Code/Supabase/chatBackend.js) and [Code/ChatScreen/GroupChat/Trader.jsx](Code/ChatScreen/GroupChat/Trader.jsx). The phase 1 schema is in [supabase/schema.sql](supabase/schema.sql); phase 1 used a *clean-cut* approach (no dual-write). This phase (chat metadata) uses *RTDB-source-of-truth + CF mirror* because chat metadata has Cloud Function notification dependencies that public chat didn't.
- **Auth model:** Firebase ID token via Supabase Third-Party Auth. `public.firebase_uid()` SQL helper extracts the UID. Defined in [supabase/schema.sql](supabase/schema.sql).
- **`functions/index.js` does NOT exist.** Each function file is deployed individually via `firebase deploy --only functions:<name>`. Don't add an index.js unless you understand why it isn't there.
- **`firebase.json` has no `functions` section.** Functions deploy works via the user's own setup. Don't add a functions section without checking with them first.

## Future RTDB-cost work (next phases)

Ranked by leverage — pick one as a unit, don't bundle:

1. **`/users` profile split → Supabase** — biggest remaining win. ~5 MB / many-thousand reads per profile session. 5–7 days.
2. **`/private_messages` + `/group_messages` → Supabase** — needs notification trigger rewrite. See "Phase 3 plan" below. 8–10 days.
3. **`/banned_users_by_email` lookups** — 18k chatty reads in the profile. Move admin lookups to a Supabase RPC or central cache. 3–4 days.

---

## Phase 3 plan: notification trigger swap (DO NOT IMPLEMENT YET)

When messages are eventually moved off RTDB, `notifyNewMessage` and `notifyGroupMessage` stop firing — they're declared as `database.ref(...).onCreate(...)`, so no RTDB write = no invocation = silent app. **The body of the notification functions does NOT need to change. Only the trigger.**

### Why "just swap the trigger" works here

Everything the notification functions read still lives on RTDB (and is explicitly NOT migrating per "DO NOT TOUCH" #1):

- `/activeChats/$uid` — presence-based push suppression
- `/activeGroupChats/$uid` — same for groups
- `/users/$uid/fcmToken` — FCM device token (per "Don't migrate `/users` yet")
- `/users/$uid/notifyMessages`, `/users/$uid/notifyGroupMessages` — per-user mute prefs

So Firebase + Supabase coexist: Supabase becomes the messages DB and the *trigger source*; Firebase Admin SDK still does the FCM send and still reads presence/tokens from RTDB.

### Architecture (Phase 3, post-migration)

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

### `unreadCount` in Phase 3

`PrivateChat.jsx` today calls RTDB `increment(unreadCount, 1)` — atomic on the RTDB server. After Phase 3, two clean options:

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
One INSERT into `private_messages` → trigger atomically updates `chat_meta_data.unread_count` AND fires the webhook for FCM. No client round-trip needed. This also means the Phase 3 webhook fully replaces the existing `mirrorChatMetaToSupabase` CF for the message-driven update path.

**Option B — RPC called from the HTTP function**, after the FCM send:
```js
await supabaseAdmin.rpc('bump_unread', { receiver: receiverId, sender: senderId });
```
Slightly slower (one extra round-trip from the HTTP function back to Supabase), but keeps the schema migration smaller.

Pick A for atomicity and lower latency.

### Migration order when Phase 3 starts

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
- Don't dual-write from the *client* to mirror messages into Supabase before Phase 3 schema exists. There's nowhere to write to.
- Don't put the FCM-send logic in an Edge Function (Deno) — keep it in the existing Firebase function so Firebase Admin SDK + RTDB reads stay native. The Edge Function rewrite that #2 in the future-work list mentions is *not necessary* — the HTTP-trigger approach is simpler and reuses 100% of the existing FCM code.
