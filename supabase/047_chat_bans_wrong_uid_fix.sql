-- =====================================================================
-- 047 — chat_bans: drop user_ids that belong to someone else
-- =====================================================================
--
-- App builds from March–May 2026 wrote the MODERATOR's uid into
-- banned_users_by_email/{key}.userId (802 records; one former mod's uid is
-- on 618 of them). backfillChatBans copied that field into
-- chat_bans.user_id, and caller_is_chat_banned (045) matches on
-- user_id OR email_key — so on 2026-10-05 eleven accounts whose own email
-- is not banned were blocked from every chat (1,047 rows), among them
-- former moderators.
--
-- Rule: a ban row's user_id is kept only when that account's own email
-- maps to the row's email_key. Rows whose uid has no identity row, or an
-- identity without an email, are left alone (cannot be judged). The email
-- match still enforces every one of these bans — only the wrong uid goes.
--
-- Re-running backfillChatBans.js re-introduces the bad uids unless the
-- script applies the same check first.
-- =====================================================================

update public.chat_bans b
   set user_id = null
  from public.user_identity_base i
 where i.uid = b.user_id
   and i.email is not null
   and public.chat_ban_key(i.email) is distinct from b.email_key;
