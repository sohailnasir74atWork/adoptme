-- =====================================================================
-- 020_group_messages_staff_read.sql
--
-- BUG: admins / moderators opening a group they have NOT joined see zero
-- messages. The client lets them in (GroupChatScreen forces isMember=true
-- via `isAdmin || user.isModerator`), but group_messages RLS is member-only
-- — `using (is_group_member(group_id))`, and is_group_member() checks for a
-- group_meta_data row. Staff who never joined have no such row, so the
-- SELECT (and the realtime stream, which authorizes off the same SELECT
-- policy) returns nothing. Pre-existing since the group-message migration
-- (006); surfaced during testing.
--
-- FIX: allow platform staff to read group messages in any group. UPDATE is
-- widened too so their existing soft-delete moderation (softDeleteGroupMessage*)
-- works in groups they haven't joined. INSERT stays member+sender (staff don't
-- post as non-members); DELETE stays sender-only (hard delete is the rare path).
--
-- "Staff" = EITHER:
--   (a) user_roles.is_admin / is_moderator — the mod-roster roles
--       mirrorUsersToSupabase populates from RTDB admin / isModerator, OR
--   (b) the hardcoded super-admin EMAIL allowlist the client uses
--       (GlobelStats.js:267). These super-admins are admin purely by email and
--       have NO RTDB `admin` flag, so user_roles.is_admin is false for them —
--       which is why a user_roles-only check left them still blocked. Firebase
--       ID tokens carry an `email` claim, readable here the same way
--       firebase_uid() reads `sub`.
--
-- ⚠️ The email list MUST stay in sync with GlobelStats.js:267. When you change
--    one, change the other.
--
-- Trust model matches 013_admin_chat_meta.sql. No client change required — the
-- screen already opens for staff; this just unblocks the server read.
-- =====================================================================

create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    exists (
      select 1
        from public.user_roles
       where uid = public.firebase_uid()
         and (is_admin = true or is_moderator = true)
    )
    or lower(current_setting('request.jwt.claims', true)::jsonb ->> 'email') in (
      'thesolanalabs@gmail.com',
      'sohailnasir74business@gmail.com',
      'sohailnasir74@gmail.com'
    );
$$;

grant execute on function public.is_staff() to authenticated, anon;

-- SELECT: members OR staff (also authorizes realtime delivery).
drop policy if exists "group_messages select by member" on public.group_messages;
create policy "group_messages select by member"
  on public.group_messages for select
  using (public.is_group_member(group_id) or public.is_staff());

-- UPDATE: members OR staff (soft-delete / report-count moderation).
drop policy if exists "group_messages update by member" on public.group_messages;
create policy "group_messages update by member"
  on public.group_messages for update
  using (public.is_group_member(group_id) or public.is_staff())
  with check (public.is_group_member(group_id) or public.is_staff());
