-- =====================================================================
-- 049_birthdays.sql  (2026-10-07)
-- Birthdays: celebrate your own birthday, and other players' on theirs.
--
--   * Only MONTH and DAY ever leave the database. No function here returns
--     a year or an age; date_of_birth stays in user_identity_base (031).
--   * Your own birthday comes back to you (get_my_birthday) whatever the
--     setting. Other players only see it if they turned "Show my birthday"
--     on (birthday_prefs.show_public) AND are 13 or older. Under-13s can
--     never be shown, even if a client asks (set_birthday_visibility stores
--     false for them, and every reader re-checks the age).
--   * Blocks hide birthdays both ways.
--   * The Birthday pack: one Pet Cards pack per birthday (birthday_gifts,
--     unique per uid+year), opened through open_card_pack(set, 'birthday').
--     Its hit card is always Ultra or Legendary. Accounts younger than 30
--     days get no pack, so nobody can sign up with today's date to farm one.
--     date_of_birth is write-once (RTDB rules + 031), so it can't be moved.
--   * Wishes: four fixed templates (safe-chat friendly), one per sender per
--     birthday, at most 50 sent per day.
--   * "Today" is a UTC date on the server, so the pack and wishes accept the
--     day before and after as well: every time zone's birthday is covered.
--     The client counts days on the phone's own calendar.
--   * birthday_push_batch() is for the notifyBirthdays Cloud Function
--     (service role only): uids whose birthday is today, once a year each.
--
-- open_card_pack below is the LIVE 048 body with only the 'birthday' source
-- and its hit odds added; CREATE OR REPLACE keeps the 043 grants.
-- Run after 031, 037, 043, 048. Idempotent.
-- =====================================================================

-- Guard: open_card_pack below needs 048's card_wallet.free_count and 031's
-- user_identity_base. Stop here (nothing applied) if either is missing.
do $guard$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'card_wallet' and column_name = 'free_count') then
    raise exception '049 needs 048 (card_wallet.free_count) applied first';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'user_identity_base' and column_name = 'date_of_birth') then
    raise exception '049 needs user_identity_base.date_of_birth (031)';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- Tables (no client access: SECURITY DEFINER functions only)
-- ---------------------------------------------------------------------
create table if not exists public.birthday_prefs (
  uid          text primary key,
  show_public  boolean not null default false,
  asked_at     timestamptz,               -- we asked once ("Show it?" / Not now)
  updated_at   timestamptz not null default now()
);
create index if not exists birthday_prefs_shown_idx on public.birthday_prefs (uid) where show_public;

create table if not exists public.birthday_gifts (
  uid        text not null,
  year       int  not null,               -- the birthday's year, not the open date's
  opened_at  timestamptz not null default now(),
  primary key (uid, year)
);

create table if not exists public.birthday_wishes (
  id          bigserial primary key,
  from_uid    text not null,
  to_uid      text not null,
  year        int  not null,
  template    text not null check (template in ('hbd', 'party', 'pets', 'cake')),
  created_at  timestamptz not null default now(),
  unique (from_uid, to_uid, year)
);
create index if not exists birthday_wishes_to_idx on public.birthday_wishes (to_uid, year);
create index if not exists birthday_wishes_from_idx on public.birthday_wishes (from_uid, created_at);

create table if not exists public.birthday_pushes (
  uid      text not null,
  year     int  not null,
  sent_at  timestamptz not null default now(),
  primary key (uid, year)
);

alter table public.birthday_prefs  enable row level security;
alter table public.birthday_gifts  enable row level security;
alter table public.birthday_wishes enable row level security;
alter table public.birthday_pushes enable row level security;
revoke all on table public.birthday_prefs  from anon, authenticated;
revoke all on table public.birthday_gifts  from anon, authenticated;
revoke all on table public.birthday_wishes from anon, authenticated;
revoke all on table public.birthday_pushes from anon, authenticated;
revoke all on sequence public.birthday_wishes_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------
-- Date helpers
-- ---------------------------------------------------------------------

-- 'YYYY-MM-DD' -> {month, day}, or NULL if absent / not a real date.
create or replace function public._birthday_md(p_dob text)
returns int[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_date date;
begin
  if p_dob is null or p_dob !~ '^\d{4}-\d{1,2}-\d{1,2}$' then
    return null;
  end if;
  begin
    v_date := p_dob::date;
  exception when others then
    return null;
  end;
  return array[extract(month from v_date)::int, extract(day from v_date)::int];
end;
$$;

-- The date a (month, day) birthday falls on in p_year; 29 Feb -> 28 Feb in
-- non-leap years.
create or replace function public._birthday_on(p_year int, p_month int, p_day int)
returns date
language sql
immutable
as $$
  select make_date(p_year, p_month,
    least(p_day, extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day'))::int));
$$;

-- Days from p_from to the next birthday on or after it (0 = p_from itself).
create or replace function public._birthday_days_from(p_month int, p_day int, p_from date)
returns int
language plpgsql
immutable
as $$
declare
  v_next date := public._birthday_on(extract(year from p_from)::int, p_month, p_day);
begin
  if v_next < p_from then
    v_next := public._birthday_on(extract(year from p_from)::int + 1, p_month, p_day);
  end if;
  return v_next - p_from;
end;
$$;

-- The birthday date within one day of p_today (UTC), or NULL. Covers every
-- time zone's "today": a player's birthday can be UTC yesterday, today or
-- tomorrow while it is their local today.
create or replace function public._birthday_near(p_month int, p_day int, p_today date)
returns date
language sql
immutable
as $$
  select case when public._birthday_days_from(p_month, p_day, p_today - 1) <= 2
              then p_today - 1 + public._birthday_days_from(p_month, p_day, p_today - 1) end;
$$;

create or replace function public._birthday_today()
returns date
language sql
stable
as $$ select (now() at time zone 'utc')::date $$;

-- Visible to other players: opted in and 13 or older.
create or replace function public._birthday_public_ok(p_show boolean, p_dob text)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_show, false)
     and coalesce(public.dob_age_years(p_dob) >= public.safe_chat_minor_age(), false);
$$;

create or replace function public._birthday_blocked(p_a text, p_b text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks
     where (uid = p_a and blocked_uid = p_b) or (uid = p_b and blocked_uid = p_a)
  );
$$;

-- The year of the caller's birthday if it is "today" (±1 day) and the
-- account is at least 30 days old; NULL otherwise. Does not look at
-- birthday_gifts: the pack's insert is what makes it once a year.
create or replace function public._birthday_gift_year(p_uid text)
returns int
language plpgsql
stable
set search_path = public
as $$
declare
  v_dob     text;
  v_created bigint;
  v_md      int[];
  v_near    date;
begin
  select date_of_birth, created_at_ms into v_dob, v_created
    from public.user_identity_base where uid = p_uid;
  v_md := public._birthday_md(v_dob);
  if v_md is null then return null; end if;
  if v_created is not null
     and v_created > (extract(epoch from now()) * 1000 - 30::bigint * 86400000) then
    return null;                               -- account younger than 30 days
  end if;
  v_near := public._birthday_near(v_md[1], v_md[2], public._birthday_today());
  return extract(year from v_near)::int;       -- NULL when not near
end;
$$;

revoke all on function public._birthday_md(text) from public, anon, authenticated;
revoke all on function public._birthday_on(int, int, int) from public, anon, authenticated;
revoke all on function public._birthday_days_from(int, int, date) from public, anon, authenticated;
revoke all on function public._birthday_near(int, int, date) from public, anon, authenticated;
revoke all on function public._birthday_today() from public, anon, authenticated;
revoke all on function public._birthday_public_ok(boolean, text) from public, anon, authenticated;
revoke all on function public._birthday_blocked(text, text) from public, anon, authenticated;
revoke all on function public._birthday_gift_year(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- get_my_birthday:
--   -> {month, day, show, asked, minor, giftReady, giftOpened, wishCount,
--       wishes: [{name, avatar, template}]}   (no year, no age)
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
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select date_of_birth into v_dob from public.user_identity_base where uid = v_uid;
  v_md := public._birthday_md(v_dob);
  if v_md is null then
    return jsonb_build_object('month', null, 'day', null, 'show', false, 'asked', false, 'minor', false,
      'giftReady', false, 'giftOpened', false, 'wishCount', 0, 'wishes', '[]'::jsonb);
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
    'show', coalesce(p.show_public, false) and not v_minor,
    'asked', p.asked_at is not null,
    'minor', v_minor,
    'giftReady', v_gift is not null and not exists (select 1 from public.birthday_gifts where uid = v_uid and year = v_gift),
    'giftOpened', v_opened,
    'wishCount', v_count,
    'wishes', v_wishes
  );
end;
$$;

-- ---------------------------------------------------------------------
-- set_birthday_visibility: "Show my birthday" on/off. Also records that we
-- asked. Under-13s are always stored as hidden.
-- ---------------------------------------------------------------------
create or replace function public.set_birthday_visibility(p_show boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  text := public.firebase_uid();
  v_dob  text;
  v_show boolean;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select date_of_birth into v_dob from public.user_identity_base where uid = v_uid;
  v_show := coalesce(p_show, false)
        and coalesce(public.dob_age_years(v_dob) >= public.safe_chat_minor_age(), false);

  insert into public.birthday_prefs (uid, show_public, asked_at, updated_at)
  values (v_uid, v_show, now(), now())
  on conflict (uid) do update
     set show_public = excluded.show_public, asked_at = now(), updated_at = now();

  return jsonb_build_object('show', v_show, 'asked', true);
end;
$$;

-- ---------------------------------------------------------------------
-- list_birthdays: shown, 13+, unblocked players whose birthday is within
-- p_days (0..31) of today, plus yesterday/tomorrow slack for time zones.
--   -> [{uid, name, avatar, month, day, wishes, wished}]
-- ---------------------------------------------------------------------
create or replace function public.list_birthdays(p_days int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   text := public.firebase_uid();
  v_today date := public._birthday_today();
  v_days  int  := least(greatest(coalesce(p_days, 7), 0), 31);
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'uid', x.uid, 'name', x.name, 'avatar', x.avatar, 'month', x.m, 'day', x.d,
             'wishes', (select count(*) from public.birthday_wishes w where w.to_uid = x.uid and w.year = x.y),
             'wished', exists (select 1 from public.birthday_wishes w
                                where w.from_uid = v_uid and w.to_uid = x.uid and w.year = x.y))
           order by x.until, x.name)
      from (
        select b.uid, coalesce(b.display_name, 'Player') as name, b.avatar,
               md[1] as m, md[2] as d,
               public._birthday_days_from(md[1], md[2], v_today - 1) as until,
               extract(year from (v_today - 1 + public._birthday_days_from(md[1], md[2], v_today - 1)))::int as y
          from public.birthday_prefs p
          join public.user_identity_base b on b.uid = p.uid
          cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
         where p.show_public
           and z.md is not null
           and public._birthday_public_ok(p.show_public, b.date_of_birth)
           and not public._birthday_blocked(v_uid, b.uid)
           and public._birthday_days_from(md[1], md[2], v_today - 1) <= v_days + 2
         order by 6, 2
         limit 200
      ) x
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- get_public_birthday: {month, day} for one profile, or NULL.
-- ---------------------------------------------------------------------
create or replace function public.get_public_birthday(p_uid text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid text := public.firebase_uid();
  v_dob text;
  v_show boolean;
  v_md  int[];
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_uid is null then return null; end if;

  select b.date_of_birth, p.show_public into v_dob, v_show
    from public.user_identity_base b
    left join public.birthday_prefs p on p.uid = b.uid
   where b.uid = p_uid;

  if p_uid <> v_uid then
    if not public._birthday_public_ok(v_show, v_dob) or public._birthday_blocked(v_uid, p_uid) then
      return null;
    end if;
  end if;
  v_md := public._birthday_md(v_dob);
  if v_md is null then return null; end if;
  return jsonb_build_object('month', v_md[1], 'day', v_md[2]);
end;
$$;

-- ---------------------------------------------------------------------
-- send_birthday_wish: one fixed wish per sender per birthday.
--   -> {wishes: total wishes the player has for this birthday}
-- ---------------------------------------------------------------------
create or replace function public.send_birthday_wish(p_to text, p_template text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   text := public.firebase_uid();
  v_dob   text;
  v_show  boolean;
  v_md    int[];
  v_near  date;
  v_year  int;
  v_count int;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_template is null or p_template not in ('hbd', 'party', 'pets', 'cake') then
    raise exception 'bad template' using errcode = '22023';
  end if;
  if p_to is null or p_to = v_uid then
    raise exception 'cannot wish this player' using errcode = 'P0001';
  end if;

  select b.date_of_birth, p.show_public into v_dob, v_show
    from public.user_identity_base b
    left join public.birthday_prefs p on p.uid = b.uid
   where b.uid = p_to;
  if not found or not public._birthday_public_ok(v_show, v_dob) or public._birthday_blocked(v_uid, p_to) then
    raise exception 'cannot wish this player' using errcode = 'P0001';
  end if;

  v_md := public._birthday_md(v_dob);
  v_near := case when v_md is not null then public._birthday_near(v_md[1], v_md[2], public._birthday_today()) end;
  if v_near is null then
    raise exception 'not their birthday' using errcode = 'P0001';
  end if;
  v_year := extract(year from v_near)::int;

  if (select count(*) from public.birthday_wishes
       where from_uid = v_uid and created_at > now() - interval '1 day') >= 50 then
    raise exception 'wish limit reached' using errcode = 'P0001';
  end if;

  insert into public.birthday_wishes (from_uid, to_uid, year, template)
  values (v_uid, p_to, v_year, p_template)
  on conflict (from_uid, to_uid, year) do nothing;
  if not found then
    raise exception 'already wished' using errcode = 'P0001';
  end if;

  select count(*) into v_count from public.birthday_wishes where to_uid = p_to and year = v_year;
  return jsonb_build_object('wishes', v_count);
end;
$$;

-- ---------------------------------------------------------------------
-- birthday_push_batch (service role only, for functions/notifyBirthdays.js):
-- claims up to p_limit players whose birthday is TODAY (UTC) and who have
-- not had this year's birthday push, and returns their uids. Claiming marks
-- them, so a crashed run never pushes anyone twice.
-- ---------------------------------------------------------------------
create or replace function public.birthday_push_batch(p_limit int)
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := public._birthday_today();
  v_year  int  := extract(year from v_today)::int;
begin
  return query
  with due as (
    select b.uid
      from public.user_identity_base b
      cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
     where z.md is not null
       and public._birthday_on(v_year, z.md[1], z.md[2]) = v_today
       and (b.created_at_ms is null
            or b.created_at_ms <= extract(epoch from now()) * 1000 - 30::bigint * 86400000)
       and not exists (select 1 from public.birthday_pushes s where s.uid = b.uid and s.year = v_year)
     limit least(greatest(coalesce(p_limit, 500), 1), 2000)
  ), claimed as (
    insert into public.birthday_pushes (uid, year)
    select uid, v_year from due
    on conflict do nothing
    returning uid
  )
  select uid from claimed;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants: client RPCs for signed-in players; the batch for the server only.
-- ---------------------------------------------------------------------
revoke all on function public.get_my_birthday() from public, anon;
revoke all on function public.set_birthday_visibility(boolean) from public, anon;
revoke all on function public.list_birthdays(int) from public, anon;
revoke all on function public.get_public_birthday(text) from public, anon;
revoke all on function public.send_birthday_wish(text, text) from public, anon;
grant execute on function public.get_my_birthday() to authenticated;
grant execute on function public.set_birthday_visibility(boolean) to authenticated;
grant execute on function public.list_birthdays(int) to authenticated;
grant execute on function public.get_public_birthday(text) to authenticated;
grant execute on function public.send_birthday_wish(text, text) to authenticated;
revoke all on function public.birthday_push_batch(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- open_card_pack: the live 048 body + source 'birthday' (once per birthday,
-- hit card Ultra or Legendary). Older builds never send 'birthday'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_card_pack(p_set text, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid     text := public.firebase_uid();
  s         public.card_sets;
  w         public.card_wallet;
  v_today   int := public._cards_today();
  v_odds    jsonb;
  v_streak_bonus boolean := false;
  v_slot    int;
  v_rarity  text;
  v_finish  text;
  v_key     text;
  v_got_legend boolean := false;
  v_got_holo   boolean := false;
  v_cards   jsonb := '[]'::jsonb;
  v_keys    text[] := '{}';
  v_pulled  text[] := '{}';
  v_tries   int;
  v_order   text[];
  v_settle  jsonb;
  v_bday_year int;                                                       -- 049
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_source not in ('free', 'stars', 'bonus', 'birthday') then        -- 049: + birthday
    raise exception 'bad source' using errcode = '22023';
  end if;

  select * into s from public.card_sets where id = p_set and active and kind = 'pack';
  if not found or (s.starts_at is not null and s.starts_at > now())
               or (s.ends_at is not null and s.ends_at <= now()) then
    raise exception 'pack not available' using errcode = 'P0001';
  end if;

  perform public._cards_ensure_wallet(v_uid);
  select * into w from public.card_wallet where uid = v_uid for update;   -- one pack at a time

  if p_source = 'free' then
    if w.free_day >= v_today and w.free_count >= 2 then   -- 048: two free packs a day
      raise exception 'free pack already opened today' using errcode = 'P0001';
    end if;
    if w.free_day < v_today then
      -- First free pack of the day. The streak counts days, not packs.
      w.streak := case when w.free_day = v_today - 1 then w.streak + 1 else 1 end;
      w.free_day := v_today;
      w.free_count := 1;
      if w.streak % 7 = 0 then
        w.bonus_packs := w.bonus_packs + 1;
        v_streak_bonus := true;
      end if;
    else
      w.free_count := w.free_count + 1;
    end if;
  elsif p_source = 'stars' then
    if w.star_day <> v_today then
      w.star_day := v_today;
      w.star_count := 0;
    end if;
    if w.star_count >= 2 then
      raise exception 'star pack limit reached' using errcode = 'P0001';
    end if;
    w.star_count := w.star_count + 1;
  elsif p_source = 'birthday' then                                       -- 049
    v_bday_year := public._birthday_gift_year(v_uid);
    if v_bday_year is null then
      raise exception 'birthday pack not available' using errcode = 'P0001';
    end if;
    insert into public.birthday_gifts (uid, year) values (v_uid, v_bday_year)
    on conflict (uid, year) do nothing;
    if not found then
      raise exception 'birthday pack not available' using errcode = 'P0001';
    end if;
  else
    if w.bonus_packs <= 0 then
      raise exception 'no bonus packs' using errcode = 'P0001';
    end if;
    w.bonus_packs := w.bonus_packs - 1;
  end if;

  update public.card_wallet
     set streak = w.streak, free_day = w.free_day, free_count = w.free_count, bonus_packs = w.bonus_packs,
         star_day = w.star_day, star_count = w.star_count,
         packs_opened = packs_opened + 1, updated_at = now()
   where uid = v_uid;

  v_odds := public._cards_odds(p_set);
  if p_source = 'birthday' then                                          -- 049: Ultra or better
    v_odds := jsonb_set(v_odds, '{hit}', '{"ultra": 70, "legendary": 30}'::jsonb);
  end if;

  for v_slot in 1..3 loop
    -- Rarity: slot 3 is the hit slot; Legendary pity forces it.
    if v_slot = 3 and not v_got_legend and w.pity_legend + 1 >= (v_odds ->> 'pity_legend')::int then
      v_rarity := 'legendary';
    else
      v_rarity := public._cards_weighted(case when v_slot = 3 then v_odds -> 'hit' else v_odds -> 'slot' end);
    end if;

    -- If the set has no pullable card of that rarity, walk to the nearest one.
    v_order := case v_rarity
      when 'common'    then array['common', 'uncommon', 'rare', 'ultra', 'legendary']
      when 'uncommon'  then array['uncommon', 'common', 'rare', 'ultra', 'legendary']
      when 'rare'      then array['rare', 'uncommon', 'ultra', 'common', 'legendary']
      when 'ultra'     then array['ultra', 'rare', 'legendary', 'uncommon', 'common']
      else                  array['legendary', 'ultra', 'rare', 'uncommon', 'common'] end;
    v_key := null;
    for v_tries in 1..5 loop
      v_rarity := v_order[v_tries];
      -- New-card bias: pick from the cards the player doesn't own yet.
      if random() < (v_odds ->> 'bias')::numeric then
        select c.key into v_key from public.card_catalog c
         where c.active and c.hd_ready and c.rarity = v_rarity and public._cards_in_set(c, p_set)
           and not (c.key = any(v_pulled))
           and not exists (select 1 from public.card_collection cc where cc.uid = v_uid and cc.card_key = c.key)
         order by random() limit 1;
      end if;
      if v_key is null then
        select c.key into v_key from public.card_catalog c
         where c.active and c.hd_ready and c.rarity = v_rarity and public._cards_in_set(c, p_set)
         order by random() limit 1;
      end if;
      exit when v_key is not null;
    end loop;
    if v_key is null then
      raise exception 'no cards in this pack yet' using errcode = 'P0001';
    end if;
    if v_rarity = 'legendary' then v_got_legend := true; end if;

    -- Finish: Holo+ pity forces at least Holo on the hit slot.
    if v_slot = 3 and not v_got_holo and w.pity_holo + 1 >= (v_odds ->> 'pity_holo')::int then
      v_finish := public._cards_weighted((v_odds -> 'finish') - 'classic' - 'foil' - 'neon');
    else
      v_finish := public._cards_weighted(v_odds -> 'finish');
    end if;
    if v_finish in ('holo', 'gilded', 'mega', 'fullart') then v_got_holo := true; end if;

    v_cards := v_cards || public._cards_add(v_uid, v_key, v_finish, p_set, p_source);
    v_keys := v_keys || v_key;
    v_pulled := v_pulled || v_key;
  end loop;

  update public.card_wallet
     set pity_legend = case when v_got_legend then 0 else pity_legend + 1 end,
         pity_holo   = case when v_got_holo   then 0 else pity_holo + 1 end
   where uid = v_uid;

  v_settle := public._cards_settle(v_uid, v_keys);
  select * into w from public.card_wallet where uid = v_uid;

  return jsonb_build_object(
    'cards', v_cards,
    'wallet', public._cards_wallet_json(w),
    'streakBonus', v_streak_bonus,
    'completed', v_settle -> 'completed',
    'rewardShards', v_settle -> 'rewardShards'
  );
end
$function$;
