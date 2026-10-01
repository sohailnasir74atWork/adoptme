-- =====================================================================
-- 034 — Squad (adoptme, kvtbtzhtcaanhjblyick), 2026-09-29
--
-- Invite friends -> they join your squad -> once they're real players you
-- earn Pro days and a squad rank everyone can see.
--
-- A friend COUNTS ("qualified") only when all of these hold:
--   * their account is new (created in the last 7 days) when they join;
--   * they joined from a device that has never been credited before and
--     is not the inviter's own device (one credit per device, ever);
--   * they come back on a later UTC day (squad_ping from their app).
--
-- Rewards are server-side only (no client can write these tables):
--   inviter milestones by qualified friends: 1 -> 3 days Pro, 3 -> 14,
--   10 -> 30, 25 -> 90;  the new friend gets 3 days Pro when they qualify.
--   Squad Pro is stored here (squad_codes.pro_until); the app treats a
--   player as Pro if RevenueCat OR squad Pro says so. RevenueCat is not
--   touched (the app uses anonymous RevenueCat ids).
--
-- Visibility: user_cosmetics.squad_count (already batch-loaded with every
-- profile) carries the qualified-friend count, so the squad pill costs no
-- extra reads anywhere.
--
-- Cost: no realtime. get_my_squad when the Squad screen opens (cached),
-- squad_ping at most once a day and only for squad participants,
-- join_squad once per new player, leaderboard cached 30 min.
-- Pushes: rows in squad_events -> Database Webhook -> notifySquadEvent.
-- =====================================================================

create table if not exists public.squad_codes (
  uid             text primary key,              -- Firebase uid (the inviter)
  code            text not null unique,          -- 6 chars, no look-alikes
  device          text,                          -- inviter's device (anti self-invite)
  lang            text not null default 'en',    -- push language
  direct_count    int  not null default 0,       -- qualified friends
  total_count     int  not null default 0,       -- + qualified friends of friends
  pro_until       timestamptz,                   -- Pro earned through the squad
  rewarded_steps  int[] not null default '{}',   -- milestones already paid
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.squad_members (
  uid           text primary key,                -- the friend (one squad, ever)
  inviter_uid   text not null,
  device        text not null,
  status        text not null default 'pending' check (status in ('pending', 'qualified')),
  joined_at     timestamptz not null default now(),
  qualified_at  timestamptz
);
create unique index if not exists squad_members_device_uidx on public.squad_members (device);
create index if not exists squad_members_inviter_idx on public.squad_members (inviter_uid, status);
create index if not exists squad_members_week_idx on public.squad_members (qualified_at) where status = 'qualified';

create table if not exists public.squad_events (
  id             bigserial primary key,
  recipient_uid  text not null,
  kind           text not null,                  -- member_joined | member_qualified | reward
  friend_name    text,
  count          int,
  days           int,
  lang           text not null default 'en',
  created_at     timestamptz not null default now()
);
create index if not exists squad_events_created_idx on public.squad_events (created_at);

alter table public.squad_codes   enable row level security;
alter table public.squad_members enable row level security;
alter table public.squad_events  enable row level security;
revoke all on table public.squad_codes   from anon, authenticated;
revoke all on table public.squad_members from anon, authenticated;
revoke all on table public.squad_events  from anon, authenticated;
revoke all on sequence public.squad_events_id_seq from anon, authenticated;

-- Public pill: qualified-friend count rides along with the cosmetics row.
alter table public.user_cosmetics add column if not exists squad_count int not null default 0;

-- ---------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------
create or replace function public._squad_valid_device(p text)
returns boolean language sql immutable as $$
  select p is not null and length(p) between 6 and 128 and p !~ '\s';
$$;

create or replace function public._squad_new_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.squad_codes where code = c);
  end loop;
  return c;
end
$$;

create or replace function public._squad_rank(n int)
returns text language sql immutable as $$
  select case when n >= 50 then 'icon' when n >= 25 then 'legend'
              when n >= 10 then 'leader' when n >= 3 then 'recruiter' else null end;
$$;

-- Milestone -> Pro days for the inviter.
create or replace function public._squad_step_days(step int)
returns int language sql immutable as $$
  select case step when 1 then 3 when 3 then 14 when 10 then 30 when 25 then 90 else 0 end;
$$;

create or replace function public._squad_add_pro(p_uid text, p_days int)
returns void language plpgsql set search_path = public as $$
begin
  update public.squad_codes
     set pro_until = greatest(coalesce(pro_until, now()), now()) + make_interval(days => p_days),
         updated_at = now()
   where uid = p_uid;
end
$$;

create or replace function public._squad_ensure_row(p_uid text)
returns public.squad_codes language plpgsql set search_path = public as $$
declare r public.squad_codes;
begin
  select * into r from public.squad_codes where uid = p_uid;
  if not found then
    insert into public.squad_codes (uid, code) values (p_uid, public._squad_new_code())
    on conflict (uid) do nothing;
    select * into r from public.squad_codes where uid = p_uid;
  end if;
  return r;
end
$$;

revoke all on function public._squad_valid_device(text) from public, anon, authenticated;
revoke all on function public._squad_new_code()          from public, anon, authenticated;
revoke all on function public._squad_rank(int)           from public, anon, authenticated;
revoke all on function public._squad_step_days(int)      from public, anon, authenticated;
revoke all on function public._squad_add_pro(text, int)  from public, anon, authenticated;
revoke all on function public._squad_ensure_row(text)    from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- get_my_squad: the Squad screen. Creates the caller's code on first use.
-- ---------------------------------------------------------------------
create or replace function public.get_my_squad(p_device text default null, p_lang text default 'en')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     text := public.firebase_uid();
  r         public.squad_codes;
  m         public.squad_members;
  v_created bigint;
  v_has_id  boolean;
  v_week    int;
  v_members jsonb;
  v_inviter text;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  r := public._squad_ensure_row(v_uid);
  update public.squad_codes
     set device = case when public._squad_valid_device(p_device) then p_device else device end,
         lang   = case when p_lang in ('en','ru','es','fr','de','ar') then p_lang else lang end,
         updated_at = now()
   where uid = v_uid
  returning * into r;

  select * into m from public.squad_members where uid = v_uid;
  if found then
    select display_name into v_inviter from public.user_identity_base where uid = m.inviter_uid;
  end if;

  select exists(select 1 from public.user_identity_base where uid = v_uid),
         (select created_at_ms from public.user_identity_base where uid = v_uid)
    into v_has_id, v_created;

  select count(*) into v_week from public.squad_members
   where inviter_uid = v_uid and status = 'qualified'
     and qualified_at >= date_trunc('week', now());

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', i.display_name, 'avatar', i.avatar,
           'status', sm.status, 'joinedAt', sm.joined_at
         ) order by sm.joined_at desc), '[]'::jsonb)
    into v_members
    from (select * from public.squad_members where inviter_uid = v_uid
           order by joined_at desc limit 50) sm
    left join public.user_identity_base i on i.uid = sm.uid;

  return jsonb_build_object(
    'code', r.code,
    'direct', r.direct_count,
    'total', r.total_count,
    'week', v_week,
    'rank', public._squad_rank(r.direct_count),
    'proUntil', r.pro_until,
    'rewardedSteps', to_jsonb(r.rewarded_steps),
    'members', v_members,
    'joined', case when m.uid is null then null else jsonb_build_object(
                'inviterName', v_inviter, 'status', m.status, 'joinedAt', m.joined_at) end,
    'canJoin', m.uid is null and (not v_has_id or (v_created is not null
                 and v_created > (extract(epoch from now() - interval '7 days') * 1000)))
  );
end
$$;

-- ---------------------------------------------------------------------
-- join_squad: a NEW player enters a friend's code (or the app applies the
-- code from the Play install link). Returns {ok, reason?, inviterName?}.
-- ---------------------------------------------------------------------
create or replace function public.join_squad(p_code text, p_device text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      text := public.firebase_uid();
  v_code     text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_inviter  public.squad_codes;
  v_created  bigint;
  v_has_id   boolean;
  v_name     text;
  v_inv_name text;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if not public._squad_valid_device(p_device) then
    return jsonb_build_object('ok', false, 'reason', 'device');
  end if;
  if exists (select 1 from public.squad_members where uid = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'already_joined');
  end if;

  select * into v_inviter from public.squad_codes where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'bad_code');
  end if;
  if v_inviter.uid = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'own_code');
  end if;

  -- New accounts only. No identity row yet = created seconds ago (the
  -- mirror has not run); a row without a creation time is an old account.
  select exists(select 1 from public.user_identity_base where uid = v_uid),
         (select created_at_ms from public.user_identity_base where uid = v_uid)
    into v_has_id, v_created;
  if v_has_id and (v_created is null
      or v_created < (extract(epoch from now() - interval '7 days') * 1000)) then
    return jsonb_build_object('ok', false, 'reason', 'not_new');
  end if;

  -- One credit per device, ever; never the inviter's own phone.
  if v_inviter.device = p_device
     or exists (select 1 from public.squad_members where device = p_device) then
    return jsonb_build_object('ok', false, 'reason', 'device_used');
  end if;
  -- No two-person loops.
  if exists (select 1 from public.squad_members where uid = v_inviter.uid and inviter_uid = v_uid) then
    return jsonb_build_object('ok', false, 'reason', 'loop');
  end if;

  begin
    insert into public.squad_members (uid, inviter_uid, device) values (v_uid, v_inviter.uid, p_device);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'device_used');
  end;

  select display_name into v_name from public.user_identity_base where uid = v_uid;
  select display_name into v_inv_name from public.user_identity_base where uid = v_inviter.uid;
  insert into public.squad_events (recipient_uid, kind, friend_name, lang)
  values (v_inviter.uid, 'member_joined', left(coalesce(v_name, ''), 40), v_inviter.lang);

  return jsonb_build_object('ok', true, 'inviterName', v_inv_name);
end
$$;

-- ---------------------------------------------------------------------
-- squad_ping: once a day from the app of squad participants. Qualifies a
-- pending friend on a later day and pays rewards. Returns the caller's
-- Pro-until and counts (the app merges squad Pro into isPro).
-- ---------------------------------------------------------------------
create or replace function public.squad_ping(p_device text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       text := public.firebase_uid();
  m           public.squad_members;
  inv         public.squad_codes;
  v_parent    text;
  v_step      int;
  v_days      int;
  v_name      text;
  v_qualified boolean := false;
  me          public.squad_codes;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select * into m from public.squad_members where uid = v_uid for update;
  if found and m.status = 'pending'
     and (now() at time zone 'utc')::date > (m.joined_at at time zone 'utc')::date then

    update public.squad_members set status = 'qualified', qualified_at = now() where uid = v_uid;
    v_qualified := true;

    -- the friend's own reward
    perform public._squad_ensure_row(v_uid);
    perform public._squad_add_pro(v_uid, 3);

    -- the inviter
    update public.squad_codes
       set direct_count = direct_count + 1, total_count = total_count + 1, updated_at = now()
     where uid = m.inviter_uid
    returning * into inv;

    if inv.uid is not null then
      insert into public.user_cosmetics (uid, squad_count) values (inv.uid, inv.direct_count)
      on conflict (uid) do update set squad_count = excluded.squad_count;

      select display_name into v_name from public.user_identity_base where uid = v_uid;
      v_step := inv.direct_count;
      v_days := public._squad_step_days(v_step);
      if v_days > 0 and not (v_step = any(inv.rewarded_steps)) then
        perform public._squad_add_pro(inv.uid, v_days);
        update public.squad_codes set rewarded_steps = rewarded_steps || v_step where uid = inv.uid;
        insert into public.squad_events (recipient_uid, kind, friend_name, count, days, lang)
        values (inv.uid, 'reward', left(coalesce(v_name, ''), 40), inv.direct_count, v_days, inv.lang);
      else
        insert into public.squad_events (recipient_uid, kind, friend_name, count, lang)
        values (inv.uid, 'member_qualified', left(coalesce(v_name, ''), 40), inv.direct_count, inv.lang);
      end if;

      -- level 2: the inviter's own inviter grows their total
      select inviter_uid into v_parent from public.squad_members
       where uid = inv.uid and status = 'qualified';
      if v_parent is not null then
        update public.squad_codes set total_count = total_count + 1, updated_at = now()
         where uid = v_parent;
      end if;
    end if;
  end if;

  select * into me from public.squad_codes where uid = v_uid;
  if found and public._squad_valid_device(p_device) and me.device is distinct from p_device then
    update public.squad_codes set device = p_device where uid = v_uid;
  end if;

  return jsonb_build_object(
    'qualified', v_qualified,
    'pending', coalesce((select status = 'pending' from public.squad_members where uid = v_uid), false),
    'proUntil', me.pro_until,
    'direct', coalesce(me.direct_count, 0),
    'rank', public._squad_rank(coalesce(me.direct_count, 0))
  );
end
$$;

-- ---------------------------------------------------------------------
-- squad_leaderboard: this week's top recruiters (qualified friends).
-- ---------------------------------------------------------------------
create or replace function public.squad_leaderboard()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x order by x.n desc, x.first_at), '[]'::jsonb)
  from (
    select sm.inviter_uid as uid, count(*)::int as n, min(sm.qualified_at) as first_at,
           i.display_name as name, i.avatar,
           (select direct_count from public.squad_codes c where c.uid = sm.inviter_uid) as direct
      from public.squad_members sm
      left join public.user_identity_base i on i.uid = sm.inviter_uid
     where sm.status = 'qualified' and sm.qualified_at >= date_trunc('week', now())
     group by sm.inviter_uid, i.display_name, i.avatar
     order by count(*) desc, min(sm.qualified_at)
     limit 10
  ) x;
$$;

revoke all on function public.get_my_squad(text, text) from public, anon;
revoke all on function public.join_squad(text, text)   from public, anon;
revoke all on function public.squad_ping(text)         from public, anon;
revoke all on function public.squad_leaderboard()      from public, anon;
grant execute on function public.get_my_squad(text, text) to authenticated;
grant execute on function public.join_squad(text, text)   to authenticated;
grant execute on function public.squad_ping(text)         to authenticated;
grant execute on function public.squad_leaderboard()      to authenticated;

-- Retention: events are only a push queue.
select cron.schedule(
  'squad-events-retention',
  '47 4 * * *',
  $$ delete from public.squad_events where created_at < now() - interval '3 days'; $$
)
where not exists (select 1 from cron.job where jobname = 'squad-events-retention');
