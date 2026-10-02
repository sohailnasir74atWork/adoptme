-- =====================================================================
-- 041 — Staff elections: the admin has the final say
--       (adoptme, kvtbtzhtcaanhjblyick), 2026-10-02
--
-- Owner's request, 2026-10-02: an election must not change the team by
-- itself. Before this file staff_finalize handed the seats to the winners,
-- ended every other holder's term, and runStaffElections wrote the roles
-- into RTDB and opened the next race, with nobody looking.
--
-- Now a closed election is only COUNTED. The tally, who met the bar, and a
-- suggestion land in Admin Dashboard → Elections, and nothing changes until
-- an admin decides, player by player:
--
--   appoint   a candidate who reached min_votes and is not banned right now
--   remove    a sitting MOD / JMD of that role (never an admin)
--   none      no change for that player (recorded so the panel shows it)
--
-- "appoint" and "remove" are final for that election; "none" can be turned
-- into one of the two later, while the election is still under review.
-- "Finish review" closes it. The next election is started by an admin,
-- never automatically; the panel says when a term has run out. The
-- suggestion is only a suggestion: the top `seats` qualified candidates
-- (banned ones left out), and the holders who are not among them.
--
-- RTDB stays the source of truth for roles. runStaffElections applies the
-- appoint / remove decisions (and pushes the winners); the admin app also
-- writes the flag the moment the admin taps, so the change shows at once.
-- Both paths are idempotent.
--
-- Lifecycle: open → counted (staff_finalize, service role, once closes_at
-- has passed) → finalized (staff_admin_finish). cancelled stays for open
-- races. One live election per role means open OR counted.
--
-- The tables were empty when this was written (0 elections), so nothing
-- needs a backfill. Idempotent: safe to run twice.
-- =====================================================================

-- ---------------------------------------------------------------------
-- columns, statuses, decisions
-- ---------------------------------------------------------------------
alter table public.staff_elections drop constraint if exists staff_elections_status_check;
alter table public.staff_elections
  add constraint staff_elections_status_check
  check (status in ('open', 'counted', 'finalized', 'cancelled'));

alter table public.staff_elections
  add column if not exists counted_at timestamptz,       -- votes frozen, waiting for an admin
  add column if not exists decided_by text;              -- admin who finished the review

-- One live election per role: open or under review.
drop index if exists public.staff_elections_one_open;
create unique index if not exists staff_elections_one_live
  on public.staff_elections (role) where status in ('open', 'counted');

alter table public.staff_candidates
  add column if not exists votes     int,                -- frozen at count
  add column if not exists qualified boolean;            -- votes >= min_votes at count

create table if not exists public.staff_decisions (
  id           bigserial primary key,
  election_id  bigint not null references public.staff_elections (id) on delete cascade,
  role         text   not null check (role in ('mod', 'jmd')),
  uid          text   not null,
  kind         text   not null check (kind in ('appoint', 'remove', 'none')),
  decided_by   text   not null,                          -- admin uid
  decided_at   timestamptz not null default now(),
  applied_at   timestamptz,                              -- role flag written to RTDB
  notified_at  timestamptz,                              -- winner push sent (appoint only)
  unique (election_id, uid)
);
create index if not exists staff_decisions_pending_idx
  on public.staff_decisions (kind) where applied_at is null or notified_at is null;

alter table public.staff_decisions enable row level security;
revoke all on table public.staff_decisions from anon, authenticated;
revoke all on sequence public.staff_decisions_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------
-- phase: 'review' = counted, waiting for an admin
-- ---------------------------------------------------------------------
create or replace function public._staff_phase(e public.staff_elections)
returns text language sql stable as $$
  select case
    when e.status = 'cancelled' then 'cancelled'
    when e.status = 'finalized' then 'finalized'
    when e.status = 'counted'   then 'review'
    when now() < e.nominations_at then 'upcoming'
    when now() < e.voting_at then 'nominations'
    when now() < e.closes_at then 'voting'
    else 'counting'                               -- closed, waiting for runStaffElections to count
  end;
$$;

-- Does p_uid hold p_role right now (per the user_roles mirror)? Admins never count as holders.
create or replace function public._staff_holds(p_uid text, p_role text)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
     where r.uid = p_uid and not r.is_admin
       and case when p_role = 'mod' then r.is_moderator else r.is_baby_mod end);
$$;
revoke all on function public._staff_holds(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- staff_finalize: COUNT a closed election. No seats change hands here.
-- Service role only (runStaffElections). Safe to call again.
-- ---------------------------------------------------------------------
create or replace function public.staff_finalize(p_election bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e            public.staff_elections;
  v_tally      jsonb;
  v_qualified  text[];
begin
  select * into e from public.staff_elections where id = p_election for update;
  if not found then
    return jsonb_build_object('id', p_election, 'skipped', 'missing');
  end if;
  if e.status = 'counted' then
    return jsonb_build_object('id', e.id, 'role', e.role, 'skipped', 'counted');
  end if;
  if e.status = 'finalized' then
    return jsonb_build_object('id', e.id, 'role', e.role, 'skipped', 'finalized');
  end if;
  if e.status <> 'open' or now() < e.closes_at then
    return jsonb_build_object('id', e.id, 'skipped', 'not_closed');
  end if;

  -- Applications nobody decided on are over.
  update public.staff_candidates set status = 'expired'
   where election_id = e.id and status = 'pending';

  -- Freeze each approved candidate's votes and whether they met the bar.
  update public.staff_candidates c
     set votes = (select count(*)::int from public.staff_votes v
                   where v.election_id = c.election_id and v.candidate_uid = c.uid)
   where c.election_id = e.id and c.withdrawn_at is null and c.status = 'approved';
  update public.staff_candidates c
     set qualified = (coalesce(c.votes, 0) >= e.min_votes)
   where c.election_id = e.id and c.withdrawn_at is null and c.status = 'approved';

  select coalesce(jsonb_agg(jsonb_build_object('uid', c.uid, 'votes', coalesce(c.votes, 0), 'qualified', c.qualified)
                            order by coalesce(c.votes, 0) desc, c.squad desc, c.created_at), '[]'::jsonb),
         coalesce(array_agg(c.uid order by coalesce(c.votes, 0) desc, c.squad desc, c.created_at)
                  filter (where c.qualified), '{}')
    into v_tally, v_qualified
    from public.staff_candidates c
   where c.election_id = e.id and c.withdrawn_at is null and c.status = 'approved';

  update public.staff_elections
     set status = 'counted', counted_at = now(), results = v_tally
   where id = e.id;

  return jsonb_build_object(
    'id', e.id, 'role', e.role, 'counted', true,
    'seats', e.seats, 'minVotes', e.min_votes,
    'candidates', jsonb_array_length(v_tally),
    'qualified', to_jsonb(v_qualified),
    'turnout', (select count(*) from public.staff_votes v where v.election_id = e.id));
end
$$;

-- The old election-level "applied" stamp is gone; decisions carry their own.
drop function if exists public.staff_mark_applied(bigint);

-- Elections to count: open and past closes_at.
create or replace function public.staff_due()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'role', role) order by closes_at), '[]'::jsonb)
    from public.staff_elections
   where status = 'open' and closes_at <= now();
$$;

-- ---------------------------------------------------------------------
-- The review of one counted election, for the Admin Dashboard.
-- ---------------------------------------------------------------------
create or replace function public._staff_result(e public.staff_elections)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_appoint  text[];
  v_remove   text[];
  v_cands    jsonb;
  v_holders  jsonb;
begin
  -- Suggested seats: the top `seats` candidates who met the bar and are not banned now.
  select coalesce(array_agg(s.uid order by s.votes desc, s.squad desc, s.created_at), '{}') into v_appoint
    from (select c.uid, coalesce(c.votes, 0) as votes, c.squad, c.created_at
            from public.staff_candidates c
           where c.election_id = e.id and c.withdrawn_at is null and c.status = 'approved'
             and coalesce(c.qualified, false)
             and not public._staff_banned_now(c.uid)
           order by coalesce(c.votes, 0) desc, c.squad desc, c.created_at
           limit e.seats) s;

  -- Suggested removals: holders of the role who are not suggested for a seat.
  select coalesce(array_agg(r.uid order by r.uid), '{}') into v_remove
    from public.user_roles r
   where not r.is_admin
     and case when e.role = 'mod' then r.is_moderator else r.is_baby_mod end
     and not (r.uid = any(v_appoint));

  select coalesce(jsonb_agg(jsonb_build_object(
           'uid', c.uid, 'name', c.name, 'avatar', c.avatar, 'pitch', c.pitch,
           'votes', coalesce(c.votes, 0),
           'qualified', coalesce(c.qualified, false),
           'squadAtEntry', c.squad, 'ageAtEntry', c.age,
           'accountDays', public._staff_account_days(c.uid),
           'check', public._staff_eligibility(c.uid, e.role, e.min_squad, e.min_age),
           'holder', public._staff_holds(c.uid, e.role),
           'suggested', c.uid = any(v_appoint),
           'decision', (select d.kind from public.staff_decisions d where d.election_id = e.id and d.uid = c.uid)
         ) order by coalesce(c.votes, 0) desc, c.squad desc, c.created_at), '[]'::jsonb)
    into v_cands
    from public.staff_candidates c
   where c.election_id = e.id and c.withdrawn_at is null and c.status = 'approved';

  select coalesce(jsonb_agg(jsonb_build_object(
           'uid', r.uid, 'name', i.display_name, 'avatar', i.avatar,
           'elected', t.id is not null, 'since', t.starts_at, 'until', t.ends_at, 'votes', t.votes,
           'candidate', exists (select 1 from public.staff_candidates c
                                 where c.election_id = e.id and c.uid = r.uid
                                   and c.withdrawn_at is null and c.status = 'approved'),
           'suggestRemove', r.uid = any(v_remove),
           'decision', (select d.kind from public.staff_decisions d where d.election_id = e.id and d.uid = r.uid)
         ) order by i.display_name, r.uid), '[]'::jsonb)
    into v_holders
    from public.user_roles r
    left join public.user_identity_base i on i.uid = r.uid
    left join public.staff_terms t on t.uid = r.uid and t.role = e.role and t.ended_at is null
   where not r.is_admin
     and case when e.role = 'mod' then r.is_moderator else r.is_baby_mod end;

  return jsonb_build_object(
    'id', e.id, 'role', e.role, 'seats', e.seats, 'minVotes', e.min_votes, 'termDays', e.term_days,
    'closesAt', e.closes_at, 'countedAt', e.counted_at,
    'turnout', (select count(*) from public.staff_votes v where v.election_id = e.id),
    'candidates', v_cands,
    'holders', v_holders,
    'suggestion', jsonb_build_object('appoint', to_jsonb(v_appoint), 'remove', to_jsonb(v_remove)),
    'appointed', (select count(*) from public.staff_decisions d where d.election_id = e.id and d.kind = 'appoint'),
    'removed',   (select count(*) from public.staff_decisions d where d.election_id = e.id and d.kind = 'remove'));
end
$$;
revoke all on function public._staff_result(public.staff_elections) from public, anon, authenticated;

-- Everything waiting for an admin: counted elections, and terms that have
-- run out while no race is open or under review for that role.
create or replace function public.staff_admin_results()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_elections jsonb;
  v_alerts    jsonb;
begin
  if not public._staff_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(public._staff_result(e) order by e.closes_at), '[]'::jsonb)
    into v_elections
    from public.staff_elections e
   where e.status = 'counted';

  select coalesce(jsonb_agg(jsonb_build_object(
           'role', t.role, 'uid', t.uid, 'name', i.display_name, 'avatar', i.avatar,
           'since', t.starts_at, 'endedAt', t.ends_at
         ) order by t.ends_at), '[]'::jsonb)
    into v_alerts
    from public.staff_terms t
    left join public.user_identity_base i on i.uid = t.uid
   where t.ended_at is null and t.ends_at < now()
     and not exists (select 1 from public.staff_elections e
                      where e.role = t.role and e.status in ('open', 'counted'));

  return jsonb_build_object('now', now(), 'elections', v_elections, 'termAlerts', v_alerts);
end
$$;

-- One decision about one player in a counted election.
--   appoint: a qualified, approved candidate who is not banned now (not an admin)
--   remove:  a current holder of the role (never an admin)
--   none:    no change (candidate or holder); can still become appoint/remove later
-- appoint and remove are final for this election.
create or replace function public.staff_admin_decide(p_election bigint, p_uid text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e        public.staff_elections;
  cur      public.staff_decisions;
  cand     public.staff_candidates;
  v_holder boolean;
begin
  if not public._staff_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('appoint', 'remove', 'none') then
    return jsonb_build_object('ok', false, 'reason', 'kind');
  end if;
  if p_uid is null or length(p_uid) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_target');
  end if;

  select * into e from public.staff_elections where id = p_election for update;
  if not found or e.status <> 'counted' then
    return jsonb_build_object('ok', false, 'reason', 'not_counted');
  end if;

  select * into cur from public.staff_decisions where election_id = e.id and uid = p_uid;
  if found and cur.kind in ('appoint', 'remove') then
    return jsonb_build_object('ok', false, 'reason', 'decided', 'kind', cur.kind);
  end if;

  v_holder := public._staff_holds(p_uid, e.role);
  select * into cand from public.staff_candidates
   where election_id = e.id and uid = p_uid and withdrawn_at is null and status = 'approved';

  if p_kind = 'appoint' then
    if cand.uid is null or not coalesce(cand.qualified, false) then
      return jsonb_build_object('ok', false, 'reason', 'not_qualified');
    end if;
    if exists (select 1 from public.user_roles r where r.uid = p_uid and r.is_admin) then
      return jsonb_build_object('ok', false, 'reason', 'is_admin');
    end if;
    if public._staff_banned_now(p_uid) then
      return jsonb_build_object('ok', false, 'reason', 'banned');
    end if;
  elsif p_kind = 'remove' then
    if not v_holder then
      return jsonb_build_object('ok', false, 'reason', 'not_holder');
    end if;
  else
    if cand.uid is null and not v_holder then
      return jsonb_build_object('ok', false, 'reason', 'not_in_election');
    end if;
  end if;

  insert into public.staff_decisions (election_id, role, uid, kind, decided_by)
  values (e.id, e.role, p_uid, p_kind, public.firebase_uid())
  on conflict (election_id, uid) do update
     set kind = excluded.kind, decided_by = excluded.decided_by, decided_at = now(),
         applied_at = null, notified_at = null;

  if p_kind = 'appoint' then
    -- A sitting holder who won again starts a fresh term.
    update public.staff_terms set ended_at = now(), end_reason = 'reelected'
     where role = e.role and uid = p_uid and ended_at is null;
    insert into public.staff_terms (role, uid, election_id, votes, starts_at, ends_at)
    values (e.role, p_uid, e.id, coalesce(cand.votes, 0), now(), now() + make_interval(days => e.term_days));
    -- A JMD appointed MOD leaves the JMD seat.
    if e.role = 'mod' then
      update public.staff_terms set ended_at = now(), end_reason = 'promoted'
       where role = 'jmd' and uid = p_uid and ended_at is null;
    end if;
  elsif p_kind = 'remove' then
    update public.staff_terms set ended_at = now(), end_reason = 'replaced'
     where role = e.role and uid = p_uid and ended_at is null;
  end if;

  return jsonb_build_object('ok', true, 'kind', p_kind, 'role', e.role);
end
$$;

-- Close the review. Undecided candidates stay off the team; undecided
-- holders keep their role. Nothing is scheduled: an admin starts the next race.
create or replace function public.staff_admin_finish(p_election bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.staff_elections;
  v_winners text[];
begin
  if not public._staff_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into e from public.staff_elections where id = p_election for update;
  if not found or e.status <> 'counted' then
    return jsonb_build_object('ok', false, 'reason', 'not_counted');
  end if;

  select coalesce(array_agg(d.uid order by d.decided_at), '{}') into v_winners
    from public.staff_decisions d where d.election_id = e.id and d.kind = 'appoint';

  update public.staff_elections
     set status = 'finalized', finalized_at = now(), applied_at = now(),
         decided_by = public.firebase_uid(), winners = v_winners
   where id = e.id;

  return jsonb_build_object('ok', true, 'role', e.role,
    'appointed', coalesce(array_length(v_winners, 1), 0),
    'removed', (select count(*) from public.staff_decisions d where d.election_id = e.id and d.kind = 'remove'));
end
$$;

-- Start an election now. Refused while the last one is still under review.
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
  if exists (select 1 from public.staff_elections where role = p_role and status = 'counted') then
    return jsonb_build_object('ok', false, 'reason', 'review_pending');
  end if;
  if exists (select 1 from public.staff_elections where role = p_role and status = 'open') then
    return jsonb_build_object('ok', false, 'reason', 'already_open');
  end if;
  return jsonb_build_object('ok', true,
    'id', public._staff_open(p_role, p_seats, now(), public.firebase_uid()));
end
$$;

-- ---------------------------------------------------------------------
-- Service role (runStaffElections): decisions to apply, and terms to check.
-- ---------------------------------------------------------------------

-- appoint / remove decisions whose RTDB write or winner push is still owed.
create or replace function public.staff_pending_apply()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'electionId', d.election_id, 'role', d.role, 'uid', d.uid, 'kind', d.kind,
           'appliedAt', d.applied_at, 'notifiedAt', d.notified_at,
           'until', (select t.ends_at from public.staff_terms t
                      where t.uid = d.uid and t.role = d.role and t.election_id = d.election_id and t.ended_at is null
                      limit 1)
         ) order by d.decided_at), '[]'::jsonb)
    from public.staff_decisions d
   where d.kind in ('appoint', 'remove')
     and (d.applied_at is null or (d.kind = 'appoint' and d.notified_at is null));
$$;

create or replace function public.staff_decision_applied(p_id bigint)
returns void language sql security definer set search_path = public as $$
  update public.staff_decisions set applied_at = now() where id = p_id and applied_at is null;
$$;

create or replace function public.staff_decision_notified(p_id bigint)
returns void language sql security definer set search_path = public as $$
  update public.staff_decisions set notified_at = now() where id = p_id and notified_at is null;
$$;

-- Active terms whose holder's RTDB flag can be checked: an appointment that
-- is not yet written to RTDB is skipped, or it would read as "removed".
create or replace function public.staff_terms_open()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('role', t.role, 'uid', t.uid) order by t.role, t.uid), '[]'::jsonb)
    from public.staff_terms t
   where t.ended_at is null
     and not exists (select 1 from public.staff_decisions d
                      where d.uid = t.uid and d.role = t.role and d.kind = 'appoint' and d.applied_at is null);
$$;

-- ---------------------------------------------------------------------
-- staff_elections_get: the Elections screen. Counted elections show as
-- 'review' with the votes visible; 'won' means an admin appointed them.
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
    select e.* from public.staff_elections e where e.status in ('open', 'counted')
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
           'myApplication', (
             select jsonb_build_object('status', c.status, 'pitch', c.pitch, 'note', c.review_note,
                                       'appliedAt', c.created_at, 'reviewedAt', c.reviewed_at)
               from public.staff_candidates c
              where c.election_id = e.id and c.uid = v_uid and c.withdrawn_at is null
           ),
           'pending', case when v_admin then (
             select count(*) from public.staff_candidates c
              where c.election_id = e.id and c.status = 'pending' and c.withdrawn_at is null
           ) end,
           'candidates', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'uid', c.uid, 'name', c.name, 'avatar', c.avatar, 'pitch', c.pitch, 'squad', c.squad,
                      -- Counts stay hidden while people are still voting.
                      'votes', case when e.status in ('counted', 'finalized') then coalesce(c.votes, t.votes) end,
                      'qualified', case when e.status in ('counted', 'finalized') then coalesce(c.qualified, false) end,
                      'won', case
                               when e.status = 'finalized' then c.uid = any(coalesce(e.winners, '{}'))
                               when e.status = 'counted' then exists (
                                 select 1 from public.staff_decisions d
                                  where d.election_id = e.id and d.uid = c.uid and d.kind = 'appoint')
                             end
                    ) order by
                      case when e.status in ('counted', 'finalized') then coalesce(c.votes, t.votes) end desc nulls last,
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
    'reviewPending', case when v_admin then (
      select count(*) from public.staff_elections e where e.status = 'counted'
    ) end,
    'elections', v_elections,
    'team', v_team
  );
end
$$;

-- ---------------------------------------------------------------------
-- grants (the admin RPCs check admin inside; anon gets nothing)
-- ---------------------------------------------------------------------
revoke all on function public.staff_admin_results()                      from public, anon;
revoke all on function public.staff_admin_decide(bigint, text, text)     from public, anon;
revoke all on function public.staff_admin_finish(bigint)                 from public, anon;
grant  execute on function public.staff_admin_results()                  to authenticated;
grant  execute on function public.staff_admin_decide(bigint, text, text) to authenticated;
grant  execute on function public.staff_admin_finish(bigint)             to authenticated;

revoke all on function public.staff_pending_apply()         from public, anon, authenticated;
revoke all on function public.staff_decision_applied(bigint) from public, anon, authenticated;
revoke all on function public.staff_decision_notified(bigint) from public, anon, authenticated;
revoke all on function public.staff_terms_open()            from public, anon, authenticated;
grant  execute on function public.staff_pending_apply()          to service_role;
grant  execute on function public.staff_decision_applied(bigint) to service_role;
grant  execute on function public.staff_decision_notified(bigint) to service_role;
grant  execute on function public.staff_terms_open()             to service_role;
