#!/usr/bin/env node
/**
 * One-off backfill: create a `user_roles` row for every RTDB user.
 *
 * WHY (COST_OPTIMIZATION_2026-09.md F4)
 * -------------------------------------
 * mirrorUsersToSupabase only wrote a user_roles row when one of the six role
 * flags *changed*. An ordinary user never has any of them set, so the row was
 * never created. getRoles() therefore returned null on essentially every
 * client, and BottomDrawer's `!rolesRow` path fell back to six RTDB leaf reads
 * on every profile-drawer open — ~172k reads/day, and the six role paths were
 * the hottest reads in the profiler by ~7x over isPro.
 *
 * Creating the row (all-false for ordinary users, real values for staff) makes
 * getRoles() return something, so the fallback stops firing. mirrorRoles now
 * also writes on account creation, so this only has to run once.
 *
 * SAFETY
 * ------
 * - Reads RTDB /users with a *shallow* key listing, then per-uid leaf reads —
 *   it never downloads the ~900MB full node.
 * - Upserts on `uid`, so it is idempotent and re-runnable.
 * - --dry-run prints what it would write and touches nothing.
 * - Writes in batches with a resumable cursor file, so an interrupted run
 *   picks up where it stopped instead of starting over.
 *
 * USAGE
 * -----
 *   export SUPABASE_URL=https://<ref>.supabase.co
 *   export SUPABASE_SERVICE_ROLE_KEY=<service role key>
 *   export GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json
 *
 *   node scripts/backfill-user-roles.js --dry-run     # inspect first
 *   node scripts/backfill-user-roles.js               # real run
 *   node scripts/backfill-user-roles.js --resume      # continue after a stop
 *
 * Expect ~161,881 users. At the default batch size this is roughly 20-40
 * minutes, dominated by the RTDB leaf reads.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const DRY_RUN = process.argv.includes('--dry-run');
const RESUME = process.argv.includes('--resume');

const BATCH_SIZE = 500;      // rows per Supabase upsert
const READ_CONCURRENCY = 40; // parallel RTDB leaf reads
const CURSOR_FILE = path.join(__dirname, '.backfill-user-roles.cursor');

const ROLE_FIELDS = ['admin', 'isModerator', 'isBabyMod', 'isTrusted', 'isCMSR', 'isHelper'];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DRY_RUN && (!SUPABASE_URL || !SUPABASE_KEY)) {
  console.error('✖ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or pass --dry-run).');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL
      || 'https://adoptme-7b50c-default-rtdb.firebaseio.com',
  });
}

const db = admin.database();
const supabase = DRY_RUN ? null : createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

/** Shallow key listing — keys only, never child data. */
function shallowKeys(dbUrl, nodePath) {
  return new Promise((resolve, reject) => {
    admin.app().options.credential.getAccessToken()
      .then(({ access_token: token }) => {
        const url = `${dbUrl}/${nodePath}.json?shallow=true&access_token=${token}`;
        https.get(url, (res) => {
          let data = '';
          res.on('data', (c) => { data += c; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed && typeof parsed === 'object' ? Object.keys(parsed) : []);
            } catch (e) {
              reject(new Error(`shallow read failed: ${data.slice(0, 200)}`));
            }
          });
        }).on('error', reject);
      })
      .catch(reject);
  });
}

/** Read only the six role leaves for one uid — never the whole record. */
async function readRoles(uid) {
  const snaps = await Promise.all(
    ROLE_FIELDS.map((f) => db.ref(`users/${uid}/${f}`).once('value').catch(() => null)),
  );
  const v = {};
  ROLE_FIELDS.forEach((f, i) => { v[f] = snaps[i] && snaps[i].exists() ? snaps[i].val() : null; });
  return {
    uid,
    is_admin: v.admin === true,
    is_moderator: v.isModerator === true,
    is_baby_mod: v.isBabyMod === true,
    is_trusted: v.isTrusted === true,
    is_cmsr: v.isCMSR === true,
    is_helper: v.isHelper === true,
    updated_at: new Date().toISOString(),
  };
}

/** Map over items with bounded concurrency. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

(async () => {
  const started = Date.now();
  const dbUrl = admin.app().options.databaseURL;

  console.log(`▸ Listing /users keys (shallow)…`);
  const allUids = await shallowKeys(dbUrl, 'users');
  console.log(`▸ ${allUids.length.toLocaleString()} users found.`);

  let startIndex = 0;
  if (RESUME && fs.existsSync(CURSOR_FILE)) {
    startIndex = Number(fs.readFileSync(CURSOR_FILE, 'utf8')) || 0;
    console.log(`▸ Resuming from index ${startIndex.toLocaleString()}.`);
  }

  const uids = allUids.slice(startIndex);
  let written = 0;
  let staff = 0;

  for (let off = 0; off < uids.length; off += BATCH_SIZE) {
    const chunk = uids.slice(off, off + BATCH_SIZE);
    const rows = await mapLimit(chunk, READ_CONCURRENCY, readRoles);

    staff += rows.filter((r) => r.is_admin || r.is_moderator || r.is_baby_mod
      || r.is_trusted || r.is_cmsr || r.is_helper).length;

    if (DRY_RUN) {
      if (off === 0) {
        console.log('▸ DRY RUN — sample of the first 3 rows that would be upserted:');
        console.log(JSON.stringify(rows.slice(0, 3), null, 2));
      }
    } else {
      const { error } = await supabase.from('user_roles').upsert(rows, { onConflict: 'uid' });
      if (error) {
        console.error(`✖ upsert failed at index ${startIndex + off}: ${error.message}`);
        console.error('  Re-run with --resume to continue from here.');
        fs.writeFileSync(CURSOR_FILE, String(startIndex + off));
        process.exit(1);
      }
    }

    written += rows.length;
    fs.writeFileSync(CURSOR_FILE, String(startIndex + off + chunk.length));

    const done = startIndex + off + chunk.length;
    const pct = ((done / allUids.length) * 100).toFixed(1);
    const rate = written / ((Date.now() - started) / 1000);
    process.stdout.write(`\r  ${done.toLocaleString()}/${allUids.length.toLocaleString()} (${pct}%)  ${rate.toFixed(0)}/s  staff found: ${staff}   `);
  }

  process.stdout.write('\n');
  console.log(`▸ ${DRY_RUN ? 'Would have written' : 'Wrote'} ${written.toLocaleString()} user_roles rows in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min.`);
  console.log(`▸ ${staff} users hold at least one role.`);
  if (!DRY_RUN) {
    fs.rmSync(CURSOR_FILE, { force: true });
    console.log('▸ Verify:  select count(*) from public.user_roles;');
  }
  process.exit(0);
})().catch((err) => {
  console.error('✖ backfill failed:', err);
  process.exit(1);
});
