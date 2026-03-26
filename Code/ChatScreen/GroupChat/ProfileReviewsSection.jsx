import React from 'react';
import { getThemeColors } from '../../Helper/themeColors';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';

const STAR_OPTIONS = [null, 5, 4, 3, 2, 1]; // null = All

/**
 * Reviews section — modernised card design with icon header + star filter pills
 * Reviews are fetched server-side from Firestore (filtered by rating when a star is selected)
 */
const ProfileReviewsSection = ({
  isDarkMode,
  t,
  reviews,
  loadingReviews,
  hasMoreReviews,
  handleLoadMoreReviews,
  renderStars,
  getTimestampMs,
  formatCreatedAt,
  starFilter = null,
  setStarFilter,
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
          backgroundColor: isDarkMode ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.1)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="star" size={12} color="#fbbf24" />
        </View>
        <Text style={{
          fontSize: 12, fontWeight: '700',
          color: c.text,
        }}>
          {t('profile.recent_reviews')}
        </Text>
        <Text style={{
          fontSize: 10, fontWeight: '600',
          color: c.textMuted,
          marginLeft: 'auto',
        }}>
          {reviews.length > 0 ? `${reviews.length}+` : ''}
        </Text>
      </View>

      {/* ⭐ Star Filter Pills — horizontal scroll */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 10 }}
        contentContainerStyle={{ gap: 6, paddingRight: 4 }}
      >
        {STAR_OPTIONS.map((star) => {
          const isActive = starFilter === star;
          const label = star === null
            ? (t('profile.filter_all') || 'All')
            : `${star}★`;

          return (
            <TouchableOpacity
              key={star === null ? 'all' : star}
              onPress={() => setStarFilter?.(star)}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
                borderWidth: 1,
                backgroundColor: isActive
                  ? (isDarkMode ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.15)')
                  : (c.bg),
                borderColor: isActive
                  ? '#fbbf24'
                  : (c.border),
              }}
            >
              {star !== null && (
                <Text style={{
                  fontSize: 10,
                  color: isActive ? '#fbbf24' : (c.textSecondary),
                }}>
                  ★
                </Text>
              )}
              <Text style={{
                fontSize: 11,
                fontWeight: isActive ? '700' : '600',
                color: isActive
                  ? (isDarkMode ? '#fbbf24' : '#b45309')
                  : (c.textSecondary),
              }}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Reviews list — already filtered server-side by Firestore */}
      {loadingReviews && reviews.length === 0 ? (
        <ActivityIndicator
          size="small"
          color={config.colors.primary}
          style={{ paddingVertical: 12 }}
        />
      ) : reviews.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 16, gap: 6 }}>
          <Icon
            name={starFilter ? 'filter-outline' : 'chatbubble-ellipses-outline'}
            size={24}
            color={isDarkMode ? '#334155' : '#d1d5db'}
          />
          <Text style={{ fontSize: 11, color: isDarkMode ? '#64748b' : '#9ca3af' }}>
            {starFilter
              ? t('profile.no_reviews_for_filter', { star: starFilter })
              : t('profile.no_reviews_yet')}
          </Text>
        </View>
      ) : (
        <>
          {reviews.map((rev, idx) => {
            const tsMs = getTimestampMs(rev.updatedAt || rev.createdAt);
            const timeLabel = tsMs ? formatCreatedAt(tsMs) : null;

            return (
              <View
                key={rev.id}
                style={{
                  paddingVertical: 8, paddingHorizontal: 2,
                  borderBottomWidth: idx < reviews.length - 1 ? 1 : 0,
                  borderBottomColor: isDarkMode ? 'rgba(51,65,85,0.5)' : 'rgba(226,232,240,0.8)',
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                    <View style={{
                      width: 22, height: 22, borderRadius: 11,
                      backgroundColor: c.border,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ fontSize: 9, fontWeight: '700', color: c.textSecondary }}>
                        {(rev.userName || '?')[0].toUpperCase()}
                      </Text>
                    </View>
                    <Text style={{
                      fontSize: 12, fontWeight: '600',
                      color: c.text,
                    }} numberOfLines={1}>
                      {rev.userName || t('profile.anonymous')}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {timeLabel && (
                      <Text style={{ fontSize: 9, color: c.textMuted }}>
                        {timeLabel}
                      </Text>
                    )}
                    {renderStars(rev?.rating || 0)}
                  </View>
                </View>
                {!!rev?.review && (
                  <Text style={{
                    fontSize: 11, color: isDarkMode ? '#cbd5e1' : '#475569',
                    lineHeight: 16, marginLeft: 28,
                  }}>
                    {rev.review}
                  </Text>
                )}
                {rev?.edited && (
                  <Text style={{ fontSize: 9, color: c.textMuted, marginTop: 2, marginLeft: 28, fontStyle: 'italic' }}>
                    {t('reviews.edited')}
                  </Text>
                )}
              </View>
            );
          })}

          {hasMoreReviews && !loadingReviews && (
            <TouchableOpacity
              onPress={handleLoadMoreReviews}
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
                {t('profile.load_more_reviews')}
              </Text>
            </TouchableOpacity>
          )}

          {loadingReviews && hasMoreReviews && (
            <ActivityIndicator size="small" color={config.colors.primary} style={{ marginTop: 6 }} />
          )}
        </>
      )}
    </View>
  );
};

export default React.memo(ProfileReviewsSection);
