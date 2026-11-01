/**
 * PetRunwayScreen.jsx — Pet Runway, design-a-pet-card mini game (Phase 1, 2026-10-31).
 * Plan: Ops/proposals/pet-runway-demo/PLAN.md (owner approved the demo there).
 *
 * The game is an HTML page (Code/PetRunway/game/, packed into runwayGameHtml.js by
 * `npm run runway:build`) running in react-native-webview. It ships inside the app: no download,
 * no remote code; pet art loads from the Pet Cards CDN. This screen is the frame around it:
 *   - writes the language strings, saved cards and draft into the page (window.__RW_INIT);
 *   - keeps cards, the draft and private pictures per account in MMKV id 'pet_runway'
 *     (Phase 1 has no server; nothing leaves the phone except a picture the player shares);
 *   - picks pictures (react-native-image-picker, shrunk to 512 px; the page then fits them into
 *     120 KB) and shares the card picture the page makes (react-native-share);
 *   - haptics, Android Back, background silences the Magic music;
 *   - ads (owner 2026-10-31): a bottom banner only while the game shows its home screen (never in
 *     the studio, the runway show or Magic), and one interstitial at the "card finished" break
 *     (leaving the show after saving), through showAtNaturalBreak. Never for Pro.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StatusBar, StyleSheet, AppState, BackHandler, I18nManager } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { launchImageLibrary } from 'react-native-image-picker';
import Share from 'react-native-share';
import RNFS from 'react-native-fs';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useHaptic } from '../Helper/HepticFeedBack';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import InterstitialAdManager from '../Ads/IntAd';
import ScreenBottomBanner from '../Ads/ScreenBottomBanner';
import RUNWAY_HTML from './runwayGameHtml';
import { cachedCalendar, loadCalendar } from './runwayApi';
import { RUNWAY_KEYS } from './runwayKeys';
import {
  HAPTIC_TYPES, EVENTS, MAX_PHOTOS, cleanCards, cleanDraft, cleanPhotos, parseMessage, photoBatches,
  photoFits, showBannerOn, storeKey, withInit,
} from './runwayBridge';

const BG = '#FFF7FA';
const PNG_PREFIX = 'data:image/png;base64,';

let storage;
try {
  const { createMMKV } = require('react-native-mmkv');
  storage = createMMKV({ id: 'pet_runway' });
} catch (e) {
  const mem = new Map();
  storage = { getString: (k) => mem.get(k), set: (k, v) => mem.set(k, v) };
}
const readJSON = (key, fallback) => {
  try {
    const raw = storage.getString(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
};
const writeJSON = (key, v) => { try { storage.set(key, JSON.stringify(v)); } catch (e) { /* the next save retries */ } };

const PetRunwayScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const { user, isAdmin } = useGlobalState();
  const { localState } = useLocalState();
  const { triggerHapticFeedback } = useHaptic();
  const web = useRef(null);
  const [screen, setScreen] = useState('home');
  const uid = user?.id || null;
  const isPro = !!localState?.isPro;
  // MODs and admins see "Manage events" (the server checks again on every call).
  const isStaff = !!(user?.admin || user?.isModerator || isAdmin);
  const ready = useRef(false);

  const call = useCallback((js) => web.current?.injectJavaScript(`try{${js}}catch(e){}; true;`), []);

  // Built once per account: settings and saved cards go into the page ahead of the game script.
  const html = useMemo(() => {
    const strings = {};
    for (const k of RUNWAY_KEYS) {
      const v = t(`pet_runway.${k}`, { defaultValue: '' });
      if (v) strings[k] = v;
    }
    return withInit(RUNWAY_HTML, {
      lang: i18n.language, rtl: I18nManager.isRTL, strings,
      nickname: user?.displayName || '', staff: isStaff,
      events: cachedCalendar(uid),
      cards: cleanCards(readJSON(storeKey('cards', uid), [])),
      draft: cleanDraft(readJSON(storeKey('draft', uid), null)),
      open: route?.params?.open || 'home',
    });
    // Strings and nickname are read once; the page is rebuilt only when the account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    // Background: stop the Magic music; back: let it play again.
    const sub = AppState.addEventListener('change', (s) => call(`window.__rw && window.__rw.sleep(${s !== 'active'})`));
    return () => sub.remove();
  }, [call]);

  // Events: the cached calendar is already in the page; a fresh one follows (also after the staff
  // Events screen closes, so an approval shows at once).
  const refreshEvents = useCallback(async (force) => {
    const list = await loadCalendar(uid, force);
    if (ready.current) call(`window.__rw && window.__rw.setEvents(${JSON.stringify(list).replace(/</g, '\\u003c')})`);
  }, [uid, call]);
  const fromEvents = useRef(false);
  useFocusEffect(useCallback(() => {
    if (fromEvents.current) { fromEvents.current = false; refreshEvents(true); }
  }, [refreshEvents]));

  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      call('window.__rw && window.__rw.back()');
      return true; // the page posts 'exit' when Back is pressed on its home screen
    });
    return () => sub.remove();
  }, [call]));

  const pickPhoto = useCallback(async () => {
    const have = cleanPhotos(readJSON(storeKey('photos', uid), []));
    if (have.length >= MAX_PHOTOS) return;
    try {
      const res = await launchImageLibrary({ mediaType: 'photo', selectionLimit: 1, maxWidth: 512, maxHeight: 512, quality: 0.8, includeBase64: true });
      const a = res?.assets?.[0];
      if (res?.didCancel || !a) return;
      if (!a.base64) { call("window.__rw && window.__rw.photoError('bad')"); return; }
      const type = /png|webp/.test(a.type || '') ? a.type : 'image/jpeg';
      call(`window.__rw && window.__rw.addPhoto(${JSON.stringify(`data:${type};base64,${a.base64}`)})`);
    } catch (e) {
      call("window.__rw && window.__rw.photoError('bad')");
    }
  }, [call, uid]);

  const onMessage = useCallback(async (e) => {
    const msg = parseMessage(e.nativeEvent.data);
    if (!msg) return;
    switch (msg.type) {
      case 'ready': {
        ready.current = true;
        refreshEvents(false);
        // Pictures go in after the page has loaded, a few per call (each is up to ~160 KB of text).
        const photos = cleanPhotos(readJSON(storeKey('photos', uid), []));
        photoBatches(photos).forEach((js) => web.current?.injectJavaScript(js));
        break;
      }
      case 'save_draft': {
        const d = cleanDraft(msg.look);
        if (d) writeJSON(storeKey('draft', uid), d);
        break;
      }
      case 'save_cards':
        writeJSON(storeKey('cards', uid), cleanCards(msg.cards));
        break;
      case 'pick_photo':
        pickPhoto();
        break;
      case 'photo_saved': {
        if (!photoFits(msg.data)) break;
        const list = cleanPhotos([{ id: msg.id, data: msg.data }, ...readJSON(storeKey('photos', uid), [])]);
        writeJSON(storeKey('photos', uid), list);
        break;
      }
      case 'photo_delete':
        writeJSON(storeKey('photos', uid), cleanPhotos(readJSON(storeKey('photos', uid), [])).filter((p) => p.id !== msg.id));
        break;
      case 'share':
        // Written to the app cache first: react-native-share's own copy of a data URI goes to a
        // folder its file provider does not cover on Android (seen 2026-10-31). Older pictures are
        // removed so the cache keeps only the latest one.
        if (typeof msg.dataUrl === 'string' && msg.dataUrl.startsWith(PNG_PREFIX)) {
          try {
            const dir = RNFS.CachesDirectoryPath;
            const old = (await RNFS.readDir(dir)).filter((f) => /^pet-runway-\d+\.png$/.test(f.name));
            await Promise.all(old.map((f) => RNFS.unlink(f.path).catch(() => {})));
            const file = `${dir}/pet-runway-${Date.now()}.png`;
            await RNFS.writeFile(file, msg.dataUrl.slice(PNG_PREFIX.length), 'base64');
            await Share.open({ url: `file://${file}`, type: 'image/png', title: String(msg.title || ''), failOnCancel: false });
          } catch (err) { /* closed or no app to share to */ }
        }
        break;
      case 'screen':
        setScreen(String(msg.name || ''));
        break;
      case 'card_finished':
        if (!isPro) InterstitialAdManager.showAtNaturalBreak('pet_runway_finish');
        break;
      case 'haptic':
        if (HAPTIC_TYPES[msg.kind]) triggerHapticFeedback(HAPTIC_TYPES[msg.kind]);
        break;
      case 'event':
        if (EVENTS.includes(msg.name)) trackGrowthEvent(msg.name, msg.move ? { move: String(msg.move).slice(0, 20) } : {});
        break;
      case 'open_events':
        if (isStaff) { fromEvents.current = true; navigation.navigate('RunwayEvents'); }
        break;
      case 'exit':
        navigation.goBack();
        break;
      default:
        break;
    }
  }, [uid, isPro, isStaff, navigation, pickPhoto, triggerHapticFeedback, refreshEvents]);

  useEffect(() => { trackGrowthEvent('runway_open', {}); }, []);

  return (
    <View style={[styles.flex1, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor={BG} />
      <WebView
        key={uid || 'guest'}
        ref={web}
        style={styles.web}
        source={{ html }}
        originWhitelist={['*']}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        textZoom={100}
        // The page has no links; anything that tries to navigate away stays put.
        onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith('data:')}
        androidLayerType="hardware"
        webviewDebuggingEnabled={__DEV__}
        accessibilityLabel={t('pet_runway.title')}
      />
      {/* Banner only on the game's home screen; the spacer below it always clears the nav bar. */}
      <ScreenBottomBanner background={BG} ad={showBannerOn(screen, isPro)} />
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
});

export default PetRunwayScreen;
