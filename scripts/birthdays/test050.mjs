// PGlite test of supabase/050_birthdays_default_on.sql (on top of 049 and the Pet Cards migrations).
//   node scripts/birthdays/test050.mjs
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
const SQL = read('050_birthdays_default_on.sql');
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
const players = [
  ['A', 'Alice', dob(20), OLD, NOW],            // today, active, no prefs row
  ['B', 'Bob', dob(25, 3), OLD, NOW],           // in 3 days, active
  ['H', 'Hidden', dob(22), OLD, NOW],           // today, chose Hide
  ['M', 'Mini', dob(10), OLD, NOW],             // today, minor
  ['Z', 'Sleepy', dob(30), OLD, NOW - 60 * 86400000], // today, inactive 60 days
  ['V', 'Viewer', dob(30, 100), OLD, NOW],
];
for (const [uid, name, d, created, active] of players) {
  await q(`insert into user_identity_base(uid, display_name, date_of_birth, created_at_ms, last_activity_ms) values ($1,$2,$3,$4,$5)`, [uid, name, d, created, active]);
}
await rpc('set_birthday_visibility', [false], 'H');

// default on
let me = await rpc('get_my_birthday', [], 'A');
ok(me.show === true, 'shown by default');
ok(me.canEdit === true, 'can edit once');
ok((await rpc('get_my_birthday', [], 'M')).show === false, 'minor never shown');
ok((await rpc('get_my_birthday', [], 'H')).show === false, 'hidden stays hidden');

const list = await rpc('list_birthdays', [7], 'V');
const ids = list.map((x) => x.uid);
ok(ids.includes('A') && ids.includes('B'), `default-on players listed (got ${ids})`);
ok(!ids.includes('H'), 'hidden not listed');
ok(!ids.includes('M'), 'minor not listed');
ok(!ids.includes('Z'), 'inactive (60 days) not listed');
ok(ids.indexOf('A') < ids.indexOf('B'), 'today first');
ok(list.every((x) => Object.keys(x).sort().join() === 'avatar,day,month,name,uid,wished,wishes'), 'month/day only');

ok((await rpc('get_public_birthday', ['A'], 'V')) !== null, 'public profile shows default-on birthday');
ok((await rpc('get_public_birthday', ['H'], 'V')) === null, 'hidden profile: nothing');
ok((await rpc('send_birthday_wish', ['A', 'hbd'], 'V')).wishes === 1, 'can wish a default-on player');
ok((await rpcErr('send_birthday_wish', ['H', 'hbd'], 'V')) === 'cannot wish this player', 'cannot wish a hidden player');

// canEdit flips once the function records the correction
await q(`insert into birthday_edits(uid, old_dob, new_dob) values ('A', 'x', 'y')`);
ok((await rpc('get_my_birthday', [], 'A')).canEdit === false, 'canEdit false after the one correction');

// key + index
ok((await one(`select public._birthday_key('2010-10-07') k`)).k === 1007, 'key 1007');
ok((await one(`select public._birthday_key('bad') k`)).k === null, 'bad key null');
for (let i = 0; i < 300; i++) {
  await q(`insert into user_identity_base(uid, display_name, date_of_birth, created_at_ms, last_activity_ms) values ($1,$1,$2,$3,$4)`, [`P${i}`, dob(20, (i % 360) + 1), OLD, NOW]);
}
await q('analyze user_identity_base');
await q('set enable_seqscan = off');
const plan = (await q(`explain select uid from user_identity_base where public._birthday_key(date_of_birth) = any(array[1007,1008])`)).map((r) => r['QUERY PLAN']).join(' ');
ok(/user_identity_base_birthday_key_idx/.test(plan), 'list lookup can use the month/day index');
await q('set enable_seqscan = on');
const big = await rpc('list_birthdays', [7], 'V');
ok(big.length <= 200 && big.every((x) => x.uid !== 'H'), `list after 300 more players: ${big.length} rows, hidden still out`);

// grants
const g = await q(`select grantee from information_schema.routine_privileges where routine_schema='public' and routine_name in ('list_birthdays','get_my_birthday') and grantee in ('anon','PUBLIC')`);
ok(g.length === 0, 'no anon/public execute after replace');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
