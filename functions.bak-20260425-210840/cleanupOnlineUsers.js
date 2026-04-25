/**
 * Cloud Function: Cleanup Online Users Node
 * 
 * This scheduled function runs every 10 minutes to delete the online_users_node/list document.
 * This helps reset the online users list periodically and clean up stale data.
 * 
 * Deployment:
 * firebase deploy --only functions:cleanupOnlineUsers
 * 
 * The function will automatically run every 10 minutes once deployed.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const firestore = admin.firestore();

/**
 * Scheduled function that runs every 10 minutes
 * Deletes the online_users_node/list document to reset online users
 */
exports.cleanupOnlineUsers = functions.pubsub
  .schedule('every 10 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const onlineUsersDocRef = firestore.collection('online_users_node').doc('list');
      
      // Check if document exists before deleting
      const docSnapshot = await onlineUsersDocRef.get();
      
      if (!docSnapshot.exists) {
        console.log('✅ online_users_node/list document does not exist. Nothing to clean up.');
        return null;
      }

      // Delete the document
      await onlineUsersDocRef.delete();

      console.log('✅ Successfully deleted online_users_node/list document');
      return null;
    } catch (error) {
      console.error('❌ Error cleaning up online_users_node:', error);
      // Don't throw error to prevent retries - will try again in next scheduled run
      return null;
    }
  });

