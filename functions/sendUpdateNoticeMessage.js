const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getSupabaseAdmin } = require('./_supabaseAdmin');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

exports.sendUpdateNoticeMessage = functions
  .runWith({ secrets: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] })
  .pubsub
  .schedule('every 5 minutes')
  .timeZone('Asia/Karachi')
  .onRun(async () => {
    // Auto-stop after bridge removal date (see CHAT_BRIDGE_2DAY.md).
    if (Date.now() > Date.parse('2026-05-19T00:00:00+05:00')) {
      console.log('⏹️ Update notice expired (post 2026-05-18) — skipping.');
      return null;
    }

    const supabase = getSupabaseAdmin();

    const payload = {
      room_id: 'public:en',
      sender_id: 'bot-system-update',
      sender_name: 'System',
      text: `⚠️ Can't send messages in group or private chat?\n\nThat means you're on an older version of the app. We've switched chat to a new, faster database, and only the latest version works now.\n\nPlease update your app to keep chatting 👇\n\n📱 Android:\nhttps://play.google.com/store/apps/details?id=com.adoptmevaluescalc&hl=en\n\n🍎 iPhone:\nhttps://apps.apple.com/us/app/pet-folio-adoptme-values/id6745400111\n\nThe new version is already live on both stores. Tap your store link and hit Update! 🚀`,
      contains_link: true,
      sender_profile: {
        avatar: 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
        isPro: false,
        robloxUsernameVerified: false,
        topBadge: null,
        hasRecentGameWin: false,
        profileFrame: null,
        chatTextColor: null,
        chatBubbleBg: {
          color: '#d1fae5',
          darkColor: '#065f46',
          expiresAt: -1,
        },
      },
      role_flags: {
        isAdmin: true,
        isModerator: false,
        isBabyMod: false,
        isTrusted: false,
        isCMSR: false,
        isHelper: false,
      },
    };

    try {
      const { error } = await supabase.from('messages').insert(payload);
      if (error) throw error;
      console.log('✅ Update notice message sent to Supabase public chat.');
    } catch (error) {
      console.error('❌ Failed to send update notice message:', error);
    }

    return null;
  });
