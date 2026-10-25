/**
 * Cloud Function: Cleanup group messages + delete inactive groups
 *
 * Runs daily at 7:00 AM UTC.
 *
 * Two tasks:
 * 1. Delete messages older than 7 days from ALL groups (RTDB)
 * 2. Inactive groups (2026-10-25, owner request): no message for 15 days
 *    (counting from creation when it never had one) → deleted, with a backup
 *    in groups_deleted:
 *    - Supabase: group_messages, every member's group_meta_data row
 *    - RTDB: group_messages/{id}, groups/{id}, activeGroupChats/{id},
 *      group_meta_data/{member}/{id}
 *    - Firestore: group_invitations, group_join_requests, groups/{id}
 *    - Bunny CDN: group avatar image
 *    Every other group gets its lastActivityAt brought up to date; the app
 *    shows "deleted in N days" on the group list from day 7 of quiet.
 *    notifyGroupMessage bumps lastActivityAt on each message (at most hourly),
 *    so the warning clears as soon as someone texts.
 *
 * Cost optimization:
 * - One Supabase index probe + one shallow RTDB query per group
 * - RTDB message cleanup uses orderByChild('timestamp') + endAt()
 * - Multi-path deletes for batch RTDB writes
 *
 * Deployment:
 * firebase deploy --only functions:cleanupGroups
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const https = require('https');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_AFTER_MS = 7 * DAY_MS;      // GroupsScreen shows the countdown from here
const INACTIVE_MS = 15 * DAY_MS;       // deleted from here
const MAX_DELETE_PER_RUN = 200;
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

/** createdAt may be a Firestore Timestamp, a number, or absent. */
function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value._seconds != null) return value._seconds * 1000;
  return 0;
}

/** Runs fn over items with at most `limit` in flight. */
async function mapWithConcurrency(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const index = i++;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Newest message time for a group: Supabase group_messages (the store since
 * the chat migration; retention keeps the newest 300 per group, so the newest
 * row is always there) and RTDB group_messages (old builds). Throws when
 * Supabase can't answer — the caller must then leave the group alone.
 */
async function lastMessageAt(sb, db, groupId) {
  const { data, error } = await sb
    .from('group_messages')
    .select('created_at')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`supabase: ${error.message}`);
  let newest = data && data[0] ? Date.parse(data[0].created_at) || 0 : 0;

  const snap = await db.ref(`group_messages/${groupId}/messages`)
    .orderByChild('timestamp').limitToLast(1).once('value');
  snap.forEach((child) => {
    const ts = Number(child.val() && child.val().timestamp);
    if (Number.isFinite(ts)) newest = Math.max(newest, ts);
    return false;
  });
  return newest;
}

/** Every member id we can find, Firestore and RTDB both (see deleteGroup in the app). */
async function collectMemberIds(db, groupId, data) {
  const ids = new Set();
  for (const id of data.memberIds || []) if (id && typeof id === 'string') ids.add(id);
  for (const id of Object.keys(data.members || {})) if (id) ids.add(id);
  try {
    const val = (await db.ref(`groups/${groupId}`).once('value')).val();
    if (val) {
      const fromRtdb = Array.isArray(val.memberIds)
        ? val.memberIds
        : Object.keys(val.memberIds || val.members || {});
      for (const id of fromRtdb) if (id && typeof id === 'string') ids.add(id);
    }
  } catch (e) {
    console.warn(`could not read groups/${groupId}: ${e.message}`);
  }
  return [...ids];
}

/** Deletes every doc of a collection that points at the group. */
async function deleteWhereGroup(firestore, collectionName, groupId) {
  for (;;) {
    const snap = await firestore.collection(collectionName)
      .where('groupId', '==', groupId).limit(BATCH_SIZE).get();
    if (snap.empty) return;
    const batch = firestore.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (snap.size < BATCH_SIZE) return;
  }
}

/**
 * Fully delete an inactive group: a backup in groups_deleted, then Supabase
 * messages + every member's inbox row, RTDB messages / group node / member
 * meta / activeGroupChats, the avatar, invitations, join requests, and the
 * Firestore doc last (so a failure part-way leaves the group findable and
 * the next run finishes the job).
 */
async function deleteInactiveGroup({ firestore, db, sb }, groupId, groupData, lastActivityAt) {
  const memberIds = await collectMemberIds(db, groupId, groupData);

  await firestore.collection('groups_deleted').doc(groupId).set({
    group: groupData,
    reason: 'inactive_15_days',
    lastActivityAt,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Supabase: a dead group has no one watching its messages, so these
  // deletes reach no Realtime subscriber; inbox rows by primary key.
  const msgDel = await sb.from('group_messages').delete().eq('group_id', groupId);
  if (msgDel.error) throw new Error(`supabase messages: ${msgDel.error.message}`);
  for (let i = 0; i < memberIds.length; i += 100) {
    const metaDel = await sb.from('group_meta_data').delete()
      .eq('group_id', groupId).in('user_id', memberIds.slice(i, i + 100));
    if (metaDel.error) throw new Error(`supabase meta: ${metaDel.error.message}`);
  }

  const rtdbUpdates = {
    [`group_messages/${groupId}`]: null,
    [`groups/${groupId}`]: null,
    [`activeGroupChats/${groupId}`]: null,
  };
  for (const memberId of memberIds) {
    rtdbUpdates[`group_meta_data/${memberId}/${groupId}`] = null;
  }
  await db.ref().update(rtdbUpdates);

  if (typeof groupData.avatar === 'string' && groupData.avatar.startsWith('http')) {
    await deleteBunnyFile(groupData.avatar);
  }

  await deleteWhereGroup(firestore, 'group_invitations', groupId);
  await deleteWhereGroup(firestore, 'group_join_requests', groupId);
  await firestore.doc(`groups/${groupId}`).delete();

  console.log(`🗑️ Deleted inactive group: ${groupId} (${groupData.name || 'unnamed'}, ${memberIds.length} members, last activity ${new Date(lastActivityAt).toISOString()})`);
}

/**
 * Task 2. Activity = the newest of: the group's lastActivityAt (bumped by
 * notifyGroupMessage on every message, at most hourly), the newest message in
 * Supabase / RTDB, and createdAt. Firestore's lastMessageTimestamp is never
 * written after createGroup, so it is not used.
 *   - quiet 15 days or more → deleted (up to MAX_DELETE_PER_RUN a run)
 *   - otherwise lastActivityAt is written back when it is behind, so the app
 *     can show "deleted in N days" from day 7 (GroupsScreen).
 * A group whose activity can't be read (Supabase error, no createdAt and no
 * message) is left alone.
 */
async function runInactiveGroupCleanup(deps, { apply = true } = {}) {
  const { firestore, db, sb } = deps;
  const now = deps.now ? deps.now() : Date.now();
  const cutoff = now - INACTIVE_MS;
  const snap = await firestore.collection('groups').get();
  const report = {
    mode: apply ? 'apply' : 'dry_run',
    groups: snap.size, inactive: 0, deleted: 0, warned: 0, activityWritten: 0, unknown: 0, failed: 0, sample: [],
  };

  const verdicts = await mapWithConcurrency(snap.docs, 10, async (doc) => {
    const data = doc.data() || {};
    const stored = Number(data.lastActivityAt) || 0;
    try {
      const activity = Math.max(stored, toMillis(data.createdAt), await lastMessageAt(sb, db, doc.id));
      return { doc, data, stored, activity };
    } catch (e) {
      console.error(`❌ activity of ${doc.id}: ${e.message}`);
      return { doc, data, stored, activity: 0, failed: true };
    }
  });

  for (const v of verdicts) {
    if (!v.activity) { report.unknown += 1; if (v.failed) report.failed += 1; continue; }
    if (v.activity < cutoff) {
      report.inactive += 1;
      if (report.sample.length < 20) report.sample.push(`${v.doc.id} "${v.data.name || ''}" ${new Date(v.activity).toISOString()}`);
      if (!apply || report.deleted >= MAX_DELETE_PER_RUN) continue;
      try {
        await deleteInactiveGroup(deps, v.doc.id, v.data, v.activity);
        report.deleted += 1;
      } catch (e) {
        report.failed += 1;
        console.error(`❌ Error deleting group ${v.doc.id}:`, e);
      }
      continue;
    }
    if (v.activity < now - WARN_AFTER_MS) report.warned += 1;
    if (v.activity - v.stored > 60 * 1000) {
      report.activityWritten += 1;
      if (apply) {
        await v.doc.ref.update({ lastActivityAt: v.activity })
          .catch((e) => console.error(`❌ lastActivityAt ${v.doc.id}: ${e.message}`));
      }
    }
  }
  return report;
}

exports.cleanupGroups = functions
  .runWith({ secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'], memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every day 07:00')
  .timeZone('UTC')
  .onRun(async () => {
    const now = Date.now();
    const messageCutoff = now - SEVEN_DAYS_MS;
    const firestore = admin.firestore();
    const db = admin.database();

    let totalMessagesDeleted = 0;
    let totalGroupsDeleted = 0;

    console.log(`🧹 Starting group cleanup.`);
    console.log(`   Message cutoff: ${new Date(messageCutoff).toISOString()}`);
    console.log(`   Inactive group cutoff: ${new Date(now - INACTIVE_MS).toISOString()}`);

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
    // TASK 2: Delete groups quiet for 15+ days; keep lastActivityAt current
    // ══════════════════════════════════════════════
    try {
      const report = await runInactiveGroupCleanup({ firestore, db, sb: getSupabaseAdmin() });
      totalGroupsDeleted = report.deleted;
      console.log('[inactiveGroups]', JSON.stringify(report));
    } catch (error) {
      console.error('❌ Error in inactive group cleanup:', error);
    }

    console.log(`🧹 Group cleanup complete. Messages deleted: ${totalMessagesDeleted}, Groups deleted: ${totalGroupsDeleted}`);
    return null;
  });

module.exports._internal = { runInactiveGroupCleanup, lastMessageAt };
