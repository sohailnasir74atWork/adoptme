const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

exports.sendScheduledPromoMessageMM2 = functions.pubsub
  .schedule('every 20 minutes')
  .timeZone('Asia/Karachi')
  .onRun(async () => {
    const db = admin.database();
    const chatRef = db.ref('chat_new');

    const message = {
      text: `🔪 Playing Murder Mystery 2?\n\nCheck out our new MM2 Values app for the latest accurate trades and values!\n\n📱 Android: https://play.google.com/store/apps/details?id=com.mm2tradesvalues\n\n🍎 iOS: https://apps.apple.com/us/app/mm2-values/id6747306748\n\n⭐ Available now on both stores!`,
      timestamp: Date.now(),
      sender: 'MM2 Promo',
      senderId: 'bot-system-mm2',
      avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
      reportCount: 0,
      containsLink: true,
      isPro: false,
      isAdmin: true,
    };

    try {
      await chatRef.push(message);
      console.log('✅ MM2 Promo message sent to chat.');
    } catch (error) {
      console.error('❌ Failed to send MM2 promo message:', error);
    }

    return null;
  });
