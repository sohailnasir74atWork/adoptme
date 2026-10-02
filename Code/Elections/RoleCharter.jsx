/**
 * RoleCharter — what a MOD and a JMD can and can't do, the bar to apply
 * (squad friends + minimum age), the badges MODs give, and how elections run. Every line here matches a gate the app or the
 * server actually enforces (ProfileAdminActions, utils.js canSanctionTarget,
 * database.rules.json /users, 038_staff_elections.sql).
 */

import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { ROLE_RULES, BADGE_MIN_SQUAD, VOTER_MIN_DAYS } from '../Helper/staffElections';

const ART = {
  mod: require('../../assets/role-badges/mod.png'),
  jmd: require('../../assets/role-badges/jmd.png'),
  trusted: require('../../assets/role-badges/trusted.png'),
  cmsr: require('../../assets/role-badges/cmsr.png'),
  helper: require('../../assets/role-badges/helper.png'),
};
export const ROLE_COLOR = { mod: '#3B82F6', jmd: '#8B5CF6' };
const GREEN = '#10B981';
const RED = '#EF4444';
const AMBER = '#F59E0B';

// How many lines each list has in Translation/*.json (elections.<role>_<list>_<n>).
const LINES = {
  mod: { can: 6, cant: 3, duty: 4 },
  jmd: { can: 2, cant: 3, duty: 3 },
};

const Line = ({ icon, color, text, c }) => (
  <View style={styles.line}>
    <Icon name={icon} size={15} color={color} style={{ marginTop: 1 }} />
    <Text style={[styles.lineText, { color: c.text }]}>{text}</Text>
  </View>
);

const List = ({ role, kind, c, t }) => {
  const meta = {
    can: { icon: 'checkmark-circle', color: GREEN, label: t('elections.can') },
    cant: { icon: 'close-circle', color: RED, label: t('elections.cant') },
    duty: { icon: 'flag', color: AMBER, label: t('elections.duties') },
  }[kind];
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={[styles.listLabel, { color: c.textSecondary }]}>{meta.label}</Text>
      {Array.from({ length: LINES[role][kind] }, (_, i) => (
        <Line key={i} icon={meta.icon} color={meta.color} c={c} text={t(`elections.${role}_${kind}_${i + 1}`)} />
      ))}
    </View>
  );
};

const RoleCard = ({ role, rules, c, t }) => {
  const r = rules?.[role] || ROLE_RULES[role];
  return (
    <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: ROLE_COLOR[role] + '55' }]}>
      <View style={styles.row}>
        <Image source={ART[role]} style={styles.roleArt} resizeMode="contain" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.roleTitle, { color: c.text }]}>{t(`elections.role_${role}`)}</Text>
          <Text style={[styles.roleMeta, { color: ROLE_COLOR[role] }]}>
            {t('elections.role_req', { count: r.minSquad, age: r.minAge ?? ROLE_RULES[role].minAge, days: r.termDays })}
          </Text>
        </View>
      </View>
      <List role={role} kind="can" c={c} t={t} />
      <List role={role} kind="cant" c={c} t={t} />
      <List role={role} kind="duty" c={c} t={t} />
    </View>
  );
};

export default function RoleCharter({ c, rules, limits }) {
  const { t } = useTranslation();
  const r = rules || ROLE_RULES;
  const badgeMin = limits?.badgeMinSquad ?? BADGE_MIN_SQUAD;
  const voterDays = limits?.voterMinDays ?? VOTER_MIN_DAYS;
  return (
    <View>
      <RoleCard role="mod" rules={r} c={c} t={t} />
      <RoleCard role="jmd" rules={r} c={c} t={t} />

      <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
        <Text style={[styles.roleTitle, { color: c.text }]}>{t('elections.badges_title')}</Text>
        <Text style={[styles.muted, { color: c.textSecondary, marginTop: 4 }]}>
          {t('elections.badges_req', { count: badgeMin })}
        </Text>
        {['trusted', 'cmsr', 'helper'].map((b) => (
          <View key={b} style={[styles.row, { marginTop: 10, gap: 10 }]}>
            <Image source={ART[b]} style={styles.badgeArt} resizeMode="contain" />
            <View style={{ flex: 1 }}>
              <Text style={[styles.badgeName, { color: c.text }]}>{t(`badges.roles.${b}`)}</Text>
              <Text style={[styles.muted, { color: c.textSecondary }]}>{t(`elections.badge_${b}`)}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
        <Text style={[styles.roleTitle, { color: c.text }]}>{t('elections.how_title')}</Text>
        {[
          t('elections.how_1', { count: Math.round(r.mod.nominateHours / 24) }),
          t('elections.how_2', { count: Math.round(r.mod.voteHours / 24), days: voterDays }),
          t('elections.how_3'),
          t('elections.how_4'),
        ].map((line, i) => (
          <View key={i} style={[styles.row, { alignItems: 'flex-start', marginTop: 10, gap: 10 }]}>
            <View style={styles.stepDot}><Text style={styles.stepDotText}>{i + 1}</Text></View>
            <Text style={[styles.lineText, { color: c.text }]}>{line}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  roleArt: { width: 40, height: 40, marginRight: 10 },
  roleTitle: { fontSize: 16, fontWeight: '800' },
  roleMeta: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  listLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  lineText: { flex: 1, fontSize: 13, lineHeight: 18 },
  muted: { fontSize: 13, lineHeight: 18 },
  badgeArt: { width: 30, height: 30 },
  badgeName: { fontSize: 14, fontWeight: '800' },
  stepDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center' },
  stepDotText: { color: '#fff', fontWeight: '900', fontSize: 12 },
});
