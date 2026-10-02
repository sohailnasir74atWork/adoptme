/**
 * ElectionsScreen — players elect the MODs and Junior Mods (JMD).
 *
 * Per role: the live race (nominations -> voting -> counting) or the last
 * result, the sitting team, and the roles charter. Admins can start or
 * cancel a race and remove a candidate (long-press).
 *
 * All rules live on the server (supabase/038_staff_elections.sql); this
 * screen shows them and reports the server's reason when an action fails.
 * Reads: staff_elections_get (cached 2 min).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Image, TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import SquadBadge from '../Squad/SquadBadge';
import RoleCharter, { ROLE_COLOR } from './RoleCharter';
import {
  ROLES, ROLE_RULES, PITCH_MAX, phaseOf, phaseEndsAt, splitDuration, eligibility,
  getElections, runForRole, withdraw, castVote, adminOpen, adminCancel, adminDisqualify,
} from '../Helper/staffElections';

const ACCENT = '#7C3AED';
const GREEN = '#10B981';
const GOLD = '#F59E0B';
const KNOWN_ERRORS = [
  'not_nominations', 'not_voting', 'squad', 'record', 'already_mod', 'other_race', 'removed',
  'self', 'no_candidate', 'too_new', 'banned', 'device_used', 'device',
];
const PHASE_COLOR = { upcoming: '#64748B', nominations: GOLD, voting: GREEN, counting: '#0EA5E9', finalized: ACCENT };

const Avatar = ({ uri, size = 36, color = ACCENT }) => (uri
  ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="person" size={size * 0.5} color="#fff" />
    </View>
  ));

const Card = ({ c, children, style }) => (
  <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }, style]}>{children}</View>
);

const Pill = ({ color, text }) => (
  <View style={[styles.pill, { backgroundColor: color + '22' }]}>
    <Text style={[styles.pillText, { color }]}>{text}</Text>
  </View>
);

export default function ElectionsScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, theme, isAdmin, electionsEnabled } = useGlobalState();
  const c = getThemeColors(theme === 'dark');
  const uid = user?.id || null;
  // Behind the backend switch (RTDB /elections_enabled). Players see "Coming
  // soon" until it's on; admins see everything so they can set a race up first.
  const comingSoon = !electionsEnabled && !isAdmin;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(null); // key of the action in flight
  const [now, setNow] = useState(Date.now());
  const [runFor, setRunFor] = useState(null); // election the pitch sheet is open for
  const [pitch, setPitch] = useState('');
  const [seats, setSeats] = useState({ mod: ROLE_RULES.mod.seats, jmd: ROLE_RULES.jmd.seats });
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!uid || comingSoon) { setLoading(false); return; }
    setLoadError(false);
    try {
      const d = await getElections(uid, { force });
      if (mounted.current) setData(d);
    } catch (e) {
      console.warn('[Elections] load failed:', e?.message);
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [uid, comingSoon]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load({ force: true }); }, [load]);

  // Countdowns tick; crossing a phase boundary refetches (the server moved on).
  const phasesRef = useRef('');
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const sig = (data?.elections || []).map((e) => `${e.id}:${phaseOf(e, now)}`).join(',');
    if (phasesRef.current && sig !== phasesRef.current) load({ force: true });
    phasesRef.current = sig;
  }, [now, data, load]);

  const elig = useMemo(() => eligibility(data), [data]);
  const me = data?.me || {};

  const fmtDate = useCallback((iso) => {
    try { return new Date(iso).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
  }, [i18n.language]);
  const fmtLeft = useCallback((endMs) => {
    const { d, h, m } = splitDuration(endMs - now);
    if (d > 0) return t('elections.time_dh', { d, h });
    if (h > 0) return t('elections.time_hm', { h, m });
    return t('elections.time_m', { m: Math.max(1, m) });
  }, [now, t]);

  const fail = useCallback((res) => {
    const reason = KNOWN_ERRORS.includes(res?.reason) ? res.reason : 'generic';
    showErrorMessage(t('home.alert.error'), t(`elections.err_${reason}`, { count: res?.need ?? res?.days ?? 0 }));
  }, [t]);

  const act = useCallback(async (key, fn, okMsg) => {
    if (busy) return;
    setBusy(key);
    try {
      const res = await fn();
      if (res?.ok) {
        if (okMsg) showSuccessMessage(okMsg);
      } else {
        fail(res);
      }
    } catch (e) {
      fail(null);
    } finally {
      if (mounted.current) setBusy(null);
      load({ force: true });
    }
  }, [busy, fail, load]);

  // ── actions ──
  const openRun = (e) => {
    const mine = (e.candidates || []).find((x) => x.uid === uid);
    setPitch(mine?.pitch || '');
    setRunFor(e);
  };
  const submitRun = () => {
    const e = runFor;
    setRunFor(null);
    act(`run_${e.id}`, () => runForRole(uid, e.id, pitch.trim()), e.running ? t('elections.pitch_saved') : t('elections.run_ok'));
  };
  const confirmWithdraw = (e) => Alert.alert(t('elections.withdraw_confirm_title'), t('elections.withdraw_confirm_body'), [
    { text: t('home.cancel'), style: 'cancel' },
    { text: t('elections.withdraw'), style: 'destructive', onPress: () => act(`withdraw_${e.id}`, () => withdraw(uid, e.id)) },
  ]);
  const vote = (e, cand) => {
    if (e.myVote === cand.uid) return;
    act(`vote_${cand.uid}`, () => castVote(uid, e.id, cand.uid), t('elections.vote_ok'));
  };
  const confirmStart = (role) => {
    Alert.alert(t(`elections.admin_start_${role}`), t(`elections.admin_start_confirm_${role}`), [
      { text: t('home.cancel'), style: 'cancel' },
      { text: t('elections.admin_start_ok'), onPress: () => act(`start_${role}`, () => adminOpen(uid, role, seats[role])) },
    ]);
  };
  const confirmCancel = (e) => Alert.alert(t('elections.admin_cancel'), t('elections.admin_cancel_confirm'), [
    { text: t('home.cancel'), style: 'cancel' },
    { text: t('elections.admin_cancel'), style: 'destructive', onPress: () => act(`cancel_${e.id}`, () => adminCancel(uid, e.id)) },
  ]);
  const confirmDisqualify = (e, cand) => {
    if (!me.isAdmin || e.phase === 'finalized') return;
    Alert.alert(t('elections.admin_disqualify', { name: cand.name || t('chat.anonymous') }), undefined, [
      { text: t('home.cancel'), style: 'cancel' },
      { text: t('elections.admin_remove'), style: 'destructive', onPress: () => act(`dq_${cand.uid}`, () => adminDisqualify(uid, e.id, cand.uid)) },
    ]);
  };

  // ── pieces ──
  const runBlockReason = (e) => {
    if (me.raceId && me.raceId !== e.id) return t('elections.err_other_race');
    if (e.role === 'jmd' && me.isMod) return t('elections.err_already_mod');
    if (me.cleanRecord === false) return t('elections.err_record');
    if (elig[e.role]?.need > 0) return t(`elections.need_more_${e.role}`, { count: elig[e.role].need });
    return null;
  };

  // Render functions, not components: the 30 s countdown tick would remount
  // components declared inside this one.
  const renderCandidate = (e, cand, phase) => {
    const isMine = cand.uid === uid;
    const myPick = e.myVote === cand.uid;
    return (
      <TouchableOpacity
        key={cand.uid}
        activeOpacity={me.isAdmin ? 0.7 : 1}
        onLongPress={() => confirmDisqualify(e, cand)}
        style={[styles.candRow, { borderTopColor: c.border }, myPick && { backgroundColor: GREEN + '12' }]}
      >
        <Avatar uri={cand.avatar} size={40} color={ROLE_COLOR[e.role]} />
        <View style={{ flex: 1 }}>
          <View style={[styles.row, { gap: 6 }]}>
            <Text style={[styles.candName, { color: c.text }]} numberOfLines={1}>
              {cand.name || t('chat.anonymous')}{isMine ? ` (${t('squad.you')})` : ''}
            </Text>
            <SquadBadge count={cand.squad} size={16} />
            <Text style={[styles.candSquad, { color: c.textSecondary }]}>{cand.squad}</Text>
          </View>
          {!!cand.pitch && (
            <Text style={[styles.pitch, { color: c.textSecondary }]} numberOfLines={3}>“{cand.pitch}”</Text>
          )}
        </View>
        {phase === 'voting' && !isMine && (
          <TouchableOpacity
            onPress={() => vote(e, cand)}
            disabled={!elig.vote.ok || !!busy}
            style={[styles.voteBtn, myPick
              ? { backgroundColor: GREEN }
              : { backgroundColor: 'transparent', borderColor: GREEN, borderWidth: 1.5 },
            (!elig.vote.ok || (busy && !myPick)) && { opacity: 0.45 }]}
          >
            {busy === `vote_${cand.uid}`
              ? <ActivityIndicator size="small" color={myPick ? '#fff' : GREEN} />
              : (
                <Text style={[styles.voteText, { color: myPick ? '#fff' : GREEN }]}>
                  {myPick ? `✓ ${t('elections.voted')}` : t('elections.vote')}
                </Text>
              )}
          </TouchableOpacity>
        )}
        {phase === 'finalized' && (
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[styles.votes, { color: c.text }]}>{t('elections.votes_count', { count: cand.votes || 0 })}</Text>
            {cand.won && <Pill color={GREEN} text={t('elections.elected')} />}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderElection = (e) => {
    const phase = phaseOf(e, now);
    const endsAt = phaseEndsAt(e, now);
    const cands = e.candidates || [];
    const blocked = runBlockReason(e);
    return (
      <Card key={e.id} c={c} style={{ borderColor: ROLE_COLOR[e.role] + '66' }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={[styles.cardTitle, { color: c.text }]}>{t(`elections.race_${e.role}`)}</Text>
          <Pill color={PHASE_COLOR[phase] || ACCENT} text={t(`elections.phase_${phase}`)} />
        </View>

        {phase === 'finalized' ? (
          <Text style={[styles.muted, { color: c.textSecondary, marginTop: 4 }]}>
            {t('elections.closed_on', { date: fmtDate(e.closesAt) })}
          </Text>
        ) : (
          <View style={[styles.row, { gap: 6, marginTop: 6 }]}>
            <Icon name="time-outline" size={14} color={c.textSecondary} />
            <Text style={[styles.muted, { color: c.text, fontWeight: '700' }]}>
              {phase === 'upcoming' && t('elections.opens_in', { time: fmtLeft(endsAt) })}
              {phase === 'nominations' && t('elections.nominations_end', { time: fmtLeft(endsAt) })}
              {phase === 'voting' && t('elections.voting_end', { time: fmtLeft(endsAt) })}
              {phase === 'counting' && t('elections.counting_body')}
            </Text>
          </View>
        )}
        <Text style={[styles.muted, { color: c.textSecondary, marginTop: 4 }]}>
          {t('elections.seats_term', { count: e.seats, days: e.termDays })}
          {' · '}
          {t('elections.min_votes', { count: e.minVotes })}
        </Text>

        {/* Running / run button */}
        {(phase === 'nominations' || phase === 'voting') && e.running && (
          <View style={[styles.runningBox, { borderColor: GREEN + '55' }]}>
            <Text style={[styles.runningText, { color: GREEN }]}>✓ {t('elections.running_badge')}</Text>
            <View style={[styles.row, { gap: 8 }]}>
              {phase === 'nominations' && (
                <TouchableOpacity style={[styles.smallBtn, { borderColor: c.border }]} onPress={() => openRun(e)}>
                  <Text style={[styles.smallBtnText, { color: c.text }]}>{t('elections.edit_pitch')}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[styles.smallBtn, { borderColor: '#EF444466' }]} onPress={() => confirmWithdraw(e)} disabled={!!busy}>
                <Text style={[styles.smallBtnText, { color: '#EF4444' }]}>{t('elections.withdraw')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {phase === 'nominations' && !e.running && (
          <View style={{ marginTop: 12 }}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: ROLE_COLOR[e.role] }, blocked && { opacity: 0.45 }]}
              onPress={() => openRun(e)}
              disabled={!!blocked || !!busy}
            >
              {busy === `run_${e.id}`
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.primaryText}>{t(`elections.run_button_${e.role}`)}</Text>}
            </TouchableOpacity>
            <Text style={[styles.muted, { color: blocked ? GOLD : c.textSecondary, marginTop: 6 }]}>
              {blocked || t('elections.req_run', { count: e.minSquad })}
            </Text>
          </View>
        )}

        {phase === 'voting' && (
          <Text style={[styles.muted, { color: elig.vote.ok ? c.textSecondary : GOLD, marginTop: 10 }]}>
            {elig.vote.ok
              ? t('elections.vote_hint')
              : me.banned ? t('elections.err_banned') : t('elections.err_too_new', { count: data?.limits?.voterMinDays ?? 7 })}
          </Text>
        )}

        {/* Candidates */}
        <Text style={[styles.cardLabel, { color: c.textSecondary, marginTop: 14 }]}>
          {t('elections.candidates_title', { count: cands.length })}
          {phase === 'voting' || phase === 'counting' ? `  ·  ${t('elections.turnout', { count: e.turnout || 0 })}` : ''}
        </Text>
        {cands.length === 0 ? (
          <Text style={[styles.muted, { color: c.textSecondary, marginTop: 6 }]}>
            {phase === 'finalized' ? '' : t('elections.candidates_empty')}
          </Text>
        ) : cands.map((cand) => renderCandidate(e, cand, phase))}

        {phase === 'finalized' && !(cands.some((x) => x.won)) && (
          <Text style={[styles.muted, { color: GOLD, marginTop: 8 }]}>{t('elections.no_winner', { count: e.minVotes })}</Text>
        )}

        {/* Admin */}
        {me.isAdmin && phase !== 'finalized' && (
          <View style={[styles.adminBox, { borderTopColor: c.border }]}>
            <Text style={[styles.muted, { color: c.textSecondary, flex: 1 }]}>{t('elections.admin_disqualify_hint')}</Text>
            <TouchableOpacity style={[styles.smallBtn, { borderColor: '#EF444466' }]} onPress={() => confirmCancel(e)} disabled={!!busy}>
              <Text style={[styles.smallBtnText, { color: '#EF4444' }]}>{t('elections.admin_cancel')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </Card>
    );
  };

  const renderNoRace = (role) => (
    <Card key={`none-${role}`} c={c} style={{ borderColor: ROLE_COLOR[role] + '66' }}>
      <Text style={[styles.cardTitle, { color: c.text }]}>{t(`elections.race_${role}`)}</Text>
      <Text style={[styles.muted, { color: c.textSecondary, marginTop: 4 }]}>{t('elections.none_running')}</Text>
      {me.isAdmin && (
        <View style={[styles.adminBox, { borderTopColor: c.border }]}>
          <Text style={[styles.muted, { color: c.textSecondary }]}>{t('elections.admin_seats')}</Text>
          <View style={[styles.row, { gap: 8, flex: 1 }]}>
            <TouchableOpacity onPress={() => setSeats((s) => ({ ...s, [role]: Math.max(1, s[role] - 1) }))} style={[styles.stepBtn, { borderColor: c.border }]}>
              <Icon name="remove" size={16} color={c.text} />
            </TouchableOpacity>
            <Text style={[styles.cardTitle, { color: c.text, minWidth: 22, textAlign: 'center' }]}>{seats[role]}</Text>
            <TouchableOpacity onPress={() => setSeats((s) => ({ ...s, [role]: Math.min(20, s[role] + 1) }))} style={[styles.stepBtn, { borderColor: c.border }]}>
              <Icon name="add" size={16} color={c.text} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: ROLE_COLOR[role], paddingVertical: 8 }]} onPress={() => confirmStart(role)} disabled={!!busy}>
            {busy === `start_${role}`
              ? <ActivityIndicator color="#fff" />
              : <Text style={[styles.primaryText, { fontSize: 13 }]}>{t(`elections.admin_start_${role}`)}</Text>}
          </TouchableOpacity>
        </View>
      )}
    </Card>
  );

  const elections = data?.elections || [];
  const team = data?.team || [];

  return (
    <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="arrow-back" size={22} color={c.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: c.text }]}>{t('elections.title')}</Text>
          <Text style={[styles.headerSub, { color: c.textSecondary }]} numberOfLines={1}>{t('elections.subtitle')}</Text>
        </View>
      </View>

      {comingSoon ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 44 }}>🗳️</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('elections.coming_soon_title')}</Text>
          <Text style={[styles.muted, { color: c.textSecondary, textAlign: 'center' }]}>{t('elections.coming_soon_body')}</Text>
          <TouchableOpacity style={[styles.primaryBtn, { marginTop: 8 }]} onPress={() => navigation.navigate('Squad')}>
            <Icon name="people" size={15} color="#fff" />
            <Text style={styles.primaryText}>{t('elections.grow_squad')}</Text>
          </TouchableOpacity>
        </View>
      ) : !uid ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>🔒</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('elections.sign_in')}</Text>
        </View>
      ) : loading && !data ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={ACCENT} />
      ) : !data ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>⚠️</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{loadError ? t('elections.error_load') : ''}</Text>
          <TouchableOpacity style={[styles.primaryBtn, { marginTop: 8 }]} onPress={() => { setLoading(true); load({ force: true }); }}>
            <Text style={styles.primaryText}>{t('elections.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
        >
          {!electionsEnabled && (
            <View style={[styles.hiddenNote, { borderColor: GOLD + '66', backgroundColor: GOLD + '14' }]}>
              <Icon name="eye-off-outline" size={16} color={GOLD} />
              <Text style={[styles.muted, { color: c.text, flex: 1 }]}>{t('elections.admin_hidden')}</Text>
            </View>
          )}

          {/* Me: can I run, can I vote */}
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>🗳️ {t('elections.hero_kicker')}</Text>
            <View style={[styles.row, { gap: 8, marginTop: 8 }]}>
              <SquadBadge count={me.squad || 0} rankKey={me.squad ? undefined : 'squad'} size={34} />
              <Text style={styles.heroSquad}>{t('elections.my_squad', { count: me.squad || 0 })}</Text>
            </View>
            {ROLES.map((role) => (
              <View key={role} style={[styles.row, { gap: 6, marginTop: 6 }]}>
                <Icon name={elig[role].ok ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={elig[role].ok ? '#A7F3D0' : 'rgba(255,255,255,0.7)'} />
                <Text style={styles.heroLine}>
                  {elig[role].ok
                    ? t(`elections.can_run_${role}`)
                    : elig[role].need > 0
                      ? t(`elections.need_more_${role}`, { count: elig[role].need })
                      : role === 'jmd' && me.isMod ? t('elections.err_already_mod') : t('elections.err_record')}
                </Text>
              </View>
            ))}
            <View style={[styles.row, { gap: 6, marginTop: 6 }]}>
              <Icon name={elig.vote.ok ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={elig.vote.ok ? '#A7F3D0' : 'rgba(255,255,255,0.7)'} />
              <Text style={styles.heroLine}>
                {elig.vote.ok ? t('elections.can_vote')
                  : me.banned ? t('elections.err_banned') : t('elections.vote_in_days', { count: elig.vote.daysLeft })}
              </Text>
            </View>
            {(elig.mod.need > 0 || elig.jmd.need > 0) && (
              <TouchableOpacity style={styles.heroBtn} onPress={() => navigation.navigate('Squad')} activeOpacity={0.85}>
                <Icon name="people" size={15} color={ACCENT} />
                <Text style={styles.heroBtnText}>{t('elections.grow_squad')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Races */}
          {ROLES.map((role) => {
            const open = elections.find((e) => e.role === role && e.phase !== 'finalized' && e.phase !== 'cancelled');
            const last = elections.find((e) => e.role === role && e.phase === 'finalized');
            return (
              <View key={role}>
                {open ? renderElection(open) : renderNoRace(role)}
                {last && renderElection(last)}
              </View>
            );
          })}

          {/* Sitting team */}
          <Card c={c}>
            <Text style={[styles.cardTitle, { color: c.text }]}>{t('elections.team_title')}</Text>
            {team.length === 0 ? (
              <Text style={[styles.muted, { color: c.textSecondary, marginTop: 6 }]}>{t('elections.team_empty')}</Text>
            ) : team.map((m) => (
              <View key={`${m.role}-${m.uid}`} style={[styles.row, styles.teamRow, { borderTopColor: c.border }]}>
                <Avatar uri={m.avatar} size={34} color={ROLE_COLOR[m.role]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.candName, { color: c.text }]} numberOfLines={1}>{m.name || t('chat.anonymous')}</Text>
                  <Text style={[styles.small, { color: c.textSecondary }]}>
                    {m.elected
                      ? t('elections.team_elected_until', { date: fmtDate(m.until), count: m.votes || 0 })
                      : t('elections.team_appointed')}
                  </Text>
                </View>
                <Pill color={ROLE_COLOR[m.role]} text={t(`elections.role_${m.role}_short`)} />
              </View>
            ))}
          </Card>

          {/* What each role can do */}
          <Text style={[styles.sectionTitle, { color: c.text }]}>{t('elections.rules_title')}</Text>
          <RoleCharter c={c} rules={data?.rules} limits={data?.limits} />
        </ScrollView>
      )}

      {/* Pitch sheet */}
      <Modal visible={!!runFor} transparent animationType="slide" onRequestClose={() => setRunFor(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetWrap}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setRunFor(null)} />
          <View style={[styles.sheet, { backgroundColor: c.bgAlt, paddingBottom: insets.bottom + 16 }]}>
            <Text style={[styles.cardTitle, { color: c.text }]}>
              {runFor ? t(`elections.run_title_${runFor.role}`) : ''}
            </Text>
            <Text style={[styles.muted, { color: c.textSecondary, marginTop: 4 }]}>{t('elections.pitch_label')}</Text>
            <TextInput
              value={pitch}
              onChangeText={(v) => setPitch(v.slice(0, PITCH_MAX))}
              placeholder={t('elections.pitch_placeholder')}
              placeholderTextColor={c.placeholder}
              multiline
              maxLength={PITCH_MAX}
              style={[styles.pitchInput, { color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
            />
            <Text style={[styles.small, { color: c.textMuted, alignSelf: 'flex-end' }]}>{pitch.length}/{PITCH_MAX}</Text>
            {runFor && !runFor.running && (
              <Text style={[styles.muted, { color: c.textSecondary, marginTop: 6 }]}>{t('elections.run_promise')}</Text>
            )}
            <TouchableOpacity
              style={[styles.primaryBtn, { marginTop: 12, backgroundColor: runFor ? ROLE_COLOR[runFor.role] : ACCENT }]}
              onPress={submitRun}
            >
              <Text style={styles.primaryText}>{runFor?.running ? t('elections.save_pitch') : t('elections.run_submit')}</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 18, fontWeight: '800' },
  headerSub: { fontSize: 12, marginTop: 1 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center' },
  hero: { backgroundColor: ACCENT, borderRadius: 18, padding: 16 },
  hiddenNote: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 12 },
  heroKicker: { color: '#FDE68A', fontSize: 13, fontWeight: '900', letterSpacing: 0.3 },
  heroSquad: { color: '#fff', fontSize: 20, fontWeight: '900', flex: 1 },
  heroLine: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
  heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 12, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  heroBtnText: { color: ACCENT, fontWeight: '800', fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  cardLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionTitle: { fontSize: 17, fontWeight: '900', marginTop: 24 },
  muted: { fontSize: 13, lineHeight: 18 },
  small: { fontSize: 12, lineHeight: 16 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '800' },
  primaryBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  smallBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  smallBtnText: { fontSize: 12, fontWeight: '700' },
  stepBtn: { borderWidth: 1, borderRadius: 8, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  runningBox: { marginTop: 12, borderWidth: 1, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  runningText: { fontWeight: '800', fontSize: 13, flex: 1 },
  candRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8, borderRadius: 8 },
  candName: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  candSquad: { fontSize: 12, fontWeight: '800' },
  pitch: { fontSize: 12, lineHeight: 16, marginTop: 3, fontStyle: 'italic' },
  voteBtn: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7, minWidth: 74, alignItems: 'center' },
  voteText: { fontWeight: '800', fontSize: 12 },
  votes: { fontSize: 13, fontWeight: '900' },
  teamRow: { gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10 },
  adminBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap' },
  sheetWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18 },
  pitchInput: { borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 90, marginTop: 10, fontSize: 14, textAlignVertical: 'top' },
});
