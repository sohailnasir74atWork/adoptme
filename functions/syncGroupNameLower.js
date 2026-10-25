/**
 * syncGroupNameLower — keeps groups/{groupId}.groupNameLower equal to the
 * lowercased group name, so the All Groups search can match regardless of
 * capitals (Firestore range queries are case-sensitive).
 *
 * New app builds write the field themselves on create and rename; this
 * trigger covers older builds and the website, which only write groupName.
 * It returns without writing when the field is already right, so its own
 * update does not loop.
 *
 * Existing groups: scripts/backfill-group-name-lower.js.
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

// Same rule as the app (Code/ChatScreen/utils/groupUtils.js toGroupNameLower).
const toGroupNameLower = (data) => String(data?.groupName || data?.name || '').trim().toLowerCase();

exports.syncGroupNameLower = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .firestore.document('groups/{groupId}')
  .onWrite(async (change) => {
    if (!change.after.exists) return null;
    const data = change.after.data();
    const lower = toGroupNameLower(data);
    if (data.groupNameLower === lower) return null;
    await change.after.ref.update({ groupNameLower: lower });
    return null;
  });

// Exposed for the backfill script and tests.
exports._internals = { toGroupNameLower };
