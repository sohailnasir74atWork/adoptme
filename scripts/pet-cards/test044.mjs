// PGlite test of supabase/044_pet_cards_fusion.sql (on top of 037 + 043)
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';

const dir = '/Volumes/Sohail/AI_Projects/RunningApps/adoptme-jan7/supabase';
const read = (f) => fs.readFileSync(`${dir}/${f}`, 'utf8');
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
const copies = async (uid, key, finish) =>
  (await one(`select count from card_collection where uid=$1 and card_key=$2 and finish=$3`, [uid, key, finish]))?.count ?? 0;
const give = (uid, key, finish, n) =>
  q(`insert into card_collection (uid, card_key, finish, count) values ($1,$2,$3,$4)
     on conflict (uid, card_key, finish) do update set count = excluded.count`, [uid, key, finish, n]);

await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable as $$ select nullif(current_setting('test.uid', true), '') $$;
  create table public.user_cosmetics (uid text primary key, top_badge text, is_pro boolean not null default false,
    squad_count int not null default 0, updated_at timestamptz not null default now());
  create schema cron; create table cron.job (jobname text);
  create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job values (n); select 1 $$;
`);
await db.exec(read('037_pet_cards.sql'));
await db.exec(read('043_pet_cards_grants.sql'));
await db.exec(read('044_pet_cards_fusion.sql'));
await db.exec(read('044_pet_cards_fusion.sql')); // idempotent

await q(`insert into card_catalog(key,name,rarity,no,hd_ready) values
  ('dog','Dog','common',1,true), ('owl','Owl','legendary',2,true)`);

// Grants: signed-in only; the helper is not callable at all.
const can = async (role, sig) => (await one(`select has_function_privilege($1, $2, 'execute') v`, [role, sig])).v;
ok(await can('authenticated', 'public.fuse_card(text, text)'), 'authenticated can fuse');
ok(!(await can('anon', 'public.fuse_card(text, text)')), 'anon cannot fuse');
ok(!(await can('anon', 'public._cards_fuse_target(text)')), 'anon cannot call helper');
ok(!(await can('authenticated', 'public._cards_fuse_target(text)')), 'authenticated cannot call helper');

// Refusals
ok((await rpcErr('fuse_card', ['dog', 'classic'], '')) === 'sign in required', 'signed-out refused');
ok((await rpcErr('fuse_card', ['dog', 'holo'])) === 'cannot fuse', 'holo has no fusion');
ok((await rpcErr('fuse_card', ['dog', 'mega'])) === 'cannot fuse', 'mega has no fusion');
ok((await rpcErr('fuse_card', ['nope', 'classic'])) === 'unknown card', 'unknown card refused');
ok((await rpcErr('fuse_card', ['dog', 'classic'])) === 'not enough copies', 'no copies refused');

// 5 Classic -> 1 Classic + 1 Neon
await q(`insert into card_wallet(uid) values ('A') on conflict do nothing`);
for (let i = 0; i < 5; i++) await one(`select _cards_add('A','dog','classic','all','test')`);
await one(`select _cards_settle('A', array['dog'])`);
ok((await copies('A', 'dog', 'classic')) === 5, 'has 5 classic');
const score0 = (await one(`select score from card_wallet where uid='A'`)).score;
ok(score0 === 1, `score 1 for one classic common (got ${score0})`);
const shards0 = (await one(`select shards from card_wallet where uid='A'`)).shards;

let r = await rpc('fuse_card', ['dog', 'classic']);
ok(r.card.finish === 'neon' && r.card.fused === true && r.card.serial === null, 'fused into a serial-less neon');
ok(r.card.newFinish === true && r.left === 1, 'new finish, 1 classic left');
ok((await copies('A', 'dog', 'classic')) === 1 && (await copies('A', 'dog', 'neon')) === 1, 'counts 1 classic + 1 neon');
ok(r.wallet.score === 1 + 3, `score adds neon points (got ${r.wallet.score})`);
ok(r.wallet.shards === shards0, 'fusion pays no shards');
ok((await one(`select card_score from user_cosmetics where uid='A'`)).card_score === 4, 'score mirrored to profile');
ok((await one(`select count(*)::int n from card_pulls where uid='A' and source='fuse' and finish='neon'`)).n === 1, 'fusion logged');

// The last classic copies, showcased: the showcase follows the fused card.
await give('A', 'dog', 'classic', 4);
await rpc('set_card_showcase', [JSON.stringify([{ k: 'dog', f: 'classic' }])]);
r = await rpc('fuse_card', ['dog', 'classic']);
ok(r.left === 0 && (await copies('A', 'dog', 'classic')) === 0, 'classic row removed at 0');
ok((await copies('A', 'dog', 'neon')) === 2, '2 neon now');
ok(r.card.newFinish === false && r.card.dupe === true, 'second neon is a dupe');
ok(r.wallet.score === 3, `classic points gone, neon kept (got ${r.wallet.score})`);
const sc = (await one(`select card_showcase from user_cosmetics where uid='A'`)).card_showcase;
ok(sc.length === 1 && sc[0].k === 'dog' && sc[0].f === 'neon' && sc[0].n === 'Dog', `showcase moved to neon (${JSON.stringify(sc)})`);
const st = await rpc('cards_state');
ok(st.wallet.uniqueCards === 1, 'still 1 unique card');

// 4 Neon -> Mega, never a serial even when a pulled Mega exists elsewhere.
await give('A', 'dog', 'neon', 4);
r = await rpc('fuse_card', ['dog', 'neon']);
ok(r.card.finish === 'mega' && r.card.serial === null, 'neon -> mega, no serial');
ok((await one(`select best_serial from card_collection where uid='A' and card_key='dog' and finish='mega'`)).best_serial === null, 'fused mega row has no serial');
ok((await one(`select coalesce(max(last_serial),0) n from card_serials where card_key='dog' and finish='mega'`)).n === 0, 'serial counter untouched');

// A pulled serial Mega keeps its serial when a fused one joins it.
await q(`insert into card_wallet(uid) values ('B') on conflict do nothing`);
await one(`select _cards_add('B','owl','mega','all','test')`);
await give('B', 'owl', 'neon', 4);
r = await rpc('fuse_card', ['owl', 'neon'], 'B');
ok((await copies('B', 'owl', 'mega')) === 2, 'B has 2 mega');
ok((await one(`select best_serial from card_collection where uid='B' and card_key='owl' and finish='mega'`)).best_serial === 1, 'pulled serial kept');

// Other players' cards are untouched.
ok((await copies('B', 'dog', 'classic')) === 0, 'B unaffected by A');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
