-- =====================================================================
-- 039 — Staff helpers never return NULL (adoptme, kvtbtzhtcaanhjblyick),
--       2026-10-02
--
-- BUG: is_mod_staff() (029) and is_staff() (020) are
--   exists(user_roles ...) OR lower(jwt email) IN (owner list)
-- A token with no `email` claim makes the IN NULL, so for a non-staff
-- caller the whole OR is `false OR NULL` = NULL, not false.
--
-- 029's four read RPCs gate with `if not public.is_mod_staff() then raise`.
-- `not NULL` is NULL, so the raise is skipped and the caller gets the
-- moderation log, target emails included:
--   mod_actions_for_user, mod_action_counts_for_user,
--   mod_leaderboard, mod_actions_recent
-- Who has no email claim: anon-key requests (live grants these RPCs to
-- anon through Supabase's default privileges) and signed-in accounts
-- without an email (1,749 of 168,752 identities on 2026-10-02).
--
-- FIX: wrap both bodies in coalesce(..., false), the form 038 already
-- uses in _staff_is_admin(). Signature, SECURITY DEFINER, STABLE,
-- search_path and the owner list are unchanged, and CREATE OR REPLACE
-- keeps the existing owner and grants.
--
-- No other caller changes behaviour: RLS USING / WITH CHECK and the
-- user_identity view's CASE already treat NULL as "no", the same as false.
-- Only the `if not` gates relied on a value NULL can't give.
--
-- ⚠️ The email list must stay in sync with GlobelStats.js,
--    _require_admin() (024) and _staff_is_admin() (038).
-- =====================================================================

create or replace function public.is_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    exists (
      select 1
        from public.user_roles
       where uid = public.firebase_uid()
         and (is_admin = true or is_moderator = true)
    )
    or lower(current_setting('request.jwt.claims', true)::jsonb ->> 'email') in (
      'thesolanalabs@gmail.com',
      'sohailnasir74business@gmail.com',
      'sohailnasir74@gmail.com'
    ),
    false);
$$;

create or replace function public.is_mod_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    exists (
      select 1
        from public.user_roles
       where uid = public.firebase_uid()
         and (is_admin = true or is_moderator = true or is_baby_mod = true)
    )
    or lower(current_setting('request.jwt.claims', true)::jsonb ->> 'email') in (
      'thesolanalabs@gmail.com',
      'sohailnasir74business@gmail.com',
      'sohailnasir74@gmail.com'
    ),
    false);
$$;
