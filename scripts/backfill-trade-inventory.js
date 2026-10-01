// One-time seed for Trade Match (supabase/032_trade_match.sql).
//
// Copies each recently active player's PUBLIC trade lists from Firestore
// `user_profiles` into Supabase `trade_inventory`, so the first players on
// the new build see matches straight away instead of an empty screen:
//   have = owned pets marked "For Trade"   (availableForTrade === true)
//   want = wishlist pets marked "Trading"  (availableForTrade === true)
// Both are already shown on the player's profile.
//
// Rows are written with client_synced = false: they can be MATCHED, but they
// never receive dream-pet pushes (those players may be on an old build that
// has no Trade Match screen). Existing rows are never overwritten — a row the
// new app already synced is newer and authoritative.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-trade-inventory.js           # dry run
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-trade-inventory.js --apply   # write
//
// Cost: one Firestore read per user_profiles doc updated in the last 45 days.

const path = require('path');

const FUNCTIONS_NM = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(FUNCTIONS_NM, 'firebase-admin'));
const { createClient } = require(path.join(FUNCTIONS_NM, '@supabase', 'supabase-js'));
const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));

const APPLY = process.argv.includes('--apply');
const ACTIVE_DAYS = 45;
const PAGE = 500;
const MAX_ITEMS = 150;

// ── Kept in sync with Code/Helper/tradeMatch.js (that file is RN/ESM) ─────
const normalizeName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const coarseType = (type) => {
  let t = String(type || '').toLowerCase().replace(/[^a-z]/g, '');
  if (t.length > 3 && t.endsWith('s')) t = t.slice(0, -1);
  return (t || 'x').slice(0, 12);
};
const petKey = (pet) => {
  if (!pet) return null;
  const name = normalizeName(pet.name || pet.Name).slice(0, 60);
  return name ? `${name}|${coarseType(pet.category || pet.type)}` : null;
};
const compactList = (pets) => {
  const out = [];
  const seen = new Set();
  for (const pet of Array.isArray(pets) ? pets : []) {
    if (out.length >= MAX_ITEMS) break;
    const k = petKey(pet);
    if (!k) continue;
    const v = pet.valueType === 'n' || pet.valueType === 'm' ? pet.valueType : 'd';
    const e = { k, n: String(pet.name || pet.Name || '').slice(0, 60), v, f: !!pet.isFly, r: !!pet.isRide, i: String(pet.imageUrl || pet.image || '').slice(0, 300) };
    const sig = `${e.k}:${e.v}:${e.f}:${e.r}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(e);
  }
  return out;
};
const SQL_KEY = /^[a-z0-9]{1,60}\|[a-z]{1,12}$/;
// ───────────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (APPLY && (!url || !key)) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to use --apply.');
    process.exit(1);
  }
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const fs = admin.firestore();
  fs.settings({ preferRest: true }); // plain HTTPS; gRPC stalls on flaky networks
  // `ws` satisfies supabase-js's Realtime constructor on Node; no socket is
  // opened (same as functions/_supabaseAdmin.js).
  const sb = APPLY
    ? createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: require(path.join(FUNCTIONS_NM, 'ws')) },
    })
    : null;

  const since = admin.firestore.Timestamp.fromMillis(Date.now() - ACTIVE_DAYS * 86400000);
  let last = null;
  let scanned = 0;
  let rows = [];
  let written = 0;
  let badKeys = 0;

  const flush = async () => {
    if (!rows.length) return;
    if (APPLY) {
      const { error } = await sb.from('trade_inventory').upsert(rows, { onConflict: 'uid', ignoreDuplicates: true });
      if (error) throw error;
    }
    written += rows.length;
    rows = [];
  };

  for (;;) {
    let q = fs.collection('user_profiles').where('updatedAt', '>=', since).orderBy('updatedAt').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      scanned++;
      const data = d.data() || {};
      const owned = Array.isArray(data.ownedPets) ? data.ownedPets : [];
      const wish = Array.isArray(data.wishlistPets) ? data.wishlistPets : [];
      const have = compactList(owned.filter((p) => p && p.availableForTrade === true));
      const want = compactList(wish.filter((p) => p && p.availableForTrade === true));
      if (!have.length && !want.length) continue;
      badKeys += [...have, ...want].filter((e) => !SQL_KEY.test(e.k)).length;
      const updatedMs = data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : Date.now();
      rows.push({
        uid: d.id,
        have_keys: [...new Set(have.map((e) => e.k))],
        want_keys: [...new Set(want.map((e) => e.k))],
        have,
        want,
        dream_key: null,
        lang: 'en',
        alerts_enabled: false,
        client_synced: false,
        updated_at: new Date(updatedMs).toISOString(),
      });
      if (rows.length >= 500) await flush();
    }
    last = snap.docs[snap.docs.length - 1];
    process.stdout.write(`\rscanned ${scanned}, rows ${written + rows.length}`);
  }
  await flush();
  console.log(`\n${APPLY ? 'Wrote' : 'Would write'} ${written} rows from ${scanned} active profiles (${badKeys} invalid keys; should be 0).`);
  if (!APPLY) console.log('Dry run. Re-run with --apply to write.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nFailed:', e.message || e);
  process.exit(1);
});
