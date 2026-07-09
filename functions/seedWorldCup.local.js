// LOCAL-ONLY seeding helper — NOT a Cloud Function, never deployed.
// Runs the same logic as fetchWorldCupData on your machine, using the repo's
// serviceAccount.json, so the World Cup screen has data before the CF is live.
//
// Run from the repo root:  node functions/seedWorldCup.local.js
// Undo:  delete the wc2026_meta/feed doc in the Firebase console.

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccount.json');

// Initialize WITH credentials before requiring the CF module, so its
// module-level admin.firestore() binds to this credentialed app.
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const { runSync } = require('./fetchWorldCupData');

runSync()
  .then((r) => { console.log('✅ Seeded wc2026_meta/feed:', JSON.stringify(r)); process.exit(0); })
  .catch((e) => { console.error('❌ Seed failed:', e.message); process.exit(1); });
