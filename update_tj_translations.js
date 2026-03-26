const fs = require('fs');
const path = require('path');

const locales = ['ar', 'de', 'en', 'es', 'fr'];
const tradeJournalKeys = {
  "tabs": {
    "my_pets": "My Pets",
    "goals": "Goals",
    "active_trade": "Active Trade",
    "done_trades": "Done Trades"
  },
  "results": {
    "i_won": "I Won!",
    "even": "Even",
    "i_lost": "I Lost"
  },
  "alerts": {
    "clear_history_title": "Clear Trade History?",
    "clear_history_msg": "This will delete all your trade history records. Your pets and active trades will not be affected.",
    "cancel": "Cancel",
    "clear_all": "Clear All",
    "done": "Done!",
    "history_cleared": "Trade history cleared.",
    "error": "Error",
    "could_not_clear": "Could not clear history.",
    "delete_trade_title": "Delete this trade?",
    "delete_trade_msg": "This will remove this active trade.",
    "delete": "Delete",
    "could_not_delete": "Could not delete trade.",
    "delete_all_active_title": "Delete All Active Trades?",
    "delete_all_active_msg": "This will remove all your active trades. This cannot be undone.",
    "delete_all": "Delete All",
    "all_active_deleted": "All active trades deleted.",
    "remove_pet_title": "Remove pet?",
    "remove_pet_msg": "Are you sure?",
    "keep_it": "Keep it",
    "remove": "Remove",
    "add_items_title": "Add items on both sides!",
    "add_items_msg": "You need items in both 'I GAVE' and 'I GOT' to complete a trade.",
    "heads_up": "Heads up! 🐾",
    "not_owned_msg_pl": "You sold {{names}}, but they were not in your My Stuff list, so we couldn't remove them from the list.\n\nHowever, your trade was saved successfully! ✅",
    "not_owned_msg_sg": "You sold {{names}}, but it was not in your My Stuff list, so we couldn't remove it from the list.\n\nHowever, your trade was saved successfully! ✅",
    "trade_saved": "🎉 Trade Saved!",
    "active_trades_info_title": "⚡ Active Trades",
    "active_trades_info_msg": "These are trades you set up in the Calculator.\n\n✅ Tap 'Done!' to complete a trade & add it to your History\n✏️ Tap 'Edit' to change items before completing\n🗑️ Tap 'Delete' to remove a trade\n\nCompleted trades auto-update your pet inventory!"
  },
  "my_pets": {
    "worth": "MY PETS ARE WORTH",
    "pets_count": "{{count}} pets 🐾",
    "power_strong": "Trading Power: Strong 💪",
    "power_decent": "Trading Power: Decent ⚡",
    "power_weak": "Trading Power: Weak",
    "add_pet": "+ Add a Pet!",
    "empty_title": "No pets yet!",
    "empty_sub": "Tap + to add your first pet! 🐾"
  },
  "goals": {
    "add_dream": "+ Add Dream Pet!",
    "empty_title": "What pet do you dream about?",
    "empty_sub": "Add your dream pets here! ⭐",
    "diff_easy": "Easy",
    "diff_medium": "Medium",
    "diff_hard": "Hard",
    "diff_very_hard": "Very Hard",
    "tip_trade_for": "Trade your {{name}} for this!",
    "tip_close": "Your {{name}} is close! Add {{gap}} more in value",
    "tip_combo": "Try trading: {{combo}}",
    "tip_add_first": "Add your pets in My Pets tab first!",
    "tip_keep_trading": "Keep trading up! You need higher-value pets",
    "tip_getting_closer": "You're getting closer! Keep upgrading your pets",
    "demand_high": "🔥 High",
    "demand_mid": "📊 Mid",
    "demand_low": "📉 Low"
  },
  "active": {
    "i_give": "I GIVE",
    "i_get": "I GET",
    "edit_hint": "Tap a pet to remove it • Tap + to add",
    "how_did_it_go": "How did it go?",
    "cancel": "Cancel",
    "save_trade": "✅ Save Trade",
    "done": "✅ Done!",
    "edit": "✏️ Edit",
    "delete": "Delete",
    "how_it_works": "How it works",
    "delete_all": "Delete All",
    "empty_title": "No active trades yet!",
    "empty_sub": "Here's how it works:\n\n1️⃣  Go to the Calculator\n2️⃣  Add pets you want to trade\n3️⃣  Your trade shows up here\n4️⃣  Tap 'Done!' when you've traded in-game\n\nYour pet inventory updates automatically! 🎒",
    "load_more": "Load More ⬇️"
  },
  "timeline": {
    "today": "Today",
    "yesterday": "Yesterday",
    "days_ago": "{{count}} days ago",
    "scam": "Scam",
    "i_gave": "I GAVE",
    "i_got": "I GOT",
    "smart_trade": "🧠 Smart — you got {{got}} (demand {{gotD}}/10) for less popular pets",
    "bad_trade": "⚠️ You traded away {{gave}} (demand {{gaveD}}/10) for less popular pets",
    "fair_swap": "⚖️ Fair swap — both sides had high-demand pets",
    "delete": "Delete",
    "trade_results": "📊 Trade Results",
    "win": "Win",
    "fair": "Fair",
    "loss": "Loss",
    "total_trades": "Total Trades",
    "win_rate": "Win Rate",
    "net_value": "Net Value",
    "smart_trader": "🧠 Smart Trader — You acquire high-demand pets!",
    "generous_trader": "🎁 Generous Trader — You share high-demand pets!",
    "clear_history": "Clear History",
    "empty_title": "No trades yet!",
    "empty_sub": "Go trade some pets! 🐾"
  }
};

for (const lang of locales) {
  const filePath = path.join(__dirname, 'Code', 'Translation', `${lang}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!data.trade_journal) {
        data.trade_journal = tradeJournalKeys;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
        console.log(`Updated ${lang}.json`);
    } else {
        data.trade_journal = { ...tradeJournalKeys, ...data.trade_journal };
        fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
        console.log(`Merged ${lang}.json`);
    }
  }
}
