const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

/**
 * Scheduled function that runs every 3 minutes.
 * Sends a deprecation countdown message to chat telling users
 * they are on an older version and chat support will end in 3 days.
 * Each message shows the remaining time (countdown).
 */
exports.sendDeprecationCountdown = functions.pubsub
  .schedule('every 3 minutes')
  .timeZone('Asia/Karachi')
  .onRun(async () => {
    const db = admin.database();
    const chatRef = db.ref('chat_new');
    const configRef = db.ref('deprecation_config');

    // --- Get or set the start timestamp ---
    let snapshot = await configRef.once('value');
    let config = snapshot.val();

    if (!config || !config.startTimestamp) {
      // First run – set the 3-day countdown start time
      const now = Date.now();
      await configRef.set({
        startTimestamp: now,
        durationMs: 3 * 24 * 60 * 60 * 1000, // 3 days in ms
      });
      config = { startTimestamp: now, durationMs: 3 * 24 * 60 * 60 * 1000 };
    }

    const { startTimestamp, durationMs } = config;
    const deadline = startTimestamp + durationMs;
    const now = Date.now();
    const remainingMs = deadline - now;

    // --- If countdown is over, send a final message and stop ---
    if (remainingMs <= 0) {
      const finalMessage = {
        text: `🚫 CHAT SUPPORT HAS ENDED FOR THIS VERSION\n\n` +
          `You are using an outdated version of the app. Chat is no longer available on this version.\n\n` +
          `Please update to the latest version now:\n\n` +
          `📱 Android: https://play.google.com/store/apps/details?id=com.adoptmevaluescalc&hl=en\n\n` +
          `🍎 iOS: https://apps.apple.com/us/app/pet-folio-adoptme-values/id6745400111\n\n` +
          `⚠️ If you don't see an update available on the store, please UNINSTALL the app completely and then INSTALL it fresh from the store link above. This will give you the latest version.\n\n` +
          `Thank you for your patience! 🙏`,
        timestamp: Date.now(),
        sender: 'System',
        senderId: 'bot-system-deprecation',
        avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        reportCount: 0,
        containsLink: true,
        isPro: false,
        isAdmin: true,
      };

      try {
        await chatRef.push(finalMessage);
        console.log('🚫 Final deprecation message sent – countdown is over.');
      } catch (error) {
        console.error('❌ Failed to send final deprecation message:', error);
      }

      return null;
    }

    // --- Calculate human-readable remaining time ---
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    let timeString = '';
    if (days > 0) {
      timeString += `${days} day${days !== 1 ? 's' : ''}`;
    }
    if (hours > 0) {
      timeString += `${timeString ? ', ' : ''}${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    if (minutes > 0) {
      timeString += `${timeString ? ', ' : ''}${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    if (!timeString) {
      timeString = 'less than a minute';
    }

    // --- Build the countdown message ---
    const message = {
      text: `⚠️ IMPORTANT: You are using an older version of the app!\n\n` +
        `If you are seeing this message, it means you need to update.\n\n` +
        `⏳ Chat support will END for this version in: ${timeString}\n\n` +
        `Please update to the latest version now:\n\n` +
        `📱 Android: https://play.google.com/store/apps/details?id=com.adoptmevaluescalc&hl=en\n\n` +
        `🍎 iOS: https://apps.apple.com/us/app/pet-folio-adoptme-values/id6745400111\n\n` +
        `👆 Tap the link above for your device to update.\n\n` +
        `⚠️ If you don't see an update available on the store, please UNINSTALL the app completely and then INSTALL it fresh from the store link above. This will ensure you get the latest version.\n\n` +
        `Don't miss out — update now before chat support ends! 🚀`,
      timestamp: Date.now(),
      sender: 'System',
      senderId: 'bot-system-deprecation',
      avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
      reportCount: 0,
      containsLink: true,
      isPro: false,
      isAdmin: true,
    };

    try {
      await chatRef.push(message);
      console.log(`✅ Deprecation countdown message sent. Time remaining: ${timeString}`);
    } catch (error) {
      console.error('❌ Failed to send deprecation countdown message:', error);
    }

    return null;
  });
