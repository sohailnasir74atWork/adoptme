-- 058: turn Row-Level Security back on for public.messages (public chat).
--
-- Found 2026-10-28 from the Supabase security advisor (rls_disabled_in_public):
-- RLS was off on the live table (switched off outside the migrations), so
-- anyone holding the publishable/anon key could read, edit or delete every
-- public chat message. Ops/bugs/LOG.md 2026-10-28.
--
-- Backward compatible with every live app version:
--   * read stays open to everyone, exactly as with RLS off. The app filters
--     deleted = false itself (chatBackend loadMessages / loadMessagesSince),
--     and a mod soft-delete reaches other phones as a Realtime UPDATE with
--     deleted = true, which a "deleted = false" read policy would swallow.
--   * insert keeps "messages insert own" (sender_id = firebase_uid()); every
--     sender_id in the last 7 days is the sender's Firebase uid.
--   * update: any request carrying a Firebase token (reports and mod
--     soft-deletes write other people's rows), as in schema.sql. Replaces the
--     live WITH CHECK on auth.uid(), which is not in the repo and would fail
--     for Firebase uids.
--   * no delete policy: only postgres / service role delete (retention cron).
-- Policies apply to all roles (no TO clause): a brand-new account's first
-- token has no role claim and runs as anon, but still carries its uid in sub.

begin;

set local lock_timeout = '3s';

drop policy if exists "messages read non-deleted" on public.messages;
drop policy if exists "messages read all" on public.messages;
create policy "messages read all"
  on public.messages for select
  using (true);

drop policy if exists "messages update authenticated" on public.messages;
create policy "messages update authenticated"
  on public.messages for update
  using (public.firebase_uid() is not null)
  with check (public.firebase_uid() is not null);

-- TRUNCATE is not covered by RLS.
revoke truncate on public.messages from anon, authenticated;

alter table public.messages enable row level security;

commit;

-- Rollback (restores the exposed state; only if chat breaks):
--   alter table public.messages disable row level security;
