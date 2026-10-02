-- =====================================================================
-- 040 — Staff elections: applications, admin approval, age gates
--       (adoptme, kvtbtzhtcaanhjblyick), 2026-10-02
--
-- Changes to 038 (owner's request, 2026-10-02):
--
--   * Running is now APPLYING. A player who meets the bar submits an
--     application (staff_run); it waits as 'pending' until an admin
--     approves it in the Admin Dashboard (staff_admin_review). Only
--     approved candidates are on the ballot: players never see pending
--     or rejected applications, a vote for one is refused, and the count
--     ignores them. Pending applications still open when the election
--     closes become 'expired'.
--
--   * Age gates, from user_identity_base.date_of_birth (the mandatory
--     DOB gate; dob_age_years from 028; the RTDB rule makes a DOB
--     immutable once set): MOD 18+, JMD 16+. No DOB on file = can't
--     apply ('age_unknown').
--
--   * MOD squad bar 10 -> 5. JMD stays 3. Seats, terms, minimum votes
--     and the calendar are unchanged.
--
--   * Admins can read any player's eligibility (staff_admin_eligibility):
--     squad, age, record, roles, open application. Shown on the profile
--     drawer to admins only.
--
-- The tables were empty on 2026-10-02 (0 elections), so the new columns
-- need no backfill. Every change is additive; the app is unreleased.
-- =====================================================================

-- ---------------------------------------------------------------------
-- columns
-- ---------------------------------------------------------------------
alter table public.staff_candidates
  add column if not exists status       text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  add column if not exists age          int,                 -- age when they applied
  add column if not exists reviewed_by  text,                -- admin uid
  add column if not exists reviewed_at  timestamptz,
  add column if not exists review_note  text check (review_note is null or length(review_note) <= 200);
create index if not exists staff_candidates_status_idx on public.staff_candidates (election_id, status);

alter table public.staff_elections
  add column if not exists min_age int not null default 0 check (min_age between 0 and 99);

-- ---------------------------------------------------------------------
-- rules
-- ---------------------------------------------------------------------
-- Kept in step with ROLE_RULES in Code/Helper/staffElections.js.
create or replace function public._staff_rules(p_role text)
returns jsonb language sql immutable as $$
  select case p_role
    when 'mod' then '{"seats": 4, "minSquad": 5, "minAge": 18, "minVotes": 10, "termDays": 60, "nominateHours": 72, "voteHours": 96}'::jsonb
    when 'jmd' then '{"seats": 6, "minSquad": 3, "minAge": 16, "minVotes": 3,  "termDays": 30, "nominateHours": 72, "voteHours": 96}'::jsonb
  end;
$$;

-- Age in whole years, or NULL when no (valid) date of birth is on file.
create or replace function public._staff_age(p_uid text)
returns int language sql stable set search_path = public as $$
  select public.dob_age_years((select date_of_birth from public.user_identity_base where uid = p_uid));
$$;

-- Can p_uid apply for p_role? Every failing reason, not just the first,
-- so the screen and the admin panel can list them. p_min_squad /
-- p_min_age override the role defaults with an election's frozen bar.
create or replace function public._staff_eligibility(p_uid text, p_role text, p_min_squad int default null, p_min_age int default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  r         jsonb := public._staff_rules(p_role);
  v_min_sq  int := coalesce(p_min_squad, (r->>'minSquad')::int, 0);
  v_min_age int := coalesce(p_min_age, (r->>'minAge')::int, 0);
  v_squad   int := public._staff_squad(p_uid);
  v_age     int := public._staff_age(p_uid);
  v_is_mod  boolean := exists (select 1 from public.user_roles where uid = p_uid and is_moderator);
  v_banned  boolean := public._staff_banned_now(p_uid);
  v_record  boolean := public._staff_recently_sanctioned(p_uid, (public._staff_limits()->>'cleanRecordDays')::int);
  reasons   text[] := '{}';
begin
  if v_squad < v_min_sq then reasons := array_append(reasons, 'squad'); end if;
  if v_age is null then reasons := array_append(reasons, 'age_unknown');
  elsif v_age < v_min_age then reasons := array_append(reasons, 'age');
  end if;
  if v_banned or v_record then reasons := array_append(reasons, 'record'); end if;
  if p_role = 'jmd' and v_is_mod then reasons := array_append(reasons, 'already_mod'); end if;
  return jsonb_build_object(
    'ok', coalesce(array_length(reasons, 1), 0) = 0,
    'reasons', to_jsonb(reasons),
    'squad', v_squad, 'minSquad', v_min_sq,
    'age', v_age, 'minAge', v_min_age,
    'cleanRecord', not (v_banned or v_record),
    'banned', v_banned,
    'isMod', v_is_mod);
end
$$;

-- An election freezes the bar it was opened with.
create or replace function public._staff_open(p_role text, p_seats int, p_start timestamptz, p_created_by text)
returns bigint language plpgsql set search_path = public as $$
declare
  r jsonb := public._staff_rules(p_role);
  v_id bigint;
begin
  insert into public.staff_elections (role, seats, min_squad, min_age, min_votes, term_days,
                                      nominations_at, voting_at, closes_at, created_by)
  values (p_role,
          least(greatest(coalesce(p_seats, (r->>'seats')::int), 1), 20),
          (r->>'minSquad')::int, coalesce((r->>'minAge')::int, 0), (r->>'minVotes')::int, (r->>'termDays')::int,
          p_start,
          p_start + make_interval(hours => (r->>'nominateHours')::int),
          p_start + make_interval(hours => (r->>'nominateHours')::int + (r->>'voteHours')::int),
          p_created_by)
  returning id into v_id;
  return v_id;
end
$$;

revoke all on function public._staff_age(text)                             from public, anon, authenticated;
revoke all on function public._staff_eligibility(text, text, int, int)     from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- staff_elections_get: the Elections screen.
-- Players see approved candidates only, plus their own application and
-- its status. Admins also get the pending count per race.
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
  v_admin     boolean;
  v_elections jsonb;
  v_team      jsonb;
  v_race      bigint;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  v_admin := public._staff_is_admin();

  select c.election_id into v_race
    from public.staff_candidates c
    join public.staff_elections o on o.id = c.election_id
   where c.uid = v_uid and o.status = 'open' and c.withdrawn_at is null
     and c.status in ('pending', 'approved')
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
           'minAge', e.min_age,
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
                                 and c.withdrawn_at is null and c.status in ('pending', 'approved')),
           -- The caller's own application, whatever its state.
           'myApplication', (
             select jsonb_build_object('status', c.status, 'pitch', c.pitch, 'note', c.review_note,
                                       'appliedAt', c.created_at, 'reviewedAt', c.reviewed_at)
               from public.staff_candidates c
              where c.election_id = e.id and c.uid = v_uid and c.withdrawn_at is null
           ),
           -- Admins: how many applications wait for a decision.
           'pending', case when v_admin then (
             select count(*) from public.staff_candidates c
              where c.election_id = e.id and c.status = 'pending' and c.withdrawn_at is null
           ) end,
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
              where c.election_id = e.id and c.withdrawn_at is null and c.status = 'approved'
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
      'age', public._staff_age(v_uid),
      'accountDays', public._staff_account_days(v_uid),
      'cleanRecord', not (public._staff_recently_sanctioned(v_uid, 30) or public._staff_banned_now(v_uid)),
      'banned', public._staff_banned_now(v_uid),
      'isMod', exists (select 1 from public.user_roles where uid = v_uid and is_moderator),
      'isAdmin', v_admin,
      'raceId', v_race,
      'eligible', jsonb_build_object(
        'mod', public._staff_eligibility(v_uid, 'mod'),
        'jmd', public._staff_eligibility(v_uid, 'jmd'))
    ),
    'pendingApplications', case when v_admin then (
      select count(*) from public.staff_candidates c
        join public.staff_elections e on e.id = c.election_id
       where e.status = 'open' and c.status = 'pending' and c.withdrawn_at is null
    ) end,
    'elections', v_elections,
    'team', v_team
  );
end
$$;

-- ---------------------------------------------------------------------
-- staff_run: apply during nominations. The application waits for an
-- admin. Editing the pitch is allowed while pending; once approved the
-- pitch an admin saw is locked. Coming back after a withdrawal needs a
-- fresh review. A rejected applicant can't re-apply in that election.
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
  cur      public.staff_candidates;
  el       jsonb;
  v_why    text;
  v_name   text;
  v_avatar text;
  v_pitch  text := nullif(left(btrim(regexp_replace(coalesce(p_pitch, ''), '\s+', ' ', 'g')), 160), '');
  v_status text;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select * into e from public.staff_elections where id = p_election;
  if not found or public._staff_phase(e) <> 'nominations' then
    return jsonb_build_object('ok', false, 'reason', 'not_nominations');
  end if;

  select * into cur from public.staff_candidates where election_id = e.id and uid = v_uid;
  if found and (cur.status = 'rejected' or cur.removed_by is not null) then
    return jsonb_build_object('ok', false, 'reason', 'rejected');
  end if;

  el := public._staff_eligibility(v_uid, e.role, e.min_squad, e.min_age);
  if not (el->>'ok')::boolean then
    v_why := el->'reasons'->>0;
    return jsonb_build_object('ok', false, 'reason', v_why, 'reasons', el->'reasons',
      'need', case v_why when 'squad' then e.min_squad when 'age' then e.min_age end,
      'have', case v_why when 'squad' then (el->>'squad')::int when 'age' then (el->>'age')::int end);
  end if;

  if exists (select 1 from public.staff_candidates c
               join public.staff_elections o on o.id = c.election_id
              where c.uid = v_uid and o.status = 'open' and o.id <> e.id
                and c.withdrawn_at is null and c.status in ('pending', 'approved')) then
    return jsonb_build_object('ok', false, 'reason', 'other_race');
  end if;

  select display_name, avatar into v_name, v_avatar
    from public.user_identity_base where uid = v_uid;

  insert into public.staff_candidates as sc (election_id, uid, name, avatar, pitch, squad, age, status)
  values (e.id, v_uid, left(v_name, 40), v_avatar, v_pitch, (el->>'squad')::int, (el->>'age')::int, 'pending')
  on conflict (election_id, uid) do update
     set name   = excluded.name,
         avatar = excluded.avatar,
         squad  = excluded.squad,
         age    = excluded.age,
         -- An approved pitch is the one the admin saw: keep it.
         pitch  = case when sc.withdrawn_at is null and sc.status = 'approved' then sc.pitch else excluded.pitch end,
         -- Withdrawing and coming back means a fresh review, at the back of the tie-break.
         status      = case when sc.withdrawn_at is null then sc.status else 'pending' end,
         reviewed_by = case when sc.withdrawn_at is null then sc.reviewed_by end,
         reviewed_at = case when sc.withdrawn_at is null then sc.reviewed_at end,
         review_note = case when sc.withdrawn_at is null then sc.review_note end,
         created_at  = case when sc.withdrawn_at is null then sc.created_at else now() end,
         withdrawn_at = null
  returning status into v_status;

  return jsonb_build_object('ok', true, 'status', v_status);
end
$$;

-- ---------------------------------------------------------------------
-- staff_vote: only an approved candidate can receive a vote.
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
                    and withdrawn_at is null and status = 'approved') then
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
-- Admin: review applications, read any player's eligibility.
-- ---------------------------------------------------------------------

-- Every application in an open election, pending first, with the live
-- numbers next to the ones frozen at entry.
create or replace function public.staff_admin_applications()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._staff_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'electionId', e.id, 'role', e.role, 'phase', public._staff_phase(e),
             'minSquad', e.min_squad, 'minAge', e.min_age, 'closesAt', e.closes_at,
             'uid', c.uid, 'name', c.name, 'avatar', c.avatar, 'pitch', c.pitch,
             'status', c.status, 'appliedAt', c.created_at,
             'reviewedBy', c.reviewed_by, 'reviewedAt', c.reviewed_at, 'note', c.review_note,
             'squadAtEntry', c.squad, 'ageAtEntry', c.age,
             'accountDays', public._staff_account_days(c.uid),
             'check', public._staff_eligibility(c.uid, e.role, e.min_squad, e.min_age)
           ) order by (c.status = 'pending') desc, c.created_at)
      from public.staff_candidates c
      join public.staff_elections e on e.id = c.election_id
     where e.status = 'open' and c.withdrawn_at is null
  ), '[]'::jsonb);
end
$$;

-- Approve or reject (a decision can be changed while the election is open).
create or replace function public.staff_admin_review(p_election bigint, p_uid text, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e        public.staff_elections;
  c        public.staff_candidates;
  v_status text;
begin
  if not public._staff_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into e from public.staff_elections where id = p_election;
  if not found or e.status <> 'open' or now() >= e.closes_at then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  select * into c from public.staff_candidates where election_id = p_election and uid = p_uid;
  if not found or c.withdrawn_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'no_candidate');
  end if;
  if p_approve and public._staff_banned_now(p_uid) then
    return jsonb_build_object('ok', false, 'reason', 'banned');
  end if;

  update public.staff_candidates
     set status      = case when p_approve then 'approved' else 'rejected' end,
         reviewed_by = public.firebase_uid(),
         reviewed_at = now(),
         review_note = nullif(left(btrim(coalesce(p_note, '')), 200), ''),
         removed_by  = case when p_approve then null else removed_by end
   where election_id = p_election and uid = p_uid
  returning status into v_status;

  return jsonb_build_object('ok', true, 'status', v_status);
end
$$;

-- Disqualify = reject (kept for the long-press on the Elections screen).
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
     set removed_by  = public.firebase_uid(),
         status      = 'rejected',
         reviewed_by = public.firebase_uid(),
         reviewed_at = now()
    from public.staff_elections e
   where e.id = c.election_id and c.election_id = p_election and c.uid = p_uid
     and e.status = 'open' and c.status <> 'rejected';
  return jsonb_build_object('ok', found);
end
$$;

-- A player's standing, for the admin's view of their profile.
create or replace function public.staff_admin_eligibility(p_uid text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public._staff_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_uid is null or length(p_uid) = 0 then
    return null;
  end if;
  return jsonb_build_object(
    'uid', p_uid,
    'squad', public._staff_squad(p_uid),
    'age', public._staff_age(p_uid),
    'accountDays', public._staff_account_days(p_uid),
    'roles', (select jsonb_build_object('admin', r.is_admin, 'mod', r.is_moderator, 'jmd', r.is_baby_mod)
                from public.user_roles r where r.uid = p_uid),
    'mod', public._staff_eligibility(p_uid, 'mod'),
    'jmd', public._staff_eligibility(p_uid, 'jmd'),
    'rules', jsonb_build_object('mod', public._staff_rules('mod'), 'jmd', public._staff_rules('jmd')),
    'application', (
      select jsonb_build_object('electionId', c.election_id, 'role', e.role, 'status', c.status,
                                'appliedAt', c.created_at, 'phase', public._staff_phase(e))
        from public.staff_candidates c
        join public.staff_elections e on e.id = c.election_id
       where c.uid = p_uid and e.status = 'open' and c.withdrawn_at is null
       order by c.created_at desc limit 1),
    'term', (
      select jsonb_build_object('role', t.role, 'since', t.starts_at, 'until', t.ends_at, 'votes', t.votes)
        from public.staff_terms t where t.uid = p_uid and t.ended_at is null
       order by t.role limit 1)
  );
end
$$;

-- ---------------------------------------------------------------------
-- staff_finalize: count approved candidates only; pending ones expire.
-- ---------------------------------------------------------------------
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

  -- Applications nobody decided on are over.
  update public.staff_candidates set status = 'expired'
   where election_id = e.id and status = 'pending';

  with t as (
    select c.uid, c.squad, c.created_at, count(v.voter_uid)::int as votes
      from public.staff_candidates c
      left join public.staff_votes v on v.election_id = c.election_id and v.candidate_uid = c.uid
     where c.election_id = e.id and c.withdrawn_at is null and c.status = 'approved'
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

-- ---------------------------------------------------------------------
-- grants (the server checks admin inside; anon gets nothing)
-- ---------------------------------------------------------------------
revoke all on function public.staff_admin_applications()                               from public, anon;
revoke all on function public.staff_admin_review(bigint, text, boolean, text)           from public, anon;
revoke all on function public.staff_admin_eligibility(text)                            from public, anon;
grant execute on function public.staff_admin_applications()                              to authenticated;
grant execute on function public.staff_admin_review(bigint, text, boolean, text)          to authenticated;
grant execute on function public.staff_admin_eligibility(text)                           to authenticated;
