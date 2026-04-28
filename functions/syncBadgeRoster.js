/**
 * Cloud Functions: Trusted / CMSR role triggers
 *
 * Deep-path RTDB triggers — fire only when isTrusted / isCMSR changes,
 * not on every user write.
 *
 * RTDB structure:
 *   trusted/{uid}/ { displayName, avatar, role: 'trusted', updatedAt }
 *   cmsr/{uid}/    { displayName, avatar, role: 'cmsr',    updatedAt }
 *
 * Refresh + seed maintenance lives in syncRosterMaintenance.js
 * (one shared schedule for mods + trusted + cmsr).
 *
 * Deployment:
 * firebase deploy --only functions:syncRoleTrusted,functions:syncRoleCMSR
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();

// Read only the two fields we need — not the full user doc
async function readNameAvatar(uid) {
  const [nameSnap, avatarSnap] = await Promise.all([
    db.ref(`users/${uid}/displayName`).once('value'),
    db.ref(`users/${uid}/avatar`).once('value'),
  ]);
  return {
    displayName: nameSnap.val() || 'Unknown',
    avatar: avatarSnap.val() || '',
  };
}

// ─── Trigger: users/{uid}/isTrusted changes ───
exports.syncRoleTrusted = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .database
  .ref('users/{uid}/isTrusted')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const isOn = change.after.val() === true;

    if (isOn) {
      const profile = await readNameAvatar(uid);
      await db.ref(`trusted/${uid}`).set({
        ...profile,
        role: 'trusted',
        updatedAt: Date.now(),
      });
    } else {
      await db.ref(`trusted/${uid}`).remove();
    }
    return null;
  });

// ─── Trigger: users/{uid}/isCMSR changes ───
exports.syncRoleCMSR = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .database
  .ref('users/{uid}/isCMSR')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const isOn = change.after.val() === true;

    if (isOn) {
      const profile = await readNameAvatar(uid);
      await db.ref(`cmsr/${uid}`).set({
        ...profile,
        role: 'cmsr',
        updatedAt: Date.now(),
      });
    } else {
      await db.ref(`cmsr/${uid}`).remove();
    }
    return null;
  });
