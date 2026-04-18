/**
 * Cloud Function: Trim group chat messages to the latest 200 per group
 *
 * Runs every 12 hours (00:00 and 12:00 UTC).
 *
 * For every active group in Firestore, reads the last 200 messages from
 * RTDB (group_messages/{groupId}/messages) ordered by timestamp, then
 * deletes all messages older than the 200th most-recent one in batches.
 *
 * Why count-based instead of time-based:
 * - Active groups can accumulate thousands of messages in hours
 * - Inactive groups naturally stay under the limit and are skipped cheaply
 * - Complements cleanupGroups.js (which deletes entire inactive groups after 15 days)
 *
 * Cost optimization:
 * - Firestore .select() fetches only doc IDs — no field data downloaded
 * - limitToLast(200) never reads more than 200 messages per group
 * - Deletes via multi-path updates (single RTDB write per batch of 500)
 * - Sequential group processing avoids memory spikes
 *
 * Deployment:
 * firebase deploy --only functions:cleanupGroupChatMessages
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const KEEP_LAST = 300;
const DELETE_BATCH_SIZE = 500;

/**
 * Trim one group's messages — keep the latest KEEP_LAST, delete the rest.
 * @param {admin.database.Database} db
 * @param {string} groupId
 * @returns {Promise<number>} number of messages deleted
 */
async function trimGroupMessages(db, groupId) {
  const messagesRef = db.ref(`group_messages/${groupId}/messages`);

  // 1. Fetch the last KEEP_LAST messages ordered by timestamp.
  //    limitToLast is the cheapest way — downloads at most KEEP_LAST nodes.
  const tailSnap = await messagesRef
    .orderByChild('timestamp')
    .limitToLast(KEEP_LAST)
    .once('value');

  // Fewer messages than the limit — nothing to trim
  if (!tailSnap.exists() || tailSnap.numChildren() < KEEP_LAST) return 0;

  // 2. Find the oldest timestamp among the 200 we're keeping.
  //    forEach iterates in ascending order so the first child is the oldest kept.
  let oldestKeptTimestamp = null;
  tailSnap.forEach((child) => {
    if (oldestKeptTimestamp === null) {
      oldestKeptTimestamp = child.val().timestamp;
    }
  });

  if (typeof oldestKeptTimestamp !== 'number') return 0;

  // 3. Delete everything strictly before oldestKeptTimestamp in batches.
  //    endAt is inclusive, so subtract 1 ms to exclude the boundary message.
  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    const oldSnap = await messagesRef
      .orderByChild('timestamp')
      .endAt(oldestKeptTimestamp - 1)
      .limitToFirst(DELETE_BATCH_SIZE)
      .once('value');

    if (!oldSnap.exists() || oldSnap.numChildren() === 0) break;

    // Multi-path update — single RTDB write for the whole batch
    const updates = {};
    let count = 0;
    oldSnap.forEach((child) => {
      updates[`group_messages/${groupId}/messages/${child.key}`] = null;
      count++;
    });

    await db.ref().update(updates);
    totalDeleted += count;

    if (count < DELETE_BATCH_SIZE) hasMore = false;
  }

  return totalDeleted;
}

exports.cleanupGroupChatMessages = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every 12 hours')
  .timeZone('UTC')
  .onRun(async () => {
    const db = admin.database();
    const firestore = admin.firestore();
    let totalDeleted = 0;
    let groupsTrimmed = 0;

    console.log(`🧹 Starting group chat trim — keeping last ${KEEP_LAST} messages per group.`);

    try {
      // .select() with no args fetches only doc IDs from Firestore — no field data
      const allGroups = await firestore.collection('groups').select().get();

      if (allGroups.empty) {
        console.log('ℹ️ No groups found.');
        return null;
      }

      console.log(`📋 Found ${allGroups.size} groups to check.`);

      for (const groupDoc of allGroups.docs) {
        try {
          const deleted = await trimGroupMessages(db, groupDoc.id);
          if (deleted > 0) {
            console.log(`✅ ${groupDoc.id}: trimmed ${deleted} old messages`);
            totalDeleted += deleted;
            groupsTrimmed++;
          }
        } catch (err) {
          console.error(`❌ Error trimming group ${groupDoc.id}:`, err.message || err);
        }
      }
    } catch (err) {
      console.error('❌ Fatal error in cleanupGroupChatMessages:', err);
    }

    console.log(
      `🧹 Done. Removed ${totalDeleted} old messages from ${groupsTrimmed} group${groupsTrimmed !== 1 ? 's' : ''}.`
    );
    return null;
  });
