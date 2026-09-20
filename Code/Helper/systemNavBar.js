// Single source of truth for the Android system navigation bar.
//
// Four places used to call SystemNavigationBar.setNavigationColor with their
// own hardcoded hex and they disagreed with each other (#FFFFFF vs #ffffff vs
// #f2f2f7). Worse, the paywall restored a hardcoded dark navy whenever it was
// not visible — and it is mounted with visible={false} by Home, Trades,
// Settings, Reward Center and Analytics — so opening any of those tabs left a
// light-theme app sitting under a dark system bar until the theme changed.
//
// Anything that wants to recolour the bar goes through here.
import { Platform } from 'react-native';
import SystemNavigationBar from 'react-native-system-navigation-bar';

export const NAV_BAR_DARK = '#0f172a';
export const NAV_BAR_LIGHT = '#ffffff';

// `style` is the button/icon colour, not the bar colour: 'light' means white
// icons (use it on a dark bar), 'dark' means black icons (use it on a light
// one). The native call rejects when the activity is gone (backgrounded mid
// transition), which is nothing we can act on, so it is swallowed.
export const setNavBarColor = (color, style) => {
  if (Platform.OS !== 'android') return;
  SystemNavigationBar.setNavigationColor(color, style, 'navigation').catch(() => {});
};

// Hands the bar back to the app theme. `theme` is the resolved 'light' |
// 'dark' from useGlobalState — it is never the raw 'system' preference.
export const setThemedNavBar = (theme) => {
  const isDark = theme === 'dark';
  setNavBarColor(isDark ? NAV_BAR_DARK : NAV_BAR_LIGHT, isDark ? 'light' : 'dark');
};
