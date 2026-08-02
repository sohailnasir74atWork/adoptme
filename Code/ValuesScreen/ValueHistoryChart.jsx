/**
 * ValueHistoryChart.jsx
 *
 * SVG line chart for one item's value history. Drawn with react-native-svg,
 * which the app already depends on — no charting library added.
 *
 * Drag across the plot to scrub: the nearest point gets a crosshair and the
 * header swaps to that point's date and value.
 */

import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, PanResponder } from 'react-native';
import Svg, {
  Path,
  Line,
  Circle,
  Defs,
  LinearGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { getThemeColors } from '../Helper/themeColors';

const PAD_L = 44;   // room for the y-axis labels
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 22;   // room for the date labels

// Compact axis labels — a 5-digit mega value would otherwise collide with the plot.
const axisLabel = (n) => {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${(v / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  if (abs >= 10) return String(Math.round(v));
  if (abs >= 1) return v.toFixed(1);
  if (abs === 0) return '0';
  return v.toFixed(abs < 0.01 ? 4 : 2);
};

// "2026-04-13" -> "13 Apr 26". Parsed by hand rather than via Date so a
// timezone west of UTC can't roll the label back a day.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => {
  const parts = String(iso || '').split('-');
  if (parts.length !== 3) return String(iso || '');
  const m = MONTHS[Number(parts[1]) - 1] || '';
  return `${Number(parts[2])} ${m} ${parts[0].slice(2)}`;
};

const ValueHistoryChart = ({ points, color, isDarkMode, width, height = 190 }) => {
  const c = getThemeColors(isDarkMode);
  const [scrubIndex, setScrubIndex] = useState(null);

  const geom = useMemo(() => {
    const innerW = Math.max(1, width - PAD_L - PAD_R);
    const innerH = Math.max(1, height - PAD_T - PAD_B);
    const values = points.map((p) => p.value);
    let min = Math.min(...values);
    let max = Math.max(...values);

    // A perfectly flat series has no range to scale against — give it one so the
    // line lands mid-plot instead of dividing by zero.
    if (!(max > min)) {
      const pad = Math.abs(max) * 0.1 || 1;
      min -= pad;
      max += pad;
    } else {
      // Breathing room so the extremes don't sit on the frame.
      const pad = (max - min) * 0.12;
      min -= pad;
      max += pad;
    }

    const n = points.length;
    const xFor = (i) => PAD_L + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yFor = (v) => PAD_T + (1 - (v - min) / (max - min)) * innerH;

    const coords = points.map((p, i) => ({ x: xFor(i), y: yFor(p.value) }));
    const linePath = coords
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(2)},${pt.y.toFixed(2)}`)
      .join(' ');
    const areaPath =
      `${linePath} L${coords[coords.length - 1].x.toFixed(2)},${(PAD_T + innerH).toFixed(2)}` +
      ` L${coords[0].x.toFixed(2)},${(PAD_T + innerH).toFixed(2)} Z`;

    return { innerW, innerH, min, max, coords, linePath, areaPath, baseline: PAD_T + innerH };
  }, [points, width, height]);

  // Depends on geometry rather than reading a ref written during render, so the
  // PanResponder below is rebuilt whenever the plot is resized or re-pointed.
  const count = points.length;
  const updateScrub = useCallback(
    (locationX) => {
      if (count < 2) return;
      const ratio = (locationX - PAD_L) / geom.innerW;
      const clamped = Math.max(0, Math.min(1, ratio));
      setScrubIndex(Math.round(clamped * (count - 1)));
    },
    [geom.innerW, count]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Keep the gesture away from the parent ScrollView while scrubbing.
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => updateScrub(evt.nativeEvent.locationX),
        onPanResponderMove: (evt) => updateScrub(evt.nativeEvent.locationX),
        onPanResponderRelease: () => setScrubIndex(null),
        onPanResponderTerminate: () => setScrubIndex(null),
      }),
    [updateScrub]
  );

  const first = points[0];
  const last = points[points.length - 1];
  // Clamp: a series swap mid-gesture could leave scrubIndex past the new end.
  const activeIdx = scrubIndex == null ? count - 1 : Math.min(scrubIndex, count - 1);
  const active = points[activeIdx];
  const activeCoord = geom.coords[activeIdx];

  const pctChange = useMemo(() => {
    if (!first || !last || !first.value) return null;
    return ((last.value - first.value) / Math.abs(first.value)) * 100;
  }, [first, last]);

  const changeColor = pctChange == null || Math.abs(pctChange) < 0.05
    ? c.textSecondary
    : pctChange > 0 ? '#2ecc71' : '#e74c3c';

  const styles = getStyles(c);

  return (
    <View>
      <View style={styles.header}>
        <View>
          <Text style={styles.activeValue}>
            {axisLabel(active?.value)}
          </Text>
          <Text style={styles.activeDate}>{shortDate(active?.date)}</Text>
        </View>
        {pctChange != null && (
          <View style={[styles.changePill, { backgroundColor: `${changeColor}1A` }]}>
            <Text style={[styles.changeText, { color: changeColor }]}>
              {pctChange > 0 ? '+' : ''}{pctChange.toFixed(1)}%
            </Text>
          </View>
        )}
      </View>

      <View {...panResponder.panHandlers}>
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="vhFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.28" />
              <Stop offset="1" stopColor={color} stopOpacity="0.02" />
            </LinearGradient>
          </Defs>

          {/* horizontal guides + y labels at min / mid / max */}
          {[0, 0.5, 1].map((f) => {
            const y = PAD_T + f * geom.innerH;
            const v = geom.max - f * (geom.max - geom.min);
            return (
              <React.Fragment key={f}>
                <Line
                  x1={PAD_L}
                  y1={y}
                  x2={width - PAD_R}
                  y2={y}
                  stroke={c.border}
                  strokeWidth={StyleSheet.hairlineWidth}
                  opacity={0.6}
                />
                <SvgText x={PAD_L - 6} y={y + 3.5} fontSize="9" fill={c.textMuted} textAnchor="end">
                  {axisLabel(v)}
                </SvgText>
              </React.Fragment>
            );
          })}

          <Path d={geom.areaPath} fill="url(#vhFill)" />
          <Path
            d={geom.linePath}
            stroke={color}
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* crosshair while scrubbing */}
          {scrubIndex != null && activeCoord && (
            <Line
              x1={activeCoord.x}
              y1={PAD_T}
              x2={activeCoord.x}
              y2={geom.baseline}
              stroke={c.textMuted}
              strokeWidth={1}
              strokeDasharray="3,3"
            />
          )}

          {activeCoord && (
            <>
              <Circle cx={activeCoord.x} cy={activeCoord.y} r={5.5} fill={color} opacity={0.25} />
              <Circle cx={activeCoord.x} cy={activeCoord.y} r={3} fill={color} stroke={c.bg} strokeWidth={1.5} />
            </>
          )}

          <SvgText x={PAD_L} y={height - 6} fontSize="9" fill={c.textMuted} textAnchor="start">
            {shortDate(first?.date)}
          </SvgText>
          <SvgText x={width - PAD_R} y={height - 6} fontSize="9" fill={c.textMuted} textAnchor="end">
            {shortDate(last?.date)}
          </SvgText>
        </Svg>
      </View>
    </View>
  );
};

const getStyles = (c) =>
  StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      marginBottom: 2,
    },
    activeValue: {
      fontSize: 26,
      fontWeight: '800',
      color: c.text,
    },
    activeDate: {
      fontSize: 11,
      color: c.textSecondary,
      marginTop: 1,
    },
    changePill: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 8,
    },
    changeText: {
      fontSize: 13,
      fontWeight: '800',
    },
  });

export default React.memo(ValueHistoryChart);
