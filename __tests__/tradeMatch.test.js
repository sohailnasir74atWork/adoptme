jest.mock('../Code/Supabase/client', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('react-native-mmkv', () => {
  const stores = new Map();
  return {
    createMMKV: ({ id } = {}) => {
      if (!stores.has(id)) stores.set(id, new Map());
      const m = stores.get(id);
      return {
        getString: (k) => m.get(k),
        getNumber: (k) => m.get(k),
        getBoolean: (k) => m.get(k),
        set: (k, v) => m.set(k, v),
        remove: (k) => m.delete(k),
      };
    },
  };
});

const { supabase } = require('../Code/Supabase/client');
const tm = require('../Code/Helper/tradeMatch');

const SQL_KEY = /^[a-z0-9]{1,60}\|[a-z]{1,12}$/;
const pet = (name, extra = {}) => ({ name, category: 'pets', valueType: 'd', isFly: false, isRide: false, imageUrl: `/i/${name}.png`, ...extra });

describe('keys', () => {
  test('coarseType folds feed categories', () => {
    expect(tm.coarseType('pets')).toBe('pet');
    expect(tm.coarseType('Pets')).toBe('pet');
    expect(tm.coarseType('pet wear')).toBe('petwear');
    expect(tm.coarseType('eggs')).toBe('egg');
    expect(tm.coarseType('food')).toBe('food');
    expect(tm.coarseType('')).toBe('x');
    expect(tm.coarseType('averyveryverylongcategory')).toHaveLength(12);
  });

  test('petKey is stable across catalogues and matches the SQL format', () => {
    expect(tm.petKey(pet('Frost Dragon'))).toBe('frostdragon|pet');
    expect(tm.petKey({ Name: 'Frost Dragon', type: 'Pets' })).toBe('frostdragon|pet');
    expect(tm.petKey(pet("Jester's Cat"))).toBe('jesterscat|pet');
    expect(tm.petKey(pet(''))).toBeNull();
    expect(tm.petKey(null)).toBeNull();
    for (const n of ['Frost Dragon', 'Owl', '2D Kitty', 'Mega-Neon ✨ Thing', 'x'.repeat(90)]) {
      expect(tm.petKey(pet(n))).toMatch(SQL_KEY);
    }
  });
});

describe('lists', () => {
  test('compactList dedupes identical variants, keeps different ones, caps size', () => {
    const list = tm.compactList([
      pet('Owl'), pet('Owl'), pet('Owl', { valueType: 'n' }), pet('Owl', { isFly: true }), { name: '' }, null,
    ]);
    expect(list.map((e) => `${e.k}:${e.v}:${e.f}`)).toEqual(['owl|pet:d:false', 'owl|pet:n:false', 'owl|pet:d:true']);
    expect(list[0]).toEqual({ k: 'owl|pet', n: 'Owl', v: 'd', f: false, r: false, i: '/i/Owl.png' });
    const many = Array.from({ length: 400 }, (_, i) => pet(`Pet ${i}`));
    expect(tm.compactList(many)).toHaveLength(tm.MAX_ITEMS);
  });

  test('only public pets are offered/wanted; dream must be on the wishlist', () => {
    const owned = [pet('Frost Dragon', { availableForTrade: true }), pet('Owl'), pet('Bat Dragon', { availableForTrade: false })];
    const wishlist = [pet('Shadow Dragon'), pet('Giraffe', { availableForTrade: true })];
    const inv = tm.buildTradeInventory(owned, wishlist, 'shadowdragon|pet');
    expect(inv.have.map((e) => e.k)).toEqual(['frostdragon|pet']);
    expect(inv.want.map((e) => e.k)).toEqual(['shadowdragon|pet', 'giraffe|pet']);
    expect(inv.dream).toBe('shadowdragon|pet');
    const noDream = tm.buildTradeInventory(owned, wishlist, 'unicorn|pet');
    expect(noDream.dream).toBeNull();
    expect(noDream.want.map((e) => e.k)).toEqual(['giraffe|pet']);
    expect(tm.buildTradeInventory(undefined, null, null)).toEqual({ have: [], want: [], dream: null });
  });
});

describe('sync', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    supabase.rpc.mockReset();
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  });
  afterEach(() => jest.useRealTimers());

  const flush = async () => { jest.runOnlyPendingTimers(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

  test('bursts are coalesced and unchanged lists are not re-sent', async () => {
    const owned = [pet('Frost Dragon', { availableForTrade: true })];
    const wishlist = [pet('Owl', { availableForTrade: true })];
    tm.syncTradeInventory('uA', owned, wishlist, { lang: 'ru' });
    tm.syncTradeInventory('uA', owned, wishlist, { lang: 'ru' });
    const p = tm.syncTradeInventory('uA', owned, wishlist, { lang: 'ru' });
    await flush(); await p;
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = supabase.rpc.mock.calls[0];
    expect(fn).toBe('sync_trade_inventory');
    expect(args).toMatchObject({ p_lang: 'ru', p_alerts: true, p_dream: null });
    expect(args.p_have.map((e) => e.k)).toEqual(['frostdragon|pet']);

    await tm.syncTradeInventory('uA', owned, wishlist, { lang: 'ru', immediate: true });
    expect(supabase.rpc).toHaveBeenCalledTimes(1); // unchanged -> skipped

    await tm.syncTradeInventory('uA', [...owned, pet('Owl', { availableForTrade: true })], wishlist, { lang: 'ru', immediate: true });
    expect(supabase.rpc).toHaveBeenCalledTimes(2); // changed -> sent
  });

  test('first sync with nothing public creates no row', async () => {
    await tm.syncTradeInventory('uB', [pet('Owl')], [pet('Giraffe')], { immediate: true });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('dream defaults to the one stored for that uid; unsupported language -> en', async () => {
    tm.setDreamKeyLocal('uC', 'giraffe|pet');
    await tm.syncTradeInventory('uC', [], [pet('Giraffe')], { lang: 'pt-BR', immediate: true });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc.mock.calls[0][1]).toMatchObject({ p_dream: 'giraffe|pet', p_lang: 'en' });
    expect(tm.getDreamKey('uC')).toBe('giraffe|pet');
    expect(tm.getDreamKey('uOther')).toBeNull();
  });

  test('turning alerts off is sent even when the lists did not change', async () => {
    const wishlist = [pet('Owl', { availableForTrade: true })];
    await tm.syncTradeInventory('uD', [], wishlist, { lang: 'en', immediate: true });
    tm.setAlertsEnabled(false);
    await tm.syncTradeInventory('uD', [], wishlist, { lang: 'en', immediate: true });
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    expect(supabase.rpc.mock.calls[1][1].p_alerts).toBe(false);
    tm.setAlertsEnabled(true);
  });

  test('a failed sync resolves null and is retried next time', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    const wishlist = [pet('Owl', { availableForTrade: true })];
    await expect(tm.syncTradeInventory('uE', [], wishlist, { immediate: true })).resolves.toBeNull();
    await tm.syncTradeInventory('uE', [], wishlist, { immediate: true });
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });

  test('guests and bad input never call the server', async () => {
    await tm.syncTradeInventory(null, [], []);
    await tm.syncTradeInventory('uF', null, []);
    jest.runOnlyPendingTimers();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe('matches cache', () => {
  beforeEach(() => {
    supabase.rpc.mockReset();
  });

  test('matches are cached per uid and cleared by a sync that changed lists', async () => {
    supabase.rpc.mockResolvedValue({ data: [{ uid: 'x' }], error: null });
    expect(await tm.fetchTradeMatches('uG')).toEqual([{ uid: 'x' }]);
    expect(await tm.fetchTradeMatches('uG')).toEqual([{ uid: 'x' }]);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(tm.cachedMatchCount('uG')).toBe(1);
    expect(tm.cachedMatchCount('uH')).toBeNull();

    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await tm.syncTradeInventory('uG', [], [pet('Owl', { availableForTrade: true })], { immediate: true });
    expect(tm.cachedMatchCount('uG')).toBeNull();

    supabase.rpc.mockResolvedValue({ data: null, error: null });
    expect(await tm.fetchTradeMatches('uG', { force: true })).toEqual([]);
  });

  test('errors propagate to the screen', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(tm.fetchTradeMatches('uI', { force: true })).rejects.toThrow('boom');
  });
});
