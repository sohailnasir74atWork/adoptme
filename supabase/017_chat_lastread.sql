-- =====================================================================
-- 017_chat_lastread.sql
--
-- Move private-chat read receipts off RTDB. Replaces the onValue
-- listener on /private_messages/{chatKey}/lastRead/{userId} (~759 reads
-- per 7 min, ~5 MB/day) with realtime UPDATEs on chat_meta_data.
--
-- DESIGN — both sides on each row (denormalised):
--   Each chat_meta_data row stores BOTH participants' lastRead values.
--   The set_chat_last_read RPC updates BOTH rows atomically so each
--   participant's own row always carries the partner's lastRead in
--   `partner_last_read_ms`. The client subscribes once to its own row
--   (via subscribeToChatMeta or a dedicated single-row channel) and the
--   blue-tick threshold falls out of the same UPDATE payload — no
--   cross-row read, no second subscription, no RLS relaxation.
--
-- WRITE PATH (called from PrivateChat updateLastRead):
--   - Set owner_last_read_ms on caller's row   (owner=me, partner=X)
--   - Set partner_last_read_ms on partner's row (owner=X,  partner=me)
--   Both via SECURITY DEFINER so RLS doesn't gate the partner-row write.
--   Returns the timestamp written (ms epoch) for the client to optimistic-
--   render with.
--
-- READ PATH:
--   `partner_last_read_ms` rides in the existing chat_meta_data realtime
--   stream — `fromChatMetaRow` exposes it as `partnerLastRead`. Open-
--   chat UI in PrivateChat uses a single-row subscription
--   (`subscribeToChatLastRead`) for low coupling with the inbox stream.
-- =====================================================================

alter table public.chat_meta_data
  add column if not exists owner_last_read_ms   bigint,
  add column if not exists partner_last_read_ms bigint;

create or replace function public.set_chat_last_read(
  p_partner_uid text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me     text;
  now_ms bigint;
begin
  me := public.firebase_uid();
  if me is null or p_partner_uid is null or p_partner_uid = '' then
    return null;
  end if;

  now_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  -- Caller's row: update OWN lastRead.
  update public.chat_meta_data
     set owner_last_read_ms = now_ms,
         updated_at         = now()
   where owner_uid   = me
     and partner_uid = p_partner_uid;

  -- Partner's row: update PARTNER lastRead (i.e. caller's lastRead from
  -- the partner's perspective). SECURITY DEFINER bypasses the
  -- owner_uid=firebase_uid() RLS gate that would otherwise block this.
  update public.chat_meta_data
     set partner_last_read_ms = now_ms,
         updated_at           = now()
   where owner_uid   = p_partner_uid
     and partner_uid = me;

  return now_ms;
end;
$$;

grant execute on function public.set_chat_last_read(text) to authenticated;
