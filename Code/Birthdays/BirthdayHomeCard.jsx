/**
 * BirthdayHomeCard — the Home entry to Birthdays. One of, in this order:
 *   1. It is your birthday: the celebration (gift pack, wishes).
 *   2. Your birthday is within a week: a countdown. Birthdays are shown by
 *      default (050); "Hide my birthday" lives on the Birthdays screen.
 *   3. Other players (opted in) have a birthday today: "Send a wish".
 * Otherwise nothing. Reads birthday_home only (a few KB, kept on the phone
 * for the day and refreshed at most every 2 hours; see birthdayApi).
 */

import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import SafeLottieView from '../Helper/SafeLottieView';
import { setBirthdayUser, getBirthdayHome, todayBirthdayCount } from './birthdayApi';
import { daysUntilBirthday } from './birthdayDate';
import { BIRTHDAY_GRADIENT } from './BirthdayBits';
import HomeCardArt from '../HomeTab/HomeCardArt';

const COUNTDOWN_DAYS = 7;

export default function BirthdayHomeCard({ userId, userName }) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [mine, setMine] = useState(null);
  const [todayCount, setTodayCount] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!userId && !__DEV__) { setMine(null); setTodayCount(0); return undefined; }
    let live = true;
    setBirthdayUser(userId);
    getBirthdayHome()
      .then((h) => {
        if (!live) return;
        setMine(h);
        setTodayCount(todayBirthdayCount(userId));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [userId]));

  const open = useCallback(() => navigation.navigate('Birthdays'), [navigation]);

  const days = mine?.month ? daysUntilBirthday(mine.month, mine.day) : null;

  // 1. Your birthday.
  if (days === 0) {
    return (
      // Each variant has its own key: a view that gains a gradient in place
      // crashes Android (RN 0.87 BackgroundImageDrawable); a fresh one is fine.
      <TouchableOpacity key="party" activeOpacity={0.9} onPress={open} style={[styles.card, styles.party, { backgroundImage: BIRTHDAY_GRADIENT }]}>
        <SafeLottieView
          source={require('../../assets/lottie/confetti.json')}
          autoPlay
          loop={false}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <HomeCardArt name="cake" />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{t('birthdays.home_happy', { name: userName || t('birthdays.you') })}</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {mine.giftReady ? t('birthdays.home_gift') : t('birthdays.home_wishes', { count: mine.wishCount || 0 })}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="#fff" />
      </TouchableOpacity>
    );
  }

  // 2. Coming up: a countdown.
  if (days != null && days <= COUNTDOWN_DAYS) {
    return (
      <TouchableOpacity key="soon" activeOpacity={0.9} onPress={open} style={[styles.card, { backgroundImage: BIRTHDAY_GRADIENT }]}>
        <HomeCardArt name="balloons" />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {days === 1 ? t('birthdays.home_soon_tomorrow') : t('birthdays.home_soon', { count: days })}
          </Text>
          <Text style={styles.sub} numberOfLines={2}>
            {mine.show ? t('birthdays.home_soon_shown') : t('birthdays.home_soon_hidden')}
          </Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="#fff" />
      </TouchableOpacity>
    );
  }

  // 3. Other players' birthdays today.
  if (todayCount > 0) {
    return (
      <TouchableOpacity key="others" activeOpacity={0.9} onPress={open} style={[styles.card, { backgroundImage: BIRTHDAY_GRADIENT }]}>
        <HomeCardArt name="gift" />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{t('birthdays.home_others', { count: todayCount })}</Text>
          <Text style={styles.sub} numberOfLines={1}>{t('birthdays.home_send_wish')}</Text>
        </View>
        <FontAwesome name="chevron-right" size={14} color="#fff" />
      </TouchableOpacity>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 16,
    marginHorizontal: 16, marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  party: { paddingVertical: 16 },
  title: { color: '#fff', fontSize: 16, fontWeight: '900' },
  sub: { color: 'rgba(255,255,255,0.92)', fontSize: 12, marginTop: 2, lineHeight: 16, fontWeight: '600' },
});
