import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';
import { openTradingServer } from '../../Helper/tradingServer';

// How long "Invite sent" shows (and further invites wait) after one is sent.
const INVITE_COOLDOWN_MS = 8000;

export default function ScamSafetyBox({
  setShowRatingModal,
  canRate,
  hasRated,
  onTradeInvite,
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

  // "Trade in game": pinned here so it never scrolls away with the messages.
  // Invite sends the invite message; Join opens the Trading Zone for me.
  const [inviteSent, setInviteSent] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const handleInvite = useCallback(async () => {
    if (inviteSent || !onTradeInvite) return;
    setInviteSent(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setInviteSent(false), INVITE_COOLDOWN_MS);
    await onTradeInvite();
  }, [inviteSent, onTradeInvite]);

  const handleJoin = useCallback(async () => {
    try {
      if (!(await openTradingServer())) Alert.alert(t('alert.error'), t('server.invalid_link'));
    } catch (e) {
      Alert.alert(t('alert.error'), t('server.invalid_link'));
    }
  }, [t]);

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

      {onTradeInvite ? (
        <View style={styles.tradeRow}>
          <Text style={styles.tradeText} numberOfLines={1}>
            🎮 {t('chat.trade_server_invite', { defaultValue: 'Trade in game' })}
          </Text>
          <TouchableOpacity style={styles.tradeChip} onPress={handleInvite} disabled={inviteSent} activeOpacity={0.7}>
            <Text style={styles.tradeChipText}>
              {inviteSent
                ? t('chat.trade_server_sent', { defaultValue: 'Invite sent ✓' })
                : t('chat.trade_server_send', { defaultValue: 'Invite' })}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tradeChip, styles.joinChip]} onPress={handleJoin} activeOpacity={0.7}>
            <Text style={[styles.tradeChipText, styles.joinChipText]}>
              {t('chat.trade_server_join_short', { defaultValue: 'Join' })} ›
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
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
    tradeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 4,
      paddingTop: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: isDark ? 'rgba(71,85,105,0.6)' : 'rgba(251,191,119,0.45)',
    },
    tradeText: {
      flex: 1,
      fontSize: 10.5,
      fontWeight: '700',
      color: isDark ? '#6EE7B7' : '#047857',
    },
    tradeChip: {
      paddingVertical: 3,
      paddingHorizontal: 9,
      borderRadius: 12,
      marginLeft: 6,
      backgroundColor: isDark ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.12)',
    },
    tradeChipText: {
      fontSize: 10,
      fontWeight: '700',
      color: isDark ? '#6EE7B7' : '#047857',
    },
    joinChip: {
      backgroundColor: '#10B981',
    },
    joinChipText: {
      color: '#FFFFFF',
    },
  });
