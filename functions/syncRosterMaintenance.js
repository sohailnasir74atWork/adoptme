/**
 * Cloud Functions: Roster maintenance (mods + trusted + cmsr)
 *
 * Replaces the old refreshModProfiles + seedModRoster + refreshBadgeProfiles
 * + seedBadgeRoster — one schedule each, handling all rosters in one pass.
 *
 * refreshAllRosters:
 *   Every 6h — refreshes displayName/avatar on existing entries across
 *   mods/, trusted/, and cmsr/. Reads only the small roster nodes,
 *   not /users.
 *
 * seedAllRosters:
 *   Daily, idempotent — populates any roster node that is empty by
 *   running indexed equalTo() queries on /users. Requires .indexOn for
 *   isModerator / isBabyMod / isTrusted / isCMSR (set in PRESENCE_RULES.json).
 *   Once all rosters are populated, every run is a tiny limitToFirst(1)
 *   probe per node — safe to delete the schedule entirely.
 *
 * Deployment:
 * firebase deploy --only functions:refreshAllRosters,functions:seedAllRosters
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.database();

// Roster node → user-flag mapping. Mods are special: a single node holds
// both 'mod' and 'jmod' entries, populated from two flags.
const ROSTERS = [
  { node: 'mods',    flags: [{ flag: 'isModerator', role: 'mod' }, { flag: 'isBabyMod', role: 'jmod' }] },
  { node: 'trusted', flags: [{ flag: 'isTrusted',   role: 'trusted' }] },
  { node: 'cmsr',    flags: [{ flag: 'isCMSR',      role: 'cmsr' }] },
];

// ─── Refresh displayName/avatar across all rosters in one pass ───
exports.refreshAllRosters = functions
  .runWith({ memory: '128MB', timeoutSeconds: 60 })
  .pubsub
  .schedule('every 6 hours')
  .onRun(async () => {
    const updates = {};
    let touched = 0;

    for (const { node } of ROSTERS) {
      const rosterSnap = await db.ref(node).once('value');
      if (!rosterSnap.exists()) continue;

      const current = rosterSnap.val();
      const uids = Object.keys(current);

      // Read only the two fields we care about per user — keeps payload tiny
      const profiles = await Promise.all(
        uids.map(uid => Promise.all([
          db.ref(`users/${uid}/displayName`).once('value'),
          db.ref(`users/${uid}/avatar`).once('value'),
        ]))
      );

      profiles.forEach(([nameSnap, avatarSnap], i) => {
        const uid = uids[i];
        // User fully deleted if neither field exists
        if (!nameSnap.exists() && !avatarSnap.exists()) {
          updates[`${node}/${uid}`] = null;
          touched++;
          return;
        }
        const newName = nameSnap.val() || 'Unknown';
        const newAvatar = avatarSnap.val() || '';
        const entry = current[uid];
        if (newName !== entry.displayName || newAvatar !== entry.avatar) {
          updates[`${node}/${uid}/displayName`] = newName;
          updates[`${node}/${uid}/avatar`] = newAvatar;
          updates[`${node}/${uid}/updatedAt`] = Date.now();
          touched++;
        }
      });
    }

    if (Object.keys(updates).length > 0) {
      await db.ref().update(updates);
      console.log(`[RosterSync] Refreshed ${touched} entries`);
    } else {
      console.log('[RosterSync] All entries up to date');
    }
    return null;
  });

// ─── Seed any empty roster from indexed user queries ───
exports.seedAllRosters = functions
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    const updates = {};
    let total = 0;

    for (const { node, flags } of ROSTERS) {
      const existing = await db.ref(node).limitToFirst(1).once('value');
      if (existing.exists()) {
        console.log(`[RosterSync] ${node} already seeded, skipping`);
        continue;
      }

      // For each flag that maps to this node, run one indexed query.
      // First flag in the list wins for shared nodes (e.g. mod beats jmod).
      for (const { flag, role } of flags) {
        const snap = await db.ref('users')
          .orderByChild(flag)
          .equalTo(true)
          .once('value');

        if (!snap.exists()) continue;

        snap.forEach(child => {
          const path = `${node}/${child.key}`;
          if (updates[path]) return; // higher-priority flag already claimed this uid
          const data = child.val();
          updates[path] = {
            displayName: data.displayName || 'Unknown',
            avatar: data.avatar || '',
            role,
            updatedAt: Date.now(),
          };
          total++;
        });
      }
    }

    if (total > 0) await db.ref().update(updates);
    console.log(`[RosterSync] Seeded ${total} entries`);
    return null;
  });
