/**
 * Cloud Function: Cleanup old trades (older than 7 days)
 *
 * Runs daily at 5:00 AM UTC. Deletes trade documents older than 7 days
 * from Firestore `trades_new` collection, and cleans up related RTDB
 * entries in `tradeAcceptors/{tradeId}`.
 *
 * The client already hides trades older than 7 days, so this just
 * removes the dead data to save Firestore storage costs.
 *
 * Cost optimization:
 * - Queries only old docs using timestamp filter (indexed)
 * - Deletes in Firestore batches of 500 (max batch size)
 * - Cleans RTDB acceptors in parallel with multi-path updates
 * - Runs once daily during low-traffic hours
 *
 * Deployment:
 * firebase deploy --only functions:cleanupOldTrades
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

exports.cleanupOldTrades = functions
  .runWith({ memory: '512MB', timeoutSeconds: 300 })
  .pubsub.schedule('every day 05:00')
  .timeZone('UTC')
  .onRun(async () => {
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - SEVEN_DAYS_MS);
    const firestore = admin.firestore();
    const db = admin.database();
    let totalDeleted = 0;

    console.log(`🧹 Starting trade cleanup. Cutoff: ${cutoff.toDate().toISOString()}`);

    try {
      let hasMore = true;

      while (hasMore) {
        // Query old trades — uses existing isFeatured + timestamp composite index
        const snapshot = await firestore.collection('trades_new')
          .where('timestamp', '<', cutoff)
          .limit(BATCH_SIZE)
          .get();

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        // Collect trade IDs for RTDB cleanup
        const tradeIds = [];
        let batch = firestore.batch();
        let batchCount = 0;

        for (const doc of snapshot.docs) {
          tradeIds.push(doc.id);
          batch.delete(doc.ref);
          batchCount++;

          // Firestore batch max is 500
          if (batchCount === BATCH_SIZE) {
            await batch.commit();
            batch = firestore.batch();
            batchCount = 0;
          }
        }

        // Commit remaining
        if (batchCount > 0) {
          await batch.commit();
        }

        totalDeleted += snapshot.size;
        console.log(`🗑️ Deleted ${snapshot.size} old trades from Firestore`);

        // Clean up RTDB tradeAcceptors for deleted trades
        if (tradeIds.length > 0) {
          const rtdbUpdates = {};
          for (const tradeId of tradeIds) {
            rtdbUpdates[`tradeAcceptors/${tradeId}`] = null;
          }
          await db.ref().update(rtdbUpdates);
          console.log(`🗑️ Cleaned ${tradeIds.length} tradeAcceptors entries from RTDB`);
        }

        if (snapshot.size < BATCH_SIZE) {
          hasMore = false;
        }
      }

    } catch (error) {
      console.error('❌ Error in cleanupOldTrades:', error);
    }

    console.log(`🧹 Trade cleanup complete. Total deleted: ${totalDeleted} trades.`);
    return null;
  });
