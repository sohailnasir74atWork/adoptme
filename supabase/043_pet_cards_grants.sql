-- =====================================================================
-- 043_pet_cards_grants.sql
-- Pet Cards RPCs are for signed-in players only. 037 granted them to
-- `authenticated` but never revoked the project default that lets `anon`
-- (and PUBLIC) execute any new function in `public`, so on 2026-10-03 the
-- live grants showed anon=true for all six player RPCs and six pure helpers.
-- Every RPC keys on firebase_uid(), so anon could not read anyone's cards,
-- but it should not be able to call them at all (same as the staff RPCs).
-- Idempotent.
-- =====================================================================

revoke execute on function public.cards_state()                 from public, anon;
revoke execute on function public.card_catalog_list()           from public, anon;
revoke execute on function public.open_card_pack(text, text)    from public, anon;
revoke execute on function public.craft_card(text)              from public, anon;
revoke execute on function public.get_card_collection(text)     from public, anon;
revoke execute on function public.set_card_showcase(jsonb)      from public, anon;

-- Pure helpers (no data access) that 037 left callable by everyone.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('_cards_craft_cost', '_cards_dupe_shards', '_cards_finish_mult',
                         '_cards_in_set', '_cards_rarity_points', '_cards_today')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;
