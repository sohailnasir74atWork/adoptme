import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    Timestamp,
    collection,
    query,
    where,
    getDocs,
} from '@react-native-firebase/firestore';

/**
 * Generate deterministic doc ID for a user pair.
 * Always puts the smaller UID first so both users reference the same doc.
 */
export const getStreakDocId = (uid1, uid2) => {
    return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
};

/**
 * Check if two Timestamps fall on the same calendar day (UTC).
 */
const isSameDay = (ts1, ts2) => {
    const d1 = ts1 instanceof Date ? ts1 : ts1.toDate();
    const d2 = ts2 instanceof Date ? ts2 : ts2.toDate();
    return (
        d1.getUTCFullYear() === d2.getUTCFullYear() &&
        d1.getUTCMonth() === d2.getUTCMonth() &&
        d1.getUTCDate() === d2.getUTCDate()
    );
};

/**
 * Check if ts1 is exactly 1 calendar day before ts2 (UTC).
 */
const isYesterday = (ts1, ts2) => {
    const d1 = ts1 instanceof Date ? ts1 : ts1.toDate();
    const d2 = ts2 instanceof Date ? ts2 : ts2.toDate();
    // Create date-only versions (midnight UTC)
    const day1 = new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate()));
    const day2 = new Date(Date.UTC(d2.getUTCFullYear(), d2.getUTCMonth(), d2.getUTCDate()));
    const diffMs = day2.getTime() - day1.getTime();
    return diffMs === 86400000; // exactly 1 day in ms
};

/**
 * Update streak between two users. Call this when a private message is sent.
 *
 * Rules:
 * - If no streak exists → create with count 1
 * - If lastActivity is today → do nothing (already counted)
 * - If lastActivity was yesterday → increment streak
 * - If lastActivity is older → reset to 1
 */
export const updateStreak = async (firestoreDB, myUid, otherUid) => {
    if (!firestoreDB || !myUid || !otherUid || myUid === otherUid) return;

    try {
        const docId = getStreakDocId(myUid, otherUid);
        const streakRef = doc(firestoreDB, 'streaks', docId);
        const streakSnap = await getDoc(streakRef);
        const now = new Date();

        if (!streakSnap.exists()) {
            // First interaction — create streak
            await setDoc(streakRef, {
                count: 1,
                lastActivity: Timestamp.fromDate(now),
                users: [myUid, otherUid].sort(),
            });
            return;
        }

        const data = streakSnap.data();
        const lastActivity = data.lastActivity;

        if (!lastActivity) {
            // Corrupted doc — reset
            await updateDoc(streakRef, {
                count: 1,
                lastActivity: Timestamp.fromDate(now),
            });
            return;
        }

        if (isSameDay(lastActivity, now)) {
            // Already counted today — do nothing
            return;
        }

        if (isYesterday(lastActivity, now)) {
            // Consecutive day — increment!
            await updateDoc(streakRef, {
                count: (data.count || 0) + 1,
                lastActivity: Timestamp.fromDate(now),
            });
        } else {
            // Streak broken — reset to 1
            await updateDoc(streakRef, {
                count: 1,
                lastActivity: Timestamp.fromDate(now),
            });
        }
    } catch (error) {
        // Silently fail — streak is non-critical
        console.warn('Streak update error:', error?.message || error);
    }
};

/**
 * Fetch all active streaks for a user.
 * Returns a Map of otherUserId → streakCount for streaks ≥ 2.
 */
export const getMyStreaks = async (firestoreDB, myUid) => {
    if (!firestoreDB || !myUid) return new Map();

    try {
        const streaksRef = collection(firestoreDB, 'streaks');
        const q = query(streaksRef, where('users', 'array-contains', myUid));
        const snapshot = await getDocs(q);

        const streakMap = new Map();
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.count >= 2) {
                // Find the other user
                const otherUid = data.users.find(uid => uid !== myUid);
                if (otherUid) {
                    streakMap.set(otherUid, data.count);
                }
            }
        });

        return streakMap;
    } catch (error) {
        console.warn('Get streaks error:', error?.message || error);
        return new Map();
    }
};
