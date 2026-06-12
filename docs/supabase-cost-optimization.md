# Supabase Cost Optimization

Tracking the work to bring down the Supabase bill after the RTDB → Supabase chat
migration. Started from invoice **NOQSGF-00006** (period May 5–27, 2026).

---

## 1. The invoice that triggered this (NOQSGF-00006 — $149.34)

The migration was expected to *reduce* cost; it didn't, because the chat design
leans heavily on Realtime `postgres_changes`, which is billed **per delivered
message**.

| Line | Net | Notes |
|---|---|---|
| **Realtime Messages** | **$90.00** | 40,571,241 messages (5M free) — the driver |
| **Egress** | **$29.67** | ~580 GB across both projects (250 GB free) |
| Pro Plan (next month, in advance) | $25.00 | billed **inside** this invoice, not extra |
| Compute | $4.66 | 2× Micro, after the $10 credit |
| MAU (50,015) / Peak conns (421) / Storage | ~$0.00 | within free tier |

**Billing clarifications**
- Supabase **Pro is $25 per _organization_**, not per project. The two projects
  share one Pro plan and one set of free-tier allowances.
- The `$25 Pro Plan` line is **included** in the $149.34 (next month billed in
  advance). It is **not** an extra charge on top — total owed was $149.34.
- The period was **only 23 days** (partial). A full 30-day month at the same rate
  trends toward **~$190/mo** — so optimization matters more, not less.

---

## 2. Where the cost actually comes from (measured)

Diagnostic SQL (run in the SQL Editor) over the billing window:

| Signal | Value | Meaning |
|---|---|---|
| Private sends (23d) | **219,021** (82% of sends) | volume driver |
| Public sends | 29,042 | fan-out already scoped + focus-gated → not the problem |
| Group sends | 18,539 | negligible |
| `chat_meta_data` | **620,371 rows / 292 MB** | biggest table; the hot path |
| `group_meta_data` | 2,186 rows | groups are negligible |
| `private_messages` / `messages` / `group_messages` | 200 / 81 / 20 MB | egress on history loads |
| Distinct inbox owners | 40,177 | avg ~15 partners each |
| Inbox owners > 500 partners | 88 | heavy tail that amplifies meta churn |

**Root cause of the 40.5M realtime messages:** every private message updates **2**
`chat_meta_data` rows (sender + receiver); read receipts updated **2 more per
received message**; and each row update is delivered to **every channel the user
has open** (ChatNavigator badge + InboxScreen list + the per-chat lastRead
channel = up to 3). One active back-and-forth produced well over a dozen realtime
messages per real chat message.

Already-good things (left alone): the **public room** is scoped by `room_id` and
only subscribes while its screen is focused ([Trader.jsx](../Code/ChatScreen/GroupChat/Trader.jsx)),
and **reactions realtime was deliberately dropped** ([chatBackend.js](../Code/Supabase/chatBackend.js)).

---

## 3. Changes shipped

All client-side. **No schema, RPC, or data-shape changes → backward compatible**
with old-app builds (which run separate RTDB paths) and need no redeploy.

### Realtime reductions (target the $90 line)

| # | Change | File(s) | Effect |
|---|---|---|---|
| A | **Debounced read receipts** — `updateLastRead` coalesces (leading edge fires instantly, repeats within 4 s suppressed, trailing edge writes once) + `flushLastRead` on chat blur | [utils.js](../Code/ChatScreen/utils.js), [PrivateChat.jsx](../Code/ChatScreen/PrivateChat/PrivateChat.jsx) | biggest single cut — was 2 rows × up-to-3 channels **per received message** |
| B | **Ref-counted shared meta subscription** — `subscribeToChatMetaShared` / `subscribeToGroupMetaShared` multiplex one channel to all in-process consumers; teardown only when the last detaches; late joiners get cached rows replayed | [chatMetaBackend.js](../Code/Supabase/chatMetaBackend.js), [groupMetaBackend.js](../Code/Supabase/groupMetaBackend.js), [ChatNavigator.js](../Code/ChatScreen/ChatNavigator.js), [InboxScreen.jsx](../Code/ChatScreen/GroupChat/InboxScreen.jsx) | ChatNavigator + InboxScreen collapse 2 channels → 1; bonus: faster inbox re-open + skips a duplicate load |
| C | **Folded `useOtherLastRead` onto the shared stream** — `partnerLastRead` already rides in the chat_meta payload, so the dedicated `subscribeToChatLastRead` channel is gone | [utils.js](../Code/ChatScreen/utils.js) | removes one realtime channel per open private chat |

### Egress reductions (target the $30 line)

| # | Change | File(s) | Effect |
|---|---|---|---|
| D | **Narrowed `select('*')` → explicit columns** in `loadChatMeta` + private/group message loaders | [chatMetaBackend.js](../Code/Supabase/chatMetaBackend.js), [privateMessagesBackend.js](../Code/Supabase/privateMessagesBackend.js), [groupMessagesBackend.js](../Code/Supabase/groupMessagesBackend.js) | drops unused columns on every load, incl. the 292 MB chat_meta table |

### Correctness fixes (shipped alongside)

- **Phantom unread badge** — unread now resets on chat blur (gated, ~1 write/visit)
  in both [PrivateChat.jsx](../Code/ChatScreen/PrivateChat/PrivateChat.jsx) and
  [GroupChatScreen.jsx](../Code/ChatScreen/GroupChat/GroupChatScreen.jsx).
- **Inbox pagination collapse** — the visible-count no longer resets to 15 on every
  realtime update ([InboxScreen.jsx](../Code/ChatScreen/GroupChat/InboxScreen.jsx)).

### Expected savings (estimate — confirm on the Usage counter)

- Realtime: **~15–30% off the $90 line ≈ $18–$36/mo** (chat_meta churn is the
  dominant driver). Floor ~$8–10 if it turns out public traffic dominates.
- Egress: a few dollars from narrowed selects + skipped duplicate inbox load.
- **Full-month bill trend: ~$190 → ~$155–170.** Real, free, zero-risk — not halved.

> Exact numbers can't be derived from the DB (Supabase doesn't expose per-channel
> message counts). **Verify** by watching **org → Usage → Realtime Messages** for
> 3–4 days after deploy — the daily counter is ground truth.

---

## 4. Remaining levers (not yet done)

Prioritized by impact-to-effort:

1. **Inbox row-count reduction (egress).** `loadChatMeta` loads *all* of a user's
   rows (heavy users: 1,411) though the inbox shows 15. **Blocked by:** the unread
   badge sums `unread_count` across all rows, so we can't just cap the load. Proper
   fix = decouple the badge (a tiny `sum(unread_count)` aggregate / RPC) **then**
   lazy-paginate the list server-side. Bundle with #2.
2. **Make the unread tab badge non-realtime (biggest realtime lever).** Today every
   online user holds a chat_meta subscription the whole session just for the badge —
   likely the largest share of the 40.5M. Refresh on app-foreground + chat-tab open
   instead. **Trade-off:** badge won't tick up live while elsewhere in the app (the
   inbox list itself stays live). UX call.
3. **Local cache of message history (egress).** Re-opening a chat re-fetches from
   Supabase; cache last page locally (MMKV/AsyncStorage), fetch only newer-than-cached.
4. **Disconnect realtime on app background.** Keeps peak connections under the 500
   free cap as the user base grows, and trims messages to backgrounded clients.
5. **Spend cap + usage alert** (org → Billing) so there's never another surprise.
6. **Confirm cleanup CFs run + prune ghost `chat_meta_data` rows** (stale rows from
   the old mirror era inflate every inbox load).

---

## 5. Notes

- **Second project (`jaimyhmanefvrijvjzxl`) = Blox Fruits** — a separate production
  RN app in the same directory, not a dev/staging project to pause. Its ~$28
  (compute + 239 GB egress) is legitimate. The **same optimizations apply there**
  since it shares these code patterns.
- **Production project = `kvtbtzhtcaanhjblyick`** (this app).
- `subscribeToChatLastRead` in [chatMetaBackend.js](../Code/Supabase/chatMetaBackend.js)
  is now **dead code** (replaced by the shared-stream fold in change C). Safe to
  delete in a later cleanup.
- Verification done on every edit: `eslint` delta = **0 new problems** across all
  touched files.
