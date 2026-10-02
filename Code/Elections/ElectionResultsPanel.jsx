/**
 * ElectionResultsPanel — Admin Dashboard → Elections: "Results waiting for
 * your decision".
 *
 * A closed race is only counted (supabase/041). For each counted election
 * this panel shows the tally, who met the bar, the sitting team, and a
 * SUGGESTION: the top `seats` qualified candidates, and the holders who are
 * not among them. Nothing changes until the admin taps Appoint or Remove on
 * a row; "No change" / "Keep" only records that they looked. "Finish review"
 * closes the election. The next election is started by an admin from the
 * Elections screen; the panel says when a term has run out.
 *
 * A decision is recorded on the server first (staff_admin_decide). For
 * appoint / remove the panel then writes the RTDB flag at once, the same
 * idempotent write runStaffElections makes within 30 minutes (that function
 * also sends the winner's push). Staff tools stay English.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getDatabase, ref, update } from '@react-native-firebase/database';
import { getThemeColors } from '../Helper/themeColors';
import { setRoleOverride, invalidateFullProfile } from '../Helper/profileCache';
import { adminResults, adminDecide, adminFinish, reviewSuggestion } from '../Helper/staffElections';

const ROLE_LABEL = { mod: 'MOD', jmd: 'JMD' };
const ROLE_COLOR = { mod: '#3B82F6', jmd: '#8B5CF6' };
const FLAG = { mod: 'isModerator', jmd: 'isBabyMod' };
const GREEN = '#10B981';
const RED = '#EF4444';
const AMBER = '#F59E0B';
const ACCENT = '#7C3AED';
const GREY = '#64748B';
const tint = (hex, a = '1F') => `${hex}${a}`;

const REASON = {
  not_counted: 'This election is no longer under review. Pull to refresh.',
  decided: 'That decision was already made and is final for this election.',
  not_qualified: 'This player did not reach the minimum votes, so they cannot be appointed.',
  banned: 'This player is banned right now and cannot be appointed.',
  is_admin: 'Admins are not staff seats.',
  not_holder: 'This player does not hold that role.',
  not_in_election: 'This player is not part of this election.',
};

/**
 * Write the role flag into RTDB right away. runStaffElections repeats the
 * same write within 30 minutes, so a failure here only delays the change.
 */
export const applyRoleNow = async (db, uid, role, kind) => {
  const flag = FLAG[role];
  if (!db || !flag || !uid || (kind !== 'appoint' && kind !== 'remove')) return false;
  const appoint = kind === 'appoint';
  // `null` inside update() deletes the key; the stamp makes a repeat write a
  // real write so a stale Supabase copy of the role gets re-mirrored.
  const patch = { [flag]: appoint ? true : null, rolesUpdatedAt: Date.now() };
  if (appoint && role === 'mod') patch.isBabyMod = null; // a JMD appointed MOD leaves the JMD seat
  try {
    await update(ref(db, `users/${uid}`), patch);
    const flags = { [flag]: appoint };
    if (appoint && role === 'mod') flags.isBabyMod = false;
    setRoleOverride(uid, flags);
    invalidateFullProfile(uid);
    return true;
  } catch (e) {
    return false;
  }
};

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
};

const Avatar = ({ uri, size = 40, color = ACCENT }) => (uri
  ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="person" size={size * 0.5} color="#fff" />
    </View>
  ));

const Pill = ({ color, text, icon }) => (
  <View style={[styles.pill, { backgroundColor: tint(color, '22') }]}>
    {!!icon && <Icon name={icon} size={11} color={color} />}
    <Text style={[styles.pillText, { color }]}>{text}</Text>
  </View>
);

const Btn = ({ label, color, filled, onPress, disabled, busy, c }) => (
  <TouchableOpacity
    onPress={onPress}
    disabled={disabled || busy}
    style={[styles.btn, filled
      ? { backgroundColor: color }
      : { borderWidth: 1.5, borderColor: color || c.border },
    (disabled || busy) && { opacity: 0.45 }]}
  >
    {busy
      ? <ActivityIndicator size="small" color={filled ? '#fff' : color} />
      : <Text style={[styles.btnText, { color: filled ? '#fff' : (color || c.text) }]}>{label}</Text>}
  </TouchableOpacity>
);

export default function ElectionResultsPanel({ isDark, reloadToken, navigation, currentUser }) {
  const c = getThemeColors(isDark);
  const db = useMemo(() => getDatabase(), []);
  const [data, setData] = useState({ elections: [], termAlerts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(null); // `${electionId}:${uid}` or `finish:${electionId}`

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setData(await adminResults());
    } catch (e) {
      console.warn('[ElectionResults] load failed:', e?.message);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadToken]);

  const decide = useCallback(async (el, uid, kind, name) => {
    const key = `${el.id}:${uid}`;
    if (busy) return;
    setBusy(key);
    try {
      const res = await adminDecide(currentUser?.id, el.id, uid, kind);
      if (!res?.ok) {
        Alert.alert('Not saved', REASON[res?.reason] || 'Could not save the decision. Try again.');
      } else if (kind === 'appoint' || kind === 'remove') {
        const wrote = await applyRoleNow(db, uid, el.role, kind);
        if (!wrote) {
          Alert.alert('Saved', `${name} is recorded as ${kind === 'appoint' ? 'appointed' : 'removed'}. The role itself is written by the server within 30 minutes.`);
        }
      }
    } catch (e) {
      Alert.alert('Error', 'Could not reach the server. Try again.');
    } finally {
      setBusy(null);
      load();
    }
  }, [busy, currentUser?.id, db, load]);

  const confirmAppoint = (el, cand) => {
    const name = cand.name || 'this player';
    Alert.alert(
      `Appoint ${name} as ${ROLE_LABEL[el.role]}?`,
      `${cand.votes} votes. Their term runs ${el.termDays} days from now. This is final for this election.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Appoint', onPress: () => decide(el, cand.uid, 'appoint', name) },
      ],
    );
  };
  const confirmRemove = (el, holder) => {
    const name = holder.name || 'this player';
    Alert.alert(
      `Remove ${name} as ${ROLE_LABEL[el.role]}?`,
      'They lose the role now. This is final for this election.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => decide(el, holder.uid, 'remove', name) },
      ],
    );
  };
  const confirmFinish = (el) => {
    Alert.alert(
      'Finish this review?',
      `${el.appointed} appointed, ${el.removed} removed. Undecided candidates stay off the team and undecided holders keep their role. Start the next election from the Elections screen when you are ready.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Finish',
          onPress: async () => {
            if (busy) return;
            setBusy(`finish:${el.id}`);
            try {
              const res = await adminFinish(currentUser?.id, el.id);
              if (!res?.ok) Alert.alert('Not saved', REASON[res?.reason] || 'Could not finish. Try again.');
            } catch (e) {
              Alert.alert('Error', 'Could not reach the server. Try again.');
            } finally {
              setBusy(null);
              load();
            }
          },
        },
      ],
    );
  };

  const renderCandidate = (el, cand) => {
    const key = `${el.id}:${cand.uid}`;
    const chk = cand.check || {};
    const banned = !!chk.banned;
    const decision = cand.decision || null;
    const record = banned
      ? { color: RED, text: 'Banned now', icon: 'close-circle' }
      : chk.cleanRecord === false
        ? { color: AMBER, text: 'Strike/ban in 30 days', icon: 'alert-circle' }
        : { color: GREEN, text: 'Clean record', icon: 'checkmark-circle' };
    return (
      <View key={key} style={[styles.row, { borderTopColor: c.border }, cand.suggested && !decision && { backgroundColor: tint(ACCENT, '0D') }]}>
        <View style={styles.rowTop}>
          <Avatar uri={cand.avatar} color={ROLE_COLOR[el.role]} />
          <View style={{ flex: 1 }}>
            <View style={styles.inline}>
              <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>{cand.name || 'Unknown'}</Text>
              {cand.holder && <Pill color={ROLE_COLOR[el.role]} text={`sitting ${ROLE_LABEL[el.role]}`} />}
            </View>
            <Text style={[styles.meta, { color: c.textSecondary }]}>
              Squad {chk.squad ?? cand.squadAtEntry ?? 0} · {chk.age == null ? 'no birthday on file' : `age ${chk.age}`} · account {cand.accountDays ?? '?'}d
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.votes, { color: c.text }]}>{cand.votes}</Text>
            <Text style={[styles.meta, { color: c.textSecondary }]}>vote{cand.votes === 1 ? '' : 's'}</Text>
          </View>
        </View>
        <View style={styles.pills}>
          {cand.qualified
            ? <Pill color={GREEN} text={`Met the bar (${el.minVotes}+)`} icon="checkmark-circle" />
            : <Pill color={GREY} text={`Below the bar (${el.minVotes})`} />}
          {cand.suggested && <Pill color={ACCENT} text="Suggested" icon="sparkles" />}
          <Pill color={record.color} text={record.text} icon={record.icon} />
        </View>
        {!!cand.pitch && <Text style={[styles.pitch, { color: c.text }]}>“{cand.pitch}”</Text>}
        {decision === 'appoint' ? (
          <View style={styles.actions}><Pill color={GREEN} text="Appointed ✓" /></View>
        ) : decision === 'remove' ? (
          <View style={styles.actions}><Pill color={RED} text="Removed" /></View>
        ) : cand.qualified ? (
          <View style={styles.actions}>
            <Btn label="Appoint" color={GREEN} filled onPress={() => confirmAppoint(el, cand)} disabled={banned} busy={busy === key} c={c} />
            {decision === 'none'
              ? <Pill color={GREY} text="No change" />
              : <Btn label="No change" onPress={() => decide(el, cand.uid, 'none', cand.name)} disabled={!!busy && busy !== key} c={c} />}
          </View>
        ) : null}
      </View>
    );
  };

  const renderHolder = (el, h) => {
    const key = `${el.id}:${h.uid}`;
    const decision = h.decision || null;
    return (
      <View key={key} style={[styles.row, { borderTopColor: c.border }, h.suggestRemove && !decision && { backgroundColor: tint(AMBER, '0D') }]}>
        <View style={styles.rowTop}>
          <Avatar uri={h.avatar} size={34} color={ROLE_COLOR[el.role]} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>{h.name || 'Unknown'}</Text>
            <Text style={[styles.meta, { color: c.textSecondary }]}>
              {h.elected ? `Elected with ${h.votes || 0} vote${h.votes === 1 ? '' : 's'} · until ${fmtDate(h.until)}` : 'Appointed by hand'}
            </Text>
          </View>
        </View>
        <View style={styles.pills}>
          {h.candidate && <Pill color={ROLE_COLOR[el.role]} text="Also ran (see above)" />}
          {h.suggestRemove && <Pill color={AMBER} text="Suggested: remove" icon="sparkles" />}
        </View>
        {decision === 'remove' ? (
          <View style={styles.actions}><Pill color={RED} text="Removed" /></View>
        ) : decision === 'appoint' ? (
          <View style={styles.actions}><Pill color={GREEN} text="Re-appointed ✓" /></View>
        ) : (
          <View style={styles.actions}>
            <Btn label={`Remove ${ROLE_LABEL[el.role]}`} color={RED} onPress={() => confirmRemove(el, h)} busy={busy === key} c={c} />
            {decision === 'none'
              ? <Pill color={GREY} text="Kept" />
              : <Btn label="Keep" onPress={() => decide(el, h.uid, 'none', h.name)} disabled={!!busy && busy !== key} c={c} />}
          </View>
        )}
      </View>
    );
  };

  const renderElection = (el) => {
    const sug = reviewSuggestion(el);
    const cands = el.candidates || [];
    const holders = el.holders || [];
    const finishing = busy === `finish:${el.id}`;
    return (
      <View key={el.id} style={[styles.card, { backgroundColor: c.bgAlt, borderColor: tint(ROLE_COLOR[el.role], '66') }]}>
        <View style={styles.inline}>
          <Text style={[styles.cardTitle, { color: c.text, flex: 1 }]}>{ROLE_LABEL[el.role]} election</Text>
          <Pill color={ACCENT} text="Your decision" />
        </View>
        <Text style={[styles.meta, { color: c.textSecondary, marginTop: 4 }]}>
          Closed {fmtDate(el.closesAt)} · {el.turnout} vote{el.turnout === 1 ? '' : 's'} cast · {el.seats} seat{el.seats === 1 ? '' : 's'} · needs {el.minVotes} votes · {el.termDays}-day term
        </Text>

        {/* Suggestion */}
        <View style={[styles.suggest, { borderColor: tint(ACCENT, '55'), backgroundColor: tint(ACCENT, '12') }]}>
          <Icon name="sparkles" size={16} color={ACCENT} style={{ marginTop: 1 }} />
          <Text style={[styles.suggestText, { color: c.text }]}>{sug.text}</Text>
        </View>

        <Text style={[styles.label, { color: c.textSecondary }]}>
          Candidates · {sug.qualified} of {cands.length} met the bar
        </Text>
        {cands.length === 0
          ? <Text style={[styles.meta, { color: c.textSecondary, marginTop: 6 }]}>Nobody was on the ballot.</Text>
          : cands.map((cand) => renderCandidate(el, cand))}

        <Text style={[styles.label, { color: c.textSecondary, marginTop: 14 }]}>
          Current {ROLE_LABEL[el.role]}s · {holders.length}
        </Text>
        {holders.length === 0
          ? <Text style={[styles.meta, { color: c.textSecondary, marginTop: 6 }]}>Nobody holds this role right now.</Text>
          : holders.map((h) => renderHolder(el, h))}

        <View style={[styles.footer, { borderTopColor: c.border }]}>
          <Text style={[styles.meta, { color: c.textSecondary, flex: 1 }]}>
            {el.appointed} appointed · {el.removed} removed
          </Text>
          <Btn label="Finish review" color={ACCENT} filled onPress={() => confirmFinish(el)} busy={finishing} disabled={!!busy && !finishing} c={c} />
        </View>
      </View>
    );
  };

  const alerts = data.termAlerts || [];
  const elections = data.elections || [];

  return (
    <View style={{ marginTop: 24 }}>
      <View style={styles.inline}>
        <Text style={[styles.section, { color: c.text, flex: 1 }]}>Results waiting for your decision</Text>
        {elections.length > 0 && <Pill color={AMBER} text={`${elections.length} to decide`} />}
        <TouchableOpacity onPress={load} disabled={loading} style={{ padding: 4 }}>
          <Icon name="refresh" size={18} color={c.textMuted} />
        </TouchableOpacity>
      </View>

      {loading && elections.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 16 }} color={ACCENT} />
      ) : error ? (
        <Text style={[styles.meta, { color: RED, marginTop: 8 }]}>Couldn't load the results. Pull to retry.</Text>
      ) : elections.length === 0 ? (
        <Text style={[styles.meta, { color: c.textSecondary, marginTop: 8 }]}>
          Nothing to decide right now. When a race closes it is counted within 30 minutes and lands here. No seat changes until you appoint or remove someone.
        </Text>
      ) : elections.map(renderElection)}

      {alerts.length > 0 && (
        <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: tint(AMBER, '66') }]}>
          <View style={styles.inline}>
            <Icon name="time-outline" size={16} color={AMBER} />
            <Text style={[styles.cardTitle, { color: c.text, flex: 1 }]}>Terms that have run out</Text>
          </View>
          {alerts.map((a) => (
            <Text key={`${a.role}-${a.uid}`} style={[styles.meta, { color: c.text, marginTop: 6 }]}>
              {a.name || a.uid}'s {ROLE_LABEL[a.role]} term ended {fmtDate(a.endedAt)}. No election is running; they keep the role until you decide.
            </Text>
          ))}
          <TouchableOpacity onPress={() => navigation?.navigate?.('Elections')} style={[styles.btn, { backgroundColor: ACCENT, alignSelf: 'flex-start', marginTop: 10 }]}>
            <Text style={[styles.btnText, { color: '#fff' }]}>Start the next election</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: 15, fontWeight: '800' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 10 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  label: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 12 },
  meta: { fontSize: 12, lineHeight: 17 },
  suggest: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  suggestText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 10, paddingHorizontal: 4, marginTop: 6, borderRadius: 8 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  name: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  votes: { fontSize: 18, fontWeight: '900' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '800' },
  pitch: { fontSize: 12, lineHeight: 16, marginTop: 6, fontStyle: 'italic' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  btn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center', justifyContent: 'center', minWidth: 90 },
  btnText: { fontSize: 13, fontWeight: '800' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
