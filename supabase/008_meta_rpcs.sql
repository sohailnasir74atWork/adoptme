-- =====================================================================
-- 008_meta_rpcs.sql — atomic unread-count increment helpers
-- =====================================================================
-- Without these, two concurrent senders racing to bump the receiver's
-- unread_count would read the same value, both write +1, and lose one
-- increment ("lost update"). PostgREST doesn't expose
-- `unread_count = unread_count + 1` directly, so we wrap it in a
-- SECURITY DEFINER function.
--
-- Used as a building block for now; send_private_chat_meta (009) and
-- fanout_group_message_meta (011) bundle the increment into the main
-- write so this RPC is mostly a fallback / standalone helper.
-- =====================================================================

create or replace function public.increment_chat_unread(
  p_owner_uid   text,
  p_partner_uid text
) returns int
language sql
security definer
set search_path = public
as $$
  update public.chat_meta_data
     set unread_count = unread_count + 1,
         updated_at   = now()
   where owner_uid   = p_owner_uid
     and partner_uid = p_partner_uid
   returning unread_count;
$$;

grant execute on function public.increment_chat_unread(text, text) to authenticated, anon;


create or replace function public.increment_group_unread(
  p_user_id  text,
  p_group_id text
) returns int
language sql
security definer
set search_path = public
as $$
  update public.group_meta_data
     set unread_count = unread_count + 1,
         updated_at   = now()
   where user_id  = p_user_id
     and group_id = p_group_id
   returning unread_count;
$$;

grant execute on function public.increment_group_unread(text, text) to authenticated, anon;
