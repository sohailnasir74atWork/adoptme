-- =====================================================================
-- 053 — Trade Match, the other way round (adoptme), 2026-10-08
--
-- Player feedback: "see who wants your pet as like a dream pet and see
-- what they would give". 032 finds players who HAVE what you want; this
-- finds players who WANT what you have.
--
--   find_pet_wanters(p_limit): players whose public wishlist (their dream
--   pet included) has a pet the caller lists For Trade.
--     dream    = one of the caller's pets is their dream pet
--     full     = they also list For Trade a pet the caller wants
--     dreamKey = which of the caller's pets is their dream (when dream)
--     wants    = the caller's pets they want (their dream first)
--     gives    = what they list For Trade, the caller's wanted pets first,
--                each marked w: true/false; at most 12, givesCount = all
--   Same privacy as find_trade_matches: only lists players have already
--   made public. Active in the last 45 days; blocks either way excluded.
--   Dream first, then perfect matches, then the most recently active.
--
-- Cost: one indexed query when the "Wants my pets" tab opens (the phone
-- caches it 10 min), through the new GIN index on want_keys.
--
-- Run after 032. Idempotent. Additive: old builds never call it.
-- =====================================================================

create index if not exists idx_trade_inventory_want
  on public.trade_inventory using gin (want_keys);

create or replace function public.find_pet_wanters(p_limit int default 30)
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
  if not found or cardinality(v_me.have_keys) = 0 then
    return '[]'::jsonb;
  end if;

  with c as (
    select t.uid, t.have, t.want, t.dream_key, t.updated_at,
           (t.dream_key is not null and t.dream_key = any(v_me.have_keys)) as dream_hit,
           (t.have_keys && v_me.want_keys) as full_match
    from public.trade_inventory t
    where t.want_keys && v_me.have_keys
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
           'dream',          c.dream_hit,
           'full',           c.full_match,
           'dreamKey',       case when c.dream_hit then c.dream_key end,
           'wants', (select coalesce(jsonb_agg(x order by (x->>'k' = c.dream_key) desc, ord), '[]'::jsonb)
                       from jsonb_array_elements(c.want) with ordinality as e(x, ord)
                      where x->>'k' = any(v_me.have_keys)),
           'gives', (select coalesce(jsonb_agg(g.x order by g.hit desc, g.ord), '[]'::jsonb)
                       from (select x || jsonb_build_object('w', x->>'k' = any(v_me.want_keys)) as x,
                                    (x->>'k' = any(v_me.want_keys)) as hit, ord
                               from jsonb_array_elements(c.have) with ordinality as e(x, ord)
                              order by hit desc, ord
                              limit 12) g),
           'givesCount',     jsonb_array_length(c.have),
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

revoke all on function public.find_pet_wanters(int) from public, anon;
grant execute on function public.find_pet_wanters(int) to authenticated;
