-- =====================================================================
-- 009_send_private_chat_meta.sql — atomic two-sided chat-meta upsert
-- =====================================================================
-- Replaces the two parallel client-side upserts (sender + receiver row)
-- that PrivateChat.jsx will use after the clean-cut. One SECURITY DEFINER
-- RPC instead of two REST INSERTs:
--   1. Atomic: the pair is written in one transaction — no half-write
--      where the sender's inbox shows the message but the receiver's
--      doesn't.
--   2. Sidesteps RLS INSERT-WITH-CHECK rejection edge cases on the
--      receiver-side row (same class of bug Blox_Fruit hit and fixed
--      with this pattern).
--   3. Bundles the receiver-side unread_count increment into the same
--      call, no extra round-trip.
--   4. Preserves muted on existing rows — sender bumps don't reset the
--      receiver's mute flag.
--
-- adoptme-specific: chat_meta_data has `muted` (Blox_Fruit's 011 didn't
-- explicitly preserve it because their column didn't exist at write
-- time on existing rows; we omit `muted` from the ON CONFLICT SET so the
-- existing row keeps it).
-- =====================================================================

create or replace function public.send_private_chat_meta(
  p_partner_uid     text,
  p_last_message    text,
  p_timestamp_ms    bigint,
  p_sender_name     text default null,
  p_sender_avatar   text default null,
  p_receiver_name   text default null,
  p_receiver_avatar text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  text := public.firebase_uid();
  pair_id text;
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_partner_uid is null or p_partner_uid = '' then
    raise exception 'partner_uid required' using errcode = '22023';
  end if;
  if caller = p_partner_uid then
    raise exception 'cannot send chat meta to self' using errcode = '22023';
  end if;

  pair_id := case when caller < p_partner_uid
                  then caller || '_' || p_partner_uid
                  else p_partner_uid || '_' || caller
             end;

  -- Sender side (caller). unread_count stays whatever it was — sender
  -- hasn't received anything new from this send. muted is preserved.
  insert into public.chat_meta_data (
    owner_uid, partner_uid, chat_id, receiver_id,
    last_message, timestamp_ms, unread_count,
    receiver_name, receiver_avatar, updated_at
  ) values (
    caller, p_partner_uid, pair_id, p_partner_uid,
    p_last_message, p_timestamp_ms, 0,
    p_receiver_name, p_receiver_avatar, now()
  )
  on conflict (owner_uid, partner_uid) do update set
    last_message    = excluded.last_message,
    timestamp_ms    = excluded.timestamp_ms,
    receiver_id     = excluded.receiver_id,
    receiver_name   = coalesce(excluded.receiver_name, chat_meta_data.receiver_name),
    receiver_avatar = coalesce(excluded.receiver_avatar, chat_meta_data.receiver_avatar),
    updated_at      = now();
    -- muted intentionally NOT updated — preserves the sender's mute flag.

  -- Receiver side (partner). unread_count: starts at 1 on first row,
  -- bumps by 1 on subsequent sends. muted is preserved.
  insert into public.chat_meta_data (
    owner_uid, partner_uid, chat_id, receiver_id,
    last_message, timestamp_ms, unread_count,
    receiver_name, receiver_avatar, updated_at
  ) values (
    p_partner_uid, caller, pair_id, caller,
    p_last_message, p_timestamp_ms, 1,
    p_sender_name, p_sender_avatar, now()
  )
  on conflict (owner_uid, partner_uid) do update set
    last_message    = excluded.last_message,
    timestamp_ms    = excluded.timestamp_ms,
    receiver_id     = excluded.receiver_id,
    unread_count    = chat_meta_data.unread_count + 1,
    receiver_name   = coalesce(excluded.receiver_name, chat_meta_data.receiver_name),
    receiver_avatar = coalesce(excluded.receiver_avatar, chat_meta_data.receiver_avatar),
    updated_at      = now();
    -- muted intentionally NOT updated — preserves the receiver's mute flag.
end $$;

grant execute on function public.send_private_chat_meta(text, text, bigint, text, text, text, text)
  to authenticated;
