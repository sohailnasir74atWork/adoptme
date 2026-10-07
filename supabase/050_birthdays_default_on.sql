-- =====================================================================
-- 050_birthdays_default_on.sql  (2026-10-07)
-- Birthdays, owner's follow-up to 049:
--
--   * Shown BY DEFAULT. A player with no birthday_prefs row now counts as
--     showing their birthday (month and day only); "Hide my birthday" stores
--     show_public = false. Under-13s are still never shown to anyone.
--   * Because nearly everyone now shows, list_birthdays no longer starts from
--     birthday_prefs: it looks birthdays up by month/day through a new
--     expression index on user_identity_base, and lists only players active
--     in the last 30 days (a dormant account's birthday is just noise).
--   * Birthday corrections: a player may change the MONTH and DAY of their
--     birth date once (the year stays as first entered). The change itself is
--     made by the updateBirthday Cloud Function, which records it in
--     birthday_edits (one row per uid = once ever). get_my_birthday reports
--     canEdit so the app only offers it while it is still unused.
--
-- Run after 049. Idempotent. Old app builds never call any of this.
-- =====================================================================

-- ---------------------------------------------------------------------
-- One correction per player (written by the updateBirthday function with
-- the service role; no client access).
-- ---------------------------------------------------------------------
create table if not exists public.birthday_edits (
  uid        text primary key,
  old_dob    text not null,
  new_dob    text not null,
  edited_at  timestamptz not null default now()
);
alter table public.birthday_edits enable row level security;
revoke all on table public.birthday_edits from anon, authenticated;

-- ---------------------------------------------------------------------
-- month * 100 + day ("2010-10-07" -> 1007), or NULL. Immutable, for the
-- index below.
-- ---------------------------------------------------------------------
create or replace function public._birthday_key(p_dob text)
returns int
language sql
immutable
set search_path = public
as $$
  select case when md is null then null else md[1] * 100 + md[2] end
    from (select public._birthday_md(p_dob) as md) z;
$$;
revoke all on function public._birthday_key(text) from public, anon, authenticated;

create index if not exists user_identity_base_birthday_key_idx
  on public.user_identity_base (public._birthday_key(date_of_birth));

-- ---------------------------------------------------------------------
-- Shown unless the player chose Hide (NULL = no choice = shown), and only
-- if 13 or older. get_public_birthday and send_birthday_wish use this.
-- ---------------------------------------------------------------------
create or replace function public._birthday_public_ok(p_show boolean, p_dob text)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_show, true)
     and coalesce(public.dob_age_years(p_dob) >= public.safe_chat_minor_age(), false);
$$;

-- ---------------------------------------------------------------------
-- get_my_birthday: as 049, plus show defaults to true and canEdit.
-- ---------------------------------------------------------------------
create or replace function public.get_my_birthday()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  v_dob    text;
  v_md     int[];
  v_minor  boolean;
  p        public.birthday_prefs;
  v_near   date;
  v_year   int;
  v_gift   int;
  v_opened boolean := false;
  v_count  int := 0;
  v_wishes jsonb := '[]'::jsonb;
  v_can_edit boolean;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  v_can_edit := not exists (select 1 from public.birthday_edits where uid = v_uid);
  select date_of_birth into v_dob from public.user_identity_base where uid = v_uid;
  v_md := public._birthday_md(v_dob);
  if v_md is null then
    return jsonb_build_object('month', null, 'day', null, 'show', false, 'asked', false, 'minor', false,
      'giftReady', false, 'giftOpened', false, 'wishCount', 0, 'wishes', '[]'::jsonb, 'canEdit', false);
  end if;

  v_minor := coalesce(public.dob_age_years(v_dob) < public.safe_chat_minor_age(), false);
  select * into p from public.birthday_prefs where uid = v_uid;

  v_near := public._birthday_near(v_md[1], v_md[2], public._birthday_today());
  if v_near is not null then
    v_year := extract(year from v_near)::int;
    v_opened := exists (select 1 from public.birthday_gifts where uid = v_uid and year = v_year);
    select count(*) into v_count from public.birthday_wishes where to_uid = v_uid and year = v_year;
    select coalesce(jsonb_agg(jsonb_build_object('name', coalesce(i.display_name, 'Player'), 'avatar', i.avatar,
                                                 'template', w.template) order by w.created_at desc), '[]'::jsonb)
      into v_wishes
      from (select * from public.birthday_wishes
             where to_uid = v_uid and year = v_year
             order by created_at desc limit 50) w
      left join public.user_identity_base i on i.uid = w.from_uid;
  end if;
  v_gift := public._birthday_gift_year(v_uid);

  return jsonb_build_object(
    'month', v_md[1], 'day', v_md[2],
    'show', coalesce(p.show_public, true) and not v_minor,            -- 050: on by default
    'asked', p.asked_at is not null,
    'minor', v_minor,
    'giftReady', v_gift is not null and not exists (select 1 from public.birthday_gifts where uid = v_uid and year = v_gift),
    'giftOpened', v_opened,
    'wishCount', v_count,
    'wishes', v_wishes,
    'canEdit', v_can_edit                                              -- 050
  );
end;
$$;

-- ---------------------------------------------------------------------
-- list_birthdays: everyone 13+ who has not hidden their birthday, active in
-- the last 30 days, unblocked, birthday within p_days (0..31) of today with
-- a day of slack either side for time zones. Soonest first, then the most
-- recently active.   -> [{uid, name, avatar, month, day, wishes, wished}]
-- ---------------------------------------------------------------------
create or replace function public.list_birthdays(p_days int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  v_today  date := public._birthday_today();
  v_days   int  := least(greatest(coalesce(p_days, 7), 0), 31);
  v_keys   int[] := '{}';
  v_d      date;
  v_active bigint := (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  -- The month/day keys of every date from yesterday to today + days + 1.
  -- 29 Feb birthdays are celebrated on 28 Feb in non-leap years.
  for v_d in select generate_series(v_today - 1, v_today + v_days + 1, interval '1 day')::date loop
    v_keys := v_keys || (extract(month from v_d)::int * 100 + extract(day from v_d)::int);
    if extract(month from v_d) = 2 and extract(day from v_d) = 28
       and extract(day from (v_d + 1)) = 1 then
      v_keys := v_keys || 229;
    end if;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'uid', x.uid, 'name', x.name, 'avatar', x.avatar, 'month', x.m, 'day', x.d,
             'wishes', (select count(*) from public.birthday_wishes w where w.to_uid = x.uid and w.year = x.y),
             'wished', exists (select 1 from public.birthday_wishes w
                                where w.from_uid = v_uid and w.to_uid = x.uid and w.year = x.y))
           order by x.until, x.active desc)
      from (
        select b.uid, coalesce(b.display_name, 'Player') as name, b.avatar,
               z.md[1] as m, z.md[2] as d, b.last_activity_ms as active,
               public._birthday_days_from(z.md[1], z.md[2], v_today - 1) as until,
               extract(year from (v_today - 1 + public._birthday_days_from(z.md[1], z.md[2], v_today - 1)))::int as y
          from public.user_identity_base b
          left join public.birthday_prefs p on p.uid = b.uid
          cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
         where public._birthday_key(b.date_of_birth) = any(v_keys)
           and z.md is not null
           and b.last_activity_ms > v_active
           and public._birthday_public_ok(p.show_public, b.date_of_birth)
           and not public._birthday_blocked(v_uid, b.uid)
           and public._birthday_days_from(z.md[1], z.md[2], v_today - 1) <= v_days + 2
         order by until, active desc
         limit 200
      ) x
  ), '[]'::jsonb);
end;
$$;
