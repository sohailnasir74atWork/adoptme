-- =====================================================================
-- 021_realtime_publication_cleanup.sql — stop paying realtime for
-- tables no client ever subscribes to
-- =====================================================================
-- COST CONTEXT (audit 2026-07-09):
-- Every table in the `supabase_realtime` publication is WAL-decoded by
-- the Realtime server on every write — whether or not anyone subscribes.
-- With REPLICA IDENTITY FULL, every UPDATE also writes the complete old
-- row image into WAL, doubling the decode payload.
--
-- The app's ONLY realtime subscriptions (Code/Supabase/*.js) are:
--   messages, pinned_messages, private_messages, group_messages,
--   chat_meta_data, group_meta_data
-- Those stay untouched.
--
-- Never subscribed by any client — pure decode waste:
--   * All 8 user_* tables (004_users_split.sql:305-347). Written by the
--     mirrorUsersToSupabase CF on EVERY /users/{uid} RTDB write — the
--     hottest write path in the system — so each avatar change, xp bump,
--     counter write etc. was WAL-decoded (full row) for zero deliveries.
--   * message_reactions (schema.sql:201). Client-side reaction realtime
--     was intentionally dropped (chatBackend.js loadReactionsFor polls
--     on page load instead), so every public-chat reaction generated
--     decoded WAL with no subscriber.
--
-- Functional impact: NONE. No client subscribes to any of these tables;
-- reads are plain selects and are unaffected. If reaction realtime is
-- ever reintroduced, re-add message_reactions to the publication and
-- restore replica identity full.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Drop from the realtime publication (idempotent).
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_identity', 'user_roblox', 'user_roles', 'user_cosmetics',
    'user_notifications', 'user_settings', 'user_badges', 'user_blocks',
    'message_reactions'
  ] loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2) Reset replica identity to DEFAULT (primary key only).
-- FULL was only needed so realtime UPDATE payloads carried unchanged
-- columns; with no subscribers it just bloats WAL on every UPDATE.
-- ---------------------------------------------------------------------
alter table public.user_identity      replica identity default;
alter table public.user_roblox        replica identity default;
alter table public.user_roles         replica identity default;
alter table public.user_cosmetics     replica identity default;
alter table public.user_notifications replica identity default;
alter table public.user_settings      replica identity default;
alter table public.user_badges        replica identity default;
alter table public.user_blocks        replica identity default;
alter table public.message_reactions  replica identity default;

-- Verify (should list ONLY: messages, pinned_messages, private_messages,
-- group_messages, chat_meta_data, group_meta_data):
--   select tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' order by tablename;
