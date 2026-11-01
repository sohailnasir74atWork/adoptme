/**
 * miniGames.js
 * The Mini Games list shared by the Home tab card and the Game Hub screen.
 * Kept apart from GameHub.js so the Home tab does not load the game screens.
 *
 * Icons are images from assets/mini-games (scripts/mini-games/make-icons.mjs).
 */

export const GAME_ICONS = {
  controller: require('../../assets/mini-games/controller.png'),
  ice: require('../../assets/mini-games/ice.png'),
  quiz: require('../../assets/mini-games/quiz.png'),
  memory: require('../../assets/mini-games/memory.png'),
  scramble: require('../../assets/mini-games/scramble.png'),
  arrow: require('../../assets/mini-games/arrow.png'),
  battle: require('../../assets/mini-games/battle.png'),
  showdown: require('../../assets/mini-games/showdown.png'),
  runway: require('../../assets/mini-games/runway.png'),
};

// Labels live under mini_games.<id>_name / _desc / _short in the translations.
export const GAMES = [
  { id: 'runway', color: '#FF4F9A', tag: 'tag_create' },
  { id: 'ice', color: '#0EA5E9', tag: 'tag_free_daily' },
  { id: 'quiz', color: '#8B5CF6', tag: 'tag_free_daily' },
  { id: 'memory', color: '#10B981', tag: 'tag_free_daily' },
  { id: 'scramble', color: '#F59E0B', tag: 'tag_free_daily' },
  { id: 'arrow', color: '#3B82F6', tag: 'tag_levels' },
];

// Two-player live games (invite someone online). Each is its own stack screen.
export const FRIEND_GAMES = [
  { id: 'quiz_battle', icon: 'battle', color: '#A855F7', screen: 'QuizBattleScreen' },
  { id: 'trade_showdown', icon: 'showdown', color: '#F59E0B', screen: 'TradeShowdownScreen' },
];

/** Open a game from anywhere: Pet Runway and the Arrow Puzzle are screens, the rest open inside the Game Hub. */
export const openMiniGame = (navigation, id) => {
  if (id === 'runway') navigation.navigate('PetRunway');
  else if (id === 'arrow') navigation.navigate('ArrowGameScreen');
  else navigation.navigate('GameHub', { open: id });
};
