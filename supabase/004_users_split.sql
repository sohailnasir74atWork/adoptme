-- =====================================================================
-- 004_users_split.sql
--
-- Split mirror of RTDB /users/{uid} into purpose-scoped Supabase tables.
-- Goal: take the ~4.38 MB / 1,687-read /users full-fetch hot path off
-- RTDB by giving clients narrow tables to read from instead.
--
-- Design (same pattern as 003_chat_metadata):
--   * RTDB stays the SOURCE OF TRUTH for /users. The app keeps writing
--     to /users/{uid} unchanged, so all 14 Cloud Functions that read
--     /users keep working, all 7 RTDB-trigger CFs (syncModRole_*,
--     syncBadgeRoster, syncModRoster, syncRosterMaintenance,
--     syncModUsersToRTDB) keep firing, and old app versions on the
--     store keep working forever.
--   * mirrorUsersToSupabase CF (NEW, separate file) tails RTDB writes
--     and upserts/deletes the relevant rows here.
--   * New clients SUBSCRIBE / READ here for profile data.
--
-- THIS PHASE IS DELIBERATELY NARROW:
--   * Out of scope: shop.{activeItems,inventory,ownedItems,stats},
--     economy (rewardPoints, xp, dailyStars, levelRewards),
--     game state (lastGameWinAt, hasRecentGameWin, isPlaying, OS).
--     Those stay on RTDB; future phase migrates them.
--   * Out of scope (but lives in /users): fcmToken stays on RTDB
--     because every notification CF reads it directly. Migrating it
--     would silence pushes — Phase 3 deals with notifications.
--
-- DELIBERATE NAMING CHANGES (mirror CF translates RTDB→Supabase):
--   * RTDB `admin`   → Supabase `is_admin`   (canonicalize)
--   * RTDB `flage`   → Supabase `flag`       (typo fix)
--   * RTDB `userName`→ DROPPED (dead field, no readers)
--   * Everything else: snake_case in Supabase, camelCase in RTDB,
--     mirror translates both directions.
--
-- Auth model (unchanged from phases 1+2):
--   Firebase ID token via Third-Party Auth → public.firebase_uid()
--   helper (defined in schema.sql) extracts the UID claim.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. user_identity
--    Hot read path: chat headers, profile drawer, message attribution.
--    Written rarely (sign-up + occasional profile edit).
-- ---------------------------------------------------------------------
create table if not exists public.user_identity (
  uid                   text primary key,
  display_name          text,
  avatar                text,                 -- avatar URL
  email                 text,
  decoded_email         text,                 -- email with '.' restored from RTDB encoding
  flag                  text,                 -- country flag (was RTDB `flage`)
  date_of_birth         text,                 -- stored as string in RTDB; preserve shape
  os                    text,                 -- 'ios' | 'android' (set on sign-in)
  created_at_ms         bigint,               -- ms epoch from RTDB createdAt
  last_activity_ms      bigint,               -- ms epoch
  last_profile_edit_ms  bigint,               -- ms epoch
  updated_at            timestamptz not null default now()
);

-- displayName / avatar lookups by uid are the dominant read; pkey covers it.
-- Add a btree on display_name for the existing chat search by name.
create index if not exists idx_user_identity_display_name
  on public.user_identity (display_name);


-- ---------------------------------------------------------------------
-- 2. user_roblox
--    Read in chat drawer (BottomDrawer, OnlineUsersList, PrivateChatHeader).
--
--    NOTE: Originally we added a partial unique index on
--    (lower(roblox_username)) WHERE verified = true. Production RTDB has
--    multiple verified users sharing the same Roblox username (legacy
--    bug or bypassed verification), so the constraint blocked the
--    backfill. The index has been dropped to match RTDB's behaviour.
--    Re-add it later only after de-duplicating the conflicting rows —
--    see migration notes for the cleanup query.
-- ---------------------------------------------------------------------
create table if not exists public.user_roblox (
  uid                          text primary key,
  roblox_username              text,
  roblox_user_id               text,        -- string in RTDB; preserve
  roblox_username_verified     boolean not null default false,
  updated_at                   timestamptz not null default now()
);

-- Defensively drop the legacy verified-uniqueness index in case it was
-- created by an earlier version of this migration before we discovered
-- the production duplicates.
drop index if exists public.idx_user_roblox_verified_unique;


-- ---------------------------------------------------------------------
-- 3. user_roles
--    Boolean role flags. RTDB-trigger CFs (syncModRole_Moderator,
--    syncBadgeRoster) write the source-of-truth fields; mirror CF
--    propagates here. Clients READ these for chat badge rendering and
--    permission gates.
--
--    Note: `is_admin` here mirrors RTDB `users/{uid}/admin` (NOT the
--    broken `users/{uid}/isAdmin` direct read in OnlineUsersList:146,
--    which returns null for everyone — that path is dead).
-- ---------------------------------------------------------------------
create table if not exists public.user_roles (
  uid               text primary key,
  is_admin          boolean not null default false,    -- mirrors RTDB `admin`
  is_moderator      boolean not null default false,
  is_baby_mod       boolean not null default false,
  is_trusted        boolean not null default false,
  is_cmsr           boolean not null default false,
  updated_at        timestamptz not null default now()
);

-- "Who has role X" queries (mod roster, trusted user lists). Sparse
-- partial indexes — only index rows where the flag is true so we don't
-- waste space on the 99% of users who have no role.
create index if not exists idx_user_roles_moderators
  on public.user_roles (uid) where is_moderator = true;
create index if not exists idx_user_roles_trusted
  on public.user_roles (uid) where is_trusted = true;
create index if not exists idx_user_roles_cmsr
  on public.user_roles (uid) where is_cmsr = true;
create index if not exists idx_user_roles_admin
  on public.user_roles (uid) where is_admin = true;


-- ---------------------------------------------------------------------
-- 4. user_cosmetics
--    Display-time cosmetic state read by every chat message render.
--    NOTE: profile frame data lives in /users/{uid}/shop/activeItems/profileFrame
--    on RTDB and stays there this phase (shop subtree deferred).
--    Existing readers continue reading shop directly from RTDB.
-- ---------------------------------------------------------------------
create table if not exists public.user_cosmetics (
  uid             text primary key,
  top_badge       text,
  is_pro          boolean not null default false,
  updated_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 5. user_notifications
--    fcmToken stays on RTDB this phase (notification CFs depend on it
--    being there). The other fields move; CFs that need them will
--    eventually read from here in Phase 3, but for now both paths
--    coexist via mirror.
--
--    notification_settings is JSONB because new push types add new
--    keys regularly — flat columns would mean a migration per toggle.
-- ---------------------------------------------------------------------
create table if not exists public.user_notifications (
  uid                       text primary key,
  -- fcm_token deliberately omitted this phase. Add in Phase 3.
  is_token_invalid          boolean not null default false,
  mute_trade_notifs         boolean not null default false,
  notification_settings     jsonb,             -- { notifyMessages, notifyGroupMessages, ... }
  updated_at                timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 6. user_settings
--    Reminder + future user-controlled toggles. Read by the reminder
--    background flow.
-- ---------------------------------------------------------------------
create table if not exists public.user_settings (
  uid                              text primary key,
  is_reminder_enabled              boolean not null default false,
  is_selected_reminder_enabled     boolean not null default false,
  updated_at                       timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 7. user_badges
--    Relational so "who has badge X" leaderboard queries are cheap.
--    Each row = one earned badge. metadata holds badge-specific extras
--    (e.g. tier, count) without forcing a column per badge type.
-- ---------------------------------------------------------------------
create table if not exists public.user_badges (
  uid           text not null,
  badge_id      text not null,
  earned_at_ms  bigint,                       -- ms epoch
  metadata      jsonb,                        -- badge-specific extras
  primary key (uid, badge_id)
);

-- Leaderboard / showcase: "show me everyone with badge X".
create index if not exists idx_user_badges_by_badge
  on public.user_badges (badge_id);


-- ---------------------------------------------------------------------
-- 8. user_blocks
--    (uid, blocked_uid) pairs. Replaces RTDB
--    /users/{uid}/blocked_users/{blockedUid} = true. blocked_at gives
--    us "recently blocked" sort if we ever want it.
-- ---------------------------------------------------------------------
create table if not exists public.user_blocks (
  uid             text not null,           -- the blocker
  blocked_uid     text not null,           -- the blocked
  blocked_at_ms   bigint,
  primary key (uid, blocked_uid)
);

-- "Am I blocked by user X?" — needed by chat send guards.
create index if not exists idx_user_blocks_by_blocked
  on public.user_blocks (blocked_uid);


-- =====================================================================
-- Row Level Security
-- =====================================================================
-- Read access mirrors what RTDB rules expose today (see PRESENCE_RULES.json
-- `users` block: `.read: true` at parent — every authenticated user can
-- read every user's basic profile fields). We MATCH that for identity /
-- roblox / roles / cosmetics / badges so chat rendering doesn't break.
--
-- Tighter scope on settings + notifications: those are personal and
-- nobody else needs them. Match the spirit of how today's app uses them
-- (only the owning uid reads).
--
-- Blocks: only the blocker reads their own list; service role handles
-- the symmetric "am I blocked by X?" check via a SECURITY DEFINER RPC
-- if we add one later — simpler for now to gate at owner.
--
-- ALL WRITES are service-role only (mirror CF). No client-write policies.
-- Service role bypasses RLS so no insert/update/delete policies needed.
-- =====================================================================

alter table public.user_identity      enable row level security;
alter table public.user_roblox        enable row level security;
alter table public.user_roles         enable row level security;
alter table public.user_cosmetics     enable row level security;
alter table public.user_notifications enable row level security;
alter table public.user_settings      enable row level security;
alter table public.user_badges        enable row level security;
alter table public.user_blocks        enable row level security;

-- Public-readable (matches RTDB `.read: true` at users root).
create policy "user_identity readable by any authed user"
  on public.user_identity for select
  using (auth.role() = 'authenticated' or public.firebase_uid() is not null);

create policy "user_roblox readable by any authed user"
  on public.user_roblox for select
  using (auth.role() = 'authenticated' or public.firebase_uid() is not null);

create policy "user_roles readable by any authed user"
  on public.user_roles for select
  using (auth.role() = 'authenticated' or public.firebase_uid() is not null);

create policy "user_cosmetics readable by any authed user"
  on public.user_cosmetics for select
  using (auth.role() = 'authenticated' or public.firebase_uid() is not null);

create policy "user_badges readable by any authed user"
  on public.user_badges for select
  using (auth.role() = 'authenticated' or public.firebase_uid() is not null);

-- Owner-only (personal data).
create policy "user_settings readable by owner"
  on public.user_settings for select
  using (uid = public.firebase_uid());

create policy "user_notifications readable by owner"
  on public.user_notifications for select
  using (uid = public.firebase_uid());

create policy "user_blocks readable by owner"
  on public.user_blocks for select
  using (uid = public.firebase_uid());


-- =====================================================================
-- Realtime publication
-- =====================================================================
-- Clients subscribe to changes on identity / roles / cosmetics / badges
-- so chat re-renders when someone changes display name, claims a new
-- badge, etc. Settings/notifications are owner-read; we still publish
-- them so a user's other devices stay in sync.
--
-- Replica identity FULL is needed so the realtime payload contains the
-- old row on UPDATE/DELETE (otherwise the listener can't reconcile).
-- =====================================================================

alter table public.user_identity      replica identity full;
alter table public.user_roblox        replica identity full;
alter table public.user_roles         replica identity full;
alter table public.user_cosmetics     replica identity full;
alter table public.user_notifications replica identity full;
alter table public.user_settings      replica identity full;
alter table public.user_badges        replica identity full;
alter table public.user_blocks        replica identity full;

-- supabase_realtime is the publication Supabase Realtime listens on.
-- Wrap each add in a DO block so re-running this file is idempotent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_identity'
  ) then
    alter publication supabase_realtime add table public.user_identity;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_roblox'
  ) then
    alter publication supabase_realtime add table public.user_roblox;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_roles'
  ) then
    alter publication supabase_realtime add table public.user_roles;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_cosmetics'
  ) then
    alter publication supabase_realtime add table public.user_cosmetics;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_notifications'
  ) then
    alter publication supabase_realtime add table public.user_notifications;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_settings'
  ) then
    alter publication supabase_realtime add table public.user_settings;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_badges'
  ) then
    alter publication supabase_realtime add table public.user_badges;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_blocks'
  ) then
    alter publication supabase_realtime add table public.user_blocks;
  end if;
end $$;
