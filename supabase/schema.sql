-- =====================================================================
-- Phase 1 schema: public (global) chat only
-- Maps RTDB paths chat_new / chat_es / ... / pin_messages to Supabase
-- Keeps Firebase UIDs as user identifiers (no Supabase Auth)
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Rooms — one row per language channel
-- --------------------------------------------------------------------
create table if not exists public.rooms (
  id          text primary key,              -- 'public:en', 'public:es', ...
  room_type   text not null check (room_type in ('public')),
  language    text not null,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Seed the 10 language channels (matches CHANNELS array in Trader.jsx)
insert into public.rooms (id, room_type, language, name) values
  ('public:en', 'public', 'en', 'English'),
  ('public:es', 'public', 'es', 'Español'),
  ('public:pt', 'public', 'pt', 'Português'),
  ('public:fr', 'public', 'fr', 'Français'),
  ('public:de', 'public', 'de', 'Deutsch'),
  ('public:tr', 'public', 'tr', 'Türkçe'),
  ('public:ar', 'public', 'ar', 'العربية'),
  ('public:ja', 'public', 'ja', '日本語'),
  ('public:ko', 'public', 'ko', '한국어'),
  ('public:ru', 'public', 'ru', 'Русский')
on conflict (id) do nothing;

-- --------------------------------------------------------------------
-- 2. Messages — single table for all public chat messages
-- Field names mirror the RTDB document in Trader.jsx:720 so client code
-- needs only a transport swap, not a data-model rewrite.
-- --------------------------------------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  room_id         text not null references public.rooms(id) on delete cascade,

  sender_id       text not null,                -- Firebase UID
  sender_name     text not null,

  text            text,
  gif_url         text,
  fruits          jsonb not null default '[]'::jsonb,

  reply_to        jsonb,                        -- { id, text }

  -- Per-message snapshots of sender profile (so old messages keep their display
  -- even if the user changes their avatar later). Matches fields embedded in RTDB.
  sender_profile  jsonb not null default '{}'::jsonb,
    -- keys: avatar, isPro, robloxUsernameVerified, topBadge, hasRecentGameWin,
    --       profileFrame, chatTextColor, chatBubbleBg

  role_flags      jsonb not null default '{}'::jsonb,
    -- keys: isAdmin, isModerator, isBabyMod, isTrusted, isCMSR

  contains_link   boolean not null default false,
  report_count    int     not null default 0,
  strike_count    int,
  country_flag    text,                         -- was 'flage' in RTDB
  os              text,                         -- 'ios' / 'android'

  deleted         boolean not null default false,
  deleted_at      timestamptz,
  deleted_by      text,                         -- Firebase UID of admin/mod

  created_at      timestamptz not null default now()
);

-- Fast pagination: newest-first within a room.
-- `id` is a tiebreaker so cursor pagination never skips/duplicates if two
-- messages share the same created_at (RTDB push keys embedded a tiebreaker
-- via random suffix; Postgres needs us to be explicit).
-- Cursor query shape:
--   select * from messages
--    where room_id = $1 and (created_at, id) < ($2, $3)
--    order by created_at desc, id desc limit $4
create index if not exists idx_messages_room_created
  on public.messages (room_id, created_at desc, id desc);

-- Moderation lookups: find all messages by a user
create index if not exists idx_messages_sender
  on public.messages (sender_id);

-- --------------------------------------------------------------------
-- 3. Reactions — one emoji per user per message
-- RTDB stored /messages/{id}/reactions/{userId}: emoji. Same semantics here.
-- --------------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id  uuid not null references public.messages(id) on delete cascade,
  user_id     text not null,                     -- Firebase UID
  emoji       text not null,
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- --------------------------------------------------------------------
-- 4. Pinned messages — references messages instead of copying content.
-- (RTDB stored full snapshots under /pin_messages. Reference is smaller,
-- always fresh, and simpler to moderate.)
-- --------------------------------------------------------------------
create table if not exists public.pinned_messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     text not null references public.rooms(id) on delete cascade,
  message_id  uuid not null references public.messages(id) on delete cascade,
  pinned_by   text not null,                    -- Firebase UID of admin
  pinned_at   timestamptz not null default now(),
  unique (room_id, message_id)
);

create index if not exists idx_pinned_room
  on public.pinned_messages (room_id, pinned_at desc);

-- =====================================================================
-- Row Level Security
-- =====================================================================
-- Auth model: client sends a Supabase-signed JWT that carries Firebase UID
-- in a custom claim. We build that JWT in a Cloud Function (auth bridge,
-- coming in the next step). Until the bridge is live, firebase_uid() is NULL
-- and all writes fail closed — which is the safe default.
-- --------------------------------------------------------------------

-- Helper: extract Firebase UID from the current JWT.
create or replace function public.firebase_uid() returns text
language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb ->> 'firebase_uid',
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
  );
$$;

alter table public.rooms             enable row level security;
alter table public.messages          enable row level security;
alter table public.message_reactions enable row level security;
alter table public.pinned_messages   enable row level security;

-- --- Rooms: readable by anyone, writable only via service_role
create policy "rooms read all"
  on public.rooms for select
  using (true);

-- --- Messages: everyone reads non-deleted, users write their own
create policy "messages read non-deleted"
  on public.messages for select
  using (deleted = false);

create policy "messages insert own"
  on public.messages for insert
  with check (sender_id = public.firebase_uid());

-- Moderation UPDATE (soft delete + report_count bump) is allowed for any
-- authenticated user. Client UI gates the Delete/Report buttons. Trust
-- model matches the original RTDB setup (rules were permissive, the app
-- enforced admin-only via UI).
create policy "messages update authenticated"
  on public.messages for update
  using (public.firebase_uid() is not null);

-- --- Reactions: everyone reads, users manage their own
create policy "reactions read all"
  on public.message_reactions for select
  using (true);

create policy "reactions insert own"
  on public.message_reactions for insert
  with check (user_id = public.firebase_uid());

create policy "reactions update own"
  on public.message_reactions for update
  using (user_id = public.firebase_uid());

create policy "reactions delete own"
  on public.message_reactions for delete
  using (user_id = public.firebase_uid());

-- --- Pinned: everyone reads; any authenticated user can pin/unpin.
-- Client UI only shows Pin to admins/mods. Risk accepted: someone with
-- a valid account could pin via direct API call, but the damage is tiny
-- (an admin can unpin in seconds).
create policy "pinned read all"
  on public.pinned_messages for select
  using (true);

create policy "pinned insert authenticated"
  on public.pinned_messages for insert
  with check (pinned_by = public.firebase_uid());

create policy "pinned delete authenticated"
  on public.pinned_messages for delete
  using (public.firebase_uid() is not null);

-- =====================================================================
-- Realtime
-- =====================================================================
-- Enable row-level change streams on these tables so clients can subscribe
-- to INSERT / UPDATE / DELETE events like they do with RTDB onValue().
-- --------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.pinned_messages;

-- DELETE events only include the primary key by default, so filters on
-- non-PK columns (like `room_id`) can't match. `REPLICA IDENTITY FULL`
-- tells Postgres to send the full old row with every change, so the
-- `room_id=eq.X` filter keeps working on deletes.
alter table public.pinned_messages replica identity full;
alter table public.messages         replica identity full;
alter table public.message_reactions replica identity full;
