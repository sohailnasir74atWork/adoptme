-- =====================================================================
-- 011_fanout_group_meta.sql — atomic group_meta_data fan-out via RPC
-- =====================================================================
-- After a new-app build sends a group message (via send_group_message
-- RPC, 010), the client also needs to fan out the metadata bump to every
-- group member's group_meta_data row:
--   - Update last_message / last_message_timestamp_ms / sender_id /
--     sender_name / group_name on every member's row.
--   - Bump unread_count on every non-sender's row.
--   - Sender's row stays at unread_count=0 (sender is by definition
--     reading their own send).
--
-- groupUtils.js:sendGroupMessage does this today on RTDB as a multi-path
-- update. This RPC ports the same logic to Supabase.
--
-- Benefits over a client-side bulk upsert + N increment_group_unread calls:
--   - Atomic: every member row + every unread bump in one transaction;
--     no half-state where some members got the preview and others didn't.
--   - One round-trip instead of N+1.
--   - SECURITY DEFINER bypasses any RLS edge case on the bulk upsert.
--
-- Trust model: same as 007_meta_writable.sql group_meta_data UPDATE —
-- any authenticated caller can fan out. Client-supplied member list is
-- trusted (matches existing RTDB model where the client iterates
-- memberIds from Firestore). Spam contained at the notify CF layer
-- (which checks Firestore /groups/{groupId}/memberIds before pushing).
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

  -- Phase 1: bulk upsert descriptive fields for every member.
  -- unread_count is omitted on the SET clause so existing rows keep
  -- their running count (phase 2 bumps non-senders); new rows land at
  -- the column default 0 and phase 2 bumps them to 1.
  -- muted and joined_at_ms / last_read_at_ms are intentionally omitted
  -- so existing values are preserved.
  insert into public.group_meta_data (
    user_id, group_id,
    last_message, last_message_timestamp_ms,
    last_message_sender_id, last_message_sender_name,
    group_name, updated_at
  )
  select unnest(p_member_ids), p_group_id,
         p_last_message, ts,
         p_sender_id, p_sender_name,
         p_group_name, now()
  on conflict (user_id, group_id) do update set
    last_message              = excluded.last_message,
    last_message_timestamp_ms = excluded.last_message_timestamp_ms,
    last_message_sender_id    = excluded.last_message_sender_id,
    last_message_sender_name  = excluded.last_message_sender_name,
    group_name                = coalesce(excluded.group_name, group_meta_data.group_name),
    updated_at                = now();

  -- Phase 2: bump unread for every non-sender member in one statement.
  update public.group_meta_data
     set unread_count = unread_count + 1,
         updated_at   = now()
   where group_id = p_group_id
     and user_id <> coalesce(p_sender_id, '')
     and user_id = any(p_member_ids);
end $$;

grant execute on function public.fanout_group_message_meta(
  text, text[], text, text, text, bigint, text
) to authenticated;
