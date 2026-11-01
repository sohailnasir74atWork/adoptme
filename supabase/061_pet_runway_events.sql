-- =====================================================================
-- 061 — Pet Runway events (adoptme, kvtbtzhtcaanhjblyick), 2026-10-31
--
-- MODs schedule Pet Runway events from a safe toolkit; admins approve
-- (owner 2026-10-31, Ops/proposals/pet-runway-demo/PLAN.md section 9).
--
-- An event = one theme from the app's library (pre-translated in all 7
-- languages, so no free text reaches players) + UTC start/end dates
-- (1–14 days, start within 90 days) + up to 3 featured scenes and 8
-- featured items + a preset stamp style and banner colour + a prize tier
-- (normal / big, used once voting exists) + an optional note for admins.
--
-- Rules the server enforces:
--   * MODs and admins (is_staff()) create and edit DRAFTS; JMDs cannot.
--     A MOD edits or deletes only their own draft.
--   * Only admins (_staff_is_admin()) approve or cancel. Approved events
--     never overlap; an approved event cannot be edited (cancel and redo).
--   * Nothing here touches prizes, Pro or votes.
--   * Every action is written to runway_event_log (who, what, when).
--   * created_by is kept so a creator's entries and votes can be left out
--     of their own event once voting exists (Phase 2b).
--
-- Reads: runway_calendar (signed-in players, a few rows, cached on the
-- phone for 6 h; guests keep the app's built-in daily ideas, because new
-- functions are never granted to anon). No realtime.
--
-- ⚠️ _runway_theme_keys() must match THEMES in
--    Code/PetRunway/game/world.js (__tests__/petRunway.test.js checks).
-- Run after 060. Idempotent.
-- =====================================================================

create table if not exists public.runway_events (
  id          bigserial primary key,
  theme_key   text not null check (theme_key ~ '^[a-z0-9_]{1,40}$'),
  starts_on   date not null,
  ends_on     date not null,
  featured    jsonb not null default '{}'::jsonb,   -- {"scenes":["snow"],"items":["beanie","scarf"]}
  style       jsonb not null default '{}'::jsonb,   -- {"stamp":"snow","banner":"#6EC6FF"}
  prize_tier  text not null default 'normal' check (prize_tier in ('normal', 'big')),
  status      text not null default 'draft' check (status in ('draft', 'approved', 'cancelled')),
  note        text check (note is null or length(note) <= 300),
  created_by  text not null,
  approved_by text,
  cancelled_by text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint runway_events_dates check (ends_on >= starts_on and ends_on - starts_on <= 13)
);
create index if not exists runway_events_live_idx on public.runway_events (starts_on, ends_on) where status = 'approved';

create table if not exists public.runway_event_log (
  id        bigserial primary key,
  event_id  bigint not null,
  actor     text not null,
  action    text not null check (action in ('create', 'edit', 'approve', 'cancel', 'delete')),
  details   jsonb not null default '{}'::jsonb,
  at        timestamptz not null default now()
);
create index if not exists runway_event_log_event_idx on public.runway_event_log (event_id, at);

-- No policies: only the functions below (SECURITY DEFINER) read or write.
alter table public.runway_events enable row level security;
alter table public.runway_event_log enable row level security;
revoke all on public.runway_events, public.runway_event_log from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public._runway_theme_keys()
returns text[] language sql immutable as $$
  select array[
    'spooky_cute', 'candy_princess', 'starry_ball', 'under_sea', 'royal_garden', 'cozy_winter', 'rainbow_dream',
    'winter_princess', 'ocean_party', 'fairy_forest', 'birthday_bash', 'haunted_ball', 'snow_day', 'spring_bloom',
    'beach_day', 'disco_night', 'sweet_treats', 'moonlight_magic', 'holiday_cheer', 'garden_party'
  ];
$$;

create or replace function public._runway_today()
returns date language sql stable as $$ select (now() at time zone 'utc')::date $$;

-- Featured lists: arrays of short keys, capped; anything else is refused.
create or replace function public._runway_keys_ok(p jsonb, p_max int)
returns boolean language sql immutable as $$
  select p is null or (
    jsonb_typeof(p) = 'array' and jsonb_array_length(p) <= p_max
    and not exists (select 1 from jsonb_array_elements(p) e
                     where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z0-9_]{1,30}$')
  );
$$;

create or replace function public._runway_event_json(e public.runway_events)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'id', e.id, 'theme', e.theme_key, 'starts_on', e.starts_on, 'ends_on', e.ends_on,
    'featured', e.featured, 'style', e.style, 'prize_tier', e.prize_tier);
$$;

create or replace function public._runway_log(p_event bigint, p_action text, p_details jsonb default '{}'::jsonb)
returns void language sql as $$
  insert into public.runway_event_log (event_id, actor, action, details)
  values (p_event, coalesce(public.firebase_uid(), '?'), p_action, coalesce(p_details, '{}'::jsonb));
$$;

-- An approved event other than p_skip that shares a day with [p_start, p_end].
create or replace function public._runway_overlaps(p_start date, p_end date, p_skip bigint)
returns boolean language sql stable as $$
  select exists (select 1 from public.runway_events
                  where status = 'approved' and id is distinct from p_skip
                    and starts_on <= p_end and ends_on >= p_start);
$$;

revoke all on function public._runway_theme_keys()                      from public, anon, authenticated;
revoke all on function public._runway_today()                           from public, anon, authenticated;
revoke all on function public._runway_keys_ok(jsonb, int)               from public, anon, authenticated;
revoke all on function public._runway_event_json(public.runway_events)  from public, anon, authenticated;
revoke all on function public._runway_log(bigint, text, jsonb)          from public, anon, authenticated;
revoke all on function public._runway_overlaps(date, date, bigint)      from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- runway_calendar: approved events touching [p_from, p_to] (max 62 days).
-- ---------------------------------------------------------------------
create or replace function public.runway_calendar(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if public.firebase_uid() is null then raise exception 'sign_in'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then raise exception 'bad_range'; end if;
  return coalesce((
    select jsonb_agg(public._runway_event_json(e) order by e.starts_on)
      from public.runway_events e
     where e.status = 'approved' and e.starts_on <= p_to and e.ends_on >= p_from), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- runway_events_staff: the Events screen (MODs and admins).
-- Drafts and approved events that have not ended, plus the last 30 days.
-- ---------------------------------------------------------------------
create or replace function public.runway_events_staff()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid text := public.firebase_uid();
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  return jsonb_build_object(
    'me', v_uid,
    'is_admin', public._staff_is_admin(),
    'today', public._runway_today(),
    'events', coalesce((
      select jsonb_agg(public._runway_event_json(e) || jsonb_build_object(
               'status', e.status, 'note', e.note, 'mine', e.created_by = v_uid,
               'created_by', e.created_by,
               'created_by_name', (select display_name from public.user_identity_base u where u.uid = e.created_by),
               'approved_by_name', (select display_name from public.user_identity_base u where u.uid = e.approved_by),
               'updated_at', e.updated_at)
             order by e.starts_on, e.id)
        from public.runway_events e
       where e.ends_on >= public._runway_today() - 30
         and (e.status <> 'cancelled' or e.updated_at > now() - interval '30 days')), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- runway_event_save: create (p_id null) or edit a draft.
-- ---------------------------------------------------------------------
create or replace function public.runway_event_save(
  p_id bigint, p_theme text, p_start date, p_end date,
  p_featured jsonb default '{}'::jsonb, p_style jsonb default '{}'::jsonb,
  p_prize text default 'normal', p_note text default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   text := public.firebase_uid();
  v_today date := public._runway_today();
  v_e     public.runway_events;
  v_feat  jsonb := coalesce(p_featured, '{}'::jsonb);
  v_style jsonb := coalesce(p_style, '{}'::jsonb);
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  if p_theme is null or not (p_theme = any (public._runway_theme_keys())) then raise exception 'bad_theme'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 13 then raise exception 'bad_dates'; end if;
  if p_start < v_today or p_start > v_today + 90 then raise exception 'bad_dates'; end if;
  if coalesce(p_prize, '') not in ('normal', 'big') then raise exception 'bad_prize'; end if;
  if jsonb_typeof(v_feat) <> 'object' or jsonb_typeof(v_style) <> 'object'
     or not public._runway_keys_ok(v_feat -> 'scenes', 3)
     or not public._runway_keys_ok(v_feat -> 'items', 8)
     or exists (select 1 from jsonb_object_keys(v_feat) k where k not in ('scenes', 'items'))
     or exists (select 1 from jsonb_object_keys(v_style) k where k not in ('stamp', 'banner'))
     or coalesce(v_style ->> 'stamp', 'classic') not in ('classic', 'gold', 'night', 'candy', 'snow', 'holo')
     or coalesce(v_style ->> 'banner', '#FF4F9A') !~ '^#[0-9A-F]{6}$' then
    raise exception 'bad_options';
  end if;
  if v_note is not null and length(v_note) > 300 then raise exception 'bad_note'; end if;
  if public._runway_overlaps(p_start, p_end, p_id) then raise exception 'overlap'; end if;

  if p_id is null then
    insert into public.runway_events (theme_key, starts_on, ends_on, featured, style, prize_tier, note, created_by)
    values (p_theme, p_start, p_end, v_feat, v_style, p_prize, v_note, v_uid)
    returning * into v_e;
    perform public._runway_log(v_e.id, 'create', public._runway_event_json(v_e));
  else
    select * into v_e from public.runway_events where id = p_id for update;
    if not found then raise exception 'not_found'; end if;
    if v_e.status <> 'draft' then raise exception 'not_draft'; end if;
    if v_e.created_by <> v_uid and not public._staff_is_admin() then raise exception 'not_yours'; end if;
    update public.runway_events
       set theme_key = p_theme, starts_on = p_start, ends_on = p_end, featured = v_feat, style = v_style,
           prize_tier = p_prize, note = v_note, updated_at = now()
     where id = p_id returning * into v_e;
    perform public._runway_log(v_e.id, 'edit', public._runway_event_json(v_e));
  end if;
  return v_e.id;
end;
$$;

-- ---------------------------------------------------------------------
-- runway_event_approve: admins only; the draft goes live on its dates.
-- ---------------------------------------------------------------------
create or replace function public.runway_event_approve(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e public.runway_events;
begin
  if not public._staff_is_admin() then raise exception 'not_admin'; end if;
  select * into v_e from public.runway_events where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_e.status <> 'draft' then raise exception 'not_draft'; end if;
  if v_e.ends_on < public._runway_today() then raise exception 'bad_dates'; end if;
  if public._runway_overlaps(v_e.starts_on, v_e.ends_on, v_e.id) then raise exception 'overlap'; end if;
  update public.runway_events
     set status = 'approved', approved_by = public.firebase_uid(), updated_at = now()
   where id = p_id returning * into v_e;
  perform public._runway_log(v_e.id, 'approve');
  return public._runway_event_json(v_e);
end;
$$;

-- ---------------------------------------------------------------------
-- runway_event_cancel: admins cancel any event (also a live one: the app
-- falls back to the daily idea); a MOD may delete their own draft.
-- ---------------------------------------------------------------------
create or replace function public.runway_event_cancel(p_id bigint, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := public.firebase_uid();
  v_e   public.runway_events;
  v_admin boolean := public._staff_is_admin();
begin
  if not public.is_staff() then raise exception 'not_staff'; end if;
  select * into v_e from public.runway_events where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_e.status = 'cancelled' then return; end if;
  if not v_admin and not (v_e.status = 'draft' and v_e.created_by = v_uid) then raise exception 'not_allowed'; end if;
  update public.runway_events set status = 'cancelled', cancelled_by = v_uid, updated_at = now() where id = p_id;
  perform public._runway_log(p_id, case when v_admin then 'cancel' else 'delete' end,
                             jsonb_build_object('reason', left(coalesce(p_reason, ''), 200)));
end;
$$;

revoke all on function public.runway_calendar(date, date)                                         from public, anon;
revoke all on function public.runway_events_staff()                                               from public, anon;
revoke all on function public.runway_event_save(bigint, text, date, date, jsonb, jsonb, text, text) from public, anon;
revoke all on function public.runway_event_approve(bigint)                                        from public, anon;
revoke all on function public.runway_event_cancel(bigint, text)                                   from public, anon;
grant execute on function public.runway_calendar(date, date)                                         to authenticated;
grant execute on function public.runway_events_staff()                                               to authenticated;
grant execute on function public.runway_event_save(bigint, text, date, date, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.runway_event_approve(bigint)                                        to authenticated;
grant execute on function public.runway_event_cancel(bigint, text)                                   to authenticated;
