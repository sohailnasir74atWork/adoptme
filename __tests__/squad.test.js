jest.mock('../Code/Supabase/client', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../Code/Helper/growthAnalytics', () => ({ trackGrowthEvent: jest.fn() }));
jest.mock('../Code/Helper/deviceFingerprint', () => ({ getDeviceFingerprint: jest.fn(async () => 'dev-test-123') }));
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
const { trackGrowthEvent } = require('../Code/Helper/growthAnalytics');
const sq = require('../Code/Helper/squad');
const DAY = 86400000;

describe('codes and links', () => {
  test('normalizeCode accepts typed variants, rejects look-alikes and junk', () => {
    expect(sq.normalizeCode(' ab c-23x ')).toBe('ABC23X');
    expect(sq.normalizeCode('abc23x')).toBe('ABC23X');
    expect(sq.normalizeCode('ab c 2 3x')).toBe('ABC23X');
    expect(sq.normalizeCode('ABC10X')).toBeNull(); // 1 and 0 are not in the alphabet
    expect(sq.normalizeCode('ABCDEFG')).toBeNull();
    expect(sq.normalizeCode(null)).toBeNull();
  });

  test('codeFromReferrer reads Play referrers, encoded or not', () => {
    expect(sq.codeFromReferrer('squad=ABC234')).toBe('ABC234');
    expect(sq.codeFromReferrer('squad%3DABC234')).toBe('ABC234');
    expect(sq.codeFromReferrer('utm_source=google-play&utm_medium=organic')).toBeNull();
    expect(sq.codeFromReferrer('utm_source=x&squad=abc234&utm_medium=y')).toBe('ABC234');
    expect(sq.codeFromReferrer('notsquad=ABC234')).toBeNull();
    expect(sq.codeFromReferrer(undefined)).toBeNull();
  });

  test('invite links round-trip the code through the Play referrer', () => {
    const { android, ios } = sq.inviteLinks('ABC234');
    expect(android).toContain('id=com.adoptmevaluescalc&referrer=');
    const referrer = decodeURIComponent(android.split('referrer=')[1]);
    expect(sq.codeFromReferrer(referrer)).toBe('ABC234');
    expect(ios).toMatch(/^https:\/\/apps\.apple\.com\//);
  });
});

describe('ranks and steps (match 034_squad.sql)', () => {
  test('rankFor', () => {
    expect(sq.rankFor(0)).toBeNull();
    expect(sq.rankFor(2)).toBeNull();
    expect(sq.rankFor(3).key).toBe('recruiter');
    expect(sq.rankFor(9).key).toBe('recruiter');
    expect(sq.rankFor(10).key).toBe('leader');
    expect(sq.rankFor(25).key).toBe('legend');
    expect(sq.rankFor(500).key).toBe('icon');
    expect(sq.rankFor(undefined)).toBeNull();
  });
  test('nextStep / nextRank', () => {
    expect(sq.nextStep(0)).toEqual({ n: 1, days: 3 });
    expect(sq.nextStep(1)).toEqual({ n: 3, days: 14 });
    expect(sq.nextStep(24)).toEqual({ n: 25, days: 90 });
    expect(sq.nextStep(25)).toBeNull();
    expect(sq.nextRank(0).key).toBe('recruiter');
    expect(sq.nextRank(10).key).toBe('legend');
    expect(sq.nextRank(50)).toBeNull();
  });
});

describe('squad Pro is per signed-in uid', () => {
  beforeEach(() => supabase.rpc.mockReset());

  test('earned Pro follows the uid and disappears on sign-out', async () => {
    const seen = [];
    const off = sq.onSquadProChange(() => seen.push(sq.isSquadProActive()));
    supabase.rpc.mockResolvedValue({
      data: { code: 'ABC234', direct: 1, proUntil: new Date(Date.now() + 3 * DAY).toISOString(), members: [], joined: null },
      error: null,
    });
    sq.setSquadUser('uA');
    await sq.getMySquad('uA', { force: true });
    expect(sq.isSquadProActive()).toBe(true);
    sq.setSquadUser(null);
    expect(sq.isSquadProActive()).toBe(false); // shared phone: the next account gets nothing
    sq.setSquadUser('uB');
    expect(sq.isSquadProActive()).toBe(false);
    sq.setSquadUser('uA');
    expect(sq.isSquadProActive()).toBe(true);
    expect(seen).toContain(true);
    expect(seen).toContain(false);
    off();
  });

  test('expired Pro is not active', async () => {
    supabase.rpc.mockResolvedValue({ data: { code: 'ABC235', proUntil: new Date(Date.now() - 1000).toISOString(), members: [] }, error: null });
    sq.setSquadUser('uC');
    await sq.getMySquad('uC', { force: true });
    expect(sq.isSquadProActive()).toBe(false);
  });
});

describe('join and ping', () => {
  beforeEach(() => supabase.rpc.mockReset());

  test('joinSquad validates locally and sends the device id', async () => {
    expect(await sq.joinSquad(null, 'ABC234')).toEqual({ ok: false, reason: 'signin' });
    expect(await sq.joinSquad('uD', 'nope')).toEqual({ ok: false, reason: 'bad_code' });
    expect(supabase.rpc).not.toHaveBeenCalled();
    supabase.rpc.mockResolvedValue({ data: { ok: true, inviterName: 'Ali' }, error: null });
    expect(await sq.joinSquad('uD', 'abc234')).toEqual({ ok: true, inviterName: 'Ali' });
    expect(supabase.rpc).toHaveBeenCalledWith('join_squad', { p_code: 'ABC234', p_device: 'dev-test-123' });
  });

  test('pending install code is applied once; final errors clear it, network errors keep it', async () => {
    sq.setPendingCode('ABC236');
    supabase.rpc.mockRejectedValueOnce(new Error('offline'));
    expect(await sq.applyPendingCode('uE')).toBeNull();
    expect(sq.getPendingCode()).toBe('ABC236'); // retried next launch

    supabase.rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'not_new' }, error: null });
    expect((await sq.applyPendingCode('uE')).reason).toBe('not_new');
    expect(sq.getPendingCode()).toBeNull();
    expect(await sq.applyPendingCode('uE')).toBeNull(); // nothing left to apply
  });

  test('non-participants check once per install; participants ping at most every 12 h', async () => {
    supabase.rpc.mockResolvedValue({ data: { qualified: false, pending: false, proUntil: null, direct: 0 }, error: null });
    await sq.squadPing('uF'); // first sign-in on this install: one check
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(await sq.squadPing('uF')).toBeNull(); // nothing found: never again
    expect(supabase.rpc).toHaveBeenCalledTimes(1);

    supabase.rpc.mockResolvedValue({ data: { ok: true, inviterName: 'Ali' }, error: null });
    await sq.joinSquad('uF', 'ABC237'); // joining makes you a participant
    supabase.rpc.mockReset();
    supabase.rpc.mockResolvedValue({ data: { qualified: true, pending: false, proUntil: new Date(Date.now() + 3 * DAY).toISOString(), direct: 0 }, error: null });
    const r = await sq.squadPing('uF', { force: true });
    expect(r.qualified).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('squad_ping', { p_device: 'dev-test-123' });
    expect(await sq.squadPing('uF')).toBeNull(); // throttled
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    await sq.squadPing('uF', { force: true });
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
  });

  test('a reinstalled inviter with earned Pro becomes a participant again', async () => {
    supabase.rpc.mockResolvedValue({ data: { qualified: false, pending: false, proUntil: new Date(Date.now() + 5 * DAY).toISOString(), direct: 3 }, error: null });
    sq.setSquadUser('uG');
    await sq.squadPing('uG');
    expect(sq.isSquadProActive('uG')).toBe(true);
    supabase.rpc.mockClear();
    await sq.squadPing('uG', { force: true }); // participant now: pings keep coming
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('ping timing', () => {
  let now;
  beforeEach(() => {
    supabase.rpc.mockReset();
    now = Date.UTC(2026, 9, 1, 23, 0); // 23:00 UTC
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => Date.now.mockRestore());

  test('a pending friend pings again as soon as the UTC day changes', async () => {
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await sq.joinSquad('uH', 'ABC238');
    supabase.rpc.mockResolvedValue({ data: { qualified: false, pending: true, proUntil: null, direct: 0 }, error: null });
    await sq.squadPing('uH', { force: true }); // join day, 23:00
    supabase.rpc.mockClear();
    now += 30 * 60 * 1000; // 23:30, same day
    expect(await sq.squadPing('uH')).toBeNull();
    now += 9 * 60 * 60 * 1000; // 08:30 next day, only 9.5 h later
    await sq.squadPing('uH');
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  test('an inviter with friends about to count pings every 30 min, then back to 12 h', async () => {
    supabase.rpc.mockResolvedValue({ data: { code: 'ABC239', direct: 0, members: [{ status: 'pending' }] }, error: null });
    sq.setSquadUser('uI');
    await sq.getMySquad('uI', { force: true });
    supabase.rpc.mockResolvedValue({ data: { qualified: false, pending: false, proUntil: null, direct: 0 }, error: null });
    await sq.squadPing('uI', { force: true });
    supabase.rpc.mockClear();
    now += 20 * 60 * 1000;
    expect(await sq.squadPing('uI')).toBeNull();
    now += 15 * 60 * 1000; // 35 min
    await sq.squadPing('uI');
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    now += 4 * DAY; // awaiting window over
    await sq.squadPing('uI'); // 12 h passed anyway
    supabase.rpc.mockClear();
    now += 60 * 60 * 1000;
    expect(await sq.squadPing('uI')).toBeNull();
  });

  test('a squad push refetches at once and is not throttled', async () => {
    supabase.rpc.mockResolvedValue({ data: { qualified: false, pending: false, proUntil: null, direct: 1 }, error: null });
    sq.setSquadUser('uJ');
    await sq.squadPing('uJ', { force: true });
    supabase.rpc.mockClear();
    await sq.onSquadPush('member_joined'); // nothing new on the server yet
    expect(supabase.rpc).not.toHaveBeenCalled();
    await sq.onSquadPush('reward');
    expect(supabase.rpc).toHaveBeenCalledWith('squad_ping', expect.anything());
  });
});

describe('remembered player', () => {
  test('the last signed-in uid survives a restart until a real sign-out', () => {
    sq.setSquadUser('uK');
    jest.isolateModules(() => {
      const fresh = require('../Code/Helper/squad');
      expect(fresh.getSquadProUntil()).toBe(fresh.getSquadProUntil('uK')); // same player, before login loads
    });
    sq.setSquadUser(null);
    jest.isolateModules(() => {
      const fresh = require('../Code/Helper/squad');
      expect(fresh.isSquadProActive()).toBe(false);
      expect(fresh.getSquadProUntil()).toBe(0);
    });
  });
});

describe('funnel analytics', () => {
  beforeEach(() => { supabase.rpc.mockReset(); trackGrowthEvent.mockClear(); });

  test('joins are logged with their source and result, never the code', async () => {
    supabase.rpc.mockResolvedValue({ data: { ok: true, inviterName: 'Ali' }, error: null });
    await sq.joinSquad('uL', 'ABC23Z');
    expect(trackGrowthEvent).toHaveBeenLastCalledWith('squad_join', { ok: 1, reason: 'ok', source: 'typed' });
    sq.setPendingCode('ABC23Y');
    supabase.rpc.mockResolvedValue({ data: { ok: false, reason: 'not_new' }, error: null });
    await sq.applyPendingCode('uM');
    expect(trackGrowthEvent).toHaveBeenLastCalledWith('squad_join', { ok: 0, reason: 'not_new', source: 'link' });
    expect(JSON.stringify(trackGrowthEvent.mock.calls)).not.toMatch(/ABC23/);
  });

  test('pass activation and a counted friend are logged', async () => {
    sq.setSquadUser('uN');
    supabase.rpc.mockResolvedValue({ data: { ok: true, days: 14, proUntil: new Date(Date.now() + 14 * DAY).toISOString(), passes: 1 }, error: null });
    await sq.activatePass('uN', 7);
    expect(trackGrowthEvent).toHaveBeenLastCalledWith('squad_pass_activated', { days: 14 });
    expect(sq.getPassCount('uN')).toBe(1);
    expect(sq.isSquadProActive('uN')).toBe(true);
    supabase.rpc.mockResolvedValue({ data: { ok: false, reason: 'used' }, error: null });
    await sq.activatePass('uN', 7);
    expect(trackGrowthEvent).toHaveBeenLastCalledWith('squad_pass_failed', { reason: 'used' });
    supabase.rpc.mockResolvedValue({ data: { qualified: true, pending: false, proUntil: null, direct: 0, passes: 2 }, error: null });
    await sq.squadPing('uN', { force: true });
    expect(trackGrowthEvent).toHaveBeenLastCalledWith('squad_friend_counted', {});
    expect(sq.getPassCount('uN')).toBe(2);
  });
});
