// Backfills `variantTags` onto existing trades_new docs so the Neon/Mega/Fly/Ride
// filters can match trades created before the field existed.
//
//   node scripts/backfill-variant-tags.js --dry-run   # report only, writes nothing
//   node scripts/backfill-variant-tags.js             # apply
//
// Only touches docs that are missing the field, so it is safe to re-run.
// Trades expire from the feed after 7 days, so this is a one-off catch-up —
// after a week every visible trade carries the field from the write path.

const path = require('path');

// No node_modules at repo root — point require at functions/node_modules.
const FUNCTIONS_NM = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(FUNCTIONS_NM, 'firebase-admin'));
const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 400; // Firestore caps a write batch at 500

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

// Kept in sync with buildVariantTags in Code/Trades/tradeHelpers.js.
// Duplicated rather than imported because that file is ESM/React Native.
const VARIANT_TOKEN_ORDER = ['n', 'm', 'f', 'r'];

const toToken = (letters) =>
  VARIANT_TOKEN_ORDER.filter((l) => letters.includes(l)).join('');

const itemVariantLetters = (item) => {
  if (!item) return [];
  const letters = [];
  const valueType = String(item.valueType || '').toLowerCase();
  if (valueType === 'n' || valueType === 'm') letters.push(valueType);
  if (item.isFly) letters.push('f');
  if (item.isRide) letters.push('r');
  return letters;
};

const combinationsOf = (letters) => {
  const out = [];
  for (let mask = 1; mask < (1 << letters.length); mask++) {
    out.push(toToken(letters.filter((_, i) => mask & (1 << i))));
  }
  return out;
};

const buildVariantTags = (...itemLists) => {
  const tags = new Set();
  itemLists.flat().filter(Boolean).forEach((item) => {
    combinationsOf(itemVariantLetters(item)).forEach((token) => tags.add(token));
  });
  return [...tags];
};

(async () => {
  const db = admin.firestore();
  console.log(DRY_RUN ? '🔍 DRY RUN — no writes will be made\n' : '✍️  APPLYING writes\n');

  let cursor = null;
  let scanned = 0, updated = 0, skipped = 0, empty = 0;
  const tagHistogram = {};

  for (;;) {
    let q = db.collection('trades_new').orderBy('__name__').limit(BATCH_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    const batch = db.batch();
    let batchWrites = 0;

    snap.docs.forEach((docSnap) => {
      scanned++;
      const data = docSnap.data();

      if (Array.isArray(data.variantTags)) { skipped++; return; }

      const tags = buildVariantTags(data.hasItems || [], data.wantsItems || []);
      tags.forEach((t) => { tagHistogram[t] = (tagHistogram[t] || 0) + 1; });
      if (tags.length === 0) empty++;

      // Written even when empty, so the doc is marked as processed and a re-run
      // doesn't keep reconsidering it.
      if (!DRY_RUN) {
        batch.update(docSnap.ref, { variantTags: tags });
        batchWrites++;
      }
      updated++;
    });

    if (!DRY_RUN && batchWrites > 0) await batch.commit();
    cursor = snap.docs[snap.docs.length - 1];
    process.stdout.write(`\r  scanned ${scanned}  |  tagged ${updated}  |  already had it ${skipped}`);
    if (snap.size < BATCH_SIZE) break;
  }

  console.log('\n\n──────── summary ────────');
  console.log('scanned:          ', scanned);
  console.log(DRY_RUN ? 'would tag:        ' : 'tagged:           ', updated);
  console.log('already had field:', skipped);
  console.log('no variant pets:  ', empty, '(stored as an empty array)');
  console.log('\ntoken distribution:');
  Object.entries(tagHistogram).sort((a, b) => b[1] - a[1])
    .forEach(([t, c]) => console.log(`  ${String(t).padEnd(5)} ${c}`));
  if (DRY_RUN) console.log('\nRe-run without --dry-run to apply.');
  process.exit(0);
})().catch((e) => {
  console.error('\n❌ Backfill failed:', e.message);
  process.exit(1);
});
