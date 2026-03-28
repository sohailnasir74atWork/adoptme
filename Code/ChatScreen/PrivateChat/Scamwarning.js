import { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';

export default function ScamSafetyBox({
  setShowRatingModal,
  canRate,
  hasRated,
}) {
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const { t } = useTranslation();
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const handleOpenRating = useCallback(() => {
    if (setShowRatingModal && typeof setShowRatingModal === 'function') {
      setShowRatingModal(true);
    }
  }, [setShowRatingModal]);

  return (
    <View style={styles.container}>
      <View style={styles.safetyRow}>
        <Text style={styles.warningIcon}>⚠️</Text>
        <Text style={styles.safetyText} numberOfLines={1}>
          {t('chat.safety_too_good')} · {t('chat.safety_no_login')}
        </Text>
        {canRate && (
          <TouchableOpacity
            style={styles.rateChip}
            onPress={handleOpenRating}
            activeOpacity={0.7}
          >
            <Text style={styles.rateChipText}>
              {hasRated ? t('chat.rating_edit') : t('chat.rating_btn')} ⭐
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const getStyles = (isDark) =>
  StyleSheet.create({
    container: {
      marginHorizontal: 6,
      marginVertical: 2,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 8,
      backgroundColor: isDark ? 'rgba(30,41,59,0.7)' : 'rgba(255,251,235,0.85)',
      borderWidth: 0.5,
      borderColor: isDark ? 'rgba(71,85,105,0.4)' : 'rgba(251,191,119,0.3)',
    },
    safetyRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    warningIcon: {
      fontSize: 11,
      marginRight: 4,
    },
    safetyText: {
      flex: 1,
      fontSize: 9.5,
      lineHeight: 13,
      color: isDark ? '#CBD5E1' : '#78716C',
    },
    rateChip: {
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.12)',
      marginLeft: 6,
    },
    rateChipText: {
      fontSize: 10,
      fontWeight: '600',
      color: isDark ? '#FCD34D' : '#B45309',
    },
  });
