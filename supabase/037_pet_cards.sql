-- =====================================================================
-- 037 — Pet Cards (adoptme, kvtbtzhtcaanhjblyick), 2026-10-01
--
-- A free collectible card album of Adopt Me pets (PET_CARDS_PLAN.md).
-- Players open packs, collect cards in 7 finishes, complete sets taken from
-- real in-game groupings (eggs, Halloween years) and earn rewards.
--
-- Rules the schema enforces:
--   * Packs are EARNED, never bought: one free pack per UTC day, up to two
--     a day for stars (stars live in RTDB and are spent by the client, the
--     same trust model as Mystery Egg; the daily cap bounds any forgery),
--     and bonus packs (7-day streak, Squad, events) granted server-side.
--   * The server rolls every card (random()), so collections, serial numbers
--     and scores shown on profiles can't be forged.
--   * Only cards with HD art (card_catalog.hd_ready) can be pulled.
--   * Odds live in card_sets.odds and are returned to the app for display.
--
-- Fairness: new-card bias, Legendary pity (8 packs), Holo+ pity (12 packs),
-- shards from duplicates, crafting of missing Classic cards.
--
-- Visibility: user_cosmetics.card_score / card_count / card_showcase ride
-- along with the cosmetics row every profile already loads (no extra reads).
--
-- Cost: no realtime. cards_state when the hub opens, open_card_pack per
-- pack (1-4 a day), get_card_collection when the album opens (cached),
-- the catalogue is read once a day. Run after 036. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.card_catalog (
  key         text primary key check (key ~ '^[a-z0-9]{1,60}$'),   -- normalizeName(pet name)
  name        text not null,
  rarity      text not null check (rarity in ('common', 'uncommon', 'rare', 'ultra', 'legendary')),
  no          int  not null unique check (no > 0),                  -- collector number; never reused
  egg         text,                                                 -- 'fossil', 'ocean', … (null = none)
  sets        text[] not null default '{}',                         -- card_sets ids besides 'all'
  bg          text,                                                 -- art background override
  hd_ready    boolean not null default false,                       -- 1024 px art is on the CDN
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);
create index if not exists card_catalog_sets_idx on public.card_catalog using gin (sets);

create table if not exists public.card_sets (
  id          text primary key check (id ~ '^[a-z0-9_]{1,40}$'),
  kind        text not null check (kind in ('pack', 'page')),  -- pack: has its own pack; page: album page only
  theme       text not null default 'island',
  names       jsonb not null default '{}'::jsonb,              -- fallback names {"en": "..."}; the app has i18n
  sort        int  not null default 100,
  starts_at   timestamptz,
  ends_at     timestamptz,                                     -- the PACK retires; cards stay craftable
  odds        jsonb not null default '{}'::jsonb,              -- overrides of _cards_default_odds()
  reward      jsonb not null default '{}'::jsonb,              -- {"shards":50,"frame":"haunted","wallpaper":true}
  active      boolean not null default true
);

create table if not exists public.card_collection (
  uid          text not null,
  card_key     text not null,
  finish       text not null check (finish in ('classic', 'foil', 'neon', 'holo', 'gilded', 'mega', 'fullart')),
  count        int  not null default 1 check (count > 0),
  first_at     timestamptz not null default now(),
  best_serial  int,
  primary key (uid, card_key, finish)
);

create table if not exists public.card_wallet (
  uid           text primary key,
  shards        int  not null default 0 check (shards >= 0),
  pity_legend   int  not null default 0,    -- packs since the last Legendary
  pity_holo     int  not null default 0,    -- packs since the last Holo-or-better
  free_day      int  not null default -1,   -- UTC day number of the last free pack
  star_day      int  not null default -1,
  star_count    int  not null default 0,    -- star packs opened on star_day
  streak        int  not null default 0,    -- consecutive days with a free pack
  bonus_packs   int  not null default 0 check (bonus_packs >= 0),
  packs_opened  int  not null default 0,
  unique_cards  int  not null default 0,
  score         int  not null default 0,
  completed     text[] not null default '{}',  -- set ids completed (rewards paid)
  updated_at    timestamptz not null default now()
);

create table if not exists public.card_serials (
  card_key     text not null,
  finish       text not null,
  last_serial  int  not null default 0,
  primary key (card_key, finish)
);

create table if not exists public.card_pulls (
  id          bigserial primary key,
  uid         text not null,
  set_id      text not null,
  card_key    text not null,
  finish      text not null,
  serial      int,
  source      text not null,
  is_new      boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists card_pulls_uid_idx on public.card_pulls (uid, created_at desc);
create index if not exists card_pulls_created_idx on public.card_pulls (created_at) where serial is null;

alter table public.card_catalog    enable row level security;
alter table public.card_sets       enable row level security;
alter table public.card_collection enable row level security;
alter table public.card_wallet     enable row level security;
alter table public.card_serials    enable row level security;
alter table public.card_pulls      enable row level security;
revoke all on table public.card_catalog    from anon, authenticated;
revoke all on table public.card_sets       from anon, authenticated;
revoke all on table public.card_collection from anon, authenticated;
revoke all on table public.card_wallet     from anon, authenticated;
revoke all on table public.card_serials    from anon, authenticated;
revoke all on table public.card_pulls      from anon, authenticated;
revoke all on sequence public.card_pulls_id_seq from anon, authenticated;

-- Profiles show the collection with the cosmetics row they already load.
alter table public.user_cosmetics add column if not exists card_score    int not null default 0;
alter table public.user_cosmetics add column if not exists card_count    int not null default 0;
alter table public.user_cosmetics add column if not exists card_showcase jsonb;

-- ---------------------------------------------------------------------
-- Rules as data (kept in step with Code/PetCards/cardConfig.js)
-- ---------------------------------------------------------------------
create or replace function public._cards_default_odds()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'slot',   jsonb_build_object('common', 40, 'uncommon', 28, 'rare', 18, 'ultra', 10, 'legendary', 4),
    'hit',    jsonb_build_object('rare', 55, 'ultra', 30, 'legendary', 15),
    'finish', jsonb_build_object('classic', 72, 'foil', 14, 'neon', 8, 'holo', 4,
                                 'gilded', 1.4, 'mega', 0.5, 'fullart', 0.1),
    'bias', 0.45,            -- chance a pull is taken from the player's missing cards
    'pity_legend', 8,        -- a Legendary in the hit slot if none in this many packs
    'pity_holo', 12          -- Holo or better if none in this many packs
  );
$$;

create or replace function public._cards_odds(p_set text)
returns jsonb language sql stable set search_path = public as $$
  select public._cards_default_odds() || coalesce((select odds from public.card_sets where id = p_set), '{}'::jsonb);
$$;

create or replace function public._cards_rarity_points(r text)
returns int language sql immutable as $$
  select case r when 'common' then 1 when 'uncommon' then 2 when 'rare' then 4
                when 'ultra' then 8 when 'legendary' then 16 else 0 end;
$$;

create or replace function public._cards_finish_mult(f text)
returns int language sql immutable as $$
  select case f when 'classic' then 1 when 'foil' then 2 when 'neon' then 3 when 'holo' then 5
                when 'gilded' then 10 when 'mega' then 20 when 'fullart' then 40 else 1 end;
$$;

create or replace function public._cards_dupe_shards(r text)
returns int language sql immutable as $$
  select case r when 'common' then 5 when 'uncommon' then 10 when 'rare' then 25
                when 'ultra' then 50 when 'legendary' then 100 else 0 end;
$$;

create or replace function public._cards_craft_cost(r text)
returns int language sql immutable as $$
  select case r when 'common' then 40 when 'uncommon' then 80 when 'rare' then 200
                when 'ultra' then 400 when 'legendary' then 1000 else null end;
$$;

create or replace function public._cards_today()
returns int language sql stable as $$
  select floor(extract(epoch from now()) / 86400)::int;
$$;

-- Weighted pick from a {name: weight} object.
create or replace function public._cards_weighted(p_weights jsonb)
returns text language plpgsql volatile as $$
declare
  total numeric := 0;
  r numeric;
  k text;
  w numeric;
  last_k text;
begin
  for k, w in select key, value::numeric from jsonb_each_text(p_weights) loop
    if w > 0 then total := total + w; end if;
  end loop;
  if total <= 0 then return null; end if;
  r := random()::numeric * total;
  for k, w in select key, value::numeric from jsonb_each_text(p_weights) loop
    if w > 0 then
      last_k := k;
      r := r - w;
      if r < 0 then return k; end if;
    end if;
  end loop;
  return last_k;   -- rounding at the very top of the range
end
$$;

-- Is this card in the set's pool? ('all' = every card)
create or replace function public._cards_in_set(c public.card_catalog, p_set text)
returns boolean language sql immutable as $$
  select p_set = 'all' or p_set = any(c.sets);
$$;

create or replace function public._cards_ensure_wallet(p_uid text)
returns void language sql set search_path = public as $$
  insert into public.card_wallet (uid) values (p_uid) on conflict (uid) do nothing;
$$;

-- Sets whose every pullable card the player now owns (any finish), not yet paid.
create or replace function public._cards_new_completions(p_uid text, p_keys text[])
returns text[] language plpgsql set search_path = public as $$
declare
  w public.card_wallet;
  s record;
  done text[] := '{}';
  total int;
  owned int;
begin
  select * into w from public.card_wallet where uid = p_uid;
  for s in
    select cs.id from public.card_sets cs
     where cs.active
       and not (cs.id = any(w.completed))
       and (cs.id = 'all' or exists (
             select 1 from public.card_catalog c where c.key = any(p_keys) and cs.id = any(c.sets)))
  loop
    select count(*) into total from public.card_catalog c
     where c.active and c.hd_ready and public._cards_in_set(c, s.id);
    if total = 0 then continue; end if;
    select count(distinct cc.card_key) into owned
      from public.card_collection cc
      join public.card_catalog c on c.key = cc.card_key
     where cc.uid = p_uid and c.active and c.hd_ready and public._cards_in_set(c, s.id);
    if owned >= total then done := done || s.id; end if;
  end loop;
  return done;
end
$$;

-- Add one card to a collection: returns {new, newFinish, dupe, shards, serial}.
create or replace function public._cards_add(p_uid text, p_key text, p_finish text, p_set text, p_source text)
returns jsonb language plpgsql set search_path = public as $$
declare
  c public.card_catalog;
  v_had_card boolean;
  v_had_finish boolean;
  v_serial int;
  v_shards int := 0;
  v_points int := 0;
begin
  select * into c from public.card_catalog where key = p_key;
  select exists(select 1 from public.card_collection where uid = p_uid and card_key = p_key) into v_had_card;
  select exists(select 1 from public.card_collection where uid = p_uid and card_key = p_key and finish = p_finish)
    into v_had_finish;

  if p_finish in ('holo', 'gilded', 'mega', 'fullart') then
    insert into public.card_serials (card_key, finish, last_serial) values (p_key, p_finish, 1)
    on conflict (card_key, finish) do update set last_serial = public.card_serials.last_serial + 1
    returning last_serial into v_serial;
  end if;

  insert into public.card_collection (uid, card_key, finish, count, best_serial)
  values (p_uid, p_key, p_finish, 1, v_serial)
  on conflict (uid, card_key, finish) do update
    set count = public.card_collection.count + 1,
        best_serial = case when excluded.best_serial is null then public.card_collection.best_serial
                           else least(coalesce(public.card_collection.best_serial, excluded.best_serial),
                                      excluded.best_serial) end;

  if v_had_finish then
    v_shards := public._cards_dupe_shards(c.rarity) * public._cards_finish_mult(p_finish);
  else
    v_points := public._cards_rarity_points(c.rarity) * public._cards_finish_mult(p_finish);
  end if;

  update public.card_wallet
     set shards = shards + v_shards,
         score = score + v_points,
         unique_cards = unique_cards + case when v_had_card then 0 else 1 end,
         updated_at = now()
   where uid = p_uid;

  insert into public.card_pulls (uid, set_id, card_key, finish, serial, source, is_new)
  values (p_uid, p_set, p_key, p_finish, v_serial, p_source, not v_had_card);

  return jsonb_build_object(
    'key', p_key, 'name', c.name, 'rarity', c.rarity, 'no', c.no, 'egg', c.egg, 'sets', to_jsonb(c.sets),
    'finish', p_finish, 'serial', v_serial,
    'new', not v_had_card, 'newFinish', v_had_card and not v_had_finish,
    'dupe', v_had_finish, 'shards', v_shards
  );
end
$$;

-- Pay set rewards, mirror the profile numbers. Returns the newly completed sets.
create or replace function public._cards_settle(p_uid text, p_keys text[])
returns jsonb language plpgsql set search_path = public as $$
declare
  v_done text[];
  v_shards int := 0;
  w public.card_wallet;
begin
  v_done := public._cards_new_completions(p_uid, p_keys);
  if array_length(v_done, 1) > 0 then
    select coalesce(sum(coalesce((reward ->> 'shards')::int, 0)), 0) into v_shards
      from public.card_sets where id = any(v_done);
    update public.card_wallet
       set completed = completed || v_done, shards = shards + v_shards, updated_at = now()
     where uid = p_uid;
  end if;

  select * into w from public.card_wallet where uid = p_uid;
  insert into public.user_cosmetics (uid, card_score, card_count)
  values (p_uid, w.score, w.unique_cards)
  on conflict (uid) do update set card_score = excluded.card_score, card_count = excluded.card_count;

  return jsonb_build_object('completed', to_jsonb(coalesce(v_done, '{}'::text[])), 'rewardShards', v_shards);
end
$$;

create or replace function public._cards_wallet_json(w public.card_wallet)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'shards', w.shards, 'bonusPacks', w.bonus_packs, 'streak', w.streak,
    'freeReady', w.free_day < public._cards_today(),
    'starPacksLeft', greatest(0, 2 - case when w.star_day = public._cards_today() then w.star_count else 0 end),
    'packsOpened', w.packs_opened, 'uniqueCards', w.unique_cards, 'score', w.score,
    'completed', to_jsonb(w.completed),
    'pityLegend', w.pity_legend, 'pityHolo', w.pity_holo
  );
$$;

revoke all on function public._cards_default_odds()                     from public, anon, authenticated;
revoke all on function public._cards_odds(text)                         from public, anon, authenticated;
revoke all on function public._cards_weighted(jsonb)                    from public, anon, authenticated;
revoke all on function public._cards_ensure_wallet(text)                from public, anon, authenticated;
revoke all on function public._cards_new_completions(text, text[])      from public, anon, authenticated;
revoke all on function public._cards_add(text, text, text, text, text)  from public, anon, authenticated;
revoke all on function public._cards_settle(text, text[])               from public, anon, authenticated;
revoke all on function public._cards_wallet_json(public.card_wallet)    from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- cards_state: the Card Hub. Wallet, packs available, sets and odds.
-- ---------------------------------------------------------------------
create or replace function public.cards_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := public.firebase_uid();
  w public.card_wallet;
  v_sets jsonb;
  v_version text;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  perform public._cards_ensure_wallet(v_uid);
  select * into w from public.card_wallet where uid = v_uid;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'kind', s.kind, 'theme', s.theme, 'names', s.names, 'sort', s.sort,
           'startsAt', s.starts_at, 'endsAt', s.ends_at, 'reward', s.reward,
           'odds', public._cards_odds(s.id),
           'open', s.kind = 'pack' and (s.starts_at is null or s.starts_at <= now())
                                   and (s.ends_at is null or s.ends_at > now()),
           'total', (select count(*) from public.card_catalog c
                      where c.active and c.hd_ready and public._cards_in_set(c, s.id))
         ) order by s.sort, s.id), '[]'::jsonb)
    into v_sets
    from public.card_sets s
   where s.active;

  select coalesce(max(updated_at)::text, '0') || ':' || count(*) into v_version
    from public.card_catalog;

  return jsonb_build_object(
    'wallet', public._cards_wallet_json(w),
    'sets', v_sets,
    'catalogVersion', v_version,
    'now', now(),
    'nextFreeAt', to_timestamp((public._cards_today() + 1) * 86400)
  );
end
$$;

-- ---------------------------------------------------------------------
-- card_catalog_list: the catalogue (the app caches it by catalogVersion).
-- ---------------------------------------------------------------------
create or replace function public.card_catalog_list()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(c.key, c.name, c.rarity, c.no, c.egg, to_jsonb(c.sets), c.bg)
                            order by c.no), '[]'::jsonb)
    from public.card_catalog c
   where c.active and c.hd_ready;
$$;

-- ---------------------------------------------------------------------
-- open_card_pack: check the source, roll 3 cards, store them.
--   p_source: 'free' | 'stars' | 'bonus'
-- ---------------------------------------------------------------------
create or replace function public.open_card_pack(p_set text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_source not in ('free', 'stars', 'bonus') then
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
    if w.free_day >= v_today then
      raise exception 'free pack already opened today' using errcode = 'P0001';
    end if;
    w.streak := case when w.free_day = v_today - 1 then w.streak + 1 else 1 end;
    w.free_day := v_today;
    if w.streak % 7 = 0 then
      w.bonus_packs := w.bonus_packs + 1;
      v_streak_bonus := true;
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
  else
    if w.bonus_packs <= 0 then
      raise exception 'no bonus packs' using errcode = 'P0001';
    end if;
    w.bonus_packs := w.bonus_packs - 1;
  end if;

  update public.card_wallet
     set streak = w.streak, free_day = w.free_day, bonus_packs = w.bonus_packs,
         star_day = w.star_day, star_count = w.star_count,
         packs_opened = packs_opened + 1, updated_at = now()
   where uid = v_uid;

  v_odds := public._cards_odds(p_set);

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
$$;

-- ---------------------------------------------------------------------
-- craft_card: shards -> a Classic copy of a card the player doesn't own.
-- ---------------------------------------------------------------------
create or replace function public.craft_card(p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  text := public.firebase_uid();
  c      public.card_catalog;
  w      public.card_wallet;
  v_cost int;
  v_card jsonb;
  v_settle jsonb;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select * into c from public.card_catalog where key = p_key and active and hd_ready;
  if not found then
    raise exception 'unknown card' using errcode = '22023';
  end if;
  if exists (select 1 from public.card_collection where uid = v_uid and card_key = p_key) then
    raise exception 'already owned' using errcode = 'P0001';
  end if;

  perform public._cards_ensure_wallet(v_uid);
  select * into w from public.card_wallet where uid = v_uid for update;
  v_cost := public._cards_craft_cost(c.rarity);
  if w.shards < v_cost then
    raise exception 'not enough shards' using errcode = 'P0001';
  end if;
  update public.card_wallet set shards = shards - v_cost where uid = v_uid;

  v_card := public._cards_add(v_uid, p_key, 'classic', 'craft', 'craft');
  v_settle := public._cards_settle(v_uid, array[p_key]);
  select * into w from public.card_wallet where uid = v_uid;
  return jsonb_build_object('card', v_card, 'wallet', public._cards_wallet_json(w),
                            'completed', v_settle -> 'completed', 'rewardShards', v_settle -> 'rewardShards');
end
$$;

-- ---------------------------------------------------------------------
-- get_card_collection: compact owned list. Other players' albums are
-- readable on purpose (showing off is the point); nothing personal is in it.
--   -> {"cards": {"<key>": [["holo", 2, 42], ["classic", 1, null]]}, "score":…, "uniqueCards":…}
-- ---------------------------------------------------------------------
create or replace function public.get_card_collection(p_uid text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  text := public.firebase_uid();
  v_who  text;
  v_cards jsonb;
  w public.card_wallet;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  v_who := coalesce(nullif(p_uid, ''), v_uid);

  select coalesce(jsonb_object_agg(card_key, finishes), '{}'::jsonb) into v_cards
    from (select card_key,
                 jsonb_agg(jsonb_build_array(finish, count, best_serial) order by first_at) as finishes
            from public.card_collection where uid = v_who group by card_key) t;
  select * into w from public.card_wallet where uid = v_who;

  return jsonb_build_object('cards', v_cards,
                            'score', coalesce(w.score, 0), 'uniqueCards', coalesce(w.unique_cards, 0),
                            'completed', to_jsonb(coalesce(w.completed, '{}'::text[])));
end
$$;

-- ---------------------------------------------------------------------
-- set_card_showcase: up to 3 owned cards on the profile.
--   p_cards = [{"k": "shadowdragon", "f": "mega"}, …]
-- ---------------------------------------------------------------------
create or replace function public.set_card_showcase(p_cards jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := public.firebase_uid();
  v_out jsonb := '[]'::jsonb;
  e jsonb;
  r public.card_collection;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) > 3 then
    raise exception 'up to 3 cards' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(p_cards) loop
    select * into r from public.card_collection
     where uid = v_uid and card_key = e ->> 'k' and finish = e ->> 'f';
    if found then
      v_out := v_out || jsonb_build_object('k', r.card_key, 'f', r.finish, 's', r.best_serial);
    end if;
  end loop;
  insert into public.user_cosmetics (uid, card_showcase) values (v_uid, v_out)
  on conflict (uid) do update set card_showcase = excluded.card_showcase;
  return v_out;
end
$$;

grant execute on function public.cards_state()                  to authenticated;
grant execute on function public.card_catalog_list()            to authenticated;
grant execute on function public.open_card_pack(text, text)     to authenticated;
grant execute on function public.craft_card(text)               to authenticated;
grant execute on function public.get_card_collection(text)      to authenticated;
grant execute on function public.set_card_showcase(jsonb)       to authenticated;

-- ---------------------------------------------------------------------
-- Sets. Membership lives in card_catalog.sets (written by
-- scripts/pet-cards/sync-card-catalog.js from the wiki groupings).
-- Halloween: starts when the app ships; the PACK retires 10 Nov 2026.
-- ---------------------------------------------------------------------
insert into public.card_sets (id, kind, theme, names, sort, ends_at, odds, reward) values
  ('haunted26', 'pack', 'haunted', '{"en": "Haunted Carnival"}', 10, '2026-11-10T00:00:00Z',
   '{"slot": {"common": 10, "uncommon": 20, "rare": 25, "ultra": 25, "legendary": 20},
     "hit": {"rare": 30, "ultra": 35, "legendary": 35}, "bias": 0.6}',
   '{"shards": 300, "frame": "haunted", "back": "haunted", "wallpaper": "haunted"}'),
  ('all', 'pack', 'island', '{"en": "All Pets"}', 20, null, '{}',
   '{"shards": 5000, "frame": "island_master", "back": "gold", "wallpaper": "island"}')
on conflict (id) do nothing;

insert into public.card_sets (id, kind, theme, names, sort, reward)
select 'egg_' || e, 'page', 'island', jsonb_build_object('en', initcap(replace(e, '_', ' ')) || ' Egg'),
       100 + ord, '{"shards": 50, "wallpaper": "egg"}'::jsonb
  from unnest(array['farm', 'safari', 'jungle', 'aussie', 'fossil', 'ocean', 'mythic', 'japan', 'danger',
                    'woodland', 'moon', 'desert', 'urban', 'endangered', 'fairytale', 'aztec',
                    'southeast_asia', 'garden']) with ordinality as t(e, ord)
on conflict (id) do nothing;

insert into public.card_sets (id, kind, theme, names, sort, reward, active) values
  ('dragons', 'page', 'island', '{"en": "Dragon Hoard"}', 200, '{"shards": 200, "frame": "dragon"}', false),
  ('cats',    'page', 'island', '{"en": "Cat Café"}',     210, '{"shards": 200}', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Retention (pg_cron). Pulls with a serial are provenance: kept forever.
-- ---------------------------------------------------------------------
select cron.schedule(
  'pet-cards-retention',
  '23 4 * * *',
  $$ delete from public.card_pulls where serial is null and created_at < now() - interval '30 days'; $$
)
where not exists (select 1 from cron.job where jobname = 'pet-cards-retention');
