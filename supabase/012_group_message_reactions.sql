-- =====================================================================
-- 012_group_message_reactions.sql — Phase 5 group-chat M3 unblocker
--
-- Group chat has a reactions feature (emoji per user per message) that
-- private chat does not. RTDB stored it as
--   /group_messages/{groupId}/messages/{msgId}/reactions/{userId} = "emoji"
-- and 32 client references read/write that shape.
--
-- This migration ports the feature inline as a jsonb column on
-- group_messages, plus an atomic toggle RPC. Inline (not a separate
-- table) because:
--   - Cardinality is low — group_messages is group-scoped, not global.
--   - Reactions ride along the existing UPDATE realtime broadcast on
--     group_messages, so cross-user reactions sync without a second
--     subscription (and without the Realtime-fanout problem the public
--     chat hit with its separate message_reactions table).
--   - Shape `{[userId]: emoji}` matches the RTDB layout exactly, so the
--     UI doesn't need a new render path.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------
alter table public.group_messages
  add column if not exists reactions jsonb not null default '{}'::jsonb;


-- =====================================================================
-- toggle_group_reaction RPC
-- =====================================================================
-- Atomic toggle of caller's reaction on a single message:
--   - emoji == null            → clear caller's reaction
--   - existing emoji == new    → clear (tap-same = remove, matches RTDB)
--   - otherwise                → set caller's reaction to new emoji
--
-- SECURITY DEFINER so the policy gate (is_group_member) doesn't need to
-- be re-checked on the jsonb update path. We still enforce membership
-- explicitly here against group_meta_data — same trust model as
-- send_group_message (010).
--
-- Returns the updated row so the caller can promote optimistic state
-- to canonical without an extra select.
-- =====================================================================

create or replace function public.toggle_group_reaction(
  p_message_id uuid,
  p_emoji      text default null
) returns public.group_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  caller   text := public.firebase_uid();
  msg_row  public.group_messages;
  existing text;
  updated  public.group_messages;
begin
  if caller is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_message_id is null then
    raise exception 'message_id required' using errcode = '22023';
  end if;

  select * into msg_row
    from public.group_messages
   where id = p_message_id
     and deleted = false;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;

  -- Membership gate. Mirrors is_group_member() but inlined here so the
  -- function can stay SECURITY DEFINER without re-entering RLS.
  if not exists (
    select 1 from public.group_meta_data
     where user_id  = caller
       and group_id = msg_row.group_id
  ) then
    raise exception 'not a group member' using errcode = '42501';
  end if;

  existing := msg_row.reactions ->> caller;

  if p_emoji is null or p_emoji = '' or existing = p_emoji then
    -- Clear caller's reaction.
    update public.group_messages
       set reactions = reactions - caller
     where id = p_message_id
    returning * into updated;
  else
    -- Set / replace caller's reaction.
    update public.group_messages
       set reactions = jsonb_set(coalesce(reactions, '{}'::jsonb),
                                 array[caller],
                                 to_jsonb(p_emoji),
                                 true)
     where id = p_message_id
    returning * into updated;
  end if;

  return updated;
end $$;

grant execute on function public.toggle_group_reaction(uuid, text) to authenticated;
