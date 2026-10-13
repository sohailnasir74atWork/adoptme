# Ads: google-mobile-ads 17.2 + Next-Gen, Adopt Me port

Branch `ads-v17-nextgen` (from `bump-android-138` @ fbdcf28), 2026-10-13.
Port of Blox Fruit commit f63089a. The design, audit and test checklist are in
`Blox_Fruit/ADS_V17_NEXTGEN_PLAN.md` (§2–4, §7.1); this file only records what
differs in Adopt Me. No version bump, nothing uploaded, not pushed.

## What changed

- `react-native-google-mobile-ads` 16.5.0 → **17.2.0** (exact, no patch).
  `app.json` `"android_sdk": "nextgen"` → Android on Next-Gen SDK 1.4.0.
  iOS: Google-Mobile-Ads-SDK 13.5.0 → 13.6.0 (classic, no Next-Gen on iOS).
- New, copied from Blox: `Code/Ads/fullscreenSource.js` (pool id prefix
  `adoptme-`), `adTelemetry.js`, `leaveAppGuard.js` (Blox 76df715 version:
  also wraps `PermissionsAndroid.request/requestMultiple`,
  `notifee.requestPermission` and RNFB messaging `requestPermission`, which
  covers the WRITE_EXTERNAL_STORAGE asks in CardWallpaper / HDwallpaper and
  the notification ask in Globelhelper).
- `adPolicy.js`: now identical to Blox (`APP_OPEN_EXPIRY_MS`,
  `USE_SDK_PRELOADER`, `reason`-aware `isNoFillError`).
- `IntAd.js`, `openApp.js`, `RewardedAdManager.js`: Blox's versions. Every
  caller's API still exists (`showAd`, `showAtNaturalBreak`, `prepare`,
  `init`, `show`, `showWithCallback`, `prepareColdStart`, `skipColdStart`,
  `start`, `noteHomeVisible`, `noteUserTouch`, `skipNextForeground`).
  `gameAds.js`, Trades boost, QuizBattle and TradeShowdown now get
  `onAdUnavailable` (not "closed early") when a present fails.
- `init.js`: shared `requestInfoUpdate` (`startConsentRefresh`, also from
  `canRequestAdsFromLastSession`), `consentFlow` tracking
  (`isConsentFlowActive` / `whenConsentFlowIdle`), `adsInitialized()`,
  `useAdsReady()`, `adLog('initialized')`. `gatherConsent()` stays inside
  `ensureAdsInitialized`. Request config unchanged: T, TFCD false, TFUA false.
- **ATT order fix:** `gatherConsent()` now waits for `openConsentStep()`,
  which App.js calls after the ATT step (iOS) / straight away (Android), and
  again in `finally`. So the app-open manager (now started at JS load) can no
  longer put the UMP form up before the ATT primer. Consent from an earlier
  session still lets init and requests go ahead in parallel.
- Banners: `bannerAds.js` and `FeedBannerAd.jsx` render nothing until
  `useAdsReady()`; both log `ad_paid` via `onPaid`. `ScreenBottomBanner.jsx`
  needed no change (it renders `BannerAdComponent`).
- `App.js`: `installLeaveAppGuard()` at module load; Pro (`localState.isPro`)
  → `AppOpenAdManager.stop()` + `InterstitialAdManager.cleanup()`; static
  `init.js` import (it was already loaded through `openApp.js`).
- `openApp.js` bottom: launch-ad decision + `start()` at JS load for returning,
  past-onboarding, non-Pro users (same MMKV keys as Blox:
  `appOpenHasLaunchedBefore` / `isAppReady`, `showOnBoardingScreen`, `isPro`).
- `InAppUpdateChecker.js`: `skipNextForeground(2 min)` before Play's
  (FLEXIBLE) update flow. iOS opens the store through `Linking`, which the
  leave-app guard covers.
- `AppHelperFunction.js`: removed dead `initializeAds`, `loadAppOpenAd`,
  `handleUserConsent`.
- `android/app/build.gradle`: comment only: don't re-add `play-services-ads`
  under Next-Gen; adapters need the two excludes.

## Deviations from Blox

1. **Pro check** reads MMKV `isPro` only. Adopt Me has no `proGranted`;
   LocalGlobelStats writes `isPro` for both RevenueCat and squad Pro.
2. **Rewarded keywords** stay Adopt Me's `['games', 'pets']` (Blox uses
   `roblox`).
3. **No hard `canRequestAds` check** in `ensureAdsInitialized`. Blox throws
   `ads-consent-not-ready` when UMP could not complete. Adopt Me's existing
   design falls through to `initialize()` so a UMP failure never kills ads.
   Kept. `fullscreenSource.js`'s handling of that error is dormant here.
   Owner/lead may want Blox's stricter rule (EEA offline first launch).
4. **Consent order is ATT → UMP** (Adopt Me's existing order, plan §7.1 step
   5). Blox is UMP → ATT through `gatherAdsConsent` / `openAdsGate`. Adopt Me
   keeps `adsGate.js` (`markAdsReady`) for the notification ask.
5. Banners keep Adopt Me's own NPA helper and Pro check (no `consent.js` /
   `useIsAdFree` here); no collapsible-banner `expandSpent` change (not part
   of this upgrade).

## Static checks (2026-10-13)

- Babel (`@react-native/babel-preset`) compiles every changed JS/JSX file.
- All relative imports / named imports of changed files and their callers
  resolve. (Pre-existing, unrelated: `ValueScreen.js` imports
  `../Helper/debounce`, deleted in 92777fb; the release bundle still builds.)
- `react-native bundle --dev false` succeeds for android and ios.
- Jest: `valueUpdatesTopic.test.js` (ads gate) passes. `App.test.tsx` and
  `safeChat.test.js` fail identically on the base commit (pre-existing).
- Android: `:app:compileDebugKotlin` and `assembleDebug`
  (`-PreactNativeArchitectures=arm64-v8a`, `GRADLE_USER_HOME=/Volumes/Sohail/SimBuilds/gradle-home`)
  pass. Next-Gen 1.4.0 resolved, no classic `play-services-ads` on the
  classpath, kotlin-stdlib stays forced at 2.2.0 (Next-Gen asks 1.9.20).
  Merged manifest keeps `ca-app-pub-1340655056171083~2708635067`.
- iOS pods: `pod update Google-Mobile-Ads-SDK RNGoogleMobileAds` then plain
  `pod install`. The CDN failed with HTTP/2 framing errors on
  GoogleMobileAdsMediationUnity; `COCOAPODS_CDN_MAX_NUMBER_OF_RETRIES=25` got
  it through. Pods hold Debug React core (139 MB simulator React) and Debug
  Hermes (`CDPDebugAPI17addConsoleMessage` present). Facebook/Unity iOS
  adapters unchanged (6.21.1.0 / 4.18.1.0).

## Left for device testing (plan §4.1)

- Android: `getAdCapabilities().backend === 'android-next-gen'`; Crashlytics
  `ads: … pool created` for interstitial / app_open; no ad request before UMP.
- iOS first launch after onboarding: ATT primer → ATT → UMP form (EEA) in
  that order; no app-open or banner request before it.
- Returning launch: launch app-open shows inside its window (`launch_ad`
  outcome `shown`); none over the UMP form.
- App-open on return after ≥ 10 s; none after photo pick, share, sign-in,
  card share, purchase, the Play update flow, a storage-permission ask
  (wallpaper save) or the notification-permission prompt. Dev log
  `[ads] leave-app guard wrapped: …` should list 12 functions.
- Interstitial: tab switch after 60 s; an action (`showAd`) always runs its
  callback.
- Rewarded: MysteryEgg, Trades boost, a mini game: earn once, closing early
  grants nothing, no-fill → "unavailable" text.
- Banners (bottom, collapsible on Android main screens, feed) load after
  consent; `ad_paid` in GA4 DebugView.
- Buy Pro mid-session: no further app-open / interstitial.
