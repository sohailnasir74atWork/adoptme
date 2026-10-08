// PGlite test of supabase/053_trade_match_wanters.sql (on top of 032).
//   node scripts/trade-match/test053.mjs
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

// --- stubs for what earlier migrations provide on the live database ---
await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable as $$ select nullif(current_setting('test.uid', true), '') $$;
  create table public.user_identity_base (uid text primary key, display_name text, avatar text, last_activity_ms bigint);
  create table public.user_roblox (uid text primary key, roblox_username text, roblox_username_verified boolean);
  create table public.user_cosmetics (uid text primary key, is_pro boolean not null default false);
  create table public.user_blocks (uid text not null, blocked_uid text not null, primary key (uid, blocked_uid));
  create schema cron; create table cron.job (jobname text);
  create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job values (n); select 1 $$;
`);
await db.exec(read('032_trade_match.sql'));
const SQL = read('053_trade_match_wanters.sql');
await db.exec(SQL);
await db.exec(SQL); // idempotent

const pet = (name, extra = {}) => ({ k: `${name.toLowerCase().replace(/[^a-z0-9]/g, '')}|pet`, n: name, v: 'd', f: false, r: false, i: '', ...extra });
const NOW = Date.now();
for (const [uid, name, active] of [
  ['ME', 'Me', NOW], ['D1', 'Dreamer', NOW - 1000], ['D2', 'DreamerFull', NOW - 5000], ['W1', 'Wisher', NOW - 2000],
  ['W2', 'WisherFull', NOW - 3000], ['NO', 'Nobody', NOW], ['BL', 'Blocked', NOW], ['BY', 'BlocksMe', NOW], ['OLD', 'Stale', NOW],
]) {
  await q(`insert into user_identity_base values ($1, $2, null, $3)`, [uid, name, active]);
}
await q(`insert into user_roblox values ('D2', 'dream_full_rbx', true)`);
await q(`insert into user_cosmetics values ('W2', true)`);

const sync = (uid, have, want, dream = null) => rpc('sync_trade_inventory', [JSON.stringify(have), JSON.stringify(want), dream, 'en', false], uid);

// Me: For Trade = Frost Dragon, Shadow Dragon, Owl; I want Bat Dragon and Giraffe.
await sync('ME', [pet('Frost Dragon'), pet('Shadow Dragon'), pet('Owl')], [pet('Bat Dragon'), pet('Giraffe')]);
// D1: dream is my Frost Dragon; gives Turtle (I don't want it).
await sync('D1', [pet('Turtle')], [pet('Frost Dragon'), pet('Cow')], 'frostdragon|pet');
// D2: dream is my Shadow Dragon AND has my Bat Dragon -> dream + full.
await sync('D2', [pet('Kangaroo'), pet('Bat Dragon'), pet('Crow')], [pet('Shadow Dragon')], 'shadowdragon|pet');
// W1: wants my Owl (not as dream); gives Cow.
await sync('W1', [pet('Cow')], [pet('Owl')]);
// W2: wants my Owl, gives Giraffe (which I want) -> full, Pro.
await sync('W2', [pet('Giraffe')], [pet('Owl')]);
// NO: wants nothing of mine.
await sync('NO', [pet('Owl')], [pet('Cow')]);
// BL / BY: want my pets but blocked either way.
await sync('BL', [], [pet('Owl')]);
await sync('BY', [], [pet('Owl')]);
await q(`insert into user_blocks values ('ME', 'BL'), ('BY', 'ME')`);
// OLD: wants my Owl but last synced 60 days ago.
await sync('OLD', [], [pet('Owl')]);
await q(`update trade_inventory set updated_at = now() - interval '60 days' where uid = 'OLD'`);

ok((await rpcErr('find_pet_wanters', [30], '')) === 'sign in required', 'anon refused');

const list = await rpc('find_pet_wanters', [30], 'ME');
const ids = list.map((x) => x.uid);
ok(JSON.stringify(ids) === JSON.stringify(['D2', 'D1', 'W2', 'W1']), `order dream+full, dream, full, rest (got ${ids})`);
ok(!ids.includes('NO'), 'no overlap = not listed');
ok(!ids.includes('BL') && !ids.includes('BY'), 'blocks either way excluded');
ok(!ids.includes('OLD'), 'inactive 45+ days excluded');
ok(!ids.includes('ME'), 'never myself');

const d2 = list.find((x) => x.uid === 'D2');
ok(d2.dream === true && d2.full === true && d2.dreamKey === 'shadowdragon|pet', 'D2 dream + full + dreamKey');
ok(d2.robloxUsername === 'dream_full_rbx' && d2.verified === true, 'D2 roblox joined');
ok(d2.gives[0].k === 'batdragon|pet' && d2.gives[0].w === true, 'gives: wanted pet first, marked w');
ok(d2.gives.filter((g) => g.w).length === 1 && d2.givesCount === 3, 'gives: others unmarked, count = all');
ok(d2.wants.length === 1 && d2.wants[0].k === 'shadowdragon|pet', 'wants: only my pets');

const d1 = list.find((x) => x.uid === 'D1');
ok(d1.dream === true && d1.full === false, 'D1 dream only');
ok(d1.wants.map((w) => w.k).join() === 'frostdragon|pet', 'D1 wants only my Frost Dragon (not Cow)');

const w2 = list.find((x) => x.uid === 'W2');
ok(w2.dream === false && w2.full === true && w2.isPro === true && w2.dreamKey === null, 'W2 full, Pro, no dreamKey');
const w1 = list.find((x) => x.uid === 'W1');
ok(w1.dream === false && w1.full === false && w1.gives[0].w === false, 'W1 plain wisher');

// Their dream is listed first among the pets they want from me.
await sync('D1', [pet('Turtle')], [pet('Owl'), pet('Frost Dragon')], 'frostdragon|pet');
const d1b = (await rpc('find_pet_wanters', [30], 'ME')).find((x) => x.uid === 'D1');
ok(d1b.wants[0].k === 'frostdragon|pet' && d1b.wants.length === 2, 'dream first in wants');

// gives is capped at 12, wanted first even when listed last.
const many = Array.from({ length: 20 }, (_, i) => pet(`Filler ${String.fromCharCode(65 + i)}`));
await sync('W1', [...many, pet('Bat Dragon')], [pet('Owl')]);
const w1b = (await rpc('find_pet_wanters', [30], 'ME')).find((x) => x.uid === 'W1');
ok(w1b.gives.length === 12 && w1b.givesCount === 21, `gives capped at 12 of 21 (got ${w1b.gives.length}/${w1b.givesCount})`);
ok(w1b.gives[0].k === 'batdragon|pet' && w1b.full === true, 'wanted pet surfaces past the cap');

// Limits
ok((await rpc('find_pet_wanters', [1], 'ME')).length === 1, 'p_limit 1');
ok((await rpc('find_pet_wanters', [null], 'ME')).length === 4, 'null limit = default');

// Nothing For Trade, or no row at all -> empty.
await sync('ME', [], [pet('Bat Dragon')]);
ok(JSON.stringify(await rpc('find_pet_wanters', [30], 'ME')) === '[]', 'nothing for trade -> []');
ok(JSON.stringify(await rpc('find_pet_wanters', [30], 'NEWBIE')) === '[]', 'no inventory row -> []');

// The 032 direction still works.
await sync('ME', [pet('Owl')], [pet('Giraffe')]);
const m = await rpc('find_trade_matches', [30], 'ME');
ok(m.some((x) => x.uid === 'W2'), 'find_trade_matches unchanged');

// Index + grants
const idx = await q(`select indexname from pg_indexes where indexname = 'idx_trade_inventory_want'`);
ok(idx.length === 1, 'want_keys GIN index exists');
const g = await q(`select grantee from information_schema.routine_privileges where routine_schema='public'
                    and routine_name = 'find_pet_wanters' and grantee in ('anon','PUBLIC','authenticated')`);
ok(g.some((r) => r.grantee === 'authenticated'), 'authenticated can call');
ok(!g.some((r) => r.grantee === 'anon' || r.grantee === 'PUBLIC'), 'no anon/public');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
