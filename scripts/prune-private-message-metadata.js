#!/usr/bin/env node
/**
 * One-off: strip retired metadata leaves from /private_messages/{chatKey}.
 *
 * WHY (COST_OPTIMIZATION_2026-09.md F3)
 * -------------------------------------
 * /private_messages has ~480,000 chat keys, growing ~400/day. Two of the leaves
 * under them are dead weight:
 *
 *   lastRead  — retired when read receipts moved to Supabase
 *               (supabase/017_chat_lastread.sql). The old RTDB onValue listener
 *               is gone; ChatScreen/utils.js:927 documents the migration.
 *   unread    — no reader anywhere in the app, the functions, or the web project.
 *
 * Removing them lets ~80,000 chat keys disappear entirely (the ones that hold
 * nothing else), and shrinks most of the rest. That cuts RTDB storage and, more
 * usefully, shortens the shallow key listing that cleanupOldPrivateChats has to
 * page through every night.
 *
 * ⚠️ WHAT THIS DELIBERATELY DOES **NOT** TOUCH
 * --------------------------------------------
 *   messages  — obviously live.
 *   trade     — LIVE. PrivateChat.jsx:542 reads it back with get(tradeRef) to
 *   post        restore the attached trade/post when a chat is opened without
 *               an item in props. An earlier draft of the audit called these
 *               "metadata-only shells" and proposed deleting them wholesale.
 *               That was wrong and would have silently dropped trade/post
 *               context from existing conversations.
 *
 * SAFETY
 * ------
 * - DRY RUN BY DEFAULT. Pass --apply to actually write.
 * - Only ever nulls the two leaf paths named in DEAD_LEAVES.
 * - Shallow reads only — never downloads message bodies.
 * - Resumable cursor file, so an interrupted run continues.
 *
 * USAGE
 * -----
 *   export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
 *   node scripts/prune-private-message-metadata.js            # dry run
 *   node scripts/prune-private-message-metadata.js --apply    # for real
 *   node scripts/prune-private-message-metadata.js --apply --resume
 *
 * Take an RTDB backup first (console → Realtime Database → ⋮ → Export JSON),
 * or at minimum run the dry run and read the summary before applying.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const admin = require('firebase-admin');

const APPLY = process.argv.includes('--apply');
const RESUME = process.argv.includes('--resume');

const DEAD_LEAVES = ['lastRead', 'unread'];
const LIVE_LEAVES = ['messages', 'trade', 'post'];

const PROBE_CONCURRENCY = 40;
const WRITE_BATCH = 400;  // leaf paths per multi-path update
const CURSOR_FILE = path.join(__dirname, '.prune-private-metadata.cursor');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL
      || 'https://adoptme-7b50c-default-rtdb.firebaseio.com',
  });
}

const db = admin.database();

function shallowRead(dbUrl, nodePath, token) {
  return new Promise((resolve, reject) => {
    const url = `${dbUrl}/${nodePath}.json?shallow=true&access_token=${token}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed && typeof parsed === 'object' ? Object.keys(parsed) : []);
        } catch {
          resolve([]);
        }
      });
    }).on('error', reject);
  });
}

async function mapLimit(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

(async () => {
  const started = Date.now();
  const dbUrl = admin.app().options.databaseURL;
  const { access_token: token } = await admin.app().options.credential.getAccessToken();

  console.log(APPLY ? '▸ APPLY MODE — writes are real.' : '▸ DRY RUN — nothing will be written. Pass --apply to write.');
  console.log(`▸ Dead leaves to remove: ${DEAD_LEAVES.join(', ')}`);
  console.log(`▸ Preserved: ${LIVE_LEAVES.join(', ')}`);
  console.log('▸ Listing /private_messages keys (shallow)…');

  const allKeys = await shallowRead(dbUrl, 'private_messages', token);
  console.log(`▸ ${allKeys.length.toLocaleString()} chat keys.`);

  let startIndex = 0;
  if (RESUME && fs.existsSync(CURSOR_FILE)) {
    startIndex = Number(fs.readFileSync(CURSOR_FILE, 'utf8')) || 0;
    console.log(`▸ Resuming from index ${startIndex.toLocaleString()}.`);
  }

  const keys = allKeys.slice(startIndex);
  let pending = {};
  let probed = 0;
  let leavesRemoved = 0;
  let keysVanishing = 0;
  let keysShrinking = 0;

  const flush = async () => {
    const n = Object.keys(pending).length;
    if (n === 0) return;
    if (APPLY) await db.ref().update(pending);
    leavesRemoved += n;
    pending = {};
  };

  for (let off = 0; off < keys.length; off += 2000) {
    const chunk = keys.slice(off, off + 2000);

    await mapLimit(chunk, PROBE_CONCURRENCY, async (chatKey) => {
      try {
        const children = await shallowRead(dbUrl, `private_messages/${chatKey}`, token);
        probed++;
        const dead = children.filter((c) => DEAD_LEAVES.includes(c));
        if (dead.length === 0) return;

        const hasLive = children.some((c) => LIVE_LEAVES.includes(c));
        if (hasLive) keysShrinking++; else keysVanishing++;

        for (const leaf of dead) {
          pending[`private_messages/${chatKey}/${leaf}`] = null;
        }
      } catch (e) {
        console.error(`  ! probe failed for ${chatKey}: ${e.message}`);
      }
    });

    if (Object.keys(pending).length >= WRITE_BATCH) await flush();

    fs.writeFileSync(CURSOR_FILE, String(startIndex + off + chunk.length));
    const done = startIndex + off + chunk.length;
    process.stdout.write(
      `\r  probed ${done.toLocaleString()}/${allKeys.length.toLocaleString()}`
      + `  leaves:${leavesRemoved.toLocaleString()}  vanishing:${keysVanishing.toLocaleString()}`
      + `  shrinking:${keysShrinking.toLocaleString()}   `,
    );
  }

  await flush();
  process.stdout.write('\n');

  console.log(`▸ Probed ${probed.toLocaleString()} chats in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min.`);
  console.log(`▸ ${APPLY ? 'Removed' : 'Would remove'} ${leavesRemoved.toLocaleString()} dead leaves.`);
  console.log(`▸ ${keysVanishing.toLocaleString()} chat keys ${APPLY ? 'disappeared' : 'would disappear'} entirely.`);
  console.log(`▸ ${keysShrinking.toLocaleString()} chat keys shrank but kept live data.`);
  if (APPLY) {
    fs.rmSync(CURSOR_FILE, { force: true });
    console.log('▸ Verify: firebase database:get /private_messages --shallow --project adoptme-7b50c | wc -c');
  }
  process.exit(0);
})().catch((err) => {
  console.error('✖ prune failed:', err);
  process.exit(1);
});
