/**
 * Cloud Function: Cleanup Expired Group Invitations
 * 
 * This function should be scheduled to run periodically (e.g., every hour)
 * to clean up expired group invitations from Firestore.
 * 
 * Deployment command:
 * firebase deploy --only functions:cleanupGroupInvitations
 * 
 * Or schedule it using Cloud Scheduler:
 * gcloud scheduler jobs create http cleanup-group-invitations \
 *   --schedule="0 * * * *" \
 *   --uri="https://YOUR_REGION-YOUR_PROJECT.cloudfunctions.net/cleanupGroupInvitations" \
 *   --http-method=GET
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Cleanup expired group invitations
 * Removes invitations that have expired (expiresAt < current time) and are still pending
 */
exports.cleanupGroupInvitations = functions.https.onRequest(async (req, res) => {
  try {
    const now = Date.now();
    let deletedCount = 0;

    // Query all pending invitations
    const pendingInvitesQuery = db
      .collection('group_invitations')
      .where('status', '==', 'pending');

    const snapshot = await pendingInvitesQuery.get();

    if (snapshot.empty) {
      return res.status(200).json({
        success: true,
        message: 'No pending invitations found',
        deletedCount: 0,
      });
    }

    const batch = db.batch();
    const deletePromises = [];

    snapshot.forEach((doc) => {
      const data = doc.data();
      const expiresAt = data.expiresAt;

      // Check if invitation has expired
      if (expiresAt && expiresAt < now) {
        deletePromises.push(doc.ref.delete());
        deletedCount++;
      }
    });

    // Execute all deletions
    await Promise.all(deletePromises);

    console.log(`✅ Cleaned up ${deletedCount} expired invitations`);

    return res.status(200).json({
      success: true,
      message: `Cleaned up ${deletedCount} expired invitations`,
      deletedCount,
    });
  } catch (error) {
    console.error('❌ Error cleaning up invitations:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to cleanup invitations',
    });
  }
});

/**
 * Scheduled function version (runs automatically)
 * Uncomment and deploy if you want automatic cleanup
 */
/*
exports.scheduledCleanupGroupInvitations = functions.pubsub
  .schedule('every 1 hours')
  .onRun(async (context) => {
    try {
      const now = Date.now();
      let deletedCount = 0;

      const pendingInvitesQuery = db
        .collection('group_invitations')
        .where('status', '==', 'pending');

      const snapshot = await pendingInvitesQuery.get();

      if (snapshot.empty) {
        console.log('No pending invitations found');
        return null;
      }

      const deletePromises = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        const expiresAt = data.expiresAt;

        if (expiresAt && expiresAt < now) {
          deletePromises.push(doc.ref.delete());
          deletedCount++;
        }
      });

      await Promise.all(deletePromises);

      console.log(`✅ Cleaned up ${deletedCount} expired invitations`);
      return null;
    } catch (error) {
      console.error('❌ Error cleaning up invitations:', error);
      throw error;
    }
  });
*/

