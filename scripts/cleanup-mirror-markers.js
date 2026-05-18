/**
 * cleanup-mirror-markers.js — one-shot cleanup of stale
 * `_mirroredFromSupabase: true` markers on RTDB chat_meta_data rows.
 *
 * Why: the 2-day bridge originally used a persistent RTDB marker for
 * loop prevention, which leaked across OLD-app writes and silently:
 *   - froze 76+ NULL Supabase inbox rows (broken inbox in NEW app)
 *   - suppressed push notifications for OLD-app sends to chats whose
 *     row had ever been touched by mirrorChatMetaToRtdb
 *
 * The new bridge design (diff-based dedup in mirrorChatMetaToSupabase,
 * legacy push disabled) doesn't write the marker anymore. This script
 * cleans up the existing markers so subsequent OLD-app writes mirror
 * correctly to Supabase and OLD-app users start seeing fresh push
 * notifications again.
 *
 * Safe to re-run; idempotent. Reads the whole /chat_meta_data subtree
 * once, then issues one batched multi-path update with all the marker
 * removals. Skips rows that don't have the marker set.
 *
 * Run:
 *   KEY=$(firebase functions:secrets:access SUPABASE_SERVICE_ROLE_KEY --project adoptme-7b50c | tail -1)
 *   NODE_PATH=functions/node_modules \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   node scripts/cleanup-mirror-markers.js
 *
 * If you don't have a service-account JSON locally, run from within the
 * functions/ folder with `firebase login` already done — admin SDK will
 * pick up your gcloud credentials.
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    databaseURL: 'https://adoptme-7b50c-default-rtdb.firebaseio.com',
  });
}

(async () => {
  const ref = admin.database().ref('/chat_meta_data');
  console.log('[cleanup] reading /chat_meta_data subtree…');
  const snap = await ref.once('value');
  if (!snap.exists()) {
    console.log('[cleanup] no /chat_meta_data — nothing to do.');
    process.exit(0);
  }

  let ownersScanned = 0;
  let partnersScanned = 0;
  let markersFound = 0;
  const updates = {};

  snap.forEach((ownerSnap) => {
    ownersScanned++;
    ownerSnap.forEach((partnerSnap) => {
      partnersScanned++;
      const v = partnerSnap.val();
      if (v && v._mirroredFromSupabase === true) {
        updates[`${ownerSnap.key}/${partnerSnap.key}/_mirroredFromSupabase`] = null;
        markersFound++;
      }
    });
  });

  console.log(`[cleanup] scanned: ${ownersScanned} owners, ${partnersScanned} partner rows`);
  console.log(`[cleanup] markers to remove: ${markersFound}`);

  if (markersFound === 0) {
    console.log('[cleanup] nothing to remove — done.');
    process.exit(0);
  }

  // Multi-path update — atomic and avoids 1 write per leaf.
  console.log('[cleanup] applying batched removal…');
  await ref.update(updates);

  console.log('[cleanup] done. Verify with: firebase database:get /chat_meta_data/<some-uid>/<partner>/_mirroredFromSupabase --project adoptme-7b50c   (expect: null)');
  process.exit(0);
})().catch((err) => {
  console.error('[cleanup] failed:', err);
  process.exit(1);
});
