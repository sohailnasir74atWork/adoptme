import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { View, Platform } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { useLocalState } from '../LocalGlobelStats';
import { useAdsReady } from './init';
import { logAdRevenue } from './adTelemetry';

// NPA gating: only force non-personalized ads when we truly have to.
// Forcing NPA on every user (the old behaviour) cut eCPM ~40-60% for ~80%
// of traffic that's outside the EEA and would happily take personalized
// ads. Decision rules:
//   * NOT_REQUIRED → user is outside the EEA; personalized ads are fine.
//   * OBTAINED     → consent form completed in the EEA; the SDK already
//                    reads the IAB TCF v2 string and serves the right
//                    flavour automatically — we must NOT override it.
//   * REQUIRED / UNKNOWN → form not completed; default to NPA so we stay
//                    compliant until the user makes a choice.
const npaRequiredFor = (status) =>
  status !== 'OBTAINED' && status !== 'NOT_REQUIRED';

const BannerAdComponent = ({
  adType = 'banner',
  visible = true,
  // Collapsible banner, Android only: pass it on main screens, never on chat
  // screens (their input bar sits right above the banner, and the expanded
  // first impression would cover it). See requestOptions below.
  collapsible = false,
}) => {
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const { localState } = useLocalState();
  const unitId = getAdUnitId(adType);
  // Nothing mounts — so nothing is requested — before UMP consent, the
  // request configuration (rating T) and initialize() (Code/Ads/init.js).
  const adsReady = useAdsReady();

  // No-fill retry: a banner's FIRST load can fail (no fill / transient
  // network). The <BannerAd> won't re-request on its own until something
  // forces a remount, so the slot would stay blank for the whole screen
  // visit — a silently lost impression on every such screen. We bump
  // reloadKey (used as the BannerAd `key`) after a delay to force one fresh
  // request. Once an ad has loaded, the SDK's own auto-refresh takes over and
  // we stop interfering, so we never remount a working banner.
  const [reloadKey, setReloadKey] = useState(0);
  const hasEverLoaded = useRef(false);
  // The remount re-runs this handler on the next failure with the timer
  // already cleared, so without this guard the "one" retry became a 30 s loop
  // for the whole screen visit in no-fill geos.
  const retriedOnce = useRef(false);
  const retryTimer = useRef(null);

  const handleAdLoaded = useCallback(() => {
    hasEverLoaded.current = true;
    setIsAdLoaded(true);
  }, []);

  const handleAdFailedToLoad = useCallback(() => {
    setIsAdLoaded(false);
    // Only nudge the first-ever load; let the SDK own refresh failures.
    if (hasEverLoaded.current || retriedOnce.current || retryTimer.current) return;
    retriedOnce.current = true;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setReloadKey((k) => k + 1);
    }, 30000);
  }, []);

  useEffect(
    () => () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
    },
    [],
  );

  // Stable request options — recomputed only when consent flips so the
  // BannerAd component below doesn't see a new object reference on every
  // render (which would otherwise force a fresh ad request).
  //
  // Collapsible banners are back on Android main screens (owner decision,
  // 2026-10-07). Removing them on 2026-10-04 halved what an Android banner
  // impression earned (AdMob, same days, old vs new build: US $0.39 → $0.16
  // eCPM, inside personalised traffic, so not a consent effect). The first
  // request of a session expands over the content above the banner until the
  // user collapses it; refreshes are ordinary banners. iOS banners earned the
  // same without it, so iOS stays a plain strip.
  const isCollapsible = collapsible && Platform.OS === 'android';
  const handlePaid = useCallback(
    (paid) => logAdRevenue('banner', isCollapsible ? 'banner_collapsible' : 'banner', paid, unitId),
    [isCollapsible, unitId],
  );
  const requestOptions = useMemo(
    () => ({
      requestNonPersonalizedAdsOnly: npaRequiredFor(localState?.consentStatus),
      ...(isCollapsible ? { networkExtras: { collapsible: 'bottom' } } : {}),
    }),
    [localState?.consentStatus, isCollapsible],
  );

  if (!visible || !adsReady) return null;

  // The BannerAd is mounted ONCE and never unmounted while visible. The
  // old code conditionally re-rendered a *different* BannerAd once
  // isAdLoaded flipped — React unmounted the loaded ad and started a
  // fresh request, so roughly half of every banner's load never became
  // an impression. Now we just toggle the wrapper's layout: zero-height
  // while loading (so it reserves no space and doesn't flash an empty
  // box), full-height with the layout container once loaded.
  const containerStyle = isAdLoaded
    ? { alignItems: 'center', justifyContent: 'center' }
    : { height: 0, overflow: 'hidden' };

  return (
    // collapsable={false}: the loaded style is layout-only, so Fabric would
    // flatten this View once the ad loads and re-parent the native ad view —
    // a known trigger for the addViewAt IndexOutOfBounds crash.
    <View style={containerStyle} collapsable={false}>
      <BannerAd
        key={reloadKey}
        unitId={unitId}
        // Fixed MMA 320x50 banner everywhere (owner decision, 2026-09-20),
        // replacing ANCHORED_ADAPTIVE_BANNER. A fixed size ignores the
        // `width` prop — the SDK no longer derives a height from the device
        // width — so the wrapper below just centres the 320dp slot and lets
        // the side gutters fall where they may on wider phones.
        size={BannerAdSize.BANNER}
        requestOptions={requestOptions}
        onAdLoaded={handleAdLoaded}
        onAdFailedToLoad={handleAdFailedToLoad}
        onPaid={handlePaid}
      />
    </View>
  );
};

export default BannerAdComponent;
