/**
 * Cloud Function: Cleanup old public chat messages (older than 3 days)
 *
 * Runs daily at 3:00 AM UTC. Deletes messages older than 3 days from all
 * language-based public chat collections in Realtime Database.
 *
 * Collections cleaned:
 *   chat_new, chat_es, chat_pt, chat_fr, chat_de,
 *   chat_tr, chat_ar, chat_ja, chat_ko, chat_ru
 *
 * Cost optimization:
 * - Uses orderByChild('timestamp') + endAt() to query only old messages
 * - Processes each collection sequentially to avoid memory spikes
 * - Deletes in batches of 500 via multi-path updates (single RTDB write)
 * - Runs once daily during low-traffic hours
 *
 * Deployment:
 * firebase deploy --only functions:cleanupOldPublicChats
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const PUBLIC_CHAT_PATHS = [
  'chat_new',
  'chat_es',
  'chat_pt',
  'chat_fr',
  'chat_de',
  'chat_tr',
  'chat_ar',
  'chat_ja',
  'chat_ko',
  'chat_ru',
];

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

exports.cleanupOldPublicChats = functions
  .runWith({ memory: '512MB', timeoutSeconds: 300 })
  .pubsub.schedule('every day 03:00')
  .timeZone('UTC')
  .onRun(async () => {
    const cutoff = Date.now() - THREE_DAYS_MS;
    const db = admin.database();
    let totalDeleted = 0;

    console.log(`🧹 Starting public chat cleanup. Cutoff: ${new Date(cutoff).toISOString()}`);

    for (const chatPath of PUBLIC_CHAT_PATHS) {
      try {
        let deletedInPath = 0;
        let hasMore = true;

        while (hasMore) {
          // Query messages with timestamp <= cutoff, batch by BATCH_SIZE
          const snapshot = await db.ref(chatPath)
            .orderByChild('timestamp')
            .endAt(cutoff)
            .limitToFirst(BATCH_SIZE)
            .once('value');

          if (!snapshot.exists() || snapshot.numChildren() === 0) {
            hasMore = false;
            break;
          }

          // Build multi-path update to delete all matched keys in one write
          const updates = {};
          snapshot.forEach((child) => {
            updates[`${chatPath}/${child.key}`] = null;
          });

          const count = Object.keys(updates).length;
          await db.ref().update(updates);
          deletedInPath += count;

          // If we got fewer than BATCH_SIZE, we're done with this path
          if (count < BATCH_SIZE) {
            hasMore = false;
          }
        }

        if (deletedInPath > 0) {
          console.log(`✅ ${chatPath}: deleted ${deletedInPath} old messages`);
        }
        totalDeleted += deletedInPath;

      } catch (error) {
        console.error(`❌ Error cleaning ${chatPath}:`, error);
      }
    }

    console.log(`🧹 Cleanup complete. Total deleted: ${totalDeleted} messages across all chats.`);
    return null;
  });
