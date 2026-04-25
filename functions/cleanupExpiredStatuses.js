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
      let batch = firestore.batch();
      let batchCount = 0;

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

      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
        batchCount++;
        deletedCount++;

        // Firestore batch limits to 500 writes
        if (batchCount === 500) {
          await batch.commit();
          console.log(`🔥 Deleted 500 statuses...`);
          batch = firestore.batch(); // Start a new batch
          batchCount = 0;
        }
      }

      // Commit any remaining docs
      if (batchCount > 0) {
        await batch.commit();
      }

      console.log(`✅ Successfully cleaned up ${deletedCount} expired statuses.`);
      return null;
    } catch (error) {
      console.error('❌ Error cleaning up statuses:', error);
      return null;
    }
  });
