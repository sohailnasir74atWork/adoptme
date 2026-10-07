/**
 * useStarBalance — the player's spendable ⭐ balance, live.
 *
 * Listens to users/{uid}/dailyStars, so the number moves the moment stars are
 * claimed (DailyStarRewards) or spent (card packs, Mystery Egg) on any screen.
 * Same fallback as getStarBalance(): accounts from before `starBalance`
 * existed count their totalStarsEarned until the first spend seeds it.
 * Returns null until the first value arrives.
 */
import { useEffect, useState } from 'react';
import { ref, onValue } from '@react-native-firebase/database';

export default function useStarBalance(db, uid) {
  const [balance, setBalance] = useState(null);
  useEffect(() => {
    if (!db || !uid) { setBalance(null); return undefined; }
    const unsub = onValue(
      ref(db, `users/${uid}/dailyStars`),
      (snap) => {
        const d = snap.exists() ? snap.val() || {} : {};
        setBalance(d.starBalance ?? d.totalStarsEarned ?? 0);
      },
      () => setBalance(0),
    );
    return () => unsub();
  }, [db, uid]);
  return balance;
}
