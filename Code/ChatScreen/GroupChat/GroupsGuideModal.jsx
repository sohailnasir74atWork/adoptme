import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import SwipeableBottomDrawer from '../../Helper/SwipeableBottomDrawer';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';

const GroupsGuideModal = ({ visible, onClose }) => {
  const { theme } = useGlobalState();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);

  const styles = useMemo(() => getStyles(isDarkMode, c), [isDarkMode]);

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <SwipeableBottomDrawer onClose={onClose} isDarkMode={isDarkMode} style={[styles.modalContent, { backgroundColor: c.bgAlt }]}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: c.text }]}>
              {t('groups.guide.title')}
            </Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Icon name="close-circle" size={28} color={c.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            style={styles.scrollContainer}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="people" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: c.text }]}>
                {t('groups.guide.create_title')}
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                {t('groups.guide.create_step_1')}{'\n\n'}
                {t('groups.guide.create_step_2')}{'\n\n'}
                {t('groups.guide.create_step_3')}{'\n\n'}
                {t('groups.guide.create_step_4')}{'\n\n'}
                {t('groups.guide.create_step_5')}{'\n\n'}
                {t('groups.guide.create_step_6')}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="information-circle" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: c.text }]}>
                {t('groups.guide.rules_title')}
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                • <Text style={styles.boldText}>{t('groups.guide.rule_one_group_label')}</Text> {t('groups.guide.rule_one_group')}{'\n\n'}
                • <Text style={styles.boldText}>{t('groups.guide.rule_min_members_label')}</Text> {t('groups.guide.rule_min_members')}{'\n\n'}
                • <Text style={styles.boldText}>{t('groups.guide.rule_max_members_label')}</Text> {t('groups.guide.rule_max_members')}{'\n\n'}
                • <Text style={styles.boldText}>{t('groups.guide.rule_admin_label')}</Text> {t('groups.guide.rule_admin')}{'\n\n'}
                • <Text style={styles.boldText}>{t('groups.guide.rule_transfer_label')}</Text> {t('groups.guide.rule_transfer')}{'\n\n'}
                • <Text style={styles.boldText}>{t('groups.guide.rule_leaving_label')}</Text> {t('groups.guide.rule_leaving')}{'\n\n'}
                • <Text style={styles.boldText}>{t('groups.guide.rule_invites_label')}</Text> {t('groups.guide.rule_invites')}
              </Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.section}>
              <View style={styles.iconContainer}>
                <Icon name="chatbubbles" size={24} color={config.colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: c.text }]}>
                {t('groups.guide.features_title')}
              </Text>
              <Text style={[styles.sectionText, { color: isDarkMode ? '#D1D5DB' : '#4B5563' }]}>
                • {t('groups.guide.feature_messages')}{'\n\n'}
                • {t('groups.guide.feature_online')}{'\n\n'}
                • {t('groups.guide.feature_roles')}{'\n\n'}
                • {t('groups.guide.feature_notifications')}
              </Text>
            </View>
          </ScrollView>

          {/* Close Button */}
          <TouchableOpacity
            style={[styles.gotItButton, { backgroundColor: config.colors.primary }]}
            onPress={onClose}
          >
            <Text style={styles.gotItButtonText}>{t('groups.guide.got_it')}</Text>
          </TouchableOpacity>
        </SwipeableBottomDrawer>
      </View>
    </Modal>
  );
};

const getStyles = (isDarkMode, c) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    modalContent: {
      width: '100%',
      maxHeight: '85%',
      padding: 20,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 4,
      elevation: 5,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 20,
    },
    modalTitle: {
      fontSize: 24,
      fontWeight: 'bold',
    },
    closeButton: {
      padding: 4,
    },
    scrollContainer: {
      marginBottom: 20,
    },
    scrollContent: {
      paddingBottom: 10,
    },
    section: {
      marginBottom: 20,
    },
    iconContainer: {
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 12,
    },
    sectionText: {
      fontSize: 14,

      lineHeight: 22,
    },
    boldText: {
      fontWeight: 'bold',
      color: config.colors.primary,
    },
    divider: {
      height: 1,
      backgroundColor: c.border,
      marginVertical: 20,
    },
    gotItButton: {
      paddingVertical: 14,
      paddingHorizontal: 30,
      borderRadius: 10,
      alignItems: 'center',
      marginTop: 10,
    },
    gotItButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
    },
  });

export default GroupsGuideModal;

