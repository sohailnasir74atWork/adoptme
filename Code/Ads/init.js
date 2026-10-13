// Centralised AdMob initialisation.
//
// Why this exists: two things MUST happen before the first ad request, and both
// used to race:
//
//   1. CONSENT (IAB TCF): for EEA / UK / Switzerland users the UMP consent form
//      must be gathered so a TC string is written to storage BEFORE any ad
//      loads. If an ad request fires first, it goes out with no TC string and
//      AdMob reports "Consent requirement: Low coverage" (a regulatory issue
//      that throttles serving/revenue). Previously initialize() ran before the
//      consent form was shown, so the earliest (highest-value) impressions for
//      EEA users served with no TC string.
//   2. REQUEST CONFIG (maxAdContentRating 'T', child treatment flag): if applied
//      after the first request, the first impressions get served at AdMob's
//      default 'G' ceiling and lower eCPM.
//
// ensureAdsInitialized() returns a single shared promise that runs, in order:
// gatherConsent() → setRequestConfiguration() → initialize(). Every ad loader
// awaits it before calling load(), so no ad is ever requested before consent is
// resolved and the config lands. Safe to call any number of times from anywhere
// — the work runs exactly once, so the consent form shows at most once.
// Exception: when consent from an earlier session already allows ads, the
// refresh runs alongside setRequestConfiguration/initialize instead of in
// front of them (canRequestAdsFromLastSession below).
//
// The UMP step (form included) starts only when App.js opens it
// (openConsentStep), which on iOS is after ATT and its primer: the order is
// ATT → UMP. Ad managers can call ensureAdsInitialized() earlier — the
// app-open manager starts at JS load for returning users, and used to start
// UMP ahead of the ATT prompt (2026-10-12 ads audit) — so the consent step
// waits for App.js instead of jumping ahead of it. Consent from an earlier
// session does not wait: init and requests go ahead in parallel, as before.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { MobileAds, MaxAdContentRating, AdsConsent } from 'react-native-google-mobile-ads';
import { getTrackingStatus } from 'react-native-tracking-transparency';
import { adLog } from './adTelemetry';

// Resolved by App.js when this session's consent step may run: after the ATT
// prompt (or its skip) on iOS, straight away on Android. App only mounts
// after onboarding, so this is also "onboarding done". Idempotent.
let releaseConsentStep;
const consentStep = new Promise((resolve) => { releaseConsentStep = resolve; });
export const openConsentStep = () => releaseConsentStep();

// While this session's consent step runs, the UMP form may be on screen:
// openApp.js holds the launch ad until it is done (a returning user's launch
// ad loads in parallel with this refresh and could present over a re-shown
// form).
let consentFlow = null;
export const isConsentFlowActive = () => consentFlow !== null;
export const whenConsentFlowIdle = () => consentFlow || Promise.resolve();

// One UMP consent refresh per launch, shared by the two callers below. It is
// started as early as possible because UMP only reports the consent stored by
// an earlier session (canRequestAds) once this session's refresh has been
// requested — before that it always says false (verified on the Blox Fruit
// emulator build, 2026-10-12), which made every returning user's launch ad
// wait for the full refresh and miss its window (`launch_ad` outcome
// not_loaded). requestInfoUpdate() shows nothing on screen.
let consentRefresh = null;
function startConsentRefresh() {
  if (!consentRefresh) {
    try {
      // Called synchronously so the native request is queued before any
      // getConsentInfo() that follows it.
      consentRefresh = AdsConsent.requestInfoUpdate().catch(() => null);
    } catch (_) {
      consentRefresh = Promise.resolve(null);
    }
  }
  return consentRefresh;
}

let initPromise = null;
let initialized = false;

// True once the SDK is initialised and ads may be requested.
export const adsInitialized = () => initialized;
// This session's UMP step, form included. Kept apart from initPromise, which
// can resolve before it when earlier consent stands (see ensureAdsInitialized).
let consentPromise = null;

// Resolves once this session's consent step, and any form it showed, is over.
// Never rejects (gatherConsent swallows its errors). Read it after
// ensureAdsInitialized() has settled, as App.js does.
export const whenConsentGathered = () => consentPromise || Promise.resolve();

// Consent the user gave in an earlier session is kept on the device by UMP and
// is enough to request ads right away: Google's UMP sample initialises the SDK
// in parallel with the new session's consent refresh whenever canRequestAds()
// is already true. Waiting for that refresh (a network round trip) is what
// made the launch ad miss its splash window. First launches, anyone whose
// consent is still incomplete, and iOS users with the ATT prompt still to come
// keep waiting for the full flow. getConsentInfo() reads the stored state; it
// makes no network call.
export async function canRequestAdsFromLastSession() {
  try {
    startConsentRefresh();
    const info = await AdsConsent.getConsentInfo();
    if (!info?.canRequestAds) return false;
    if (Platform.OS === 'ios' && (await getTrackingStatus()) === 'not-determined') return false;
    return true;
  } catch (_) {
    return false;
  }
}

// Gather UMP consent (requestInfoUpdate + loadAndShowConsentFormIfRequired) so
// the IAB TCF string exists before the first ad request. Best-effort: a consent
// failure (network, form load error) must NOT block ads entirely — we fall
// through to initialize() so the SDK can still serve non-personalised/limited
// ads. The point is that after this resolves, a REQUIRED EEA user has either
// completed the form (personalised) or the SDK knows to serve NPA — either way
// a TC string is present, which is what "coverage" measures.
async function gatherConsent() {
  // ATT first on iOS; never before App.js has mounted (see openConsentStep).
  await consentStep;
  let release;
  consentFlow = new Promise((resolve) => { release = resolve; });
  try {
    // Same steps as AdsConsent.gatherConsent(), sharing this launch's refresh.
    // The form is a no-op outside the EEA/UK/CH (status NOT_REQUIRED, no form
    // shown), so non-EEA users are unaffected.
    await startConsentRefresh();
    await AdsConsent.loadAndShowConsentFormIfRequired();
  } catch (_) {
    // Swallow — never let consent errors starve ad serving.
  } finally {
    consentFlow = null;
    release();
  }
}

export function ensureAdsInitialized() {
  if (!initPromise) {
    initPromise = canRequestAdsFromLastSession()
      .then((alreadyConsented) => {
        if (__DEV__) console.log(`[ads] consent from last session usable: ${alreadyConsented}`);
        // Earlier consent stands: refresh it alongside init (the form still
        // shows if this session needs one) instead of in front of it.
        consentPromise = gatherConsent();
        if (alreadyConsented) {
          return undefined;
        }
        return consentPromise;
      })
      // Set BEFORE initialize() so every request — including the Next-Gen
      // SDK's, which folds it into its InitializationConfig — carries it. No
      // per-user age signal (owner decision, 2026-10-12): the app's own
      // date-of-birth data is not used for ads; Google applies its own
      // protections to accounts it knows are children or teens.
      .then(() =>
        MobileAds().setRequestConfiguration({
          // 'T' (Teen) opens up Teen-rated inventory that AdMob's default 'G'
          // ceiling silently locks out — matches our Play Console 13+ audience.
          maxAdContentRating: MaxAdContentRating.T,
          // Confirms this is NOT a kids-app build, avoiding the conservative
          // kids pricing AdMob applies when treatment is left unspecified.
          tagForChildDirectedTreatment: false,
          // Explicit: not a mixed-audience under-age build either — leaving it
          // unspecified lets AdMob guess; false keeps personalized ads eligible.
          tagForUnderAgeOfConsent: false,
        }),
      )
      .then(() => MobileAds().initialize())
      .then(() => {
        initialized = true;
        adLog('initialized');
      })
      .catch((err) => {
        // Reset so a transient failure can be retried by the next caller
        // instead of permanently poisoning the promise.
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}

// For components that render an ad view themselves (banners): false until the
// SDK may serve, so a <BannerAd> never mounts — and requests — before consent
// and the request configuration.
export function useAdsReady() {
  const [ready, setReady] = useState(initialized);
  useEffect(() => {
    if (ready) return undefined;
    let alive = true;
    ensureAdsInitialized()
      .then(() => { if (alive) setReady(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, [ready]);
  return ready;
}
