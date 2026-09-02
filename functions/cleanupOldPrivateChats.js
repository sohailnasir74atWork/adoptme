/**
 * Cloud Function: Cleanup old private chat messages (older than 20 days)
 *
 * Runs daily at 4:00 AM UTC. Deletes messages older than 20 days from
 * private chat conversations in Realtime Database.
 *
 * Only deletes messages — metadata (chat_meta_data), lastRead, trade,
 * and post nodes are preserved so the inbox stays intact.
 *
 * Path: private_messages/{chatKey}/messages/{messageId}
 * messageId = Date.now() (timestamp in ms), so keys are numeric strings.
 *
 * ---------------------------------------------------------------------------
 * REWRITTEN 2026-09-02 — the previous version never deleted anything.
 * (COST_OPTIMIZATION_2026-09.md F3)
 *
 * It looped *sequentially* over every chat key, one `once('value')` per key.
 * At ~480,000 keys that cannot finish inside the 540s cap, so production logs
 * showed `finished with status: 'timeout'` every single night, with zero
 * deletions, always dying in the same alphabetical prefix — the tail was never
 * cleaned and retention was not actually enforced:
 *
 *     09-02 04:00  Found 479970 private chat conversations to check.
 *     09-02 04:09  took 538405 ms, finished with status: 'timeout'
 *
 * Sampling 60 keys evenly showed 40/60 have NO `messages` child at all — only
 * leftover lastRead/unread/trade/post metadata. So ~2/3 of that sequential
 * grind was against nodes with nothing to delete.
 *
 * Three changes:
 *   1. RESUMABLE CURSOR — the last processed key is persisted to
 *      /cleanup_state/privateChats. Each run starts where the last one
 *      stopped and wraps at the end, so every chat is reached within a few
 *      days instead of never.
 *   2. PARALLELISM — chats are processed with bounded concurrency instead of
 *      one at a time.
 *   3. SHELL SKIP — a shallow REST probe tells us which keys even have a
 *      `messages` child, so the ~2/3 that are pure metadata cost nothing.
 *
 * Deployment:
 * firebase deploy --only functions:cleanupOldPrivateChats --project adoptme-7b50c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const https = require('https');

if (!admin.apps.length) {
  admin.initializeApp();
}

const TWENTY_DAYS_MS = 20 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;          // message keys deleted per multi-path write
const CHAT_CONCURRENCY = 25;     // chats processed in parallel
const TIME_BUDGET_MS = 480 * 1000; // stop at 480s, leaving 60s to save the cursor
const CURSOR_PATH = 'cleanup_state/privateChats';

/**
 * Shallow read via REST API — fetches only child keys under a path, without
 * downloading any child data. The Admin SDK has no shallow mode.
 */
function shallowRead(dbUrl, path, token) {
  return new Promise((resolve, reject) => {
    const url = `${dbUrl}/${path}.json?shallow=true`
      + (token ? `&access_token=${token}` : '');
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed && typeof parsed === 'object' ? Object.keys(parsed) : []);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', reject);
  });
}

/** Map over items with bounded concurrency, stopping early if `shouldStop()`. */
async function mapLimit(items, limit, fn, shouldStop) {
  let i = 0;
  let processed = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      if (shouldStop && shouldStop()) return;
      const item = items[i++];
      await fn(item);
      processed++;
    }
  }));
  return processed;
}

/** Delete every message key <= cutoff for one chat. Returns count deleted. */
async function cleanChat(db, chatKey, cutoffKey) {
  const messagesRef = db.ref(`private_messages/${chatKey}/messages`);
  let deleted = 0;

  for (;;) {
    const snapshot = await messagesRef
      .orderByKey()
      .endAt(cutoffKey)
      .limitToFirst(BATCH_SIZE)
      .once('value');

    if (!snapshot.exists() || snapshot.numChildren() === 0) break;

    const updates = {};
    snapshot.forEach((child) => {
      updates[`private_messages/${chatKey}/messages/${child.key}`] = null;
    });

    const count = Object.keys(updates).length;
    await db.ref().update(updates);
    deleted += count;

    if (count < BATCH_SIZE) break;
  }

  return deleted;
}

exports.cleanupOldPrivateChats = functions
  .runWith({ memory: '512MB', timeoutSeconds: 540 })
  .pubsub.schedule('every day 04:00')
  .timeZone('UTC')
  .onRun(async () => {
    const startedAt = Date.now();
    const outOfTime = () => (Date.now() - startedAt) > TIME_BUDGET_MS;

    const cutoffTimestamp = Date.now() - TWENTY_DAYS_MS;
    const cutoffKey = String(cutoffTimestamp);
    const db = admin.database();
    const dbUrl = admin.app().options.databaseURL;

    let totalDeleted = 0;
    let chatsWithMessages = 0;
    let chatsProcessed = 0;

    console.log(`🧹 Starting private chat cleanup. Cutoff: ${new Date(cutoffTimestamp).toISOString()}`);

    try {
      const { access_token: token } = await admin.app().options.credential.getAccessToken();

      const allKeys = await shallowRead(dbUrl, 'private_messages', token);
      if (allKeys.length === 0) {
        console.log('ℹ️ No private messages found.');
        return null;
      }

      // Resume where the previous run stopped, so the whole node is covered
      // over successive days rather than the same prefix forever.
      const cursorSnap = await db.ref(CURSOR_PATH).once('value');
      const lastKey = cursorSnap.exists() ? cursorSnap.val().lastKey : null;
      const startIndex = lastKey ? Math.max(0, allKeys.indexOf(lastKey) + 1) : 0;

      // Wrap around when the cursor reaches the end.
      const ordered = startIndex > 0
        ? allKeys.slice(startIndex).concat(allKeys.slice(0, startIndex))
        : allKeys;

      console.log(`📋 ${allKeys.length} chats total; resuming at index ${startIndex}.`);

      // Only chats that actually have a `messages` child are worth touching —
      // roughly 1/3 of them. This probe is one shallow REST call per chat but
      // returns no data, and it lets us skip the expensive query entirely for
      // the metadata-only shells.
      let lastProcessedKey = lastKey;

      await mapLimit(ordered, CHAT_CONCURRENCY, async (chatKey) => {
        try {
          const children = await shallowRead(dbUrl, `private_messages/${chatKey}`, token);
          if (!children.includes('messages')) {
            lastProcessedKey = chatKey;
            return;
          }

          chatsWithMessages++;
          const deleted = await cleanChat(db, chatKey, cutoffKey);
          if (deleted > 0) {
            totalDeleted += deleted;
            console.log(`✅ ${chatKey}: deleted ${deleted} old messages`);
          }
          lastProcessedKey = chatKey;
        } catch (error) {
          console.error(`❌ Error cleaning chat ${chatKey}:`, error.message);
          lastProcessedKey = chatKey;
        } finally {
          chatsProcessed++;
        }
      }, outOfTime);

      // Persist the cursor so tomorrow's run continues from here.
      await db.ref(CURSOR_PATH).set({
        lastKey: lastProcessedKey,
        updatedAt: Date.now(),
        chatsProcessed,
        totalKeys: allKeys.length,
      });

      const covered = ((chatsProcessed / allKeys.length) * 100).toFixed(1);
      console.log(
        `🧹 Cleanup complete. Processed ${chatsProcessed}/${allKeys.length} chats (${covered}%), `
        + `${chatsWithMessages} had messages, deleted ${totalDeleted} in `
        + `${((Date.now() - startedAt) / 1000).toFixed(0)}s. `
        + `Cursor → ${lastProcessedKey}`,
      );
    } catch (error) {
      console.error('❌ Error in cleanupOldPrivateChats:', error);
    }

    return null;
  });
