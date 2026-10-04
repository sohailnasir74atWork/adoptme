/**
 * MoreHubScreen.jsx
 * The More tab's home: one card per tool. Each card pushes its screen onto
 * the More stack (./MoreNavigator), so the tab bar stays visible and tapping
 * the More tab again returns here.
 *
 * HD Wallpapers gets the full-width card; the rest share a two-column grid.
 * Icons come from scripts/more-hub/make-icons.mjs.
 */

import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { useHaptic } from '../Helper/HepticFeedBack';

export const MORE_ICONS = {
  more: require('../../assets/more-hub/more.png'),
  wallpaper: require('../../assets/more-hub/wallpaper.png'),
  servers: require('../../assets/more-hub/servers.png'),
  scammer: require('../../assets/more-hub/scammer.png'),
  news: require('../../assets/more-hub/news.png'),
  admin: require('../../assets/more-hub/admin.png'),
};

const chunkPairs = (items) => {
  const rows = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
};

const MoreHubScreen = ({ navigation, background }) => {
  const { t } = useTranslation();
  const { theme, isAdmin } = useGlobalState();
  const { triggerHapticFeedback } = useHaptic();
  const insets = useSafeAreaInsets();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);

  const cards = useMemo(() => {
    const list = [
      { key: 'servers', screen: 'MoreServers', title: t('more_hub.servers_title'), desc: t('more_hub.servers_desc'), color: '#2563EB' },
      { key: 'scammer', screen: 'MoreScammers', title: t('tabs.scammer_db'), desc: t('more_hub.scammer_desc'), color: '#DC2626' },
      { key: 'news', screen: 'MoreNews', title: t('tabs.news'), desc: t('more_hub.news_desc'), color: '#EA580C' },
    ];
    // Staff-only card, left in English like the rest of the staff tools.
    if (isAdmin) list.push({ key: 'admin', screen: 'MoreAdmin', title: 'Admin', desc: 'Feedback and poll results', color: '#0D9488' });
    return list;
  }, [t, isAdmin]);

  const open = (screen) => {
    triggerHapticFeedback('impactLight');
    navigation.navigate(screen);
  };

  return (
    <View style={[styles.flex1, { backgroundColor: background || c.bg }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 12 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.flex1}>
            <Text style={[styles.headerTitle, { color: c.text }]}>{t('tabs.more')}</Text>
            <Text style={[styles.headerSub, { color: c.textSecondary }]}>{t('more_hub.subtitle')}</Text>
          </View>
          <Image source={MORE_ICONS.more} style={styles.headerIcon} resizeMode="contain" />
        </View>

        <TouchableOpacity style={styles.hero} onPress={() => open('MoreWallpapers')} activeOpacity={0.88}>
          <View style={styles.heroGlow} />
          <View style={styles.flex1}>
            <Text style={styles.heroTitle}>{t('tabs.hd_wallpaper')}</Text>
            <Text style={styles.heroSub} numberOfLines={2}>{t('more_hub.wallpaper_desc')}</Text>
            <View style={styles.heroBtn}>
              <Text style={styles.heroBtnText}>{t('more_hub.browse')}</Text>
              <Icon name="arrow-forward" size={13} color="#7C3AED" />
            </View>
          </View>
          <Image source={MORE_ICONS.wallpaper} style={styles.heroIcon} resizeMode="contain" />
        </TouchableOpacity>

        {chunkPairs(cards).map((row) => (
          <View key={row[0].key} style={styles.row}>
            {row.map((card) => (
              <TouchableOpacity
                key={card.key}
                style={[styles.card, { backgroundColor: c.cardBg, borderColor: c.cardBorder }]}
                onPress={() => open(card.screen)}
                activeOpacity={0.85}
              >
                <View style={[styles.cardWash, { backgroundColor: card.color + (isDarkMode ? '24' : '14') }]} />
                <View style={styles.cardTop}>
                  <Image source={MORE_ICONS[card.key]} style={styles.cardIcon} resizeMode="contain" />
                  <View style={[styles.chevron, { backgroundColor: card.color }]}>
                    <Icon name="chevron-forward" size={14} color="#fff" />
                  </View>
                </View>
                <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>{card.title}</Text>
                <Text style={[styles.cardDesc, { color: c.textSecondary }]} numberOfLines={2}>{card.desc}</Text>
              </TouchableOpacity>
            ))}
            {row.length === 1 && <View style={styles.cardSpacer} />}
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  headerTitle: { fontSize: 28, fontWeight: '800', letterSpacing: -0.3 },
  headerSub: { fontSize: 13, marginTop: 2 },
  headerIcon: { width: 44, height: 44 },

  hero: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 18, paddingRight: 10, borderRadius: 22, marginBottom: 12, overflow: 'hidden',
    backgroundColor: '#7C3AED',
    backgroundImage: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 45%, #DB2777 100%)',
  },
  heroGlow: {
    position: 'absolute', right: -30, top: -40, width: 170, height: 170, borderRadius: 85,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  heroTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  heroSub: { color: 'rgba(255,255,255,0.88)', fontSize: 12.5, lineHeight: 17, marginTop: 4 },
  heroBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
    marginTop: 12, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: '#fff',
  },
  heroBtnText: { color: '#7C3AED', fontSize: 12.5, fontWeight: '800' },
  heroIcon: { width: 96, height: 96 },

  row: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  card: {
    flex: 1, minHeight: 148, padding: 14, borderRadius: 20, borderWidth: 1, overflow: 'hidden',
  },
  cardSpacer: { flex: 1 },
  cardWash: { position: 'absolute', left: 0, right: 0, top: 0, height: 74 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  cardIcon: { width: 52, height: 52 },
  chevron: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardDesc: { fontSize: 11.5, lineHeight: 15, marginTop: 3 },
});

export default MoreHubScreen;
