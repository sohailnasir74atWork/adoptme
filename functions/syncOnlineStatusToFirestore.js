const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const firestore = admin.firestore();
const rtdb = admin.database();
const { FieldValue, FieldPath } = admin.firestore;

exports.syncOnlineStatusToFirestore = functions.database
  .ref('/users/{uid}/online')
  .onWrite(async (change, context) => {
    const uid = context.params.uid;

    const beforeOnline = change.before.val() === true;
    const afterOnline = change.after.val() === true;

    // Only act on real transitions
    if (beforeOnline === afterOnline) return null;

    const onlineUsersDocRef = firestore.collection('online_users_node').doc('list');

    let userProfile = null;

    if (afterOnline) {
      try {
        const userSnap = await rtdb.ref(`users/${uid}`).once('value');
        const data = userSnap.val() || {};

        userProfile = {
          id: uid,
          displayName: data.displayName ?? 'Anonymous',
          avatar:
            data.avatar ??
            'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          isPro: !!data.isPro,
          robloxUsernameVerified: !!data.robloxUsernameVerified,
          lastGameWinAt: data.lastGameWinAt ?? null,
          isAdmin: !!data.isAdmin, // ✅ avoid undefined
        };
      } catch (e) {
        console.error(`❌ Failed to read profile for uid=${uid}:`, e);
        userProfile = {
          id: uid,
          displayName: 'Anonymous',
          avatar:
            'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
          isPro: false,
          robloxUsernameVerified: false,
          lastGameWinAt: null,
          isAdmin: false,
        };
      }
    }

    await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(onlineUsersDocRef);

      if (!snap.exists) {
        tx.set(onlineUsersDocRef, { users: {} }, { merge: true });
      }

      // ✅ update/delete users[uid] safely even if uid contains "."
      const userField = new FieldPath('users', uid);

      if (afterOnline) {
        tx.update(onlineUsersDocRef, userField, userProfile);
      } else {
        tx.update(onlineUsersDocRef, userField, FieldValue.delete());
      }

      // Update timestamp
      tx.update(onlineUsersDocRef, {
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    console.log(`✅ Synced online status for uid=${uid}`);
    return null;
  });
