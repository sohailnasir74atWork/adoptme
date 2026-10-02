// PGlite test of supabase/041_staff_admin_final.sql on top of 038 + 040.
//
//   node scripts/staff-elections/test041.mjs
//
// Stubs the few outside objects the election SQL touches (firebase_uid,
// squad_codes, user_identity_base, mod_actions, user_roles, dob_age_years,
// _squad_valid_device, cron.schedule), then runs one election end to end:
// open → apply → approve → vote → count → admin decides → finish.
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sql = (f) => fs.readFileSync(path.join(ROOT, 'supabase', f), 'utf8');

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const as = async (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid || '']);
const rpc = async (fn, args = [], uid = 'A') => {
  await as(uid);
  const ph = args.map((_, i) => `$${i + 1}`).join(',');
  const r = await one(`select public.${fn}(${ph}) as r`, args);
  return r.r;
};
const rpcErr = async (fn, args = [], uid = 'A') => {
  try { await rpc(fn, args, uid); return null; } catch (e) { return e.message; }
};
const DAY = 'interval \'1 day\'';

// ── stubs ──────────────────────────────────────────────────────────────
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create function public.firebase_uid() returns text language sql stable as $$ select nullif(current_setting('test.uid', true), '') $$;
  create schema cron; create table cron.job (jobname text);
  create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job values (n); select 1 $$;
  create table public.squad_codes (uid text primary key, code text, device text, lang text not null default 'en',
    direct_count int not null default 0, total_count int not null default 0);
  create table public.user_identity_base (uid text primary key, display_name text, avatar text, email text,
    decoded_email text, created_at_ms bigint, date_of_birth text);
  create table public.mod_actions (id bigserial primary key, action text, target_uid text, target_email text,
    is_permanent boolean not null default false, banned_until_ms bigint, created_at timestamptz not null default now());
  create table public.user_roles (uid text primary key, is_admin boolean not null default false,
    is_moderator boolean not null default false, is_baby_mod boolean not null default false,
    is_trusted boolean not null default false, is_cmsr boolean not null default false, is_helper boolean not null default false);
  create function public.dob_age_years(p_dob text) returns int language sql stable as $$
    select case when p_dob is null or p_dob !~ '^\\d{4}-\\d{1,2}-\\d{1,2}$' then null
                else extract(year from age(p_dob::date))::int end $$;
  create function public._squad_valid_device(p text) returns boolean language sql immutable as $$
    select p is not null and length(p) between 6 and 128 and p !~ '\\s' $$;
`);
await db.exec(sql('038_staff_elections.sql'));
await db.exec(sql('040_staff_applications.sql'));
await db.exec(sql('041_staff_admin_final.sql'));
await db.exec(sql('041_staff_admin_final.sql')); // idempotent
ok((await one(`select count(*)::int n from cron.job`)).n === 1, '041 twice: cron still scheduled once');
ok((await one(`select count(*)::int n from pg_indexes where indexname = 'staff_elections_one_live'`)).n === 1, 'one_live index exists');
ok((await one(`select count(*)::int n from pg_indexes where indexname = 'staff_elections_one_open'`)).n === 0, 'one_open index dropped');
ok((await one(`select count(*)::int n from pg_proc where proname = 'staff_mark_applied'`)).n === 0, 'staff_mark_applied dropped');

// ── seed ───────────────────────────────────────────────────────────────
const old = Date.now() - 400 * 86400000; // account age: old
const people = {
  ADMIN: { admin: true },
  M1: { mod: true, squad: 7 },       // sitting MOD who runs again
  M2: { mod: true, squad: 7 },       // sitting MOD who does not run
  J1: { jmd: true, squad: 4 },       // sitting JMD with an expired term later
  A: { squad: 9 }, B: { squad: 6 }, C: { squad: 5 }, D: { squad: 5 }, E: { squad: 8 },
};
for (const [uid, p] of Object.entries(people)) {
  await q(`insert into user_identity_base (uid, display_name, avatar, email, decoded_email, created_at_ms, date_of_birth)
           values ($1, $2, $3, $4, $4, $5, '1995-05-05')`, [uid, `Name ${uid}`, `https://cdn/${uid}.jpg`, `${uid.toLowerCase()}@x.com`, old]);
  await q(`insert into user_roles (uid, is_admin, is_moderator, is_baby_mod) values ($1, $2, $3, $4)`,
    [uid, !!p.admin, !!p.mod, !!p.jmd]);
  await q(`insert into squad_codes (uid, code, device, direct_count) values ($1, $2, $3, $4)`,
    [uid, `C${uid}`, `dev-${uid}-000000`, p.squad || 0]);
}
for (let i = 1; i <= 15; i++) {
  await q(`insert into user_identity_base (uid, display_name, created_at_ms) values ($1, $2, $3)`, [`V${i}`, `Voter ${i}`, old]);
}
// M1 already holds a seat from an earlier (hand-made) term.
await q(`insert into staff_terms (role, uid, votes, starts_at, ends_at) values ('mod', 'M1', 0, now() - ${DAY} * 20, now() + ${DAY} * 40)`);

// ── open + nominations ─────────────────────────────────────────────────
let r = await rpc('staff_admin_open', ['mod', 2], 'ADMIN');
ok(r.ok === true, 'admin opens a MOD race with 2 seats');
const EL = r.id;
ok((await rpcErr('staff_admin_open', ['mod', 2], 'V1')) === 'admin only', 'non-admin cannot open');
ok((await rpc('staff_admin_open', ['mod', 2], 'ADMIN')).reason === 'already_open', 'second open refused');

for (const uid of ['A', 'B', 'C', 'D', 'E', 'M1']) {
  r = await rpc('staff_run', [EL, `pitch ${uid}`], uid);
  ok(r.ok === true && r.status === 'pending', `${uid} applies`);
}
for (const uid of ['A', 'B', 'C', 'E', 'M1']) {
  r = await rpc('staff_admin_review', [EL, uid, true, null], 'ADMIN');
  ok(r.ok === true && r.status === 'approved', `${uid} approved`);
}
r = await rpc('staff_admin_review', [EL, 'D', false, 'no'], 'ADMIN');
ok(r.status === 'rejected', 'D rejected');

// ── voting ─────────────────────────────────────────────────────────────
await q(`update staff_elections set nominations_at = now() - ${DAY} * 5, voting_at = now() - ${DAY} * 1, closes_at = now() + ${DAY} * 2 where id = $1`, [EL]);
let g = await rpc('staff_elections_get', [], 'V1');
ok(g.elections[0].phase === 'voting', 'phase voting');
ok(g.elections[0].candidates.every((c) => c.votes === null && c.qualified === null), 'votes hidden while voting');

const votes = { A: 12, B: 11, M1: 10, E: 10, C: 3 }; // min_votes for MOD is 10
let v = 0;
for (const [cand, n] of Object.entries(votes)) {
  for (let i = 0; i < n; i++) {
    v++;
    const voter = `V${((v - 1) % 15) + 1}X${v}`; // unique voters, each on their own phone
    await q(`insert into user_identity_base (uid, display_name, created_at_ms) values ($1, $1, $2) on conflict do nothing`, [voter, old]);
    r = await rpc('staff_vote', [EL, cand, `phone-${voter}`], voter);
    if (!r.ok) console.log('vote refused', cand, voter, r);
  }
}
ok((await one(`select count(*)::int n from staff_votes where election_id = $1`, [EL])).n === 46, '46 votes stored');

// E gets banned during voting: still counted, but not suggested and not appointable.
await q(`insert into mod_actions (action, target_uid, target_email, is_permanent) values ('ban', 'E', 'e@x.com', true)`);

// ── count (service role path) ──────────────────────────────────────────
ok((await rpc('staff_due', [], '')).length === 0, 'nothing due before close');
await q(`update staff_elections set closes_at = now() - interval '1 minute' where id = $1`, [EL]);
let due = await rpc('staff_due', [], '');
ok(due.length === 1 && due[0].id === EL, 'due after close');

r = await rpc('staff_finalize', [EL], '');
ok(r.counted === true && r.role === 'mod', 'finalize counts');
// A 12, B 11, then E and M1 tied at 10: the bigger squad (E, 8) goes first.
ok(JSON.stringify(r.qualified) === JSON.stringify(['A', 'B', 'E', 'M1']), `qualified ranked by votes, then squad (${JSON.stringify(r.qualified)})`);
let e = await one(`select status, counted_at, winners, results from staff_elections where id = $1`, [EL]);
ok(e.status === 'counted' && e.counted_at !== null && e.winners === null, 'status counted, no winners yet');
ok((await one(`select count(*)::int n from staff_terms where ended_at is null and role = 'mod'`)).n === 1, 'no term changed at count');
ok((await one(`select count(*)::int n from user_roles where is_moderator`)).n === 2, 'no role changed at count (mirror untouched)');
ok((await one(`select status from staff_candidates where election_id = $1 and uid = 'D'`, [EL])).status === 'rejected', 'rejected stays rejected');
r = await rpc('staff_finalize', [EL], '');
ok(r.skipped === 'counted', 'finalize again is a no-op');
ok((await rpc('staff_due', [], '')).length === 0, 'counted election no longer due');
ok((await rpc('staff_elections_brief', [], '')).length === 0, 'brief hides a counted election');
ok((await rpc('staff_admin_open', ['mod', 2], 'ADMIN')).reason === 'review_pending', 'no new MOD race while under review');
ok((await rpc('staff_admin_open', ['jmd', 6], 'ADMIN')).ok === true, 'a JMD race can still open');

// Players: review phase, votes visible, nobody won yet.
g = await rpc('staff_elections_get', [], 'V1');
let el = g.elections.find((x) => x.id === EL);
ok(el.phase === 'review', 'players see phase review');
ok(el.candidates[0].uid === 'A' && el.candidates[0].votes === 12 && el.candidates[0].qualified === true && el.candidates[0].won === false, 'A: 12 votes, qualified, not won yet');
ok(el.candidates.find((c) => c.uid === 'C').qualified === false, 'C below the bar');
ok((await rpc('staff_run', [EL, 'late'], 'D')).reason === 'not_nominations', 'no applying during review');
ok((await rpc('staff_vote', [EL, 'A', 'phone-late-1'], 'V2')).reason === 'not_voting', 'no voting during review');

// ── admin review ───────────────────────────────────────────────────────
ok((await rpcErr('staff_admin_results', [], 'V1')) === 'admin only', 'results are admin only');
let res = await rpc('staff_admin_results', [], 'ADMIN');
ok(res.elections.length === 1 && res.elections[0].id === EL, 'one election under review');
let R = res.elections[0];
ok(JSON.stringify(R.suggestion.appoint) === JSON.stringify(['A', 'B']), `suggest appoint A, B (2 seats) got ${JSON.stringify(R.suggestion.appoint)}`);
ok(JSON.stringify(R.suggestion.remove) === JSON.stringify(['M1', 'M2']), `suggest remove M1, M2 got ${JSON.stringify(R.suggestion.remove)}`);
ok(R.candidates.length === 5 && R.candidates[0].uid === 'A' && R.candidates[0].suggested === true, 'candidates ranked, A suggested');
ok(R.candidates.find((c) => c.uid === 'E').check.banned === true && R.candidates.find((c) => c.uid === 'E').suggested === false, 'banned E flagged, not suggested');
ok(R.candidates.find((c) => c.uid === 'M1').holder === true, 'M1 marked as a sitting holder');
ok(R.holders.length === 2 && R.holders.every((h) => h.suggestRemove === true), 'both holders suggested for removal');
ok(R.holders.find((h) => h.uid === 'M1').candidate === true && R.holders.find((h) => h.uid === 'M1').elected === true, 'M1 holder: candidate, has a term');
ok(R.turnout === 46 && R.appointed === 0 && R.removed === 0, 'turnout and counters');

// Decisions.
ok((await rpcErr('staff_admin_decide', [EL, 'A', 'appoint'], 'V1')) === 'admin only', 'decide is admin only');
ok((await rpc('staff_admin_decide', [EL, 'C', 'appoint'], 'ADMIN')).reason === 'not_qualified', 'C below the bar cannot be appointed');
ok((await rpc('staff_admin_decide', [EL, 'D', 'appoint'], 'ADMIN')).reason === 'not_qualified', 'rejected D cannot be appointed');
ok((await rpc('staff_admin_decide', [EL, 'E', 'appoint'], 'ADMIN')).reason === 'banned', 'banned E cannot be appointed');
ok((await rpc('staff_admin_decide', [EL, 'ADMIN', 'remove'], 'ADMIN')).reason === 'not_holder', 'an admin is not a holder');
ok((await rpc('staff_admin_decide', [EL, 'J1', 'remove'], 'ADMIN')).reason === 'not_holder', 'a JMD is not a MOD holder');
ok((await rpc('staff_admin_decide', [EL, 'V1', 'none'], 'ADMIN')).reason === 'not_in_election', 'a stranger cannot get a decision');
ok((await rpc('staff_admin_decide', [EL, 'A', 'maybe'], 'ADMIN')).reason === 'kind', 'bad kind');

r = await rpc('staff_admin_decide', [EL, 'A', 'appoint'], 'ADMIN');
ok(r.ok === true && r.kind === 'appoint', 'appoint A');
ok((await one(`select count(*)::int n from staff_terms where uid = 'A' and role = 'mod' and ended_at is null and election_id = $1 and votes = 12`, [EL])).n === 1, 'A has a term from this election');
r = await rpc('staff_admin_decide', [EL, 'B', 'none'], 'ADMIN');
ok(r.ok === true && r.kind === 'none', 'B: no change for now');
r = await rpc('staff_admin_decide', [EL, 'B', 'appoint'], 'ADMIN');
ok(r.ok === true, 'none → appoint allowed');
ok((await rpc('staff_admin_decide', [EL, 'A', 'none'], 'ADMIN')).reason === 'decided', 'appoint is final');
ok((await rpc('staff_admin_decide', [EL, 'A', 'remove'], 'ADMIN')).reason === 'decided', 'appoint cannot become remove');
r = await rpc('staff_admin_decide', [EL, 'M1', 'appoint'], 'ADMIN');
ok(r.ok === true, 'sitting M1 re-appointed');
ok((await one(`select end_reason from staff_terms where uid = 'M1' and election_id is null`)).end_reason === 'reelected', 'M1 old term ended as reelected');
ok((await one(`select count(*)::int n from staff_terms where uid = 'M1' and ended_at is null`)).n === 1, 'M1 has exactly one active term');
r = await rpc('staff_admin_decide', [EL, 'M2', 'remove'], 'ADMIN');
ok(r.ok === true && r.kind === 'remove', 'remove M2');
ok((await rpc('staff_admin_decide', [EL, 'M2', 'none'], 'ADMIN')).reason === 'decided', 'remove is final');

res = await rpc('staff_admin_results', [], 'ADMIN');
R = res.elections[0];
ok(R.appointed === 3 && R.removed === 1, 'counters: 3 appointed, 1 removed');
ok(R.candidates.find((c) => c.uid === 'A').decision === 'appoint' && R.holders.find((h) => h.uid === 'M2').decision === 'remove', 'decisions shown on both lists');

// Players during review: appointed ones show as won.
g = await rpc('staff_elections_get', [], 'V1');
el = g.elections.find((x) => x.id === EL);
ok(el.candidates.find((c) => c.uid === 'A').won === true && el.candidates.find((c) => c.uid === 'E').won === false, 'won = appointed during review');
g = await rpc('staff_elections_get', [], 'ADMIN');
ok(g.reviewPending === 1, 'admin sees reviewPending');

// Cloud Function side: what is owed to RTDB.
let pend = await rpc('staff_pending_apply', [], '');
ok(pend.length === 4, `4 decisions pending (got ${pend.length})`);
const pa = pend.find((d) => d.uid === 'A');
ok(pa.kind === 'appoint' && pa.until !== null && pa.appliedAt === null && pa.notifiedAt === null, 'A pending with term end');
ok(pend.find((d) => d.uid === 'M2').kind === 'remove' && pend.find((d) => d.uid === 'M2').until === null, 'M2 remove pending, no term');
let open = await rpc('staff_terms_open', [], '');
ok(!open.some((t) => t.uid === 'A') && !open.some((t) => t.uid === 'M1'), 'unapplied appointments are not checked for removal');
await rpc('staff_decision_applied', [pa.id], '');
open = await rpc('staff_terms_open', [], '');
ok(open.some((t) => t.uid === 'A' && t.role === 'mod'), 'applied appointment is checked');
pend = await rpc('staff_pending_apply', [], '');
ok(pend.find((d) => d.uid === 'A') && pend.find((d) => d.uid === 'A').appliedAt !== null, 'A still pending for the push');
await rpc('staff_decision_notified', [pa.id], '');
pend = await rpc('staff_pending_apply', [], '');
ok(!pend.some((d) => d.uid === 'A'), 'A done after apply + notify');
for (const d of pend) { await rpc('staff_decision_applied', [d.id], ''); if (d.kind === 'appoint') await rpc('staff_decision_notified', [d.id], ''); }
ok((await rpc('staff_pending_apply', [], '')).length === 0, 'nothing pending');

// ── finish ─────────────────────────────────────────────────────────────
ok((await rpcErr('staff_admin_finish', [EL], 'V1')) === 'admin only', 'finish is admin only');
r = await rpc('staff_admin_finish', [EL], 'ADMIN');
ok(r.ok === true && r.appointed === 3 && r.removed === 1, 'finish: 3 appointed, 1 removed');
e = await one(`select status, winners, decided_by, finalized_at from staff_elections where id = $1`, [EL]);
ok(e.status === 'finalized' && e.decided_by === 'ADMIN' && e.finalized_at !== null, 'finalized by the admin');
ok(JSON.stringify(e.winners) === JSON.stringify(['A', 'B', 'M1']), `winners = appointed in order (${JSON.stringify(e.winners)})`);
ok((await rpc('staff_admin_finish', [EL], 'ADMIN')).reason === 'not_counted', 'finish twice refused');
ok((await rpc('staff_admin_decide', [EL, 'E', 'none'], 'ADMIN')).reason === 'not_counted', 'no decisions after finish');
ok((await rpc('staff_admin_results', [], 'ADMIN')).elections.length === 0, 'nothing under review');
ok((await one(`select count(*)::int n from staff_elections where status = 'open' and role = 'mod'`)).n === 0, 'no MOD race opened automatically');
r = await rpc('staff_admin_open', ['mod', 4], 'ADMIN');
ok(r.ok === true, 'admin can open the next MOD race by hand');
await rpc('staff_admin_cancel', [r.id], 'ADMIN');

g = await rpc('staff_elections_get', [], 'V1');
el = g.elections.find((x) => x.id === EL);
ok(el.phase === 'finalized' && el.candidates.find((c) => c.uid === 'A').won === true && el.candidates.find((c) => c.uid === 'E').won === false, 'finalized: won from the admin decisions');
ok(g.team.find((m) => m.uid === 'A') === undefined, 'team comes from the roles mirror (RTDB → user_roles), not from decisions');

// ── no-winner election stays with the admin too ────────────────────────
r = await rpc('staff_admin_open', ['mod', 2], 'ADMIN');
const EL2 = r.id;
await q(`update staff_elections set nominations_at = now() - ${DAY} * 8, voting_at = now() - ${DAY} * 5, closes_at = now() - interval '1 minute' where id = $1`, [EL2]);
r = await rpc('staff_finalize', [EL2], '');
ok(r.counted === true && r.qualified.length === 0 && r.candidates === 0, 'empty election is counted, nobody qualified');
res = await rpc('staff_admin_results', [], 'ADMIN');
ok(res.elections.length === 1 && res.elections[0].suggestion.appoint.length === 0, 'no-winner election waits for the admin, suggests nobody');
ok((await one(`select count(*)::int n from staff_elections where status = 'open'`)).n === 1, 'no race opened automatically (only the JMD one from earlier)');
r = await rpc('staff_admin_finish', [EL2], 'ADMIN');
ok(r.ok === true && r.appointed === 0, 'finish with nobody appointed');

// ── term alerts ────────────────────────────────────────────────────────
await q(`update staff_elections set status = 'cancelled' where role = 'jmd' and status = 'open'`);
await q(`insert into staff_terms (role, uid, votes, starts_at, ends_at) values ('jmd', 'J1', 5, now() - ${DAY} * 40, now() - ${DAY} * 2)`);
res = await rpc('staff_admin_results', [], 'ADMIN');
ok(res.termAlerts.length === 1 && res.termAlerts[0].uid === 'J1' && res.termAlerts[0].role === 'jmd', 'expired JMD term with no race is flagged');
await rpc('staff_admin_open', ['jmd', 6], 'ADMIN');
res = await rpc('staff_admin_results', [], 'ADMIN');
ok(res.termAlerts.length === 0, 'alert goes away once a race is open');

// ── grants ─────────────────────────────────────────────────────────────
const grants = await q(`
  select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'execute') as can
    from pg_proc p cross join pg_roles r
   where p.pronamespace = 'public'::regnamespace
     and r.rolname in ('anon', 'authenticated', 'service_role')
     and p.proname in ('staff_admin_results', 'staff_admin_decide', 'staff_admin_finish',
                       'staff_pending_apply', 'staff_decision_applied', 'staff_decision_notified', 'staff_terms_open',
                       'staff_finalize', 'staff_due', '_staff_result', '_staff_holds')`);
const can = (fn, role) => grants.find((x) => x.proname === fn && x.rolname === role)?.can;
for (const fn of ['staff_admin_results', 'staff_admin_decide', 'staff_admin_finish']) {
  ok(can(fn, 'anon') === false && can(fn, 'authenticated') === true, `${fn}: authenticated only`);
}
for (const fn of ['staff_pending_apply', 'staff_decision_applied', 'staff_decision_notified', 'staff_terms_open', 'staff_finalize', 'staff_due']) {
  ok(can(fn, 'anon') === false && can(fn, 'authenticated') === false && can(fn, 'service_role') === true, `${fn}: service role only`);
}
for (const fn of ['_staff_result', '_staff_holds']) {
  ok(can(fn, 'anon') === false && can(fn, 'authenticated') === false, `${fn}: internal`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
