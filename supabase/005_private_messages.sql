-- =====================================================================
-- 005_private_messages.sql — Phase 5 (private message bodies)
--
-- Move /private_messages/{chatId}/messages/{key} off RTDB into Supabase.
--
-- Clean-cut migration (Blox_Fruit pattern): new app builds read AND
-- write here exclusively. Old app builds keep using RTDB and will not
-- see new messages — accepted tradeoff per user direction 2026-05-12.
--
-- Notification flow (Phase 5): the existing notifyNewMessage RTDB
-- onCreate trigger is replaced by an HTTPS endpoint backed by a
-- Supabase Database Webhook on INSERT of this table. See
-- functions/notifyNewMessage.js for the rewrite.
--
-- Trade subtree (/private_messages/{chatId}/trade) is OUT of scope —
-- stays on RTDB.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. private_messages — flat table, one row per message across all
--    1-on-1 conversations. chat_id is the canonical
--    [a,b].sort().join('_') pair id, matching the RTDB convention used
--    in PrivateChat.jsx.
-- ---------------------------------------------------------------------
create table if not exists public.private_messages (
  id              uuid primary key default gen_random_uuid(),

  -- Client-generated UUID for idempotent retries. UNIQUE(chat_id,
  -- client_msg_id) makes retries no-ops. NULLs allowed for backfilled
  -- rows that came from RTDB.
  client_msg_id   uuid,

  -- Original RTDB key, set ONLY by the backfill script so the same RTDB
  -- record never lands twice in Supabase. NULL for new-app sends.
  -- UNIQUE(chat_id, rtdb_key) where not null enforces backfill idempotency.
  rtdb_key        text,

  chat_id         text not null,             -- '[a,b].sort().join("_")'
  sender_id       text not null,             -- Firebase UID
  recipient_id    text not null,             -- the other participant; denormalised for RLS + notification CF lookups

  text            text,                      -- nullable when image-only / fruit-only
  image_url       text,                      -- single image (legacy + first-of-many fallback)
  image_urls      jsonb,                     -- array variant; adoptme stores multi-image like this
  fruits          jsonb not null default '[]'::jsonb,

  -- replyTo: { id, text, senderId, imageUrl, imageUrls, hasFruits, fruitsCount }
  reply_to        jsonb,

  os              text,

  -- Soft delete for moderation. UI filters deleted=false; UPDATE to
  -- deleted=true is how a participant or mod clears a message.
  deleted         boolean not null default false,
  deleted_at      timestamptz,
  deleted_by      text,

  report_count    integer not null default 0,

  created_at      timestamptz not null default now()
);

-- Pagination + realtime filter index.
create index if not exists idx_private_messages_chat_created
  on public.private_messages (chat_id, created_at desc, id desc);

-- Idempotency: same (chat, client_msg_id) collapses to one row.
create unique index if not exists idx_private_messages_chat_client_msg_id
  on public.private_messages (chat_id, client_msg_id)
  where client_msg_id is not null;

-- Backfill idempotency: same (chat, rtdb_key) collapses on re-run.
create unique index if not exists idx_private_messages_chat_rtdb_key
  on public.private_messages (chat_id, rtdb_key)
  where rtdb_key is not null;

-- Active-only partial; almost every read filters deleted=false.
create index if not exists idx_private_messages_chat_active
  on public.private_messages (chat_id, created_at desc, id desc)
  where deleted = false;

create index if not exists idx_private_messages_sender    on public.private_messages (sender_id);
create index if not exists idx_private_messages_recipient on public.private_messages (recipient_id);


-- =====================================================================
-- Row Level Security
-- =====================================================================
-- 1-on-1 message: only the two participants can read; only the sender
-- can insert their own message; either side can soft-delete via UPDATE;
-- either side can DELETE (rare — moderation route is soft-delete).
-- Service role (backfill script) bypasses RLS.
-- =====================================================================
alter table public.private_messages enable row level security;

drop policy if exists "private_messages select by participant" on public.private_messages;
create policy "private_messages select by participant"
  on public.private_messages for select
  using (public.firebase_uid() in (sender_id, recipient_id));

drop policy if exists "private_messages insert own" on public.private_messages;
create policy "private_messages insert own"
  on public.private_messages for insert
  with check (sender_id = public.firebase_uid());

drop policy if exists "private_messages update by participant" on public.private_messages;
create policy "private_messages update by participant"
  on public.private_messages for update
  using (public.firebase_uid() in (sender_id, recipient_id))
  with check (public.firebase_uid() in (sender_id, recipient_id));

drop policy if exists "private_messages delete by participant" on public.private_messages;
create policy "private_messages delete by participant"
  on public.private_messages for delete
  using (public.firebase_uid() in (sender_id, recipient_id));


-- =====================================================================
-- Realtime publication
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename  = 'private_messages'
  ) then
    alter publication supabase_realtime add table public.private_messages;
  end if;
end $$;

alter table public.private_messages replica identity full;


-- =====================================================================
-- Autovacuum tuning
-- =====================================================================
-- High-write table with soft-deletes — same aggressive threshold we
-- learned to use on chat_meta_data after the 2026-05-05 dead-tuple
-- incident. Vacuum at 1% dead rows instead of the default 20%.
alter table public.private_messages set (
  autovacuum_vacuum_scale_factor  = 0.01,
  autovacuum_analyze_scale_factor = 0.05
);
