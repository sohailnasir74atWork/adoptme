/**
 * Cloud Functions: Mod/JMod roster sync
 *
 * syncModRoster:
 *   RTDB trigger on users/{uid}. Only fires when isModerator, isBabyMod,
 *   displayName, or avatar changes. Lightweight — reads nothing extra.
 *
 * seedModRoster:
 *   Separate scheduled function that runs once on deploy, then
 *   auto-disables. Scans users with orderByChild queries (not full dump).
 *
 * RTDB structure:
 *   mods/{uid}/ { displayName, avatar, role, updatedAt }
 *
 * Deployment:
 * firebase deploy --only functions:syncModRoster,functions:seedModRoster
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();

function buildModEntry(userData) {
  if (!userData) return null;
  const isMod = userData.isModerator === true;
  const isJmod = userData.isBabyMod === true;
  if (!isMod && !isJmod) return null;
  return {
    displayName: userData.displayName || 'Unknown',
    avatar: userData.avatar || '',
    role: isMod ? 'mod' : 'jmod',
    updatedAt: Date.now(),
  };
}

// ─── Listener: fires on write to users/{uid} ───
// Only processes the single user that changed — no bulk reads
exports.syncModRoster = functions
  .runWith({ memory: '128MB', timeoutSeconds: 10 })
  .database
  .ref('users/{uid}')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;
    const after = change.after.val();
    const before = change.before.val();

    // User deleted
    if (!after) {
      await db.ref(`mods/${uid}`).remove();
      return null;
    }

    // Only react to relevant field changes
    const relevantFields = ['isModerator', 'isBabyMod', 'displayName', 'avatar'];
    const changed = !before || relevantFields.some(f => before[f] !== after[f]);
    if (!changed) return null;

    const entry = buildModEntry(after);

    if (entry) {
      await db.ref(`mods/${uid}`).set(entry);
    } else {
      await db.ref(`mods/${uid}`).remove();
    }

    return null;
  });

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
