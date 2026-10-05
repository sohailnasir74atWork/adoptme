# Chat ban + link enforcement in Supabase — handoff (2026-10-05)

**Status: written, NOT deployed.** Nothing has been run against production.

## The problem

Bans and mutes live only in RTDB `banned_users_by_email/{key}`, and only the app checks them, on the client. The website writes chat straight to Supabase with the user's Firebase ID token, and Supabase had no record of any ban. So a user banned in the app could keep chatting on the website or with raw PostgREST calls. The app also blocks links only on the client.

## What it does

| Piece | File |
|---|---|
| Tables `chat_bans` and `chat_settings`, helper functions, and BEFORE INSERT/UPDATE triggers on `messages`, `private_messages` and `group_messages` | `supabase/045_chat_ban_enforcement.sql` |
| RTDB → Supabase mirror for bans and the `/links_allowed` switch | `functions/mirrorBansToSupabase.js` (registered in `functions/index.js`) |
| Shared row builder (used by both the function and the script) | `functions/_chatBanRow.js` |
| One-shot seed and reconciliation | `scripts/backfillChatBans.js` |

- **Bans:** an insert is rejected when the caller has an active `chat_bans` row. The row is matched by the email in the token (the same key the app uses) or by Firebase uid. Active means `permanent`, or `banned_until_ms` is later than now. Mutes use the same record, so mutes are enforced too.
- **Links:** the server uses the app's `URL_PATTERNS`, copied exactly. A link is allowed when any of these is true:
  - the sender is staff;
  - `chat_settings.links_allowed` is on;
  - in group chats only, the text contains a YouTube or TikTok link.

  When `public.messages` accepts a message with a link, it sets `contains_link = true`.
- **Who is exempt:**
  - Staff, as defined by `is_staff()`: admins, full moderators and the owner emails.
  - Every request with no Firebase uid in the JWT: service role, Cloud Functions, bots, pg_cron and the SQL editor. These pass through untouched.
- **Updates are covered too.** RLS lets users UPDATE message rows, so without this a banned user could post "hi" and then edit it into anything. The triggers therefore also fire when `text` or the image, gif or fruits columns change. Soft-deletes and reports are not affected. The app never updates those columns.
- **Group messages and `send_group_message`:** the triggers still see the caller inside this SECURITY DEFINER RPC, because `request.jwt.claims` is transaction-local and inherited. The RPC gets no membership check, on purpose: membership lives in Firestore (see the header of 010).
- **Only staff decisions are mirrored.** The RTDB rules let any client write or delete a ban record for a non-staff user, and that includes a banned user deleting their own. The function therefore mirrors a change only when the writer is the Admin SDK or a staff user. It ignores other writes and logs them as `[mirrorBans] ignored change by non-staff writer`.

## Deploy order

1. **SQL Editor, `045` STEP 1 only.** This creates the tables and functions and touches no hot table. Run STEP 0 first and again between steps to check progress.
2. **Deploy the two new functions:**
   `firebase deploy --only functions:mirrorBansToSupabase,functions:mirrorLinksAllowedToSupabase --project adoptme-7b50c`
   They reuse the existing secrets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
3. **Backfill.** Do a dry run, read the output, then apply:
   ```
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backfillChatBans.js
   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backfillChatBans.js --apply
   ```
4. **SQL Editor, `045` STEPs 2, 3 and 4, one at a time.** Each step arms one table with `lock_timeout = 5s`. If a step times out, retry it.
5. **Smoke test as a normal user.**
   - `rpc('caller_is_chat_banned')` returns `false`.
   - Sending `x.com` from the website is rejected.
   - Sending `x.com` from a group chat is rejected; a YouTube link in a group chat is accepted.
   - Mute a test account in the app and confirm the website rejects its sends.

Before step 4, check RTDB `/links_allowed`. If it is `true`, the backfill or the function must copy it into `chat_settings` first. Otherwise app users get `LINKS_NOT_ALLOWED` until it does.

## Rollback

```sql
set lock_timeout = '5s';
drop trigger if exists trg_aa_chat_ban   on public.messages;
drop trigger if exists trg_ab_chat_links on public.messages;
drop trigger if exists trg_aa_chat_ban   on public.private_messages;
drop trigger if exists trg_ab_chat_links on public.private_messages;
drop trigger if exists trg_aa_chat_ban   on public.group_messages;
drop trigger if exists trg_ab_chat_links on public.group_messages;
reset lock_timeout;
```
Dropping the triggers stops enforcement immediately. The tables, functions and Cloud Functions do nothing without the triggers. The full drop list is at the bottom of 045.

## Errors clients should map

Both errors arrive as `error.message`, with `error.code = '23514'` (check_violation). This is the same convention as `RECIPIENT_CHAT_UNAVAILABLE` and `SAFE_CHAT_*`.

| `error.message` | Meaning | Suggested copy (existing i18n keys) |
|---|---|---|
| `USER_BANNED` | Caller has an active ban or mute | `chat.banned_message` / `chat.permanently_banned_message` |
| `LINKS_NOT_ALLOWED` | Text has a link the caller may not send | `moderation.reason_links` (groups: `chat.only_youtube_tiktok_links`) |

The website can call `rpc('caller_is_chat_banned')` or `select * from chat_bans` before sending. RLS only returns the caller's own row. For the links switch, read `chat_settings`.

## App behaviour if it ever hits these (it blocks client-side first)

None of the three send paths crash; each surfaces the error.
- **Public rooms (`Trader.jsx`):** the message is marked failed and pushed onto the retry queue. A permanent 23514 at the head of that queue stops it draining while the screen is open. Suggested follow-up: don't enqueue 23514.
- **Private chat:** shows the generic `chat.send_error` alert.
- **Groups:** shows the raw string (for example "USER_BANNED") in the error toast.

## Known gaps and risks

- **Tighten the RTDB rule on `banned_users_by_email/$emailKey`.** It allows writes with no auth at all. The mirror works around this for Supabase, but the app itself still trusts that node.
- **The app and the server can disagree after a non-staff edit.** If a user deletes their own ban, the app treats them as unbanned while Supabase still bans them. A staff unban of a record that no longer exists fires no event, so the row stays. To clear it, delete the row by hand or run the backfill with `--prune`, which deletes every row that has no RTDB record.
- **A failed mirror call is not retried**, which matches the other mirrors.
  - A missed staff unban leaves a legitimate user blocked server-side. Re-run the backfill with `--overwrite` or `--prune`.
  - A missed `links_allowed=true` makes the server reject app link sends. Watch the `[mirrorBans]` and `[mirrorLinksAllowed]` error logs.
- **Ban matching differs from the app in three ways:**
  - The server lowercases the email key and also matches on uid. `GlobelStats` reads the key without lowercasing. A user with a capital letter in their auth email can therefore be banned server-side while the app thinks they are not.
  - Device bans (`banned_devices`) are not mirrored.
  - Staff are exempt server-side but not in the app.
- **The link regex has no trailing word boundary**, so `.community` and `...me` are blocked. This matches the app exactly. Change both or neither.
- **Not covered:**
  - `chat_meta_data` and `group_meta_data` last-message previews, which users can write directly.
  - Message reactions.
  - Any user can still UPDATE the text of any public message (`messages update authenticated` policy). The new triggers stop that only for banned users and for links.
