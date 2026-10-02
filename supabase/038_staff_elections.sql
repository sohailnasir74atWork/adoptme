-- =====================================================================
-- 038 — Staff elections (adoptme, kvtbtzhtcaanhjblyick), 2026-10-02
--
-- MODs and Junior Mods (JMD) are no longer hand-picked. Players run for a
-- seat, everyone votes, and the winners serve a fixed term.
--
--   role  seats  to run for it          term     votes needed to win
--   mod   4      10 squad friends       60 days  10
--   jmd   6       3 squad friends       30 days   3
--   (defaults live in _staff_rules; an admin can change seats per election)
--
-- Squad friends = squad_codes.direct_count (034): only real, new players
-- on their own phones count, so the bar cannot be met with alt accounts.
--
-- Calendar of one election (all server-side; no client can move it):
--   nominations 3 days -> voting 4 days -> close -> winners take office.
--   The next election is scheduled at close, timed to end exactly when the
--   new term ends, so the cycle runs by itself once an admin starts it.
--
-- Running: squad >= min_squad, no strike/ban in the last 30 days and not
--   banned now, one race at a time, a sitting MOD can't run for JMD.
-- Voting:  one vote per account AND per phone, account >= 7 days old, not
--   banned, not for yourself (or from the candidate's own phone). The vote
--   can be changed until voting closes. Counts stay hidden until close.
-- Winning: top `seats` candidates with >= min_votes. Ties: bigger squad,
--   then whoever entered first.
-- No winners at all (nobody ran, or nobody reached min_votes): the sitting
--   team stays and a fresh election opens at once.
--
-- Roles themselves stay in RTDB (users/{uid}/isModerator, isBabyMod). This
-- file decides; the Cloud Function runStaffElections applies the result to
-- RTDB (grant winners, remove everyone else in that role, admins untouched)
-- and marks the election applied. The first finalized election per role
-- therefore replaces the hand-picked team.
--
-- Cost: no realtime. staff_elections_get when the Elections screen opens
-- (cached 2 min), staff_elections_brief for the Home card (cached 6 h).
-- =====================================================================

create table if not exists public.staff_elections (
  id              bigserial primary key,
  role            text not null check (role in ('mod', 'jmd')),
  seats           int  not null check (seats between 1 and 20),
  min_squad       int  not null check (min_squad >= 0),
  min_votes       int  not null default 1 check (min_votes >= 1),
  term_days       int  not null check (term_days between 7 and 180),
  nominations_at  timestamptz not null,
  voting_at       timestamptz not null,
  closes_at       timestamptz not null,
  status          text not null default 'open' check (status in ('open', 'finalized', 'cancelled')),
  results         jsonb,                          -- [{uid, votes}] frozen at close
  winners         text[],
  finalized_at    timestamptz,
  applied_at      timestamptz,                    -- RTDB roles written by the Cloud Function
  created_by      text,                           -- admin uid, or 'auto'
  created_at      timestamptz not null default now(),
  check (nominations_at < voting_at and voting_at < closes_at)
);
-- One live election per role.
create unique index if not exists staff_elections_one_open on public.staff_elections (role) where status = 'open';
create index if not exists staff_elections_role_close on public.staff_elections (role, closes_at desc);

create table if not exists public.staff_candidates (
  election_id   bigint not null references public.staff_elections (id) on delete cascade,
  uid           text not null,
  name          text,                             -- denormalized at entry
  avatar        text,
  pitch         text check (pitch is null or length(pitch) <= 160),
  squad         int  not null default 0,          -- squad friends when they entered
  created_at    timestamptz not null default now(),
  withdrawn_at  timestamptz,
  removed_by    text,                             -- admin uid that disqualified them
  primary key (election_id, uid)
);
create index if not exists staff_candidates_uid_idx on public.staff_candidates (uid);

create table if not exists public.staff_votes (
  election_id    bigint not null references public.staff_elections (id) on delete cascade,
  voter_uid      text not null,
  candidate_uid  text not null,
  device         text not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (election_id, voter_uid)
);
create unique index if not exists staff_votes_device_uidx on public.staff_votes (election_id, device);
create index if not exists staff_votes_candidate_idx on public.staff_votes (election_id, candidate_uid);

create table if not exists public.staff_terms (
  id           bigserial primary key,
  role         text not null check (role in ('mod', 'jmd')),
  uid          text not null,
  election_id  bigint references public.staff_elections (id),
  votes        int  not null default 0,
  starts_at    timestamptz not null default now(),
  ends_at      timestamptz not null,              -- when the next election replaces this team
  ended_at     timestamptz,
  end_reason   text check (end_reason is null or end_reason in ('replaced', 'reelected', 'promoted', 'removed'))
);
create unique index if not exists staff_terms_active_uidx on public.staff_terms (role, uid) where ended_at is null;

alter table public.staff_elections  enable row level security;
alter table public.staff_candidates enable row level security;
alter table public.staff_votes      enable row level security;
alter table public.staff_terms      enable row level security;
revoke all on table public.staff_elections  from anon, authenticated;
revoke all on table public.staff_candidates from anon, authenticated;
revoke all on table public.staff_votes      from anon, authenticated;
revoke all on table public.staff_terms      from anon, authenticated;
revoke all on sequence public.staff_elections_id_seq from anon, authenticated;
revoke all on sequence public.staff_terms_id_seq     from anon, authenticated;

-- ---------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------

-- Per-role defaults. Kept in step with ROLE_RULES in Code/Helper/staffElections.js.
create or replace function public._staff_rules(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'mod' then '{"seats": 4, "minSquad": 10, "minVotes": 10, "termDays": 60, "nominateHours": 72, "voteHours": 96}'::jsonb
    when 'jmd' then '{"seats": 6, "minSquad": 3,  "minVotes": 3,  "termDays": 30, "nominateHours": 72, "voteHours": 96}'::jsonb
  end;
$$;

-- Voters and candidates; one place so the screen can show them.
create or replace function public._staff_limits()
returns jsonb language sql immutable as $$
  select '{"voterMinDays": 7, "cleanRecordDays": 30, "badgeMinSquad": 3}'::jsonb;
$$;

create or replace function public._staff_squad(p_uid text)
returns int language sql stable set search_path = public as $$
  select coalesce((select direct_count from public.squad_codes where uid = p_uid), 0);
$$;

-- Days since sign-up. No identity row = brand new (0); a row without a
-- creation time = an old account (034 reads it the same way).
create or replace function public._staff_account_days(p_uid text)
returns int language sql stable set search_path = public as $$
  select case
    when not exists (select 1 from public.user_identity_base where uid = p_uid) then 0
    else coalesce(
      floor((extract(epoch from now()) * 1000
             - (select created_at_ms from public.user_identity_base where uid = p_uid)) / 86400000)::int,
      9999)
  end;
$$;

-- The account's email as mod_actions stores it (decoded + lowercased).
-- Bans are keyed by email and often carry no uid, so both are checked.
create or replace function public._staff_email(p_uid text)
returns text language sql stable set search_path = public as $$
  select lower(coalesce(decoded_email, email)) from public.user_identity_base where uid = p_uid;
$$;

-- A strike or ban in the last p_days. Mutes don't count.
create or replace function public._staff_recently_sanctioned(p_uid text, p_days int)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.mod_actions a
     where a.action in ('strike', 'ban')
       and a.created_at >= now() - make_interval(days => p_days)
       and (a.target_uid = p_uid or a.target_email = public._staff_email(p_uid))
  );
$$;

-- Banned right now: the latest strike/ban/unban is a ban still running.
-- (mod_actions starts 2026-09-17; RTDB is the enforcement source.)
create or replace function public._staff_banned_now(p_uid text)
returns boolean language sql stable set search_path = public as $$
  select coalesce((
    select a.action <> 'unban'
           and (a.is_permanent or coalesce(a.banned_until_ms, 0) > extract(epoch from now()) * 1000)
      from public.mod_actions a
     where a.action in ('strike', 'ban', 'unban')
       and (a.target_uid = p_uid or a.target_email = public._staff_email(p_uid))
     order by a.created_at desc
     limit 1
  ), false);
$$;

-- Same owner list as is_mod_staff() (029) and GlobelStats.js. coalesce:
-- a token with no email claim makes the `in` NULL, and `if not NULL` would
-- let the caller through.
create or replace function public._staff_is_admin()
returns boolean language sql stable set search_path = public as $$
  select coalesce(
    exists (select 1 from public.user_roles where uid = public.firebase_uid() and is_admin = true)
    or lower(current_setting('request.jwt.claims', true)::jsonb ->> 'email') in (
         'thesolanalabs@gmail.com',
         'sohailnasir74business@gmail.com',
         'sohailnasir74@gmail.com'
       ),
    false);
$$;

create or replace function public._staff_phase(e public.staff_elections)
returns text language sql stable as $$
  select case
    when e.status = 'cancelled' then 'cancelled'
    when e.status = 'finalized' then 'finalized'
    when now() < e.nominations_at then 'upcoming'
    when now() < e.voting_at then 'nominations'
    when now() < e.closes_at then 'voting'
    else 'counting'                               -- closed, waiting for runStaffElections
  end;
$$;

create or replace function public._staff_open(p_role text, p_seats int, p_start timestamptz, p_created_by text)
returns bigint language plpgsql set search_path = public as $$
declare
  r jsonb := public._staff_rules(p_role);
  v_id bigint;
begin
  insert into public.staff_elections (role, seats, min_squad, min_votes, term_days,
                                      nominations_at, voting_at, closes_at, created_by)
  values (p_role,
          least(greatest(coalesce(p_seats, (r->>'seats')::int), 1), 20),
          (r->>'minSquad')::int, (r->>'minVotes')::int, (r->>'termDays')::int,
          p_start,
          p_start + make_interval(hours => (r->>'nominateHours')::int),
          p_start + make_interval(hours => (r->>'nominateHours')::int + (r->>'voteHours')::int),
          p_created_by)
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function public._staff_rules(text)                      from public, anon, authenticated;
revoke all on function public._staff_limits()                         from public, anon, authenticated;
revoke all on function public._staff_squad(text)                      from public, anon, authenticated;
revoke all on function public._staff_account_days(text)               from public, anon, authenticated;
revoke all on function public._staff_email(text)                      from public, anon, authenticated;
revoke all on function public._staff_recently_sanctioned(text, int)   from public, anon, authenticated;
revoke all on function public._staff_banned_now(text)                 from public, anon, authenticated;
revoke all on function public._staff_is_admin()                       from public, anon, authenticated;
revoke all on function public._staff_phase(public.staff_elections)    from public, anon, authenticated;
revoke all on function public._staff_open(text, int, timestamptz, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- staff_elections_get: the Elections screen.
-- Open elections + each role's result for 14 days after it closed, the
-- sitting team, and what the caller may do.
-- ---------------------------------------------------------------------
create or replace function public.staff_elections_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid       text := public.firebase_uid();
  v_elections jsonb;
  v_team      jsonb;
  v_race      bigint;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select c.election_id into v_race
    from public.staff_candidates c
    join public.staff_elections o on o.id = c.election_id
   where c.uid = v_uid and o.status = 'open' and c.withdrawn_at is null and c.removed_by is null
   limit 1;

  with els as (
    select e.* from public.staff_elections e where e.status = 'open'
    union all
    select f.* from (
      select distinct on (e.role) e.*
        from public.staff_elections e
       where e.status = 'finalized' and e.finalized_at > now() - interval '14 days'
       order by e.role, e.closes_at desc
    ) f
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id,
           'role', e.role,
           'seats', e.seats,
           'minSquad', e.min_squad,
           'minVotes', e.min_votes,
           'termDays', e.term_days,
           'nominationsAt', e.nominations_at,
           'votingAt', e.voting_at,
           'closesAt', e.closes_at,
           'phase', public._staff_phase(e),
           'turnout', (select count(*) from public.staff_votes v where v.election_id = e.id),
           'myVote', (select v.candidate_uid from public.staff_votes v where v.election_id = e.id and v.voter_uid = v_uid),
           'running', exists (select 1 from public.staff_candidates c
                               where c.election_id = e.id and c.uid = v_uid
                                 and c.withdrawn_at is null and c.removed_by is null),
           'candidates', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'uid', c.uid, 'name', c.name, 'avatar', c.avatar, 'pitch', c.pitch, 'squad', c.squad,
                      -- Counts stay hidden while people are still voting.
                      'votes', case when e.status = 'finalized' then t.votes end,
                      'won', case when e.status = 'finalized' then c.uid = any(coalesce(e.winners, '{}')) end
                    ) order by
                      case when e.status = 'finalized' then t.votes end desc nulls last,
                      -- Before the result: a stable order per viewer, so nobody
                      -- gets the top slot for everyone.
                      md5(c.uid || v_uid)
                    ), '[]'::jsonb)
               from public.staff_candidates c
               left join lateral (
                 select count(*)::int as votes from public.staff_votes v
                  where v.election_id = e.id and v.candidate_uid = c.uid
               ) t on true
              where c.election_id = e.id and c.withdrawn_at is null and c.removed_by is null
           )
         ) order by e.role, e.status desc), '[]'::jsonb)
    into v_elections
    from els e;

  -- Sitting team (admins are not part of it).
  select coalesce(jsonb_agg(jsonb_build_object(
           'uid', r.uid,
           'name', i.display_name,
           'avatar', i.avatar,
           'role', case when r.is_moderator then 'mod' else 'jmd' end,
           'elected', t.id is not null,
           'since', t.starts_at,
           'until', t.ends_at,
           'votes', t.votes
         ) order by r.is_moderator desc, t.votes desc nulls last, i.display_name), '[]'::jsonb)
    into v_team
    from public.user_roles r
    left join public.user_identity_base i on i.uid = r.uid
    left join public.staff_terms t
           on t.uid = r.uid and t.ended_at is null
          and t.role = case when r.is_moderator then 'mod' else 'jmd' end
   where (r.is_moderator or r.is_baby_mod) and not r.is_admin;

  return jsonb_build_object(
    'now', now(),
    'rules', jsonb_build_object('mod', public._staff_rules('mod'), 'jmd', public._staff_rules('jmd')),
    'limits', public._staff_limits(),
    'me', jsonb_build_object(
      'squad', public._staff_squad(v_uid),
      'accountDays', public._staff_account_days(v_uid),
      'cleanRecord', not (public._staff_recently_sanctioned(v_uid, 30) or public._staff_banned_now(v_uid)),
      'banned', public._staff_banned_now(v_uid),
      'isMod', exists (select 1 from public.user_roles where uid = v_uid and is_moderator),
      'isAdmin', public._staff_is_admin(),
      'raceId', v_race
    ),
    'elections', v_elections,
    'team', v_team
  );
end
$$;

-- ---------------------------------------------------------------------
-- staff_elections_brief: the Home card. Open elections' calendar only.
-- ---------------------------------------------------------------------
create or replace function public.staff_elections_brief()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'role', e.role,
           'nominationsAt', e.nominations_at, 'votingAt', e.voting_at, 'closesAt', e.closes_at
         ) order by e.role), '[]'::jsonb)
    from public.staff_elections e
   where e.status = 'open';
$$;

-- ---------------------------------------------------------------------
-- staff_run: enter a race (or update your pitch) during nominations.
-- ---------------------------------------------------------------------
create or replace function public.staff_run(p_election bigint, p_pitch text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  e        public.staff_elections;
  v_squad  int;
  v_name   text;
  v_avatar text;
  v_pitch  text := nullif(left(btrim(regexp_replace(coalesce(p_pitch, ''), '\s+', ' ', 'g')), 160), '');
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select * into e from public.staff_elections where id = p_election;
  if not found or public._staff_phase(e) <> 'nominations' then
    return jsonb_build_object('ok', false, 'reason', 'not_nominations');
  end if;

  if exists (select 1 from public.staff_candidates
              where election_id = e.id and uid = v_uid and removed_by is not null) then
    return jsonb_build_object('ok', false, 'reason', 'removed');
  end if;

  v_squad := public._staff_squad(v_uid);
  if v_squad < e.min_squad then
    return jsonb_build_object('ok', false, 'reason', 'squad', 'need', e.min_squad, 'have', v_squad);
  end if;

  if public._staff_recently_sanctioned(v_uid, 30) or public._staff_banned_now(v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'record');
  end if;

  if e.role = 'jmd' and exists (select 1 from public.user_roles where uid = v_uid and is_moderator) then
    return jsonb_build_object('ok', false, 'reason', 'already_mod');
  end if;

  if exists (select 1 from public.staff_candidates c
               join public.staff_elections o on o.id = c.election_id
              where c.uid = v_uid and o.status = 'open' and o.id <> e.id
                and c.withdrawn_at is null and c.removed_by is null) then
    return jsonb_build_object('ok', false, 'reason', 'other_race');
  end if;

  select display_name, avatar into v_name, v_avatar
    from public.user_identity_base where uid = v_uid;

  insert into public.staff_candidates as sc (election_id, uid, name, avatar, pitch, squad)
  values (e.id, v_uid, left(v_name, 40), v_avatar, v_pitch, v_squad)
  on conflict (election_id, uid) do update
     set name = excluded.name,
         avatar = excluded.avatar,
         pitch = excluded.pitch,
         squad = excluded.squad,
         -- Coming back after withdrawing puts you at the back of the tie-break.
         created_at = case when sc.withdrawn_at is null then sc.created_at else now() end,
         withdrawn_at = null;

  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- staff_withdraw: leave a race any time before it closes. Votes already
-- cast for you are ignored at the count; those voters can vote again.
-- ---------------------------------------------------------------------
create or replace function public.staff_withdraw(p_election bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := public.firebase_uid();
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  update public.staff_candidates c
     set withdrawn_at = now()
    from public.staff_elections e
   where e.id = c.election_id and c.election_id = p_election and c.uid = v_uid
     and c.withdrawn_at is null and e.status = 'open' and now() < e.closes_at;
  return jsonb_build_object('ok', found);
end
$$;

-- ---------------------------------------------------------------------
-- staff_vote: cast or change your vote while voting is open.
-- ---------------------------------------------------------------------
create or replace function public.staff_vote(p_election bigint, p_candidate text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  text := public.firebase_uid();
  e      public.staff_elections;
  v_days int := (public._staff_limits()->>'voterMinDays')::int;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select * into e from public.staff_elections where id = p_election;
  if not found or public._staff_phase(e) <> 'voting' then
    return jsonb_build_object('ok', false, 'reason', 'not_voting');
  end if;
  if not public._squad_valid_device(p_device) then
    return jsonb_build_object('ok', false, 'reason', 'device');
  end if;
  if p_candidate = v_uid
     or p_device = (select device from public.squad_codes where uid = p_candidate) then
    return jsonb_build_object('ok', false, 'reason', 'self');
  end if;
  if not exists (select 1 from public.staff_candidates
                  where election_id = e.id and uid = p_candidate
                    and withdrawn_at is null and removed_by is null) then
    return jsonb_build_object('ok', false, 'reason', 'no_candidate');
  end if;
  if public._staff_account_days(v_uid) < v_days then
    return jsonb_build_object('ok', false, 'reason', 'too_new', 'days', v_days);
  end if;
  if public._staff_banned_now(v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'banned');
  end if;
  if exists (select 1 from public.staff_votes
              where election_id = e.id and device = p_device and voter_uid <> v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'device_used');
  end if;

  begin
    insert into public.staff_votes (election_id, voter_uid, candidate_uid, device)
    values (e.id, v_uid, p_candidate, p_device)
    on conflict (election_id, voter_uid) do update
       set candidate_uid = excluded.candidate_uid, updated_at = now();
  exception when unique_violation then
    -- Two accounts on one phone voting at the same moment.
    return jsonb_build_object('ok', false, 'reason', 'device_used');
  end;

  return jsonb_build_object('ok', true);
end
$$;

-- ---------------------------------------------------------------------
-- Admin: start an election now, cancel one, disqualify a candidate.
-- ---------------------------------------------------------------------
create or replace function public.staff_admin_open(p_role text, p_seats int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._staff_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if public._staff_rules(p_role) is null then
    return jsonb_build_object('ok', false, 'reason', 'role');
  end if;
  if exists (select 1 from public.staff_elections where role = p_role and status = 'open') then
    return jsonb_build_object('ok', false, 'reason', 'already_open');
  end if;
  return jsonb_build_object('ok', true,
    'id', public._staff_open(p_role, p_seats, now(), public.firebase_uid()));
end
$$;

create or replace function public.staff_admin_cancel(p_election bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._staff_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.staff_elections set status = 'cancelled'
   where id = p_election and status = 'open';
  return jsonb_build_object('ok', found);
end
$$;

create or replace function public.staff_admin_disqualify(p_election bigint, p_uid text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public._staff_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.staff_candidates c
     set removed_by = public.firebase_uid()
    from public.staff_elections e
   where e.id = c.election_id and c.election_id = p_election and c.uid = p_uid
     and e.status = 'open' and c.removed_by is null;
  return jsonb_build_object('ok', found);
end
$$;

-- ---------------------------------------------------------------------
-- Service role only (functions/runStaffElections.js).
-- ---------------------------------------------------------------------

-- Elections to count, and counted elections not yet applied to RTDB.
create or replace function public.staff_due()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'role', role, 'status', status) order by closes_at), '[]'::jsonb)
    from public.staff_elections
   where (status = 'open' and closes_at <= now())
      or (status = 'finalized' and applied_at is null);
$$;

-- Count an election that has closed. Safe to call again: a finalized
-- election returns its stored winners.
create or replace function public.staff_finalize(p_election bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e          public.staff_elections;
  r          jsonb;
  v_tally    jsonb;
  v_winners  text[];
  v_hours    int;
  v_close    timestamptz;
begin
  select * into e from public.staff_elections where id = p_election for update;
  if not found then
    return jsonb_build_object('id', p_election, 'skipped', 'missing');
  end if;
  if e.status = 'finalized' then
    return jsonb_build_object('id', e.id, 'role', e.role, 'winners', to_jsonb(coalesce(e.winners, '{}')),
                              'applied', e.applied_at is not null);
  end if;
  if e.status <> 'open' or now() < e.closes_at then
    return jsonb_build_object('id', e.id, 'skipped', 'not_closed');
  end if;

  r := public._staff_rules(e.role);
  v_hours := (r->>'nominateHours')::int + (r->>'voteHours')::int;

  with t as (
    select c.uid, c.squad, c.created_at, count(v.voter_uid)::int as votes
      from public.staff_candidates c
      left join public.staff_votes v on v.election_id = c.election_id and v.candidate_uid = c.uid
     where c.election_id = e.id and c.withdrawn_at is null and c.removed_by is null
     group by c.uid, c.squad, c.created_at
  ), w as (
    select uid, votes from t
     where votes >= e.min_votes
     order by votes desc, squad desc, created_at
     limit e.seats
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('uid', uid, 'votes', votes)
                                    order by votes desc, squad desc, created_at), '[]'::jsonb) from t),
         (select coalesce(array_agg(uid order by votes desc), '{}') from w)
    into v_tally, v_winners;

  if coalesce(array_length(v_winners, 1), 0) = 0 then
    -- Nobody won: the sitting team stays, a new election opens now.
    v_close := now() + make_interval(hours => v_hours);
    update public.staff_terms set ends_at = v_close where role = e.role and ended_at is null;
    update public.staff_elections
       set status = 'finalized', results = v_tally, winners = '{}', finalized_at = now(), applied_at = now()
     where id = e.id;
    perform public._staff_open(e.role, e.seats, now(), 'auto');
    return jsonb_build_object('id', e.id, 'role', e.role, 'winners', '[]'::jsonb, 'applied', true, 'noWinner', true);
  end if;

  update public.staff_terms
     set ended_at = now(),
         end_reason = case when uid = any(v_winners) then 'reelected' else 'replaced' end
   where role = e.role and ended_at is null;

  insert into public.staff_terms (role, uid, election_id, votes, starts_at, ends_at)
  select e.role, x->>'uid', e.id, (x->>'votes')::int, now(), e.closes_at + make_interval(days => e.term_days)
    from jsonb_array_elements(v_tally) x
   where x->>'uid' = any(v_winners);

  -- A JMD elected MOD leaves the JMD seat.
  if e.role = 'mod' then
    update public.staff_terms set ended_at = now(), end_reason = 'promoted'
     where role = 'jmd' and ended_at is null and uid = any(v_winners);
  end if;

  update public.staff_elections
     set status = 'finalized', results = v_tally, winners = v_winners, finalized_at = now()
   where id = e.id;

  -- The next election ends as this term ends.
  perform public._staff_open(e.role, e.seats,
                             e.closes_at + make_interval(days => e.term_days) - make_interval(hours => v_hours),
                             'auto');

  return jsonb_build_object('id', e.id, 'role', e.role, 'winners', to_jsonb(v_winners), 'applied', false);
end
$$;

create or replace function public.staff_mark_applied(p_election bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.staff_elections set applied_at = now()
   where id = p_election and status = 'finalized' and applied_at is null;
$$;

-- A term whose holder an admin removed in RTDB.
create or replace function public.staff_end_terms(p_role text, p_uids text[], p_reason text default 'removed')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.staff_terms set ended_at = now(), end_reason = p_reason
   where role = p_role and ended_at is null and uid = any(p_uids);
  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.staff_elections_get()                 from public, anon;
revoke all on function public.staff_elections_brief()               from public;
revoke all on function public.staff_run(bigint, text)               from public, anon;
revoke all on function public.staff_withdraw(bigint)                from public, anon;
revoke all on function public.staff_vote(bigint, text, text)        from public, anon;
revoke all on function public.staff_admin_open(text, int)           from public, anon;
revoke all on function public.staff_admin_cancel(bigint)            from public, anon;
revoke all on function public.staff_admin_disqualify(bigint, text)  from public, anon;
revoke all on function public.staff_due()                           from public, anon, authenticated;
revoke all on function public.staff_finalize(bigint)                from public, anon, authenticated;
revoke all on function public.staff_mark_applied(bigint)            from public, anon, authenticated;
revoke all on function public.staff_end_terms(text, text[], text)   from public, anon, authenticated;
grant execute on function public.staff_elections_get()                to authenticated;
grant execute on function public.staff_elections_brief()              to anon, authenticated;
grant execute on function public.staff_run(bigint, text)              to authenticated;
grant execute on function public.staff_withdraw(bigint)               to authenticated;
grant execute on function public.staff_vote(bigint, text, text)       to authenticated;
grant execute on function public.staff_admin_open(text, int)          to authenticated;
grant execute on function public.staff_admin_cancel(bigint)           to authenticated;
grant execute on function public.staff_admin_disqualify(bigint, text) to authenticated;
grant execute on function public.staff_due()                          to service_role;
grant execute on function public.staff_finalize(bigint)               to service_role;
grant execute on function public.staff_mark_applied(bigint)           to service_role;
grant execute on function public.staff_end_terms(text, text[], text)  to service_role;

-- Retention: individual votes go 90 days after the election closed
-- (the tally stays in staff_elections.results).
select cron.schedule(
  'staff-votes-retention',
  '41 4 * * *',
  $$ delete from public.staff_votes v using public.staff_elections e
      where e.id = v.election_id and e.closes_at < now() - interval '90 days'; $$
)
where not exists (select 1 from cron.job where jobname = 'staff-votes-retention');
