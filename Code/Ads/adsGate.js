// adsGate.js — "are the first-launch prompts over?"
//
// App.js resolves this once onboarding is finished and the consent chain has
// run: iOS ATT (with its primer) → UMP consent (form included, see
// whenConsentGathered in init.js) → setRequestConfiguration + initialize.
// App only mounts after onboarding, and the chain starts from App, so a
// first launch keeps this pending until the user is through onboarding.
//
// Same name and shape as the MM2 app's adsGate.js. Here the ad loaders still
// wait on ensureAdsInitialized() (init.js); this gate is for prompts that must
// not stack on onboarding or the consent dialogs, i.e. the one-time
// notification permission ask in Helper/valueUpdatesTopic.js.
let ready = false;
let resolveReady;
const readyPromise = new Promise((resolve) => { resolveReady = resolve; });

export const markAdsReady = () => {
  if (ready) return;
  ready = true;
  resolveReady();
};

export const whenAdsReady = () => readyPromise;
