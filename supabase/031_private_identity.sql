-- =====================================================================
-- 031_private_identity.sql — emails and dates of birth stop being public
--
-- PROBLEM
-- user_identity's only policy (004) lets ANY signed-in user select every
-- row, and every client does `select('*')` on it — so any account could list
-- every user's email, decoded_email and date_of_birth. A column REVOKE would
-- break every shipped build (a `select *` touching a revoked column fails
-- the whole query), so the table cannot simply be locked down in place.
--
-- FIX
--   * rename the table to user_identity_base (policies, indexes, grants,
--     RLS, the pkey and every row move with it) and take it away from
--     anon / authenticated entirely;
--   * put a VIEW named user_identity in its place with the same columns in
--     the same order, in which email / decoded_email / date_of_birth are NULL
--     unless the row is the caller's own or the caller is staff;
--   * repoint every function that reads or writes the table by name
--     (set_last_activity from 018, safe_chat_required from 028) to the base
--     table — otherwise the safe-chat trigger would read masked DOBs and stop
--     protecting children;
--   * add safe_chat_mode(), so the chat screen can still learn whether its
--     partner is under 13 without being able to read the partner's DOB.
--
-- WHY THE VIEW IS OWNER-RIGHTS, NOT security_invoker
-- A security_invoker view checks privileges on user_identity_base as the
-- CALLER. That means granting anon/authenticated SELECT on the base table —
-- and then `from('user_identity_base').select('email')` returns every email
-- again, because RLS filters rows, not columns. Revoking the three columns
-- from the base table instead makes the invoker view itself fail. So this
-- view runs with its owner's rights (the default), the base table is
-- unreachable from the API, and the view carries the old RLS predicate in its
-- own WHERE clause. security_barrier keeps caller-supplied filters from being
-- evaluated ahead of that WHERE. Supabase's linter will flag it as a
-- "security definer view"; that is expected here.
--
-- WHO COUNTS AS STAFF
-- public.is_mod_staff() from 029: user_roles.is_admin / is_moderator /
-- is_baby_mod, or the founder email allowlist. It is deliberately NOT
-- public.is_staff() (020): that one is admin + moderator only and gates
-- group_messages, so widening it would change who reads group chats.
-- user_roles has no senior-mod column; RTDB's isSeniorMod and jmd_granters
-- grant users_private access but not this.
--
-- CLIENT IMPACT (PostgREST features used on user_identity — checked in the
-- app Code/Supabase/userBackend.js, the website src/lib/supabase/userBackend.ts,
-- and every functions/ + scripts/ caller):
--   * select('*') / column lists, .eq('uid'), .in('uid'), .ilike('display_name'),
--     .maybeSingle(), .limit(): unchanged.
--   * .eq('email' | 'decoded_email', x) (searchIdentityByEmail): now matches
--     nothing for non-staff — intended. Staff keep working.
--   * Embedded selects (`user_identity(...)`): none exist.
--   * Realtime: none — 021 already removed the table from the publication.
--   * Client writes: none (the table never had a write policy).
--   * Server writes: mirrorUsersToSupabase / mirrorUsersPrivateToSupabase and
--     scripts/backfill-users-to-supabase.js write user_identity_base. The
--     deployed pre-031 mirror upserts `user_identity` INCLUDING the three
--     masked columns and would fail against the view — deploy the new
--     functions/mirrorUsersToSupabase.js FIRST (it falls back to the old name
--     until this runs), then run this file.
--
-- HOW TO RUN
--   STEP 0 is read-only: run it first and read the output.
--   STEP 1 is ONE transaction. It takes a brief AccessExclusiveLock on
--   user_identity (reads queue for the few milliseconds the rename takes);
--   lock_timeout makes it fail cleanly instead of queueing behind a long
--   transaction. It never waits on private_messages, so it cannot deadlock
--   with the safe-chat trigger the way 028 once did. Safe to re-run: every
--   statement is guarded or idempotent.
--   ROLLBACK is at the bottom.
-- =====================================================================


-- =====================================================================
-- STEP 0 — Read-only. Where am I?
-- =====================================================================
select
  (select relkind from pg_class where oid = to_regclass('public.user_identity'))      as user_identity_kind,   -- 'r' before, 'v' after
  (select relkind from pg_class where oid = to_regclass('public.user_identity_base')) as base_kind,            -- null before, 'r' after
  to_regprocedure('public.is_mod_staff()') is not null                                 as has_is_mod_staff,     -- must be true (029)
  to_regprocedure('public.safe_chat_mode(text)') is not null                           as has_safe_chat_mode;

-- Columns of the live table, in order. Must be exactly the 12 the view
-- below lists; STEP 1 refuses to run otherwise.
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name in ('user_identity', 'user_identity_base')
 order by table_name, ordinal_position;

-- Every function whose body names the table. Expected: set_last_activity and
-- safe_chat_required (both replaced below). Anything else must be repointed
-- by hand before STEP 1.
select p.oid::regprocedure as fn
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosrc ilike '%user_identity%';

-- Views / materialized views built on the table. They follow the rename by
-- OID and would keep reading UNMASKED columns. Expected: none.
select distinct dv.oid::regclass as dependent_view
  from pg_depend d
  join pg_rewrite r on r.oid = d.objid
  join pg_class dv on dv.oid = r.ev_class
 where d.refobjid in (to_regclass('public.user_identity'), to_regclass('public.user_identity_base'))
   and dv.oid is distinct from to_regclass('public.user_identity')::oid
   and dv.oid is distinct from to_regclass('public.user_identity_base')::oid;


-- =====================================================================
-- STEP 1 — the switch. One transaction.
-- =====================================================================
begin;
set local lock_timeout = '5s';

do $$
declare
  v_unknown text;
begin
  if to_regprocedure('public.is_mod_staff()') is null then
    raise exception '031: public.is_mod_staff() is missing — apply 029_mod_actions.sql first';
  end if;

  -- Rename once. A re-run finds the base table already in place.
  if to_regclass('public.user_identity_base') is null then
    select string_agg(column_name::text, ', ') into v_unknown
      from information_schema.columns
     where table_schema = 'public' and table_name = 'user_identity'
       and column_name not in ('uid', 'display_name', 'avatar', 'email', 'decoded_email', 'flag',
                               'date_of_birth', 'os', 'created_at_ms', 'last_activity_ms',
                               'last_profile_edit_ms', 'updated_at');
    if v_unknown is not null then
      raise exception '031: user_identity has columns the view does not list: % — add them to the view first', v_unknown;
    end if;

    alter table public.user_identity rename to user_identity_base;
  end if;
end
$$;

-- The API never touches the base table again; only service_role (the mirror
-- functions, scripts) and SECURITY DEFINER functions do.
revoke all on table public.user_identity_base from anon, authenticated;

create or replace view public.user_identity
with (security_barrier = true)
as
select
  b.uid,
  b.display_name,
  b.avatar,
  case when b.uid = (select public.firebase_uid())
         or (select public.is_mod_staff())
         or (select auth.role()) = 'service_role'
       then b.email end                                       as email,
  case when b.uid = (select public.firebase_uid())
         or (select public.is_mod_staff())
         or (select auth.role()) = 'service_role'
       then b.decoded_email end                               as decoded_email,
  b.flag,
  case when b.uid = (select public.firebase_uid())
         or (select public.is_mod_staff())
         or (select auth.role()) = 'service_role'
       then b.date_of_birth end                               as date_of_birth,
  b.os,
  b.created_at_ms,
  b.last_activity_ms,
  b.last_profile_edit_ms,
  b.updated_at
from public.user_identity_base b
-- The 004 policy, carried over: owner-rights views bypass the base table's
-- RLS, so the row filter has to live here. service_role saw every row
-- before (BYPASSRLS) and still does.
where (select auth.role()) in ('authenticated', 'service_role')
   or (select public.firebase_uid()) is not null;

comment on view public.user_identity is
  'Read-only face of user_identity_base (031). email / decoded_email / date_of_birth are NULL unless the row is the caller''s own or the caller is staff (is_mod_staff).';

-- Supabase's default privileges hand ALL on a new view to anon /
-- authenticated. This view is auto-updatable and runs as its owner, so a
-- client UPDATE through it would bypass the base table's RLS. Select only.
revoke all on table public.user_identity from public, anon, authenticated, service_role;
grant select on table public.user_identity to anon, authenticated, service_role;


-- 018's heartbeat, repointed at the base table. Same body otherwise.
-- CREATE OR REPLACE keeps the existing grants.
create or replace function public.set_last_activity()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me     text;
  now_ms bigint;
begin
  me := public.firebase_uid();
  if me is null then return null; end if;

  now_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;

  -- INSERT-ON-CONFLICT in case a brand-new user beats the mirror CF to
  -- the first identity row. UPDATE-only would silently no-op and
  -- they'd never appear in active-cohort queries until another /users
  -- write fired.
  insert into public.user_identity_base (uid, last_activity_ms, updated_at)
  values (me, now_ms, now())
  on conflict (uid) do update
    set last_activity_ms = excluded.last_activity_ms,
        updated_at       = excluded.updated_at;

  return now_ms;
end;
$$;


-- 028's age check, repointed at the base table. Through the view it would
-- see only the SENDER's own DOB, and a message from an adult to a child would
-- pass as unrestricted. Same body otherwise; CREATE OR REPLACE keeps the
-- 028 revokes (no client can call it directly).
create or replace function public.safe_chat_required(p_uid_a text, p_uid_b text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select bool_or(public.dob_age_years(i.date_of_birth) < public.safe_chat_minor_age())
       from public.user_identity_base i
      where i.uid in (p_uid_a, p_uid_b)),
    false);
$$;


-- Safe-chat mode for the caller's thread with p_partner:
--   'both' | 'me' | 'them' | NULL (unrestricted, or not signed in)
-- The app's chat screen used to read the partner's users/{uid}/dateOfBirth to
-- decide whether to show the template keyboard. That DOB is private now; this
-- answers the same question from both DOBs server-side and returns nothing
-- the screen doesn't already show. The enforcement is still the 028 trigger.
create or replace function public.safe_chat_mode(p_partner text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select
      coalesce((select public.dob_age_years(b.date_of_birth) < public.safe_chat_minor_age()
                  from public.user_identity_base b
                 where b.uid = public.firebase_uid()), false) as me_minor,
      coalesce((select public.dob_age_years(b.date_of_birth) < public.safe_chat_minor_age()
                  from public.user_identity_base b
                 where b.uid = p_partner), false)             as them_minor
  )
  select case
           when public.firebase_uid() is null then null
           when me_minor and them_minor       then 'both'
           when me_minor                      then 'me'
           when them_minor                    then 'them'
         end
    from a;
$$;

revoke all on function public.safe_chat_mode(text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.safe_chat_mode(text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.safe_chat_mode(text) to authenticated;
  end if;
end
$$;

commit;


-- =====================================================================
-- VERIFY (read-only, after STEP 1)
--   select relkind from pg_class where oid = 'public.user_identity'::regclass;       -- 'v'
--   select has_table_privilege('authenticated', 'public.user_identity_base', 'select'); -- false
--   select has_table_privilege('authenticated', 'public.user_identity', 'update');      -- false
--   -- As a signed-in non-staff user (API): email / decoded_email / date_of_birth
--   -- null on every row but your own; from('user_identity_base') → permission denied.
-- =====================================================================


-- =====================================================================
-- ROLLBACK — one transaction. The new mirror functions fall back to the
-- `user_identity` name on their own once the base table is gone.
--
-- begin;
-- set local lock_timeout = '5s';
-- drop function if exists public.safe_chat_mode(text);
-- drop view if exists public.user_identity;
-- alter table public.user_identity_base rename to user_identity;
-- grant all on table public.user_identity to anon, authenticated, service_role;   -- Supabase defaults; RLS (004 policy) still applies
-- create or replace function public.set_last_activity()
-- returns bigint language plpgsql security definer set search_path = public as $$
-- declare me text; now_ms bigint;
-- begin
--   me := public.firebase_uid();
--   if me is null then return null; end if;
--   now_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
--   insert into public.user_identity (uid, last_activity_ms, updated_at)
--   values (me, now_ms, now())
--   on conflict (uid) do update
--     set last_activity_ms = excluded.last_activity_ms, updated_at = excluded.updated_at;
--   return now_ms;
-- end; $$;
-- create or replace function public.safe_chat_required(p_uid_a text, p_uid_b text)
-- returns boolean language sql stable security definer set search_path = public as $$
--   select coalesce(
--     (select bool_or(public.dob_age_years(i.date_of_birth) < public.safe_chat_minor_age())
--        from public.user_identity i
--       where i.uid in (p_uid_a, p_uid_b)),
--     false);
-- $$;
-- commit;
--
-- New app builds call safe_chat_mode() and fall back to the viewer's own DOB
-- when it is missing, so dropping it degrades the chat screen's hint only;
-- the 028 trigger keeps enforcing.
-- =====================================================================
