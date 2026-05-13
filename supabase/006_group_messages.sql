-- =====================================================================
-- 006_group_messages.sql — Phase 5 (group message bodies)
--
-- Move /group_messages/{groupId}/messages/{key} off RTDB into Supabase.
-- Symmetric to 005_private_messages but keyed on group_id; recipient is
-- the group (membership-gated read) rather than a single user.
--
-- Clean-cut migration. Old app builds keep using RTDB and will not see
-- new messages (accepted tradeoff per user direction 2026-05-12).
--
-- Notification flow: existing notifyGroupMessage RTDB trigger is
-- replaced by an HTTPS endpoint backed by a Supabase Database Webhook
-- on INSERT of this table. See functions/notifyGroupMessage.js.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. group_messages — flat table, one row per message across all groups.
-- ---------------------------------------------------------------------
create table if not exists public.group_messages (
  id              uuid primary key default gen_random_uuid(),

  -- Client idempotency key — same retry-safe pattern as private_messages.
  client_msg_id   uuid,

  -- Backfill-only key. UNIQUE(group_id, rtdb_key) makes backfill re-runs
  -- no-ops.
  rtdb_key        text,

  group_id        text not null,
  sender_id       text not null,

  text            text,
  image_url       text,
  image_urls      jsonb,                     -- array variant for multi-image
  fruits          jsonb not null default '[]'::jsonb,

  -- replyTo shape mirrors what GroupChatScreen.jsx writes to RTDB
  reply_to        jsonb,

  -- Sender profile snapshot at send time. Matches the messageData
  -- payload built in GroupChatScreen.jsx — group UI reads these inline
  -- rather than via profileCache so the message keeps its at-the-time
  -- display even after profile changes.
  sender_name              text,             -- 'sender' field in RTDB messageData
  sender_avatar            text,             -- 'avatar'
  is_pro                   boolean,
  roblox_username_verified boolean,
  has_recent_game_win      boolean,
  last_game_win_at         bigint,
  is_creator               boolean,

  os              text,

  deleted         boolean not null default false,
  deleted_at      timestamptz,
  deleted_by      text,

  report_count    integer not null default 0,

  created_at      timestamptz not null default now()
);

-- Pagination + realtime filter
create index if not exists idx_group_messages_group_created
  on public.group_messages (group_id, created_at desc, id desc);

-- Client idempotency
create unique index if not exists idx_group_messages_group_client_msg_id
  on public.group_messages (group_id, client_msg_id)
  where client_msg_id is not null;

-- Backfill idempotency
create unique index if not exists idx_group_messages_group_rtdb_key
  on public.group_messages (group_id, rtdb_key)
  where rtdb_key is not null;

create index if not exists idx_group_messages_group_active
  on public.group_messages (group_id, created_at desc, id desc)
  where deleted = false;

create index if not exists idx_group_messages_sender on public.group_messages (sender_id);


-- =====================================================================
-- Membership helper
-- =====================================================================
-- SECURITY DEFINER function: returns true iff the caller (Firebase UID
-- from JWT) is a member of the group. Derived from group_meta_data,
-- which already has one row per (user_id, group_id) and is kept fresh
-- by mirrorGroupMetaToSupabase (for the old-app write trickle) and by
-- the send_group_message RPC (for new-app sends, see 010_send_group_message).
-- Bypasses RLS so the policy check is cheap.
-- =====================================================================
create or replace function public.is_group_member(p_group_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.group_meta_data g
     where g.user_id  = public.firebase_uid()
       and g.group_id = p_group_id
  );
$$;

grant execute on function public.is_group_member(text) to authenticated, anon;


-- =====================================================================
-- Row Level Security
-- =====================================================================
-- - SELECT: any group member reads every message in their group.
-- - INSERT: caller must be a member AND sender_id must match caller.
-- - UPDATE: any member (covers soft-delete by participant + report
--   counter bumps; admin-tier permission is gated client-side today,
--   matching the existing RTDB rules model).
-- - DELETE: only the sender (rare — soft-delete is the standard path).
-- Service role (backfill script) bypasses RLS.
-- =====================================================================
alter table public.group_messages enable row level security;

drop policy if exists "group_messages select by member" on public.group_messages;
create policy "group_messages select by member"
  on public.group_messages for select
  using (public.is_group_member(group_id));

drop policy if exists "group_messages insert by sender member" on public.group_messages;
create policy "group_messages insert by sender member"
  on public.group_messages for insert
  with check (
        sender_id = public.firebase_uid()
    and public.is_group_member(group_id)
  );

drop policy if exists "group_messages update by member" on public.group_messages;
create policy "group_messages update by member"
  on public.group_messages for update
  using (public.is_group_member(group_id))
  with check (public.is_group_member(group_id));

drop policy if exists "group_messages delete by sender" on public.group_messages;
create policy "group_messages delete by sender"
  on public.group_messages for delete
  using (sender_id = public.firebase_uid());


-- =====================================================================
-- Realtime publication
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'group_messages'
  ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;
end $$;

alter table public.group_messages replica identity full;


-- =====================================================================
-- Autovacuum tuning (same aggressive threshold as chat_meta_data)
-- =====================================================================
alter table public.group_messages set (
  autovacuum_vacuum_scale_factor  = 0.01,
  autovacuum_analyze_scale_factor = 0.05
);
