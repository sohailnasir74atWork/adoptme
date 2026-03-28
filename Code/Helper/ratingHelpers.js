import React from 'react';
import { Text } from 'react-native';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  setDoc,
  serverTimestamp,
  runTransaction,
} from '@react-native-firebase/firestore';
import { ref, get } from '@react-native-firebase/database';

/**
 * Shared star rendering — returns a <Text> element with filled/empty stars.
 * @param {number} value - rating value (0-5)
 * @returns {React.Element}
 */
export const renderStars = (value) => {
  const rounded = Math.round(value || 0);
  const full = '★'.repeat(Math.min(rounded, 5));
  const empty = '☆'.repeat(Math.max(0, 5 - rounded));
  return (
    <Text style={{ color: '#ffb700be', fontSize: 14, fontWeight: '600' }}>
      {full}
      <Text style={{ color: '#999' }}>{empty}</Text>
    </Text>
  );
};

/**
 * Load rating summary for a user with full backward-compatible fallback chain:
 *   1. Firestore user_ratings_summary (primary)
 *   2. RTDB averageRatings/{userId} (legacy — auto-migrates to Firestore)
 *   3. Recalculate from Firestore reviews collection (expensive, one-time)
 *
 * @param {object} firestoreDB - Firestore instance
 * @param {object} appdatabase - RTDB instance
 * @param {string} userId - target user ID
 * @returns {Promise<{value: number, count: number} | null>}
 */
export const loadRatingSummaryForUser = async (firestoreDB, appdatabase, userId) => {
  // ✅ Step 1: Check Firestore user_ratings_summary (single source of truth)
  const summaryDocSnap = await getDoc(doc(firestoreDB, 'user_ratings_summary', userId));

  if (summaryDocSnap.exists()) {
    const summaryData = summaryDocSnap.data();
    if (summaryData) {
      return {
        value: Number(summaryData.averageRating || 0),
        count: Number(summaryData.count || 0),
      };
    }
  }

  // ✅ Step 2: Check RTDB (legacy) — auto-migrate if found
  const avgSnap = await get(ref(appdatabase, `averageRatings/${userId}`));
  if (avgSnap.exists()) {
    const avgData = avgSnap.val();
    const avgValue = Number(avgData.value || 0);
    const avgCount = Number(avgData.count || 0);

    // Auto-migrate to Firestore (fire-and-forget)
    if (avgValue > 0 || avgCount > 0) {
      setDoc(
        doc(firestoreDB, 'user_ratings_summary', userId),
        {
          averageRating: avgValue,
          count: avgCount,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(err => console.error('Error migrating rating summary to Firestore:', err));
    }

    return { value: avgValue, count: avgCount };
  }

  // ✅ Step 3: Recalculate from reviews (expensive, one-time per user)
  try {
    const reviewsQuery = query(
      collection(firestoreDB, 'reviews'),
      where('toUserId', '==', userId),
      limit(100) // ✅ COST LIMIT: Max 100 reviews per calculation
    );
    const reviewsSnapshot = await getDocs(reviewsQuery);

    if (!reviewsSnapshot.empty) {
      let totalRating = 0;
      let ratingCount = 0;

      reviewsSnapshot.docs.forEach((d) => {
        const reviewData = d.data();
        if (reviewData.rating && typeof reviewData.rating === 'number') {
          totalRating += reviewData.rating;
          ratingCount += 1;
        }
      });

      if (ratingCount > 0) {
        const calculatedAverage = totalRating / ratingCount;
        const result = {
          value: parseFloat(calculatedAverage.toFixed(2)),
          count: ratingCount,
        };

        // Persist summary (prevents future recalculations)
        await setDoc(
          doc(firestoreDB, 'user_ratings_summary', userId),
          {
            averageRating: result.value,
            count: ratingCount,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        return result;
      }
    }
  } catch (error) {
    console.error('Error calculating summary from reviews:', error);
  }

  return null;
};

/**
 * Submit or update a rating (and optional review text) using a Firestore transaction
 * to prevent race conditions on the summary document.
 *
 * @param {object} firestoreDB - Firestore instance
 * @param {object} params
 * @param {string} params.fromUserId
 * @param {string} params.toUserId
 * @param {number} params.rating - 1-5
 * @param {string} [params.reviewText] - optional review text
 * @param {string} [params.userName] - display name of reviewer
 * @returns {Promise<{reviewWasSaved: boolean, reviewWasUpdated: boolean, isUpdate: boolean}>}
 */
export const submitRating = async (firestoreDB, { fromUserId, toUserId, rating, reviewText, userName }) => {
  const reviewDocId = `${toUserId}_${fromUserId}`; // toUser_fromUser
  const reviewRef = doc(firestoreDB, 'reviews', reviewDocId);
  const summaryRef = doc(firestoreDB, 'user_ratings_summary', toUserId);

  // ✅ Read existing review to check if this is an update
  const existingReviewSnap = await getDoc(reviewRef);
  const oldRating = existingReviewSnap.exists() ? existingReviewSnap.data()?.rating : undefined;
  const isUpdate = existingReviewSnap.exists();

  // ✅ Atomic transaction for user_ratings_summary (prevents race conditions)
  await runTransaction(firestoreDB, async (transaction) => {
    const summarySnap = await transaction.get(summaryRef);
    const summaryData = summarySnap.exists() ? summarySnap.data() : null;
    const oldAverage = summaryData?.averageRating || 0;
    const oldCount = summaryData?.count || 0;

    let newAverage = 0;
    let newCount = oldCount;

    if (oldRating !== undefined && oldRating !== null) {
      // 🔁 Updating existing rating
      newAverage = oldCount > 0 ? ((oldAverage * oldCount) - oldRating + rating) / oldCount : rating;
    } else {
      // 🆕 New rating
      newCount = oldCount + 1;
      newAverage = ((oldAverage * oldCount) + rating) / newCount;
    }

    transaction.set(
      summaryRef,
      {
        averageRating: parseFloat(newAverage.toFixed(2)),
        count: newCount,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  // ✅ Save/update the review document
  const now = serverTimestamp();
  await setDoc(
    reviewRef,
    {
      fromUserId,
      toUserId,
      rating,
      userName: userName || null,
      createdAt: isUpdate ? existingReviewSnap.data()?.createdAt ?? now : now,
      updatedAt: now,
      edited: isUpdate,
    },
    { merge: true }
  );

  // ✅ Optional review text
  const trimmedReview = (reviewText || '').trim();
  let reviewWasSaved = false;
  let reviewWasUpdated = false;

  if (trimmedReview) {
    await setDoc(
      reviewRef,
      {
        review: trimmedReview,
        updatedAt: now,
        edited: isUpdate,
      },
      { merge: true }
    );
    reviewWasSaved = true;
    reviewWasUpdated = isUpdate;
  }

  return { reviewWasSaved, reviewWasUpdated, isUpdate };
};

/**
 * Update an existing review's text and optionally its rating (from Settings edit).
 * Uses a Firestore transaction for the summary update.
 *
 * @param {object} firestoreDB
 * @param {object} params
 * @param {string} params.fromUserId
 * @param {string} params.toUserId
 * @param {number} params.newRating
 * @param {string} params.reviewText
 * @param {string} [params.userName]
 * @param {object} [params.originalCreatedAt] - preserve original createdAt
 * @returns {Promise<void>}
 */
export const updateExistingReview = async (firestoreDB, { fromUserId, toUserId, newRating, reviewText, userName, originalCreatedAt }) => {
  const reviewDocId = `${toUserId}_${fromUserId}`;
  const reviewRef = doc(firestoreDB, 'reviews', reviewDocId);

  // ✅ Get old rating before updating
  const existingReviewSnap = await getDoc(reviewRef);
  const oldRating = existingReviewSnap.exists() ? existingReviewSnap.data()?.rating : null;

  // ✅ If rating changed, update summary atomically
  const ratingChanged = oldRating !== null && oldRating !== newRating;

  if (ratingChanged) {
    const summaryRef = doc(firestoreDB, 'user_ratings_summary', toUserId);

    await runTransaction(firestoreDB, async (transaction) => {
      const summarySnap = await transaction.get(summaryRef);
      const summaryData = summarySnap.exists() ? summarySnap.data() : null;
      const oldAverage = summaryData?.averageRating || 0;
      const oldCount = summaryData?.count || 1; // safety: at least 1 if updating

      const newAverage = ((oldAverage * oldCount) - oldRating + newRating) / oldCount;

      transaction.set(
        summaryRef,
        {
          averageRating: parseFloat(newAverage.toFixed(2)),
          count: oldCount, // Count stays the same (updating existing review)
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });
  }

  // ✅ Update the review document
  await setDoc(
    reviewRef,
    {
      fromUserId,
      toUserId,
      rating: newRating,
      userName: userName || null,
      review: (reviewText || '').trim(),
      createdAt: originalCreatedAt, // Preserve original
      updatedAt: serverTimestamp(),
      edited: true,
    },
    { merge: true }
  );
};
