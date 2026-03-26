import React, { useMemo } from 'react';
import { getThemeColors } from '../../Helper/themeColors';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { BADGE_DEFINITIONS, BADGE_DISPLAY_ORDER } from './badgeUtils';

/**
 * Badge Showcase — shows earned badge pills on profile
 * Non-expandable — just displays earned badges inline
 */
const BadgeShowcase = ({ isDarkMode, t, earnedBadges = {} }) => {
  const c = getThemeColors(isDarkMode);
  const earnedCount = useMemo(() => {
    return BADGE_DISPLAY_ORDER.filter(id => earnedBadges[id]).length;
  }, [earnedBadges]);

  if (earnedCount === 0) return null;

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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{
          width: 24, height: 24, borderRadius: 8,
          backgroundColor: isDarkMode ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.1)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="ribbon" size={12} color="#fbbf24" />
        </View>
        <Text style={{
          fontSize: 12, fontWeight: '700',
          color: c.text,
        }}>
          {t('profile.badges_title') || 'Badges'}
        </Text>
        <View style={{
          backgroundColor: c.border,
          paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999,
          marginLeft: 4,
        }}>
          <Text style={{ fontSize: 9, fontWeight: '700', color: c.textSecondary }}>
            {earnedCount}/{BADGE_DISPLAY_ORDER.length}
          </Text>
        </View>
      </View>

      {/* Earned badge pills */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
        {BADGE_DISPLAY_ORDER.filter(id => earnedBadges[id]).map(id => {
          const badge = BADGE_DEFINITIONS[id];
          return (
            <View
              key={id}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 3,
                paddingHorizontal: 7, paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: isDarkMode ? badge.bgDark : badge.bgLight,
              }}
            >
              <Text style={{ fontSize: 10 }}>{badge.emoji}</Text>
              <Text style={{ fontSize: 9, fontWeight: '700', color: badge.color }}>
                {badge.name}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default React.memo(BadgeShowcase);
