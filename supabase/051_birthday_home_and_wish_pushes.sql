-- =====================================================================
-- 051_birthday_home_and_wish_pushes.sql  (2026-10-07)
-- Birthdays, cost and notifications (owner's call, option B):
--
--   * birthday_home(): ONE small call for Home, Settings and the chat 🎂
--     badges: your own birthday (as get_my_birthday) plus `today`, the
--     [uid, month, day] of shown players whose birthday is within a day of
--     today (UTC slack for time zones; the phone keeps only its local today).
--     No names or photos: a few KB instead of the up-to-200-row week list,
--     which is now fetched only when someone opens the Birthdays screen.
--   * Wish notifications, at most TWO per birthday:
--       1. the first wish: "BunnyQueen wished you a happy birthday 🎂";
--       2. one summary 8 hours later, only if more wishes came in:
--          "You got 12 birthday wishes 🎉".
--     birthday_wish_push_batch() claims both kinds for the
--     notifyBirthdayWishes Cloud Function (service role only). Claiming
--     marks them, so a retried or crashed run never pushes twice.
--
-- Run after 050. Idempotent. Old app builds never call any of this.
-- =====================================================================

create table if not exists public.birthday_wish_pushes (
  uid          text not null,
  year         int  not null,
  first_at     timestamptz not null default now(),
  first_count  int  not null,           -- wishes when the first push went out
  summary_at   timestamptz,
  primary key (uid, year)
);
alter table public.birthday_wish_pushes enable row level security;
revoke all on table public.birthday_wish_pushes from anon, authenticated;
create index if not exists birthday_wishes_created_idx on public.birthday_wishes (created_at);

-- ---------------------------------------------------------------------
-- birthday_home: get_my_birthday() + today: [[uid, month, day], ...]
-- ---------------------------------------------------------------------
create or replace function public.birthday_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  v_today  date := public._birthday_today();
  v_keys   int[] := '{}';
  v_d      date;
  v_active bigint := (extract(epoch from now()) * 1000)::bigint - 30::bigint * 86400000;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  for v_d in select generate_series(v_today - 1, v_today + 1, interval '1 day')::date loop
    v_keys := v_keys || (extract(month from v_d)::int * 100 + extract(day from v_d)::int);
    if extract(month from v_d) = 2 and extract(day from v_d) = 28
       and extract(day from (v_d + 1)) = 1 then
      v_keys := v_keys || 229;
    end if;
  end loop;

  return public.get_my_birthday() || jsonb_build_object('today', coalesce((
    select jsonb_agg(jsonb_build_array(x.uid, x.m, x.d))
      from (
        select b.uid, z.md[1] as m, z.md[2] as d
          from public.user_identity_base b
          left join public.birthday_prefs p on p.uid = b.uid
          cross join lateral (select public._birthday_md(b.date_of_birth) as md) z
         where public._birthday_key(b.date_of_birth) = any(v_keys)
           and z.md is not null
           and b.last_activity_ms > v_active
           and public._birthday_public_ok(p.show_public, b.date_of_birth)
           and not public._birthday_blocked(v_uid, b.uid)
         limit 1000
      ) x
  ), '[]'::jsonb));
end;
$$;
revoke all on function public.birthday_home() from public, anon;
grant execute on function public.birthday_home() to authenticated;

-- ---------------------------------------------------------------------
-- birthday_wish_push_batch (service role only):
--   -> rows {kind 'first'|'summary', uid, from_name, wishes}
-- ---------------------------------------------------------------------
create or replace function public.birthday_wish_push_batch(p_limit int)
returns table (kind text, uid text, from_name text, wishes int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 500), 1), 2000);
begin
  -- 1. First wish of a birthday: claim, then report who sent it.
  return query
  with fresh as (
    select w.to_uid, w.year, count(*)::int as n, min(w.created_at) as first_at
      from public.birthday_wishes w
     where w.created_at > now() - interval '2 days'
       and not exists (select 1 from public.birthday_wish_pushes s where s.uid = w.to_uid and s.year = w.year)
     group by w.to_uid, w.year
     limit v_limit
  ), claimed as (
    insert into public.birthday_wish_pushes (uid, year, first_count)
    select to_uid, year, n from fresh
    on conflict do nothing
    returning birthday_wish_pushes.uid, birthday_wish_pushes.year, birthday_wish_pushes.first_count
  )
  select 'first'::text, c.uid,
         coalesce((select i.display_name
                     from public.birthday_wishes w
                     left join public.user_identity_base i on i.uid = w.from_uid
                    where w.to_uid = c.uid and w.year = c.year
                    order by w.created_at limit 1), 'Someone'),
         c.first_count
    from claimed c;

  -- 2. Summary, 8 hours after the first push, only if more wishes came in.
  return query
  with due as (
    select s.uid, s.year, (select count(*)::int from public.birthday_wishes w
                            where w.to_uid = s.uid and w.year = s.year) as n
      from public.birthday_wish_pushes s
     where s.summary_at is null
       and s.first_at <= now() - interval '8 hours'
       and s.first_at > now() - interval '2 days'
     limit v_limit
  ), claimed as (
    update public.birthday_wish_pushes s
       set summary_at = now()
      from due
     where s.uid = due.uid and s.year = due.year and s.summary_at is null
       and due.n > s.first_count
    returning s.uid, due.n
  )
  select 'summary'::text, c.uid, null::text, c.n from claimed c;
end;
$$;
revoke all on function public.birthday_wish_push_batch(int) from public, anon, authenticated;
