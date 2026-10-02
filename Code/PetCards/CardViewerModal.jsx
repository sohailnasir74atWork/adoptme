/**
 * CardViewerModal — one card, big. Drag to tilt; tap to turn it over for the
 * details (origin, every finish owned with counts and serials, and today's
 * values: the back is the only place on a card where live numbers appear).
 * Owned: switch finish, share, pin to the profile showcase.
 * Missing: the silhouette, where it drops, and Craft for shards.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet, Animated, Easing, ScrollView, useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/Ionicons';
import PetCard from './PetCard';
import CardShine from './CardShine';
import CardShareSheet from './CardShareSheet';
import CardIcon from './cardIcons';
import { FINISHES, CRAFT_COST, RARITY_STYLE, FIRST_EDITION_MAX } from './cardConfig';
import { bestOwned, formatCompact, isShowcased } from './cardMath';

const INK = '#F4ECFF';
const MUTED = 'rgba(244,236,255,0.65)';

export default function CardViewerModal({
  card, entries, values, total, shards = 0, showcase = null, onClose, onCraft, onShowcase, crafting = false,
}) {
  const { t, i18n } = useTranslation();
  const { width: W } = useWindowDimensions();
  const visible = !!card;
  const owned = Array.isArray(entries) && entries.length > 0;
  const best = useMemo(() => bestOwned(entries), [entries]);
  const [finish, setFinish] = useState(best?.finish || 'classic');
  const [details, setDetails] = useState(false);
  const [share, setShare] = useState(null);
  const turn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setFinish(best?.finish || 'classic');
    setDetails(false);
    turn.setValue(0);
  }, [card?.key, best?.finish, turn]);

  if (!card) return null;
  const cw = Math.min(W - 64, 340);
  const entry = (entries || []).find((e) => e[0] === finish);
  const serial = entry ? entry[2] : null;
  const rs = RARITY_STYLE[card.rarity] || RARITY_STYLE.common;
  const cost = CRAFT_COST[card.rarity];
  const v = values || {};

  const flipTo = (toDetails) => {
    Animated.timing(turn, { toValue: toDetails ? 1 : 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    setTimeout(() => setDetails(toDetails), 190);
  };
  const frontRot = turn.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['0deg', '90deg', '90deg'] });
  const backRot = turn.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-90deg', '-90deg', '0deg'] });

  const ownedFinishes = FINISHES.filter((f) => (entries || []).some((e) => e[0] === f));
  const pinned = isShowcased(showcase, card.key, finish);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.close} onPress={onClose} hitSlop={14}>
          <Icon name="close" size={28} color={INK} />
        </TouchableOpacity>

        <View style={{ width: cw, height: cw * 1.4 }}>
          <Animated.View style={{ position: 'absolute', transform: [{ perspective: 1000 }, { rotateY: frontRot }] }}>
            <CardShine width={cw} height={cw * 1.4} idle={owned} spin={owned && finish === 'mega'} onTap={() => flipTo(true)}>
              {(shine) => (
                <PetCard card={card} finish={finish} serial={serial} width={cw} owned={owned} total={total} shine={shine} />
              )}
            </CardShine>
          </Animated.View>
          <Animated.View style={{ position: 'absolute', transform: [{ perspective: 1000 }, { rotateY: backRot }] }} pointerEvents={details ? 'auto' : 'none'}>
            <TouchableOpacity activeOpacity={0.95} onPress={() => flipTo(false)}>
              <View style={[styles.detail, { width: cw, height: cw * 1.4, borderColor: rs.base }]}>
                <ScrollView contentContainerStyle={{ padding: 18 }}>
                  <Text style={styles.dName}>{card.name}</Text>
                  <Text style={[styles.dRarity, { color: rs.glow }]}>{t(`pet_cards.rarity.${card.rarity}`)} · {total ? `${card.no}/${total}` : `#${card.no}`}</Text>
                  <View style={styles.dRow}><Text style={styles.dLabel}>{t('pet_cards.stat_value')}</Text><Text style={styles.dVal}>{v.r != null ? formatCompact(v.r) : '—'}</Text></View>
                  <View style={styles.dRow}><Text style={styles.dLabel}>{t('pet_cards.stat_neon')}</Text><Text style={styles.dVal}>{v.n != null ? formatCompact(v.n) : '—'}</Text></View>
                  <View style={styles.dRow}><Text style={styles.dLabel}>{t('pet_cards.stat_mega')}</Text><Text style={styles.dVal}>{v.m != null ? formatCompact(v.m) : '—'}</Text></View>
                  <Text style={styles.dAsOf}>{t('pet_cards.wp_as_of', { date: new Date().toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) })}</Text>
                  <View style={styles.dRow}>
                    <Text style={styles.dLabel}>{t('pet_cards.origin')}</Text>
                    <Text style={styles.dVal}>
                      {(card.sets || []).includes('haunted26') ? t('pet_cards.sets.haunted26') : card.egg ? t(`pet_cards.eggs.${card.egg}`, { defaultValue: card.egg }) : '—'}
                    </Text>
                  </View>
                  <Text style={styles.dHead}>{t('pet_cards.your_copies')}</Text>
                  {owned ? FINISHES.filter((f) => (entries || []).some((e) => e[0] === f)).map((f) => {
                    const e = entries.find((x) => x[0] === f);
                    return (
                      <View key={f} style={styles.dRow}>
                        <Text style={styles.dLabel}>{t(`pet_cards.finish.${f}`)} ×{e[1]}</Text>
                        <Text style={styles.dVal}>
                          {e[2] != null ? `#${String(e[2]).padStart(4, '0')}${e[2] <= FIRST_EDITION_MAX ? ` · ${t('pet_cards.first_edition')}` : ''}` : ''}
                        </Text>
                      </View>
                    );
                  }) : <Text style={styles.dMuted}>{t('pet_cards.not_collected')}</Text>}
                  <Text style={styles.dFan}>{t('pet_cards.disclaimer')}</Text>
                </ScrollView>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </View>

        <Text style={styles.tip}>{details ? t('pet_cards.tap_front') : t('pet_cards.tap_details')}</Text>

        {ownedFinishes.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.finishes}>
            {ownedFinishes.map((f) => (
              <TouchableOpacity key={f} onPress={() => setFinish(f)} style={[styles.fChip, f === finish && styles.fChipOn]}>
                <Text style={[styles.fChipText, f === finish && { color: '#1A0E00' }]}>{t(`pet_cards.finish.${f}`)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.actions}>
          {owned ? (
            <>
              <TouchableOpacity style={[styles.btn, { backgroundColor: rs.base }]} onPress={() => setShare({ ...card, finish, serial })}>
                <CardIcon name="share" size={16} />
                <Text style={styles.btnText}>{t('pet_cards.share')}</Text>
              </TouchableOpacity>
              {onShowcase ? (
                <TouchableOpacity style={[styles.btn, styles.ghost, pinned && styles.ghostOn]} onPress={() => onShowcase(card, finish)}>
                  <CardIcon name={pinned ? 'pinOff' : 'pin'} size={16} />
                  <Text style={[styles.btnText, { color: INK }]}>{t(pinned ? 'pet_cards.showcase_remove' : 'pet_cards.showcase')}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <TouchableOpacity
              disabled={shards < cost || crafting}
              style={[styles.btn, { backgroundColor: '#38BDF8', opacity: shards < cost || crafting ? 0.45 : 1 }]}
              onPress={() => onCraft && onCraft(card)}
            >
              <Text style={styles.btnText}>{t('pet_cards.craft', { cost })}</Text>
            </TouchableOpacity>
          )}
        </View>
        {!owned ? <Text style={styles.tip}>{t('pet_cards.craft_hint', { have: shards })}</Text> : null}
        {owned && onShowcase ? <Text style={styles.tip}>{t('pet_cards.showcase_hint')}</Text> : null}
      </View>
      <CardShareSheet card={share} total={total} onClose={() => setShare(null)} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,12,0.94)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: 54, right: 20, zIndex: 3 },
  detail: { borderRadius: 16, borderWidth: 2, backgroundColor: '#140F24', overflow: 'hidden' },
  dName: { color: INK, fontSize: 22, fontWeight: '900' },
  dRarity: { fontSize: 14, fontWeight: '900', marginTop: 4, marginBottom: 10 },
  dHead: { color: INK, fontSize: 14, fontWeight: '900', marginTop: 16, marginBottom: 4 },
  dRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.12)' },
  dLabel: { color: MUTED, fontSize: 13, fontWeight: '700' },
  dVal: { color: INK, fontSize: 13, fontWeight: '900' },
  dMuted: { color: MUTED, fontSize: 13, marginTop: 4 },
  dAsOf: { color: 'rgba(244,236,255,0.45)', fontSize: 10, fontWeight: '600', marginTop: 5 },
  dFan: { color: 'rgba(244,236,255,0.4)', fontSize: 10, marginTop: 16 },
  tip: { color: MUTED, fontSize: 12, fontWeight: '700', marginTop: 14 },
  finishes: { gap: 8, paddingHorizontal: 20, marginTop: 12 },
  fChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  fChipOn: { backgroundColor: '#FFD23F', borderColor: '#FFD23F' },
  fChipText: { color: INK, fontWeight: '800', fontSize: 12 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  btn: { height: 46, paddingHorizontal: 20, borderRadius: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  ghost: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  ghostOn: { borderColor: 'rgba(255,210,63,0.7)', backgroundColor: 'rgba(255,210,63,0.12)' },
  btnText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
});
