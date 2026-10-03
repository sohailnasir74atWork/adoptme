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
        set: (k, v) => m.set(k, v),
        remove: (k) => m.delete(k),
      };
    },
  };
});

const { supabase } = require('../Code/Supabase/client');
const { getDeviceFingerprint } = require('../Code/Helper/deviceFingerprint');
const el = require('../Code/Helper/staffElections');
const HOUR = 3600000;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const race = (role, now, { nom = -1, vote = 1, close = 2 } = {}) => ({
  id: role === 'mod' ? 1 : 2,
  role,
  nominationsAt: iso(now + nom * DAY),
  votingAt: iso(now + vote * DAY),
  closesAt: iso(now + close * DAY),
});

beforeEach(() => {
  supabase.rpc.mockReset();
});

describe('badge eligibility (mirrors the RTDB rule)', () => {
  test('Badge Access granters skip the squad bar', () => {
    expect(el.canGrantBadge({ anySquad: true, targetSquad: 0 })).toBe(true);
    expect(el.canGrantBadge({ anySquad: false, targetSquad: 0 })).toBe(false);
  });

  test('needs BADGE_MIN_SQUAD squad friends; admins exempt', () => {
    expect(el.BADGE_MIN_SQUAD).toBe(3);
    expect(el.canGrantBadge({ targetSquad: 2 })).toBe(false);
    expect(el.canGrantBadge({ targetSquad: 3 })).toBe(true);
    expect(el.canGrantBadge({ targetSquad: '10' })).toBe(true);
    expect(el.canGrantBadge({ targetSquad: undefined })).toBe(false);
    expect(el.canGrantBadge({ isAdmin: true, targetSquad: 0 })).toBe(true);
  });
});

describe('phases and countdowns', () => {
  const now = Date.UTC(2026, 9, 2, 12);
  test('phaseOf follows the calendar like _staff_phase', () => {
    expect(el.phaseOf(race('mod', now, { nom: 1, vote: 2, close: 3 }), now)).toBe('upcoming');
    expect(el.phaseOf(race('mod', now), now)).toBe('nominations');
    expect(el.phaseOf(race('mod', now, { nom: -2, vote: -1, close: 1 }), now)).toBe('voting');
    expect(el.phaseOf(race('mod', now, { nom: -3, vote: -2, close: -1 }), now)).toBe('counting');
    expect(el.phaseOf({ ...race('mod', now), phase: 'finalized' }, now)).toBe('finalized');
    // Counted and waiting for an admin (041): the server's word wins over the calendar.
    expect(el.phaseOf({ ...race('mod', now, { nom: -3, vote: -2, close: -1 }), phase: 'review' }, now)).toBe('review');
    expect(el.phaseEndsAt({ ...race('mod', now), phase: 'review' }, now)).toBeNull();
    expect(el.phaseOf(null)).toBeNull();
  });

  test('phaseEndsAt points at the next boundary', () => {
    const r = race('mod', now);
    expect(el.phaseEndsAt(r, now)).toBe(Date.parse(r.votingAt));
    expect(el.phaseEndsAt(r, Date.parse(r.votingAt) + 1)).toBe(Date.parse(r.closesAt));
    expect(el.phaseEndsAt(r, Date.parse(r.closesAt) + 1)).toBeNull();
  });

  test('splitDuration', () => {
    expect(el.splitDuration(2 * DAY + 3 * HOUR + 4 * 60000)).toEqual({ d: 2, h: 3, m: 4 });
    expect(el.splitDuration(-5)).toEqual({ d: 0, h: 0, m: 0 });
  });

  test('homeHighlight prefers voting, then MOD; ignores upcoming and closed races', () => {
    expect(el.homeHighlight([], now)).toBeNull();
    expect(el.homeHighlight([{ ...race('mod', now), phase: 'review' }], now)).toBeNull();
    expect(el.homeHighlight([race('mod', now, { nom: 1, vote: 2, close: 3 })], now)).toBeNull();
    const nomMod = race('mod', now);
    const voteJmd = race('jmd', now, { nom: -2, vote: -1, close: 1 });
    const pick = el.homeHighlight([nomMod, voteJmd], now);
    expect(pick.role).toBe('jmd');
    expect(pick.phase).toBe('voting');
    expect(pick.endsAt).toBe(Date.parse(voteJmd.closesAt));
    expect(el.homeHighlight([race('jmd', now), race('mod', now)], now).role).toBe('mod');
  });
});

describe('eligibility', () => {
  const data = (me) => ({ me, rules: el.ROLE_RULES, limits: { voterMinDays: 7 } });
  test('rules: MOD 5 squad + 18, JMD 3 squad + 16', () => {
    expect([el.ROLE_RULES.mod.minSquad, el.ROLE_RULES.mod.minAge]).toEqual([5, 18]);
    expect([el.ROLE_RULES.jmd.minSquad, el.ROLE_RULES.jmd.minAge]).toEqual([3, 16]);
  });
  test('squad bar per role', () => {
    const e = el.eligibility(data({ squad: 4, age: 20, accountDays: 30, cleanRecord: true }));
    expect(e.jmd).toEqual({ need: 0, ok: true, reasons: [], minAge: 16 });
    expect(e.mod).toEqual({ need: 1, ok: false, reasons: ['squad'], minAge: 18 });
    expect(e.vote).toEqual({ ok: true, daysLeft: 0 });
  });
  test('age gates', () => {
    expect(el.eligibility(data({ squad: 5, age: 17, cleanRecord: true })).mod.reasons).toEqual(['age']);
    expect(el.eligibility(data({ squad: 5, age: 17, cleanRecord: true })).jmd.ok).toBe(true);
    expect(el.eligibility(data({ squad: 5, age: 15, cleanRecord: true })).jmd.reasons).toEqual(['age']);
    expect(el.eligibility(data({ squad: 5, age: null, cleanRecord: true })).mod.reasons).toEqual(['age_unknown']);
    expect(el.eligibility(data({ squad: 5, cleanRecord: true })).mod.reasons).toEqual(['age_unknown']);
    expect(el.eligibility(data({ squad: 2, age: 15, cleanRecord: false })).jmd.reasons).toEqual(['squad', 'age', 'record']);
  });
  test('record, sitting MOD and account age', () => {
    expect(el.eligibility(data({ squad: 12, age: 30, cleanRecord: false, accountDays: 30 })).mod.ok).toBe(false);
    expect(el.eligibility(data({ squad: 12, age: 30, cleanRecord: true, isMod: true, accountDays: 30 })).jmd.ok).toBe(false);
    expect(el.eligibility(data({ squad: 12, age: 30, cleanRecord: true, isMod: true, accountDays: 30 })).mod.ok).toBe(true);
    expect(el.eligibility(data({ squad: 0, accountDays: 3 })).vote).toEqual({ ok: false, daysLeft: 4 });
    expect(el.eligibility(data({ squad: 0, accountDays: 30, banned: true })).vote.ok).toBe(false);
  });
  test('the server verdict wins over the local calculation', () => {
    const me = { squad: 1, age: 12, eligible: { mod: { ok: true, reasons: [], squad: 7, minSquad: 5, minAge: 18 }, jmd: { ok: false, reasons: ['record'], squad: 7, minSquad: 3, minAge: 16 } } };
    const e = el.eligibility(data(me));
    expect(e.mod).toEqual({ ok: true, reasons: [], need: 0, minAge: 18 });
    expect(e.jmd).toEqual({ ok: false, reasons: ['record'], need: 0, minAge: 16 });
  });
  test('blockReasonKey picks the first reason', () => {
    const e = el.eligibility(data({ squad: 2, age: 15, cleanRecord: true }));
    expect(el.blockReasonKey(e, 'mod')).toEqual({ key: 'elections.need_more_mod', count: 3 });
    expect(el.blockReasonKey(el.eligibility(data({ squad: 5, age: 15 })), 'jmd')).toEqual({ key: 'elections.need_age_jmd', count: 16 });
    expect(el.blockReasonKey(el.eligibility(data({ squad: 5 })), 'mod')).toEqual({ key: 'elections.need_dob' });
    expect(el.blockReasonKey(el.eligibility(data({ squad: 5, age: 30, isMod: true })), 'jmd')).toEqual({ key: 'elections.err_already_mod' });
    expect(el.blockReasonKey(el.eligibility(data({ squad: 5, age: 30, banned: true })), 'mod')).toEqual({ key: 'elections.err_record' });
    expect(el.blockReasonKey(el.eligibility(data({ squad: 5, age: 30, cleanRecord: true })), 'mod')).toBeNull();
  });
});

describe('RPC calls', () => {
  test('getElections caches per user and seeds the Home calendar', async () => {
    const now = Date.now();
    supabase.rpc.mockResolvedValueOnce({
      data: { elections: [{ ...race('mod', now), phase: 'nominations' }, { ...race('jmd', now), phase: 'finalized' }] },
      error: null,
    });
    const d = await el.getElections('u1');
    expect(d.elections).toHaveLength(2);
    expect(supabase.rpc).toHaveBeenCalledWith('staff_elections_get');
    await el.getElections('u1');
    expect(supabase.rpc).toHaveBeenCalledTimes(1); // cached
    const brief = await el.getBrief();
    expect(supabase.rpc).toHaveBeenCalledTimes(1); // brief came from the screen fetch
    expect(brief.map((b) => b.role)).toEqual(['mod']); // finalized races are not on the Home card
  });

  test('a race under review is not on the Home card', async () => {
    const now = Date.now();
    supabase.rpc.mockResolvedValueOnce({
      data: { elections: [{ ...race('mod', now), phase: 'review' }, { ...race('jmd', now), phase: 'nominations' }] },
      error: null,
    });
    await el.getElections('u9');
    expect((await el.getBrief()).map((b) => b.role)).toEqual(['jmd']);
  });

  test('castVote sends the device id and drops the cache', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    const res = await el.castVote('u1', 7, 'cand');
    expect(res.ok).toBe(true);
    expect(supabase.rpc).toHaveBeenCalledWith('staff_vote', { p_election: 7, p_candidate: 'cand', p_device: 'dev-test-123' });
    supabase.rpc.mockResolvedValueOnce({ data: { elections: [] }, error: null });
    await el.getElections('u1');
    expect(supabase.rpc).toHaveBeenLastCalledWith('staff_elections_get'); // refetched, not cached
  });

  test('castVote without a device id never reaches the server', async () => {
    getDeviceFingerprint.mockResolvedValueOnce(null);
    expect(await el.castVote('u1', 7, 'cand')).toEqual({ ok: false, reason: 'device' });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test('runForRole trims the pitch to PITCH_MAX and passes server reasons through', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'squad', need: 5, have: 4 }, error: null });
    const res = await el.runForRole('u1', 3, 'x'.repeat(400));
    expect(res).toEqual({ ok: false, reason: 'squad', need: 5, have: 4 });
    expect(supabase.rpc.mock.calls[0][1].p_pitch).toHaveLength(el.PITCH_MAX);
  });

  test('network errors throw; getBrief never does', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    await expect(el.withdraw('u1', 3)).rejects.toThrow('offline');
    supabase.rpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });
    expect(await el.getBrief({ force: true })).toEqual([]);
  });

  test('admin calls', async () => {
    supabase.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await el.adminOpen('a', 'jmd', 5);
    await el.adminCancel('a', 9);
    await el.adminDisqualify('a', 9, 'bad');
    await el.adminReview('a', 9, 'cand', false, '  Too many warnings  ');
    await el.adminReview('a', 9, 'cand', true, '');
    expect(supabase.rpc.mock.calls).toEqual([
      ['staff_admin_open', { p_role: 'jmd', p_seats: 5 }],
      ['staff_admin_cancel', { p_election: 9 }],
      ['staff_admin_disqualify', { p_election: 9, p_uid: 'bad' }],
      ['staff_admin_review', { p_election: 9, p_uid: 'cand', p_approve: false, p_note: 'Too many warnings' }],
      ['staff_admin_review', { p_election: 9, p_uid: 'cand', p_approve: true, p_note: null }],
    ]);
  });

  test('adminReview trims the note to 200 chars and drops the screen cache', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: { elections: [] }, error: null });
    await el.getElections('a');
    supabase.rpc.mockResolvedValueOnce({ data: { ok: true, status: 'rejected' }, error: null });
    const res = await el.adminReview('a', 9, 'cand', false, 'x'.repeat(300));
    expect(res).toEqual({ ok: true, status: 'rejected' });
    expect(supabase.rpc.mock.calls[1][1].p_note).toHaveLength(200);
    supabase.rpc.mockResolvedValueOnce({ data: { elections: [] }, error: null });
    await el.getElections('a');
    expect(supabase.rpc).toHaveBeenCalledTimes(3); // refetched after the decision
  });

  test('review: adminResults, adminDecide, adminFinish (041)', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await el.adminResults()).toEqual({ elections: [], termAlerts: [] });
    supabase.rpc.mockResolvedValueOnce({ data: { elections: [{ id: 7 }], termAlerts: [{ uid: 'j' }] }, error: null });
    expect(await el.adminResults()).toEqual({ elections: [{ id: 7 }], termAlerts: [{ uid: 'j' }] });
    expect(supabase.rpc).toHaveBeenLastCalledWith('staff_admin_results');

    // A uid no earlier test cached, so the screen data really comes from the server here.
    supabase.rpc.mockResolvedValueOnce({ data: { elections: [] }, error: null });
    await el.getElections('z1');
    await el.getElections('z1');
    const before = supabase.rpc.mock.calls.length;
    supabase.rpc.mockResolvedValueOnce({ data: { ok: true, kind: 'appoint', role: 'mod' }, error: null });
    expect(await el.adminDecide('z1', 7, 'cand', 'appoint')).toEqual({ ok: true, kind: 'appoint', role: 'mod' });
    expect(supabase.rpc).toHaveBeenLastCalledWith('staff_admin_decide', { p_election: 7, p_uid: 'cand', p_kind: 'appoint' });
    supabase.rpc.mockResolvedValueOnce({ data: { elections: [] }, error: null });
    await el.getElections('z1');
    expect(supabase.rpc).toHaveBeenLastCalledWith('staff_elections_get'); // cache dropped by the decision
    expect(supabase.rpc.mock.calls.length).toBe(before + 2);

    supabase.rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'decided', kind: 'remove' }, error: null });
    expect((await el.adminDecide('z1', 7, 'cand', 'none')).reason).toBe('decided');

    supabase.rpc.mockResolvedValueOnce({ data: { ok: true, role: 'mod', appointed: 2, removed: 1 }, error: null });
    expect(await el.adminFinish('z1', 7)).toEqual({ ok: true, role: 'mod', appointed: 2, removed: 1 });
    expect(supabase.rpc).toHaveBeenLastCalledWith('staff_admin_finish', { p_election: 7 });
    expect(el.DECISION_KINDS).toEqual(['appoint', 'remove', 'none']);
  });

  test('reviewSuggestion words the server suggestion', () => {
    const base = {
      seats: 2, minVotes: 10,
      candidates: [
        { uid: 'a', name: 'Alice', votes: 14, qualified: true, check: {} },
        { uid: 'b', name: 'Bob', votes: 11, qualified: true, check: {} },
        { uid: 'e', name: 'Eve', votes: 10, qualified: true, check: { banned: true } },
        { uid: 'c', name: 'Cat', votes: 3, qualified: false, check: {} },
      ],
      holders: [{ uid: 'm1', name: 'Mystic' }, { uid: 'm2', name: 'Nico' }],
      suggestion: { appoint: ['a', 'b'], remove: ['m1', 'm2'] },
    };
    const s = el.reviewSuggestion(base);
    expect(s.text).toBe('Suggestion: appoint Alice (14), Bob (11); remove Mystic, Nico (not re-elected). 2 of 2 seats would be filled. 1 qualified candidate is banned right now and left out. Nothing changes until you tap.');
    expect(s.appoint.map((x) => x.uid)).toEqual(['a', 'b']);
    expect(s.remove.map((x) => x.name)).toEqual(['Mystic', 'Nico']);
    expect([s.filled, s.qualified, s.bannedOut]).toEqual([2, 3, 1]);

    const none = el.reviewSuggestion({ ...base, candidates: [{ uid: 'c', name: 'Cat', votes: 3, qualified: false }], suggestion: { appoint: [], remove: ['m1'] } });
    expect(none.text).toBe('Nobody reached 10 votes. Suggestion: keep the current team and start a new election when you are ready.');
    expect(none.filled).toBe(0);

    const one = el.reviewSuggestion({ seats: 1, minVotes: 3, candidates: [{ uid: 'a', name: 'Al', votes: 5, qualified: true }], holders: [], suggestion: { appoint: ['a'], remove: [] } });
    expect(one.text).toBe('Suggestion: appoint Al (5). 1 of 1 seat would be filled. Nothing changes until you tap.');
    expect(el.reviewSuggestion(null).text).toMatch(/^Nobody reached 0 votes/);
  });

  test('adminApplications returns a list; adminEligibility skips empty uids', async () => {
    supabase.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await el.adminApplications()).toEqual([]);
    supabase.rpc.mockResolvedValueOnce({ data: [{ uid: 'x', status: 'pending' }], error: null });
    expect(await el.adminApplications()).toEqual([{ uid: 'x', status: 'pending' }]);
    expect(await el.adminEligibility('')).toBeNull();
    expect(supabase.rpc).toHaveBeenCalledTimes(2);
    supabase.rpc.mockResolvedValueOnce({ data: { squad: 3 }, error: null });
    expect(await el.adminEligibility('u')).toEqual({ squad: 3 });
    expect(supabase.rpc).toHaveBeenLastCalledWith('staff_admin_eligibility', { p_uid: 'u' });
  });
});
