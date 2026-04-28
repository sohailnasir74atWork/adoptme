/**
 * Cloud Functions: Mod / JMod role triggers
 *
 * Deep-path RTDB triggers — fire only when isModerator / isBabyMod
 * changes, not on every user write. Mod rank wins over jmod when both
 * flags are true.
 *
 * RTDB structure:
 *   mods/{uid}/ { displayName, avatar, role: 'mod' | 'jmod', updatedAt }
 *
 * Refresh + seed maintenance lives in syncRosterMaintenance.js
 * (one shared schedule for mods + trusted + cmsr).
 *
 * Deployment:
 * firebase deploy --only functions:syncModRole_Moderator,functions:syncModRole_BabyMod
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

// ─── Trigger: fires ONLY when users/{uid}/isModerator changes ───
exports.syncModRole_Moderator = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .database
  .ref('users/{uid}/isModerator')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const isMod = change.after.val() === true;

    if (isMod) {
      const profile = await readNameAvatar(uid);
      await db.ref(`mods/${uid}`).set({
        ...profile,
        role: 'mod',
        updatedAt: Date.now(),
      });
    } else {
      // Demoted — keep as 'jmod' if isBabyMod is still true, else remove
      const jmodSnap = await db.ref(`users/${uid}/isBabyMod`).once('value');
      if (jmodSnap.val() === true) {
        await db.ref(`mods/${uid}`).update({
          role: 'jmod',
          updatedAt: Date.now(),
        });
      } else {
        await db.ref(`mods/${uid}`).remove();
      }
    }
    return null;
  });

// ─── Trigger: fires ONLY when users/{uid}/isBabyMod changes ───
exports.syncModRole_BabyMod = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .database
  .ref('users/{uid}/isBabyMod')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const isJmod = change.after.val() === true;

    if (isJmod) {
      // Already a full mod? mod rank wins, leave entry alone
      const modSnap = await db.ref(`users/${uid}/isModerator`).once('value');
      if (modSnap.val() === true) return null;

      const profile = await readNameAvatar(uid);
      await db.ref(`mods/${uid}`).set({
        ...profile,
        role: 'jmod',
        updatedAt: Date.now(),
      });
    } else {
      const modSnap = await db.ref(`users/${uid}/isModerator`).once('value');
      if (modSnap.val() === true) return null; // still a mod, keep entry
      await db.ref(`mods/${uid}`).remove();
    }
    return null;
  });
