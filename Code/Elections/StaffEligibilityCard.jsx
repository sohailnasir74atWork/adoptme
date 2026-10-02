/**
 * StaffEligibilityCard — admin-only block on a player's profile drawer.
 *
 * Shows whether the player may apply for MOD / JMD and why not (squad
 * friends, age, record), the seat they hold, and any open application with
 * a jump to Admin Dashboard → Elections to decide it. Reads
 * staff_admin_eligibility (040); the server refuses everyone but admins,
 * so the caller gates on isAdmin only to avoid a wasted call. Staff tools
 * stay English.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { getThemeColors } from '../Helper/themeColors';
import { adminEligibility } from '../Helper/staffElections';

const ROLE_LABEL = { mod: 'MOD', jmd: 'JMD' };
const ROLE_COLOR = { mod: '#3B82F6', jmd: '#8B5CF6' };
const GREEN = '#10B981';
const RED = '#EF4444';
const AMBER = '#F59E0B';
const STATUS_LABEL = { pending: 'waiting for your decision', approved: 'approved, on the ballot', rejected: 'rejected', expired: 'expired' };

/** One blocking reason, in the admin's words. Exported for tests. */
export const reasonLabel = (why, e = {}) => {
  switch (why) {
    case 'squad': return `Squad ${e.squad ?? 0}/${e.minSquad ?? '?'}`;
    case 'age': return `Age ${e.age} (needs ${e.minAge}+)`;
    case 'age_unknown': return 'No birthday on file';
    case 'record': return e.banned ? 'Banned now' : 'Strike or ban in the last 30 days';
    case 'already_mod': return 'Already a MOD';
    default: return String(why || '');
  }
};

/** The line for one role: sitting, eligible, or the reasons. Exported for tests. */
export const roleLine = (d, role) => {
  const e = d?.[role] || {};
  const sitting = !!d?.roles?.[role];
  if (sitting) {
    const until = d?.term?.role === role && d?.term?.until ? ` until ${fmtDate(d.term.until)}` : '';
    return { icon: 'shield-checkmark', color: ROLE_COLOR[role], text: `Sitting ${ROLE_LABEL[role]}${until}` };
  }
  if (e.ok) return { icon: 'checkmark-circle', color: GREEN, text: `Eligible to apply for ${ROLE_LABEL[role]}` };
  const reasons = (e.reasons || []).map((w) => reasonLabel(w, e));
  return { icon: 'close-circle', color: RED, text: reasons.length ? reasons.join(' · ') : 'Not eligible' };
};

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (err) { return ''; }
};

export default function StaffEligibilityCard({ uid, isDarkMode }) {
  const c = getThemeColors(isDarkMode);
  const navigation = useNavigation();
  const [state, setState] = useState({ loading: true, data: null, error: false });

  useEffect(() => {
    let live = true;
    setState({ loading: true, data: null, error: false });
    adminEligibility(uid)
      .then((d) => { if (live) setState({ loading: false, data: d, error: !d }); })
      .catch(() => { if (live) setState({ loading: false, data: null, error: true }); });
    return () => { live = false; };
  }, [uid]);

  const d = state.data;
  const openReview = () => {
    try { navigation.navigate('AdminPanel', { initialTab: 'elections' }); } catch (err) { /* not in a navigator */ }
  };

  return (
    <View style={[styles.card, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={styles.row}>
        <Icon name="ribbon-outline" size={13} color={c.textMuted} />
        <Text style={[styles.label, { color: c.textMuted }]}>Staff eligibility · admin only</Text>
      </View>

      {state.loading ? (
        <ActivityIndicator size="small" color={c.textMuted} style={{ marginTop: 8, alignSelf: 'flex-start' }} />
      ) : state.error || !d ? (
        <Text style={[styles.muted, { color: c.textMuted, marginTop: 6 }]}>Couldn't load. Open the profile again.</Text>
      ) : (
        <>
          <Text style={[styles.muted, { color: c.textSecondary, marginTop: 6 }]}>
            Squad {d.squad ?? 0} · {d.age === null || d.age === undefined ? 'no birthday on file' : `age ${d.age}`} · account {d.accountDays ?? 0} days
          </Text>
          {['mod', 'jmd'].map((role) => {
            const line = roleLine(d, role);
            return (
              <View key={role} style={[styles.row, { marginTop: 6, gap: 6 }]}>
                <View style={[styles.rolePill, { backgroundColor: ROLE_COLOR[role] + '22' }]}>
                  <Text style={[styles.rolePillText, { color: ROLE_COLOR[role] }]}>{ROLE_LABEL[role]}</Text>
                </View>
                <Icon name={line.icon} size={14} color={line.color} />
                <Text style={[styles.line, { color: c.text }]} numberOfLines={2}>{line.text}</Text>
              </View>
            );
          })}
          {d.application && (
            <TouchableOpacity
              onPress={openReview}
              activeOpacity={0.8}
              style={[styles.appRow, { borderColor: AMBER + '66', backgroundColor: AMBER + '14' }]}
            >
              <Icon name="clipboard-outline" size={14} color={AMBER} />
              <Text style={[styles.line, { color: c.text, flex: 1 }]} numberOfLines={2}>
                Applied for {ROLE_LABEL[d.application.role] || d.application.role}: {STATUS_LABEL[d.application.status] || d.application.status}
                {d.application.status === 'pending' ? '. Tap to review.' : ''}
              </Text>
              <Icon name="chevron-forward" size={14} color={c.textSecondary} />
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 8, marginBottom: 2, borderWidth: 1, borderRadius: 12, padding: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  label: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  muted: { fontSize: 12, lineHeight: 16 },
  line: { fontSize: 12, lineHeight: 16, flex: 1, fontWeight: '600' },
  rolePill: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, minWidth: 38, alignItems: 'center' },
  rolePillText: { fontSize: 10, fontWeight: '800' },
  appRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, borderWidth: 1, borderRadius: 10, padding: 8 },
});
