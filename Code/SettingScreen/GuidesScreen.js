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

// Translation keys only; t() runs at render time so the text follows the app language.
const GUIDES = [
  {
    id: 'values',
    icon: '💎',
    titleKey: 'settings.guides.values_title',
    itemKeys: [
      'settings.guides.values_1',
      'settings.guides.values_2',
      'settings.guides.values_3',
      'settings.guides.values_4',
      'settings.guides.values_5',
    ],
  },
  {
    id: 'trading',
    icon: '🔄',
    titleKey: 'settings.guides.trading_title',
    itemKeys: [
      'settings.guides.trading_1',
      'settings.guides.trading_2',
      'settings.guides.trading_3',
      'settings.guides.trading_4',
      'settings.guides.trading_5',
    ],
  },
  {
    id: 'mystuff',
    icon: '🎒',
    titleKey: 'settings.guides.mystuff_title',
    itemKeys: [
      'settings.guides.mystuff_1',
      'settings.guides.mystuff_2',
    ],
  },
  {
    id: 'chat',
    icon: '💬',
    titleKey: 'settings.guides.chat_title',
    itemKeys: [
      'settings.guides.chat_1',
      'settings.guides.chat_2',
      'settings.guides.chat_3',
      'settings.guides.chat_4',
      'settings.guides.chat_5',
    ],
  },
  {
    id: 'rating',
    icon: '⭐',
    titleKey: 'settings.guides.rating_title',
    itemKeys: [
      'settings.guides.rating_1',
      'settings.guides.rating_2',
      'settings.guides.rating_3',
      'settings.guides.rating_4',
      'settings.guides.rating_5',
    ],
  },
  {
    id: 'badges',
    icon: '🏆',
    titleKey: 'settings.guides.badges_title',
    itemKeys: [
      'settings.guides.badges_1',
      'settings.guides.badges_2',
      'settings.guides.badges_3',
      'settings.guides.badges_4',
      'settings.guides.badges_5',
    ],
  },
  {
    id: 'profile',
    icon: '👤',
    titleKey: 'settings.guides.profile_title',
    itemKeys: [
      'settings.guides.profile_1',
      'settings.guides.profile_2',
      'settings.guides.profile_3',
      'settings.guides.profile_4',
      'settings.guides.profile_5',
    ],
  },
  {
    id: 'safety',
    icon: '🛡️',
    titleKey: 'settings.guides.safety_title',
    itemKeys: [
      'settings.guides.safety_1',
      'settings.guides.safety_2',
      'settings.guides.safety_3',
      'settings.guides.safety_4',
      'settings.guides.safety_5',
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
            {t('guides.title')}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        {/* Subtitle */}
        <Text style={styles.subtitle}>
          {t('guides.subtitle')}
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
                    {t(guide.titleKey)}
                  </Text>
                  <Icon
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={isDark ? '#94A3B8' : '#64748B'}
                  />
                </TouchableOpacity>

                {isOpen && (
                  <View style={styles.cardBody}>
                    {guide.itemKeys.map((itemKey, idx) => (
                      <View key={itemKey} style={styles.stepRow}>
                        <View style={styles.stepNumber}>
                          <Text style={styles.stepNumberText}>{idx + 1}</Text>
                        </View>
                        <Text style={styles.stepText}>
                          {t(itemKey)}
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
