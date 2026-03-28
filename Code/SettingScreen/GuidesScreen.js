import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../GlobelStats';
import { useTranslation } from 'react-i18next';

const GUIDES = [
  {
    id: 'values',
    icon: '💎',
    titleKey: 'guides.values_title',
    titleDefault: 'Pet Values',
    items: [
      { key: 'guides.values_1', default: 'All pet values are community-driven and update regularly based on real trading data.' },
      { key: 'guides.values_2', default: 'Values are shown in Default (D), Neon (N), and Mega (M) variants.' },
      { key: 'guides.values_3', default: 'Demand scores (🔥) show how popular a pet currently is in the trading community.' },
      { key: 'guides.values_4', default: 'Use the search and filters to quickly find any pet, egg, vehicle, or toy.' },
      { key: 'guides.values_5', default: 'Trending pets on the home screen show what\'s rising or falling in value.' },
    ],
  },
  {
    id: 'trading',
    icon: '🔄',
    titleKey: 'guides.trading_title',
    titleDefault: 'Trading',
    items: [
      { key: 'guides.trading_1', default: 'Go to the Trades tab to browse active trade listings from the community.' },
      { key: 'guides.trading_2', default: 'Create your own trade by tapping "+ New Trade" and selecting items you want to give & get.' },
      { key: 'guides.trading_3', default: 'Chat privately with traders to negotiate — you\'ll see typing indicators and read receipts.' },
      { key: 'guides.trading_4', default: 'Use the Trade Calculator to check if a trade is fair before accepting!' },
      { key: 'guides.trading_5', default: 'Track your completed trades in "My Stuff" to build your trade history.' },
    ],
  },
  {
    id: 'mystuff',
    icon: '🎒',
    titleKey: 'guides.mystuff_title',
    titleDefault: 'My Stuff',
    items: [
      { key: 'guides.mystuff_1', default: '🐾 My Pets — Add your owned pets to see your total portfolio value and demand breakdown.' },
      { key: 'guides.mystuff_2', default: '⭐ Goals — Add dream pets to your wishlist and track progress towards getting them.' },
      { key: 'guides.mystuff_3', default: '⚡ Active Trades — See your open trades and mark them as complete when done in-game.' },
      { key: 'guides.mystuff_4', default: '🕐 History — View all your past trades with stats like win rate and net value.' },
      { key: 'guides.mystuff_5', default: 'Completing a trade auto-updates your pets (adds what you got, removes what you gave) and earns XP!' },
    ],
  },
  {
    id: 'chat',
    icon: '💬',
    titleKey: 'guides.chat_title',
    titleDefault: 'Private Chat',
    items: [
      { key: 'guides.chat_1', default: 'Tap any user\'s name to open a private chat and start a conversation.' },
      { key: 'guides.chat_2', default: 'See "typing..." in the header when the other person is typing a message.' },
      { key: 'guides.chat_3', default: 'Grey ✓✓ means your message was delivered. Blue ✓✓ means the other person has seen it.' },
      { key: 'guides.chat_4', default: 'Send images, share pets, and use quick message templates for fast replies.' },
      { key: 'guides.chat_5', default: 'Long-press any message to copy, translate, or report it.' },
    ],
  },
  {
    id: 'rating',
    icon: '⭐',
    titleKey: 'guides.rating_title',
    titleDefault: 'Rating & Reviews',
    items: [
      { key: 'guides.rating_1', default: 'Open a private chat with any user and exchange at least 3 messages each.' },
      { key: 'guides.rating_2', default: 'Once 3 messages are exchanged, the ⭐ Rate button appears at the top of the chat.' },
      { key: 'guides.rating_3', default: 'Tap the stars to set 1–5 rating, optionally add a written review, then submit.' },
      { key: 'guides.rating_4', default: 'You can edit your rating anytime by tapping the ⭐ Edit Rating button.' },
      { key: 'guides.rating_5', default: 'Honest ratings help the community find trustworthy traders and stay safe!' },
    ],
  },
  {
    id: 'games',
    icon: '🎮',
    titleKey: 'guides.games_title',
    titleDefault: 'Mini Games',
    items: [
      { key: 'guides.games_1', default: '🎡 Daily Spin — Spin the wheel once a day to win XP and rewards.' },
      { key: 'guides.games_2', default: '🧠 Pet Quiz — Answer 5 pet value questions to earn XP. Test your knowledge!' },
      { key: 'guides.games_3', default: '🃏 Memory Match — Flip cards to match pet pairs. Faster matches = more XP!' },
      { key: 'guides.games_4', default: '⚔️ Quiz Battle — Challenge a friend in real-time and see who knows pet values better!' },
      { key: 'guides.games_5', default: '💰 Trade Duel — Go head-to-head: pick the higher-value pet to win. 2-player!' },
      { key: 'guides.games_6', default: '🥚 Mystery Egg — Hatch eggs to win cosmetic items for your profile!' },
    ],
  },
  {
    id: 'badges',
    icon: '🏆',
    titleKey: 'guides.badges_title',
    titleDefault: 'Badges & XP',
    items: [
      { key: 'guides.badges_1', default: 'Earn XP by logging in daily, rating traders, completing trades, playing games, and posting.' },
      { key: 'guides.badges_2', default: 'Badges are awarded when you hit milestones — e.g., 5 ratings, 10 trades, etc.' },
      { key: 'guides.badges_3', default: 'Your badges are shown on your profile for everyone to see.' },
      { key: 'guides.badges_4', default: 'Higher-tier badges (Uncommon, Rare) require more activity — keep going!' },
      { key: 'guides.badges_5', default: 'Daily login streaks give bonus XP — don\'t break your streak!' },
    ],
  },
  {
    id: 'profile',
    icon: '👤',
    titleKey: 'guides.profile_title',
    titleDefault: 'Your Profile',
    items: [
      { key: 'guides.profile_1', default: 'Tap your avatar in Settings to edit your display name, bio, and profile picture.' },
      { key: 'guides.profile_2', default: 'Add your owned pets and wishlist so other traders know what you have & want.' },
      { key: 'guides.profile_3', default: 'Other users can see your profile by tapping your name in any chat.' },
      { key: 'guides.profile_4', default: 'Your rating, badges, XP level, and trade history are all visible on your profile.' },
      { key: 'guides.profile_5', default: 'Follow traders you trust to easily find them later in the Friends section.' },
    ],
  },
  {
    id: 'safety',
    icon: '🛡️',
    titleKey: 'guides.safety_title',
    titleDefault: 'Scam Safety',
    items: [
      { key: 'guides.safety_1', default: 'Never share your Roblox password or login info with anyone.' },
      { key: 'guides.safety_2', default: 'If a deal sounds too good to be true, it probably is — be cautious.' },
      { key: 'guides.safety_3', default: 'Use the official Roblox trading system inside the game to complete trades.' },
      { key: 'guides.safety_4', default: 'Report suspicious users by long-pressing their message and selecting "Report".' },
      { key: 'guides.safety_5', default: 'Check a trader\'s rating and reviews on their profile before trading with them.' },
    ],
  },
];

export default function GuidesScreen({ visible, onClose }) {
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();
  const styles = useMemo(() => getStyles(isDark), [isDark]);
  const [expanded, setExpanded] = useState({});

  const toggleSection = useCallback((id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Icon name="close" size={24} color={isDark ? '#E2E8F0' : '#1E293B'} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {t('guides.title', { defaultValue: '📖 How It Works' })}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Subtitle */}
        <Text style={styles.subtitle}>
          {t('guides.subtitle', { defaultValue: 'Everything you need to know about using the app.' })}
        </Text>

        {/* Guide sections */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {GUIDES.map((guide) => {
            const isOpen = expanded[guide.id] || false;
            return (
              <View key={guide.id} style={styles.card}>
                <TouchableOpacity
                  style={styles.cardHeader}
                  onPress={() => toggleSection(guide.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cardIcon}>{guide.icon}</Text>
                  <Text style={styles.cardTitle}>
                    {t(guide.titleKey, { defaultValue: guide.titleDefault })}
                  </Text>
                  <Icon
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={isDark ? '#94A3B8' : '#64748B'}
                  />
                </TouchableOpacity>

                {isOpen && (
                  <View style={styles.cardBody}>
                    {guide.items.map((item, idx) => (
                      <View key={idx} style={styles.stepRow}>
                        <View style={styles.stepNumber}>
                          <Text style={styles.stepNumberText}>{idx + 1}</Text>
                        </View>
                        <Text style={styles.stepText}>
                          {t(item.key, { defaultValue: item.default })}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const getStyles = (isDark) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDark ? '#0F172A' : '#F8FAFC',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? '#1E293B' : '#E2E8F0',
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDark ? '#1E293B' : '#F1F5F9',
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: isDark ? '#F1F5F9' : '#0F172A',
    },
    subtitle: {
      fontSize: 13,
      color: isDark ? '#94A3B8' : '#64748B',
      textAlign: 'center',
      paddingHorizontal: 24,
      paddingVertical: 10,
    },
    scrollView: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 4,
    },

    /* Card */
    card: {
      marginBottom: 10,
      borderRadius: 14,
      backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#E2E8F0',
      overflow: 'hidden',
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 14,
    },
    cardIcon: {
      fontSize: 20,
      marginRight: 10,
    },
    cardTitle: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: isDark ? '#E2E8F0' : '#1E293B',
    },
    cardBody: {
      paddingHorizontal: 14,
      paddingBottom: 14,
      borderTopWidth: 1,
      borderTopColor: isDark ? '#334155' : '#F1F5F9',
      paddingTop: 10,
    },

    /* Steps */
    stepRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 8,
    },
    stepNumber: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: isDark ? '#334155' : '#E2E8F0',
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 10,
      marginTop: 1,
    },
    stepNumberText: {
      fontSize: 11,
      fontWeight: '700',
      color: isDark ? '#94A3B8' : '#64748B',
    },
    stepText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      color: isDark ? '#CBD5E1' : '#475569',
    },
  });
