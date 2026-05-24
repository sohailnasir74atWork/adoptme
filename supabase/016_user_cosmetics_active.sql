-- =====================================================================
-- 016_user_cosmetics_active.sql
--
-- Add active shop cosmetics to user_cosmetics so the chat render path
-- can read frame/bubble/text-color/banner from Supabase instead of
-- /users/{uid}/shop/activeItems on RTDB.
--
-- WHY:
--   Bandwidth profile shows /users/{uid}/shop/activeItems at ~298 MB/day
--   download (#1 RTDB cost) because every chat avatar + message render
--   pulls the active shop subtree for every distinct sender seen.
--   profileCache mitigates with a 30-min MMKV TTL but cold misses
--   (every fresh user a session encounters) still hit RTDB.
--
-- DESIGN:
--   RTDB stays the SOURCE OF TRUTH for shop/activeItems writes (the
--   purchase/activate/deactivate flows in Code/Engagement/shopUtils.js
--   still go to RTDB). mirrorUsersToSupabase tails those writes and
--   upserts here. Clients read here for chat rendering of OTHER users'
--   cosmetics; the current user keeps reading RTDB via cosmeticsCache
--   so activation is instant (no mirror-CF round-trip).
--
-- COLUMN SHAPE:
--   Each cosmetic field is jsonb because shop items have an
--   { expiresAt: number | -1, ...item-specific... } shape that varies
--   per type. profileCache already treats them as opaque objects.
-- =====================================================================

alter table public.user_cosmetics
  add column if not exists profile_frame    jsonb,
  add column if not exists chat_text_color  jsonb,
  add column if not exists trade_card_bg    jsonb,
  add column if not exists profile_banner   jsonb,
  add column if not exists chat_bubble_bg   jsonb;

-- RLS unchanged — `user_cosmetics readable by any authed user` already
-- covers these columns (no per-column policies in Postgres).
