-- =====================================================================
-- 013_admin_chat_meta.sql — admin-only RPCs for chat_meta_data
-- =====================================================================
-- After Phase 5 clean-cut, chat_meta_data is Supabase-only for new-app
-- builds. AdminDashboard needs to view + delete other users' inbox rows,
-- but the table's RLS (003_chat_metadata + 007_meta_writable) gates
-- SELECT/DELETE to `owner_uid = firebase_uid()` — an admin's JWT carries
-- their own uid, so direct queries return 0 rows / silently skip deletes.
--
-- Rather than loosen the policies (which would let any admin-app bug
-- accidentally pull cross-user rows on a regular query), we expose two
-- SECURITY DEFINER RPCs gated on user_roles.is_admin. Same trust model
-- as toggle_group_reaction (012).
--
-- Safe to re-run.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Internal: admin gate. Inlined into each RPC body, kept here as a
-- single source of truth.
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
  if not exists (
    select 1 from public.user_roles
     where uid = public.firebase_uid()
       and is_admin = true
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;

revoke all on function public._require_admin() from public;
grant execute on function public._require_admin() to authenticated;


-- ---------------------------------------------------------------------
-- admin_list_user_chats
--   Paginated read of one user's inbox. Matches the prior RTDB query
--   (orderByChild('timestamp') + limitToLast + endAt(cursor-1)) by
--   returning rows ordered desc on timestamp_ms with a strict cursor.
--
--   p_cursor_ms = null         → newest page
--   p_cursor_ms = <last seen>  → next page (strictly older than cursor)
-- ---------------------------------------------------------------------
create or replace function public.admin_list_user_chats(
  p_owner_uid text,
  p_cursor_ms bigint default null,
  p_limit     int    default 20
) returns setof public.chat_meta_data
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();

  if p_owner_uid is null or p_owner_uid = '' then
    raise exception 'owner_uid required' using errcode = '22023';
  end if;

  return query
    select *
      from public.chat_meta_data
     where owner_uid = p_owner_uid
       and (p_cursor_ms is null or timestamp_ms < p_cursor_ms)
     order by timestamp_ms desc nulls last
     limit greatest(1, least(coalesce(p_limit, 20), 100));
end $$;

revoke all on function public.admin_list_user_chats(text, bigint, int) from public;
grant execute on function public.admin_list_user_chats(text, bigint, int) to authenticated;


-- ---------------------------------------------------------------------
-- admin_delete_chat_pair
--   Symmetric delete: removes both sides of a 1:1 conversation from
--   chat_meta_data. The RTDB /private_messages/{chatKey} subtree is
--   handled by the existing admin path and stays unchanged.
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_chat_pair(
  p_uid1 text,
  p_uid2 text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_admin();

  if p_uid1 is null or p_uid1 = '' or p_uid2 is null or p_uid2 = '' then
    raise exception 'both uids required' using errcode = '22023';
  end if;
  if p_uid1 = p_uid2 then
    raise exception 'uids must differ' using errcode = '22023';
  end if;

  delete from public.chat_meta_data
   where (owner_uid = p_uid1 and partner_uid = p_uid2)
      or (owner_uid = p_uid2 and partner_uid = p_uid1);
end $$;

revoke all on function public.admin_delete_chat_pair(text, text) from public;
grant execute on function public.admin_delete_chat_pair(text, text) to authenticated;
