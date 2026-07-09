/**
 * Cloud Functions: Mod/JMod roster seed
 *
 * The syncModRoster onWrite trigger was ABSORBED into
 * mirrorUsersToSupabase (mirrorModsRoster) — both fired on every
 * /users/{uid} write, doubling invocations on the hottest RTDB path.
 * After deploying mirrorUsersToSupabase, remove the old trigger:
 *   firebase functions:delete syncModRoster
 *
 * seedModRoster (still here):
 *   Scheduled function that runs once on deploy, then auto-disables.
 *   Scans users with orderByChild queries (not full dump).
 *
 * RTDB structure:
 *   mods/{uid}/ { displayName, avatar, role, updatedAt }
 *
 * Deployment:
 * firebase deploy --only functions:seedModRoster
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();

// ─── One-time seed: finds existing mods via indexed queries ───
// Uses two targeted queries instead of downloading all users
// Runs on schedule but only does work if mods node is empty
exports.seedModRoster = functions
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    // Skip if already seeded
    const modsSnap = await db.ref('mods').limitToFirst(1).once('value');
    if (modsSnap.exists()) {
      console.log('[ModSync] mods node already exists, skipping seed');
      return null;
    }

    console.log('[ModSync] Seeding mods node...');
    const updates = {};
    let count = 0;

    // Query 1: find all moderators
    const modSnap = await db.ref('users')
      .orderByChild('isModerator')
      .equalTo(true)
      .once('value');

    if (modSnap.exists()) {
      modSnap.forEach(child => {
        const data = child.val();
        updates[`mods/${child.key}`] = {
          displayName: data.displayName || 'Unknown',
          avatar: data.avatar || '',
          role: 'mod',
          updatedAt: Date.now(),
        };
        count++;
      });
    }

    // Query 2: find all junior mods
    const jmodSnap = await db.ref('users')
      .orderByChild('isBabyMod')
      .equalTo(true)
      .once('value');

    if (jmodSnap.exists()) {
      jmodSnap.forEach(child => {
        // Don't overwrite if already added as mod (mod rank takes priority)
        if (!updates[`mods/${child.key}`]) {
          const data = child.val();
          updates[`mods/${child.key}`] = {
            displayName: data.displayName || 'Unknown',
            avatar: data.avatar || '',
            role: 'jmod',
            updatedAt: Date.now(),
          };
          count++;
        }
      });
    }

    if (count > 0) {
      await db.ref().update(updates);
    }

    console.log(`[ModSync] Seeded ${count} mods/jmods`);
    return null;
  });
