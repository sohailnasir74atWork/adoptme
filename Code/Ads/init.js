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
import { MobileAds, MaxAdContentRating, AdsConsent } from 'react-native-google-mobile-ads';

let initPromise = null;

// Gather UMP consent (requestInfoUpdate + loadAndShowConsentFormIfRequired) so
// the IAB TCF string exists before the first ad request. Best-effort: a consent
// failure (network, form load error) must NOT block ads entirely — we fall
// through to initialize() so the SDK can still serve non-personalised/limited
// ads. The point is that after this resolves, a REQUIRED EEA user has either
// completed the form (personalised) or the SDK knows to serve NPA — either way
// a TC string is present, which is what "coverage" measures.
async function gatherConsent() {
  try {
    // gatherConsent() is a no-op form-wise outside the EEA/UK/CH (status is
    // NOT_REQUIRED, no form shown), so non-EEA users are unaffected.
    await AdsConsent.gatherConsent();
  } catch (_) {
    // Swallow — never let consent errors starve ad serving.
  }
}

export function ensureAdsInitialized() {
  if (!initPromise) {
    initPromise = gatherConsent()
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
      .catch((err) => {
        // Reset so a transient failure can be retried by the next caller
        // instead of permanently poisoning the promise.
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}
