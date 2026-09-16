// Chat availability — two independent switches stored on users/{uid}:
//
//   chatOffTrade    true = not accepting chats opened from the Trades screen
//   chatOffGeneral  true = not accepting chats opened from anywhere else
//
// Which switch applies is decided by the DOOR the user came through, not by the
// conversation: there is only one thread per user pair (chatKey = a_b), so the
// same thread is "trade" when reached from a trade card and "general" when
// reached from the inbox, feed, leaderboard, online list or a profile.
//
// A switch blocks both directions — nobody can message you through that door,
// and you can't message anyone through it either.
//
// This module also carries the partner's dateOfBirth back to the chat screen.
// It is read here rather than in its own effect because RTDB multiplexes these
// leaf gets over the one open socket — folding it into the Promise.all below
// makes it a third tiny read in an existing round trip instead of a new one.
// See Helper/ageGate.js for what the screen does with it.
import { ref, get } from '@react-native-firebase/database';

export const CHAT_TYPE_TRADE = 'trade';
export const CHAT_TYPE_GENERAL = 'general';

// The only route that counts as the trade door. Every other private-chat route
// (PrivateChat, PrivateChatRoot, PrivateChatDesign) is general.
const TRADE_ROUTES = ['PrivateChatTrade'];

export const chatTypeForRoute = (routeName) =>
  TRADE_ROUTES.includes(routeName) ? CHAT_TYPE_TRADE : CHAT_TYPE_GENERAL;

export const unavailableFieldFor = (chatType) =>
  chatType === CHAT_TYPE_TRADE ? 'chatOffTrade' : 'chatOffGeneral';

const OPEN = { chatOffTrade: false, chatOffGeneral: false, dateOfBirth: null };

// Three tiny leaf reads instead of pulling the whole users/{uid} node, which is
// large and would cost real bandwidth on every chat open.
export const fetchChatAvailability = async (db, uid) => {
  if (!db || !uid) return { ...OPEN };
  try {
    const [tradeSnap, generalSnap, dobSnap] = await Promise.all([
      get(ref(db, `users/${uid}/chatOffTrade`)),
      get(ref(db, `users/${uid}/chatOffGeneral`)),
      get(ref(db, `users/${uid}/dateOfBirth`)),
    ]);
    return {
      chatOffTrade: tradeSnap.exists() ? !!tradeSnap.val() : false,
      chatOffGeneral: generalSnap.exists() ? !!generalSnap.val() : false,
      // null when absent — ageGate treats that as not-a-minor, and the server
      // trigger is the gate that actually matters.
      dateOfBirth: dobSnap.exists() ? dobSnap.val() : null,
    };
  } catch (e) {
    // Fail OPEN — a network hiccup must never silently block messaging.
    console.warn('[chatAvailability] read failed, treating as available:', e?.message);
    return { ...OPEN };
  }
};

// Resolves who (if anyone) has this door switched off. `me` and `them` are
// objects carrying the two flags; returns null when the chat is allowed.
export const resolveChatBlock = (chatType, me, them) => {
  const field = unavailableFieldFor(chatType);
  if (them && them[field]) return 'them';
  if (me && me[field]) return 'me';
  return null;
};
