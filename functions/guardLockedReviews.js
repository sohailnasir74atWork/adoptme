/**
 * guardLockedReviews — keeps TWO owner-moderated reviews from being edited
 * (owner decision 2026-10-07, for these reviews only — not a general
 * feature). Both sides of one dispute, rewritten to the facts and marked
 * locked: true:
 *   * ᴄâʏ → lils: "Commissioned a house from me, then backed out and didn't
 *     pay for it."
 *   * lils → ᴄâʏ: "I didn't take the house in the end, and the builder
 *     accused me of copying it with scripts and insulted me."
 *
 * A Firestore trigger can only name one document, so it listens on
 * reviews/{id} and returns at once for any id not in LOCKED_REVIEWS.
 *
 * Firestore is still open to clients, and every app build lets a player edit
 * their own review (a merge of rating/review/updatedAt), so the lock is
 * enforced here: when a locked review changes, the previous version is
 * written back. If the author also changed the stars, their app has already
 * moved user_ratings_summary/{toUserId}; that is reversed too.
 *
 * Two writes are let through:
 *   * moderation — anything that changes `moderatedAt` (how an admin edits or
 *     unlocks a review);
 *   * this function's own restore — it stamps `restoredAt`, so restoring
 *     doesn't trigger another restore.
 * Deletes aren't watched (moderators delete reviews).
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const stamp = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v);

async function handle(before, after, docRef, db, FieldValue) {
  if (!before || before.locked !== true || !after) return 'not_locked';
  if (!same(stamp(after.moderatedAt), stamp(before.moderatedAt))) return 'moderation';
  if (!same(stamp(after.restoredAt), stamp(before.restoredAt))) return 'own_restore';
  if (after.locked === true && same(after.review, before.review) && same(after.rating, before.rating)) return 'unchanged';

  await docRef.set({ ...before, restoredAt: FieldValue.serverTimestamp() });

  const was = Number(before.rating);
  const now = Number(after.rating);
  if (before.toUserId && Number.isFinite(was) && Number.isFinite(now) && was !== now) {
    const ref = db.doc(`user_ratings_summary/${before.toUserId}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : null;
      if (!d || !d.count) return;
      const avg = ((Number(d.averageRating) || 0) * d.count - now + was) / d.count;
      tx.set(ref, { averageRating: parseFloat(avg.toFixed(2)) }, { merge: true });
    });
  }
  return 'restored';
}

const LOCKED_REVIEWS = new Set([
  'ziQPYoc9LPRRM6TxtSqskS2dyni2_b5EUv0975SObNNafHkjCI0qvM8P2', // ᴄâʏ → lils
  'b5EUv0975SObNNafHkjCI0qvM8P2_ziQPYoc9LPRRM6TxtSqskS2dyni2', // lils → ᴄâʏ
]);

exports.guardLockedReviews = functions
  .runWith({ memory: '128MB', timeoutSeconds: 30 })
  .firestore.document('reviews/{id}')
  .onUpdate(async (change, context) => {
    if (!LOCKED_REVIEWS.has(context.params.id)) return null;
    const result = await handle(
      change.before.data(),
      change.after.data(),
      change.after.ref,
      admin.firestore(),
      admin.firestore.FieldValue,
    );
    if (result === 'restored') console.log(`[guardLockedReviews] restored ${change.after.id}`);
    return null;
  });

// Exposed for tests.
exports._internals = { handle };
