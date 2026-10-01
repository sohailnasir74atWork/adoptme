/**
 * TradeMatchScreen — "Get your dream pet".
 *
 * 1. The player picks a dream pet from their wishlist.
 * 2. We list players who HAVE something they want (from Supabase, see
 *    Code/Helper/tradeMatch.js); "perfect" when those players also want
 *    something the player offers.
 * 3. One tap opens a private chat with them.
 * 4. "I got it! 🎉" moves the dream pet to My Pets and makes a share card.
 *
 * Reads: 1 Firestore doc (the player's own pets) + 1 Supabase RPC per open,
 * both cached (matches 10 min, stats 1 h).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, Image, TouchableOpacity, ActivityIndicator,
  RefreshControl, Alert, Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, getDoc, setDoc, serverTimestamp as fsServerTimestamp } from '@react-native-firebase/firestore';
import Icon from 'react-native-vector-icons/Ionicons';
import ViewShot from 'react-native-view-shot';
import Share from 'react-native-share';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { showErrorMessage } from '../Helper/MessageHelper';
import config from '../Helper/Environment';
import {
  petKey, getDreamKey, setDreamKeyLocal, alertsEnabled, setAlertsEnabled,
  syncTradeInventory, fetchTradeMatches, fetchTradeMatchStats, reportDreamFound,
} from '../Helper/tradeMatch';

const ACCENT = '#8B5CF6';
const GREEN = '#10B981';
const GOLD = '#F59E0B';
const SITE = 'adoptmevalues.app';

const variantLabel = (e) => {
  if (!e) return '';
  const base = e.v === 'm' ? 'M' : e.v === 'n' ? 'N' : '';
  return `${base}${e.f ? 'F' : ''}${e.r ? 'R' : ''}`;
};

const imageOf = (path, base) => {
  const raw = String(path || '');
  if (!raw) return null;
  if (/^https?:\/\//.test(raw)) return raw;
  const b = String(base || 'https://elvebredd.com').replace(/"/g, '').replace(/\/$/, '');
  return `${b}/${raw.replace(/^\//, '')}`;
};

// Unique wishlist entries (one per item key) for the dream picker.
const wishlistChoices = (wishlist) => {
  const seen = new Set();
  const out = [];
  for (const p of Array.isArray(wishlist) ? wishlist : []) {
    const k = petKey(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ key: k, pet: p });
  }
  return out;
};

const PetChip = React.memo(({ entry, imgBase, highlight, c }) => {
  const uri = imageOf(entry.i, imgBase);
  const label = variantLabel(entry);
  return (
    <View style={[styles.chip, { backgroundColor: c.bgAlt, borderColor: highlight ? GOLD : c.border }]}>
      {uri ? <Image source={{ uri }} style={styles.chipImg} /> : <Text style={styles.chipImgFallback}>🐾</Text>}
      <Text style={[styles.chipText, { color: c.text }]} numberOfLines={1}>{entry.n}</Text>
      {!!label && <Text style={styles.chipVariant}>{label}</Text>}
    </View>
  );
});

const MatchCard = React.memo(({ m, dreamKey, imgBase, c, onMessage }) => {
  const { t } = useTranslation();
  return (
    <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: m.dream ? GOLD : c.border }]}>
      <View style={styles.cardHead}>
        {m.avatar
          ? <Image source={{ uri: m.avatar }} style={styles.avatar} />
          : <View style={[styles.avatar, styles.avatarFallback]}><Icon name="person" size={18} color="#fff" /></View>}
        <View style={{ flex: 1 }}>
          <View style={styles.row}>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>{m.name || t('chat.anonymous')}</Text>
            {m.verified && <Icon name="checkmark-circle" size={14} color="#3B82F6" style={{ marginLeft: 4 }} />}
          </View>
          <View style={[styles.row, { marginTop: 4, flexWrap: 'wrap', gap: 6 }]}>
            {m.dream && (
              <View style={[styles.pill, { backgroundColor: GOLD + '22' }]}>
                <Text style={[styles.pillText, { color: GOLD }]}>⭐ {t('trade_match.has_dream')}</Text>
              </View>
            )}
            {m.full && (
              <View style={[styles.pill, { backgroundColor: GREEN + '22' }]}>
                <Text style={[styles.pillText, { color: GREEN }]}>🤝 {t('trade_match.perfect_match')}</Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity style={styles.msgBtn} onPress={() => onMessage(m)} activeOpacity={0.85}>
          <Icon name="chatbubble-ellipses" size={16} color="#fff" />
          <Text style={styles.msgText}>{t('trade_match.message')}</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>{t('trade_match.has_label')}</Text>
      <View style={styles.chips}>
        {(m.gives || []).slice(0, 6).map((e, i) => (
          <PetChip key={`g${i}`} entry={e} imgBase={imgBase} highlight={e.k === dreamKey} c={c} />
        ))}
      </View>

      <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>{t('trade_match.wants_label')}</Text>
      {m.full ? (
        <View style={styles.chips}>
          {(m.wants || []).slice(0, 6).map((e, i) => (
            <PetChip key={`w${i}`} entry={e} imgBase={imgBase} c={c} />
          ))}
        </View>
      ) : (
        <Text style={[styles.muted, { color: c.textMuted }]}>{t('trade_match.wants_other')}</Text>
      )}
    </View>
  );
});

export default function TradeMatchScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, theme, firestoreDB } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const isDark = theme === 'dark';
  const c = getThemeColors(isDark);
  const uid = user?.id || null;
  const imgBase = localState?.imgurl;

  const [owned, setOwned] = useState([]);
  const [wishlist, setWishlist] = useState([]);
  const [dreamKey, setDreamKey] = useState(() => getDreamKey(uid));
  const [matches, setMatches] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [alertsOn, setAlertsOn] = useState(alertsEnabled());
  const [proofPet, setProofPet] = useState(null);
  const shotRef = useRef(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const loadProfile = useCallback(async () => {
    let snap = await getDoc(doc(firestoreDB, 'user_profiles', uid));
    if (!snap.exists()) snap = await getDoc(doc(firestoreDB, 'reviews', uid));
    const data = snap.exists() ? (snap.data() || {}) : {};
    const o = Array.isArray(data.ownedPets) ? data.ownedPets : [];
    const w = Array.isArray(data.wishlistPets) ? data.wishlistPets : [];
    // The Firestore field wins when present (it follows the player across phones).
    const d = 'dreamPetKey' in data ? (data.dreamPetKey || null) : getDreamKey(uid);
    setDreamKeyLocal(uid, d);
    return { o, w, d };
  }, [firestoreDB, uid]);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!uid || !firestoreDB) { setLoading(false); return; }
    setLoadError(false);
    try {
      const { o, w, d } = await loadProfile();
      if (!mounted.current) return;
      setOwned(o); setWishlist(w); setDreamKey(d);
      await syncTradeInventory(uid, o, w, { dreamKey: d, lang: i18n.language, immediate: true });
      const [list, st] = await Promise.all([
        fetchTradeMatches(uid, { force }),
        fetchTradeMatchStats({ force }).catch(() => null),
      ]);
      if (!mounted.current) return;
      setMatches(list);
      if (st) setStats(st);
    } catch (e) {
      console.warn('[TradeMatch] load failed:', e?.message);
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [uid, firestoreDB, loadProfile, i18n.language]);

  useEffect(() => { load(); }, [load]);

  // First visit with a wishlist but nothing to search for: open the dream
  // picker once, so "add to wishlist, then see matches" just works.
  const autoPickedRef = useRef(false);

  const onRefresh = useCallback(() => { setRefreshing(true); load({ force: true }); }, [load]);

  const forTradeCount = useMemo(() => owned.filter((p) => p?.availableForTrade === true).length, [owned]);
  const choices = useMemo(() => wishlistChoices(wishlist), [wishlist]);
  const dreamPet = useMemo(() => choices.find((x) => x.key === dreamKey)?.pet || null, [choices, dreamKey]);
  const wantCount = useMemo(
    () => wishlist.filter((p) => p?.availableForTrade === true || (dreamKey && petKey(p) === dreamKey)).length,
    [wishlist, dreamKey],
  );
  useEffect(() => {
    if (loading || loadError || autoPickedRef.current) return;
    if (!dreamKey && wantCount === 0 && choices.length > 0) {
      autoPickedRef.current = true;
      setPickerOpen(true);
    }
  }, [loading, loadError, dreamKey, wantCount, choices.length]);

  const saveDream = useCallback(async (key) => {
    try {
      await setDoc(doc(firestoreDB, 'user_profiles', uid), { dreamPetKey: key || null, updatedAt: fsServerTimestamp() }, { merge: true });
      setDreamKeyLocal(uid, key);
      setDreamKey(key);
      await syncTradeInventory(uid, owned, wishlist, { dreamKey: key, lang: i18n.language, immediate: true });
      setMatches(await fetchTradeMatches(uid, { force: true }));
    } catch (e) {
      console.warn('[TradeMatch] save dream failed:', e?.message);
      showErrorMessage(t('home.alert.error'), t('trade_match.error_save'));
    }
  }, [firestoreDB, uid, owned, wishlist, i18n.language, t]);

  const pickDream = useCallback((choice) => {
    setPickerOpen(false);
    // iOS drops an Alert presented while a Modal is still animating out.
    setTimeout(() => {
      Alert.alert(
        t('trade_match.dream_confirm_title'),
        t('trade_match.dream_confirm_body', { pet: choice.pet.name || choice.pet.Name }),
        [
          { text: t('trade_match.cancel'), style: 'cancel' },
          { text: t('trade_match.dream_confirm_yes'), onPress: () => saveDream(choice.key) },
        ],
      );
    }, 400);
  }, [saveDream, t]);

  const toggleAlerts = useCallback(async () => {
    const next = !alertsOn;
    setAlertsEnabled(next);
    setAlertsOn(next);
    await syncTradeInventory(uid, owned, wishlist, { dreamKey, lang: i18n.language, immediate: true });
  }, [alertsOn, uid, owned, wishlist, dreamKey, i18n.language]);

  const openChat = useCallback((m) => {
    navigation.navigate('PrivateChatRoot', {
      selectedUser: { senderId: m.uid, sender: m.name || t('chat.anonymous'), avatar: m.avatar || null },
    });
  }, [navigation, t]);

  const shareProof = useCallback(async () => {
    try {
      if (!shotRef.current) return;
      await new Promise((r) => setTimeout(r, 150));
      const uri = await shotRef.current.capture();
      await Share.open({
        url: uri,
        type: 'image/png',
        message: t('trade_match.proof_share_message', {
          pet: proofPet?.name || '',
          url: `https://${SITE}`,
        }),
        failOnCancel: false,
      });
    } catch (e) {
      if (e?.message !== 'User did not share') console.warn('[TradeMatch] share failed:', e?.message);
    }
  }, [proofPet, t]);

  const markGotIt = useCallback(async () => {
    const idx = wishlist.findIndex((p) => petKey(p) === dreamKey);
    if (idx < 0) return;
    const pet = wishlist[idx];
    const newWishlist = wishlist.filter((_, i) => i !== idx);
    const newOwned = [...owned, { ...pet, availableForTrade: false, addedAt: Date.now(), addedVia: 'trade_match' }];
    try {
      const payload = { ownedPets: newOwned, wishlistPets: newWishlist, dreamPetKey: null, updatedAt: fsServerTimestamp() };
      await Promise.all([
        setDoc(doc(firestoreDB, 'user_profiles', uid), payload, { merge: true }),
        // Same dual-write as My Stuff (older builds still read `reviews`).
        setDoc(doc(firestoreDB, 'reviews', uid), { ownedPets: newOwned, wishlistPets: newWishlist, updatedAt: fsServerTimestamp() }, { merge: true }),
      ]);
      updateLocalState('ownedPets', newOwned);
      updateLocalState('wishlistPets', newWishlist);
      setOwned(newOwned);
      setWishlist(newWishlist);
      setDreamKeyLocal(uid, null);
      setDreamKey(null);
      reportDreamFound(dreamKey).then((st) => { if (st && mounted.current) setStats(st); }).catch(() => {});
      syncTradeInventory(uid, newOwned, newWishlist, { dreamKey: null, lang: i18n.language });
      setProofPet({ name: pet.name || pet.Name, image: imageOf(pet.imageUrl || pet.image, imgBase), label: variantLabel({ v: pet.valueType, f: pet.isFly, r: pet.isRide }) });
    } catch (e) {
      console.warn('[TradeMatch] got-it failed:', e?.message);
      showErrorMessage(t('home.alert.error'), t('trade_match.error_save'));
    }
  }, [wishlist, owned, dreamKey, firestoreDB, uid, updateLocalState, i18n.language, imgBase, t]);

  const confirmGotIt = useCallback(() => {
    const name = dreamPet?.name || dreamPet?.Name || '';
    Alert.alert(
      t('trade_match.got_it_confirm_title', { pet: name }),
      t('trade_match.got_it_confirm_body'),
      [
        { text: t('trade_match.cancel'), style: 'cancel' },
        { text: t('trade_match.got_it_yes'), onPress: markGotIt },
      ],
    );
  }, [dreamPet, markGotIt, t]);

  const renderHeader = () => (
    <View>
      {/* Dream pet */}
      <View style={[styles.dreamCard, { backgroundColor: isDark ? '#2e1065' : '#F5F3FF', borderColor: ACCENT + '55' }]}>
        {dreamPet ? (
          <>
            <Text style={[styles.dreamLabel, { color: ACCENT }]}>⭐ {t('trade_match.dream_label')}</Text>
            <View style={[styles.row, { marginTop: 8 }]}>
              {imageOf(dreamPet.imageUrl || dreamPet.image, imgBase)
                ? <Image source={{ uri: imageOf(dreamPet.imageUrl || dreamPet.image, imgBase) }} style={styles.dreamImg} />
                : <Text style={{ fontSize: 40 }}>🐾</Text>}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.dreamName, { color: c.text }]} numberOfLines={2}>
                  {dreamPet.name || dreamPet.Name}{' '}
                  <Text style={styles.chipVariant}>{variantLabel({ v: dreamPet.valueType, f: dreamPet.isFly, r: dreamPet.isRide })}</Text>
                </Text>
                <TouchableOpacity onPress={() => setPickerOpen(true)}>
                  <Text style={[styles.link, { color: ACCENT }]}>{t('trade_match.dream_change')}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={[styles.gotBtn]} onPress={confirmGotIt} activeOpacity={0.85}>
                <Text style={styles.gotText}>{t('trade_match.got_it')}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.dreamName, { color: c.text }]}>🎯 {t('trade_match.dream_pick')}</Text>
            <Text style={[styles.muted, { color: c.textSecondary, marginTop: 6 }]}>{t('trade_match.dream_pick_hint')}</Text>
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 12 }]}
              onPress={() => (choices.length ? setPickerOpen(true) : navigation.navigate('MyStuffScreen', { initialTab: 'goals' }))}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryText}>{choices.length ? t('trade_match.dream_pick') : t('trade_match.open_wishlist')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Social proof */}
      {!!stats && (stats.traders > 0 || stats.found7d > 0) && (
        <View style={[styles.row, styles.statsRow]}>
          {stats.traders > 0 && (
            <Text style={[styles.statText, { color: c.textSecondary }]}>👥 {t('trade_match.stats_traders', { count: stats.traders })}</Text>
          )}
          {stats.found7d > 0 && (
            <Text style={[styles.statText, { color: c.textSecondary }]}>🎉 {t('trade_match.stats_found', { count: stats.found7d })}</Text>
          )}
        </View>
      )}

      {/* What is missing for good matches */}
      {forTradeCount === 0 && (
        <TouchableOpacity
          style={[styles.tip, { backgroundColor: c.bgAlt, borderColor: c.border }]}
          onPress={() => navigation.navigate('MyStuffScreen', { initialTab: 'pets' })}
          activeOpacity={0.8}
        >
          <Icon name="swap-horizontal" size={18} color={GREEN} />
          <Text style={[styles.tipText, { color: c.text }]}>{t('trade_match.need_for_trade')}</Text>
          <Text style={[styles.link, { color: ACCENT }]}>{t('trade_match.open_my_pets')}</Text>
        </TouchableOpacity>
      )}

      {matches.length > 0 && (
        <Text style={[styles.listTitle, { color: c.text }]}>{t('trade_match.matches_title')}</Text>
      )}
    </View>
  );

  const renderEmpty = () => (loading ? (
    <ActivityIndicator style={{ marginTop: 40 }} color={ACCENT} />
  ) : !loadError && wantCount === 0 ? (
    // Nothing to search for yet: wishlist pets start "Private", so a new
    // wishlist alone gives Trade Match nothing. Say so instead of "No matches".
    <View style={styles.empty}>
      <Text style={{ fontSize: 40 }}>🎯</Text>
      <Text style={[styles.emptyTitle, { color: c.text }]}>{t('trade_match.dream_pick')}</Text>
      <Text style={[styles.muted, { color: c.textSecondary, textAlign: 'center' }]}>{t('trade_match.dream_pick_hint')}</Text>
      <TouchableOpacity
        style={[styles.primaryBtn, { marginTop: 8 }]}
        onPress={() => (choices.length ? setPickerOpen(true) : navigation.navigate('MyStuffScreen', { initialTab: 'goals' }))}
        activeOpacity={0.85}
      >
        <Text style={styles.primaryText}>{choices.length ? t('trade_match.dream_pick') : t('trade_match.open_wishlist')}</Text>
      </TouchableOpacity>
    </View>
  ) : (
    <View style={styles.empty}>
      <Text style={{ fontSize: 40 }}>{loadError ? '⚠️' : '🔍'}</Text>
      <Text style={[styles.emptyTitle, { color: c.text }]}>
        {loadError ? t('trade_match.error_load') : t('trade_match.empty_title')}
      </Text>
      {!loadError && <Text style={[styles.muted, { color: c.textSecondary, textAlign: 'center' }]}>{t('trade_match.empty_body')}</Text>}
    </View>
  ));

  return (
    <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="arrow-back" size={22} color={c.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: c.text }]}>{t('trade_match.title')}</Text>
          <Text style={[styles.headerSub, { color: c.textSecondary }]} numberOfLines={1}>{t('trade_match.subtitle')}</Text>
        </View>
        {!!uid && (
          <TouchableOpacity
            onPress={toggleAlerts}
            style={styles.iconBtn}
            accessibilityLabel={alertsOn ? t('trade_match.alerts_on') : t('trade_match.alerts_off')}
          >
            <Icon name={alertsOn ? 'notifications' : 'notifications-off-outline'} size={22} color={alertsOn ? ACCENT : c.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {!uid ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 40 }}>🔒</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('trade_match.sign_in')}</Text>
        </View>
      ) : (
        <FlatList
          removeClippedSubviews={false}
          data={matches}
          keyExtractor={(m) => m.uid}
          renderItem={({ item }) => (
            <MatchCard m={item} dreamKey={dreamKey} imgBase={imgBase} c={c} onMessage={openChat} />
          )}
          ListHeaderComponent={renderHeader()}
          ListEmptyComponent={renderEmpty()}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          initialNumToRender={6}
          windowSize={7}
        />
      )}

      {/* Dream pet picker */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { backgroundColor: c.bg, paddingBottom: insets.bottom + 12 }]}>
            <View style={[styles.row, { justifyContent: 'space-between', marginBottom: 10 }]}>
              <Text style={[styles.listTitle, { color: c.text, marginTop: 0 }]}>{t('trade_match.dream_pick')}</Text>
              <TouchableOpacity onPress={() => setPickerOpen(false)} style={styles.iconBtn}>
                <Icon name="close" size={22} color={c.text} />
              </TouchableOpacity>
            </View>
            <FlatList
              removeClippedSubviews={false}
              data={choices}
              keyExtractor={(x) => x.key}
              numColumns={3}
              renderItem={({ item }) => {
                const uri = imageOf(item.pet.imageUrl || item.pet.image, imgBase);
                return (
                  <TouchableOpacity
                    style={[styles.pickCell, { backgroundColor: c.bgAlt, borderColor: item.key === dreamKey ? GOLD : c.border }]}
                    onPress={() => pickDream(item)}
                    activeOpacity={0.8}
                  >
                    {uri ? <Image source={{ uri }} style={styles.pickImg} /> : <Text style={{ fontSize: 30 }}>🐾</Text>}
                    <Text style={[styles.pickName, { color: c.text }]} numberOfLines={2}>{item.pet.name || item.pet.Name}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* "I got it!" proof card */}
      <Modal visible={!!proofPet} transparent animationType="fade" onRequestClose={() => setProofPet(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.proofWrap}>
            <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }}>
              <View style={styles.proofCard}>
                <Text style={styles.proofConfetti}>🎉 ✨ 🎉</Text>
                <Text style={styles.proofTitle}>{t('trade_match.proof_title')}</Text>
                <View style={styles.proofImgWrap}>
                  {proofPet?.image
                    ? <Image source={{ uri: proofPet.image }} style={styles.proofImg} />
                    : <Text style={{ fontSize: 80 }}>🐾</Text>}
                </View>
                <Text style={styles.proofPet} numberOfLines={2}>
                  {proofPet?.name} {!!proofPet?.label && <Text style={styles.proofVariant}>{proofPet.label}</Text>}
                </Text>
                <View style={styles.proofBadge}>
                  <Text style={styles.proofBadgeText}>🎯 {t('trade_match.proof_found_with')}</Text>
                </View>
                {!!user?.displayName && <Text style={styles.proofUser}>@{user.displayName}</Text>}
                <View style={{ flex: 1 }} />
                <Text style={styles.proofFooter}>{config.appName} · {SITE}</Text>
              </View>
            </ViewShot>
            <View style={[styles.row, { gap: 10, marginTop: 14 }]}>
              <TouchableOpacity style={[styles.primaryBtn, { flex: 1 }]} onPress={shareProof} activeOpacity={0.85}>
                <Icon name="share-social" size={16} color="#fff" />
                <Text style={styles.primaryText}>{t('trade_match.share')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryBtn, { flex: 1 }]} onPress={() => setProofPet(null)} activeOpacity={0.85}>
                <Text style={styles.secondaryText}>{t('trade_match.close')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  headerSub: { fontSize: 12, marginTop: 1 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  dreamCard: { borderRadius: 16, borderWidth: 1, padding: 14 },
  dreamLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  dreamImg: { width: 64, height: 64, resizeMode: 'contain' },
  dreamName: { fontSize: 17, fontWeight: '800' },
  link: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  gotBtn: { backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginLeft: 8 },
  gotText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  primaryBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  secondaryBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  statsRow: { flexWrap: 'wrap', gap: 12, marginTop: 12 },
  statText: { fontSize: 12, fontWeight: '600' },
  tip: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  tipText: { flex: 1, fontSize: 13, lineHeight: 18 },
  listTitle: { fontSize: 16, fontWeight: '800', marginTop: 18, marginBottom: 8 },
  card: { borderRadius: 14, borderWidth: 1, padding: 12, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: { backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 15, fontWeight: '800', flexShrink: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 11, fontWeight: '800' },
  msgBtn: { backgroundColor: ACCENT, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  msgText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  sectionLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, maxWidth: '100%' },
  chipImg: { width: 24, height: 24, resizeMode: 'contain', marginRight: 4 },
  chipImgFallback: { fontSize: 16, marginRight: 4 },
  chipText: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  chipVariant: { fontSize: 11, fontWeight: '800', color: ACCENT, marginLeft: 4 },
  muted: { fontSize: 13, lineHeight: 18 },
  empty: { alignItems: 'center', paddingTop: 40, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: '75%' },
  pickCell: { flex: 1 / 3, margin: 4, borderWidth: 1, borderRadius: 12, alignItems: 'center', padding: 8 },
  pickImg: { width: 56, height: 56, resizeMode: 'contain' },
  pickName: { fontSize: 12, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  proofWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  proofCard: { width: 270, height: 480, borderRadius: 20, backgroundColor: '#4C1D95', alignItems: 'center', padding: 18, overflow: 'hidden' },
  proofConfetti: { fontSize: 22, marginTop: 6 },
  proofTitle: { color: '#FDE68A', fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  proofImgWrap: { width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  proofImg: { width: 140, height: 140, resizeMode: 'contain' },
  proofPet: { color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center', marginTop: 14 },
  proofVariant: { color: '#FDE68A', fontSize: 18, fontWeight: '900' },
  proofBadge: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12 },
  proofBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  proofUser: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700', marginTop: 10 },
  proofFooter: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '700' },
});
