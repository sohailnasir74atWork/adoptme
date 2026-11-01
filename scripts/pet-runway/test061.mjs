// PGlite test of supabase/061_pet_runway_events.sql.
//
//   node scripts/pet-runway/test061.mjs
//
// Stubs firebase_uid, user_roles, user_identity_base and the two staff
// checks exactly as live (039 is_staff, 038 _staff_is_admin), then runs
// MODs creating drafts, admins approving and cancelling, and every refusal.
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const as = async (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid || '']);
const rpc = async (fn, args = [], uid = 'A') => {
  await as(uid);
  const ph = args.map((_, i) => `$${i + 1}`).join(',');
  return (await one(`select public.${fn}(${ph}) as r`, args)).r;
};
const err = async (fn, args = [], uid = 'A') => { try { await rpc(fn, args, uid); return null; } catch (e) { return e.message; } };
const day = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const J = (o) => JSON.stringify(o);

// ── stubs (same bodies as live) ────────────────────────────────────────
await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable as $$ select nullif(current_setting('test.uid', true), '') $$;
  create table public.user_roles (uid text primary key, is_admin boolean not null default false,
    is_moderator boolean not null default false, is_baby_mod boolean not null default false);
  create table public.user_identity_base (uid text primary key, display_name text);
  create function public.is_staff() returns boolean language sql security definer set search_path = public stable as $$
    select coalesce(exists (select 1 from public.user_roles where uid = public.firebase_uid() and (is_admin = true or is_moderator = true))
      or lower(current_setting('request.jwt.claims', true)::jsonb ->> 'email') in ('thesolanalabs@gmail.com'), false) $$;
  create function public._staff_is_admin() returns boolean language sql stable set search_path = public as $$
    select coalesce(exists (select 1 from public.user_roles where uid = public.firebase_uid() and is_admin = true)
      or lower(current_setting('request.jwt.claims', true)::jsonb ->> 'email') in ('thesolanalabs@gmail.com'), false) $$;
`);
const migration = fs.readFileSync(path.join(ROOT, 'supabase/061_pet_runway_events.sql'), 'utf8');
await db.exec(migration);
await db.exec(migration); // idempotent
for (const [uid, r] of Object.entries({ ADMIN: [true, false, false], M1: [false, true, false], M2: [false, true, false], J1: [false, false, true], A: [false, false, false] })) {
  await q(`insert into user_roles values ($1, $2, $3, $4)`, [uid, ...r]);
  await q(`insert into user_identity_base values ($1, $2)`, [uid, `Name ${uid}`]);
}
const save = (uid, o = {}) => {
  const a = { id: null, theme: 'cozy_winter', start: day(3), end: day(5), featured: { scenes: ['snow'], items: ['beanie', 'scarf'] }, style: { stamp: 'snow', banner: '#6EC6FF' }, prize: 'normal', note: 'first snow', ...o };
  return [[a.id, a.theme, a.start, a.end, J(a.featured), J(a.style), a.prize, a.note], uid];
};

// ── who may create ─────────────────────────────────────────────────────
ok(await err('runway_event_save', ...save('A')) === 'not_staff', 'a player cannot create');
ok(await err('runway_event_save', ...save('J1')) === 'not_staff', 'a JMD cannot create');
ok(await err('runway_event_save', ...save(null)) === 'not_staff', 'signed out cannot create');
const e1 = Number(await rpc('runway_event_save', ...save('M1')));
ok(e1 > 0, 'a MOD creates a draft');

// ── input checks ───────────────────────────────────────────────────────
ok(await err('runway_event_save', ...save('M1', { theme: 'made_up' })) === 'bad_theme', 'unknown theme refused');
ok(await err('runway_event_save', ...save('M1', { start: day(-1), end: day(1) })) === 'bad_dates', 'start in the past refused');
ok(await err('runway_event_save', ...save('M1', { start: day(1), end: day(15) })) === 'bad_dates', 'longer than 14 days refused');
ok(await err('runway_event_save', ...save('M1', { start: day(5), end: day(4) })) === 'bad_dates', 'end before start refused');
ok(await err('runway_event_save', ...save('M1', { start: day(91), end: day(92) })) === 'bad_dates', 'more than 90 days ahead refused');
ok(await err('runway_event_save', ...save('M1', { featured: { scenes: ['a', 'b', 'c', 'd'] } })) === 'bad_options', '4 featured scenes refused');
ok(await err('runway_event_save', ...save('M1', { featured: { items: ['<script>'] } })) === 'bad_options', 'odd item key refused');
ok(await err('runway_event_save', ...save('M1', { featured: { prizes: ['x'] } })) === 'bad_options', 'unknown featured field refused');
ok(await err('runway_event_save', ...save('M1', { style: { stamp: 'rainbow' } })) === 'bad_options', 'unknown stamp refused');
ok(await err('runway_event_save', ...save('M1', { style: { banner: 'red' } })) === 'bad_options', 'bad banner colour refused');
ok(await err('runway_event_save', ...save('M1', { style: { pro_days: 30 } })) === 'bad_options', 'unknown style field refused');
ok(await err('runway_event_save', ...save('M1', { prize: 'mega' })) === 'bad_prize', 'unknown prize tier refused');
ok(await err('runway_event_save', ...save('M1', { note: 'x'.repeat(301) })) === 'bad_note', 'long note refused');

// ── drafts are private to staff ────────────────────────────────────────
ok(J(await rpc('runway_calendar', [day(0), day(30)], 'A')) === '[]', 'drafts are not in the calendar');
ok(await err('runway_calendar', [day(0), day(30)], null) === 'sign_in', 'calendar needs sign-in');
ok(await err('runway_calendar', [day(0), day(70)], 'A') === 'bad_range', 'calendar range capped');
ok(await err('runway_events_staff', [], 'A') === 'not_staff', 'players cannot list events');
const list1 = await rpc('runway_events_staff', [], 'M1');
ok(list1.events.length === 1 && list1.events[0].mine === true && list1.events[0].status === 'draft' && list1.is_admin === false, 'MOD sees own draft');
ok(list1.events[0].created_by_name === 'Name M1', 'creator name shown');

// ── editing ────────────────────────────────────────────────────────────
ok(await err('runway_event_save', ...save('M2', { id: e1 })) === 'not_yours', "a MOD cannot edit another MOD's draft");
ok(Number(await rpc('runway_event_save', ...save('M1', { id: e1, end: day(6) }))) === e1, 'creator edits own draft');
ok(Number(await rpc('runway_event_save', ...save('ADMIN', { id: e1, end: day(6) }))) === e1, 'admin edits any draft');

// ── approval ───────────────────────────────────────────────────────────
ok(await err('runway_event_approve', [e1], 'M1') === 'not_admin', 'a MOD cannot approve');
const ap = await rpc('runway_event_approve', [e1], 'ADMIN');
ok(ap.theme === 'cozy_winter', 'admin approves');
const cal = await rpc('runway_calendar', [day(0), day(30)], 'A');
ok(cal.length === 1 && cal[0].theme === 'cozy_winter' && cal[0].featured.items.length === 2 && !('note' in cal[0]) && !('created_by' in cal[0]), 'approved event in the calendar, no staff fields');
ok(await err('runway_event_save', ...save('M1', { id: e1 })) === 'not_draft', 'approved event cannot be edited');
ok(await err('runway_event_approve', [e1], 'ADMIN') === 'not_draft', 'approve twice refused');

// ── overlaps ───────────────────────────────────────────────────────────
ok(await err('runway_event_save', ...save('M2', { start: day(6), end: day(8) })) === 'overlap', 'a draft over an approved event refused');
const e2 = Number(await rpc('runway_event_save', ...save('M2', { theme: 'snow_day', start: day(10), end: day(12) })));
const e3 = Number(await rpc('runway_event_save', ...save('M1', { theme: 'holiday_cheer', start: day(11), end: day(13) })));
ok(e2 > e1 && e3 > e2, 'two overlapping drafts may wait side by side');
await rpc('runway_event_approve', [e2], 'ADMIN');
ok(await err('runway_event_approve', [e3], 'ADMIN') === 'overlap', 'approving an overlapping draft refused');

// ── cancel / delete ────────────────────────────────────────────────────
ok(await err('runway_event_cancel', [e2, 'no'], 'M2') === 'not_allowed', 'a MOD cannot cancel an approved event, even their own');
ok(await err('runway_event_cancel', [e3, 'x'], 'M2') === 'not_allowed', "a MOD cannot delete another MOD's draft");
await rpc('runway_event_cancel', [e3, 'changed my mind'], 'M1');
ok((await one(`select status from runway_events where id = $1`, [e3])).status === 'cancelled', 'creator deletes own draft');
await rpc('runway_event_cancel', [e1, 'wrong week'], 'ADMIN');
const cal2 = await rpc('runway_calendar', [day(0), day(30)], 'A');
ok(cal2.length === 1 && cal2[0].theme === 'snow_day', 'cancelled event leaves the calendar');
ok(await err('runway_event_cancel', [e1], 'ADMIN') === null, 'cancel twice is harmless');

// ── log, privileges ────────────────────────────────────────────────────
const log = (await q(`select actor || ':' || action a from runway_event_log order by id`)).map((r) => r.a);
ok(J(log) === J(['M1:create', 'M1:edit', 'ADMIN:edit', 'ADMIN:approve', 'M2:create', 'M1:create', 'ADMIN:approve', 'M1:delete', 'ADMIN:cancel']), `log is complete: ${J(log)}`);
for (const f of ['runway_calendar(date,date)', 'runway_events_staff()', 'runway_event_save(bigint,text,date,date,jsonb,jsonb,text,text)', 'runway_event_approve(bigint)', 'runway_event_cancel(bigint,text)']) {
  ok((await one(`select has_function_privilege('anon', 'public.${f}', 'execute') v`)).v === false, `anon cannot run ${f}`);
  ok((await one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') v`)).v === true, `signed-in can run ${f}`);
}
ok((await one(`select has_table_privilege('authenticated', 'public.runway_events', 'select') v`)).v === false, 'no direct table reads');
ok((await one(`select has_function_privilege('authenticated', 'public._runway_log(bigint,text,jsonb)', 'execute') v`)).v === false, 'helpers are private');

// The theme list must match the app (exported for the jest test).
const keys = (await one(`select public._runway_theme_keys() k`)).k;
fs.writeFileSync(path.join(ROOT, 'scripts/pet-runway/theme-keys.server.json'), J(keys) + '\n');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
