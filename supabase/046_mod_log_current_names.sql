-- =====================================================================
-- 046 — Mod log + election candidates show CURRENT names / avatars
-- =====================================================================
--
-- 029 denormalized actor_name / target_name onto every mod_actions row
-- ("name at time of action"). A moderator who renamed kept showing up
-- under the old name in the Admin Dashboard mod log, the mod leaderboard
-- and a user's "last actioned by" line — on 2026-10-05, 10 of the 15
-- actors in the table displayed a name they no longer use, and 254 of 470
-- target names were out of date.
--
-- Fix, read side only: every read RPC now resolves actor_uid / target_uid
-- against user_identity_base (kept current by mirrorUsersToSupabase on
-- every users/{uid} write) and falls back to the stored snapshot when the
-- account is gone or the row has no uid (system / report bans).
--
-- * The table is untouched — the snapshot columns still hold the name at
--   the time of the action, so the history is not rewritten.
-- * Signatures and result shapes are identical, so every app build in
--   the field gets current names without an update. The SETOF rows are
--   built with jsonb_populate_record(m, …), which overrides only the two
--   name columns and keeps working if mod_actions gains a column later.
-- * The staff gate is unchanged (is_mod_staff(), null-safe since 039).
-- =====================================================================

create or replace function public.mod_actions_for_user(
  p_email          text default null,
  p_uid            text default null,
  p_cursor_created timestamptz default null,
  p_cursor_id      uuid default null,
  p_limit          int default 50
) returns setof public.mod_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(trim(p_email), ''));
  v_uid   text := nullif(trim(p_uid), '');
begin
  if not public.is_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_email is null and v_uid is null then
    raise exception 'email or uid required' using errcode = '22023';
  end if;

  return query
    select r.*
      from public.mod_actions m
      left join public.user_identity_base ia on ia.uid = m.actor_uid
      left join public.user_identity_base it on it.uid = m.target_uid
     cross join lateral jsonb_populate_record(m, jsonb_build_object(
       'actor_name',  coalesce(nullif(ia.display_name, ''), m.actor_name),
       'target_name', coalesce(nullif(it.display_name, ''), m.target_name)
     )) r
     where ((v_email is not null and m.target_email = v_email)
         or (v_uid   is not null and m.target_uid   = v_uid))
       and (
         p_cursor_created is null
         or m.created_at < p_cursor_created
         or (m.created_at = p_cursor_created and m.id < p_cursor_id)
       )
     order by m.created_at desc, m.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;


create or replace function public.mod_action_counts_for_user(
  p_email text default null,
  p_uid   text default null
) returns table (
  mute_count      bigint,
  strike_count    bigint,
  ban_count       bigint,
  unban_count     bigint,
  total_count     bigint,
  first_action_at timestamptz,
  last_action_at  timestamptz,
  last_action     text,
  last_reason     text,
  last_actor_name text,
  distinct_actors bigint
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_email text := lower(nullif(trim(p_email), ''));
  v_uid   text := nullif(trim(p_uid), '');
begin
  if not public.is_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if v_email is null and v_uid is null then
    raise exception 'email or uid required' using errcode = '22023';
  end if;

  return query
  with acts as (
    select *
      from public.mod_actions
     where (v_email is not null and target_email = v_email)
        or (v_uid   is not null and target_uid   = v_uid)
  ),
  latest as (
    select r.action, r.reason,
           coalesce(nullif(ia.display_name, ''), r.actor_name) as actor_name
      from acts r
      left join public.user_identity_base ia on ia.uid = r.actor_uid
     order by r.created_at desc, r.id desc
     limit 1
  )
  select
    count(*) filter (where r.action = 'mute')   ::bigint,
    count(*) filter (where r.action = 'strike') ::bigint,
    count(*) filter (where r.action = 'ban')    ::bigint,
    count(*) filter (where r.action = 'unban')  ::bigint,
    count(*)                                    ::bigint,
    min(r.created_at),
    max(r.created_at),
    (select l.action     from latest l),
    (select l.reason     from latest l),
    (select l.actor_name from latest l),
    count(distinct r.actor_uid)                 ::bigint
  from acts r;
end $$;


create or replace function public.mod_leaderboard(
  p_days  int default 30,
  p_limit int default 50
) returns table (
  actor_uid        text,
  actor_name       text,
  actor_role       text,
  ban_count        bigint,
  strike_count     bigint,
  mute_count       bigint,
  unban_count      bigint,
  total_count      bigint,
  distinct_targets bigint,
  last_action_at   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days  int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since timestamptz := now() - make_interval(days => v_days);
begin
  if not public.is_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    with agg as (
      select
        a.actor_uid,
        (array_agg(a.actor_name order by a.created_at desc)
           filter (where a.actor_name is not null))[1] as logged_name,
        (array_agg(a.actor_role order by a.created_at desc)
           filter (where a.actor_role is not null))[1] as role,
        count(*) filter (where a.action = 'ban')    ::bigint as bans,
        count(*) filter (where a.action = 'strike') ::bigint as strikes,
        count(*) filter (where a.action = 'mute')   ::bigint as mutes,
        count(*) filter (where a.action = 'unban')  ::bigint as unbans,
        count(*)                                    ::bigint as total,
        count(distinct a.target_email)              ::bigint as targets,
        max(a.created_at) as last_at
        from public.mod_actions a
       where a.created_at >= v_since
         and a.actor_uid is not null
       group by a.actor_uid
    )
    select
      g.actor_uid,
      -- Current profile name; the latest logged name only if the account is gone.
      coalesce(nullif(i.display_name, ''), g.logged_name),
      g.role,
      g.bans, g.strikes, g.mutes, g.unbans, g.total, g.targets, g.last_at
      from agg g
      left join public.user_identity_base i on i.uid = g.actor_uid
     order by g.total desc, g.last_at desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;


create or replace function public.mod_actions_recent(
  p_action         text default null,
  p_actor_uid      text default null,
  p_days           int default 30,
  p_cursor_created timestamptz default null,
  p_cursor_id      uuid default null,
  p_limit          int default 30
) returns setof public.mod_actions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days   int := greatest(1, least(coalesce(p_days, 30), 365));
  v_since  timestamptz := now() - make_interval(days => v_days);
  v_action text := nullif(trim(p_action), '');
  v_actor  text := nullif(trim(p_actor_uid), '');
begin
  if not public.is_mod_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
    select r.*
      from public.mod_actions m
      left join public.user_identity_base ia on ia.uid = m.actor_uid
      left join public.user_identity_base it on it.uid = m.target_uid
     cross join lateral jsonb_populate_record(m, jsonb_build_object(
       'actor_name',  coalesce(nullif(ia.display_name, ''), m.actor_name),
       'target_name', coalesce(nullif(it.display_name, ''), m.target_name)
     )) r
     where m.created_at >= v_since
       and (v_action is null or m.action = v_action)
       and (v_actor  is null or m.actor_uid = v_actor)
       and (
         p_cursor_created is null
         or m.created_at < p_cursor_created
         or (m.created_at = p_cursor_created and m.id < p_cursor_id)
       )
     order by m.created_at desc, m.id desc
     limit greatest(1, least(coalesce(p_limit, 30), 100));
end $$;

-- create or replace keeps the existing grants (029: revoked from public,
-- execute granted to authenticated); restated so this file stands alone.
revoke all on function public.mod_actions_for_user(text, text, timestamptz, uuid, int) from public;
grant execute on function public.mod_actions_for_user(text, text, timestamptz, uuid, int) to authenticated;
revoke all on function public.mod_action_counts_for_user(text, text) from public;
grant execute on function public.mod_action_counts_for_user(text, text) to authenticated;
revoke all on function public.mod_leaderboard(int, int) from public;
grant execute on function public.mod_leaderboard(int, int) to authenticated;
revoke all on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) from public;
grant execute on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) to authenticated;


-- ---------------------------------------------------------------------
-- Staff election candidates
--
-- staff_candidates.name / avatar are copied when a player applies (038,
-- 040) and the ballot, results and admin Applications list all read that
-- copy — so a candidate who renamed or changed their picture mid-election
-- stayed stale. Rather than re-create those three large RPCs, keep the
-- copy current: when mirrorUsersToSupabase changes a display name or
-- avatar, this rewrites that player's candidate rows. The WHEN clause
-- keeps it free for the frequent identity upserts that only bump
-- last_activity_ms; staff_candidates_uid_idx (038) makes the update an
-- index lookup.
-- ---------------------------------------------------------------------
create or replace function public.sync_staff_candidate_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff_candidates
     set name   = new.display_name,
         avatar = new.avatar
   where uid = new.uid
     and (name is distinct from new.display_name or avatar is distinct from new.avatar);
  return null;
end $$;

revoke all on function public.sync_staff_candidate_identity() from public;

drop trigger if exists user_identity_sync_staff_candidates on public.user_identity_base;
create trigger user_identity_sync_staff_candidates
  after update of display_name, avatar on public.user_identity_base
  for each row
  when (old.display_name is distinct from new.display_name
        or old.avatar is distinct from new.avatar)
  execute function public.sync_staff_candidate_identity();
