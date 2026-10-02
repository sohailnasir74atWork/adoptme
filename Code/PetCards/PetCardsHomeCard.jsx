/**
 * PetCardsHomeCard — the Home entry to Pet Cards: a mini pack that glows when
 * a pack is ready. One cards_state call per Home focus (cached 2 min in
 * cardsApi). Hidden for signed-in players while the server has no packs
 * (before 037 is deployed, or between seasons).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { getCardsState, setCardsUser } from './cardsApi';
import { packsAvailable } from './cardMath';
import { themeOf } from './cardConfig';
import PackArt from './PackArt';

export default function PetCardsHomeCard({ userId, requireSignIn }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [info, setInfo] = useState(null);     // { ready, theme, setName }
  const [hidden, setHidden] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;

  useFocusEffect(useCallback(() => {
    if (!userId) {
      setHidden(false);
      setInfo(null);
      return undefined;
    }
    let live = true;
    setCardsUser(userId);
    getCardsState().then((st) => {
      if (!live) return;
      const pack = (st?.sets || []).find((s) => s.kind === 'pack' && s.open && s.total > 0);
      if (!pack) { setHidden(true); return; }
      setHidden(false);
      setInfo({ ready: packsAvailable(st.wallet), theme: pack.theme, setId: pack.id });
    }).catch(() => { if (live) setHidden(true); });
    return () => { live = false; };
  }, [userId]));

  useEffect(() => {
    if (!info?.ready) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [info?.ready, pulse]);

  if (hidden) return null;
  const theme = themeOf(info?.theme || 'haunted');
  const sub = info?.ready
    ? t('pet_cards.home_ready', { count: info.ready })
    : userId ? t('pet_cards.home_wait') : t('pet_cards.home_signed_out');

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={() => (__DEV__ && !userId
        ? navigation.navigate('PetCards') // dev preview (local mock), never in release
        : requireSignIn(() => navigation.navigate('PetCards'), t('pet_cards.sign_in')))}
      style={[styles.card, { backgroundImage: `linear-gradient(120deg, ${theme.stage[0]} 0%, ${theme.stage[1]} 55%, ${theme.packA} 100%)` }]}
    >
      <Animated.View style={{ transform: [{ rotate: '-8deg' }, { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }] }}>
        <PackArt width={40} theme={info?.theme || 'haunted'} title="" glow={info?.ready ? theme.accent : null} />
      </Animated.View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={styles.title}>{t('pet_cards.title')}</Text>
          <View style={[styles.newPill, { backgroundColor: theme.accent }]}>
            <Text style={styles.newText}>{t('home_tab.new')}</Text>
          </View>
        </View>
        <Text style={styles.sub} numberOfLines={2}>{sub}</Text>
      </View>
      <FontAwesome name="chevron-right" size={14} color="#fff" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16,
    marginHorizontal: 16, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  title: { color: '#fff', fontSize: 16, fontWeight: '900' },
  sub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2, lineHeight: 16 },
  newPill: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1 },
  newText: { color: '#1A0E00', fontSize: 9, fontWeight: '900' },
});
