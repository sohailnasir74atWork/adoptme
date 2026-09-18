-- =====================================================================
-- 029_mod_actions.sql — moderation audit log
--
-- WHY
-- Before this migration the app kept NO history of moderation. Every
-- mute / strike / ban wrote the SAME single RTDB key
-- (banned_users_by_email/{encodedEmail}) with `set()`, so each action
-- overwrote the previous one and `unbanUserWithEmail` deleted the node
-- outright. Consequences the admin dashboard was living with:
--   * "Strike History" could only ever show ONE row (id 'current') —
--     it is a snapshot of the live ban record, not a history.
--   * A mute overwrote a ban (and could silently shorten a permanent
--     ban to 5 minutes).
--   * No way to answer "how many users has this mod banned?", "how many
--     times has this user been muted?", or "why was this applied?".
--   * Unbanning erased the evidence entirely.
--
-- This table is the append-only record. RTDB keeps its single live
-- `banned_users_by_email` node as the ENFORCEMENT state (unchanged — old
-- app builds in the field still read it); this log is the HISTORY.
--
-- COST NOTES (this project is actively cost-managed — see
-- COST_OPTIMIZATION_2026-09.md and docs/supabase-cost-optimization.md)
--   * NOT added to the realtime publication. Realtime messages are the
--     single largest Supabase line item on the sibling projects
--     (31 M messages / $67.50 on blox_fruit). A moderation log has no
--     business pushing rows to devices; staff pull it on demand.
--   * Actor + target display names are DENORMALIZED onto the row. Reads
--     therefore need no join and — more importantly — no RTDB
--     profileCache warm-up per row, which is what the banned-list view
--     pays today. It is also more correct: it preserves the name as it
--     was when the action was taken.
--   * Every read path is a SECURITY DEFINER rpc that aggregates or
--     paginates SERVER-SIDE, so the client never downloads rows it will
--     not render. No client-side counting.
--   * Volume is tiny (one row per moderation action, order tens/day).
--     Retention job below keeps it bounded anyway.
--   * Writes are best-effort and fire-and-forget on the client: a failed
--     log insert must never block or fail an actual ban.
--
-- AUTH
--   Insert: mod staff (admin / moderator / baby mod / the super-admin
--   email allowlist), and only as themselves.
--   Read: via rpc only, gated on the same staff check.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. is_mod_staff()
--    Wider than the existing is_staff() (020), which is admin+moderator
--    only. Ban/mute authority in the client is canStaffBanMute() —
--    admin OR moderator OR BABY MOD — so the log must accept a baby
--    mod's rows or their actions would silently go unrecorded.
--
--    is_staff() is deliberately NOT modified: other policies
--    (group_messages select/update) depend on its current meaning.
--
--    ⚠️ The email list must stay in sync with GlobelStats.js, is_staff()
--       in 020, and _require_admin() in 024.
-- ---------------------------------------------------------------------
create or replace function public.is_mod_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
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
    );
$$;

grant execute on function public.is_mod_staff() to authenticated;


-- ---------------------------------------------------------------------
-- 2. mod_actions
--
-- One row per moderation action. Append-only: no UPDATE/DELETE policy is
-- granted to clients at all, so a mod cannot rewrite or erase their own
-- record. Purging is the retention job's job (service_role).
--
-- target_email is stored DECODED and lowercased. RTDB encodes emails as
-- `name(dot)domain(dot)tld` and the write path lowercases via
-- encodeEmailForBan(), while several dashboard readers did NOT lowercase
-- — that mismatch is exactly why strike history came back empty for any
-- user with a capital letter in their email. Normalising once, here, at
-- the boundary removes the whole class of bug.
-- ---------------------------------------------------------------------
create table if not exists public.mod_actions (
  id                  uuid primary key default gen_random_uuid(),

  -- WHO IT WAS DONE TO
  target_uid          text,                    -- may be null: bans are keyed by email
  target_email        text not null,           -- decoded + lowercased
  target_name         text,                    -- denormalized, name at time of action

  -- WHAT WAS DONE
  action              text not null
    check (action in ('mute', 'strike', 'ban', 'unban')),
  reason              text,
  strike_count        int,                     -- strike/ban only
  duration_minutes    int,                     -- mute only
  banned_until_ms     bigint,                  -- null when permanent or unban
  is_permanent        boolean not null default false,

  -- WHO DID IT
  actor_uid           text,
  actor_name          text,                    -- denormalized
  actor_role          text                     -- 'admin' | 'moderator' | 'baby_mod' | 'system'
    check (actor_role is null or actor_role in ('admin', 'moderator', 'baby_mod', 'system')),

  -- WHERE FROM — lets us tell a deliberate dashboard action apart from an
  -- automatic report-threshold ban (ReportPopUp / ReportModal call
  -- banUserwithEmail with no actor at all).
  source              text not null default 'unknown'
    check (source in ('admin_dashboard', 'group_chat', 'report', 'auto', 'unknown')),

  created_at          timestamptz not null default now()
);

-- Per-user history + the per-user counts rpc. Email is the reliable key
-- (uid is frequently null on ban records), so it leads.
create index if not exists idx_mod_actions_target_email
  on public.mod_actions (target_email, created_at desc);

-- Only rows that actually carry a uid — keeps the index small.
create index if not exists idx_mod_actions_target_uid
  on public.mod_actions (target_uid, created_at desc)
  where target_uid is not null;

-- Leaderboard ("who banned how many") + per-mod drill-down.
create index if not exists idx_mod_actions_actor
  on public.mod_actions (actor_uid, created_at desc)
  where actor_uid is not null;

-- Global recent feed.
create index if not exists idx_mod_actions_created
  on public.mod_actions (created_at desc);

alter table public.mod_actions enable row level security;

-- Realtime would be pure cost here. Belt and braces: the table is never
-- added to the publication, and replica identity stays default so even an
-- accidental add carries no payload.
alter table public.mod_actions replica identity default;


-- ---------------------------------------------------------------------
-- 3. Policies
--
-- INSERT only, and only as yourself. No select policy: every read goes
-- through a SECURITY DEFINER rpc below, which keeps the gate in one place
-- and keeps clients from running unbounded `select *` scans over the log.
-- No update/delete policy at all — append-only by construction.
-- ---------------------------------------------------------------------
drop policy if exists "mod_actions insert by staff" on public.mod_actions;
create policy "mod_actions insert by staff"
  on public.mod_actions for insert
  to authenticated
  with check (
    public.is_mod_staff()
    and (actor_uid is null or actor_uid = public.firebase_uid())
  );


-- ---------------------------------------------------------------------
-- 4. mod_actions_for_user
--    The per-user moderation timeline the admin dashboard shows when a
--    single person's profile is opened.
--
--    Matches on email OR uid so a record written before the user had a
--    uid on file still shows up. Keyset-paginated on (created_at, id) —
--    the same shape the chat admin rpcs use — so deep pages stay cheap.
-- ---------------------------------------------------------------------
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
    select *
      from public.mod_actions
     where ((v_email is not null and target_email = v_email)
         or (v_uid   is not null and target_uid   = v_uid))
       and (
         p_cursor_created is null
         or created_at < p_cursor_created
         or (created_at = p_cursor_created and id < p_cursor_id)
       )
     order by created_at desc, id desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

revoke all on function public.mod_actions_for_user(text, text, timestamptz, uuid, int) from public;
grant execute on function public.mod_actions_for_user(text, text, timestamptz, uuid, int) to authenticated;


-- ---------------------------------------------------------------------
-- 5. mod_action_counts_for_user
--    "How many times has this person been muted / struck / banned?"
--
--    Aggregated server-side and returned as ONE row. The alternative —
--    shipping the timeline to the client and counting there — would cost
--    a full history download on every profile open, for a number that
--    fits in 60 bytes.
-- ---------------------------------------------------------------------
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
    select r.action, r.reason, r.actor_name
      from acts r
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

revoke all on function public.mod_action_counts_for_user(text, text) from public;
grant execute on function public.mod_action_counts_for_user(text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 6. mod_leaderboard
--    "Who banned how many people."
--
--    Grouped by actor over a bounded window (default 30 days) so the
--    scan is always index-bounded by idx_mod_actions_created. Counts
--    DISTINCT targets as well as raw actions — ten mutes on one repeat
--    offender is not the same as ten different people moderated, and the
--    raw number alone would flatter whoever spams short mutes.
--
--    Self-serve for staff: a moderator seeing the leaderboard is fine and
--    is the point (it is a workload view, not a secret).
-- ---------------------------------------------------------------------
create or replace function public.mod_leaderboard(
  p_days  int default 30,
  p_limit int default 50
) returns table (
  actor_uid       text,
  actor_name      text,
  actor_role      text,
  ban_count       bigint,
  strike_count    bigint,
  mute_count      bigint,
  unban_count     bigint,
  total_count     bigint,
  distinct_targets bigint,
  last_action_at  timestamptz
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
    select
      a.actor_uid,
      -- Names change; take the most recent one this actor wrote.
      (array_agg(a.actor_name order by a.created_at desc)
         filter (where a.actor_name is not null))[1],
      (array_agg(a.actor_role order by a.created_at desc)
         filter (where a.actor_role is not null))[1],
      count(*) filter (where a.action = 'ban')    ::bigint,
      count(*) filter (where a.action = 'strike') ::bigint,
      count(*) filter (where a.action = 'mute')   ::bigint,
      count(*) filter (where a.action = 'unban')  ::bigint,
      count(*)                                    ::bigint,
      count(distinct a.target_email)              ::bigint,
      max(a.created_at)
      from public.mod_actions a
     where a.created_at >= v_since
       and a.actor_uid is not null
     group by a.actor_uid
     order by count(*) desc, max(a.created_at) desc
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end $$;

revoke all on function public.mod_leaderboard(int, int) from public;
grant execute on function public.mod_leaderboard(int, int) to authenticated;


-- ---------------------------------------------------------------------
-- 7. mod_actions_recent
--    The global activity feed, with optional actor / action filters.
--    Filtering is server-side so a filtered view costs less than an
--    unfiltered one instead of the same.
-- ---------------------------------------------------------------------
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
    select *
      from public.mod_actions
     where created_at >= v_since
       and (v_action is null or action = v_action)
       and (v_actor  is null or actor_uid = v_actor)
       and (
         p_cursor_created is null
         or created_at < p_cursor_created
         or (created_at = p_cursor_created and id < p_cursor_id)
       )
     order by created_at desc, id desc
     limit greatest(1, least(coalesce(p_limit, 30), 100));
end $$;

revoke all on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) from public;
grant execute on function public.mod_actions_recent(text, text, int, timestamptz, uuid, int) to authenticated;


-- ---------------------------------------------------------------------
-- 8. Retention
--    Moderation history is worth keeping far longer than chat (025 keeps
--    messages 15 days), but not forever — an unbounded audit table is how
--    you end up with the 458 MB supabase_functions.hooks table 027 had to
--    clean up. 400 days keeps a full year of context plus slack.
--
--    Volume makes this near-free either way; the job exists so the table
--    can never become a surprise.
-- ---------------------------------------------------------------------
create or replace function public.retention_mod_actions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.mod_actions
   where created_at < now() - interval '400 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

revoke all on function public.retention_mod_actions() from public;

select cron.schedule(
  'retention-mod-actions',
  '43 4 * * 0',                      -- weekly, off-peak; the table is tiny
  $$select public.retention_mod_actions()$$
)
where not exists (select 1 from cron.job where jobname = 'retention-mod-actions');
