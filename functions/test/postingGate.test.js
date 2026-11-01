/* eslint-disable no-console */
/**
 * Emulator suite for functions/postingGate.js and functions/banDisablesAccount.js.
 *
 * From the adoptme-jan7 directory:
 *   firebase emulators:exec --only auth,database,firestore --project demo-adoptme \
 *     'node functions/test/postingGate.test.js'
 *
 * Runs the handlers in-process (firebase-functions-test wrap) against the
 * emulators. Supabase is replaced by a recorder, so this checks what would be
 * written there, not the SQL trigger (that one is dry-run on Postgres).
 */
const assert = require('assert');
const path = require('path');

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-adoptme';
const DB_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: PROJECT, databaseURL: `http://${DB_HOST}?ns=${PROJECT}` });
process.env.GCLOUD_PROJECT = PROJECT;

// Supabase recorder in place of the service-role client.
const upserts = [];
require.cache[path.join(__dirname, '..', '_supabaseAdmin.js')] = {
  id: '_supabaseAdmin', loaded: true,
  exports: {
    getSupabaseAdmin: () => ({
      from: (table) => ({
        upsert: (row, opts) => { upserts.push({ table, row, opts }); return Promise.resolve({ error: null }); },
      }),
    }),
  },
};

const fft = require('firebase-functions-test')({ projectId: PROJECT, databaseURL: `http://${DB_HOST}?ns=${PROJECT}` });
const admin = require('firebase-admin');
const gate = require('../postingGate');
const ban = require('../banDisablesAccount');

const H = 3600 * 1000;
const db = () => admin.database();
const fs = () => admin.firestore();

const initGate = fft.wrap(gate.initPostingGate);
const markSeen = fft.wrap(gate.markPostingGateAppSeen);
const banFn = fft.wrap(ban.banDisablesAccount);

async function importUser(uid, createdMs, extra = {}) {
  const res = await admin.auth().importUsers([{
    uid, email: `${uid.toLowerCase()}@example.com`, emailVerified: true,
    metadata: { creationTime: new Date(createdMs).toUTCString(), lastSignInTime: new Date(createdMs).toUTCString() },
    ...extra,
  }]);
  assert.strictEqual(res.failureCount, 0, JSON.stringify(res.errors));
  return admin.auth().getUser(uid);
}

const snap = (val, p) => fft.database.makeDataSnapshot(val, p);
const change = (before, after, p) => fft.makeChange(snap(before, p), snap(after, p));
const banKey = (email) => email.toLowerCase().replace(/\./g, '(dot)');

const results = [];
async function t(name, fn) {
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
}

(async () => {
  const now = Date.now();

  // ── postingGate ──
  await t('new web account: gate created, app not seen, 72 h window', async () => {
    const u = await importUser('webNew0001', now);
    upserts.length = 0;
    await initGate(u);
    const d = (await fs().doc('posting_gate/webNew0001').get()).data();
    assert.strictEqual(d.appSeen, false);
    assert.strictEqual(d.restrictedUntil.toMillis() - d.createdAt.toMillis(), 72 * H);
    assert.strictEqual(upserts.length, 1);
    assert.strictEqual(upserts[0].table, 'posting_gate');
    assert.strictEqual(upserts[0].row.app_seen_at, null);
    assert.strictEqual(upserts[0].opts.ignoreDuplicates, true);
  });

  await t('app stamps device: gate opens in both stores', async () => {
    upserts.length = 0;
    await db().ref('users/webNew0001/deviceId').set('abcdef0123456789');
    await markSeen(change(null, 'abcdef0123456789', 'users/webNew0001/deviceId'), { params: { uid: 'webNew0001' } });
    assert.strictEqual((await fs().doc('posting_gate/webNew0001').get()).data().appSeen, true);
    assert.strictEqual(upserts.length, 1);
    assert.ok(upserts[0].row.app_seen_at);
    assert.notStrictEqual(upserts[0].opts.ignoreDuplicates, true);
  });

  await t('onCreate after the app already stamped: born open', async () => {
    const u = await importUser('appNew0001', now);
    await db().ref('users/appNew0001/deviceId').set('fedcba9876543210');
    upserts.length = 0;
    await initGate(u);
    assert.strictEqual((await fs().doc('posting_gate/appNew0001').get()).data().appSeen, true);
    assert.ok(upserts[0].row.app_seen_at);
  });

  await t('onCreate after app-seen pass: does not close the gate again', async () => {
    const u = await importUser('raceUser01', now);
    await markSeen(change(null, 'race0123456789ab', 'users/raceUser01/deviceId'), { params: { uid: 'raceUser01' } });
    await initGate(u); // RTDB has no stamp here, but the doc already says seen
    assert.strictEqual((await fs().doc('posting_gate/raceUser01').get()).data().appSeen, true);
  });

  await t('existing account (> 72 h old) changing device: no gate written', async () => {
    await importUser('oldUser001', now - 30 * 24 * H);
    upserts.length = 0;
    await markSeen(change('old', 'new0123456789abc', 'users/oldUser001/deviceId'), { params: { uid: 'oldUser001' } });
    assert.strictEqual((await fs().doc('posting_gate/oldUser001').get()).exists, false);
    assert.strictEqual(upserts.length, 0);
  });

  await t('device cleared: no-op', async () => {
    upserts.length = 0;
    await markSeen(change('abc', null, 'users/webNew0001/deviceId'), { params: { uid: 'webNew0001' } });
    assert.strictEqual(upserts.length, 0);
  });

  // ── banDisablesAccount ──
  const ADMIN_CTX = (key) => ({ params: { emailKey: key }, authType: 'ADMIN' });
  const USER_CTX = (key, uid) => ({ params: { emailKey: key }, authType: 'USER', auth: { uid, token: {} } });
  const PERM = (userId) => ({ bannedUntil: 'permanent', strikeCount: 3, userId });

  await importUser('modUser001', now - 100 * 24 * H);
  await db().ref('users/modUser001/isModerator').set(true);
  await importUser('randUser01', now - 100 * 24 * H);

  await t('permanent ban by staff disables + marks', async () => {
    const u = await importUser('banned0001', now);
    const key = banKey(u.email);
    await banFn(change(null, PERM('banned0001'), `banned_users_by_email/${key}`), USER_CTX(key, 'modUser001'));
    assert.strictEqual((await admin.auth().getUser('banned0001')).disabled, true);
    assert.ok((await db().ref('ban_disabled_accounts/banned0001').get()).exists());
  });

  await t('unban re-enables + clears marker', async () => {
    const key = banKey('banned0001@example.com');
    await banFn(change(PERM('banned0001'), null, `banned_users_by_email/${key}`), ADMIN_CTX(key));
    assert.strictEqual((await admin.auth().getUser('banned0001')).disabled, false);
    assert.strictEqual((await db().ref('ban_disabled_accounts/banned0001').get()).exists(), false);
  });

  await t('ban written by a non-staff user is ignored', async () => {
    const u = await importUser('victim0001', now - 100 * 24 * H);
    const key = banKey(u.email);
    await banFn(change(null, PERM('victim0001'), `banned_users_by_email/${key}`), USER_CTX(key, 'randUser01'));
    assert.strictEqual((await admin.auth().getUser('victim0001')).disabled, false);
  });

  await t('staff account is never disabled', async () => {
    const key = banKey('modUser001@example.com');
    await banFn(change(null, PERM('modUser001'), `banned_users_by_email/${key}`), ADMIN_CTX(key));
    assert.strictEqual((await admin.auth().getUser('modUser001')).disabled, false);
  });

  await t('temporary strike leaves the account enabled', async () => {
    const u = await importUser('strike0001', now - 100 * 24 * H);
    const key = banKey(u.email);
    await banFn(change(null, { bannedUntil: now + 12 * H, strikeCount: 1, userId: 'strike0001' }, `banned_users_by_email/${key}`), ADMIN_CTX(key));
    assert.strictEqual((await admin.auth().getUser('strike0001')).disabled, false);
  });

  await t('ban without userId resolves the account by email', async () => {
    const u = await importUser('noUid00001', now);
    const key = banKey(u.email);
    await banFn(change(null, { bannedUntil: 'permanent', strikeCount: 3 }, `banned_users_by_email/${key}`), ADMIN_CTX(key));
    assert.strictEqual((await admin.auth().getUser('noUid00001')).disabled, true);
  });

  await t('unban does not re-enable an account disabled for another reason', async () => {
    const u = await importUser('otherDis01', now, { disabled: true });
    const key = banKey(u.email);
    await banFn(change(null, PERM('otherDis01'), `banned_users_by_email/${key}`), ADMIN_CTX(key));
    assert.strictEqual((await db().ref('ban_disabled_accounts/otherDis01').get()).exists(), false);
    await banFn(change(PERM('otherDis01'), null, `banned_users_by_email/${key}`), ADMIN_CTX(key));
    assert.strictEqual((await admin.auth().getUser('otherDis01')).disabled, true);
  });

  await t('unban of a legacy mixed-case node keeps the account off while the lowercase ban stands', async () => {
    const u = await importUser('legacy0001', now);
    const key = banKey(u.email);
    await db().ref(`banned_users_by_email/${key}`).set(PERM('legacy0001'));
    await banFn(change(null, PERM('legacy0001'), `banned_users_by_email/${key}`), ADMIN_CTX(key));
    const raw = key.replace('legacy', 'Legacy');
    await banFn(change(PERM('legacy0001'), null, `banned_users_by_email/${raw}`), { params: { emailKey: raw }, authType: 'ADMIN' });
    assert.strictEqual((await admin.auth().getUser('legacy0001')).disabled, true);
  });

  for (const r of results) console.log(r.join('  '));
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`${results.length - failed}/${results.length} passed`);
  fft.cleanup();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
