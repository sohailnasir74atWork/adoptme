/**
 * reviewModeration.js — staff removal of a trader review: Firestore
 * reviews/{toUserId_fromUserId} is deleted and its stars come out of the rated
 * player's user_ratings_summary. Shared by the Admin Dashboard's review list
 * and More ▸ Admin's "Remove review" on a reported review (2026-10-18), so
 * both keep the same rule: a moderator who is not an admin cannot remove a
 * review written by another moderator or an admin.
 */

import { doc, getDoc, deleteDoc, setDoc } from '@react-native-firebase/firestore';

const toRating = (r) => {
  const n = typeof r === 'number' ? r : Number(r);
  return Number.isNaN(n) ? 0 : n;
};

/**
 * True when `actor` may remove a review written by `fromUserId`. Admins may
 * remove any; a moderator may not remove one by a moderator or an admin. A
 * failed role read lets the moderator through, as the dashboard always did.
 */
// Reviews can be deleted by admins only (owner decision, 2026-10-18).
// Moderators used to remove reviews written by regular players.
export const canDeleteReviews = ({ isAdmin } = {}) => !!isAdmin;

/** Same rule, kept async for the existing callers. */
export async function canRemoveReview(rtdb, fromUserId, roles) {
  return canDeleteReviews(roles);
}

/**
 * Delete the review and recount the summary of the player it was about.
 * `toUserId` and `rating` come from the review itself when the caller has it.
 */
export async function deleteReviewAndSummary(firestoreDB, { id, toUserId, rating }) {
  await deleteDoc(doc(firestoreDB, 'reviews', id));
  if (!toUserId) return;
  const summaryRef = doc(firestoreDB, 'user_ratings_summary', toUserId);
  const summarySnap = await getDoc(summaryRef);
  if (!summarySnap.exists()) return;
  const s = summarySnap.data();
  const oldAvg = s?.averageRating || 0;
  const oldCount = s?.count || 0;
  if (oldCount <= 1) {
    // Last review — reset summary
    await setDoc(summaryRef, { averageRating: 0, count: 0 }, { merge: true });
  } else {
    const newCount = oldCount - 1;
    const newAvg = ((oldAvg * oldCount) - toRating(rating)) / newCount;
    await setDoc(summaryRef, {
      averageRating: parseFloat(newAvg.toFixed(2)),
      count: newCount,
    }, { merge: true });
  }
}

/** The review as stored now, or null when it has already been removed. */
export async function fetchReview(firestoreDB, reviewId) {
  const snap = await getDoc(doc(firestoreDB, 'reviews', reviewId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
