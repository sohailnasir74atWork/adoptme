/**
 * ScreenBottomBanner — the bottom of a full-screen page (a root-stack screen,
 * no tab bar under it): the banner ad, then a spacer as tall as the system
 * navigation bar, painted in the page's colour.
 *
 * Android draws every screen edge-to-edge (edgeToEdgeEnabled, targetSdk 36),
 * so without this the page runs under the nav buttons. Padding only the end
 * of the scroll content cleared the LAST row, but every row scrolled behind
 * the buttons on the way there. Place it as the page's last child, after the
 * flex:1 list, and drop insets.bottom from the list's own padding.
 *
 * Tab screens don't need it: the tab bar already sits above the nav bar.
 */

import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BannerAdComponent from './bannerAds';
import { useLocalState } from '../LocalGlobelStats';

const ScreenBottomBanner = ({ background, ad = true }) => {
  const insets = useSafeAreaInsets();
  const { localState } = useLocalState();
  return (
    <>
      {ad && !localState.isPro && <BannerAdComponent collapsible />}
      <View style={{ height: insets.bottom, backgroundColor: background }} />
    </>
  );
};

export default ScreenBottomBanner;
