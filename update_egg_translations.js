const fs = require('fs');
const path = require('path');

const locales = ['ar', 'de', 'en', 'es', 'fr'];
const mysteryEggKeys = {
  "alerts": {
    "locked_label": "LOCKED",
    "need_more_stars": "Need {{count}} more ⭐",
    "buy_prompt_msg": "Spend {{cost}} ⭐ Stars to hatch this egg?\\n\\nYou have ⭐ {{balance}} Stars",
    "nope": "Nope",
    "hatch_it": "Hatch! 🐣",
    "error_title": "Error 😢",
    "error_msg": "Something went wrong. Please try again.",
    "oops": "Oops! 😅",
    "failed_hatch": "Failed to hatch egg"
  },
  "rewards": {
    "reward_type_frame": "🖼️ Profile Frame",
    "reward_type_text_color": "🔤 Chat Text Color",
    "reward_type_trade_bg": "🃏 Trade Background",
    "reward_type_banner": "🌈 Profile Banner",
    "reward_type_chat_bg": "💬 Chat Bubble",
    "reward_type_cosmetic": "🎁 Cosmetic",
    "permanent": "Permanent! ✨",
    "active_for_days": "Active for {{count}} day",
    "active_for_days_plural": "Active for {{count}} days",
    "trade_bg_text": "Your Trade",
    "trade_bg_sub": "stands out! ✨",
    "banner_text": "Profile Banner",
    "chat_bg_text": "💬 Chat Bubble",
    "text_color_sample": "Hello! 🎉",
    "text_color_rainbow": "Cycles through rainbow"
  },
  "catalog": {
    "whats_inside": "📦 What's Inside?",
    "frames_title": "🖼️ Profile Frames",
    "frames_sub": "Unique avatar shapes!",
    "text_colors_title": "🔤 Chat Text Colors",
    "text_colors_sub": "Your messages stand out!",
    "trade_bgs_title": "🃏 Trade Backgrounds",
    "trade_bgs_sub": "Colorful trade cards!",
    "banners_title": "🌈 Profile Banners",
    "banners_sub": "Custom gradient on your profile!",
    "chat_bgs_title": "💬 Chat Bubbles",
    "chat_bgs_sub": "Custom chat backgrounds!",
    "hidden_reward": "??? {{rarity}}",
    "hidden_tease": "🔒 Hatch better eggs to discover hidden rewards!"
  },
  "screen": {
    "header_title": "Mystery Eggs",
    "header_sub": "Hatch to unlock cosmetics!",
    "hatched_label": "Hatched",
    "stars_spent_label": "Stars Spent",
    "pick_title": "Pick an Egg! 🐣",
    "pick_sub": "Better eggs = rarer rewards ✨",
    "watch_ad_loading": "⏳ Loading Ad...",
    "watch_ad_btn": "🎬 Watch Ad for Free Hatch!",
    "hatching_text": "✨ Cracking... ✨",
    "hatching_sub": "Something amazing is inside! 🤩",
    "reveal_title": "You got something amazing!",
    "hatch_another": "🥚 Hatch Another!",
    "done_btn": "Done 👋"
  }
};

for (const lang of locales) {
  const filePath = path.join(__dirname, 'Code', 'Translation', `${lang}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.mystery_egg) {
        data.mystery_egg = mysteryEggKeys;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
        console.log(`Updated ${lang}.json`);
    } else {
        data.mystery_egg = { ...mysteryEggKeys, ...data.mystery_egg };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
        console.log(`Merged ${lang}.json`);
    }
  }
}
