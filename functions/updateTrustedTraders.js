const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');

initializeApp();

const db = getFirestore();
const MIN_VOTES = 1;  // Lowered from 3 — show traders with any votes
const TOP_N = 50;

exports.updateTrustedTraders = onSchedule('every 6 hours', async () => {
    const sevenDaysAgo = Timestamp.fromDate(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );

    const map = new Map();
    let lastDoc = null;

    while (true) {
        let q = db.collection('trades_new')
            .where('timestamp', '>=', sevenDaysAgo)
            .orderBy('timestamp', 'desc')
            .limit(500);

        if (lastDoc) q = q.startAfter(lastDoc);

        const snap = await q.get();
        if (snap.empty) break;

        for (const doc of snap.docs) {
            const t = doc.data();
            const key = t.userId || t.traderName;
            const vc = t.voteCount ?? { w: 0, f: 0, l: 0 };
            const w = vc.w ?? 0;
            const f = vc.f ?? 0;
            const l = vc.l ?? 0;

            if (!map.has(key)) {
                map.set(key, {
                    userId: t.userId || '',
                    name: t.traderName || 'Unknown',
                    avatar: t.avatar || null,
                    wins: 0, fairs: 0, losses: 0,
                    total: 0, trustScore: 0,
                });
            }

            const e = map.get(key);
            e.wins   += w;
            e.fairs  += f;
            e.losses += l;
            e.total  += w + f + l;

            // Weighted trust: Fair=3pts, Lose=1pt, Win=0pts
            const maxPoints = e.total * 3;
            const earnedPoints = (e.fairs * 3) + (e.losses * 1);
            const rawTrust = maxPoints > 0 ? (earnedPoints / maxPoints) * 100 : 0;

            // Volume bonus: scale up until 10 votes
            const volumeMultiplier = Math.min(e.total / 10, 1);
            e.trustScore = Math.round(rawTrust * volumeMultiplier);
        }

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < 500) break;
    }

    const entries = [...map.values()]
        .filter(e => e.total >= MIN_VOTES)
        .sort((a, b) => b.trustScore - a.trustScore || b.total - a.total)
        .slice(0, TOP_N)
        .map((e, i) => ({ rank: i + 1, ...e }));

    await db.doc('leaderboard/trustedTraders').set({
        entries,
        updatedAt: FieldValue.serverTimestamp(),
        windowDays: 7,
    });

    console.log(`✅ ${entries.length} trusted traders saved`);
});
