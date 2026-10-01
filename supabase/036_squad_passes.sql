-- =====================================================================
-- 036 — Squad Pro passes (adoptme, kvtbtzhtcaanhjblyick), 2026-10-01
--
-- Squad rewards used to start Pro the moment a friend counted, so a player
-- who was away that week burned it. Rewards are now PASSES: kept on the
-- server under the player's uid, started with a tap (activate_squad_pass)
-- whenever they like. There is no code to copy, so a pass cannot be sold
-- or traded, and there is no "license key" for App Review to object to.
--
--   * inviter milestones (1/3/10/25 friends) -> 3/14/30/90-day passes;
--   * the new friend, once they count -> a 3-day welcome pass;
--   * unused passes expire 30 days after they are earned;
--   * activating while Pro is on adds the days to the end (_squad_add_pro).
--
-- Replaces squad_ping and get_my_squad from 034 (same signatures, extra
-- keys only), so the 034 app keeps working. Run after 034/035. Idempotent.
-- =====================================================================

create table if not exists public.squad_passes (
  id            bigserial primary key,
  uid           text not null,                   -- Firebase uid of the owner
  days          int  not null check (days > 0),
  source        text not null check (source in ('welcome', 'milestone')),
  step          int  not null default 0,         -- milestone friend count; 0 = welcome
  earned_at     timestamptz not null default now(),
  expires_at    timestamptz not null,
  activated_at  timestamptz
);
-- Each reward is paid once, even if squad_ping runs twice.
create unique index if not exists squad_passes_once_uidx on public.squad_passes (uid, source, step);
create index if not exists squad_passes_open_idx on public.squad_passes (uid) where activated_at is null;

alter table public.squad_passes enable row level security;
revoke all on table public.squad_passes from anon, authenticated;
revoke all on sequence public.squad_passes_id_seq from anon, authenticated;

create or replace function public._squad_grant_pass(p_uid text, p_days int, p_source text, p_step int)
returns void language plpgsql set search_path = public as $$
begin
  insert into public.squad_passes (uid, days, source, step, expires_at)
  values (p_uid, p_days, p_source, p_step, now() + interval '30 days')
  on conflict (uid, source, step) do nothing;
end
$$;

create or replace function public._squad_open_passes(p_uid text)
returns int language sql stable set search_path = public as $$
  select count(*)::int from public.squad_passes
   where uid = p_uid and activated_at is null and expires_at > now();
$$;

revoke all on function public._squad_grant_pass(text, int, text, int) from public, anon, authenticated;
revoke all on function public._squad_open_passes(text)                from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- get_my_squad: 034 + `passes` (the caller's unused, unexpired passes).
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
  v_passes  jsonb;
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'days', p.days, 'source', p.source, 'step', p.step,
           'earnedAt', p.earned_at, 'expiresAt', p.expires_at
         ) order by p.expires_at), '[]'::jsonb)
    into v_passes
    from public.squad_passes p
   where p.uid = v_uid and p.activated_at is null and p.expires_at > now();

  return jsonb_build_object(
    'code', r.code,
    'direct', r.direct_count,
    'total', r.total_count,
    'week', v_week,
    'rank', public._squad_rank(r.direct_count),
    'proUntil', r.pro_until,
    'rewardedSteps', to_jsonb(r.rewarded_steps),
    'members', v_members,
    'passes', v_passes,
    'joined', case when m.uid is null then null else jsonb_build_object(
                'inviterName', v_inviter, 'status', m.status, 'joinedAt', m.joined_at) end,
    'canJoin', m.uid is null and (not v_has_id or (v_created is not null
                 and v_created > (extract(epoch from now() - interval '7 days') * 1000)))
  );
end
$$;

-- ---------------------------------------------------------------------
-- squad_ping: as 034, but rewards are passes instead of running Pro.
-- Returns `passes` (open pass count) so the app can show the badge.
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

    -- the friend's own reward: a welcome pass
    perform public._squad_grant_pass(v_uid, 3, 'welcome', 0);

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
        perform public._squad_grant_pass(inv.uid, v_days, 'milestone', v_step);
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
    'rank', public._squad_rank(coalesce(me.direct_count, 0)),
    'passes', public._squad_open_passes(v_uid)
  );
end
$$;

-- ---------------------------------------------------------------------
-- activate_squad_pass: the owner starts one of their passes now.
-- Returns {ok, days, proUntil, passes} or {ok:false, reason}.
-- ---------------------------------------------------------------------
create or replace function public.activate_squad_pass(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := public.firebase_uid();
  p     public.squad_passes;
  me    public.squad_codes;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select * into p from public.squad_passes where id = p_id and uid = v_uid for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if p.activated_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'used');
  end if;
  if p.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  update public.squad_passes set activated_at = now() where id = p.id;
  perform public._squad_ensure_row(v_uid);
  perform public._squad_add_pro(v_uid, p.days);
  select * into me from public.squad_codes where uid = v_uid;

  return jsonb_build_object(
    'ok', true,
    'days', p.days,
    'proUntil', me.pro_until,
    'passes', public._squad_open_passes(v_uid)
  );
end
$$;

revoke all on function public.activate_squad_pass(bigint) from public, anon;
grant execute on function public.activate_squad_pass(bigint) to authenticated;
-- 034's grants on get_my_squad / squad_ping survive `create or replace`.

-- Retention: an unused pass is gone 30 days after it expired.
select cron.schedule(
  'squad-passes-retention',
  '53 4 * * *',
  $$ delete from public.squad_passes where activated_at is null and expires_at < now() - interval '30 days'; $$
)
where not exists (select 1 from cron.job where jobname = 'squad-passes-retention');
