-- =====================================================================
-- 032 — Trade Match (adoptme, kvtbtzhtcaanhjblyick), 2026-09-29
--
-- "Get your dream pet": find players who have a pet you want AND want a
-- pet you have, and push a player when someone lists their dream pet.
--
-- Cost model (why it looks like this):
--   * No realtime. The app calls find_trade_matches() when the Trade Match
--     screen opens (cached 10 min on the phone) — one indexed query.
--   * The phone upserts its lists only when they change (hash-gated) and at
--     most once a week otherwise, through sync_trade_inventory().
--   * Only pets the player has already made public in the app are stored:
--     owned pets marked "For Trade" and wishlist pets marked "Trading"
--     (both already shown on the profile), plus the dream pet they pick.
--   * Dream-pet pushes: one row in trade_match_alerts per recipient; a
--     Database Webhook on INSERT calls the notifyTradeMatch Cloud Function.
--     Capped at 50 recipients per listing, 1 push per recipient per 20 h,
--     1 alert burst per lister per hour.
--
-- Tables are service-role only (RLS on, no policies, grants revoked); the
-- app reaches them only through the SECURITY DEFINER functions below.
--
-- Run order: paste this whole file in the SQL Editor (idempotent). Then add
-- the Database Webhook described at the end.
-- =====================================================================

create table if not exists public.trade_inventory (
  uid                 text primary key,                 -- Firebase uid
  have_keys           text[] not null default '{}',     -- item keys offered ("For Trade")
  want_keys           text[] not null default '{}',     -- item keys wanted (public wishlist + dream)
  have                jsonb  not null default '[]'::jsonb,  -- [{k,n,v,f,r,i}] for display
  want                jsonb  not null default '[]'::jsonb,
  dream_key           text,                             -- the one pet they want most
  lang                text   not null default 'en',     -- push language
  alerts_enabled      boolean not null default true,
  client_synced       boolean not null default false,   -- false = backfilled from Firestore (no pushes)
  last_alert_at       timestamptz,                      -- last dream-pet push RECEIVED
  last_sent_alert_at  timestamptz,                      -- last alert burst this user CAUSED
  updated_at          timestamptz not null default now()
);

create index if not exists idx_trade_inventory_have
  on public.trade_inventory using gin (have_keys);
create index if not exists idx_trade_inventory_dream
  on public.trade_inventory (dream_key) where dream_key is not null;
create index if not exists idx_trade_inventory_updated
  on public.trade_inventory (updated_at);

create table if not exists public.trade_match_alerts (
  id             bigserial primary key,
  recipient_uid  text not null,
  from_uid       text not null,
  from_name      text,
  pet_key        text not null,
  pet_name       text,
  lang           text not null default 'en',
  created_at     timestamptz not null default now()
);
create index if not exists idx_trade_match_alerts_created
  on public.trade_match_alerts (created_at);

create table if not exists public.trade_match_wins (
  uid         text not null,
  pet_key     text not null,
  created_at  timestamptz not null default now(),
  primary key (uid, pet_key)
);
create index if not exists idx_trade_match_wins_created
  on public.trade_match_wins (created_at);

alter table public.trade_inventory    enable row level security;
alter table public.trade_match_alerts enable row level security;
alter table public.trade_match_wins   enable row level security;
revoke all on table public.trade_inventory    from anon, authenticated;
revoke all on table public.trade_match_alerts from anon, authenticated;
revoke all on table public.trade_match_wins   from anon, authenticated;
revoke all on sequence public.trade_match_alerts_id_seq from anon, authenticated;

-- ---------------------------------------------------------------------
-- _tm_clean_list: keep only well-formed entries, known fields, no dupes.
-- Entry: {k:"frostdragon|pet", n:"Frost Dragon", v:"d|n|m", f:bool, r:bool, i:"image path"}
-- ---------------------------------------------------------------------
create or replace function public._tm_clean_list(p jsonb, p_max int)
returns jsonb
language plpgsql immutable
set search_path = public
as $$
declare
  v_out  jsonb  := '[]'::jsonb;
  v_seen text[] := '{}';
  e      jsonb;
  k      text;
  v      text;
  f      boolean;
  r      boolean;
  sig    text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    return v_out;
  end if;
  for e in select value from jsonb_array_elements(p) loop
    exit when jsonb_array_length(v_out) >= p_max;
    continue when jsonb_typeof(e) <> 'object';
    k := e->>'k';
    continue when k is null or k !~ '^[a-z0-9]{1,60}\|[a-z]{1,12}$';
    v := coalesce(e->>'v', 'd');
    if v not in ('d', 'n', 'm') then v := 'd'; end if;
    f := coalesce(e->'f' = 'true'::jsonb, false);
    r := coalesce(e->'r' = 'true'::jsonb, false);
    sig := k || ':' || v || ':' || f::text || ':' || r::text;
    continue when sig = any(v_seen);
    v_seen := v_seen || sig;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'k', k,
      'n', left(coalesce(e->>'n', ''), 60),
      'v', v,
      'f', f,
      'r', r,
      'i', left(coalesce(e->>'i', ''), 300)
    ));
  end loop;
  return v_out;
end
$$;
revoke all on function public._tm_clean_list(jsonb, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- sync_trade_inventory: the caller's own lists. Returns counts + how many
-- dream-pet alerts this sync queued.
-- ---------------------------------------------------------------------
create or replace function public.sync_trade_inventory(
  p_have   jsonb,
  p_want   jsonb,
  p_dream  text    default null,
  p_lang   text    default 'en',
  p_alerts boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        text := public.firebase_uid();
  v_have       jsonb;
  v_want       jsonb;
  v_have_keys  text[];
  v_want_keys  text[];
  v_old        public.trade_inventory%rowtype;
  v_new_keys   text[];
  v_dream      text;
  v_lang       text;
  v_name       text;
  v_alerts     int := 0;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  v_have := public._tm_clean_list(p_have, 150);
  v_want := public._tm_clean_list(p_want, 150);
  select coalesce(array_agg(distinct x->>'k'), '{}') into v_have_keys from jsonb_array_elements(v_have) x;
  select coalesce(array_agg(distinct x->>'k'), '{}') into v_want_keys from jsonb_array_elements(v_want) x;
  v_dream := case when p_dream = any(v_want_keys) then p_dream end;
  v_lang  := case when p_lang in ('en', 'ru', 'es', 'fr', 'de', 'ar') then p_lang else 'en' end;

  select * into v_old from public.trade_inventory where uid = v_uid for update;

  insert into public.trade_inventory as t
    (uid, have_keys, want_keys, have, want, dream_key, lang, alerts_enabled, client_synced, updated_at)
  values
    (v_uid, v_have_keys, v_want_keys, v_have, v_want, v_dream, v_lang, coalesce(p_alerts, true), true, now())
  on conflict (uid) do update set
    have_keys      = excluded.have_keys,
    want_keys      = excluded.want_keys,
    have           = excluded.have,
    want           = excluded.want,
    dream_key      = excluded.dream_key,
    lang           = excluded.lang,
    alerts_enabled = excluded.alerts_enabled,
    client_synced  = true,
    updated_at     = now();

  -- Dream-pet alerts for pets this player has just put up for trade.
  v_new_keys := array(
    select unnest(v_have_keys)
    except
    select unnest(coalesce(v_old.have_keys, '{}'::text[]))
  );

  if cardinality(v_new_keys) > 0
     and (v_old.last_sent_alert_at is null or v_old.last_sent_alert_at < now() - interval '1 hour') then

    select display_name into v_name from public.user_identity_base where uid = v_uid;

    with r as (
      select t.uid as recipient, t.dream_key, t.lang
      from public.trade_inventory t
      where t.dream_key = any(v_new_keys)
        and t.uid <> v_uid
        and t.alerts_enabled
        and t.client_synced
        and t.updated_at > now() - interval '30 days'
        and (t.last_alert_at is null or t.last_alert_at < now() - interval '20 hours')
        and not exists (
          select 1 from public.user_blocks b
          where (b.uid = t.uid and b.blocked_uid = v_uid)
             or (b.uid = v_uid and b.blocked_uid = t.uid)
        )
      order by (t.have_keys && v_want_keys) desc, t.updated_at desc
      limit 50
    ), ins as (
      insert into public.trade_match_alerts (recipient_uid, from_uid, from_name, pet_key, pet_name, lang)
      select r.recipient, v_uid, left(coalesce(v_name, ''), 40), r.dream_key,
             (select x->>'n' from jsonb_array_elements(v_have) x where x->>'k' = r.dream_key limit 1),
             r.lang
      from r
      returning recipient_uid
    )
    update public.trade_inventory t
       set last_alert_at = now()
      from ins
     where t.uid = ins.recipient_uid;
    get diagnostics v_alerts = row_count;

    if v_alerts > 0 then
      update public.trade_inventory set last_sent_alert_at = now() where uid = v_uid;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'have', cardinality(v_have_keys),
    'want', cardinality(v_want_keys),
    'alerts', v_alerts
  );
end
$$;

-- ---------------------------------------------------------------------
-- find_trade_matches: players who have something the caller wants.
-- `full` = they also want something the caller offers. `dream` = they
-- have the caller's dream pet. Only players active in the last 45 days.
-- ---------------------------------------------------------------------
create or replace function public.find_trade_matches(p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  text := public.firebase_uid();
  v_me   public.trade_inventory%rowtype;
  v_res  jsonb;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;

  select * into v_me from public.trade_inventory where uid = v_uid;
  if not found or cardinality(v_me.want_keys) = 0 then
    return '[]'::jsonb;
  end if;

  with c as (
    select t.uid, t.have, t.want, t.updated_at,
           (t.want_keys && v_me.have_keys) as full_match,
           (v_me.dream_key is not null and v_me.dream_key = any(t.have_keys)) as dream_hit
    from public.trade_inventory t
    where t.have_keys && v_me.want_keys
      and t.uid <> v_uid
      and t.updated_at > now() - interval '45 days'
      and not exists (
        select 1 from public.user_blocks b
        where (b.uid = t.uid and b.blocked_uid = v_uid)
           or (b.uid = v_uid and b.blocked_uid = t.uid)
      )
    order by dream_hit desc, full_match desc, t.updated_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'uid',            c.uid,
           'name',           i.display_name,
           'avatar',         i.avatar,
           'robloxUsername', r.roblox_username,
           'verified',       coalesce(r.roblox_username_verified, false),
           'isPro',          coalesce(co.is_pro, false),
           'lastActiveMs',   i.last_activity_ms,
           'full',           c.full_match,
           'dream',          c.dream_hit,
           'gives', (select coalesce(jsonb_agg(x), '[]'::jsonb)
                       from jsonb_array_elements(c.have) x
                      where x->>'k' = any(v_me.want_keys)),
           'wants', (select coalesce(jsonb_agg(x), '[]'::jsonb)
                       from jsonb_array_elements(c.want) x
                      where x->>'k' = any(v_me.have_keys)),
           'updatedAt',      c.updated_at
         ) order by c.dream_hit desc, c.full_match desc,
                    coalesce(i.last_activity_ms, 0) desc), '[]'::jsonb)
    into v_res
    from c
    left join public.user_identity_base i  on i.uid  = c.uid
    left join public.user_roblox        r  on r.uid  = c.uid
    left join public.user_cosmetics     co on co.uid = c.uid;

  return v_res;
end
$$;

-- ---------------------------------------------------------------------
-- trade_match_stats: social proof for the screen header.
-- ---------------------------------------------------------------------
create or replace function public.trade_match_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'traders', (select count(*) from public.trade_inventory
                 where updated_at > now() - interval '30 days'
                   and cardinality(have_keys) > 0),
    'found7d', (select count(*) from public.trade_match_wins
                 where created_at > now() - interval '7 days')
  );
$$;

-- ---------------------------------------------------------------------
-- report_dream_found: "I got it!" — one row per player per pet.
-- ---------------------------------------------------------------------
create or replace function public.report_dream_found(p_key text)
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
  if p_key is not null and p_key ~ '^[a-z0-9]{1,60}\|[a-z]{1,12}$' then
    insert into public.trade_match_wins (uid, pet_key) values (v_uid, p_key)
    on conflict do nothing;
  end if;
  return public.trade_match_stats();
end
$$;

revoke all on function public.sync_trade_inventory(jsonb, jsonb, text, text, boolean) from public, anon;
revoke all on function public.find_trade_matches(int)  from public, anon;
revoke all on function public.trade_match_stats()      from public, anon;
revoke all on function public.report_dream_found(text) from public, anon;
grant execute on function public.sync_trade_inventory(jsonb, jsonb, text, text, boolean) to authenticated;
grant execute on function public.find_trade_matches(int)  to authenticated;
grant execute on function public.trade_match_stats()      to authenticated;
grant execute on function public.report_dream_found(text) to authenticated;

-- ---------------------------------------------------------------------
-- Retention (pg_cron, same pattern as 027). Idempotent.
--   alerts:     3 days (the webhook has already fired)
--   inventory:  120 days untouched (the app re-syncs weekly while in use)
--   wins:       60 days (the header only counts the last 7)
-- ---------------------------------------------------------------------
select cron.schedule(
  'trade-match-retention',
  '41 4 * * *',
  $$
    delete from public.trade_match_alerts where created_at < now() - interval '3 days';
    delete from public.trade_inventory    where updated_at < now() - interval '120 days';
    delete from public.trade_match_wins   where created_at < now() - interval '60 days';
  $$
)
where not exists (select 1 from cron.job where jobname = 'trade-match-retention');

-- ---------------------------------------------------------------------
-- AFTER running this file — Dashboard -> Database -> Webhooks -> Create:
--   Name:    notify_trade_match
--   Table:   public.trade_match_alerts
--   Events:  INSERT
--   Type:    HTTP Request, POST
--   URL:     https://us-central1-adoptme-7b50c.cloudfunctions.net/notifyTradeMatch
--   Header:  x-webhook-secret = <same SUPABASE_WEBHOOK_SECRET as notifyNewMessage>
-- Deploy the function BEFORE creating the webhook.
-- =====================================================================
