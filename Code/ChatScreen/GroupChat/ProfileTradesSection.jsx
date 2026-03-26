import React from 'react';
import { getThemeColors } from '../../Helper/themeColors';
import { View, Text, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';

/**
 * Trades section — modernised card design with icon header
 */
const ProfileTradesSection = ({
  isDarkMode,
  t,
  trades,
  loadingTrades,
  hasMoreTrades,
  handleLoadMoreTrades,
  renderTradeItem,
}) => {
  const c = getThemeColors(isDarkMode);
  return (
    <View
      style={{
        borderRadius: 14,
        padding: 12,
        backgroundColor: c.bgAlt,
        marginBottom: 8,
      }}
    >
      {/* Section Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <View style={{
          width: 24, height: 24, borderRadius: 8,
          backgroundColor: isDarkMode ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.1)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="swap-horizontal" size={12} color="#10b981" />
        </View>
        <Text style={{
          fontSize: 12, fontWeight: '700',
          color: c.text,
        }}>
          {t('profile.recent_trades')}
        </Text>
        <Text style={{
          fontSize: 10, fontWeight: '600',
          color: c.textMuted,
          marginLeft: 'auto',
        }}>
          {trades.length > 0 ? `${trades.length}+` : ''}
        </Text>
      </View>

      {loadingTrades && trades.length === 0 ? (
        <ActivityIndicator
          size="small"
          color={config.colors.primary}
          style={{ paddingVertical: 12 }}
        />
      ) : trades.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 16, gap: 6 }}>
          <Icon name="repeat-outline" size={24} color={isDarkMode ? '#334155' : '#d1d5db'} />
          <Text style={{ fontSize: 11, color: isDarkMode ? '#64748b' : '#9ca3af' }}>
            {t('profile.no_trades_yet')}
          </Text>
        </View>
      ) : (
        <>
          {trades.map((trade) => renderTradeItem(trade))}

          {hasMoreTrades && !loadingTrades && (
            <TouchableOpacity
              onPress={handleLoadMoreTrades}
              style={{
                marginTop: 8, alignSelf: 'center',
                flexDirection: 'row', alignItems: 'center', gap: 4,
                paddingHorizontal: 14, paddingVertical: 6,
                borderRadius: 999, borderWidth: 1,
                borderColor: c.border,
                backgroundColor: c.bg,
              }}
            >
              <Icon name="chevron-down" size={12} color={c.textSecondary} />
              <Text style={{ fontSize: 11, fontWeight: '600', color: c.textSecondary }}>
                {t('profile.load_more_trades')}
              </Text>
            </TouchableOpacity>
          )}

          {loadingTrades && hasMoreTrades && (
            <ActivityIndicator size="small" color={config.colors.primary} style={{ marginTop: 6 }} />
          )}
        </>
      )}
    </View>
  );
};

export default React.memo(ProfileTradesSection);
