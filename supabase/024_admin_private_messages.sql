-- =====================================================================
-- 024_admin_private_messages.sql — make the AdminDashboard chat viewer
-- actually work again.
-- =====================================================================
-- BUG 1 — the admin gate never matched the real admins.
--   _require_admin() (013) checks ONLY user_roles.is_admin, which
--   mirrorUsersToSupabase populates from the RTDB `admin` flag
--   (mirrorUsersToSupabase.js:144). None of the three super-admin
--   accounts has that flag set — they are admin purely by EMAIL
--   (GlobelStats.js:353), and the dashboard grants one extra account
--   admin powers by UID (AdminDashboard.js:106 SUPER_ADMIN_ID).
--   So every call to admin_list_user_chats / admin_delete_chat_pair
--   raised 42501, which fetchUserChats swallows as a console.warn —
--   the User Chats tab just renders an empty list with no error.
--
--   Exactly the failure 020_group_messages_staff_read.sql fixed for
--   group_messages; 013's RPCs were never given the same treatment.
--
-- BUG 2 — no way to read message BODIES at all.
--   013 migrated the chat LIST to Supabase but left the message bodies
--   behind: loadChat still read RTDB /private_messages/{chatKey}/messages,
--   which stopped receiving writes at the Phase 5 cut (new builds send
--   via Supabase public.private_messages). Any conversation after the cut
--   showed "No messages found between these users".
--
--   private_messages RLS is participant-only, so an admin querying the
--   table directly gets 0 rows. Following 013's reasoning (don't loosen
--   the policy — a client bug could then pull cross-user DMs on an
--   ordinary query), the read is exposed as a SECURITY DEFINER RPC.
--
-- BUG 3 — "Delete Conversation" left the messages behind.
--   deletePrivateChat cleared the RTDB subtree (already empty) and both
--   chat_meta_data rows, but nothing removed the Supabase message rows.
--   The dialog promises "permanently delete ... all messages"; the
--   bodies survived and were still readable by either participant, since
--   PrivateChat loads by chat_id and not via the inbox row.
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Admin gate — same trust model as 013, widened to the admin
--    population that actually exists.
--
--    Accepts, in order of cost:
--      (a) user_roles.is_admin — the mirrored RTDB roster.
--      (b) the hardcoded super-admin EMAIL allowlist. Firebase ID tokens
--          carry an `email` claim, read the same way firebase_uid()
--          reads `sub`.
--
--    Replacing the function in place means admin_list_user_chats and
--    admin_delete_chat_pair (013) pick the fix up with no redeploy.
--
-- ⚠️ Two email lists must stay in sync when either changes:
--      GlobelStats.js:353   and   is_staff() in 020
--
-- NOT accepted: AdminDashboard.js:106 SUPER_ADMIN_ID. That UID gets the
-- admin TABS client-side (isSuperAdmin, AdminDashboard.js:182) but is
-- deliberately NOT granted cross-user chat reads here — the UI grant is
-- not a decision to hand a non-staff account every private conversation
-- in the app. Cross-user calls from that account fail with 42501, which
-- the dashboard now surfaces instead of rendering an empty list.
-- ---------------------------------------------------------------------
create or replace function public._require_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.firebase_uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.user_roles
     where uid = public.firebase_uid()
       and is_admin = true
  ) then
    return;
  end if;

  if lower(current_setting('request.jwt.claims', true)::jsonb ->> 'email') in (
    'thesolanalabs@gmail.com',
    'sohailnasir74business@gmail.com',
    'sohailnasir74@gmail.com'
  ) then
    return;
  end if;

  raise exception 'not authorized' using errcode = '42501';
end $$;

revoke all on function public._require_admin() from public;
grant execute on function public._require_admin() to authenticated;


-- ---------------------------------------------------------------------
-- 2. admin_list_private_messages
--    Message bodies for one conversation, newest-first, cursor-paginated
--    on the same (created_at desc, id desc) composite the participant
--    read uses — so the existing idx_private_messages_chat_created index
--    serves it.
--
--    Soft-deleted rows ARE returned: this is the moderation view, and a
--    message a user deleted after being reported is exactly what an
--    admin needs to see. The client tags them.
--
--    p_cursor_created / p_cursor_id = null → newest page.
-- ---------------------------------------------------------------------
create or replace function public.admin_list_private_messages(
  p_chat_id        text,
  p_cursor_created timestamptz default null,
  p_cursor_id      uuid        default null,
  p_limit          int         default 200
) returns setof public.private_messages
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();

  if p_chat_id is null or p_chat_id = '' then
    raise exception 'chat_id required' using errcode = '22023';
  end if;

  return query
    select *
      from public.private_messages
     where chat_id = p_chat_id
       and (
         p_cursor_created is null
         or created_at < p_cursor_created
         or (created_at = p_cursor_created and id < p_cursor_id)
       )
     order by created_at desc, id desc
     limit greatest(1, least(coalesce(p_limit, 200), 500));
end $$;

revoke all on function public.admin_list_private_messages(text, timestamptz, uuid, int) from public;
grant execute on function public.admin_list_private_messages(text, timestamptz, uuid, int) to authenticated;


-- ---------------------------------------------------------------------
-- 3. admin_delete_private_chat
--    Hard-deletes every message row in a conversation. Pairs with
--    admin_delete_chat_pair (013), which clears the two inbox rows;
--    together they make the "Delete Conversation" dialog truthful.
--
--    Hard delete, not soft: the admin tool advertises permanent removal,
--    and a soft-delete would leave the bodies queryable by both
--    participants. Returns the row count so the client can report it.
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_private_chat(
  p_chat_id text
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  perform public._require_admin();

  if p_chat_id is null or p_chat_id = '' then
    raise exception 'chat_id required' using errcode = '22023';
  end if;

  delete from public.private_messages where chat_id = p_chat_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.admin_delete_private_chat(text) from public;
grant execute on function public.admin_delete_private_chat(text) to authenticated;
