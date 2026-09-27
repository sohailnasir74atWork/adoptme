/**
 * Cloud Functions: keep email and date of birth OFF users/{uid} and out of
 * designPosts (round 2, 2026-09).
 *
 * WHY
 * users/{uid} can be read one record at a time by anyone
 * (database.rules.json), so an email or date of birth stored there is public.
 * New builds and the website write them to users_private/{uid} (owner + staff
 * only) instead, and scripts/migrate-user-pii.js moves what is already there.
 * But builds from before round 2 stay in the field for months and keep
 * writing to users/{uid}:
 *   - email + decodedEmail — at account creation, and the email "self-heal"
 *     at login when the Supabase identity read misses (the website wrote the
 *     same two keys)
 *   - dateOfBirth          — the mandatory DOB gate
 * privatizeUserPII moves each one to users_private the moment it lands and
 * removes it from users/{uid}.
 *
 * TRIGGERS
 * Leaf paths only — NEVER a whole-node /users/{uid} trigger: /users is the
 * hottest write path in the database, and these leaves are written a handful
 * of times per account. v1 onWrite, not v2: only v1 database events say WHO
 * wrote the value. users/$userId lets any signed-in user write another user's
 * non-role fields, so a value is trusted only when the account's owner (or the
 * Admin SDK) wrote it — otherwise anyone could plant a permanent DOB, or a
 * victim's email to get the wrong person banned. Exported as a group, so the
 * deployed names are privatizeUserPII-email, privatizeUserPII-decodedEmail and
 * privatizeUserPII-dateOfBirth.
 *
 * WHAT EACH DOES (non-null writes only; deletions — its own included — are ignored)
 *   email / decodedEmail: the canonical email is the account's Firebase Auth
 *     email when it has one, else — only if the owner wrote it — the written
 *     value decoded ('(dot)' and ',' → '.') and lowercased. It is set on
 *     users_private/{uid}/email, then BOTH email leaves are removed from
 *     users/{uid}.
 *   dateOfBirth: copied to users_private/{uid}/dateOfBirth only if the owner
 *     wrote it and none is on file there — write-once, like the client rule,
 *     so an old build cannot let a child swap their DOB for an adult one —
 *     then the leaf is removed either way.
 * Idempotent, never throws. Records keyed by an encoded email instead of a uid
 * (pre-uid legacy) are left alone, exactly as the migration script does.
 *
 * COST / LOOP SAFETY
 * The removal fires these triggers again with a null value, which return at
 * once; mirrorUsersToSupabase ignores removals of these keys. A users_private
 * change fires mirrorUsersPrivateToSupabase once.
 *
 * Deployment — CUTOVER, i.e. once the app release that writes users_private
 * has been adopted; run scripts/migrate-user-pii.js right after:
 *   firebase deploy --only functions:privatizeUserPII --project adoptme-7b50c
 *
 * ---------------------------------------------------------------------------
 * privatizePostEmail — designPosts/{postId} onCreate (deploy at CUTOVER)
 * Firestore is world-readable (the live rules are a single catch-all), and
 * builds before round 2 stamp the author's email on every design post, so it
 * is deleted as soon as the post is created. Not earlier than cutover: some
 * older builds' admin menu bans a post's author with banUserwithEmail(item.email).
 * The update fires notifyPostReaction once, which sees no reaction change and
 * returns. Existing posts: scripts/migrate-user-pii.js --posts.
 *   firebase deploy --only functions:privatizePostEmail --project adoptme-7b50c
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const logger = require('firebase-functions/logger');

if (!admin.apps.length) {
  admin.initializeApp();
}

const RUN_OPTS = { memory: '128MB', timeoutSeconds: 30 };

// The owner's own client, or the Admin SDK / console. Anything else is another
// user writing into this account's record.
const writtenByOwner = (context, uid) =>
  context.authType === 'ADMIN' || context.auth?.uid === uid;

const normalizeEmail = (v) => {
  if (typeof v !== 'string') return null;
  const e = v.trim().replace(/\(dot\)/g, '.').replace(/,/g, '.').toLowerCase();
  return e.includes('@') ? e : null;
};

// Pre-uid legacy records use the (encoded) email as the key.
const isEmailKey = (key) => /@|\(dot\)|,/.test(key || '');

// 'YYYY-M-D' → 'YYYY-MM-DD' (the shape the client rule enforces). Anything
// that doesn't look like a date is kept as written, not guessed at.
const normalizeDob = (v) => {
  if (typeof v !== 'string' || !v.trim()) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : v.trim();
};

async function authEmail(uid) {
  try {
    return normalizeEmail((await admin.auth().getUser(uid)).email);
  } catch (_) {
    return null; // no such auth user (deleted account, legacy key)
  }
}

async function privatizeEmail(change, context) {
  const { uid } = context.params;
  if (!change.after.exists() || isEmailKey(uid)) return null;
  try {
    const byOwner = writtenByOwner(context, uid);
    const email = (await authEmail(uid)) || (byOwner ? normalizeEmail(change.after.val()) : null);
    const db = admin.database();
    if (email) await db.ref(`users_private/${uid}/email`).set(email);
    await db.ref(`users/${uid}`).update({ email: null, decodedEmail: null });
    logger.info('[privatizeUserPII] email moved', { uid, byOwner });
  } catch (err) {
    logger.error('[privatizeUserPII] email failed', { uid, error: err?.message });
  }
  return null;
}

async function privatizeDob(change, context) {
  const { uid } = context.params;
  if (!change.after.exists() || isEmailKey(uid)) return null;
  try {
    const byOwner = writtenByOwner(context, uid);
    const dob = byOwner ? normalizeDob(change.after.val()) : null;
    const db = admin.database();
    if (dob) {
      // First DOB on file wins; returning undefined aborts the transaction.
      await db.ref(`users_private/${uid}/dateOfBirth`).transaction((current) => (current == null ? dob : undefined));
    }
    await db.ref(`users/${uid}/dateOfBirth`).remove();
    logger.info(byOwner ? '[privatizeUserPII] dateOfBirth moved' : '[privatizeUserPII] dateOfBirth from another account dropped', { uid });
  } catch (err) {
    logger.error('[privatizeUserPII] dateOfBirth failed', { uid, error: err?.message });
  }
  return null;
}

const onLeaf = (path, handler) =>
  functions.runWith(RUN_OPTS).database.ref(path).onWrite(handler);

exports.privatizeUserPII = {
  email: onLeaf('/users/{uid}/email', privatizeEmail),
  decodedEmail: onLeaf('/users/{uid}/decodedEmail', privatizeEmail),
  dateOfBirth: onLeaf('/users/{uid}/dateOfBirth', privatizeDob),
};

exports.privatizePostEmail = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .firestore.document('designPosts/{postId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    if (!data || data.email == null) return null;
    try {
      await snap.ref.update({ email: admin.firestore.FieldValue.delete() });
    } catch (err) {
      functions.logger.error('[privatizePostEmail] failed', { postId: context.params.postId, error: err?.message });
    }
    return null;
  });
