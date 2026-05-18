-- =====================================================================
-- 014_helper_role.sql
-- Adds the `is_helper` mod-grantable community role, mirroring the
-- existing is_trusted / is_cmsr pattern. Source-of-truth lives in RTDB
-- (users/{uid}/isHelper) and is mirrored here by the mirrorUsersToSupabase
-- Cloud Function.
-- =====================================================================

alter table public.user_roles
  add column if not exists is_helper boolean not null default false;

-- Sparse partial index — matches the pattern used for trusted/cmsr.
create index if not exists idx_user_roles_helper
  on public.user_roles (uid) where is_helper = true;
