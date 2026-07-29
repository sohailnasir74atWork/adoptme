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

// ── Variant tags (Neon / Mega / Fly / Ride) ──────────────────────────────────
// Server-side filtering gets one array-contains clause per query, but the query
// players actually want is "a single pet that is neon AND fly AND ride" (NFR).
// So each pet contributes every combination of its own tags — a neon fly-ride
// pet yields n, f, r, nf, nr, fr, nfr — and any subset the chips can ask for
// becomes one exact token match. The whole token space is 11 values, so a
// trade's deduped array stays tiny no matter how many pets it holds.
//
// Written by the create-trade flow (HomeScreen) and by scripts/backfill-variant-tags.js.
const VARIANT_TOKEN_ORDER = ['n', 'm', 'f', 'r'];
const VARIANT_KEY_TO_LETTER = { neon: 'n', mega: 'm', fly: 'f', ride: 'r' };

// Value type first, then f, then r — a fixed order so the writer and the querier
// can never disagree about how a combination is spelled.
const toToken = (letters) =>
  VARIANT_TOKEN_ORDER.filter((l) => letters.includes(l)).join('');

const itemVariantLetters = (item) => {
  if (!item) return [];
  const letters = [];
  const valueType = String(item.valueType || '').toLowerCase();
  if (valueType === 'n' || valueType === 'm') letters.push(valueType);
  if (item.isFly) letters.push('f');
  if (item.isRide) letters.push('r');
  return letters;
};

const combinationsOf = (letters) => {
  const out = [];
  for (let mask = 1; mask < (1 << letters.length); mask++) {
    out.push(toToken(letters.filter((_, i) => mask & (1 << i))));
  }
  return out;
};

// Denormalized tag array stored on each trade doc, covering both sides of the trade.
export const buildVariantTags = (...itemLists) => {
  const tags = new Set();
  itemLists.flat().filter(Boolean).forEach((item) => {
    combinationsOf(itemVariantLetters(item)).forEach((token) => tags.add(token));
  });
  return [...tags];
};

// Turns the selected filter chips into the single token to match server-side.
// Returns null when no variant chip is active, so callers can skip the clause.
export const variantFilterToken = (filterKeys = []) => {
  const letters = filterKeys.map((k) => VARIANT_KEY_TO_LETTER[k]).filter(Boolean);
  return letters.length ? toToken(letters) : null;
};

// Client-side equivalent of the array-contains clause, used ONLY in text-search
// mode: Firestore permits a single array-contains per query and the search
// already spends it on hasItemNames/wantsItemNames.
export const tradeMatchesVariants = (trade, filterKeys = []) => {
  const letters = filterKeys.map((k) => VARIANT_KEY_TO_LETTER[k]).filter(Boolean);
  if (!letters.length) return true;
  return [...(trade?.hasItems || []), ...(trade?.wantsItems || [])]
    .filter(Boolean)
    .some((item) => {
      const own = itemVariantLetters(item);
      return letters.every((l) => own.includes(l));
    });
};

// Search and tags applied together: the pet that matched the typed name must ALSO
// carry every selected tag, and be on the side(s) being searched. Searching
// "shadow dragon" with Neon on means a neon Shadow Dragon — not a trade holding a
// Shadow Dragon and, separately, some unrelated neon pet.
export const tradeMatchesSearchWithVariants = (trade, searchTermLower, filterKeys = [], sides = {}) => {
  const letters = filterKeys.map((k) => VARIANT_KEY_TO_LETTER[k]).filter(Boolean);
  const { inHas = true, inWants = true } = sides;
  const items = [
    ...(inHas ? (trade?.hasItems || []) : []),
    ...(inWants ? (trade?.wantsItems || []) : []),
  ].filter(Boolean);

  return items.some((item) => {
    const name = String(item.name || item.Name || '').toLowerCase();
    if (searchTermLower && !name.includes(searchTermLower)) return false;
    if (!letters.length) return true;
    const own = itemVariantLetters(item);
    return letters.every((l) => own.includes(l));
  });
};
