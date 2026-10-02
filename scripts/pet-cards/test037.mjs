// PGlite test of supabase/037_pet_cards.sql
import { PGlite } from '/Volumes/Sohail/cloud functions/ROBLOX/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'fs';

const SQL = fs.readFileSync('/Volumes/Sohail/AI_Projects/RunningApps/adoptme-jan7/supabase/037_pet_cards.sql', 'utf8');
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

await db.exec(`
  create role anon; create role authenticated;
  create function public.firebase_uid() returns text language sql stable as $$ select nullif(current_setting('test.uid', true), '') $$;
  create table public.user_cosmetics (uid text primary key, top_badge text, is_pro boolean not null default false,
    squad_count int not null default 0, updated_at timestamptz not null default now());
  create schema cron; create table cron.job (jobname text);
  create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job values (n); select 1 $$;
`);
await db.exec(SQL);
await db.exec(SQL); // idempotent
ok((await one(`select count(*)::int n from cron.job`)).n === 1, 'cron scheduled once');

// Catalogue: haunted26 has 3C/10U/14R/17UR/26L (real proportions); a 2-card page set; some 'all' only.
const R = ['common', 'uncommon', 'rare', 'ultra', 'legendary'];
const counts = { common: 3, uncommon: 10, rare: 14, ultra: 17, legendary: 26 };
let no = 1;
for (const r of R) for (let i = 0; i < counts[r]; i++) {
  await q(`insert into card_catalog(key,name,rarity,no,sets,hd_ready) values ($1,$2,$3,$4,$5,true)`,
    [`h${r}${i}`, `H ${r} ${i}`, r, no++, ['haunted26']]);
}
for (const r of R) for (let i = 0; i < 20; i++) {
  await q(`insert into card_catalog(key,name,rarity,no,sets,hd_ready,egg) values ($1,$2,$3,$4,$5,true,$6)`,
    [`a${r}${i}`, `A ${r} ${i}`, r, no++, i < 1 && r === 'rare' ? ['egg_fossil'] : [], i < 1 && r === 'rare' ? 'fossil' : null]);
}
await q(`update card_catalog set sets = sets || '{egg_fossil}', egg='fossil' where key = 'auncommon0'`);
await q(`insert into card_catalog(key,name,rarity,no,sets,hd_ready) values ('nohd','No HD','legendary',999,'{haunted26}',false)`);
await q(`update card_sets set active = true where id in ('egg_fossil')`);

// anon
ok((await rpcErr('cards_state', [], '')) === 'sign in required', 'anon refused');

// state
let st = await rpc('cards_state');
ok(st.wallet.freeReady === true, 'free ready');
ok(st.wallet.starPacksLeft === 2, 'star packs left 2');
const h = st.sets.find((s) => s.id === 'haunted26');
ok(h && h.open && h.total === 70, `haunted open total 70 (got ${h && h.total})`);
ok(st.sets.find((s) => s.id === 'egg_fossil').total === 2, 'fossil page 2 cards');
ok(st.sets.find((s) => s.id === 'all').total === 170, 'all 170 HD cards');

// free pack
let p = await rpc('open_card_pack', ['haunted26', 'free']);
ok(p.cards.length === 3, '3 cards');
ok(p.cards.every((c) => c.key.startsWith('h')), 'cards from the set');
ok(p.wallet.freeReady === false && p.wallet.streak === 1, 'free used, streak 1');
ok((await rpcErr('open_card_pack', ['haunted26', 'free'])) === 'free pack already opened today', 'second free refused');
await rpc('open_card_pack', ['haunted26', 'stars']);
p = await rpc('open_card_pack', ['all', 'stars']);
ok(p.wallet.starPacksLeft === 0, 'stars used');
ok((await rpcErr('open_card_pack', ['all', 'stars'])) === 'star pack limit reached', 'third star refused');
ok((await rpcErr('open_card_pack', ['all', 'bonus'])) === 'no bonus packs', 'bonus refused');
ok((await rpcErr('open_card_pack', ['egg_fossil', 'free'], 'B')) === 'pack not available', 'page set has no pack');
ok((await rpcErr('open_card_pack', ['all', 'cash'])) === 'bad source', 'bad source');

// streak bonus on day 7
await q(`update card_wallet set free_day = _cards_today() - 1, streak = 6 where uid = 'A'`);
p = await rpc('open_card_pack', ['all', 'free']);
ok(p.streakBonus === true && p.wallet.bonusPacks === 1 && p.wallet.streak === 7, 'day-7 streak bonus');
p = await rpc('open_card_pack', ['all', 'bonus']);
ok(p.wallet.bonusPacks === 0, 'bonus consumed');
// streak breaks after a gap
await q(`update card_wallet set free_day = _cards_today() - 3, streak = 5 where uid = 'A'`);
p = await rpc('open_card_pack', ['all', 'free']);
ok(p.wallet.streak === 1, 'streak reset after gap');

// pity
await q(`update card_wallet set free_day = -1, pity_legend = 7 where uid = 'A'`);
p = await rpc('open_card_pack', ['haunted26', 'free']);
ok(p.cards[2].rarity === 'legendary', 'legendary pity on hit slot');
ok(p.wallet.pityLegend === 0, 'legend pity reset');
await q(`update card_wallet set free_day = -1, pity_holo = 11 where uid = 'A'`);
p = await rpc('open_card_pack', ['haunted26', 'free']);
ok(['holo', 'gilded', 'mega', 'fullart'].includes(p.cards[2].finish) || p.cards.some((c) => ['holo', 'gilded', 'mega', 'fullart'].includes(c.finish)), 'holo pity');
ok(p.wallet.pityHolo === 0, 'holo pity reset');

// serials + dupes + score (direct helper calls)
await q(`select _cards_ensure_wallet('C')`);
const s1 = (await one(`select _cards_add('C','hlegendary0','holo','haunted26','test') r`)).r;
const s2 = (await one(`select _cards_add('C','hlegendary0','holo','haunted26','test') r`)).r;
await q(`select _cards_ensure_wallet('D')`);
const s3 = (await one(`select _cards_add('D','hlegendary0','holo','haunted26','test') r`)).r;
ok(s1.serial + 1 === s2.serial && s2.serial + 1 === s3.serial, 'global serials increase');
ok(s1.new === true && s2.dupe === true && s2.shards === 100 * 5, 'dupe gives rarity x finish shards');
const s4 = (await one(`select _cards_add('C','hlegendary0','classic','haunted26','test') r`)).r;
ok(s4.newFinish === true && s4.new === false && s4.shards === 0, 'new finish is not a dupe');
let wc = await one(`select * from card_wallet where uid='C'`);
ok(wc.score === 16 * 5 + 16 * 1 && wc.unique_cards === 1 && wc.shards === 500, `score/unique/shards (${wc.score},${wc.unique_cards},${wc.shards})`);
ok((await one(`select best_serial from card_collection where uid='C' and card_key='hlegendary0' and finish='holo'`)).best_serial === s1.serial, 'best serial kept');

// completion: fossil page = auncommon0 + arare0
await q(`select _cards_add('C','arare0','classic','all','test')`);
let set1 = (await one(`select _cards_settle('C', array['arare0']) r`)).r;
ok(set1.completed.length === 0, 'not complete with 1/2');
await q(`select _cards_add('C','auncommon0','foil','all','test')`);
set1 = (await one(`select _cards_settle('C', array['auncommon0']) r`)).r;
ok(set1.completed.includes('egg_fossil') && set1.rewardShards === 50, 'fossil complete + 50 shards');
set1 = (await one(`select _cards_settle('C', array['auncommon0']) r`)).r;
ok(set1.completed.length === 0, 'completion paid once');
const cos = await one(`select card_score, card_count from user_cosmetics where uid='C'`);
wc = await one(`select * from card_wallet where uid='C'`);
ok(cos.card_score === wc.score && cos.card_count === 3, 'cosmetics mirror');

// craft
await as('C');
ok((await rpcErr('craft_card', ['hlegendary1'], 'C')) === 'not enough shards', 'craft needs shards'); // has 550 < 1000
await q(`update card_wallet set shards = 1000 where uid='C'`);
let cr = await rpc('craft_card', ['hlegendary1'], 'C');
ok(cr.card.finish === 'classic' && cr.wallet.shards === 0, 'craft legendary');
ok((await rpcErr('craft_card', ['hlegendary1'], 'C')) === 'already owned', 'craft owned refused');
ok((await rpcErr('craft_card', ['nohd'], 'C')) === 'unknown card', 'craft no-HD refused');

// collection + showcase
let col = await rpc('get_card_collection', [null], 'C');
ok(col.cards.hlegendary0 && col.cards.hlegendary0.length === 2, 'collection groups finishes');
let colOther = await rpc('get_card_collection', ['C'], 'A');
ok(colOther.uniqueCards === col.uniqueCards, 'other player readable');
ok((await rpcErr('set_card_showcase', [JSON.stringify([1, 2, 3, 4])], 'C')) === 'up to 3 cards', 'max 3');
let sc = await rpc('set_card_showcase', [JSON.stringify([{ k: 'hlegendary0', f: 'holo' }, { k: 'hrare0', f: 'mega' }])], 'C');
ok(sc.length === 1 && sc[0].s === s1.serial, 'showcase keeps only owned');
ok(sc[0].n === 'H legendary 0' && sc[0].r === 'legendary' && sc[0].no === 45 && Array.isArray(sc[0].sets), 'showcase entry carries catalog fields');
ok((await one(`select card_showcase from user_cosmetics where uid='C'`)).card_showcase.length === 1, 'showcase mirrored');
// order kept, one entry per card, scalars ignored, collection returns it
sc = await rpc('set_card_showcase', [JSON.stringify([{ k: 'arare0', f: 'classic' }, { k: 'hlegendary0', f: 'classic' }, { k: 'hlegendary0', f: 'holo' }])], 'C');
ok(sc.length === 2 && sc[0].k === 'arare0' && sc[1].k === 'hlegendary0' && sc[1].f === 'classic', `showcase ordered, one per card (${JSON.stringify(sc.map((x) => [x.k, x.f]))})`);
ok((await rpc('set_card_showcase', [JSON.stringify([1, { k: 'arare0', f: 'classic' }])], 'C')).length === 1, 'scalar entries skipped');
col = await rpc('get_card_collection', [null], 'C');
ok(Array.isArray(col.showcase) && col.showcase.length === 1 && col.showcase[0].k === 'arare0', 'collection returns the showcase');
ok(Array.isArray((await rpc('get_card_collection', [null], 'A')).showcase), 'collection showcase defaults to []');
ok((await rpc('set_card_showcase', ['[]'], 'C')).length === 0, 'showcase can be cleared');

// volume: never pulls the no-HD card; rough odds
await q(`insert into card_wallet(uid, bonus_packs) values ('E', 3000) on conflict (uid) do update set bonus_packs = 3000`);
const rar = {}; const fin = {}; let nohd = 0; let newCount = 0; let total = 0;
for (let i = 0; i < 1500; i++) {
  const r = await rpc('open_card_pack', ['all', 'bonus'], 'E');
  r.cards.forEach((c, slot) => {
    total++;
    if (c.key === 'nohd') nohd++;
    if (slot < 2) rar[c.rarity] = (rar[c.rarity] || 0) + 1;
    fin[c.finish] = (fin[c.finish] || 0) + 1;
    if (c.new) newCount++;
  });
}
ok(nohd === 0, 'no-HD card never pulled');
const pct = (o, k, n) => +(100 * (o[k] || 0) / n).toFixed(1);
console.log('slot1-2 rarity %', Object.fromEntries(R.map((k) => [k, pct(rar, k, 3000)])));
console.log('finish %', Object.fromEntries(Object.keys(fin).map((k) => [k, pct(fin, k, total)])));
ok(Math.abs(pct(rar, 'common', 3000) - 40) < 4, 'common ~40%');
ok(Math.abs(pct(fin, 'classic', total) - 72) < 4, 'classic ~72%');
const we = await one(`select * from card_wallet where uid='E'`);
ok(we.unique_cards === 170, `E collected all 170 (${we.unique_cards})`);
ok(we.completed.includes('all'), 'all-set completion recorded');
const serialPulls = (await one(`select count(*)::int n from card_pulls where uid='E' and serial is not null`)).n;
ok(serialPulls === (fin.holo || 0) + (fin.gilded || 0) + (fin.mega || 0) + (fin.fullart || 0), 'every holo+ has a serial');

// concurrency guard: wallet row lock exists (for update) — and ended set refused
await q(`update card_sets set ends_at = now() - interval '1 second' where id = 'haunted26'`);
ok((await rpcErr('open_card_pack', ['haunted26', 'bonus'], 'E')) === 'pack not available', 'ended pack refused');
st = await rpc('cards_state', [], 'E');
ok(st.sets.find((s) => s.id === 'haunted26').open === false, 'ended pack shows closed');
const cat = await rpc('card_catalog_list', [], 'E');
ok(cat.length === 170 && cat[0].length === 7, 'catalog list compact, HD only');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
