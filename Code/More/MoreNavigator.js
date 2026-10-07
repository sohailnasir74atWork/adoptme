/**
 * MoreNavigator.js
 * The More tab's own stack: the card hub (MoreHubScreen) and the screens it
 * opens. Nested inside the tab so the tab bar stays visible on every screen.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import MoreHubScreen from './MoreHubScreen';
import HDWallpaperScreen from '../ValuesScreen/HDwallpaper';
import ServerScreen from '../ValuesScreen/ServerScreen';
import ScammerDatabaseScreen from '../ValuesScreen/ScammerDatabaseScreen';
import NewsScreen from '../ValuesScreen/News';
import AdminReportsInbox from '../ValuesScreen/AdminReport';
import ReportScreen from '../Reports/ReportScreen';
import BannerAdComponent from '../Ads/bannerAds';
import { useLocalState } from '../LocalGlobelStats';

const Stack = createNativeStackNavigator();

// Bottom banner for the More screens, like every other tab's main screens.
// The tab bar sits under it, so no nav-bar spacer is needed here.
const MoreBanner = () => {
  const { localState } = useLocalState();
  return localState.isPro ? null : <BannerAdComponent collapsible />;
};

// The tool screens were built for the old top-tab body, which had an 8 pt side margin.
const Body = ({ background, children, ad = true }) => (
  <View style={[styles.flex1, { backgroundColor: background }]}>
    <View style={styles.body}>{children}</View>
    {ad && <MoreBanner />}
  </View>
);

export const MoreStack = ({ selectedTheme }) => {
  const { t } = useTranslation();
  const { isAdmin } = useGlobalState();
  const insets = useSafeAreaInsets();
  const background = selectedTheme.colors.background;

  const headerOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: background },
      headerTintColor: selectedTheme.colors.text,
      headerTitleStyle: { fontWeight: 'bold' },
      headerShadowVisible: false,
      // Same MIUI edge-to-edge workaround as TradeStack: the native-stack
      // header's own inset can read 0, so pass the safe-area value.
      headerStatusBarHeight: insets.top,
      animation: 'slide_from_right',
    }),
    [background, selectedTheme.colors.text, insets.top]
  );

  return (
    <Stack.Navigator screenOptions={headerOptions}>
      <Stack.Screen name="MoreHome" options={{ headerShown: false }}>
        {(props) => (
          <View style={[styles.flex1, { backgroundColor: background }]}>
            <MoreHubScreen {...props} background={background} />
            <MoreBanner />
          </View>
        )}
      </Stack.Screen>
      <Stack.Screen name="MoreWallpapers" options={{ title: t('tabs.hd_wallpaper') }}>
        {() => <Body background={background}><HDWallpaperScreen /></Body>}
      </Stack.Screen>
      <Stack.Screen name="MoreServers" options={{ title: t('more_hub.servers_title') }}>
        {() => <Body background={background}><ServerScreen selectedTheme={selectedTheme} /></Body>}
      </Stack.Screen>
      <Stack.Screen name="MoreScammers" options={{ title: t('tabs.scammer_db') }}>
        {() => <Body background={background}><ScammerDatabaseScreen /></Body>}
      </Stack.Screen>
      <Stack.Screen name="MoreNews" options={{ title: t('tabs.news') }}>
        {() => <Body background={background}><NewsScreen /></Body>}
      </Stack.Screen>
      {/* A form with a send button: no banner next to it. */}
      <Stack.Screen name="MoreReport" options={{ title: t('reports.title') }}>
        {() => <Body background={background} ad={false}><ReportScreen /></Body>}
      </Stack.Screen>
      {isAdmin && (
        <Stack.Screen name="MoreAdmin" options={{ title: 'Reports inbox' }}>
          {() => <Body background={background} ad={false}><AdminReportsInbox /></Body>}
        </Stack.Screen>
      )}
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 8 },
});

export default MoreStack;
