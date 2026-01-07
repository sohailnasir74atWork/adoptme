/**
 * Cloud Function: Clear Presence Node
 * 
 * This scheduled function runs every 20 minutes to clear the entire presence node
 * in Firebase Realtime Database. This helps clean up stale presence data and
 * ensures that only truly active users remain in the presence node.
 * 
 * The presence node structure: presence/{uid} = true/false
 * 
 * Deployment:
 * firebase deploy --only functions:clearPresenceNode
 * 
 * The function will automatically run every 20 minutes once deployed.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

// Initialize admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const database = admin.database();

/**
 * Scheduled function that runs every 20 minutes
 * Clears the entire presence node in Realtime Database
 */
exports.clearPresenceNode = functions.pubsub
  .schedule('every 20 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const presenceRef = database.ref('presence');
      
      // Clear the entire presence node
      await presenceRef.remove();

      console.log('✅ Successfully cleared presence node.');
      return null;
    } catch (error) {
      console.error('❌ Error clearing presence node:', error);
      // Don't throw error to prevent retries - will try again in next scheduled run
      return null;
    }
  });

