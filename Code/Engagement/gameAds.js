/**
 * gameAds.js
 * The "watch a video for more plays" call shared by the mini games.
 *
 * Resolves to 'earned', 'closed' (video skipped, no reward) or 'unavailable'
 * (no fill, or the 30 s cooldown after the last rewarded ad). The games show
 * the outcome as an inline note under the button: a flash message would sit
 * behind the game's Modal on iOS, so the player would never see why nothing
 * happened.
 */
import RewardedAdManager from '../Ads/RewardedAdManager';

export const watchGameAd = () =>
  new Promise((resolve) => {
    RewardedAdManager.showWithCallback(
      () => resolve('earned'),
      () => resolve('closed'),
      () => resolve('unavailable'),
    );
  });

/** Translation key for the note under the button, or null when there is nothing to say. */
export const adNoteKey = (outcome) =>
  outcome === 'closed' ? 'mini_games.ad_closed_early'
    : outcome === 'unavailable' ? 'mini_games.ad_unavailable'
      : null;
