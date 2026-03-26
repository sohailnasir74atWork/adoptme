const fs = require('fs');
const path = require('path');

const locales = ['ar', 'de', 'en', 'es', 'fr'];
const badgesScreenKeys = {
  "xp": {
    "level_and_xp": "Level {{level}} • {{xp}} XP",
    "next": "NEXT",
    "max_level": "🎉 Max Level!",
    "to_next_level": "{{xp}} XP to next level"
  },
  "badge": {
    "earned": "✓ Earned"
  },
  "level": {
    "title_format": "Lv.{{level}} — {{title}}",
    "xp": "{{xp}} XP",
    "you": "YOU"
  },
  "actions": {
    "title": "⚡ How to Earn XP",
    "daily_login": "📅 Daily Login",
    "complete_trade": "🤝 Complete Trade",
    "create_post": "📸 Create Post",
    "leave_review": "📝 Leave Review",
    "quiz_answer": "🧠 Quiz Answer",
    "memory_win": "🃏 Memory Win",
    "update_pets": "🐾 Update Pets",
    "streak_7_day": "🔥 7-Day Streak",
    "post_status": "📣 Post Status"
  },
  "streak": {
    "title": "🔥 Daily Streak",
    "claim": "⭐ Claim Stars!",
    "view": "⭐ View Stars"
  },
  "main": {
    "header_title": "Badges & Achievements"
  },
  "tiers": {
    "elite_label": "✨ Elite",
    "elite_desc": "The hardest to earn",
    "pro_label": "🔥 Pro",
    "pro_desc": "Show your dedication",
    "starter_label": "🌱 Starter",
    "starter_desc": "Start your journey"
  },
  "roadmap": {
    "title": "📈 Level Roadmap"
  },
  "share": {
    "btn_text": "Share My Badges"
  },
  "share_card": {
    "title": "My Adopt Me Badges!",
    "default_name": "Pet Lover",
    "more": "more",
    "empty": "Just getting started! 🌱",
    "progress": "🏆 {{earned}}/{{total}} badges collected!"
  }
};

for (const lang of locales) {
  const filePath = path.join(__dirname, 'Code', 'Translation', `${lang}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.badges_screen) {
        data.badges_screen = badgesScreenKeys;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
        console.log(`Updated ${lang}.json`);
    } else {
        data.badges_screen = { ...badgesScreenKeys, ...data.badges_screen };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
        console.log(`Merged ${lang}.json`);
    }
  }
}
