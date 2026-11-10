// Calculator tab = Calculator | Values (2026-11-04, features LOG "Calculator UX
// batch 1"). Values sits one tap from the calculator without a 7th bottom tab:
// the switch replaces the header title, so it costs no screen height.
//
// The calculator stays mounted while Values is shown, so a half-built trade
// survives the trip; Values mounts on demand. Only the visible side renders a
// banner (HomeScreen hideBanner), never two at once.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import HomeScreen from './HomeScreen';
import ValueScreen from '../ValuesScreen/ValueScreen';

export const CALC_VIEW = { CALC: 'calc', VALUES: 'values' };

export const CalcValuesSwitch = ({ value, onChange, isDarkMode, accent }) => {
  const { t } = useTranslation();
  const track = isDarkMode ? '#1f2937' : '#eef0f3';
  const idle = isDarkMode ? '#94a3b8' : '#64748b';
  const options = [
    { key: CALC_VIEW.CALC, label: t('tabs.calculator') },
    { key: CALC_VIEW.VALUES, label: t('tabs.values') },
  ];
  return (
    <View style={[styles.track, { backgroundColor: track }]} accessibilityRole="tablist">
      {options.map((o) => {
        const active = value === o.key;
        return (
          <TouchableOpacity
            key={o.key}
            style={[styles.segment, active && styles.segmentActive, active && (isDarkMode ? styles.segmentActiveDark : styles.segmentActiveLight)]}
            onPress={() => onChange(o.key)}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, { color: active ? accent : idle }]} numberOfLines={1}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const CalculatorTab = ({ view, selectedTheme }) => {
  const showValues = view === CALC_VIEW.VALUES;
  return (
    <View style={styles.flex}>
      <View style={[styles.flex, showValues && styles.hidden]}>
        <HomeScreen selectedTheme={selectedTheme} hideBanner={showValues} />
      </View>
      {showValues && <ValueScreen selectedTheme={selectedTheme} inTab />}
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hidden: { display: 'none' },
  track: { flexDirection: 'row', borderRadius: 18, padding: 3 },
  segment: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 15, minWidth: 92, alignItems: 'center' },
  segmentActive: {
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  segmentActiveLight: { backgroundColor: '#ffffff' },
  segmentActiveDark: { backgroundColor: '#374151' },
  label: { fontSize: 14, fontWeight: '700' },
});

export default CalculatorTab;
