/**
 * NativeAdCard — advanced native ad rendered to match a content/feed card.
 *
 * Implements the full Google "system-defined format" surface: icon, headline,
 * advertiser, media (image/video via NativeMediaView), body, star rating and a
 * call-to-action button — every visible asset wrapped in <NativeAsset> so the
 * SDK records clicks/impressions and overlays AdChoices itself.
 *
 * Policy notes baked in:
 *   • A "Sponsored" attribution is always shown (required for programmatic
 *     native ads — missing it risks an account strike).
 *   • The top-right corner is left clear for the SDK's AdChoices icon
 *     (request uses adChoicesPlacement: TOP_RIGHT).
 *
 * The ad object itself is owned/cached by NativeAdManager keyed on `adKey`, so
 * this component just borrows it for its lifetime and never destroys it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import {
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
} from 'react-native-google-mobile-ads';
import { getNativeAd } from './NativeAdManager';
import config from '../Helper/Environment';

// Bounded no-fill retry so a transient failure doesn't kill the slot for the
// whole session (mirrors the backoff the other ad formats use). Delays: 4s,
// 8s, 16s — then give up and collapse the row.
const MAX_RETRIES = 3;

const NativeAdCard = ({ adKey, isDarkMode = false }) => {
  const [ad, setAd] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const mountedRef = useRef(true);
  const attemptsRef = useRef(0);
  const retryTimerRef = useRef(null);

  // New slot → reset the retry counter (declared before the load effect so it
  // runs first when adKey changes; a reloadTick bump leaves it untouched).
  useEffect(() => {
    attemptsRef.current = 0;
  }, [adKey]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    setAd(null);
    setFailed(false);

    const onNoAd = () => {
      if (cancelled || !mountedRef.current) return;
      if (attemptsRef.current < MAX_RETRIES) {
        const delay = Math.pow(2, attemptsRef.current) * 4000; // 4s, 8s, 16s
        attemptsRef.current += 1;
        retryTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setReloadTick((t) => t + 1);
        }, delay);
      } else {
        setFailed(true);
      }
    };

    getNativeAd(adKey)
      .then((result) => {
        if (cancelled || !mountedRef.current) return;
        if (result) setAd(result);
        else onNoAd();
      })
      .catch(() => onNoAd());

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [adKey, reloadTick]);

  // Take ZERO space until a real ad is ready. Native fill is low (and brand-new
  // units fill poorly for a day or two), so a reserved skeleton would leave a
  // blank box on every slot Google doesn't fill. Collapsing while loading /
  // failed (matches the banner) means unfilled slots just vanish and the feed
  // stays clean; the card pops in only when an ad actually arrives.
  if (failed || !ad) return null;

  const C = isDarkMode
    ? config.darkColors
    : {
        surface: '#ffffff',
        border: '#e5e7eb',
        textPrimary: '#0f172a',
        textSecondary: '#64748b',
      };

  const hasStars = typeof ad.starRating === 'number' && ad.starRating > 0;

  return (
    <NativeAdView
      nativeAd={ad}
      style={[styles.card, { backgroundColor: C.surface, borderColor: C.border }]}
    >
      {/* Header: icon + headline + advertiser/Sponsored. The headline is a
          registered asset, so this whole text block is a large tap target.
          AdChoices is overlaid by the SDK top-right, so we keep that corner clear. */}
      <View style={styles.header}>
        {ad.icon && ad.icon.url ? (
          <NativeAsset assetType={NativeAssetType.ICON}>
            <Image source={{ uri: ad.icon.url }} style={styles.icon} />
          </NativeAsset>
        ) : null}
        <View style={styles.headerText}>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text numberOfLines={1} style={[styles.headline, { color: C.textPrimary }]}>
              {ad.headline}
            </Text>
          </NativeAsset>
          {/* Sponsored attribution (required) shown inline with the advertiser
              so the card reads like a feed item instead of a boxed-off ad. */}
          <View style={styles.metaRow}>
            <Text style={styles.sponsored}>Sponsored</Text>
            {ad.advertiser ? (
              <>
                <Text style={[styles.metaDot, { color: C.textSecondary }]}>·</Text>
                <NativeAsset assetType={NativeAssetType.ADVERTISER}>
                  <Text numberOfLines={1} style={[styles.advertiser, { color: C.textSecondary }]}>
                    {ad.advertiser}
                  </Text>
                </NativeAsset>
              </>
            ) : null}
          </View>
        </View>
        {/* Keep the top-right corner clear for the SDK AdChoices overlay. */}
        <View style={styles.adChoicesSpace} />
      </View>

      {/* Media (image or video) — a registered asset and the largest tap target. */}
      {ad.mediaContent ? (
        <NativeMediaView style={styles.media} resizeMode="cover" />
      ) : null}

      {/* Body */}
      {ad.body ? (
        <NativeAsset assetType={NativeAssetType.BODY}>
          <Text numberOfLines={2} style={[styles.body, { color: C.textSecondary }]}>
            {ad.body}
          </Text>
        </NativeAsset>
      ) : null}

      {hasStars ? (
        <NativeAsset assetType={NativeAssetType.STAR_RATING}>
          <Text style={styles.stars}>
            {'★'.repeat(Math.round(ad.starRating))}
            <Text style={{ color: C.textSecondary }}>
              {'★'.repeat(Math.max(0, 5 - Math.round(ad.starRating)))}
            </Text>
          </Text>
        </NativeAsset>
      ) : null}

      {/* Full-width CTA — the registered click target. Rendered as a styled
          LEAF <Text> (like the headline/body assets, which click fine): a
          wrapper <View> — even with pointerEvents="box-only" — never fired
          the SDK's native click listener on Android. RN's ViewGroup consumes
          the touch through its own gesture pipeline without calling the
          Android click handler the GMA SDK registers on the asset view, so
          the button rendered but was dead to taps. A leaf Text takes the
          same native click path as the working headline. */}
      {ad.callToAction ? (
        <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
          <Text style={[styles.cta, { backgroundColor: config.colors.secondary }]}>
            {ad.callToAction}
          </Text>
        </NativeAsset>
      ) : null}
    </NativeAdView>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginHorizontal: 12,
    marginVertical: 6,
  },
  skeleton: {
    height: 220,
    opacity: 0.5,
  },
  // Reserve room so the SDK's AdChoices overlay (top-right) never covers content.
  adChoicesSpace: {
    width: 24,
    height: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    marginRight: 10,
    backgroundColor: 'rgba(120,120,128,0.12)',
  },
  headerText: {
    flex: 1,
  },
  headline: {
    fontSize: 15,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  sponsored: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9ca3af',
  },
  metaDot: {
    fontSize: 11,
    marginHorizontal: 4,
  },
  advertiser: {
    fontSize: 12,
    flexShrink: 1,
  },
  media: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    marginTop: 10,
    alignSelf: 'center', // center the media even when its intrinsic aspect is narrower than the card
    backgroundColor: 'rgba(120,120,128,0.08)',
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  stars: {
    fontSize: 14,
    color: '#f5a623',
    marginTop: 8,
  },
  // Full-width, ~48dp-tall button styled directly on the Text leaf (the
  // registered asset). overflow:'hidden' clips the background to the radius
  // on Android.
  cta: {
    marginTop: 12,
    alignSelf: 'stretch',
    textAlign: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    overflow: 'hidden',
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
});

export default React.memo(NativeAdCard);
