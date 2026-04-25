const { onValueWritten } = require('firebase-functions/v2/database');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');

initializeApp();

const rtdb = getDatabase();

const MOD_USER_IDS = new Set([
    '7VEWl5lIo8PjtzZcxC0J9BUzWWo1', // 0Gcake
    '925AXUhKYzf8mR6GQtz1i2OYyk33', // Carrotofc
    'DNvBQC5ySWP8QiJNGpIvqd9DSWB2', // Tee♡
    'VUx6vczP8cZLGAIngUPhByYt6Xh2', // truly divine
    'gHyKf7h7qmVFfCYSKA9F0Mr4hVj2', // mindfusion
]);

exports.syncModUsersToRTDB = onValueWritten(
    {
        ref: 'users/{uid}',
        region: 'us-central1',
        instance: 'adoptme-7b50c-default-rtdb',
    },
    async (event) => {
        const uid = event.params.uid;
        if (!MOD_USER_IDS.has(uid)) return;

        const data = event.data.after.val();

        if (!data) {
            // User deleted → remove from mod node
            await rtdb.ref(`mod/${uid}`).remove();
            console.log(`🗑️ Removed: mod/${uid}`);
            return;
        }

        // Mirror to RTDB: mod/{uid}
        await rtdb.ref(`mod/${uid}`).set({
            ...data,
            uid,
            syncedAt: Date.now(),
        });

        console.log(`✅ Synced to RTDB: mod/${uid}`);
    }
);
