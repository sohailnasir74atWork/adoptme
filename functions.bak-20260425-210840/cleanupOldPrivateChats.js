/**
 * Cloud Function: Cleanup old private chat messages (older than 20 days)
 *
 * Runs daily at 4:00 AM UTC. Deletes messages older than 20 days from
 * all private chat conversations in Realtime Database.
 *
 * Only deletes messages — metadata (chat_meta_data), lastRead, trade,
 * and post nodes are preserved so the inbox stays intact.
 *
 * Path: private_messages/{chatKey}/messages/{messageId}
 * messageId = Date.now() (timestamp in ms), so keys are numeric strings.
 *
 * Cost optimization:
 * - Uses REST API shallow query to fetch only chat keys (not message data)
 * - Uses orderByKey() + endAt() to query only old message keys per chat
 * - Deletes via multi-path updates (single RTDB write per batch)
 * - Runs once daily during low-traffic hours
 *
 * Deployment:
 * firebase deploy --only functions:cleanupOldPrivateChats
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const https = require('https');

if (!admin.apps.length) {
  admin.initializeApp();
}

const TWENTY_DAYS_MS = 20 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

/**
 * Shallow read via REST API — fetches only top-level keys under a path,
 * without downloading any child data. Admin SDK doesn't support shallow reads.
 */
function shallowRead(dbUrl, path) {
  return new Promise((resolve, reject) => {
    const url = `${dbUrl}/${path}.json?shallow=true`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed && typeof parsed === 'object' ? Object.keys(parsed) : []);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', reject);
  });
}

exports.cleanupOldPrivateChats = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every day 04:00')
  .timeZone('UTC')
  .onRun(async () => {
    const cutoffTimestamp = Date.now() - TWENTY_DAYS_MS;
    const cutoffKey = String(cutoffTimestamp);
    const db = admin.database();
    const dbUrl = admin.app().options.databaseURL;
    let totalDeleted = 0;

    console.log(`🧹 Starting private chat cleanup. Cutoff: ${new Date(cutoffTimestamp).toISOString()}`);

    try {
      // Shallow read — only fetches chat keys, NOT message data
      const chatKeys = await shallowRead(dbUrl, 'private_messages');

      if (chatKeys.length === 0) {
        console.log('ℹ️ No private messages found.');
        return null;
      }

      console.log(`📋 Found ${chatKeys.length} private chat conversations to check.`);

      for (const chatKey of chatKeys) {
        try {
          const messagesRef = db.ref(`private_messages/${chatKey}/messages`);
          let deletedInChat = 0;
          let hasMore = true;

          while (hasMore) {
            // Message keys are timestamps (e.g. "1711612800000")
            // orderByKey + endAt(cutoffKey) gets all keys <= cutoff
            const snapshot = await messagesRef
              .orderByKey()
              .endAt(cutoffKey)
              .limitToFirst(BATCH_SIZE)
              .once('value');

            if (!snapshot.exists() || snapshot.numChildren() === 0) {
              hasMore = false;
              break;
            }

            // Multi-path delete in one write
            const updates = {};
            snapshot.forEach((child) => {
              updates[`private_messages/${chatKey}/messages/${child.key}`] = null;
            });

            const count = Object.keys(updates).length;
            await db.ref().update(updates);
            deletedInChat += count;

            if (count < BATCH_SIZE) {
              hasMore = false;
            }
          }

          if (deletedInChat > 0) {
            console.log(`✅ ${chatKey}: deleted ${deletedInChat} old messages`);
          }
          totalDeleted += deletedInChat;

        } catch (error) {
          console.error(`❌ Error cleaning chat ${chatKey}:`, error);
        }
      }

    } catch (error) {
      console.error('❌ Error in cleanupOldPrivateChats:', error);
    }

    console.log(`🧹 Private chat cleanup complete. Total deleted: ${totalDeleted} messages.`);
    return null;
  });
