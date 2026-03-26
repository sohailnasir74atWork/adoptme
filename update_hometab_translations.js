const fs = require('fs');
const path = require('path');

const locales = ['ar', 'de', 'en', 'es', 'fr'];

const newKeys = {
  "trending": {
    "market_overview": "📊 Market Overview",
    "full_analytics": "Full Analytics",
    "hot": "Hot",
    "dropping": "Dropping"
  },
  "status_feed": {
    "anonymous": "Anonymous",
    "you": "You",
    "error": "Error",
    "pick_image_error": "Could not open photo library.",
    "pick_failed": "Failed to pick image. Please try again.",
    "empty_status_title": "Empty Status",
    "empty_status_msg": "Please add some text or an image.",
    "upload_failed_title": "Upload Failed",
    "upload_failed_msg": "Could not upload image. Please try again.",
    "post_error": "Could not post status. Try again.",
    "delete_title": "Delete Status",
    "delete_confirm": "Are you sure?",
    "cancel": "Cancel",
    "delete": "Delete",
    "delete_error": "Could not delete status.",
    "views_count": "{{count}} views",
    "reactions_count": "{{count}} reactions",
    "new_status": "📝 New Status",
    "add_photo": "Add Photo",
    "placeholder": "What's on your mind?",
    "uploading": "Uploading...",
    "post_status": "Post Status ✨",
    "time_just_now": "Just now",
    "time_min_ago": "{{count}}m ago",
    "time_hour_ago": "{{count}}h ago",
    "time_day_ago": "{{count}}d ago"
  },
  "spin_wheel": {
    "title": "🎡 Daily Spin",
    "subtitle": "Spin to win XP!",
    "xp_added": "Added to your XP!",
    "spinning": "Spinning...",
    "spin": "SPIN!",
    "spin_left": "SPIN! ({{count}} left)",
    "come_back": "Come back tomorrow!",
    "loading_ad": "Loading Ad...",
    "watch_ad_spins": "🎬 Watch Ad for 2 Extra Spins!"
  },
  "daily_quiz": {
    "title": "🧠 Daily Quiz",
    "loading": "Loading...",
    "pet_trivia": "Pet Trivia!",
    "instructions": "5 questions • {{seconds}}s per question • +{{xp}} XP each",
    "best_score": "🏆 Best: {{score}}/5",
    "start": "Start Quiz!",
    "score": "Score: {{current}}/{{total}}",
    "result_perfect": "Perfect!",
    "result_great": "Great job!",
    "result_nice": "Nice try!",
    "correct_count": "{{count}}/5 correct",
    "xp_earned": "+{{xp}} XP earned!",
    "xp_earned_bonus": "+{{xp}} +{{bonus}} bonus XP earned!",
    "come_back": "Come back tomorrow!",
    "done": "Done",
    "loading_ad": "Loading Ad...",
    "watch_ad": "🎬 Watch Ad for Extra Quiz!"
  },
  "memory_match": {
    "title": "🃏 Memory Match",
    "pet_memory": "Pet Memory!",
    "instructions": "Match {{count}} pet pairs! Fewer moves = more stars ⭐",
    "plays_left": "{{count}} plays left today",
    "best_moves": "🏆 Best: {{count}} moves",
    "play": "Play!",
    "memorize": "👀 Memorize the cards! {{count}}s...",
    "shuffling": "🃏 Shuffling cards...",
    "moves": "Moves: {{count}}",
    "matched": "Matched: {{current}}/{{total}}",
    "result_amazing": "Amazing!",
    "result_great": "Great!",
    "result_good": "Good job!",
    "game_over": "Game Over",
    "total_moves": "{{count}} moves",
    "xp_earned": "+{{xp}} XP earned!",
    "play_again": "Play Again! ({{count}} left)",
    "come_back": "Come back tomorrow!",
    "loading_ad": "Loading Ad...",
    "watch_ad": "🎬 Watch Ad for 2 Extra Games!"
  },
  "home_tab": {
    "share_message": "Check out Adopt Me Values Calculator! 🐾\n{{link}}",
    "xp_level_sub": "Lv.{{level}} · {{xp}} XP",
    "two_player": "2P"
  }
};

for (const lang of locales) {
  const filePath = path.join(__dirname, 'Code', 'Translation', `${lang}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    for (const [section, keys] of Object.entries(newKeys)) {
      if (!data[section]) {
        data[section] = keys;
      } else {
        // Merge without overwriting existing keys
        for (const [key, value] of Object.entries(keys)) {
          if (data[section][key] === undefined) {
            data[section][key] = value;
          }
        }
      }
    }
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
    console.log(`Updated ${lang}.json`);
  }
}
