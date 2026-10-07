-- 048_pet_cards_two_free_packs.sql  (2026-10-05)
--
-- Pet Cards: two free packs a day instead of one (owner's call).
--
--   * card_wallet.free_count = free packs opened on free_day. Existing rows
--     get 1, so anyone who already opened today's free pack gets exactly one
--     more today.
--   * open_card_pack('free') allows a second free pack on the same UTC day.
--     The streak still counts DAYS: only the first free pack of a day moves it.
--   * wallet JSON: freeReady stays true until both are opened; new freeLeft.
--
-- Backward compatible: older app builds only read freeReady, so they simply
-- offer the free pack again after the first one. Both functions are the LIVE
-- definitions (pg_get_functiondef, 2026-10-05) with only these lines changed;
-- CREATE OR REPLACE keeps the 043 grants.
-- The star pack price is client-only (RTDB stars), so 5 -> 3 needs no SQL.


alter table public.card_wallet add column if not exists free_count int not null default 0;
update public.card_wallet set free_count = 1 where free_day >= 0 and free_count = 0;

CREATE OR REPLACE FUNCTION public._cards_wallet_json(w card_wallet)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select jsonb_build_object(
    'shards', w.shards, 'bonusPacks', w.bonus_packs, 'streak', w.streak,
    'freeReady', w.free_day < public._cards_today() or w.free_count < 2,
    'freeLeft', case when w.free_day = public._cards_today() then greatest(0, 2 - w.free_count) else 2 end,
    'starPacksLeft', greatest(0, 2 - case when w.star_day = public._cards_today() then w.star_count else 0 end),
    'packsOpened', w.packs_opened, 'uniqueCards', w.unique_cards, 'score', w.score,
    'completed', to_jsonb(w.completed),
    'pityLegend', w.pity_legend, 'pityHolo', w.pity_holo
  );
$function$;

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

