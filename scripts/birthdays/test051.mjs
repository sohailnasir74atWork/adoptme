// PGlite test of supabase/051_birthday_home_and_wish_pushes.sql (on top of 049, 050, Pet Cards).
//   node scripts/birthdays/test051.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';

const ROOT = '/Volumes/Sohail/AI_Projects/RunningApps/adoptme-jan7/supabase/';
const read = (f) => fs.readFileSync(ROOT + f, 'utf8');
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
const rpcErr = async (fn, args = [], uid = 'A') => {
  try { await rpc(fn, args, uid); return null; } catch (e) { return e.message; }
};

// --- stubs for what 004/028/031 provide on the live database ---
await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable as $$ select nullif(current_setting('test.uid', true), '') $$;
  create table public.user_cosmetics (uid text primary key, top_badge text, is_pro boolean not null default false,
    squad_count int not null default 0, updated_at timestamptz not null default now());
  create schema cron; create table cron.job (jobname text);
  create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job values (n); select 1 $$;
  create table public.user_identity_base (uid text primary key, display_name text, avatar text,
    date_of_birth text, created_at_ms bigint, last_activity_ms bigint);
  create table public.user_blocks (uid text not null, blocked_uid text not null, blocked_at_ms bigint, primary key (uid, blocked_uid));
  create function public.safe_chat_minor_age() returns int language sql immutable as $$ select 13 $$;
`);
// dob_age_years exactly as 028 defines it
const f028 = read('028_safe_chat_minors.sql');
const ageFn = f028.slice(f028.indexOf('create or replace function public.dob_age_years'), f028.indexOf('comment on function public.dob_age_years'));
await db.exec(ageFn);

for (const f of ['037_pet_cards.sql', '043_pet_cards_grants.sql', '044_pet_cards_fusion.sql', '048_pet_cards_two_free_packs.sql']) {
  await db.exec(read(f));
}
await db.exec(read('049_birthdays.sql'));
await db.exec(read('050_birthdays_default_on.sql'));
const SQL = read('051_birthday_home_and_wish_pushes.sql');
await db.exec(SQL);
await db.exec(SQL); // idempotent


const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const shift = (days) => new Date(today.getTime() + days * 86400000);
const dob = (age, days = 0) => {
  const d = shift(days);
  return `${d.getUTCFullYear() - age}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const OLD = Date.now() - 400 * 86400000;
const NOW = Date.now();
for (const [uid, name, d, active] of [
  ['A', 'Alice', dob(20), NOW], ['B', 'Bob', dob(25, 3), NOW], ['H', 'Hidden', dob(22), NOW],
  ['M', 'Mini', dob(10), NOW], ['Z', 'Sleepy', dob(30), NOW - 60 * 86400000],
  ['V', 'Viewer', dob(30, 100), NOW], ['W', 'Wisher', dob(31, 50), NOW], ['X', 'Xena', dob(19, 1), NOW],
]) {
  await q(`insert into user_identity_base(uid, display_name, date_of_birth, created_at_ms, last_activity_ms) values ($1,$2,$3,$4,$5)`, [uid, name, d, OLD, active]);
}
await rpc('set_birthday_visibility', [false], 'H');

// birthday_home
ok((await rpcErr('birthday_home', [], '')) === 'sign in required', 'anon refused');
const home = await rpc('birthday_home', [], 'V');
ok(home.month && home.show === true && home.canEdit === true, 'home carries my birthday');
const tIds = home.today.map((r) => r[0]);
ok(tIds.includes('A') && tIds.includes('X'), `today (+1 day slack) has A and X (got ${tIds})`);
ok(!tIds.includes('B'), 'in 3 days: not in today');
ok(!tIds.includes('H') && !tIds.includes('M') && !tIds.includes('Z'), 'hidden / minor / inactive excluded');
ok(home.today.every((r) => Array.isArray(r) && r.length === 3 && typeof r[1] === 'number'), 'rows are [uid, month, day] only');
ok(JSON.stringify(home.today).length < 200, `payload tiny (${JSON.stringify(home).length} bytes total)`);

// wish pushes
const batch = async () => (await q(`select * from public.birthday_wish_push_batch(100)`));
ok((await batch()).length === 0, 'no wishes, no pushes');
await rpc('send_birthday_wish', ['A', 'hbd'], 'W');
await rpc('send_birthday_wish', ['A', 'party'], 'V');
let b1 = await batch();
ok(b1.length === 1 && b1[0].kind === 'first' && b1[0].uid === 'A' && b1[0].from_name === 'Wisher' && b1[0].wishes === 2,
  `first push names the first sender (got ${JSON.stringify(b1)})`);
ok((await batch()).length === 0, 'first push only once');
await rpc('send_birthday_wish', ['A', 'cake'], 'B');
ok((await batch()).length === 0, 'no summary before 8 hours');
await q(`update birthday_wish_pushes set first_at = now() - interval '9 hours' where uid = 'A'`);
let b2 = await batch();
ok(b2.length === 1 && b2[0].kind === 'summary' && b2[0].wishes === 3, `summary after 8h with the total (got ${JSON.stringify(b2)})`);
ok((await batch()).length === 0, 'summary only once');
// no summary when nothing new came in
await rpc('send_birthday_wish', ['X', 'hbd'], 'W');
ok((await batch())[0].kind === 'first', 'X first push');
await q(`update birthday_wish_pushes set first_at = now() - interval '9 hours' where uid = 'X'`);
ok((await batch()).length === 0, 'no summary when no new wishes');

// grants
const g = await q(`select routine_name, grantee from information_schema.routine_privileges where routine_schema='public'
                    and routine_name in ('birthday_home','birthday_wish_push_batch') and grantee in ('anon','PUBLIC','authenticated')`);
ok(g.some((r) => r.routine_name === 'birthday_home' && r.grantee === 'authenticated'), 'home: authenticated');
ok(!g.some((r) => r.grantee === 'anon' || r.grantee === 'PUBLIC'), 'no anon/public');
ok(!g.some((r) => r.routine_name === 'birthday_wish_push_batch'), 'push batch: server only');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
