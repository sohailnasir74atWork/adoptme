/**
 * Cloud Functions: new-account posting gate (2026-10-28).
 *
 * WHY
 * A banned user kept coming back on fresh email/password accounts made on
 * the website and posting doxxing in public chat and Feed within minutes of
 * sign-up. Device bans never reach those accounts: the device id
 * (users/{uid}/deviceId) is stamped only by the app, so mirrorBanToDevice has
 * nothing to write. Ops/bugs/LOG.md 2026-10-28 "Ban evasion through the
 * website".
 *
 * RULE
 * An account created after this ships cannot post in public chat or Feed
 * until it has signed in once on the app (device stamped — and so becomes
 * device-bannable) or is WAIT_MS old. Accounts that existed before have no
 * gate record and are unaffected.
 *
 * STATE (written only here, never by clients)
 *   Supabase  public.posting_gate (uid, created_at, restricted_until, app_seen_at)
 *             — read by the enforce_new_account_gate trigger on public.messages
 *             (supabase/059_new_account_posting_gate.sql)
 *   Firestore posting_gate/{uid} { createdAt, restrictedUntil, appSeen }
 *             — read by firestore.rules postingGateOk() on designPosts + comments
 *
 *   initPostingGate         auth onCreate: record the new account, app not seen
 *   markPostingGateAppSeen  users/{uid}/deviceId written: mark app seen
 *
 * Either may run first (the app stamps the device right after sign-in, while
 * onCreate is still in flight): onCreate only inserts when absent and reads
 * the device stamp itself; the app-seen pass upserts.
 *
 * Deployment:
 *   ./functions-deploy/deploy.sh initPostingGate markPostingGateAppSeen
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (!admin.apps.length) {
  admin.initializeApp();
}

// Keep in sync with the hint in supabase/059 and the website message
// (adoptme-web src/lib/firebase/postingGate.ts).
const WAIT_MS = 72 * 60 * 60 * 1000;
const GATE_COLLECTION = 'posting_gate';
const ALREADY_EXISTS = 6; // gRPC code Firestore create() throws on an existing doc

function authCreatedMs(user) {
  const ms = Date.parse(user?.metadata?.creationTime || '');
  return Number.isFinite(ms) && ms > 0 ? ms : Date.now();
}

async function hasAppDevice(uid) {
  const snap = await admin.database().ref(`users/${uid}/deviceId`).once('value');
  const v = snap.val();
  return typeof v === 'string' && v.length > 0;
}

function gateRow(uid, createdMs, appSeenMs) {
  return {
    uid,
    created_at: new Date(createdMs).toISOString(),
    restricted_until: new Date(createdMs + WAIT_MS).toISOString(),
    app_seen_at: appSeenMs ? new Date(appSeenMs).toISOString() : null,
    updated_at: new Date().toISOString(),
  };
}

function gateDoc(createdMs, appSeen) {
  return {
    createdAt: admin.firestore.Timestamp.fromMillis(createdMs),
    restrictedUntil: admin.firestore.Timestamp.fromMillis(createdMs + WAIT_MS),
    appSeen: appSeen === true,
  };
}

exports.initPostingGate = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '128MB',
    timeoutSeconds: 30,
  })
  .auth.user()
  .onCreate(async (user) => {
    const uid = user.uid;
    const createdMs = authCreatedMs(user);
    let appSeen = false;
    try {
      appSeen = await hasAppDevice(uid);
    } catch (_) { /* treat as not seen; the app-seen pass corrects it */ }
    const nowMs = Date.now();

    // Independent writes: a failure in one store must not skip the other.
    const results = await Promise.allSettled([
      getSupabaseAdmin()
        .from('posting_gate')
        .upsert(gateRow(uid, createdMs, appSeen ? nowMs : null), { onConflict: 'uid', ignoreDuplicates: true })
        .then(({ error }) => { if (error) throw error; }),
      admin.firestore().collection(GATE_COLLECTION).doc(uid)
        .create(gateDoc(createdMs, appSeen))
        .catch((e) => { if (e?.code !== ALREADY_EXISTS) throw e; }),
    ]);
    const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason));
    if (failed.length) {
      functions.logger.error('[postingGate] init failed', { uid, failed });
    }
    return null;
  });

exports.markPostingGateAppSeen = functions
  .runWith({
    secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    memory: '128MB',
    timeoutSeconds: 30,
  })
  .database.ref('/users/{uid}/deviceId')
  .onWrite(async (change, context) => {
    const v = change.after.val();
    if (typeof v !== 'string' || !v) return null;
    const uid = context.params.uid;

    let user;
    try {
      user = await admin.auth().getUser(uid);
    } catch (_) {
      return null; // deleted account or stray node
    }
    const createdMs = authCreatedMs(user);
    // Past the wait already: nothing is gated, skip the writes (this is
    // every pre-existing account whose device changes).
    if (Date.now() >= createdMs + WAIT_MS) return null;
    const nowMs = Date.now();

    const results = await Promise.allSettled([
      getSupabaseAdmin()
        .from('posting_gate')
        .upsert(gateRow(uid, createdMs, nowMs), { onConflict: 'uid' })
        .then(({ error }) => { if (error) throw error; }),
      admin.firestore().collection(GATE_COLLECTION).doc(uid)
        .set(gateDoc(createdMs, true), { merge: true }),
    ]);
    const failed = results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason));
    if (failed.length) {
      functions.logger.error('[postingGate] app-seen failed', { uid, failed });
    }
    return null;
  });

exports.WAIT_MS = WAIT_MS;
