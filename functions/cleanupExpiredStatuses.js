const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Cloud Function: Cleanup Expired Statuses
 * Runs every hour to delete statuses where 'expiresAt' is in the past.
 *
 * Statuses carry a `comments` subcollection, and deleting a Firestore document
 * does NOT delete its subcollections — a plain batch delete would leave every
 * status comment orphaned and billed forever, unreachable from the app. So the
 * expired docs go through recursiveDelete instead of batch.delete().
 *
 * Deployment:
 * firebase deploy --only functions:cleanupExpiredStatuses
 */
exports.cleanupExpiredStatuses = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .pubsub.schedule('every 30 minutes')
  .onRun(async (context) => {
    try {
      const now = admin.firestore.Timestamp.now();
      const firestore = admin.firestore();
      let deletedCount = 0;

      // Fetch statuses where expiresAt < now
      const snapshot = await firestore.collection('statuses')
        .where('expiresAt', '<', now)
        .limit(500) // Process in chunks to avoid memory/timeout issues
        .get();

      if (snapshot.empty) {
        console.log('✅ No expired statuses found.');
        return null;
      }

      console.log(`🗑️ Found ${snapshot.size} expired statuses to delete...`);

      // Bounded concurrency: recursiveDelete streams its own writes, so firing
      // all 500 at once would swamp the function's memory and the write budget.
      const CONCURRENCY = 10;
      for (let i = 0; i < snapshot.docs.length; i += CONCURRENCY) {
        const slice = snapshot.docs.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          slice.map((doc) => firestore.recursiveDelete(doc.ref))
        );
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            deletedCount++;
          } else {
            // Leave it for the next run rather than failing the whole sweep.
            console.error(`⚠️ Failed to delete status ${slice[idx].id}:`, r.reason?.message);
          }
        });
        console.log(`🔥 Deleted ${deletedCount}/${snapshot.size} statuses...`);
      }

      console.log(`✅ Successfully cleaned up ${deletedCount} expired statuses.`);
      return null;
    } catch (error) {
      console.error('❌ Error cleaning up statuses:', error);
      return null;
    }
  });
