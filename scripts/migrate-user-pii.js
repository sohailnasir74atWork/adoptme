/**
 * One-time migration (round 2, 2026-09): move every account's email and date
 * of birth off the publicly readable users/{uid} into users_private/{uid}
 * (owner + staff only), and — with --posts — strip the author email that old
 * builds stamped on Firestore designPosts.
 *
 * DRY RUN BY DEFAULT: prints what it would do and writes nothing.
 *
 * USAGE (from the repo root; serviceAccount.json at the root, as for the
 * other scripts)
 *   node scripts/migrate-user-pii.js                  # dry run over /users
 *   node scripts/migrate-user-pii.js --apply          # write
 *   node scripts/migrate-user-pii.js --posts          # dry run over designPosts
 *   node scripts/migrate-user-pii.js --posts --apply
 * Env: PAGE=100 (users per page), START_AT=<uid> (resume after a stop),
 *      MAX_PAGES=<n> (trial run), RTDB_URL (defaults to the project's default DB).
 *
 * WHAT IT DOES, PER users/{uid} RECORD
 *   email      canonical = the Firebase Auth email when the account has one
 *              (admin.auth().getUsers, 100 per call), else users/{uid}/email or
 *              decodedEmail decoded ('(dot)' / ',' → '.') and lowercased.
 *              Written to users_private/{uid}/email unless it is already there.
 *              An existing private email is replaced only by the auth email.
 *   DOB        users/{uid}/dateOfBirth ('YYYY-M-D' padded to 'YYYY-MM-DD') is
 *              copied only if users_private has none — the private one is
 *              write-once. Differences are counted, never overwritten.
 *   then       users/{uid}/email, decodedEmail and dateOfBirth are removed.
 * One multi-path update per page, so a record never ends up half-moved.
 * Records whose KEY is an encoded email: the ones that hold nothing but `_st`
 * (the server-clock probe builds from 2026-05 to 2026-09-02 wrote to
 * users/{encodedEmail}/_st — 190 of them on 2026-09-27) are DELETED, since the
 * key itself is the only data and it is an email. Any other email-keyed record
 * is REPORTED and left exactly as it is. The database rules now refuse new
 * email-keyed user records, and old builds catch that and fall back.
 * Emails are taken from Firebase Auth only — a value sitting in users/{uid} may
 * have been written by another user (the users rule allows that), so an
 * account with no Auth email just has the leaf removed.
 *
 * HOW IT READS
 * /users is ~160k records / ~0.9 GB, so it is never read whole: orderByKey +
 * limitToFirst pages, plus one users_private range query per page. A full run
 * downloads /users once (~0.9 GB of RTDB egress, ~$1).
 *
 * TRIGGERS IT CAUSES, PER MIGRATED USER
 *   mirrorUsersToSupabase (whole-node; ignores removals of these keys),
 *   mirrorUsersPrivateToSupabase (one Supabase upsert),
 *   privatizeUserPII-* (only if deployed; they return at once on a removal).
 * With --posts: privatizePostEmail does not fire (updates, not creates), but
 * notifyPostReaction (designPosts onUpdate) does, once per post, and returns.
 *
 * ORDER AT CUTOVER: deploy privatizeUserPII first, so nothing new lands on
 * users/{uid} while this runs; then run this with --apply. Idempotent — safe
 * to re-run, and a re-run is how to pick up anything written mid-run.
 */

const path = require('path');

// firebase-admin lives in functions/node_modules in this repo.
const requireAdmin = () => {
  try { return require('firebase-admin'); } catch (_) {
    return require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  }
};
const admin = requireAdmin();

const APPLY = process.argv.includes('--apply');
const POSTS = process.argv.includes('--posts');
const PAGE = parseInt(process.env.PAGE || '100', 10);
const MAX_PAGES = process.env.MAX_PAGES ? parseInt(process.env.MAX_PAGES, 10) : Infinity;
const START_AT = process.env.START_AT || null;

let serviceAccount;
try {
  serviceAccount = require(path.join(__dirname, '..', 'serviceAccount.json'));
} catch (e) {
  console.error('\n❌ serviceAccount.json not found at the repo root.\n');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.RTDB_URL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
});

const LEAVES = ['email', 'decodedEmail', 'dateOfBirth'];
const STRICT_DOB = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

const normalizeEmail = (v) => {
  if (typeof v !== 'string') return null;
  const e = v.trim().replace(/\(dot\)/g, '.').replace(/,/g, '.').toLowerCase();
  return e.includes('@') ? e : null;
};

const normalizeDob = (v) => {
  if (typeof v !== 'string' || !v.trim()) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : v.trim();
};

// Pre-uid legacy records use the (encoded) email as the key.
const isEmailKey = (key) => /@|\(dot\)|,/.test(key);

async function authEmails(uids) {
  const out = new Map();
  for (let i = 0; i < uids.length; i += 100) {
    const res = await admin.auth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    for (const u of res.users) {
      const e = normalizeEmail(u.email);
      if (e) out.set(u.uid, e);
    }
  }
  return out;
}

async function migrateUsers() {
  const db = admin.database();
  const t = {
    pages: 0, scanned: 0, withPii: 0,
    emailWritten: 0, emailFromAuth: 0, emailAlreadyPrivate: 0,
    emailCorrectedToAuth: 0, emailUnresolvable: 0,
    dobWritten: 0, dobAlreadyPrivate: 0, dobConflictKeptPrivate: 0, dobNonStandard: 0,
    leavesRemoved: 0, usersCleaned: 0, emailKeyed: 0, emailKeyedProbesDeleted: 0,
    emailLegacyOnlyDropped: 0,
  };
  const emailKeyedSample = [];

  console.log(`\n${APPLY ? '✍️  APPLY' : '🔎 DRY RUN'} — users/{uid} → users_private/{uid} (page=${PAGE}${START_AT ? `, from ${START_AT}` : ''})`);

  let lastKey = START_AT;
  let resumeInclusive = !!START_AT;
  while (t.pages < MAX_PAGES) {
    let q = db.ref('users').orderByKey();
    if (lastKey) q = q.startAt(lastKey);
    const snap = await q.limitToFirst(PAGE + (lastKey && !resumeInclusive ? 1 : 0)).once('value');
    const records = [];
    snap.forEach((child) => {
      if (lastKey && !resumeInclusive && child.key === lastKey) return;
      records.push([child.key, child.val()]);
    });
    resumeInclusive = false;
    if (records.length === 0) break;
    t.pages += 1;
    t.scanned += records.length;
    lastKey = records[records.length - 1][0];

    const candidates = [];
    const probeDeletes = {};
    for (const [uid, u] of records) {
      if (isEmailKey(uid)) {
        // Old builds' clock probe (users/{encodedEmail}/_st) — nothing but the
        // email-as-key is stored, so the whole record goes.
        if (u && typeof u === 'object' && Object.keys(u).every((k) => k === '_st')) {
          probeDeletes[`users/${uid}`] = null;
          t.emailKeyedProbesDeleted += 1;
        } else {
          t.emailKeyed += 1;
          if (emailKeyedSample.length < 25) emailKeyedSample.push(uid);
        }
        continue;
      }
      if (!u || typeof u !== 'object' || !LEAVES.some((k) => u[k] != null)) continue;
      candidates.push([uid, u]);
    }
    if (APPLY && Object.keys(probeDeletes).length > 0) {
      await db.ref().update(probeDeletes);
    }
    t.withPii += candidates.length;

    if (candidates.length > 0) {
      const firstUid = candidates[0][0];
      const lastUid = candidates[candidates.length - 1][0];
      const [privSnap, fromAuth] = await Promise.all([
        db.ref('users_private').orderByKey().startAt(firstUid).endAt(lastUid).once('value'),
        authEmails(candidates.map(([uid]) => uid)),
      ]);
      const priv = privSnap.val() || {};

      const updates = {};
      for (const [uid, u] of candidates) {
        const p = priv[uid] || {};

        const authE = fromAuth.get(uid) || null;
        const legacyE = normalizeEmail(u.email) || normalizeEmail(u.decodedEmail);
        const privE = normalizeEmail(p.email);
        if (privE) {
          if (authE && authE !== privE) {
            updates[`users_private/${uid}/email`] = authE;
            t.emailCorrectedToAuth += 1;
          } else {
            t.emailAlreadyPrivate += 1;
          }
        } else if (authE) {
          updates[`users_private/${uid}/email`] = authE;
          t.emailWritten += 1;
          t.emailFromAuth += 1;
        } else if (legacyE) {
          t.emailLegacyOnlyDropped += 1; // no Auth email: the leaf may be another user's plant — removed, not copied
        } else if (u.email != null || u.decodedEmail != null) {
          t.emailUnresolvable += 1; // a leaf that isn't an address — removed, not copied
        }

        const dob = normalizeDob(u.dateOfBirth);
        if (dob) {
          if (!STRICT_DOB.test(dob)) t.dobNonStandard += 1;
          if (!p.dateOfBirth) {
            updates[`users_private/${uid}/dateOfBirth`] = dob;
            t.dobWritten += 1;
          } else if (p.dateOfBirth !== dob) {
            t.dobConflictKeptPrivate += 1;
          } else {
            t.dobAlreadyPrivate += 1;
          }
        }

        let removed = 0;
        for (const k of LEAVES) {
          if (u[k] != null) {
            updates[`users/${uid}/${k}`] = null;
            removed += 1;
          }
        }
        t.leavesRemoved += removed;
        if (removed) t.usersCleaned += 1;
      }

      if (APPLY && Object.keys(updates).length > 0) {
        await db.ref().update(updates);
      }
    }

    process.stdout.write(`\r  pages ${t.pages} · scanned ${t.scanned} · with PII ${t.withPii} · last ${lastKey}      `);
    if (records.length < PAGE) break;
  }

  console.log('\n');
  console.table(t);
  if (t.emailKeyed > 0) {
    console.log(`⚠️  ${t.emailKeyed} legacy record(s) keyed by an encoded email were left untouched. First ${emailKeyedSample.length}:`);
    emailKeyedSample.forEach((k) => console.log(`   users/${k}`));
  }
  console.log(`\nResume with START_AT='${lastKey}' if this run was interrupted.`);
}

async function stripPostEmails() {
  const fs = admin.firestore();
  const t = { scanned: 0, withEmail: 0, stripped: 0 };
  console.log(`\n${APPLY ? '✍️  APPLY' : '🔎 DRY RUN'} — designPosts.email → deleted`);

  let last = null;
  for (;;) {
    let q = fs.collection('designPosts').orderBy(admin.firestore.FieldPath.documentId()).select('email').limit(500);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    last = snap.docs[snap.docs.length - 1];
    t.scanned += snap.size;

    const batch = fs.batch();
    let n = 0;
    for (const doc of snap.docs) {
      if (doc.get('email') == null) continue;
      t.withEmail += 1;
      batch.update(doc.ref, { email: admin.firestore.FieldValue.delete() });
      n += 1;
    }
    if (APPLY && n > 0) {
      await batch.commit();
      t.stripped += n;
    }
    process.stdout.write(`\r  scanned ${t.scanned} · with email ${t.withEmail}      `);
  }
  console.log('\n');
  console.table(t);
}

(async () => {
  try {
    if (POSTS) await stripPostEmails();
    else await migrateUsers();
    if (!APPLY) console.log('Dry run — nothing was written. Re-run with --apply.');
    process.exit(0);
  } catch (err) {
    console.error('\n❌', err);
    process.exit(1);
  }
})();
