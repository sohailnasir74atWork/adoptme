-- =====================================================================
-- 003_chat_metadata.sql
--
-- Mirror of RTDB /chat_meta_data and /group_meta_data into Supabase so
-- the chat list / unread badge listeners can move off RTDB egress.
--
-- Design:
--   * RTDB stays the SOURCE OF TRUTH. Clients keep writing increment(),
--     mute toggles, lastMessage updates straight to RTDB so existing
--     Cloud Functions (notifyNewMessage, notifyGroupMessage) and the
--     /activeChats /activeGroupChats presence flow keep working
--     unchanged, and old app versions don't break.
--   * Cloud Functions mirrorChatMetaToSupabase / mirrorGroupMetaToSupabase
--     trigger on RTDB onWrite and upsert/delete here.
--   * New clients SUBSCRIBE here for the unread/chat-list stream.
--
-- Auth model matches phase 1: Firebase ID token via Third-Party Auth,
-- public.firebase_uid() (defined in schema.sql) reads the UID claim.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. chat_meta_data — one row per (owner, partner) pair, identical
--    grain to RTDB /chat_meta_data/{ownerUid}/{partnerUid}.
-- --------------------------------------------------------------------
create table if not exists public.chat_meta_data (
  owner_uid        text not null,                 -- Firebase UID who owns this row
  partner_uid      text not null,                 -- the other party's Firebase UID
  chat_id          text,                          -- canonical chat id (sorted uids joined with '_')
  last_message     text,
  timestamp_ms     bigint,                        -- ms epoch, mirrors RTDB `timestamp` field
  receiver_id      text,                          -- denormalised; matches RTDB shape
  receiver_name    text,
  receiver_avatar  text,
  unread_count     int  not null default 0,
  muted            boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (owner_uid, partner_uid)
);

-- Listener filters by owner_uid; Supabase realtime needs a btree index
-- to evaluate the filter efficiently on every published row.
create index if not exists idx_chat_meta_owner
  on public.chat_meta_data (owner_uid);

-- --------------------------------------------------------------------
-- 2. group_meta_data — one row per (user, group) pair, identical
--    grain to RTDB /group_meta_data/{userId}/{groupId}.
-- --------------------------------------------------------------------
create table if not exists public.group_meta_data (
  user_id                     text not null,
  group_id                    text not null,
  group_name                  text,
  group_avatar                text,
  last_message                text,
  last_message_timestamp_ms   bigint,
  last_message_sender_id      text,
  last_message_sender_name    text,
  member_count                int,
  created_by                  text,
  unread_count                int  not null default 0,
  muted                       boolean not null default false,
  joined_at_ms                bigint,
  last_read_at_ms             bigint,
  updated_at                  timestamptz not null default now(),
  primary key (user_id, group_id)
);

create index if not exists idx_group_meta_user
  on public.group_meta_data (user_id);

-- =====================================================================
-- Row Level Security
-- =====================================================================
-- Each user can only see rows they own. Writes are SERVICE-ROLE only —
-- the Cloud Function mirror is the only writer.  Service-role bypasses
-- RLS, so we don't add any insert/update/delete policies for end-users.
-- --------------------------------------------------------------------

alter table public.chat_meta_data  enable row level security;
alter table public.group_meta_data enable row level security;

create policy "chat_meta_data read own"
  on public.chat_meta_data for select
  using (owner_uid = public.firebase_uid());

create policy "group_meta_data read own"
  on public.group_meta_data for select
  using (user_id = public.firebase_uid());

-- =====================================================================
-- Realtime publication
-- =====================================================================
-- REPLICA IDENTITY FULL so UPDATE payloads include unchanged columns
-- (the listener derives `muted` and `unread_count` from the same row),
-- and so DELETE filters on non-PK columns keep working.

alter publication supabase_realtime add table public.chat_meta_data;
alter publication supabase_realtime add table public.group_meta_data;

alter table public.chat_meta_data  replica identity full;
alter table public.group_meta_data replica identity full;
