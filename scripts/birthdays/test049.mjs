// PGlite test of supabase/049_birthdays.sql on top of the Pet Cards migrations.
//   node scripts/birthdays/test049.mjs
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
    date_of_birth text, created_at_ms bigint);
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
const SQL = read('049_birthdays.sql');
await db.exec(SQL);
await db.exec(SQL); // idempotent

// Catalogue: every rarity in haunted26.
const R = ['common', 'uncommon', 'rare', 'ultra', 'legendary'];
let no = 1;
for (const r of R) for (let i = 0; i < 8; i++) {
  await q(`insert into card_catalog(key,name,rarity,no,sets,hd_ready) values ($1,$2,$3,$4,$5,true)`,
    [`h${r}${i}`, `H ${r} ${i}`, r, no++, ['haunted26']]);
}

// Dates relative to UTC today.
const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const shift = (days) => new Date(today.getTime() + days * 86400000);
const dob = (age, days = 0) => {
  const d = shift(days);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear() - age}-${mm}-${dd}`;
};
const OLD = Date.now() - 400 * 86400000;
const players = [
  ['A', 'Alice', dob(20), OLD],          // adult, birthday today
  ['B', 'Bob', dob(25, 3), OLD],         // adult, birthday in 3 days
  ['D', 'Dana', dob(16), OLD],           // 16, birthday today
  ['M', 'Mini', dob(10), OLD],           // 10, birthday today (minor)
  ['N', 'Newbie', dob(19), Date.now()],  // account created today, birthday today
  ['F', 'Far', dob(30, 60), OLD],        // birthday in 60 days
  ['X', 'NoDob', null, OLD],
];
for (const [uid, name, d, created] of players) {
  await q(`insert into user_identity_base(uid, display_name, date_of_birth, created_at_ms) values ($1,$2,$3,$4)`, [uid, name, d, created]);
}

// --- anon ---
ok((await rpcErr('get_my_birthday', [], '')) === 'sign in required', 'anon refused (mine)');
ok((await rpcErr('list_birthdays', [7], '')) === 'sign in required', 'anon refused (list)');

// --- own birthday ---
let me = await rpc('get_my_birthday', [], 'A');
ok(me.month === today.getUTCMonth() + 1 && me.day === today.getUTCDate(), 'A month/day');
ok(me.show === false && me.asked === false && me.minor === false, 'A defaults');
ok(me.giftReady === true && me.giftOpened === false, 'A gift ready');
ok(!JSON.stringify(me).match(/"year"|"age"|\d{4}-\d{2}-\d{2}/), 'no year/age/dob in get_my_birthday');
me = await rpc('get_my_birthday', [], 'X');
ok(me.month === null && me.giftReady === false, 'no DOB -> empty');
me = await rpc('get_my_birthday', [], 'N');
ok(me.giftReady === false, 'new account: no gift');
me = await rpc('get_my_birthday', [], 'M');
ok(me.minor === true && me.giftReady === true, 'minor: private but still a gift');

// --- visibility ---
let v = await rpc('set_birthday_visibility', [true], 'A');
ok(v.show === true && v.asked === true, 'A shows');
v = await rpc('set_birthday_visibility', [true], 'M');
ok(v.show === false, 'minor cannot show');
ok((await one(`select show_public from birthday_prefs where uid='M'`)).show_public === false, 'minor stored hidden');
await rpc('set_birthday_visibility', [true], 'B');
await rpc('set_birthday_visibility', [true], 'D');
await rpc('set_birthday_visibility', [true], 'F');
await rpc('set_birthday_visibility', [false], 'N');
ok((await rpc('get_my_birthday', [], 'N')).asked === true, 'not-now recorded as asked');
// a minor whose row somehow says true is still never listed
await q(`update birthday_prefs set show_public = true where uid = 'M'`);

// --- list ---
let list = await rpc('list_birthdays', [7], 'B');
const ids = list.map((x) => x.uid);
ok(ids.includes('A') && ids.includes('D') && ids.includes('B'), `list has A, D, B (got ${ids})`);
ok(!ids.includes('M'), 'minor never listed');
ok(!ids.includes('N'), 'opted-out not listed');
ok(!ids.includes('F'), '60 days away not in 7-day list');
ok(list.every((x) => Object.keys(x).sort().join() === 'avatar,day,month,name,uid,wished,wishes'), 'list rows: only month/day');
ok(ids.indexOf('A') < ids.indexOf('B'), 'today before later');
ok((await rpc('list_birthdays', [31], 'B')).length === list.length, '31 days still excludes 60');
ok((await rpc('list_birthdays', [999], 'B')).length === list.length, 'days clamped to 31');
// blocks hide both ways
await q(`insert into user_blocks(uid, blocked_uid) values ('A', 'D')`);
ok(!(await rpc('list_birthdays', [7], 'A')).some((x) => x.uid === 'D'), 'A blocked D: hidden for A');
ok(!(await rpc('list_birthdays', [7], 'D')).some((x) => x.uid === 'A'), 'A blocked D: A hidden for D');

// --- public profile line ---
const pb = await rpc('get_public_birthday', ['B'], 'A');
ok(pb && pb.month && pb.day && Object.keys(pb).length === 2, 'public birthday month/day only');
ok((await rpc('get_public_birthday', ['M'], 'A')) === null, 'minor profile: nothing');
ok((await rpc('get_public_birthday', ['N'], 'A')) === null, 'opted-out profile: nothing');
ok((await rpc('get_public_birthday', ['D'], 'A')) === null, 'blocked profile: nothing');
ok((await rpc('get_public_birthday', ['N'], 'N')) !== null, 'own profile always');

// --- wishes ---
ok((await rpcErr('send_birthday_wish', ['B', 'hbd'], 'A')) === 'not their birthday', 'B not today');
ok((await rpcErr('send_birthday_wish', ['A', 'hbd'], 'A')) === 'cannot wish this player', 'no self wish');
ok((await rpcErr('send_birthday_wish', ['M', 'hbd'], 'A')) === 'cannot wish this player', 'no wish to minor');
ok((await rpcErr('send_birthday_wish', ['D', 'hbd'], 'A')) === 'cannot wish this player', 'no wish across a block');
ok((await rpcErr('send_birthday_wish', ['A', 'free text!'], 'B')) === 'bad template', 'templates only');
let w = await rpc('send_birthday_wish', ['A', 'party'], 'B');
ok(w.wishes === 1, 'wish counted');
ok((await rpcErr('send_birthday_wish', ['A', 'hbd'], 'B')) === 'already wished', 'one wish per birthday');
await rpc('send_birthday_wish', ['A', 'cake'], 'F');
me = await rpc('get_my_birthday', [], 'A');
ok(me.wishCount === 2 && me.wishes.length === 2 && me.wishes[0].name && me.wishes[0].template, 'A sees 2 wishes with names');
list = await rpc('list_birthdays', [7], 'B');
const aRow = list.find((x) => x.uid === 'A');
ok(aRow.wishes === 2 && aRow.wished === true, 'list shows count + wished');

// --- birthday pack ---
const pack = await rpc('open_card_pack', ['haunted26', 'birthday'], 'A');
ok(pack.cards.length === 3, 'birthday pack has 3 cards');
const rar = (await q(`select key, rarity from card_catalog`)).reduce((m, r) => ({ ...m, [r.key]: r.rarity }), {});
ok(['ultra', 'legendary'].includes(rar[pack.cards[2].key]), `hit card ultra+ (got ${rar[pack.cards[2].key]})`);
ok((await rpcErr('open_card_pack', ['haunted26', 'birthday'], 'A')) === 'birthday pack not available', 'once per birthday');
me = await rpc('get_my_birthday', [], 'A');
ok(me.giftReady === false && me.giftOpened === true, 'gift opened');
ok((await rpcErr('open_card_pack', ['haunted26', 'birthday'], 'B')) === 'birthday pack not available', 'not on another day');
ok((await rpcErr('open_card_pack', ['haunted26', 'birthday'], 'N')) === 'birthday pack not available', 'not for a new account');
ok((await rpc('open_card_pack', ['haunted26', 'free'], 'A')).cards.length === 3, 'free packs still work');
// hit odds over many birthdays: always Ultra or Legendary
let allHits = true;
for (let i = 0; i < 40; i++) {
  const uid = `U${i}`;
  await q(`insert into user_identity_base(uid, display_name, date_of_birth, created_at_ms) values ($1,$2,$3,$4)`, [uid, uid, dob(22), OLD]);
  const p = await rpc('open_card_pack', ['haunted26', 'birthday'], uid);
  if (!['ultra', 'legendary'].includes(rar[p.cards[2].key])) allHits = false;
}
ok(allHits, '40 birthday packs: every hit Ultra or Legendary');

// --- dates ---
ok((await one(`select public._birthday_on(2027, 2, 29) d`)).d.toISOString().startsWith('2027-02-28'), '29 Feb -> 28 Feb in 2027');
ok((await one(`select public._birthday_on(2028, 2, 29) d`)).d.toISOString().startsWith('2028-02-29'), '29 Feb kept in 2028');
ok((await one(`select public._birthday_days_from(1, 1, '2026-12-31'::date) n`)).n === 1, 'year wrap');
ok((await one(`select public._birthday_md('2010-13-40') m`)).m === null, 'bad dob -> null');

// --- push batch ---
const batch1 = (await q(`select * from public.birthday_push_batch(100) u`)).map((r) => r.u).sort();
ok(batch1.includes('A') && batch1.includes('D') && batch1.includes('M') && !batch1.includes('N') && !batch1.includes('B'),
  `push: today's, 30+ day accounts (got ${batch1.slice(0, 8)})`);
ok((await q(`select * from public.birthday_push_batch(100) u`)).length === 0, 'push: once a year');

// --- grants ---
const g = await q(`select routine_name, grantee from information_schema.routine_privileges
                    where routine_schema='public' and routine_name like '%birthday%' and grantee in ('anon','authenticated','PUBLIC')`);
ok(!g.some((r) => r.grantee === 'anon' || r.grantee === 'PUBLIC'), 'no anon/public execute');
ok(!g.some((r) => r.routine_name === 'birthday_push_batch'), 'push batch: server only');
ok(g.some((r) => r.routine_name === 'list_birthdays' && r.grantee === 'authenticated'), 'list: authenticated');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
