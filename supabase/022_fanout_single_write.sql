-- =====================================================================
-- 022_fanout_single_write.sql — fan out group message meta in ONE row
-- touch per member (was two)
-- =====================================================================
-- COST CONTEXT (audit 2026-07-09):
-- 011_fanout_group_meta.sql touched every member's group_meta_data row
-- TWICE per group message:
--   phase 1: bulk upsert of the last_message preview fields
--   phase 2: unread_count bump for non-senders
-- group_meta_data is REPLICA IDENTITY FULL and every member holds an
-- always-on `group-meta:{uid}` realtime channel (groupMetaBackend.js),
-- so each message generated ~2 × member_count full-row realtime
-- deliveries + double WAL. This migration merges both phases into a
-- single INSERT ... ON CONFLICT: the unread bump rides the same upsert
-- (bump = 0 for the sender, 1 for everyone else).
--
-- Semantics are identical to 011:
--   * new non-sender row  -> unread_count 1        (was: default 0, bumped to 1)
--   * new sender row      -> unread_count 0        (was: default 0, not bumped)
--   * existing non-sender -> unread_count + 1      (was: phase-2 bump)
--   * existing sender     -> unread_count unchanged (client resets it anyway)
--   * null p_sender_id    -> every member bumped   (matches 011's
--     `user_id <> coalesce(p_sender_id,'')` behaviour)
--   * muted / joined_at_ms / last_read_at_ms untouched, group_name
--     coalesced — exactly as before.
-- =====================================================================

create or replace function public.fanout_group_message_meta(
  p_group_id      text,
  p_member_ids    text[],
  p_sender_id     text,
  p_sender_name   text   default null,
  p_last_message  text   default null,
  p_timestamp_ms  bigint default null,
  p_group_name    text   default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller text   := public.firebase_uid();
  ts     bigint := coalesce(p_timestamp_ms, (extract(epoch from now()) * 1000)::bigint);
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_group_id is null or p_group_id = '' then
    raise exception 'group_id required' using errcode = '22023';
  end if;
  if p_member_ids is null or array_length(p_member_ids, 1) is null then
    return; -- nothing to fan out to
  end if;

  -- Single row touch per member: preview fields + unread bump together.
  insert into public.group_meta_data (
    user_id, group_id,
    last_message, last_message_timestamp_ms,
    last_message_sender_id, last_message_sender_name,
    group_name, unread_count, updated_at
  )
  select m.uid, p_group_id,
         p_last_message, ts,
         p_sender_id, p_sender_name,
         p_group_name,
         case when m.uid = coalesce(p_sender_id, '') then 0 else 1 end,
         now()
  from (select distinct u as uid from unnest(p_member_ids) as u) m
  on conflict (user_id, group_id) do update set
    last_message              = excluded.last_message,
    last_message_timestamp_ms = excluded.last_message_timestamp_ms,
    last_message_sender_id    = excluded.last_message_sender_id,
    last_message_sender_name  = excluded.last_message_sender_name,
    group_name                = coalesce(excluded.group_name, group_meta_data.group_name),
    unread_count              = group_meta_data.unread_count + excluded.unread_count,
    updated_at                = now();
end $$;

grant execute on function public.fanout_group_message_meta(
  text, text[], text, text, text, bigint, text
) to authenticated;
