/**
 * mirrorStaffToFirestore — copies who is staff into Firestore `staff/{uid}`.
 *
 * Roles live in RTDB (/users/{uid}/admin, /isModerator), but Firestore
 * security rules cannot read RTDB. The Firestore rules check
 * `exists(/staff/$(uid))` for the actions the app gates on "admin or
 * moderator": deleting any trade/post/status/group, verifying scammer reports,
 * managing polls, deleting reviews. The app itself is unchanged, so staff
 * keep these powers on every installed build.
 *
 *   staff/{uid} = { admin: bool, isModerator: bool, updatedAt }
 *   (present only while at least one flag is true)
 *
 * Two triggers keep it current within seconds of a promotion or removal;
 * the 6-hourly reconcile repairs anything a failed trigger missed and seeds
 * the collection on first deploy. Client writes to `staff` are denied.
 *
 * Deploy: firebase deploy --only functions:syncStaff_Admin,functions:syncStaff_Moderator,functions:reconcileStaffMirror
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

if (!admin.apps.length) admin.initializeApp();

const FLAGS = ['admin', 'isModerator']; // both indexed under /users in the RTDB rules

async function syncOne(uid) {
  const db = admin.database();
  const [a, m] = await Promise.all(FLAGS.map((f) => db.ref(`users/${uid}/${f}`).once('value')));
  const row = { admin: a.val() === true, isModerator: m.val() === true };
  const ref = admin.firestore().doc(`staff/${uid}`);
  if (row.admin || row.isModerator) {
    await ref.set({ ...row, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  } else {
    await ref.delete();
  }
}

const trigger = (flag) => functions
  .runWith({ memory: '128MB', timeoutSeconds: 20 })
  .database.ref(`users/{uid}/${flag}`)
  .onWrite((change, context) => syncOne(context.params.uid));

exports.syncStaff_Admin = trigger('admin');
exports.syncStaff_Moderator = trigger('isModerator');

exports.reconcileStaffMirror = functions
  .runWith({ memory: '256MB', timeoutSeconds: 120 })
  .pubsub.schedule('every 6 hours')
  .onRun(async () => {
    const db = admin.database();
    const fs = admin.firestore();

    const truth = {}; // uid -> { admin, isModerator }
    for (const flag of FLAGS) {
      const snap = await db.ref('users').orderByChild(flag).equalTo(true).once('value');
      snap.forEach((child) => {
        truth[child.key] = { admin: false, isModerator: false, ...truth[child.key], [flag]: true };
      });
    }

    const mirror = {};
    (await fs.collection('staff').get()).forEach((d) => { mirror[d.id] = d.data(); });

    const batch = fs.batch();
    let changes = 0;
    for (const [uid, row] of Object.entries(truth)) {
      const m = mirror[uid];
      if (!m || m.admin !== row.admin || m.isModerator !== row.isModerator) {
        batch.set(fs.doc(`staff/${uid}`), { ...row, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        changes++;
      }
    }
    for (const uid of Object.keys(mirror)) {
      if (!truth[uid]) { batch.delete(fs.doc(`staff/${uid}`)); changes++; }
    }
    if (changes) await batch.commit();
    console.log(`[staffMirror] ${Object.keys(truth).length} staff, ${changes} change(s)`);
    return null;
  });
