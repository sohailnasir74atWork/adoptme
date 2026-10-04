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
import NewsFeedbackReport from '../ValuesScreen/AdminReport';

const Stack = createNativeStackNavigator();

// The tool screens were built for the old top-tab body, which had an 8 pt side margin.
const Body = ({ background, children }) => (
  <View style={[styles.body, { backgroundColor: background }]}>{children}</View>
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
        {(props) => <MoreHubScreen {...props} background={background} />}
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
      {isAdmin && (
        <Stack.Screen name="MoreAdmin" options={{ title: 'Admin' }}>
          {() => <Body background={background}><NewsFeedbackReport /></Body>}
        </Stack.Screen>
      )}
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: 8 },
});

export default MoreStack;
