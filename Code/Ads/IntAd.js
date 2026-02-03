// InterstitialAdManager.js - Optimized with A/B Testing & High Show Rate
import {
  InterstitialAd,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { Platform } from 'react-native';
import getAdUnitId from './ads';
import config from '../Helper/Environment';

// ✅ Two ad unit IDs for A/B testing
const interstitialAdUnitId = getAdUnitId('interstitial');
const gameInterstitialAdUnitId = Platform.OS === 'ios' 
  ? config.gameInterstitialIOS 
  : config.gameInterstitialAndroid;

class InterstitialAdManager {
  // ✅ Two ad instances for A/B testing
  static adA = InterstitialAd.createForAdRequest(interstitialAdUnitId);
  static adB = InterstitialAd.createForAdRequest(gameInterstitialAdUnitId);
  
  static isAdALoaded = false;
  static isAdBLoaded = false;
  static isAdALoading = false;
  static isAdBLoading = false;
  static hasInitialized = false;
  static unsubscribeEvents = [];

  static retryCountA = 0;
  static retryCountB = 0;
  static maxRetries = 5;
  
  // ✅ A/B test tracking (50/50 split)
  static abTestCounter = 0;
  
  // ✅ Wait timeout for ad to load (improves show rate)
  static WAIT_TIMEOUT_MS = 3000;
  
  static init() {
    if (this.hasInitialized) return;

    // ============ AD A (Primary Interstitial) ============
    const onAdALoaded = this.adA.addAdEventListener(
      AdEventType.LOADED,
      () => {
        this.isAdALoaded = true;
        this.isAdALoading = false;
        this.retryCountA = 0;
      }
    );

    const onAdAError = this.adA.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        this.isAdALoaded = false;
        this.isAdALoading = false;
        this.retryLoadAdA();
      }
    );

    // ============ AD B (Game Interstitial) ============
    const onAdBLoaded = this.adB.addAdEventListener(
      AdEventType.LOADED,
      () => {
        this.isAdBLoaded = true;
        this.isAdBLoading = false;
        this.retryCountB = 0;
      }
    );

    const onAdBError = this.adB.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        this.isAdBLoaded = false;
        this.isAdBLoading = false;
        this.retryLoadAdB();
      }
    );

    this.unsubscribeEvents = [onAdALoaded, onAdAError, onAdBLoaded, onAdBError];
    
    // ✅ Load both ads immediately
    this.loadAdA();
    this.loadAdB();
    
    this.hasInitialized = true;
  }

  // ✅ Safe load methods to prevent duplicate loading
  static loadAdA() {
    if (!this.isAdALoaded && !this.isAdALoading) {
      this.isAdALoading = true;
      this.adA.load();
    }
  }

  static loadAdB() {
    if (!this.isAdBLoaded && !this.isAdBLoading) {
      this.isAdBLoading = true;
      this.adB.load();
    }
  }

  // ✅ Retry with shorter delays (1s, 2s, 4s, 8s, 16s) then continue with 15s interval
  static retryLoadAdA() {
    if (this.retryCountA < this.maxRetries) {
      const delay = Math.pow(2, this.retryCountA) * 1000;
      setTimeout(() => {
        this.retryCountA += 1;
        this.loadAdA();
      }, delay);
    } else {
      // ✅ Continue retrying every 15 seconds (faster retry)
      setTimeout(() => {
        this.retryCountA = 0;
        this.loadAdA();
      }, 15000);
    }
  }

  static retryLoadAdB() {
    if (this.retryCountB < this.maxRetries) {
      const delay = Math.pow(2, this.retryCountB) * 1000;
      setTimeout(() => {
        this.retryCountB += 1;
        this.loadAdB();
      }, delay);
    } else {
      setTimeout(() => {
        this.retryCountB = 0;
        this.loadAdB();
      }, 15000);
    }
  }

  // ✅ Show ad with A/B testing, fallback, AND wait mechanism for higher show rate
  static showAd(onAdClosedCallback, onAdUnavailableCallback) {
    if (!this.hasInitialized) {
      this.init();
    }

    // ✅ Determine which ad to try first (A/B test: 50/50 split)
    this.abTestCounter += 1;
    const tryAdAFirst = this.abTestCounter % 2 === 0;

    // ✅ Try to show an ad with fallback to the other
    if (tryAdAFirst) {
      if (this.isAdALoaded) {
        this.showAdA(onAdClosedCallback);
        return;
      } else if (this.isAdBLoaded) {
        this.showAdB(onAdClosedCallback);
        return;
      }
    } else {
      if (this.isAdBLoaded) {
        this.showAdB(onAdClosedCallback);
        return;
      } else if (this.isAdALoaded) {
        this.showAdA(onAdClosedCallback);
        return;
      }
    }

    // ✅ Neither ad is ready - wait for one to load (up to WAIT_TIMEOUT_MS)
    this.waitForAdAndShow(onAdClosedCallback, onAdUnavailableCallback, tryAdAFirst);
  }

  // ✅ NEW: Wait for ad to load before giving up (improves show rate significantly)
  static waitForAdAndShow(onAdClosedCallback, onAdUnavailableCallback, tryAdAFirst) {
    const startTime = Date.now();
    
    // ✅ Trigger load if not already loading
    this.loadAdA();
    this.loadAdB();

    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;

      // ✅ Check if any ad is now ready
      if (tryAdAFirst) {
        if (this.isAdALoaded) {
          clearInterval(checkInterval);
          this.showAdA(onAdClosedCallback);
          return;
        } else if (this.isAdBLoaded) {
          clearInterval(checkInterval);
          this.showAdB(onAdClosedCallback);
          return;
        }
      } else {
        if (this.isAdBLoaded) {
          clearInterval(checkInterval);
          this.showAdB(onAdClosedCallback);
          return;
        } else if (this.isAdALoaded) {
          clearInterval(checkInterval);
          this.showAdA(onAdClosedCallback);
          return;
        }
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

  static showAdA(onAdClosedCallback) {
    // ✅ Mark as not loaded BEFORE showing to prevent double-show
    this.isAdALoaded = false;
    
    const unsubscribeClose = this.adA.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        this.loadAdA(); // Preload next immediately
        
        if (typeof onAdClosedCallback === 'function') {
          onAdClosedCallback();
        }
        unsubscribeClose();
      }
    );

    try {
      this.adA.show();
    } catch (error) {
      unsubscribeClose();
      this.loadAdA();
      if (typeof onAdClosedCallback === 'function') {
        onAdClosedCallback();
      }
    }
  }

  static showAdB(onAdClosedCallback) {
    // ✅ Mark as not loaded BEFORE showing to prevent double-show
    this.isAdBLoaded = false;
    
    const unsubscribeClose = this.adB.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        this.loadAdB(); // Preload next immediately
        
        if (typeof onAdClosedCallback === 'function') {
          onAdClosedCallback();
        }
        unsubscribeClose();
      }
    );

    try {
      this.adB.show();
    } catch (error) {
      unsubscribeClose();
      this.loadAdB();
      if (typeof onAdClosedCallback === 'function') {
        onAdClosedCallback();
      }
    }
  }

  // ✅ Check if any ad is available
  static isReady() {
    return this.isAdALoaded || this.isAdBLoaded;
  }

  // ✅ Force reload both ads (useful after network recovery)
  static forceReload() {
    this.isAdALoading = false;
    this.isAdBLoading = false;
    this.loadAdA();
    this.loadAdB();
  }

  static cleanup() {
    this.unsubscribeEvents.forEach((unsubscribe) => unsubscribe());
    this.unsubscribeEvents = [];
    this.hasInitialized = false;
    this.isAdALoaded = false;
    this.isAdBLoaded = false;
    this.isAdALoading = false;
    this.isAdBLoading = false;
  }
}

export default InterstitialAdManager;
