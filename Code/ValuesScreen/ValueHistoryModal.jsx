/**
 * ValueHistoryModal.jsx
 *
 * Item detail sheet with a value-history chart. Opened by tapping a row in the
 * Values list (browse mode only — in the chat/settings pickers a tap still adds
 * the item to the selection).
 *
 * Coverage is uneven by design of the upstream data: 729 of 762 pets chart
 * cleanly, but most stickers and pet wear have a single snapshot or nothing at
 * all. Every non-chartable case gets an explicit empty state rather than a
 * blank or misleadingly flat graph.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  Image,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { getThemeColors } from '../Helper/themeColors';
import ValueHistoryChart from './ValueHistoryChart';
import { useModalWindowInsets } from '../Helper/useNavBarInset';
import {
  SERIES,
  loadItemHistory,
  getCurrentValueFor,
} from '../Helper/valueHistoryHelper';

const isPetType = (type) => ['PETS', 'PET'].includes(String(type || '').toUpperCase());

// The feed stores this as a double-encoded string ('"true"'), so a plain
// truthiness check passes for '"false"' too.
// Chart ranges (2026-11-05, features LOG batch 3). Points are dated
// 'YYYY-MM-DD'; a range keeps the points on/after its cutoff plus the one just
// before it, so the line starts at the value the range opened with.
const RANGES = [
  { key: '1m', days: 30, label: '1M' },
  { key: '3m', days: 91, label: '3M' },
  { key: '1y', days: 365, label: '1Y' },
  { key: 'all', days: null, label: null },
];

const pointsInRange = (points, days) => {
  if (!days || points.length < 2) return points;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const first = points.findIndex((p) => String(p.date) >= cutoff);
  if (first === -1) return points.slice(-2);
  return points.slice(Math.max(0, first - 1));
};

const hasFlyRide = (item) =>
  String(item?.['fly&ride?'] ?? '').replace(/"/g, '').toLowerCase() === 'true';

const formatValue = (n) => {
  const num = Number(n) || 0;
  return num.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(num) < 0.01 ? 4 : 2,
  });
};

// liveValues=false: the item's own values are from another source (GG) than
// the history feed (Elvebredd), so the chart shows the feed alone.
const ValueHistoryModal = ({ visible, item, imageUrl, isDarkMode, onClose, liveValues = true }) => {
  const { t } = useTranslation();
  const { width: screenWidth } = useWindowDimensions();
  const c = getThemeColors(isDarkMode);
  const styles = useMemo(() => getStyles(c), [c]);
  // The sheet's bottom edge sits under Android's nav bar / the iOS home indicator.
  const insets = useModalWindowInsets();

  const [seriesKey, setSeriesKey] = useState('D');
  const [state, setState] = useState({ status: 'loading', points: [] });
  // Guards against a slow fetch for item A resolving after the user has already
  // opened item B.
  const requestRef = useRef(0);

  // Which bands make sense for this item. Neon/Mega/Fly&Ride are pet-only
  // concepts; showing them on a sticker would offer four identical empty charts.
  const availableSeries = useMemo(() => {
    if (!item) return [];
    if (!isPetType(item.type)) return SERIES.filter((s) => s.key === 'D');
    return SERIES.filter((s) => {
      if (s.key === 'FR') return hasFlyRide(item);
      return true;
    });
  }, [item]);

  // Reset to the default band whenever a different item opens, and drop a
  // selection the new item doesn't offer.
  useEffect(() => {
    if (!visible || !item) return;
    setSeriesKey((prev) =>
      availableSeries.some((s) => s.key === prev) ? prev : (availableSeries[0]?.key || 'D')
    );
  }, [visible, item, availableSeries]);

  const fetchHistory = useCallback(async () => {
    if (!visible || !item) return;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setState({ status: 'loading', points: [] });
    try {
      const result = await loadItemHistory(item, seriesKey, { appendCurrent: liveValues });
      if (requestRef.current !== requestId) return; // superseded
      setState(result);
    } catch (e) {
      if (requestRef.current !== requestId) return;
      setState({ status: 'error', points: [] });
    }
  }, [visible, item, seriesKey, liveValues]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const [rangeKey, setRangeKey] = useState('all');
  const activeRange = RANGES.find((r) => r.key === rangeKey) || RANGES[RANGES.length - 1];
  const rangePoints = useMemo(() => pointsInRange(state.points, activeRange.days), [state.points, activeRange]);
  const activeSpec = SERIES.find((s) => s.key === seriesKey) || SERIES[0];
  const chartWidth = Math.min(screenWidth, 560) - 32 - 24; // screen − sheet margin − card padding

  const stats = useMemo(() => {
    const pts = rangePoints;
    if (!pts.length) return null;
    const values = pts.map((p) => p.value);
    const current = (liveValues ? getCurrentValueFor(item, seriesKey) : null) ?? values[values.length - 1];
    const start = values[0];
    return {
      high: Math.max(...values),
      low: Math.min(...values),
      current,
      change: start > 0 && pts.length > 1 ? ((values[values.length - 1] - start) / start) * 100 : null,
      count: state.points.length,
    };
  }, [rangePoints, state.points.length, item, seriesKey, liveValues]);

  const renderBody = () => {
    if (state.status === 'loading') {
      return (
        <View style={styles.stateBox}>
          <ActivityIndicator color={activeSpec.color} />
        </View>
      );
    }

    if (state.status === 'ok') {
      return (
        <ValueHistoryChart
          points={rangePoints}
          color={activeSpec.color}
          isDarkMode={isDarkMode}
          width={chartWidth}
        />
      );
    }

    const copy = {
      thin: {
        icon: 'analytics-outline',
        title: t('value.history.thin_title', { defaultValue: 'History not available for this item' }),
        body: t('value.history.thin_body', {
          defaultValue: 'Only one price has been recorded so far, so there is nothing to chart yet. It will appear once a second value is published.',
        }),
      },
      none: {
        icon: 'help-circle-outline',
        title: t('value.history.none_title', { defaultValue: 'History not available for this item' }),
        body: t('value.history.none_body', {
          defaultValue: "This item isn't tracked in the value-history feed. Most pets and eggs are covered; newer and cosmetic items often aren't.",
        }),
      },
      error: {
        icon: 'cloud-offline-outline',
        title: t('value.history.error_title', { defaultValue: "Couldn't load history" }),
        body: t('value.history.error_body', { defaultValue: 'Check your connection and try again.' }),
      },
    }[state.status] || {};

    return (
      <View style={styles.stateBox}>
        <Icon name={copy.icon} size={30} color={c.textMuted} />
        <Text style={styles.stateTitle}>{copy.title}</Text>
        <Text style={styles.stateBody}>{copy.body}</Text>
        {state.status === 'error' && (
          <TouchableOpacity style={styles.retryBtn} onPress={fetchHistory} activeOpacity={0.85}>
            <Text style={styles.retryText}>
              {t('value.history.retry', { defaultValue: 'Try again' })}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (!item) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: 24 + insets.bottom }]}>
          <View style={styles.grabber} />

          <View style={styles.headerRow}>
            {!!imageUrl && <Image resizeMethod="resize" source={{ uri: imageUrl }} style={styles.thumb} resizeMode="cover" />}
            <View style={styles.headerText}>
              <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.itemMeta} numberOfLines={1}>
                {t(`categories.${String(item.type || '').toUpperCase()}`, { defaultValue: item.type })}
                {item.rarity ? ` · ${t(`rarities.${String(item.rarity).trim().replace(/[\s_]+/g, '-').toUpperCase()}`, { defaultValue: item.rarity })}` : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Icon name="close" size={20} color={c.closeIcon} />
            </TouchableOpacity>
          </View>

          {availableSeries.length > 1 && (
            <View style={styles.seriesRow}>
              {availableSeries.map((s) => {
                const isActive = s.key === seriesKey;
                return (
                  <TouchableOpacity
                    key={s.key}
                    style={[
                      styles.seriesBtn,
                      isActive && { backgroundColor: s.color, borderColor: s.color },
                    ]}
                    onPress={() => setSeriesKey(s.key)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.seriesText, isActive && styles.seriesTextActive]}>
                      {t(s.labelKey, { defaultValue: s.fallback })}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.chartCard}>{renderBody()}</View>

            {state.status === 'ok' && stats && (
              <>
                <View style={styles.rangeRow}>
                  {RANGES.map((r) => {
                    const on = r.key === rangeKey;
                    return (
                      <TouchableOpacity
                        key={r.key}
                        style={[styles.rangeBtn, on && styles.rangeBtnActive]}
                        onPress={() => setRangeKey(r.key)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                      >
                        <Text style={[styles.rangeText, on && styles.rangeTextActive]}>
                          {r.label || t('history_range.all', { defaultValue: 'All' })}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.statsRow}>
                  <Stat
                    label={rangeKey === 'all' ? t('value.history.stat_high', { defaultValue: 'All-time high' }) : t('history_range.high', { defaultValue: 'High' })}
                    value={formatValue(stats.high)}
                    styles={styles}
                  />
                  <Stat
                    label={rangeKey === 'all' ? t('value.history.stat_low', { defaultValue: 'All-time low' }) : t('history_range.low', { defaultValue: 'Low' })}
                    value={formatValue(stats.low)}
                    styles={styles}
                  />
                  {rangeKey === 'all' || stats.change == null ? (
                    <Stat label={t('value.history.stat_current', { defaultValue: 'Current' })} value={formatValue(stats.current)} styles={styles} />
                  ) : (
                    <Stat
                      label={t('history_range.change', { defaultValue: 'Change' })}
                      value={`${stats.change > 0 ? '+' : ''}${Math.round(stats.change * 10) / 10}%`}
                      valueStyle={stats.change > 0 ? styles.up : stats.change < 0 ? styles.down : null}
                      styles={styles}
                    />
                  )}
                </View>
                <Text style={styles.footnote}>
                  {t('value.history.recorded_prices', { count: stats.count })}
                  {!liveValues ? ` · ${t('value.history.elvebredd_only')}` : ''}
                </Text>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const Stat = ({ label, value, styles, valueStyle }) => (
  <View style={styles.statBox}>
    <Text style={styles.statLabel} numberOfLines={1}>{label}</Text>
    <Text style={[styles.statValue, valueStyle]} numberOfLines={1}>{value}</Text>
  </View>
);

const getStyles = (c) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: c.overlay,
    },
    backdropTap: {
      ...StyleSheet.absoluteFill,
    },
    sheet: {
      backgroundColor: c.bgElevated,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingBottom: 24,
      maxHeight: '86%',
    },
    grabber: {
      alignSelf: 'center',
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.borderAccent,
      marginTop: 8,
      marginBottom: 12,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 12,
    },
    thumb: {
      width: 42,
      height: 42,
      borderRadius: 10,
      backgroundColor: c.bgAlt,
    },
    headerText: {
      flex: 1,
    },
    itemName: {
      fontSize: 17,
      fontWeight: '800',
      color: c.text,
    },
    itemMeta: {
      fontSize: 12,
      color: c.textSecondary,
      marginTop: 2,
      textTransform: 'capitalize',
    },
    closeBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: c.closeBg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    seriesRow: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 12,
    },
    seriesBtn: {
      flex: 1,
      paddingVertical: 7,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bgAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    seriesText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textSecondary,
    },
    seriesTextActive: {
      color: '#fff',
    },
    scroll: {
      flexGrow: 0,
    },
    scrollContent: {
      paddingBottom: 4,
    },
    chartCard: {
      backgroundColor: c.cardBg,
      borderWidth: 1,
      borderColor: c.cardBorder,
      borderRadius: 14,
      padding: 12,
    },
    stateBox: {
      minHeight: 190,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 18,
    },
    stateTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: c.text,
      marginTop: 10,
      textAlign: 'center',
    },
    stateBody: {
      fontSize: 12,
      color: c.textSecondary,
      marginTop: 5,
      textAlign: 'center',
      lineHeight: 17,
    },
    retryBtn: {
      marginTop: 14,
      paddingVertical: 8,
      paddingHorizontal: 18,
      borderRadius: 9,
      backgroundColor: c.bgAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    retryText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.text,
    },
    rangeRow: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 12,
    },
    rangeBtn: {
      flex: 1,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: c.bgAlt,
      alignItems: 'center',
    },
    rangeBtnActive: {
      backgroundColor: c.textSecondary,
    },
    rangeText: {
      fontSize: 12,
      fontWeight: '700',
      color: c.textSecondary,
    },
    rangeTextActive: {
      color: c.bgElevated,
    },
    up: { color: '#16a34a' },
    down: { color: '#dc2626' },
    statsRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 12,
    },
    statBox: {
      flex: 1,
      backgroundColor: c.cardBg,
      borderWidth: 1,
      borderColor: c.cardBorder,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 8,
      alignItems: 'center',
    },
    statLabel: {
      fontSize: 10,
      color: c.textSecondary,
      fontWeight: '600',
    },
    statValue: {
      fontSize: 14,
      fontWeight: '800',
      color: c.text,
      marginTop: 3,
    },
    footnote: {
      fontSize: 10.5,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: 10,
      lineHeight: 15,
    },
  });

export default React.memo(ValueHistoryModal);
