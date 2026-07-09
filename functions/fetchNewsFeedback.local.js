// LOCAL-ONLY read helper — NOT a Cloud Function, never deployed.
// Reads /news_feedback from RTDB, filters to the last N days, and writes a
// JSON dump + a console summary so we can analyze what users are asking for.
//
// Run from the repo root:  node functions/fetchNewsFeedback.local.js [days]
// Read-only: it never writes to the database.

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const serviceAccount = require('../serviceAccount.json');

const DAYS = parseInt(process.argv[2], 10) || 60;

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://adoptme-7b50c-default-rtdb.firebaseio.com',
  });
}

(async () => {
  const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  const snap = await admin.database().ref('news_feedback').once('value');
  const all = snap.val() || {};

  const rows = Object.entries(all)
    .map(([key, v]) => ({ key, ...v }))
    .filter((r) => typeof r.createdAt === 'number' && r.createdAt >= cutoff)
    .sort((a, b) => a.createdAt - b.createdAt);

  const totalAll = Object.keys(all).length;

  // Counts by type
  const byType = {};
  for (const r of rows) byType[r.type || 'unknown'] = (byType[r.type || 'unknown'] || 0) + 1;

  // Quick suggestion chip tallies
  const quickTally = {};
  for (const r of rows.filter((r) => r.type === 'quick_suggestion')) {
    const t = (r.text || '').trim();
    quickTally[t] = (quickTally[t] || 0) + 1;
  }

  // Poll votes tally
  const pollTally = {};
  for (const r of rows.filter((r) => r.type === 'poll_vote')) {
    const id = r.pollId || 'unknown';
    pollTally[id] = pollTally[id] || {};
    const opt = r.option || 'unknown';
    pollTally[id][opt] = (pollTally[id][opt] || 0) + 1;
  }

  // Custom free-text feedback (the interesting qualitative signal)
  const custom = rows
    .filter((r) => r.type === 'custom_feedback')
    .map((r) => ({
      createdAt: r.createdAt,
      date: new Date(r.createdAt).toISOString().slice(0, 10),
      text: (r.text || '').trim(),
      userId: r.userId || 'anonymous',
      userName: r.userName || null,
    }))
    .filter((r) => r.text);

  const out = {
    fetchedAtIso: new Date().toISOString(),
    windowDays: DAYS,
    cutoffIso: new Date(cutoff).toISOString(),
    totalRecordsInWindow: rows.length,
    totalRecordsAllTime: totalAll,
    uniqueUsersInWindow: new Set(rows.map((r) => r.userId || 'anonymous')).size,
    byType,
    quickTally,
    pollTally,
    custom,
  };

  const outPath = path.join('/tmp', 'news_feedback_dump.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log('================ NEWS FEEDBACK SUMMARY ================');
  console.log('Window:', DAYS, 'days   cutoff:', out.cutoffIso);
  console.log('Records in window:', rows.length, ' | all-time:', totalAll);
  console.log('Unique users in window:', out.uniqueUsersInWindow);
  console.log('By type:', JSON.stringify(byType));
  console.log('\n--- Quick suggestion chips (count) ---');
  Object.entries(quickTally).sort((a, b) => b[1] - a[1]).forEach(([t, c]) => console.log(`  ${c}\t${t}`));
  console.log('\n--- Poll votes ---');
  console.log(JSON.stringify(pollTally, null, 2));
  console.log('\n--- Custom free-text feedback (count =', custom.length, ') ---');
  custom.forEach((c, i) => console.log(`${String(i + 1).padStart(3)}. [${c.date}] (${c.userName || c.userId}) ${c.text}`));
  console.log('\nFull JSON dump ->', outPath);

  process.exit(0);
})().catch((e) => {
  console.error('❌ Fetch failed:', e.message);
  process.exit(1);
});
