// One-time seed for groups/{groupId}.groupNameLower (see
// functions/syncGroupNameLower.js).
//
// The All Groups search now matches on groupNameLower, so groups created
// before the field existed are not found until it is written. After
// syncGroupNameLower is deployed every CHANGE to a group fills it; this script
// fills it for every existing group.
//
//   node scripts/backfill-group-name-lower.js           # dry run (reads only)
//   node scripts/backfill-group-name-lower.js --apply   # write
//
// Cost: one read per groups doc, one write per doc that is missing or wrong.
// Safe to re-run: docs that already match are skipped.

const path = require('path');

const FUNCTIONS_NM = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(FUNCTIONS_NM, 'firebase-admin'));
const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
const { _internals: { toGroupNameLower } } = require(path.join(__dirname, '..', 'functions', 'syncGroupNameLower.js'));

const APPLY = process.argv.includes('--apply');
const PAGE = 500;

async function main() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const fs = admin.firestore();
  fs.settings({ preferRest: true });
  const writer = APPLY ? fs.bulkWriter() : null;

  let last = null;
  let scanned = 0;
  let needs = 0;
  let active = 0;
  const samples = [];
  const FieldPath = admin.firestore.FieldPath;
  for (;;) {
    let q = fs.collection('groups').orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      scanned++;
      const data = d.data();
      if (data.isActive === true) active++;
      const lower = toGroupNameLower(data);
      if (data.groupNameLower === lower) continue;
      needs++;
      if (samples.length < 5) samples.push(`${d.id}: ${JSON.stringify(data.groupName || data.name || '')} -> ${JSON.stringify(lower)}`);
      if (writer) writer.update(d.ref, { groupNameLower: lower });
    }
    last = snap.docs[snap.docs.length - 1];
  }
  if (writer) await writer.close();

  console.log(`scanned ${scanned} groups (${active} active); ${needs} ${APPLY ? 'updated' : 'need groupNameLower'}`);
  for (const s of samples) console.log(`  e.g. ${s}`);
  if (!APPLY && needs) console.log('dry run — re-run with --apply to write');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
