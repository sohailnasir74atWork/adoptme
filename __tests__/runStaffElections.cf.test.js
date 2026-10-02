/**
 * functions/runStaffElections.js against an in-memory RTDB and a fake
 * Supabase. firebase-admin / firebase-functions live in functions/node_modules,
 * so both are virtual mocks here.
 */

const sent = [];
const removedTokens = [];

// ── tiny RTDB ──────────────────────────────────────────────────────────
const makeDb = (initial) => {
  const store = JSON.parse(JSON.stringify(initial));
  const parts = (p) => String(p || '').split('/').filter(Boolean);
  const getAt = (p) => parts(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), store);
  const setAt = (p, v) => {
    const ks = parts(p);
    if (!ks.length) return;
    let o = store;
    for (const k of ks.slice(0, -1)) { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; }
    if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v;
  };
  const snap = (v, key) => ({
    val: () => (v === undefined ? null : v),
    exists: () => v !== undefined && v !== null,
    key,
    forEach: (fn) => { Object.entries(v || {}).forEach(([k, x]) => fn(snap(x, k))); },
  });
  const ref = (path = '') => ({
    once: async () => snap(getAt(path)),
    update: async (obj) => { for (const [k, v] of Object.entries(obj)) setAt(`${path}/${k}`, v); },
    remove: async () => setAt(path, null),
    orderByChild: (child) => ({
      equalTo: (val) => ({
        once: async () => {
          const all = getAt(path) || {};
          const hit = Object.fromEntries(Object.entries(all).filter(([, u]) => u && u[child] === val));
          return snap(hit);
        },
      }),
    }),
  });
  return { ref, store };
};

jest.mock('firebase-admin', () => ({
  apps: [{}],
  initializeApp: jest.fn(),
  database: jest.fn(),
  messaging: () => ({
    send: async (msg) => {
      if (msg.token === 'dead') { const e = new Error('dead'); e.code = 'messaging/registration-token-not-registered'; throw e; }
      sent.push(msg);
      return 'id';
    },
  }),
}), { virtual: true });

jest.mock('firebase-functions/v1', () => ({
  runWith: () => ({ pubsub: { schedule: () => ({ onRun: (fn) => fn }) } }),
}), { virtual: true });

jest.mock('../functions/_supabaseAdmin', () => ({ getSupabaseAdmin: () => null }), { virtual: true });

// ── fake Supabase: rpc() by name, from('squad_codes') for lang + sizes ──
const makeSupabase = (state) => {
  const rpcs = {
    staff_due: async () => state.due || [],
    staff_finalize: async ({ p_election }) => state.finalize[p_election] || { id: p_election, skipped: 'not_closed' },
    staff_pending_apply: async () => state.pending.filter((d) => !d.appliedAt || (d.kind === 'appoint' && !d.notifiedAt)),
    staff_decision_applied: async ({ p_id }) => { const d = state.pending.find((x) => x.id === p_id); if (d) d.appliedAt = 'now'; },
    staff_decision_notified: async ({ p_id }) => { const d = state.pending.find((x) => x.id === p_id); if (d) d.notifiedAt = 'now'; },
    staff_terms_open: async () => state.terms || [],
    staff_end_terms: async (args) => { state.ended.push(args); return 1; },
  };
  const calls = [];
  const chain = (table) => {
    const b = {
      _table: table, _filters: [],
      select() { return b; }, gte(c, v) { b._filters.push(['gte', c, v]); return b; }, order() { return b; },
      eq(c, v) { b._filters.push(['eq', c, v]); return b; },
      range: async () => ({ data: state.squad || [], error: null }),
      maybeSingle: async () => {
        const uid = b._filters.find((f) => f[0] === 'eq' && f[1] === 'uid')?.[2];
        return { data: (state.langs || {})[uid] ? { lang: state.langs[uid] } : null, error: null };
      },
    };
    return b;
  };
  return {
    calls,
    state,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (state.failRpc === name) return { data: null, error: { message: 'boom' } };
      if (!rpcs[name]) return { data: null, error: { message: `no rpc ${name}` } };
      try { return { data: await rpcs[name](args || {}), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
    },
    from: (table) => chain(table),
  };
};

const { _internals: fn } = require('../functions/runStaffElections');

// The function logs every step; keep the test output readable.
beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { console.log.mockRestore(); console.warn.mockRestore(); });
beforeEach(() => { sent.length = 0; removedTokens.length = 0; });

describe('countDue: closed races are counted, admins are told, nobody is appointed', () => {
  test('counts and pushes every admin with a token', async () => {
    const db = makeDb({ users: {
      adm1: { admin: true, fcmToken: 'tok-adm1' },
      adm2: { admin: true },                  // no token
      adm3: { isAdmin: true, fcmToken: 'x' }, // not indexed as admin: not pushed
      mod1: { isModerator: true, fcmToken: 'tok-mod1' },
    } });
    const sb = makeSupabase({
      due: [{ id: 7, role: 'mod' }],
      finalize: { 7: { id: 7, role: 'mod', counted: true, seats: 4, minVotes: 10, candidates: 5, qualified: ['a', 'b'], turnout: 46 } },
      pending: [], terms: [], ended: [],
    });
    const out = await fn.countDue(db, sb);
    expect(out).toEqual([{ id: 7, role: 'mod', qualified: 2, adminsNotified: 1 }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].token).toBe('tok-adm1');
    expect(sent[0].notification.title).toBe('🗳️ MOD election closed');
    expect(sent[0].notification.body).toMatch(/2 of 5 candidates reached 10 votes for 4 seats/);
    expect(sent[0].notification.body).toMatch(/Nothing changes until you decide/);
    // No role was touched.
    expect(db.store.users.mod1.isModerator).toBe(true);
    expect(db.store.users.adm1.isModerator).toBeUndefined();
    // No RTDB update call was made against users/* other than reads.
    expect(sb.calls.map((c) => c[0])).toEqual(['staff_due', 'staff_finalize']);
  });

  test('an already counted race is skipped quietly; nobody-qualified wording', async () => {
    const db = makeDb({ users: { adm1: { admin: true, fcmToken: 'tok' } } });
    const sb = makeSupabase({
      due: [{ id: 1, role: 'jmd' }, { id: 2, role: 'mod' }],
      finalize: {
        1: { id: 1, role: 'jmd', skipped: 'counted' },
        2: { id: 2, role: 'mod', counted: true, seats: 4, minVotes: 10, candidates: 2, qualified: [], turnout: 3 },
      },
      pending: [], terms: [], ended: [],
    });
    const out = await fn.countDue(db, sb);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].notification.body).toMatch(/^Nobody reached 10 votes \(2 on the ballot, 3 votes cast\)/);
  });

  test('a failing staff_due throws so the run logs it and moves on', async () => {
    const db = makeDb({ users: {} });
    const sb = makeSupabase({ due: [], finalize: {}, pending: [], terms: [], ended: [], failRpc: 'staff_due' });
    await expect(fn.countDue(db, sb)).rejects.toThrow('staff_due: boom');
  });
});

describe('applyDecisions: only what an admin decided reaches RTDB', () => {
  test('appoint sets the flag, mod drops jmd, remove clears, each marked and pushed once', async () => {
    const db = makeDb({ users: {
      a: { isBabyMod: true, fcmToken: 'tok-a' },
      b: { fcmToken: 'tok-b' },
      m2: { isModerator: true },
      j9: { isBabyMod: true },
    } });
    const sb = makeSupabase({
      pending: [
        { id: 1, electionId: 7, role: 'mod', uid: 'a', kind: 'appoint', appliedAt: null, notifiedAt: null, until: '2026-12-01T00:00:00Z' },
        { id: 2, electionId: 7, role: 'mod', uid: 'b', kind: 'appoint', appliedAt: 'done', notifiedAt: null, until: '2026-12-01T00:00:00Z' },
        { id: 3, electionId: 7, role: 'mod', uid: 'm2', kind: 'remove', appliedAt: null, notifiedAt: null, until: null },
        { id: 4, electionId: 8, role: 'jmd', uid: 'j9', kind: 'remove', appliedAt: null, notifiedAt: null, until: null },
      ],
      langs: { a: 'ru', b: 'xx' },
      terms: [], ended: [], due: [], finalize: {},
    });
    const done = await fn.applyDecisions(db, sb);
    expect(done.map((d) => d.id)).toEqual([1, 2, 3, 4]);

    expect(db.store.users.a.isModerator).toBe(true);
    expect(db.store.users.a.isBabyMod).toBeUndefined();           // JMD → MOD drops the JMD flag
    expect(typeof db.store.users.a.rolesUpdatedAt).toBe('number');
    expect(db.store.users.b.isModerator).toBeUndefined();         // already applied by the app: not rewritten here
    expect(db.store.users.m2.isModerator).toBeUndefined();        // removed
    expect(db.store.users.j9.isBabyMod).toBeUndefined();          // removed

    const marks = sb.calls.filter((c) => c[0] === 'staff_decision_applied').map((c) => c[1].p_id);
    expect(marks).toEqual([1, 3, 4]);
    const notes = sb.calls.filter((c) => c[0] === 'staff_decision_notified').map((c) => c[1].p_id);
    expect(notes).toEqual([1, 2]);

    expect(sent).toHaveLength(2);
    expect(sent[0].token).toBe('tok-a');
    expect(sent[0].notification.title).toBe(fn.COPY.ru.mod.title);
    expect(sent[1].token).toBe('tok-b');
    expect(sent[1].notification.title).toBe(fn.COPY.en.mod.title);     // unknown lang falls back to English
    expect(sent[1].notification.body).toMatch(/admins confirmed your seat/);

    // Second run: nothing left.
    const again = await fn.applyDecisions(db, sb);
    expect(again).toEqual([]);
    expect(sent).toHaveLength(2);
  });

  test('a winner who deleted their account gets no stub node, no push, and is still marked done', async () => {
    const db = makeDb({ users: {} });
    const sb = makeSupabase({
      pending: [{ id: 5, electionId: 7, role: 'jmd', uid: 'ghost', kind: 'appoint', appliedAt: null, notifiedAt: null, until: null }],
      terms: [], ended: [], due: [], finalize: {},
    });
    await fn.applyDecisions(db, sb);
    expect(db.store.users).toEqual({});
    expect(sent).toHaveLength(0);
    expect(sb.calls.map((c) => c[0])).toEqual(['staff_pending_apply', 'staff_decision_applied', 'staff_decision_notified']);
  });

  test('a failed mark leaves the decision for the next run', async () => {
    const db = makeDb({ users: { a: {} } });
    const sb = makeSupabase({
      pending: [{ id: 6, electionId: 7, role: 'mod', uid: 'a', kind: 'appoint', appliedAt: null, notifiedAt: null, until: null }],
      terms: [], ended: [], due: [], finalize: {}, failRpc: 'staff_decision_applied',
    });
    const done = await fn.applyDecisions(db, sb);
    expect(done).toEqual([]);
    expect(db.store.users.a.isModerator).toBe(true); // the write itself is idempotent, so retrying is safe
  });

  test('a dead token is removed and does not break the run', async () => {
    const db = makeDb({ users: { a: { fcmToken: 'dead' } } });
    const sb = makeSupabase({
      pending: [{ id: 9, electionId: 7, role: 'mod', uid: 'a', kind: 'appoint', appliedAt: 'done', notifiedAt: null, until: null }],
      terms: [], ended: [], due: [], finalize: {},
    });
    await fn.applyDecisions(db, sb);
    expect(db.store.users.a.fcmToken).toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});

describe('closeRemovedTerms: Mod Tools removals close the term', () => {
  test('only holders whose flag is gone are ended, per role', async () => {
    const db = makeDb({ users: { a: { isModerator: true }, b: {}, c: { isBabyMod: true }, d: { isBabyMod: false } } });
    const sb = makeSupabase({
      terms: [{ role: 'mod', uid: 'a' }, { role: 'mod', uid: 'b' }, { role: 'jmd', uid: 'c' }, { role: 'jmd', uid: 'd' }],
      ended: [], pending: [], due: [], finalize: {},
    });
    const gone = await fn.closeRemovedTerms(db, sb);
    expect(gone).toEqual({ mod: ['b'], jmd: ['d'] });
    expect(sb.state.ended).toEqual([
      { p_role: 'mod', p_uids: ['b'], p_reason: 'removed' },
      { p_role: 'jmd', p_uids: ['d'], p_reason: 'removed' },
    ]);
  });
});

describe('run: every step is isolated', () => {
  test('a failing count does not stop decisions from being applied', async () => {
    const db = makeDb({ users: { a: {} } });
    const sb = makeSupabase({
      squad: [], due: [], finalize: {}, failRpc: 'staff_due',
      pending: [{ id: 1, electionId: 7, role: 'mod', uid: 'a', kind: 'appoint', appliedAt: null, notifiedAt: null, until: null }],
      terms: [], ended: [],
    });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    await fn.run(db, sb);
    err.mockRestore();
    expect(db.store.users.a.isModerator).toBe(true);
  });

  test('syncSquadSizes mirrors 3+ and removes stale entries', async () => {
    const db = makeDb({ squad_size: { old: 4, keep: 3 } });
    const sb = makeSupabase({ squad: [{ uid: 'keep', direct_count: 3 }, { uid: 'new', direct_count: 6 }], pending: [], terms: [], ended: [], due: [], finalize: {} });
    const n = await fn.syncSquadSizes(db, sb);
    expect(n).toBe(2);
    expect(db.store.squad_size).toEqual({ keep: 3, new: 6 });
  });
});
