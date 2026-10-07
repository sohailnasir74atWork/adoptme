// Light system-bar icons (and a dark nav-bar scrim) while an always-dark page
// is focused — the Pet Cards screens are dark in both app themes, so the
// light theme's black status icons vanished on them and the 3-button nav bar
// drew a pale strip under the page. Android 15 ignores the bar COLOUR
// (edge-to-edge is enforced), but still follows the icon style, and its
// contrast scrim follows that. The status bar goes through a stack entry:
// App.js's own <StatusBar> re-applies its style on every render, which
// overwrote a plain setBarStyle. Blur hands both back to the app theme; React
// Navigation fires the old screen's blur before the new one's focus, so
// moving between two dark pages stays dark.
import { useCallback } from 'react';
import { StatusBar } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useGlobalState } from '../GlobelStats';
import { setNavBarColor, setThemedNavBar } from './systemNavBar';

export default function useDarkSystemBars(color) {
  const { theme } = useGlobalState();
  useFocusEffect(
    useCallback(() => {
      const entry = StatusBar.pushStackEntry({ barStyle: 'light-content' });
      setNavBarColor(color, 'light');
      return () => {
        StatusBar.popStackEntry(entry);
        setThemedNavBar(theme);
      };
    }, [color, theme]),
  );
}
