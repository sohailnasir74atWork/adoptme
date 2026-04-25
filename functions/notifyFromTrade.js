// functions/notifyFromTrade.js
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();

const itemKeyOf = (name) => String(name || '').replace(/[^a-zA-Z0-9]/g, '_');

exports.notifyFromTrade = functions.firestore
  .document('trades_new/{tradeId}')
  .onCreate(async (snap, context) => {
    const trade = snap.data();
    const tradeId = context.params.tradeId;
    const db = admin.database();
    const messaging = admin.messaging();

    console.log('📦 New trade created:', tradeId);

    // For each trade item, look up matching subscribers via the reverse index.
    // Returns Map<userId, Set<itemName>>
    const matchSubscribers = async (side, tradeItems) => {
      const matched = new Map();
      const lookups = (tradeItems || []).map(async (it) => {
        const itemName = it?.name;
        if (!itemName) return;
        const key = itemKeyOf(itemName);
        const snap = await db.ref(`/notifier_index/${side}/${key}`).once('value');
        const users = snap.val();
        if (!users) return;
        for (const userId of Object.keys(users)) {
          if (!matched.has(userId)) matched.set(userId, new Set());
          matched.get(userId).add(itemName);
        }
      });
      await Promise.all(lookups);
      return matched;
    };

    const sendForSide = async (side, tradeItems, messageType) => {
      const matched = await matchSubscribers(side, tradeItems);
      if (matched.size === 0) {
        console.log(`ℹ️ No ${messageType} matches`);
        return;
      }
      console.log(`📡 ${messageType}: ${matched.size} user(s) to notify`);

      await Promise.all([...matched.entries()].map(async ([userId, itemSet]) => {
        const fcmSnap = await db.ref(`/users/${userId}/fcmToken`).once('value');
        const fcmToken = fcmSnap.val();
        if (!fcmToken) return;

        const namesString = [...itemSet].join(', ');
        const notification = {
          notification: {
            title: messageType === 'buy' ? 'Items Available to Buy!' : 'Someone Needs Your Items!',
            body: `🔥 Wow! ${namesString} matched and available for ${messageType === 'buy' ? 'buy' : 'sell'} now! Check trades.`,
          },
          data: { tradeId, type: messageType },
          token: fcmToken,
        };

        try {
          await messaging.send(notification);
          console.log(`✅ Notified ${userId} (${messageType}): ${namesString}`);
        } catch (error) {
          console.error(`❌ Failed to notify ${userId}`, error);
          if (error.code === 'messaging/registration-token-not-registered') {
            await db.ref(`/users/${userId}/fcmToken`).remove();
          }
        }
      }));
    };

    try {
      const hasItems = trade.hasItems || [];
      const wantsItems = trade.wantsItems || [];

      await Promise.all([
        sendForSide('buy', hasItems, 'buy'),
        sendForSide('sale', wantsItems, 'sale'),
      ]);
    } catch (err) {
      console.error('❌ Error processing new trade notification:', err);
    }

    return null;
  });
