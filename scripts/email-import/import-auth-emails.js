/**
 * One-time copy of Firebase Auth emails into RTDB email_import/{uid}, the
 * "imported" mailing list kept apart from the consent list (email_prefs).
 * Owner decision 2026-10-08: a separate list, never written as optIn:true, so
 * the app still asks these players and Settings still shows email as off.
 *
 * DRY RUN BY DEFAULT: counts what it would write and writes nothing.
 *
 * USAGE (from the repo root; serviceAccount.json at the root)
 *   node scripts/email-import/import-auth-emails.js            # dry run
 *   node scripts/email-import/import-auth-emails.js --apply    # write
 *   node scripts/email-import/import-auth-emails.js --apply --over13-only   # 13+ DOB only (used 2026-10-08)
 *   node scripts/email-import/import-auth-emails.js --undo     # delete the whole list
 *
 * WHO GOES ON THE LIST — an Auth account that
 *   - has an email, is not disabled, and the email is verified
 *     (Google/Apple always are; unverified email/password sign-ups are skipped
 *     as likely typos or fakes, which bounce and hurt the sending domain);
 *   - has NO email_prefs/{uid} record. A "yes" is already on the consent list;
 *     a "no" is never imported;
 *   - is not known to be under 13. DOB is read from users_private/{uid} and
 *     users/{uid} (the same 'YYYY-MM-DD' the app writes). An unreadable or
 *     missing DOB is imported with over13: null, so a sender can choose to
 *     mail only over13 === true.
 *
 * RECORD  email_import/{uid} = { email, importedAt, over13: true|null, relay }
 *   relay = Apple "Hide My Email" address (undeliverable until the domain is
 *   registered with Apple's relay).
 *
 * LEAVING THE LIST  functions/emailImportCleanup.js removes the record on any
 * email_prefs write (unsubscribe link, Settings, in-app prompt) and on account
 * deletion. After writing, this script removes anyone who made a choice while
 * it ran. Anything that SENDS to this list must still skip
 * email_prefs optIn === false at send time.
 *
 * SPEED  ~1 h from a home connection (Auth lists ~1,000 users per 15–20 s).
 * The dry run caches the built list in the OS temp dir (CACHE=<path> to
 * override); --apply within 24 h reuses it, re-checks email_prefs, and deletes
 * the cache when done.
 *
 * Prints counts only — never an email address.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const requireAdmin = () => {
  try { return require('firebase-admin'); } catch (_) {
    return require(path.join(__dirname, '..', '..', 'functions', 'node_modules', 'firebase-admin'));
  }
};
const admin = requireAdmin();

const APPLY = process.argv.includes('--apply');
const UNDO = process.argv.includes('--undo');
// --over13-only: write only accounts with a readable 13+ DOB (owner's choice
// for the 2026-10-08 import), leaving unknown ages off the list.
const OVER13_ONLY = process.argv.includes('--over13-only');
const EMAIL_MIN_AGE = 13;
const WRITE_BATCH = 500;
const READ_POOL = 200;
// The slow part (listing ~180k Auth users + one DOB read each, ~1 h from a
// home connection) is cached here by the dry run so --apply can reuse it.
// It holds emails: kept outside the repo, owner-only, deleted after --apply.
const CACHE = process.env.CACHE || path.join(os.tmpdir(), 'adoptme-email-import-cache.json');
const CACHE_MAX_AGE_MS = 24 * 3600 * 1000;

admin.initializeApp({
  credential: admin.credential.cert(require(path.join(__dirname, '..', '..', 'serviceAccount.json'))),
  databaseURL: process.env.RTDB_URL || 'https://adoptme-7b50c-default-rtdb.firebaseio.com',
});
const db = admin.database();

// Same calendar math as Code/Helper/ageGate.js ageFromDob.
const DOB_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const ageFromDob = (dob) => {
  if (!dob || typeof dob !== 'string') return null;
  const m = DOB_RE.exec(dob.trim());
  if (!m) return null;
  const year = Number(m[1]); const month = Number(m[2]); const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const now = new Date();
  let age = now.getFullYear() - year;
  const monthDiff = (now.getMonth() + 1) - month;
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < day)) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
};

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  }));
}

async function listAuthUsers() {
  const out = [];
  let token;
  do {
    const page = await admin.auth().listUsers(1000, token);
    out.push(...page.users);
    token = page.pageToken;
    if (out.length % 20000 === 0) console.log(`  auth users listed: ${out.length}`);
  } while (token);
  return out;
}

// users_private is small (~6k records) and read once; users/{uid} is ~0.9 GB,
// so only its dateOfBirth leaf is read, and only when the private one is missing.
async function readDob(uid, privateDobs) {
  if (privateDobs[uid]) return privateDobs[uid];
  return (await db.ref(`users/${uid}/dateOfBirth`).once('value')).val() || null;
}

async function buildList() {
  const stats = { authUsers: 0, noEmail: 0, disabled: 0, unverified: 0, hasPrefsYes: 0, hasPrefsNo: 0,
    under13: 0, over13: 0, ageUnknown: 0, relay: 0, toWrite: 0 };

  const users = await listAuthUsers();
  stats.authUsers = users.length;
  console.log(`Auth users listed: ${users.length}`);
  const prefs = (await db.ref('email_prefs').once('value')).val() || {};
  const priv = (await db.ref('users_private').once('value')).val() || {};
  const privateDobs = {};
  for (const [uid, v] of Object.entries(priv)) if (v && v.dateOfBirth) privateDobs[uid] = v.dateOfBirth;

  const candidates = [];
  for (const u of users) {
    if (!u.email) { stats.noEmail++; continue; }
    if (u.disabled) { stats.disabled++; continue; }
    if (!u.emailVerified) { stats.unverified++; continue; }
    const p = prefs[u.uid];
    if (p) { if (p.optIn === true) stats.hasPrefsYes++; else stats.hasPrefsNo++; continue; }
    candidates.push(u);
  }
  console.log(`Candidates needing an age check: ${candidates.length}`);

  const records = {};
  let done = 0;
  await pool(candidates, READ_POOL, async (u) => {
    const age = ageFromDob(await readDob(u.uid, privateDobs));
    if (++done % 5000 === 0) console.log(`  ages read: ${done}/${candidates.length}`);
    if (age != null && age < EMAIL_MIN_AGE) { stats.under13++; return; }
    if (age == null) stats.ageUnknown++; else stats.over13++;
    const relay = /@privaterelay\.appleid\.com$/i.test(u.email);
    if (relay) stats.relay++;
    records[u.uid] = { email: u.email.trim().toLowerCase(), over13: age == null ? null : true, relay };
  });
  stats.toWrite = Object.keys(records).length;
  return { builtAt: Date.now(), stats, records };
}

function readCache() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (Date.now() - c.builtAt < CACHE_MAX_AGE_MS) return c;
  } catch (_) {}
  return null;
}

async function undo() {
  const snap = await db.ref('email_import').once('value');
  const n = snap.numChildren();
  console.log(`email_import holds ${n} records.`);
  if (!APPLY) { console.log('Dry run: add --apply with --undo to delete them.'); return; }
  await db.ref('email_import').remove();
  console.log('Deleted email_import.');
}

async function main() {
  if (UNDO) return undo();

  let built = APPLY ? readCache() : null;
  if (built) {
    console.log(`Using the dry run's list from ${new Date(built.builtAt).toISOString()} (${CACHE}).`);
  } else {
    built = await buildList();
    fs.writeFileSync(CACHE, JSON.stringify(built), { mode: 0o600 });
  }
  const { stats, records } = built;

  if (!APPLY) {
    console.log('DRY RUN — nothing written.', stats);
    console.log(`List cached for --apply (24 h): ${CACHE}`);
    return;
  }

  // Drop anyone who answered the email question since the list was built.
  const prefsBefore = (await db.ref('email_prefs').once('value')).val() || {};
  const eligible = Object.keys(records).filter((uid) => !OVER13_ONLY || records[uid].over13 === true);
  stats.droppedAgeUnknown = Object.keys(records).length - eligible.length;
  const uids = eligible.filter((uid) => !prefsBefore[uid]);
  stats.droppedNewChoice = eligible.length - uids.length;

  for (let i = 0; i < uids.length; i += WRITE_BATCH) {
    const patch = {};
    for (const uid of uids.slice(i, i + WRITE_BATCH)) {
      patch[uid] = { ...records[uid], importedAt: admin.database.ServerValue.TIMESTAMP };
    }
    await db.ref('email_import').update(patch);
    if ((i / WRITE_BATCH) % 40 === 0) console.log(`  written: ${Math.min(i + WRITE_BATCH, uids.length)}/${uids.length}`);
  }

  // Anyone who answered the email question while this ran leaves the list.
  const prefsNow = (await db.ref('email_prefs').once('value')).val() || {};
  const late = {};
  for (const uid of uids) if (prefsNow[uid]) late[uid] = null;
  stats.removedAfterRaceCheck = Object.keys(late).length;
  if (stats.removedAfterRaceCheck) await db.ref('email_import').update(late);

  stats.written = uids.length - stats.removedAfterRaceCheck;
  try { fs.unlinkSync(CACHE); } catch (_) {}
  console.log('APPLIED.', stats, 'Cache deleted.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
