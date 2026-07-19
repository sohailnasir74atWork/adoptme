import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads';
import { useLocalState } from '../LocalGlobelStats';

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
}) => {
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const { localState } = useLocalState();
  const unitId = getAdUnitId(adType);

  // Adaptive banners default to full device width, which puts the ad flush
  // against both screen edges. Request the ad 20dp narrower (10dp inset per
  // side); the SDK then auto-picks the right height for that width.
  const { width: screenWidth } = useWindowDimensions();
  const adWidth = Math.floor(screenWidth) - 20;

  // No-fill retry: a banner's FIRST load can fail (no fill / transient
  // network). The <BannerAd> won't re-request on its own until something
  // forces a remount, so the slot would stay blank for the whole screen
  // visit — a silently lost impression on every such screen. We bump
  // reloadKey (used as the BannerAd `key`) after a delay to force one fresh
  // request. Once an ad has loaded, the SDK's own auto-refresh takes over and
  // we stop interfering, so we never remount a working banner.
  const [reloadKey, setReloadKey] = useState(0);
  const hasEverLoaded = useRef(false);
  const retryTimer = useRef(null);

  const handleAdLoaded = useCallback(() => {
    hasEverLoaded.current = true;
    setIsAdLoaded(true);
  }, []);

  const handleAdFailedToLoad = useCallback(() => {
    setIsAdLoaded(false);
    // Only nudge the first-ever load; let the SDK own refresh failures.
    if (hasEverLoaded.current || retryTimer.current) return;
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
  // Collapsible Banner format (networkExtras.collapsible) was removed by
  // request 2026-07-09: the expanded first impression covered content and
  // felt intrusive, so all placements serve plain anchored banners now.
  const requestOptions = useMemo(
    () => ({
      requestNonPersonalizedAdsOnly: npaRequiredFor(localState?.consentStatus),
    }),
    [localState?.consentStatus],
  );

  if (!visible) return null;

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
    <View style={containerStyle}>
      <BannerAd
        key={reloadKey}
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        width={adWidth}
        requestOptions={requestOptions}
        onAdLoaded={handleAdLoaded}
        onAdFailedToLoad={handleAdFailedToLoad}
      />
    </View>
  );
};

export default BannerAdComponent;
