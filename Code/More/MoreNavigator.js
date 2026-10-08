/**
 * MoreNavigator.js
 * The More tab's own stack: the card hub (MoreHubScreen) and the screens it
 * opens. Nested inside the tab so the tab bar stays visible on every screen.
 */

import React, { createContext, useContext, useMemo } from 'react';
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

// Bottom banner for the More screens. Plain, not collapsible: the expanding
// first load is kept to the main tabs. The tab bar sits under it, so no
// nav-bar spacer is needed here.
const MoreBanner = () => {
  const { localState } = useLocalState();
  return localState.isPro ? null : <BannerAdComponent />;
};

// Theme for the screens below. They are module-level `component`s reading it
// from context, not `{() => …}` render callbacks: a callback skips React
// Navigation's StaticContainer, so every MoreStack render (isAdmin, insets,
// language) re-rendered every mounted More screen and its banner.
const MoreThemeContext = createContext({ background: undefined, selectedTheme: undefined });

// The tool screens were built for the old top-tab body, which had an 8 pt side margin.
const Body = ({ children, ad = true }) => {
  const { background } = useContext(MoreThemeContext);
  return (
    <View style={[styles.flex1, { backgroundColor: background }]}>
      <View style={styles.body}>{children}</View>
      {ad && <MoreBanner />}
    </View>
  );
};

const HomeScreen = (props) => {
  const { background } = useContext(MoreThemeContext);
  return (
    <View style={[styles.flex1, { backgroundColor: background }]}>
      <MoreHubScreen {...props} background={background} />
      <MoreBanner />
    </View>
  );
};
const WallpapersScreen = () => <Body><HDWallpaperScreen /></Body>;
const ServersScreen = () => {
  const { selectedTheme } = useContext(MoreThemeContext);
  return <Body><ServerScreen selectedTheme={selectedTheme} /></Body>;
};
const ScammersScreen = () => <Body><ScammerDatabaseScreen /></Body>;
const NewsTabScreen = () => <Body><NewsScreen /></Body>;
// A form with a send button: no banner next to it.
const ReportFormScreen = () => <Body ad={false}><ReportScreen /></Body>;
const AdminScreen = () => <Body ad={false}><AdminReportsInbox /></Body>;

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

  const themeValue = useMemo(() => ({ background, selectedTheme }), [background, selectedTheme]);

  return (
    <MoreThemeContext.Provider value={themeValue}>
      <Stack.Navigator screenOptions={headerOptions}>
        <Stack.Screen name="MoreHome" options={{ headerShown: false }} component={HomeScreen} />
        <Stack.Screen name="MoreWallpapers" options={{ title: t('tabs.hd_wallpaper') }} component={WallpapersScreen} />
        <Stack.Screen name="MoreServers" options={{ title: t('more_hub.servers_title') }} component={ServersScreen} />
        <Stack.Screen name="MoreScammers" options={{ title: t('tabs.scammer_db') }} component={ScammersScreen} />
        <Stack.Screen name="MoreNews" options={{ title: t('tabs.news') }} component={NewsTabScreen} />
        <Stack.Screen name="MoreReport" options={{ title: t('reports.title') }} component={ReportFormScreen} />
        {isAdmin && (
          <Stack.Screen name="MoreAdmin" options={{ title: 'Reports inbox' }} component={AdminScreen} />
        )}
      </Stack.Navigator>
    </MoreThemeContext.Provider>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 8 },
});

export default MoreStack;
