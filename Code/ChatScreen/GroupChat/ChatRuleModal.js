import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useMemo } from 'react';
import { getThemeColors } from '../../Helper/themeColors';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import config from '../../Helper/Environment';
import SwipeableBottomDrawer from '../../Helper/SwipeableBottomDrawer';

// Rule keys under chat.community_rules.* — translated at render time so the
// list follows the app language (it used to show the English `rulesen` array
// from ../utils to everyone).
const RULE_KEYS = [
  'chat.community_rules.rule_1',
  'chat.community_rules.rule_2',
  'chat.community_rules.rule_3',
  'chat.community_rules.rule_4',
  'chat.community_rules.rule_5',
  'chat.community_rules.rule_6',
  'chat.community_rules.rule_7',
  'chat.community_rules.rule_8',
  'chat.community_rules.rule_9',
  'chat.community_rules.rule_10',
  'chat.community_rules.rule_11',
  'chat.community_rules.rule_12',
];
const PRIVACY_URL = 'https://www.adoptmevalues.app/privacy';

const ChatRulesModal = ({ visible, onClose, isDarkMode }) => {
  const insets = useSafeAreaInsets();
  const c = getThemeColors(isDarkMode);
  const { t } = useTranslation();
  // ✅ Memoize the translated rules array
  const rules = useMemo(
    () => RULE_KEYS.map((key) => t(key, { url: PRIVACY_URL })),
    [t]
  );

  // ✅ Memoize modal background color
  const modalBgColor = useMemo(() =>
    isDarkMode ? '#0f172a' : '#fff',
    [isDarkMode]
  );

  // ✅ Memoize text colors
  const titleColor = useMemo(() =>
    c.text,
    [isDarkMode]
  );

  const ruleTextColor = useMemo(() =>
    isDarkMode ? '#ccc' : '#333',
    [isDarkMode]
  );

  // ✅ Validate onClose callback
  const handleClose = () => {
    if (onClose && typeof onClose === 'function') {
      onClose();
    }
  };

  return (
    <Modal animationType="slide" transparent={true} visible={visible} onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <SwipeableBottomDrawer onClose={handleClose} isDarkMode={isDarkMode} style={[styles.modalContent, { backgroundColor: modalBgColor, paddingBottom: insets.bottom }]}>
          <Text style={[styles.title, { color: titleColor }]}>{t('chat.community_rules.title')}</Text>
          <ScrollView style={styles.scroll}>
            {rules.map((rule, index) => {
              // ✅ Safety check for rule
              if (!rule || typeof rule !== 'string') return null;

              return (
                <Text
                  key={index}
                  style={[styles.ruleText, { color: ruleTextColor }]}
                >
                  {index + 1}. {rule}
                </Text>
              );
            })}
          </ScrollView>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>{t('chat.got_it')}</Text>
          </TouchableOpacity>
        </SwipeableBottomDrawer>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    width: '100%',
    maxHeight: '80%',
    padding: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  scroll: {
    marginBottom: 20,
  },
  ruleText: {
    fontSize: 14,

    marginBottom: 10,
  },
  closeButton: {
    backgroundColor: config.colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default ChatRulesModal;
