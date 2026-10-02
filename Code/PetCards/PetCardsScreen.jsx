/**
 * PetCardsScreen — the Card Hub (PET_CARDS_PLAN.md §2.2).
 *
 * The featured pack with its open button (free → bonus → stars), a pack
 * picker, the 7-day streak, album progress per set, and the odds sheet.
 * One cards_state call when it opens (cached 2 min in cardsApi).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, RefreshControl,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import usePetCards from './usePetCards';
import PackArt from './PackArt';
import PetCard from './PetCard';
import { setProgress, countdown, nextUtcMidnight, bestOwned } from './cardMath';
import {
  themeOf, RARITIES, FINISHES, RARITY_STYLE, STAR_PACK_COST, STREAK_BONUS_EVERY,
} from './cardConfig';
import { isMockActive } from './cardsApi';

const BG = '#0B0816';
const CARD = 'rgba(255,255,255,0.06)';
const LINE = 'rgba(255,255,255,0.10)';
const INK = '#F4ECFF';
const MUTED = 'rgba(244,236,255,0.62)';

export const setName = (t, set) =>
  t(`pet_cards.sets.${set.id}`, { defaultValue: set.names?.en || set.id });

function useClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function OddsSheet({ visible, onClose, set, t }) {
  const odds = set?.odds || {};
  const row = (label, value, color) => (
    <View key={label} style={styles.oddsRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {color ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} /> : null}
        <Text style={styles.oddsLabel}>{label}</Text>
      </View>
      <Text style={styles.oddsValue}>{value}%</Text>
    </View>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <Text style={styles.sheetTitle}>{t('pet_cards.odds_title', { set: set ? setName(t, set) : '' })}</Text>
            <Text style={styles.sheetSub}>{t('pet_cards.odds_intro')}</Text>
            <Text style={styles.oddsHead}>{t('pet_cards.odds_slots')}</Text>
            {RARITIES.map((r) => row(t(`pet_cards.rarity.${r}`), odds.slot?.[r] ?? 0, RARITY_STYLE[r].base))}
            <Text style={styles.oddsHead}>{t('pet_cards.odds_hit')}</Text>
            {['rare', 'ultra', 'legendary'].map((r) => row(t(`pet_cards.rarity.${r}`), odds.hit?.[r] ?? 0, RARITY_STYLE[r].base))}
            <Text style={styles.oddsHead}>{t('pet_cards.odds_finish')}</Text>
            {FINISHES.map((f) => row(t(`pet_cards.finish.${f}`), odds.finish?.[f] ?? 0))}
            <Text style={styles.oddsNote}>
              {t('pet_cards.odds_fair', { legend: odds.pity_legend ?? 8, holo: odds.pity_holo ?? 12 })}
            </Text>
            <Text style={styles.oddsNote}>{t('pet_cards.odds_free_note')}</Text>
          </ScrollView>
          <TouchableOpacity style={styles.sheetClose} onPress={onClose}>
            <Text style={styles.sheetCloseText}>{t('pet_cards.close')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function PetCardsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const route = useRoute();
  const insets = useSafeAreaInsets();
  const now = useClock();
  const { wallet, sets, catalog, owned, collection, loading, error, reload, uid } = usePetCards();
  const [setId, setSetId] = useState(route.params?.setId || null);
  const [oddsOpen, setOddsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { trackGrowthEvent('cards_hub_open', {}); }, []);

  const packSets = useMemo(() => sets.filter((s) => s.kind === 'pack' && s.open && s.total > 0), [sets]);
  const current = packSets.find((s) => s.id === setId) || packSets[0] || null;
  const theme = themeOf(current?.theme);
  const progress = current ? setProgress(catalog, owned, current.id) : null;

  const albums = useMemo(() => sets
    .filter((s) => s.total > 0)
    .map((s) => ({ set: s, p: setProgress(catalog, owned, s.id) }))
    .sort((a, b) => a.set.sort - b.set.sort), [sets, catalog, owned]);

  const showcase = useMemo(() => {
    // Rarest three cards the player owns, for the hero strip.
    const list = [];
    Object.entries(owned).forEach(([k, entries]) => {
      const c = catalog.find((x) => x.key === k);
      const b = bestOwned(entries);
      if (c && b) list.push({ c, b });
    });
    return list
      .sort((a, b) => FINISHES.indexOf(b.b.finish) - FINISHES.indexOf(a.b.finish)
        || RARITIES.indexOf(b.c.rarity) - RARITIES.indexOf(a.c.rarity))
      .slice(0, 3);
  }, [owned, catalog]);

  const open = (source) => {
    if (!current) return;
    navigation.navigate('PackOpening', { setId: current.id, source, theme: current.theme });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  if (!uid) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <Header t={t} navigation={navigation} />
        <Text style={[styles.empty, { marginTop: 80 }]}>{t('pet_cards.sign_in')}</Text>
      </View>
    );
  }

  const free = wallet?.freeReady;
  const bonus = wallet?.bonusPacks || 0;
  const starsLeft = wallet?.starPacksLeft ?? 0;
  const left = countdown(nextUtcMidnight(now), now);
  const streak = wallet?.streak || 0;
  const streakPos = streak % STREAK_BONUS_EVERY;

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.stage[0] }]}>
      <Header t={t} navigation={navigation} wallet={wallet} onOdds={() => setOddsOpen(true)} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
      >
        {loading && !current ? <ActivityIndicator color="#fff" style={{ marginTop: 80 }} /> : null}
        {error && !current ? (
          <Text style={[styles.empty, { marginTop: 60 }]}>{t('pet_cards.err.generic')}</Text>
        ) : null}
        {!loading && !error && !current ? <Text style={[styles.empty, { marginTop: 60 }]}>{t('pet_cards.no_packs')}</Text> : null}

        {current ? (
          <View style={[styles.hero, { backgroundImage: `radial-gradient(ellipse 90% 70% at 50% 35%, ${theme.stage[2]} 0%, ${theme.stage[1]} 45%, ${theme.stage[0]} 100%)` }]}>
            {packSets.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {packSets.map((s) => (
                  <TouchableOpacity key={s.id} onPress={() => setSetId(s.id)} style={[styles.chip, s.id === current.id && { backgroundColor: themeOf(s.theme).accent }]}>
                    <Text style={[styles.chipText, s.id === current.id && { color: '#1A0E00' }]}>{setName(t, s)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}

            <TouchableOpacity activeOpacity={0.9} onPress={() => (free ? open('free') : bonus ? open('bonus') : null)} style={{ alignItems: 'center', marginTop: 8 }}>
              <PackArt width={170} theme={current.theme} title={setName(t, current)} subtitle={t('pet_cards.three_cards')} glow={free || bonus ? theme.accent : null} />
            </TouchableOpacity>

            {current.endsAt ? (
              <Text style={styles.ends}>{t('pet_cards.ends_on', { date: new Date(current.endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) })}</Text>
            ) : null}

            {progress ? (
              <View style={styles.progressWrap}>
                <View style={styles.progressBar}>
                  <View style={[styles.progressFill, { width: `${Math.round((progress.have / Math.max(1, progress.total)) * 100)}%`, backgroundColor: theme.accent }]} />
                </View>
                <Text style={styles.progressText}>{t('pet_cards.collected', { have: progress.have, total: progress.total })}</Text>
              </View>
            ) : null}

            {free ? (
              <TouchableOpacity style={[styles.primary, { backgroundColor: theme.accent }]} onPress={() => open('free')}>
                <Text style={styles.primaryText}>{t('pet_cards.open_free')}</Text>
              </TouchableOpacity>
            ) : bonus > 0 ? (
              <TouchableOpacity style={[styles.primary, { backgroundColor: theme.accent }]} onPress={() => open('bonus')}>
                <Text style={styles.primaryText}>{t('pet_cards.open_bonus', { count: bonus })}</Text>
              </TouchableOpacity>
            ) : (
              <View style={[styles.primary, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
                <Text style={[styles.primaryText, { color: INK }]}>
                  {left.h > 0 ? t('pet_cards.next_free_hm', { h: left.h, m: left.m }) : t('pet_cards.next_free_m', { m: left.m })}
                </Text>
              </View>
            )}

            <TouchableOpacity
              disabled={starsLeft <= 0}
              onPress={() => open('stars')}
              style={[styles.secondary, starsLeft <= 0 && { opacity: 0.45 }]}
            >
              <Text style={styles.secondaryText}>
                {starsLeft > 0
                  ? t('pet_cards.open_stars', { cost: STAR_PACK_COST, left: starsLeft })
                  : t('pet_cards.stars_done')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity style={styles.studio} activeOpacity={0.88} onPress={() => navigation.navigate('CardWallpaper')}>
          <Text style={styles.studioIcon}>🖼️</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.blockTitle}>{t('pet_cards.wallpaper_title')}</Text>
            <Text style={[styles.blockHint, { marginTop: 2 }]}>{t('pet_cards.wp_entry_sub')}</Text>
          </View>
          <Icon name="chevron-forward" size={18} color={INK} />
        </TouchableOpacity>

        {current ? (
          <View style={styles.block}>
            <View style={styles.rowBetween}>
              <Text style={styles.blockTitle}>{t('pet_cards.streak_title')}</Text>
              <Text style={styles.blockHint}>{t('pet_cards.streak_days', { count: streak })}</Text>
            </View>
            <View style={styles.streakRow}>
              {Array.from({ length: STREAK_BONUS_EVERY }).map((_, i) => {
                const lit = streak > 0 && (i < streakPos || (streakPos === 0 && streak > 0));
                const last = i === STREAK_BONUS_EVERY - 1;
                return (
                  <View key={i} style={[styles.streakDot, lit && { backgroundColor: theme.accent, borderColor: theme.accent }, last && styles.streakGift]}>
                    <Text style={[styles.streakNum, lit && { color: '#1A0E00' }]}>{last ? '🎁' : i + 1}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={styles.blockHint}>{t('pet_cards.streak_hint')}</Text>
          </View>
        ) : null}

        {showcase.length ? (
          <View style={styles.block}>
            <Text style={styles.blockTitle}>{t('pet_cards.best_cards')}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
              {showcase.map(({ c, b }) => (
                <TouchableOpacity key={c.key} onPress={() => navigation.navigate('CardAlbum', { setId: 'all', openKey: c.key })}>
                  <PetCard card={c} finish={b.finish} serial={b.serial} width={104} size="thumb" />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.block}>
          <View style={styles.rowBetween}>
            <Text style={styles.blockTitle}>{t('pet_cards.albums')}</Text>
            <Text style={styles.blockHint}>{t('pet_cards.score', { score: collection?.score ?? wallet?.score ?? 0 })}</Text>
          </View>
          {albums.map(({ set, p }) => (
            <TouchableOpacity key={set.id} style={styles.albumRow} onPress={() => navigation.navigate('CardAlbum', { setId: set.id })}>
              <View style={{ flex: 1 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.albumName} numberOfLines={1}>
                    {p.done ? '✅ ' : ''}{setName(t, set)}
                  </Text>
                  <Text style={styles.albumCount}>{p.have}/{p.total}</Text>
                </View>
                <View style={[styles.progressBar, { marginTop: 8 }]}>
                  <View style={[styles.progressFill, { width: `${Math.round((p.have / Math.max(1, p.total)) * 100)}%`, backgroundColor: themeOf(set.theme).accent }]} />
                </View>
              </View>
              <Icon name="chevron-forward" size={18} color={MUTED} style={{ marginLeft: 10 }} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.disclaimer}>{t('pet_cards.disclaimer')}</Text>
        {__DEV__ && isMockActive() ? <Text style={[styles.disclaimer, { color: '#FBBF24' }]}>DEV: local mock (037 not deployed)</Text> : null}
      </ScrollView>
      <OddsSheet visible={oddsOpen} onClose={() => setOddsOpen(false)} set={current} t={t} />
    </View>
  );
}

function Header({ t, navigation, wallet, onOdds }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.headerBtn}>
        <Icon name="chevron-back" size={24} color={INK} />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>{t('pet_cards.title')}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {wallet ? (
          <View style={styles.shards}>
            <Text style={styles.shardsText}>💠 {wallet.shards}</Text>
          </View>
        ) : null}
        {onOdds ? (
          <TouchableOpacity onPress={onOdds} hitSlop={10} style={styles.headerBtn}>
            <Icon name="information-circle-outline" size={22} color={INK} />
          </TouchableOpacity>
        ) : <View style={styles.headerBtn} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 },
  headerBtn: { width: 32, alignItems: 'center' },
  headerTitle: { color: INK, fontSize: 18, fontWeight: '900', letterSpacing: 0.3 },
  shards: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14, backgroundColor: 'rgba(125,211,252,0.15)', borderWidth: 1, borderColor: 'rgba(125,211,252,0.35)' },
  shardsText: { color: '#BAE6FD', fontWeight: '800', fontSize: 13 },
  hero: { marginHorizontal: 16, marginTop: 4, borderRadius: 24, paddingVertical: 18, paddingHorizontal: 16, alignItems: 'center', borderWidth: 1, borderColor: LINE, overflow: 'hidden' },
  chips: { gap: 8, paddingBottom: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)' },
  chipText: { color: INK, fontWeight: '800', fontSize: 13 },
  ends: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 12 },
  progressWrap: { alignSelf: 'stretch', marginTop: 12 },
  progressBar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  progressText: { color: INK, fontWeight: '800', fontSize: 13, marginTop: 6, textAlign: 'center' },
  primary: { alignSelf: 'stretch', marginTop: 14, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#1A0E00', fontWeight: '900', fontSize: 16, letterSpacing: 0.3 },
  secondary: { alignSelf: 'stretch', marginTop: 10, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  secondaryText: { color: INK, fontWeight: '800', fontSize: 14 },
  block: { marginHorizontal: 16, marginTop: 16, padding: 16, borderRadius: 20, backgroundColor: CARD, borderWidth: 1, borderColor: LINE },
  studio: { marginHorizontal: 16, marginTop: 16, padding: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundImage: 'linear-gradient(120deg, #FF5C8A 0%, #9B5DE5 55%, #3A7BD5 100%)' },
  studioIcon: { fontSize: 30 },
  blockTitle: { color: INK, fontSize: 16, fontWeight: '900' },
  blockHint: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  streakRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  streakDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  streakGift: { borderStyle: 'dashed' },
  streakNum: { color: INK, fontWeight: '900', fontSize: 13 },
  albumRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  albumName: { color: INK, fontSize: 14, fontWeight: '800', flex: 1, marginRight: 8 },
  albumCount: { color: MUTED, fontSize: 13, fontWeight: '800' },
  empty: { color: MUTED, textAlign: 'center', fontSize: 14, fontWeight: '700', paddingHorizontal: 32 },
  disclaimer: { color: 'rgba(244,236,255,0.4)', fontSize: 11, textAlign: 'center', marginTop: 18, paddingHorizontal: 24 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '85%', backgroundColor: '#140F24', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginTop: 10 },
  sheetTitle: { color: INK, fontSize: 18, fontWeight: '900' },
  sheetSub: { color: MUTED, fontSize: 13, marginTop: 6, lineHeight: 18 },
  oddsHead: { color: INK, fontSize: 14, fontWeight: '900', marginTop: 18, marginBottom: 6 },
  oddsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: LINE },
  oddsLabel: { color: INK, fontSize: 14, fontWeight: '700' },
  oddsValue: { color: INK, fontSize: 14, fontWeight: '900' },
  oddsNote: { color: MUTED, fontSize: 12, marginTop: 14, lineHeight: 17 },
  sheetClose: { margin: 16, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  sheetCloseText: { color: INK, fontWeight: '900', fontSize: 15 },
});
