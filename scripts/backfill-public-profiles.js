// One-time seed for user_profiles_public/{uid} (see functions/mirrorPublicProfile.js).
//
// After mirrorPublicProfile is deployed, every CHANGE to a user_profiles doc
// refreshes its public copy. Profiles nobody has touched since then have no
// public copy yet, so the app falls back to reading the full doc (with the
// Private pets) for them. This script writes the public copy for every
// existing profile, so that fallback stops happening.
//
//   node scripts/backfill-public-profiles.js           # dry run (reads only)
//   node scripts/backfill-public-profiles.js --apply   # write
//
// Cost: one read per user_profiles doc, one write per doc (BulkWriter).
// Safe to re-run: it overwrites with the same projection.

const path = require('path');

const FUNCTIONS_NM = path.join(__dirname, '..', 'functions', 'node_modules');
const admin = require(path.join(FUNCTIONS_NM, 'firebase-admin'));
const serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
const { projectPublic } = require(path.join(__dirname, '..', 'functions', 'mirrorPublicProfile.js'));

const APPLY = process.argv.includes('--apply');
const PAGE = 500;

async function main() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const fs = admin.firestore();
  fs.settings({ preferRest: true });
  const writer = APPLY ? fs.bulkWriter() : null;

  let last = null;
  let scanned = 0;
  let withPublic = 0;
  const FieldPath = admin.firestore.FieldPath;
  for (;;) {
    let q = fs.collection('user_profiles').orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      scanned++;
      const pub = projectPublic(d.data());
      if (pub.forTrade.length || pub.lookingFor.length || pub.bio) withPublic++;
      if (writer) {
        writer.set(fs.doc(`user_profiles_public/${d.id}`), {
          ...pub,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }
    last = snap.docs[snap.docs.length - 1];
    process.stdout.write(`\rscanned ${scanned}`);
  }
  if (writer) await writer.close();
  console.log(`\n${APPLY ? 'Wrote' : 'Would write'} ${scanned} public copies (${withPublic} have something public).`);
  if (!APPLY) console.log('Dry run. Re-run with --apply to write.');
  process.exit(0);
}

main().catch((e) => {
  console.error('\nFailed:', e.message || e);
  process.exit(1);
});
