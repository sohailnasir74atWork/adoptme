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
    const supabase = getSupabaseAdmin();

    const payload = {
      room_id: 'public:en',
      sender_id: 'bot-system-update',
      sender_name: 'System',
      text: `🟢 New Update Out! — 5 May 26\n\nSeeing issues in chat or the Buy section? We just fixed it!\n\nUpdate the app now to get the fix 👇\n\n📱 Android:\nhttps://play.google.com/store/apps/details?id=com.adoptmevaluescalc&hl=en\n\n🍎 iPhone:\nhttps://apps.apple.com/us/app/pet-folio-adoptme-values/id6745400111\n\nJust tap your store link and hit Update! 🚀`,
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
