-- =====================================================================
-- 044_pet_cards_fusion.sql
-- Neon fusion, the way Adopt Me makes Neon and Mega Neon pets: 4 copies of
-- a card in one finish become 1 copy in the next finish, and all 4 are used.
--   4 Classic -> 1 Neon      4 Neon -> 1 Mega
-- Fused cards never get a serial (serials stay a pack-only brag, so a
-- serial Mega is still rarer than a fused one) and pay no duplicate shards
-- (the copies already paid theirs when they were pulled). The new finish
-- scores like a pulled one; a finish used up to 0 copies loses its points.
-- Run after 037 and 043. Idempotent.
-- =====================================================================

create or replace function public._cards_fuse_target(f text)
returns text language sql immutable as $$
  select case f when 'classic' then 'neon' when 'neon' then 'mega' end;
$$;

-- ---------------------------------------------------------------------
-- fuse_card: 4 copies of (p_key, p_from) -> 1 copy in the next finish.
--   -> {"card": {key, name, …, finish, serial: null, fused: true, newFinish},
--       "left": copies of p_from still owned, "wallet": {…}}
-- ---------------------------------------------------------------------
create or replace function public.fuse_card(p_key text, p_from text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    text := public.firebase_uid();
  v_to     text := public._cards_fuse_target(p_from);
  c        public.card_catalog;
  w        public.card_wallet;
  v_have   int;
  v_left   int;
  v_had_to boolean;
  v_serial int;
  v_points int := 0;
begin
  if v_uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if v_to is null then
    raise exception 'cannot fuse' using errcode = '22023';
  end if;
  select * into c from public.card_catalog where key = p_key;
  if not found then
    raise exception 'unknown card' using errcode = '22023';
  end if;

  perform public._cards_ensure_wallet(v_uid);
  -- The wallet row lock serialises one player's card changes (packs, crafts, fusions).
  select * into w from public.card_wallet where uid = v_uid for update;
  select count into v_have from public.card_collection
   where uid = v_uid and card_key = p_key and finish = p_from for update;
  if coalesce(v_have, 0) < 4 then
    raise exception 'not enough copies' using errcode = 'P0001';
  end if;

  v_left := v_have - 4;
  if v_left = 0 then
    delete from public.card_collection where uid = v_uid and card_key = p_key and finish = p_from;
    v_points := v_points - public._cards_rarity_points(c.rarity) * public._cards_finish_mult(p_from);
  else
    update public.card_collection set count = v_left
     where uid = v_uid and card_key = p_key and finish = p_from;
  end if;

  select exists(select 1 from public.card_collection where uid = v_uid and card_key = p_key and finish = v_to)
    into v_had_to;
  insert into public.card_collection (uid, card_key, finish, count) values (v_uid, p_key, v_to, 1)
  on conflict (uid, card_key, finish) do update set count = public.card_collection.count + 1
  returning best_serial into v_serial;
  if not v_had_to then
    v_points := v_points + public._cards_rarity_points(c.rarity) * public._cards_finish_mult(v_to);
  end if;

  update public.card_wallet set score = score + v_points, updated_at = now() where uid = v_uid;
  insert into public.card_pulls (uid, set_id, card_key, finish, serial, source, is_new)
  values (v_uid, 'fuse', p_key, v_to, null, 'fuse', false);

  -- A showcased copy that was used up now shows its fused card instead.
  if v_left = 0 then
    update public.user_cosmetics
       set card_showcase = (
         select jsonb_agg(case when e ->> 'k' = p_key and e ->> 'f' = p_from
                               then e || jsonb_build_object('f', v_to, 's', v_serial)
                               else e end
                          order by ord)
           from jsonb_array_elements(card_showcase) with ordinality as t(e, ord))
     where uid = v_uid
       and card_showcase @> jsonb_build_array(jsonb_build_object('k', p_key, 'f', p_from));
  end if;

  perform public._cards_settle(v_uid, array[p_key]);   -- mirrors the score onto the profile
  select * into w from public.card_wallet where uid = v_uid;
  return jsonb_build_object(
    'card', jsonb_build_object(
      'key', p_key, 'name', c.name, 'rarity', c.rarity, 'no', c.no, 'egg', c.egg, 'sets', to_jsonb(c.sets),
      'finish', v_to, 'serial', null, 'fused', true,
      'new', false, 'newFinish', not v_had_to, 'dupe', v_had_to, 'shards', 0),
    'left', v_left,
    'wallet', public._cards_wallet_json(w));
end
$$;

-- Signed-in players only (see 043: new functions in public default to PUBLIC/anon).
revoke all on function public._cards_fuse_target(text)  from public, anon, authenticated;
revoke all on function public.fuse_card(text, text)     from public, anon;
grant execute on function public.fuse_card(text, text)  to authenticated;
