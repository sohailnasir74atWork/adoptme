# 2-Day Chat Bridge — HISTORICAL / SUPERSEDED

> **2026-05-18 status:** This document originally planned a 2-day RTDB↔Supabase
> bridge to keep old-app and new-app users in sync during the Phase 5 cut.
> The bridge **was never actually deployed** — `firebase functions:list` on
> 2026-05-18 confirmed none of the 3 new mirror functions exist in
> `adoptme-7b50c`. The deploy step on 2026-05-16 either failed silently or
> was never run. The bridge files exist in [functions/](functions/) but
> have no live deployment. The "teardown" plan below is therefore moot —
> there is nothing to delete.
>
> **The actual clean-cut shipped 2026-05-18** via RTDB rule locks instead
> of CF teardown — see [RTDB_MIGRATION_HANDOFF.md](RTDB_MIGRATION_HANDOFF.md)
> `## 2026-05-18 — clean-cut completed` section. Old-app users now get
> PERMISSION_DENIED on private and group sends, forcing an update.
>
> Kept for historical reference; consider deleting this file once the
> rule-lock state has been stable for a week.

---

## What was originally planned (NEVER DEPLOYED)

Bridge OLD app (RTDB-only) and NEW app (Supabase-only) chat during the
Phase 5 transition window via 3 new Cloud Functions:

| Function | Trigger | Action |
|---|---|---|
| `mirrorPrivateMessageToSupabase` | RTDB onCreate `/private_messages/{chatId}/messages/{messageId}` | INSERT into Supabase `private_messages` with `rtdb_key = messageId` |
| `mirrorPrivateMessageToRtdb` | HTTPS webhook on Supabase `private_messages` INSERT | `set()` to RTDB `/private_messages/{chatId}/messages/sb_{uuid}` |
| `mirrorChatMetaToRtdb` | HTTPS webhook on Supabase `chat_meta_data` INSERT + UPDATE | `update()` to RTDB `/chat_meta_data/{owner}/{partner}` |

Plus 3 existing functions modified with loop / double-push guards:
- `mirrorChatMetaToSupabase` — early-return when RTDB payload has `_mirroredFromSupabase === true`
- `notifyNewMessage` — early-return when `record.rtdb_key !== null`
- `notifyNewMessageLegacy` — early-return when `_mirroredFromSupabase === true`

Source files still exist in [functions/](functions/):
- [functions/mirrorPrivateMessageToSupabase.js](functions/mirrorPrivateMessageToSupabase.js)
- [functions/mirrorPrivateMessageToRtdb.js](functions/mirrorPrivateMessageToRtdb.js)
- [functions/mirrorChatMetaToRtdb.js](functions/mirrorChatMetaToRtdb.js)
- [functions/mirrorChatMetaToSupabase.js](functions/mirrorChatMetaToSupabase.js)

These can be deleted from the repo at the same time you delete this doc —
they are dead source files corresponding to never-deployed functions.

---

## Why the bridge wasn't needed in the end

Per the user's 2026-05-18 decision: skip the bridge, force-update old
users instead. RTDB rule locks make old-app sends fail visibly
(PERMISSION_DENIED) which signals to the user that they're on an older
version and need to update. Push notice via
[functions/sendUpdateNoticeMessage.js](functions/sendUpdateNoticeMessage.js)
reinforces the message.

Group chat was never going to be bridged anyway (out of scope of the
original 2-day plan). Private chat cross-version is now broken-by-design.
Acceptable per user direction.

---

## What "teardown" actually means now (2026-05-18)

Since the bridge functions don't exist, the original teardown is moot.
The relevant cleanup that DOES need to happen:

1. **Delete the two legacy notify CFs** — RTDB-trigger-based, now dead
   because the trigger paths are write-locked:

   ```bash
   firebase functions:delete notifyNewMessageLegacy notifyGroupMessageLegacy \
     --region us-central1 --project adoptme-7b50c --force
   ```

2. **Delete the unused bridge source files** from the repo (since they
   correspond to functions that were never deployed).

3. **Delete `functions/sendUpdateNoticeMessage.js`** in Firebase once
   old-app DAU has drained (auto-stop guard already prevents posting
   after 2026-05-19 00:00 Asia/Karachi).

4. **Delete this doc.**
