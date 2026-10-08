// PGlite test of supabase/055_birthday_emails.sql (on top of 049, 050, Pet Cards).
//   node scripts/birthdays/test055.mjs
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';

const ROOT = '/Volumes/Sohail/AI_Projects/RunningApps/adoptme-jan7/supabase/';
const read = (f) => fs.readFileSync(ROOT + f, 'utf8');
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('FAIL', msg); } };
const q = async (s, p) => (await db.query(s, p)).rows;
const as = async (uid) => db.query(`select set_config('test.uid', $1, false)`, [uid || '']);

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
const f028 = read('028_safe_chat_minors.sql');
const ageFn = f028.slice(f028.indexOf('create or replace function public.dob_age_years'), f028.indexOf('comment on function public.dob_age_years'));
await db.exec(ageFn);
for (const f of ['037_pet_cards.sql', '043_pet_cards_grants.sql', '044_pet_cards_fusion.sql', '048_pet_cards_two_free_packs.sql',
  '049_birthdays.sql', '050_birthdays_default_on.sql']) {
  await db.exec(read(f));
}
const SQL = read('055_birthday_emails.sql');
await db.exec(SQL);
await db.exec(SQL); // idempotent

const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const shift = (days) => new Date(today.getTime() + days * 86400000);
const dob = (age, days = 0) => {
  const d = shift(days);
  return `${d.getUTCFullYear() - age}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const OLD = Date.now() - 400 * 86400000;
const NEW = Date.now() - 5 * 86400000;
for (const [uid, name, d, created] of [
  ['A', 'Alice', dob(20), OLD],          // today, adult, old account -> gift
  ['N', 'Newbie', dob(15), NEW],         // today, 15, new account -> no gift
  ['K', 'Kid', dob(10), OLD],            // today, 10 -> never
  ['T', 'Thirteen', dob(13), OLD],       // turns 13 today -> yes
  ['Y', 'Yesterday', dob(20, -1), OLD],  // not today
  ['M', 'Tomorrow', dob(20, 1), OLD],    // not today
  ['X', 'NoDob', null, OLD],
  ['B', 'Bad', 'garbage', OLD],
]) {
  await q(`insert into user_identity_base(uid, display_name, date_of_birth, created_at_ms, last_activity_ms) values ($1,$2,$3,$4,$5)`, [uid, name, d, created, Date.now()]);
}

const batch = async (n = 100) => (await q(`select * from public.birthday_email_batch($1)`, [n]));
const r1 = await batch();
const ids = r1.map((r) => r.r_uid).sort();
ok(JSON.stringify(ids) === JSON.stringify(['A', 'N', 'T']), `today 13+ only (got ${ids})`);
ok(r1.find((r) => r.r_uid === 'A').r_gift === true, 'old account -> gift');
ok(r1.find((r) => r.r_uid === 'N').r_gift === false, 'new account -> no gift');
ok(r1.find((r) => r.r_uid === 'A').r_name === 'Alice', 'name returned');
ok((await batch()).length === 0, 'claimed once: second run returns nobody');
ok(Number((await q(`select count(*)::int as n from birthday_emails`))[0].n) === 3, '3 claims stored');

// Limit
await q(`delete from birthday_emails`);
ok((await batch(1)).length === 1, 'limit 1');
ok((await batch(100)).length === 2, 'rest on the next call');

// Grants: nobody but the service role
const g = await q(`select grantee from information_schema.routine_privileges where routine_schema='public'
                    and routine_name = 'birthday_email_batch' and grantee in ('anon','PUBLIC','authenticated')`);
ok(g.length === 0, 'no anon/authenticated/public execute');
await as('A');
ok((await q(`select has_table_privilege('authenticated', 'public.birthday_emails', 'select') as p`))[0].p === false, 'table closed to clients');

// 29 Feb on a non-leap 28 Feb: checked through _birthday_on, which 055 relies on
const feb = await q(`select public._birthday_on(2027, 2, 29) as d`);
ok(String(feb[0].d).includes('2027') && new Date(feb[0].d).getUTCDate() >= 27, '29 Feb -> 28 Feb in 2027');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
