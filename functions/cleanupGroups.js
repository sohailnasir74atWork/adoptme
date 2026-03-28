/**
 * Cloud Function: Cleanup group messages + delete inactive groups
 *
 * Runs daily at 7:00 AM UTC.
 *
 * Two tasks:
 * 1. Delete messages older than 7 days from ALL groups (RTDB)
 * 2. Delete entire groups inactive for 15+ days:
 *    - Firestore: groups/{groupId}
 *    - RTDB: group_messages/{groupId}
 *    - RTDB: group_meta_data/{userId}/{groupId} for all members
 *    - RTDB: activeGroupChats/{groupId}
 *    - Bunny CDN: group avatar image
 *
 * Cost optimization:
 * - Firestore query uses lastMessageTimestamp index
 * - RTDB message cleanup uses orderByChild('timestamp') + endAt()
 * - Multi-path deletes for batch RTDB writes
 * - Sequential processing to avoid memory spikes
 *
 * Deployment:
 * firebase deploy --only functions:cleanupGroups
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const https = require('https');

if (!admin.apps.length) {
  admin.initializeApp();
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

// Bunny CDN config
const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

/**
 * Delete a file from Bunny CDN storage.
 */
function deleteBunnyFile(cdnUrl) {
  return new Promise((resolve) => {
    let storagePath;
    try {
      if (cdnUrl.startsWith(BUNNY_CDN_BASE)) {
        storagePath = cdnUrl.replace(`${BUNNY_CDN_BASE}/`, '');
      } else {
        const url = new URL(cdnUrl);
        storagePath = url.pathname.replace(/^\//, '');
      }
    } catch (e) {
      resolve(false);
      return;
    }

    const req = https.request({
      hostname: BUNNY_STORAGE_HOST,
      path: `/${BUNNY_STORAGE_ZONE}/${storagePath}`,
      method: 'DELETE',
      headers: { 'AccessKey': BUNNY_ACCESS_KEY },
    }, (res) => {
      resolve(res.statusCode < 400 || res.statusCode === 404);
      res.resume();
    });

    req.on('error', () => resolve(false));
    req.end();
  });
}

/**
 * Delete old messages from a single group's RTDB messages node.
 */
async function cleanOldMessages(db, groupId, cutoffTimestamp) {
  const messagesRef = db.ref(`group_messages/${groupId}/messages`);
  let deleted = 0;
  let hasMore = true;

  while (hasMore) {
    const snapshot = await messagesRef
      .orderByChild('timestamp')
      .endAt(cutoffTimestamp)
      .limitToFirst(BATCH_SIZE)
      .once('value');

    if (!snapshot.exists() || snapshot.numChildren() === 0) {
      hasMore = false;
      break;
    }

    // Delete image files from Bunny CDN before removing messages
    const imageDeletePromises = [];
    snapshot.forEach((child) => {
      const msg = child.val();
      if (msg.imageUrl) imageDeletePromises.push(deleteBunnyFile(msg.imageUrl));
      if (Array.isArray(msg.imageUrls)) {
        msg.imageUrls.forEach((url) => imageDeletePromises.push(deleteBunnyFile(url)));
      }
    });
    if (imageDeletePromises.length > 0) {
      await Promise.all(imageDeletePromises);
    }

    // Multi-path delete messages
    const updates = {};
    snapshot.forEach((child) => {
      updates[`group_messages/${groupId}/messages/${child.key}`] = null;
    });

    const count = Object.keys(updates).length;
    await db.ref().update(updates);
    deleted += count;

    if (count < BATCH_SIZE) hasMore = false;
  }

  return deleted;
}

/**
 * Fully delete an inactive group: Firestore doc, RTDB messages,
 * RTDB metadata for all members, activeGroupChats, and avatar.
 */
async function deleteInactiveGroup(firestore, db, groupDoc) {
  const groupId = groupDoc.id;
  const groupData = groupDoc.data();
  const memberIds = groupData.memberIds || [];

  // 1. Delete all messages + their images from RTDB
  await db.ref(`group_messages/${groupId}`).remove();

  // 2. Delete group_meta_data for all members + activeGroupChats
  const rtdbUpdates = {};
  rtdbUpdates[`activeGroupChats/${groupId}`] = null;
  for (const memberId of memberIds) {
    rtdbUpdates[`group_meta_data/${memberId}/${groupId}`] = null;
  }
  await db.ref().update(rtdbUpdates);

  // 3. Delete group avatar from Bunny CDN
  if (groupData.avatar && groupData.avatar.startsWith('http')) {
    await deleteBunnyFile(groupData.avatar);
  }

  // 4. Delete pending invitations for this group
  const invitesSnap = await firestore.collection('group_invitations')
    .where('groupId', '==', groupId)
    .limit(BATCH_SIZE)
    .get();
  if (!invitesSnap.empty) {
    const inviteBatch = firestore.batch();
    invitesSnap.docs.forEach((doc) => inviteBatch.delete(doc.ref));
    await inviteBatch.commit();
  }

  // 5. Delete pending join requests for this group
  const requestsSnap = await firestore.collection('group_join_requests')
    .where('groupId', '==', groupId)
    .limit(BATCH_SIZE)
    .get();
  if (!requestsSnap.empty) {
    const requestBatch = firestore.batch();
    requestsSnap.docs.forEach((doc) => requestBatch.delete(doc.ref));
    await requestBatch.commit();
  }

  // 6. Delete Firestore group document
  await firestore.doc(`groups/${groupId}`).delete();

  console.log(`🗑️ Deleted inactive group: ${groupId} (${groupData.name || 'unnamed'}, ${memberIds.length} members)`);
}

exports.cleanupGroups = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every day 07:00')
  .timeZone('UTC')
  .onRun(async () => {
    const now = Date.now();
    const messageCutoff = now - SEVEN_DAYS_MS;
    const inactiveCutoff = admin.firestore.Timestamp.fromMillis(now - FIFTEEN_DAYS_MS);
    const firestore = admin.firestore();
    const db = admin.database();

    let totalMessagesDeleted = 0;
    let totalGroupsDeleted = 0;

    console.log(`🧹 Starting group cleanup.`);
    console.log(`   Message cutoff: ${new Date(messageCutoff).toISOString()}`);
    console.log(`   Inactive group cutoff: ${inactiveCutoff.toDate().toISOString()}`);

    // ══════════════════════════════════════════════
    // TASK 1: Delete old messages from ALL groups
    // ══════════════════════════════════════════════
    try {
      // Get all group IDs from Firestore (lightweight — only fetch IDs)
      const allGroups = await firestore.collection('groups').select().get();

      console.log(`📋 Found ${allGroups.size} groups. Cleaning old messages...`);

      for (const groupDoc of allGroups.docs) {
        try {
          const deleted = await cleanOldMessages(db, groupDoc.id, messageCutoff);
          if (deleted > 0) {
            console.log(`✅ ${groupDoc.id}: deleted ${deleted} old messages`);
          }
          totalMessagesDeleted += deleted;
        } catch (error) {
          console.error(`❌ Error cleaning messages in ${groupDoc.id}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Error in message cleanup:', error);
    }

    // ══════════════════════════════════════════════
    // TASK 2: Delete entire inactive groups (15+ days)
    // ══════════════════════════════════════════════
    try {
      let hasMore = true;

      while (hasMore) {
        const snapshot = await firestore.collection('groups')
          .where('lastMessageTimestamp', '<', inactiveCutoff)
          .limit(50)
          .get();

        if (snapshot.empty) {
          hasMore = false;
          break;
        }

        for (const groupDoc of snapshot.docs) {
          try {
            await deleteInactiveGroup(firestore, db, groupDoc);
            totalGroupsDeleted++;
          } catch (error) {
            console.error(`❌ Error deleting group ${groupDoc.id}:`, error);
          }
        }

        if (snapshot.size < 50) hasMore = false;
      }

      // Also catch groups that never had a message (lastMessageTimestamp is null)
      // These are created but abandoned — use createdAt instead
      const abandonedSnapshot = await firestore.collection('groups')
        .where('lastMessageTimestamp', '==', null)
        .where('createdAt', '<', inactiveCutoff)
        .limit(100)
        .get();

      for (const groupDoc of abandonedSnapshot.docs) {
        try {
          await deleteInactiveGroup(firestore, db, groupDoc);
          totalGroupsDeleted++;
        } catch (error) {
          console.error(`❌ Error deleting abandoned group ${groupDoc.id}:`, error);
        }
      }

    } catch (error) {
      console.error('❌ Error in inactive group cleanup:', error);
    }

    console.log(`🧹 Group cleanup complete. Messages deleted: ${totalMessagesDeleted}, Groups deleted: ${totalGroupsDeleted}`);
    return null;
  });
