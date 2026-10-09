// Light system-bar icons (and a dark nav-bar scrim) while an always-dark page
// is focused — the Pet Cards screens are dark in both app themes, so the
// light theme's black status icons vanished on them and the 3-button nav bar
// drew a pale strip under the page. Android 15 ignores the bar COLOUR
// (edge-to-edge is enforced), but still follows the icon style, and its
// contrast scrim follows that. The status bar goes through a stack entry:
// App.js's own <StatusBar> re-applies its style on every render, which
// overwrote a plain setBarStyle.
//
// Two flashes this used to cause (2026-10-08 screen recording, one frame
// each): the colour was a dependency of the focus effect, so picking another
// pack ran the blur clean-up — the app's light nav bar for a frame — before
// re-applying the dark one; and moving between two dark pages (hub -> album
// -> pack) handed the bar back to the app theme in between. Now a colour
// change while focused only recolours, and handing back waits a beat so the
// next dark page can take the bar over first (going back to a light screen
// still restores it inside the 200 ms fade).
import { useCallback, useRef } from 'react';
import { StatusBar } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useGlobalState } from '../GlobelStats';
import { setNavBarColor, setThemedNavBar } from './systemNavBar';

const RESTORE_DELAY_MS = 150;
let darkScreens = 0;      // dark pages focused right now (0 or 1 in practice)
let restoreTimer = null;

export default function useDarkSystemBars(color) {
  const { theme } = useGlobalState();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useFocusEffect(
    useCallback(() => {
      darkScreens += 1;
      if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }
      const entry = StatusBar.pushStackEntry({ barStyle: 'light-content' });
      return () => {
        darkScreens = Math.max(0, darkScreens - 1);
        StatusBar.popStackEntry(entry);
        if (restoreTimer) clearTimeout(restoreTimer);
        restoreTimer = setTimeout(() => {
          restoreTimer = null;
          if (darkScreens === 0) setThemedNavBar(themeRef.current);
        }, RESTORE_DELAY_MS);
      };
    }, []),
  );

  // Recolour in place (focus, or a new pack's colour while focused).
  useFocusEffect(
    useCallback(() => {
      setNavBarColor(color, 'light');
    }, [color]),
  );
}
