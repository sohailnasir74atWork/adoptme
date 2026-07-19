import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { ref, set, remove, get, serverTimestamp as rtdbTimestamp } from '@react-native-firebase/database';
import { collection, addDoc, serverTimestamp as fsTimestamp } from '@react-native-firebase/firestore';

export const FilterMenu = ({ selectedFilters, setSelectedFilters, analytics, platform }) => {
  const { t } = useTranslation();

  // Toggle any filter (myTrades, win, lose, fair)
  const toggleFilter = (filterKey) => {
    setSelectedFilters((prevFilters) =>
      prevFilters.includes(filterKey)
        ? prevFilters.filter((f) => f !== filterKey)      // remove filter
        : [...prevFilters, filterKey]                     // add filter
    );
  };

  // Filter options: My Trades and Status filters
  const filterOptions = [
    { key: "myTrades", label: t("trade.filter_my_trades") },
    { key: "win", label: "Win" },
    { key: "lose", label: "Lose" },
    { key: "fair", label: "Fair" },
  ];

  return (
    <View style={styles.container}>
      <Menu>
        <MenuTrigger>
          <Icon name="filter" size={24} color={styles.icon.color} />
        </MenuTrigger>
        <MenuOptions customStyles={{ optionsContainer: styles.menuOptions }}>
          {filterOptions.map(({ key, label }) => (
            <MenuOption key={key} onSelect={() => toggleFilter(key)} closeOnSelect={false}>
              <View style={styles.menuRow}>
                <Text style={[styles.menuOptionText, selectedFilters.includes(key) && styles.selectedText]}>
                  {label}
                </Text>
                {selectedFilters.includes(key) && (
                  <Icon name="checkmark" size={16} color={config.colors.hasBlockGreen} />
                )}
              </View>
            </MenuOption>
          ))}
        </MenuOptions>
      </Menu>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'flex-end', margin: 10 },
  icon: { color: 'grey' },
  menuOptions: {
    paddingHorizontal: 10,
    backgroundColor: 'white',
    borderRadius: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  menuRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  menuOptionText: { fontSize: 16, color: 'black', paddingVertical: 10, },
  selectedText: { color: config.colors.hasBlockGreen, fontWeight: 'bold' },
});

// ═══════════════════════════════════════════════════
// TRADE ACCEPT / SAVE / PING UTILITIES
// ═══════════════════════════════════════════════════

const MAX_ACCEPTED = 10;
const MAX_SAVED = 10;

/**
 * Count how many saved/accepted trades of a given type the user has
 */
const _countByType = async (appdatabase, myUid, type) => {
  try {
    const snap = await get(ref(appdatabase, `savedTrades/${myUid}`));
    if (!snap.exists()) return 0;
    const all = snap.val();
    return Object.values(all).filter(v => v.type === type).length;
  } catch {
    return 0;
  }
};

/**
 * Accept a trade — saves lightweight ref to RTDB + creates Firestore notification for poster
 * Max 10 accepted trades at a time.
 */
export const acceptTrade = async (appdatabase, firestoreDB, myUid, myName, trade, myExtras = {}) => {
  // ✅ Enforce max limit
  const count = await _countByType(appdatabase, myUid, 'accepted');
  if (count >= MAX_ACCEPTED) {
    throw new Error(`You can only have ${MAX_ACCEPTED} accepted trades at a time. Complete or remove some first.`);
  }

  const tradeId = trade.id;
  const tradeRef = ref(appdatabase, `savedTrades/${myUid}/${tradeId}`);

  await set(tradeRef, {
    type: 'accepted',
    traderId: trade.userId,
    traderName: trade.traderName || 'Unknown',
    traderRobloxUsername: trade.robloxUsername || '',
    savedAt: rtdbTimestamp(),
  });

  // Also record this acceptance under the trade itself so the poster can see who accepted.
  // Track whether this user had already accepted so re-accepting doesn't re-notify.
  let alreadyAccepted = false;
  try {
    const existing = await get(ref(appdatabase, `tradeAcceptors/${tradeId}/${myUid}`));
    alreadyAccepted = existing.exists();
    await set(ref(appdatabase, `tradeAcceptors/${tradeId}/${myUid}`), {
      name: myName,
      robloxUsername: myExtras.robloxUsername || '',
      avatar: myExtras.avatar || '',
      acceptedAt: rtdbTimestamp(),
    });
  } catch (e) {
    console.warn('[tradeHelpers] Failed to write tradeAcceptors:', e?.message);
  }

  // Build a short trade summary for the notification
  const tradeSummary = _buildTradeSummary(trade);

  // Write notification to Firestore for in-app feed + cloud function FCM push.
  // Skip when the user had already accepted (prevents duplicate pings on re-accept).
  if (!alreadyAccepted) {
    try {
      await addDoc(collection(firestoreDB, 'notifications'), {
        toUid: trade.userId,
        fromUid: myUid,
        fromName: myName,
        type: 'trade_accepted',
        tradeId: tradeId,
        message: `${myName} accepted your trade! ${tradeSummary}`,
        read: false,
        createdAt: fsTimestamp(),
      });
    } catch (e) {
      console.warn('[tradeHelpers] Failed to write accept notification:', e?.message);
    }
  }
}

/**
 * Notify everyone who accepted a trade that it is no longer available — either
 * the poster completed it (with someone) or removed the listing. Writes one
 * Firestore notification per acceptor; the notifyTradeAccept CF turns each into
 * an FCM push (type 'trade_closed'). Call this BEFORE removeAllTradeAcceptors,
 * while the acceptor list still exists.
 * @param {'completed'|'removed'} reason
 */
export const notifyAcceptorsTradeClosed = async (appdatabase, firestoreDB, tradeId, posterUid, posterName, reason = 'completed') => {
  if (!appdatabase || !firestoreDB || !tradeId) return;
  try {
    const acceptors = await fetchTradeAcceptors(appdatabase, tradeId);
    const uids = Object.keys(acceptors || {}).filter(u => u && u !== posterUid);
    if (uids.length === 0) return;
    const message = reason === 'removed'
      ? `A trade you accepted was removed by ${posterName || 'the poster'}.`
      : `A trade you accepted was completed and is no longer available.`;
    await Promise.all(uids.map(toUid =>
      addDoc(collection(firestoreDB, 'notifications'), {
        toUid,
        fromUid: posterUid || '',
        fromName: posterName || 'Trader',
        type: 'trade_closed',
        tradeId,
        message,
        read: false,
        createdAt: fsTimestamp(),
      }).catch(() => {})
    ));
  } catch (e) {
    console.warn('[tradeHelpers] notifyAcceptorsTradeClosed failed:', e?.message);
  }
};;

/**
 * Save/bookmark a trade — saves lightweight ref to RTDB only (no notification)
 * Max 10 saved trades at a time.
 */
export const saveTrade = async (appdatabase, myUid, trade) => {
  // ✅ Enforce max limit
  const count = await _countByType(appdatabase, myUid, 'saved');
  if (count >= MAX_SAVED) {
    throw new Error(`You can only save ${MAX_SAVED} trades at a time. Remove some first.`);
  }

  const tradeId = trade.id;
  const tradeRef = ref(appdatabase, `savedTrades/${myUid}/${tradeId}`);

  await set(tradeRef, {
    type: 'saved',
    traderId: trade.userId,
    traderName: trade.traderName || 'Unknown',
    traderRobloxUsername: trade.robloxUsername || '',
    savedAt: rtdbTimestamp(),
  });
};

/**
 * Remove a saved/accepted trade — also cleans up tradeAcceptors if it was an accepted trade
 */
export const unsaveTrade = async (appdatabase, myUid, tradeId) => {
  const tradeRef = ref(appdatabase, `savedTrades/${myUid}/${tradeId}`);
  await remove(tradeRef);
  // Also remove from tradeAcceptors (safe no-op if path doesn't exist)
  try {
    await remove(ref(appdatabase, `tradeAcceptors/${tradeId}/${myUid}`));
  } catch {}
};

const PING_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Ping a trader — "Are you available to trade?" notification
 * Has a 10-minute cooldown per trade to prevent spam.
 * @param {object} appdatabase - RTDB instance (for cooldown tracking)
 */
export const pingTrader = async (appdatabase, firestoreDB, myUid, myName, trade) => {
  const tradeId = trade.id || trade.tradeId;
  const traderId = trade.userId || trade.traderId;

  // ✅ Cooldown check — read lastPingAt from RTDB saved ref
  if (appdatabase && tradeId) {
    try {
      const savedRef = ref(appdatabase, `savedTrades/${myUid}/${tradeId}/lastPingAt`);
      const snap = await get(savedRef);
      if (snap.exists()) {
        const lastPing = snap.val();
        const elapsed = Date.now() - lastPing;
        if (elapsed < PING_COOLDOWN_MS) {
          const remainingMins = Math.ceil((PING_COOLDOWN_MS - elapsed) / 60000);
          throw new Error(`Please wait ${remainingMins} more minute${remainingMins > 1 ? 's' : ''} before pinging again.`);
        }
      }
    } catch (e) {
      if (e.message?.includes('Please wait')) throw e; // re-throw cooldown error
      // Other DB errors — skip cooldown check, allow ping
    }
  }

  // Build a short trade summary for the notification
  const tradeSummary = _buildTradeSummary(trade);

  await addDoc(collection(firestoreDB, 'notifications'), {
    toUid: traderId,
    fromUid: myUid,
    fromName: myName,
    type: 'trade_ping',
    tradeId: tradeId,
    message: `${myName} wants to trade with you! ${tradeSummary}`,
    read: false,
    createdAt: fsTimestamp(),
  });

  // ✅ Store lastPingAt for cooldown tracking
  if (appdatabase && tradeId) {
    try {
      await set(ref(appdatabase, `savedTrades/${myUid}/${tradeId}/lastPingAt`), Date.now());
    } catch (e) {
      // Non-critical — ping was already sent
    }
  }
};

/**
 * Build a short human-readable trade summary from item names
 * e.g. "Frost Dragon, Shadow → Mega Neon Unicorn"
 */
const _buildTradeSummary = (trade) => {
  try {
    const hasNames = (trade.hasItems || []).filter(i => i).map(i => i.name || i.Name || '').filter(Boolean).slice(0, 3);
    const wantsNames = (trade.wantsItems || []).filter(i => i).map(i => i.name || i.Name || '').filter(Boolean).slice(0, 3);
    if (hasNames.length === 0 && wantsNames.length === 0) return '';
    const has = hasNames.join(', ') || '?';
    const wants = wantsNames.join(', ') || '?';
    return `(${has} → ${wants})`;
  } catch {
    return '';
  }
};

/**
 * Fetch all acceptors for a single trade
 * Returns object: { acceptorUid: { name, robloxUsername, avatar, acceptedAt } }
 */
export const fetchTradeAcceptors = async (appdatabase, tradeId) => {
  try {
    const snap = await get(ref(appdatabase, `tradeAcceptors/${tradeId}`));
    if (snap.exists()) return snap.val();
    return {};
  } catch {
    return {};
  }
};

/**
 * Remove all acceptors for a trade (called when trade is completed/deleted)
 */
export const removeAllTradeAcceptors = async (appdatabase, tradeId) => {
  try {
    await remove(ref(appdatabase, `tradeAcceptors/${tradeId}`));
  } catch {}
};

/**
 * Fetch all saved/accepted trade refs from RTDB
 * Returns object: { tradeId: { type, traderId, traderName, ... } }
 */
export const fetchSavedTradeRefs = async (appdatabase, myUid) => {
  try {
    const snap = await get(ref(appdatabase, `savedTrades/${myUid}`));
    if (snap.exists()) {
      return snap.val();
    }
    return {};
  } catch (e) {
    console.warn('[tradeHelpers] Failed to fetch saved trades:', e?.message);
    return {};
  }
};
