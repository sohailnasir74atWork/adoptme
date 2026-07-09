// LOCAL-ONLY: writes a few TEMP demo score rows + builds the leaderboard cache,
// purely to visually verify the leaderboard UI. Clean up with the --clean flag:
//   node functions/seedWorldCupDemoLeaderboard.local.js          (seed + build)
//   node functions/seedWorldCupDemoLeaderboard.local.js --clean  (delete demo rows + rebuild)

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccount.json');
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
const { buildWorldCupLeaderboard } = require('./fetchWorldCupData');

const DEMO = [
  { uid: 'demo_aiden', displayName: 'AidenPro', points: 70, correct: 7, total: 8 },
  { uid: 'demo_zoe', displayName: 'ZoeKicks', points: 60, correct: 6, total: 8 },
  { uid: 'demo_max', displayName: 'MaxGoals', points: 50, correct: 5, total: 7 },
  { uid: 'demo_lily', displayName: 'LilyFooty', points: 40, correct: 4, total: 6 },
  { uid: 'demo_sam', displayName: 'SamStriker', points: 30, correct: 3, total: 5 },
];

(async () => {
  const clean = process.argv.includes('--clean');
  if (clean) {
    await Promise.all(DEMO.map((d) => db.collection('wc2026_scores').doc(d.uid).delete()));
    console.log('🧹 Deleted demo score rows.');
  } else {
    await Promise.all(
      DEMO.map((d) =>
        db.collection('wc2026_scores').doc(d.uid).set({ ...d, updatedAt: admin.firestore.FieldValue.serverTimestamp() }),
      ),
    );
    console.log('✅ Wrote demo score rows.');
  }
  const n = await buildWorldCupLeaderboard();
  console.log(`✅ Leaderboard rebuilt (${n} players).`);
  process.exit(0);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
