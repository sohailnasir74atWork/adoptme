/**
 * SquadScreen — invite friends, grow your squad, earn Pro.
 *
 * All rules live on the server (supabase/034_squad.sql). This screen shows
 * the caller's code, counts, rank, rewards and members, lets a NEW player
 * enter a friend's code, and shows this week's top recruiters.
 * Reads: get_my_squad (cached 5 min) + squad_leaderboard (cached 30 min).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Image, TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput, Share as RNShare, Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import SquadBadge from './SquadBadge';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import {
  STEPS, RANKS, FRIEND_PRO_DAYS, rankFor, nextRank, nextStep, inviteLinks,
  getMySquad, getSquadLeaderboard, joinSquad, squadPing, activatePass, isSquadProActive,
} from '../Helper/squad';
import { ROLE_RULES, BADGE_MIN_SQUAD } from '../Helper/staffElections';

const ACCENT = '#7C3AED';
// A friend counts on any later UTC day (034 squad_ping), so "counts tomorrow"
// is only true on the day they joined; after that they simply haven't come back.
const joinedTodayUtc = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) && Math.floor(t / 86400000) === Math.floor(Date.now() / 86400000);
};
const GREEN = '#10B981';
const GOLD = '#F59E0B';

const Avatar = ({ uri, size = 36 }) => (uri
  ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="person" size={size * 0.5} color="#fff" />
    </View>
  ));

// Defined outside the screen: a component created during render would
// remount its children (the code TextInput would lose focus every keystroke).
const Card = ({ c, children, style }) => (
  <View style={[styles.card, { backgroundColor: c.bgAlt, borderColor: c.border }, style]}>{children}</View>
);

export default function SquadScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, theme, electionsEnabled } = useGlobalState();
  const { localState } = useLocalState();
  const isDark = theme === 'dark';
  const c = getThemeColors(isDark);
  const uid = user?.id || null;

  const [squad, setSquad] = useState(null);
  const [board, setBoard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [joining, setJoining] = useState(false);
  const [activatingId, setActivatingId] = useState(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!uid) { setLoading(false); return; }
    setLoadError(false);
    try {
      if (force) await squadPing(uid, { force: true });
      const [s, b] = await Promise.all([
        getMySquad(uid, { force }),
        getSquadLeaderboard({ force }).catch(() => []),
      ]);
      if (!mounted.current) return;
      setSquad(s);
      setBoard(b);
    } catch (e) {
      console.warn('[Squad] load failed:', e?.message);
      if (mounted.current) setLoadError(true);
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (uid) trackGrowthEvent('squad_screen_open', {}); }, [uid]);
  const onRefresh = useCallback(() => { setRefreshing(true); load({ force: true }); }, [load]);

  const direct = squad?.direct || 0;
  const rank = rankFor(direct);
  const next = nextStep(direct);
  const nextR = nextRank(direct);
  const proUntilMs = squad?.proUntil ? Date.parse(squad.proUntil) : 0;
  const proActive = proUntilMs > Date.now();
  const progress = useMemo(() => {
    if (!next) return 1;
    const prev = [...STEPS].reverse().find((s) => s.n <= direct)?.n || 0;
    return Math.max(0.04, (direct - prev) / (next.n - prev));
  }, [next, direct]);

  const shareInvite = useCallback(async () => {
    if (!squad?.code) return;
    const links = inviteLinks(squad.code);
    trackGrowthEvent('squad_invite_tap', { direct: squad.direct || 0 });
    try {
      const result = await RNShare.share({
        message: t('squad.share_message', {
          code: squad.code,
          android: links.android,
          ios: links.ios,
        }),
      });
      // iOS reports a dismissed sheet; Android always says "shared".
      if (result?.action === RNShare.sharedAction) trackGrowthEvent('squad_invite_shared', {});
    } catch (e) { /* user closed the sheet */ }
  }, [squad?.code, squad?.direct, t]);

  const copyCode = useCallback(() => {
    if (!squad?.code) return;
    Clipboard.setString(squad.code);
    trackGrowthEvent('squad_code_copied', {});
    showSuccessMessage(t('squad.copied'), squad.code);
  }, [squad?.code, t]);

  const submitCode = useCallback(async () => {
    if (joining) return;
    setJoining(true);
    try {
      const res = await joinSquad(uid, codeInput);
      if (res.ok) {
        showSuccessMessage(t('squad.joined_toast_title'), t('squad.joined_toast_body', { name: res.inviterName || t('chat.anonymous'), pro: t('squad.pass_name', { count: FRIEND_PRO_DAYS }) }));
        setCodeInput('');
        load({ force: true });
      } else {
        const known = ['bad_code', 'own_code', 'not_new', 'device_used', 'already_joined', 'loop', 'device'];
        showErrorMessage(t('home.alert.error'), t(`squad.join_error_${known.includes(res.reason) ? res.reason : 'generic'}`));
      }
    } catch (e) {
      showErrorMessage(t('home.alert.error'), t('squad.join_error_generic'));
    } finally {
      if (mounted.current) setJoining(false);
    }
  }, [joining, uid, codeInput, t, load]);

  const fmtDate = (ms) => {
    try { return new Date(ms).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }); } catch (e) { return ''; }
  };
  const fmtDateRef = useRef(fmtDate);
  fmtDateRef.current = fmtDate;

  // Start a pass. The server adds its days to the end of any Squad Pro
  // already running; a paid subscriber is told the two would overlap.
  const startPass = useCallback(async (p) => {
    try {
      const res = await activatePass(uid, p.id);
      if (res.ok) {
        showSuccessMessage(t('squad.pass_activated_title'), t('squad.pass_activated_body', { date: fmtDateRef.current(Date.parse(res.proUntil)) }));
      } else {
        const known = ['used', 'expired'];
        showErrorMessage(t('home.alert.error'), t(`squad.pass_error_${known.includes(res.reason) ? res.reason : 'generic'}`));
      }
    } catch (e) {
      showErrorMessage(t('home.alert.error'), t('squad.pass_error_generic'));
    } finally {
      if (mounted.current) setActivatingId(null);
      load({ force: true });
    }
  }, [uid, t, load]);

  const confirmPass = useCallback((p) => {
    if (activatingId) return;
    const squadPro = isSquadProActive(uid);
    const paidPro = !!localState?.isPro && !squadPro;
    const base = Math.max(Date.now(), squadPro && proUntilMs ? proUntilMs : 0);
    const until = base + p.days * 86400000;
    const pass = t('squad.pass_short', { count: p.days });
    Alert.alert(
      t('squad.pass_confirm_title'),
      paidPro ? t('squad.pass_confirm_body_paid') : t('squad.pass_confirm_body', { pass, date: fmtDateRef.current(until) }),
      [
        { text: t('home.cancel'), style: 'cancel' },
        { text: t('squad.pass_confirm_ok'), onPress: () => { setActivatingId(p.id); startPass(p); } },
      ],
    );
  }, [activatingId, uid, localState?.isPro, proUntilMs, t, startPass]);


  return (
    <View style={[styles.container, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Icon name="arrow-back" size={22} color={c.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: c.text }]}>{t('squad.title')}</Text>
          <Text style={[styles.headerSub, { color: c.textSecondary }]} numberOfLines={1}>{t('squad.subtitle')}</Text>
        </View>
      </View>

      {!uid ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>🔒</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('squad.sign_in')}</Text>
        </View>
      ) : loading && !squad ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={ACCENT} />
      ) : !squad ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 40 }}>⚠️</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{loadError ? t('squad.error_load') : ''}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ACCENT} />}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero */}
          <View style={styles.hero}>
            <SquadBadge rankKey={rank?.key || 'squad'} size={64} />
            <Text style={[styles.heroRank, { marginTop: 6 }]}>
              {rank ? t(`squad.rank_${rank.key}`) : t('squad.rank_none')}
            </Text>
            <Text style={styles.heroCount}>{direct}</Text>
            <Text style={styles.heroLabel}>{t('squad.friends_label', { count: direct })}</Text>
            <View style={[styles.row, { gap: 14, marginTop: 8 }]}>
              <View style={[styles.row, { gap: 4 }]}>
                <Icon name="people" size={13} color="rgba(255,255,255,0.85)" />
                <Text style={styles.heroMeta}>{t('squad.total_label', { count: squad.total || 0 })}</Text>
              </View>
              <View style={[styles.row, { gap: 4 }]}>
                <Icon name="calendar" size={12} color="rgba(255,255,255,0.85)" />
                <Text style={styles.heroMeta}>{t('squad.week_label', { count: squad.week || 0 })}</Text>
              </View>
            </View>
            {proActive && (
              <View style={styles.proPill}>
                <Text style={styles.proPillText}>✨ {t('squad.pro_active_until', { date: fmtDate(proUntilMs) })}</Text>
              </View>
            )}
          </View>

          {/* My Pro passes: started when the player chooses (036_squad_passes.sql) */}
          {(squad.passes || []).length > 0 && (
            <Card c={c} style={{ borderColor: GOLD }}>
              <Text style={[styles.cardTitle, { color: c.text }]}>🎟️ {t('squad.passes_title')}</Text>
              {squad.passes.map((p) => (
                <View key={p.id} style={[styles.row, styles.passRow, { borderTopColor: c.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.passName, { color: c.text }]}>{t('squad.pass_short', { count: p.days })}</Text>
                    <Text style={[styles.muted, { color: c.textSecondary }]}>
                      {p.source === 'welcome' ? t('squad.pass_source_welcome') : t('squad.pass_source_milestone', { count: p.step })}
                      {' · '}
                      {t('squad.pass_expires', { date: fmtDate(Date.parse(p.expiresAt)) })}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.primaryBtn, { paddingHorizontal: 16, paddingVertical: 8, opacity: activatingId ? 0.5 : 1 }]}
                    onPress={() => confirmPass(p)}
                    disabled={!!activatingId}
                  >
                    {activatingId === p.id
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={styles.primaryText}>{t('squad.pass_activate')}</Text>}
                  </TouchableOpacity>
                </View>
              ))}
              <Text style={[styles.muted, { color: c.textSecondary, marginTop: 8 }]}>{t('squad.passes_hint')}</Text>
            </Card>
          )}

          {/* Next reward */}
          <Card c={c}>
            <Text style={[styles.cardTitle, { color: c.text }]}>
              {next
                ? t('squad.next_reward', { count: next.n - direct, pro: t('squad.pass_name', { count: next.days }) })
                : t('squad.all_rewards')}
            </Text>
            <View style={[styles.barBg, { backgroundColor: c.border }]}>
              <View style={[styles.barFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
            {!!nextR && (
              <View style={[styles.row, { gap: 6, marginTop: 8 }]}>
                <SquadBadge rankKey={nextR.key} size={18} />
                <Text style={[styles.muted, { color: c.textSecondary, flex: 1 }]}>
                  {t('squad.next_rank', { count: nextR.n - direct, rank: t(`squad.rank_${nextR.key}`) })}
                </Text>
              </View>
            )}
          </Card>

          {/* Invite */}
          <Card c={c}>
            <Text style={[styles.cardLabel, { color: c.textSecondary }]}>{t('squad.your_code')}</Text>
            <View style={[styles.row, { justifyContent: 'space-between', marginTop: 6 }]}>
              <Text style={[styles.code, { color: c.text }]} selectable>{squad.code}</Text>
              <TouchableOpacity style={[styles.smallBtn, { borderColor: c.border }]} onPress={copyCode}>
                <Icon name="copy-outline" size={16} color={c.text} />
                <Text style={[styles.smallBtnText, { color: c.text }]}>{t('squad.copy')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 12 }]} onPress={shareInvite} activeOpacity={0.85}>
              <Icon name="share-social" size={16} color="#fff" />
              <Text style={styles.primaryText}>{t('squad.invite_button')}</Text>
            </TouchableOpacity>
            <Text style={[styles.muted, { color: c.textSecondary, marginTop: 10 }]}>
              {t('squad.invite_hint', { pro: t('squad.pass_name', { count: FRIEND_PRO_DAYS }) })}
            </Text>
          </Card>

          {/* Rewards ladder */}
          <Card c={c}>
            <Text style={[styles.cardTitle, { color: c.text }]}>{t('squad.rewards_title')}</Text>
            {STEPS.map((s) => {
              const done = direct >= s.n;
              return (
                <View key={s.n} style={[styles.row, styles.ladderRow]}>
                  <Icon name={done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={done ? GREEN : c.textMuted} />
                  <Text style={[styles.ladderText, { color: c.text }]}>{t('squad.reward_row', { count: s.n, pro: t('squad.pass_short', { count: s.days }) })}</Text>
                </View>
              );
            })}
            {[...RANKS].reverse().map((r) => {
              const done = direct >= r.n;
              return (
                <View key={r.key} style={[styles.row, styles.ladderRow]}>
                  <Icon name={done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={done ? r.color : c.textMuted} />
                  <SquadBadge rankKey={r.key} size={20} style={{ opacity: done ? 1 : 0.45 }} />
                  <Text style={[styles.ladderText, { color: c.text }]}>
                    {t('squad.rank_row', { count: r.n, rank: t(`squad.rank_${r.key}`) })}
                  </Text>
                </View>
              );
            })}
          </Card>

          {/* Squad size unlocks running for staff (038_staff_elections.sql).
              Only once the backend switch /elections_enabled is on. */}
          {electionsEnabled && (
          <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('Elections')}>
            <Card c={c}>
              <View style={[styles.row, { gap: 8 }]}>
                <Text style={{ fontSize: 18 }}>🗳️</Text>
                <Text style={[styles.cardTitle, { color: c.text, flex: 1 }]}>{t('elections.squad_card_title')}</Text>
                <Icon name="chevron-forward" size={18} color={c.textSecondary} />
              </View>
              {[
                { n: BADGE_MIN_SQUAD, key: 'elections.squad_unlock_jmd' },
                { n: ROLE_RULES.mod.minSquad, key: 'elections.squad_unlock_mod' },
              ].map((u) => {
                const done = direct >= u.n;
                return (
                  <View key={u.key} style={[styles.row, styles.ladderRow]}>
                    <Icon name={done ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={done ? GREEN : c.textMuted} />
                    <Text style={[styles.ladderText, { color: c.text }]}>{t(u.key, { count: u.n })}</Text>
                  </View>
                );
              })}
            </Card>
          </TouchableOpacity>
          )}

          {/* How it works */}
          <Card c={c}>
            <Text style={[styles.cardTitle, { color: c.text }]}>{t('squad.how_title')}</Text>
            {[1, 2, 3].map((n) => (
              <View key={n} style={[styles.row, { alignItems: 'flex-start', marginTop: 8, gap: 10 }]}>
                <View style={styles.stepDot}><Text style={styles.stepDotText}>{n}</Text></View>
                <Text style={[styles.muted, { color: c.text, flex: 1 }]}>{t(`squad.how_${n}`, { pro: t('squad.pass_name', { count: FRIEND_PRO_DAYS }) })}</Text>
              </View>
            ))}
          </Card>

          {/* The squad I joined, or join one */}
          {squad.joined ? (
            <Card c={c}>
              <Text style={[styles.cardTitle, { color: c.text }]}>
                {t('squad.in_squad_of', { name: squad.joined.inviterName || t('chat.anonymous') })}
              </Text>
              <Text style={[styles.muted, { color: squad.joined.status === 'pending' ? GOLD : GREEN, marginTop: 4 }]}>
                {squad.joined.status === 'pending'
                  ? t('squad.in_squad_pending', { pro: t('squad.pass_name', { count: FRIEND_PRO_DAYS }) })
                  : t('squad.in_squad_counted')}
              </Text>
            </Card>
          ) : squad.canJoin ? (
            <Card c={c}>
              <Text style={[styles.cardTitle, { color: c.text }]}>{t('squad.have_code')}</Text>
              <View style={[styles.row, { gap: 8, marginTop: 10 }]}>
                <TextInput
                  value={codeInput}
                  onChangeText={(v) => setCodeInput(v.toUpperCase())}
                  placeholder="ABC123"
                  placeholderTextColor={c.placeholder}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={8}
                  style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, { paddingHorizontal: 18, opacity: codeInput.trim().length >= 6 && !joining ? 1 : 0.5 }]}
                  onPress={submitCode}
                  disabled={codeInput.trim().length < 6 || joining}
                >
                  {joining ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{t('squad.join')}</Text>}
                </TouchableOpacity>
              </View>
              <Text style={[styles.muted, { color: c.textSecondary, marginTop: 8 }]}>{t('squad.have_code_hint', { pro: t('squad.pass_name', { count: FRIEND_PRO_DAYS }) })}</Text>
            </Card>
          ) : null}

          {/* Members */}
          <Card c={c}>
            <Text style={[styles.cardTitle, { color: c.text }]}>{t('squad.members_title')}</Text>
            {(squad.members || []).length === 0 ? (
              <Text style={[styles.muted, { color: c.textSecondary, marginTop: 6 }]}>{t('squad.members_empty')}</Text>
            ) : (squad.members || []).map((m, i) => (
              <View key={`${m.name}-${i}`} style={[styles.row, styles.memberRow, { borderTopColor: c.border }]}>
                <Avatar uri={m.avatar} size={32} />
                <Text style={[styles.memberName, { color: c.text }]} numberOfLines={1}>{m.name || t('chat.anonymous')}</Text>
                <View style={[styles.pill, { backgroundColor: (m.status === 'qualified' ? GREEN : GOLD) + '22' }]}>
                  <Text style={[styles.pillText, { color: m.status === 'qualified' ? GREEN : GOLD }]}>
                    {m.status === 'qualified'
                      ? t('squad.member_counted')
                      : joinedTodayUtc(m.joinedAt) ? t('squad.member_pending') : t('squad.member_waiting')}
                  </Text>
                </View>
              </View>
            ))}
          </Card>

          {/* Top recruiters this week */}
          <Card c={c}>
            <Text style={[styles.cardTitle, { color: c.text }]}>🏆 {t('squad.leaderboard_title')}</Text>
            {board.length === 0 ? (
              <Text style={[styles.muted, { color: c.textSecondary, marginTop: 6 }]}>{t('squad.leaderboard_empty')}</Text>
            ) : board.map((b, i) => (
              <View key={b.uid} style={[styles.row, styles.memberRow, { borderTopColor: c.border }]}>
                <Text style={[styles.place, { color: i < 3 ? GOLD : c.textSecondary }]}>{i + 1}</Text>
                <Avatar uri={b.avatar} size={32} />
                <Text style={[styles.memberName, { color: c.text }]} numberOfLines={1}>
                  {b.name || t('chat.anonymous')}{b.uid === uid ? ` (${t('squad.you')})` : ''}
                </Text>
                <SquadBadge count={b.direct} size={18} />
                <Text style={[styles.boardCount, { color: c.text }]}>+{b.n}</Text>
              </View>
            ))}
          </Card>
        </ScrollView>
      )}
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
  hero: { backgroundColor: ACCENT, borderRadius: 18, padding: 18, alignItems: 'center' },
  heroRank: { color: '#FDE68A', fontSize: 14, fontWeight: '900', letterSpacing: 0.5 },
  heroCount: { color: '#fff', fontSize: 56, fontWeight: '900', lineHeight: 64, marginTop: 4 },
  heroLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 14, fontWeight: '700' },
  heroMeta: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
  proPill: { marginTop: 12, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  proPillText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 12 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  barBg: { height: 8, borderRadius: 4, marginTop: 10, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: GREEN },
  code: { fontSize: 30, fontWeight: '900', letterSpacing: 4 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  smallBtnText: { fontSize: 12, fontWeight: '700' },
  primaryBtn: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  primaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  muted: { fontSize: 13, lineHeight: 18 },
  ladderRow: { gap: 8, marginTop: 8 },
  ladderText: { fontSize: 13, fontWeight: '600', flex: 1 },
  stepDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  stepDotText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18, fontWeight: '800', letterSpacing: 3 },
  memberRow: { gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 8 },
  passRow: { gap: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 10 },
  passName: { fontSize: 15, fontWeight: '800' },
  memberName: { flex: 1, fontSize: 14, fontWeight: '700' },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '800' },
  place: { width: 18, fontSize: 14, fontWeight: '900', textAlign: 'center' },
  boardCount: { fontSize: 14, fontWeight: '900' },
});
