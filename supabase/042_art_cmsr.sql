-- =====================================================================
-- 042_art_cmsr.sql
-- CMSR becomes two badges with one name: House CMSR (is_cmsr, the
-- original flag, existing holders keep it) and Art CMSR (is_art_cmsr).
-- Same pattern as 014_helper_role.sql: RTDB users/{uid}/isArtCMSR is the
-- source of truth, mirrored here by functions/mirrorUsersToSupabase.js
-- and repaired by functions/reconcileRolesMirror.js. The leaderboard's
-- CMSR tab lists holders of either flag (Code/Supabase/userBackend.js
-- getCmsrRoster).
--
-- Run this BEFORE deploying mirrorUsersToSupabase / reconcileRolesMirror
-- (their upserts name the column) and before shipping the app build.
-- =====================================================================

alter table public.user_roles
  add column if not exists is_art_cmsr boolean not null default false;

-- Sparse partial index, matching trusted / cmsr / helper.
create index if not exists idx_user_roles_art_cmsr
  on public.user_roles (uid) where is_art_cmsr = true;
