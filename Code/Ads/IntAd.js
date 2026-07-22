// InterstitialAdManager.js - single warm instance, Pro-gated, bounded retries
import {
  InterstitialAd,
  AdEventType,
} from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { ensureAdsInitialized } from './init';
import { setFullScreenAdVisible } from './adVisibility';

const interstitialAdUnitId = getAdUnitId('interstitial');

// isPro read straight from MMKV (same pattern as openApp.js). Every showAd()
// call site already checks isPro before calling, so a Pro user can never be
// shown an interstitial — which made the old unconditional preload pure
// auction waste (fills that could not ever become impressions). AdMob show
// rate for this unit was ~3%; roughly half of that came from preloading two
// instances for everyone on every launch.
let storage = null;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV();
} catch (_) {}
const isProUser = () => {
  try {
    return storage ? storage.getBoolean('isPro') === true : false;
  } catch (_) {
    return false;
  }
};

class InterstitialAdManager {
  // Single ad instance. The old A/B dual-instance (primary + game unit)
  // doubled fills per session while only one could ever be shown — halving
  // the unit's show rate for zero measured eCPM difference between the units.
  static ad = null;
  static isLoaded = false;
  static isLoading = false;
  static hasInitialized = false;
  static unsubscribeEvents = [];

  static retryCount = 0;
  static maxRetries = 5;

  // ✅ Wait timeout for ad to load (improves show rate)
  static WAIT_TIMEOUT_MS = 3000;

  // ✅ Global frequency cap. There are ~15 interstitial call sites across the
  // app firing independently (search, upload, post, save, share…). Without a
  // shared cooldown, two quick actions (e.g. two searches in a row) serve two
  // back-to-back interstitials — ad fatigue, lower eCPM, and AdMob
  // ad-serving-limit risk. When inside the cooldown we skip the ad and run the
  // caller's callback immediately so content is never blocked.
  static lastShownAt = 0;
  static COOLDOWN_MS = 30000;

  static init() {
    if (this.hasInitialized) return;
    // ✅ Mark initialized synchronously so re-entry / show() before the async
    // init resolves doesn't double-attach listeners or re-load.
    this.hasInitialized = true;

    // Pro users never see interstitials — skip the warm load entirely. If the
    // user loses Pro later, the first showAd()/prepare() lazily creates the ad.
    if (isProUser()) return;

    // ✅ Config-before-load: await the shared AdMob init (consent →
    // setRequestConfiguration → initialize) so the first ad request already
    // respects maxAdContentRating 'T' and the user's consent choices.
    ensureAdsInitialized()
      .then(() => this._createAndLoad())
      .catch(() => {
        // If init somehow rejects, still attempt to load so ads aren't dead.
        this._createAndLoad();
      });
  }

  static _createAndLoad() {
    if (this.ad) {
      this._load();
      return;
    }
    this.ad = InterstitialAd.createForAdRequest(interstitialAdUnitId);

    const onLoaded = this.ad.addAdEventListener(AdEventType.LOADED, () => {
      this.isLoaded = true;
      this.isLoading = false;
      this.retryCount = 0;
    });

    const onError = this.ad.addAdEventListener(AdEventType.ERROR, () => {
      this.isLoaded = false;
      this.isLoading = false;
      this._retryLoad();
    });

    this.unsubscribeEvents = [onLoaded, onError];
    this._load();
  }

  static _load() {
    if (this.isLoaded || this.isLoading || !this.ad) return;
    this.isLoading = true;
    try {
      this.ad.load();
    } catch (_) {
      this.isLoading = false;
      this._retryLoad();
    }
  }

  // ✅ Bounded retry with backoff (1s, 2s, 4s, 8s, 16s), then STOP. The old
  // infinite 15s loop burned no-fill requests all session in zero-fill geos,
  // dragging match rate down and inviting ad-serving limits. Loading resumes
  // naturally on the next user signal: prepare(), showAd(), or a
  // show-completion reload.
  static _retryLoad() {
    if (this.retryCount >= this.maxRetries) return;
    const delay = Math.pow(2, this.retryCount) * 1000;
    setTimeout(() => {
      this.retryCount += 1;
      this._load();
    }, delay);
  }

  // ✅ Proximity preload: call when a show is likely soon. Idempotent and
  // cheap — no-ops when an ad is already loaded/loading. Also un-sticks a
  // manager whose bounded retries ran out.
  static prepare() {
    if (!this.hasInitialized) {
      this.init();
      return;
    }
    if (isProUser() || this.isLoaded || this.isLoading) return;
    this.retryCount = 0;
    if (this.ad) this._load();
    else this._createAndLoad();
  }

  // ✅ Show ad. Same contract as before: caller's callback always runs, and
  // content is never gated on ad availability.
  static showAd(onAdClosedCallback, onAdUnavailableCallback) {
    if (!this.hasInitialized) {
      this.init();
    }

    // ✅ Global frequency cap: inside the cooldown window, skip the ad and let
    // the caller proceed immediately (content is never gated on the ad).
    if (Date.now() - this.lastShownAt < this.COOLDOWN_MS) {
      if (typeof onAdClosedCallback === 'function') onAdClosedCallback();
      return;
    }

    if (this.isLoaded && this.ad) {
      this._show(onAdClosedCallback);
      return;
    }

    // ✅ Ad not ready - wait for one to load (up to WAIT_TIMEOUT_MS). This
    // converts near-miss triggers into shows instead of instantly giving up.
    this.waitForAdAndShow(onAdClosedCallback, onAdUnavailableCallback);
  }

  // ✅ Wait for the ad to load before giving up (improves show rate)
  static waitForAdAndShow(onAdClosedCallback, onAdUnavailableCallback) {
    const startTime = Date.now();

    // ✅ Trigger a load if not already loading (also resets exhausted retries)
    this.prepare();

    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      if (this.isLoaded && this.ad) {
        clearInterval(checkInterval);
        this._show(onAdClosedCallback);
        return;
      }

      // ✅ Timeout reached - give up
      if (elapsed >= this.WAIT_TIMEOUT_MS) {
        clearInterval(checkInterval);

        if (typeof onAdUnavailableCallback === 'function') {
          onAdUnavailableCallback();
        } else if (typeof onAdClosedCallback === 'function') {
          onAdClosedCallback();
        }
      }
    }, 100); // Check every 100ms
  }

  static _show(onAdClosedCallback) {
    // ✅ Mark as not loaded BEFORE showing to prevent double-show
    this.isLoaded = false;
    this.lastShownAt = Date.now();
    setFullScreenAdVisible(true);

    const unsubscribeClose = this.ad.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        setFullScreenAdVisible(false);
        // Preload the next one: the user just proved they hit ad triggers,
        // so a warm follow-up is justified (unlike blind preloading).
        this._load();

        if (typeof onAdClosedCallback === 'function') {
          onAdClosedCallback();
        }
        unsubscribeClose();
      }
    );

    try {
      this.ad.show();
    } catch (error) {
      setFullScreenAdVisible(false);
      unsubscribeClose();
      this._load();
      if (typeof onAdClosedCallback === 'function') {
        onAdClosedCallback();
      }
    }
  }

  // ✅ Check if the ad is available
  static isReady() {
    return this.isLoaded;
  }

  // ✅ Force reload (useful after network recovery)
  static forceReload() {
    this.retryCount = 0;
    if (this.ad) this._load();
    else if (this.hasInitialized && !isProUser()) this._createAndLoad();
  }

  static cleanup() {
    this.unsubscribeEvents.forEach((unsubscribe) => {
      try { unsubscribe(); } catch (_) {}
    });
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
    this.isLoaded = false;
    this.isLoading = false;
    this.ad = null;
  }
}

export default InterstitialAdManager;
