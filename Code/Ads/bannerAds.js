import React, { useState } from 'react';
import { View } from 'react-native';
import { BannerAd, BannerAdSize } from 'react-native-google-mobile-ads';
import getAdUnitId from './ads'; // update path to your ads config

const BannerAdComponent = ({ adType = 'banner', visible = true }) => {
  const [isAdLoaded, setIsAdLoaded] = useState(false);
  const unitId = getAdUnitId(adType);

  if (!visible) return null;

  // Only render when ad is loaded (prevents reserving space when ad fails)
  if (!isAdLoaded) {
    // Render BannerAd hidden (no space reserved) to attempt loading
    return (
      <View style={{ height: 0, overflow: 'hidden' }}>
        <BannerAd
          unitId={unitId}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          onAdLoaded={() => {
            // console.log('[BannerAd] Loaded ✅');
            setIsAdLoaded(true);
          }}
          onAdFailedToLoad={(error) => {
            // console.log('[BannerAd] Failed to load ❌', error);
            setIsAdLoaded(false);
          }}
        />
      </View>
    );
  }

  // Ad loaded successfully - render with container
  return (
    <View style={{ alignItems: 'center', justifyContent:'center', margin:'auto' }}>
      <BannerAd
        unitId={unitId}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdLoaded={() => {
          // console.log('[BannerAd] Loaded ✅');
          setIsAdLoaded(true);
        }}
        onAdFailedToLoad={(error) => {
          // console.log('[BannerAd] Failed to load ❌', error);
          setIsAdLoaded(false);
        }}
      />
    </View>
  );
};

export default BannerAdComponent;
