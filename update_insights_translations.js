const fs = require('fs');
const path = require('path');

const locales = ['ar', 'de', 'en', 'es', 'fr'];
const insightsKeys = {
    "giving_wanted": "You're giving away super wanted pets!",
    "getting_wanted": "You're getting super popular pets!",
    "both_wanted": "Both sides have popular pets!",
    "getting_rising": "You're getting rising stars!",
    "giving_rising": "Heads up — your pets are rising!",
    "both_rising": "Both sides are going up!",
    "amazing_deal": "Amazing deal for you!",
    "good_value_want_yours": "Good value, but they really want yours!",
    "paying_extra": "Paying extra for dream pets!",
    "giving_a_lot": "Whoa, you're giving a lot!",
    "paying_more_similar": "Paying a bit more for similar pets",
    "fair_trade": "Super fair trade!",
    "yours_more_wanted": "Your pets are more wanted!",
    "theirs_more_wanted": "Their pets are more wanted!",
    "equally_wanted": "Both sides equally wanted!",
    "show_tips": "💡 Show tips"
};

const labelsKeys = {
    "me": "ME",
    "you": "YOU"
};

for (const lang of locales) {
  const filePath = path.join(__dirname, 'Code', 'Translation', `${lang}.json`);
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    if (!data.home) data.home = {};
    
    if (!data.home.insights) {
      data.home.insights = insightsKeys;
    } else {
      data.home.insights = { ...insightsKeys, ...data.home.insights };
    }

    if (!data.home.labels) {
      data.home.labels = labelsKeys;
    } else {
      data.home.labels = { ...labelsKeys, ...data.home.labels };
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
    console.log(`Updated ${lang}.json`);
  }
}
