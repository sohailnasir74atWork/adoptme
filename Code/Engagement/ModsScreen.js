/**
 * ModsScreen.js — Moderator & Junior Mod roster with thumbs up/down ratings
 *
 * One vote per mod per user (tap again to undo, or switch). The phone writes
 * only the vote; functions/modVoteTally.js decides whether it counts (not
 * banned or muted, account 7+ days old) and keeps the public tally.
 *
 * RTDB:
 *   mods/{uid}                            — synced by cloud fn (~60 bytes per mod)
 *   mod_votes_by_user/{voterUid}/{modUid} — 1 or -1, readable by the voter only
 *   mod_votes_tally/{modUid}              — { ups, downs } counted by the server (read-only)
 *   mod_votes_summary/{modUid}            — old phone-computed counter; pre-April 2026 builds only
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, Image, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ref, get, set } from '@react-native-firebase/database';
import { getAuth } from '@react-native-firebase/auth';
import Icon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';

// 30 min, like the profile cache: a MOD who renames or changes their
// picture shows the new one within half an hour (was 6 h). The roster
// is one small RTDB read.
const MODS_CACHE_MS = 30 * 60 * 1000;

const ROLE_META = {
  mod:  { labelKey: 'mods.role_mod',  color: '#3B82F6', icon: 'shield-halved' },
  jmod: { labelKey: 'mods.role_jmod', color: '#8B5CF6', icon: 'shield' },
};

// Same bar as functions/modVoteTally.js MIN_ACCOUNT_AGE_MS: a vote from a
// younger account would be saved but never counted.
const MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const accountAgeMs = (authUser) => {
  const raw = authUser?.metadata?.creationTime;
  const created = /^\d+$/.test(String(raw)) ? Number(raw) : Date.parse(raw || '');
  return Number.isFinite(created) ? Date.now() - created : null;
};

const positiveColor = (ratio) => (ratio >= 0.7 ? '#10B981' : ratio >= 0.4 ? '#F59E0B' : '#EF4444');

// ─── Mod Card ───
const ModCard = React.memo(({ mod, myVote, onVote, onChat, isDarkMode }) => {
  const { t } = useTranslation();
  const roleMeta = ROLE_META[mod.role] || ROLE_META.mod;
  const cardBg = isDarkMode ? '#1e293b' : '#ffffff';
  const textColor = isDarkMode ? '#f1f5f9' : '#1a1a2e';
  const subColor = isDarkMode ? '#94a3b8' : '#64748b';
  const totalVotes = mod.ups + mod.downs;
  const ratio = totalVotes > 0 ? mod.ups / totalVotes : 0;

  return (
    <View style={[styles.card, { backgroundColor: cardBg }]}>
      {/* Avatar */}
      <View style={styles.avatarWrap}>
        {mod.avatar ? (
          <Image source={{ uri: mod.avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, { backgroundColor: roleMeta.color + '20', alignItems: 'center', justifyContent: 'center' }]}>
            <FontAwesome name="user" size={18} color={roleMeta.color} solid />
          </View>
        )}
        <View style={[styles.roleDot, { backgroundColor: roleMeta.color }]}>
          <FontAwesome name={roleMeta.icon} size={8} color="#fff" solid />
        </View>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <Text style={[styles.name, { color: textColor }]} numberOfLines={1}>
          {mod.displayName}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.rolePill, { backgroundColor: roleMeta.color + '18' }]}>
            <Text style={[styles.roleText, { color: roleMeta.color }]}>{t(roleMeta.labelKey)}</Text>
          </View>
          {totalVotes > 0 && (
            <View style={[styles.rankPill, { backgroundColor: positiveColor(ratio) + '18' }]}>
              <Text style={[styles.rankText, { color: positiveColor(ratio) }]}>
                {t('mods.positive', { pct: Math.round(ratio * 100), defaultValue: '{{pct}}% positive' })}
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Chat button */}
      <TouchableOpacity onPress={() => onChat(mod)} style={styles.chatBtn} activeOpacity={0.6}>
        <FontAwesome name="comment" size={14} color={roleMeta.color} solid />
      </TouchableOpacity>

      {/* Vote buttons */}
      <View style={styles.voteCol}>
        <TouchableOpacity
          onPress={() => onVote(mod.uid, 1)}
          style={[styles.voteBtn, myVote === 1 && { backgroundColor: '#10B98120' }]}
          activeOpacity={0.6}
        >
          <FontAwesome name="thumbs-up" size={14} color={myVote === 1 ? '#10B981' : subColor} solid={myVote === 1} />
        </TouchableOpacity>
        <Text style={[styles.scoreNum, { color: mod.score > 0 ? '#10B981' : mod.score < 0 ? '#EF4444' : subColor }]}>
          {mod.score > 0 ? `+${mod.score}` : mod.score}
        </Text>
        <TouchableOpacity
          onPress={() => onVote(mod.uid, -1)}
          style={[styles.voteBtn, myVote === -1 && { backgroundColor: '#EF444420' }]}
          activeOpacity={0.6}
        >
          <FontAwesome name="thumbs-down" size={14} color={myVote === -1 ? '#EF4444' : subColor} solid={myVote === -1} />
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── Main Screen ───
const ModsScreen = () => {
  const { theme, appdatabase, user, electionsEnabled, isUserBlocked } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isDarkMode = theme === 'dark';

  // Prime from local cache so first paint is instant when fresh
  const initialFromCache = (() => {
    const cached = localState?.modsRoster;
    if (!cached?.data?.length || !cached.timestamp) return null;
    const age = Date.now() - cached.timestamp;
    return age >= 0 && age < MODS_CACHE_MS ? cached.data : null;
  })();

  const [roster, setRoster] = useState(initialFromCache || []);
  const [loading, setLoading] = useState(!initialFromCache);
  const [refreshing, setRefreshing] = useState(false);
  // Ratings are always read fresh (two tiny nodes); only the roster is cached.
  const [tally, setTally] = useState({});   // { modUid: { ups, downs } }
  const [myVotes, setMyVotes] = useState({}); // { modUid: 1 | -1 }

  const bgColor = isDarkMode ? '#0f172a' : '#f8fafc';
  const textColor = isDarkMode ? '#f1f5f9' : '#1a1a2e';
  const subColor = isDarkMode ? '#94a3b8' : '#64748b';

  const fetchVotes = useCallback(async () => {
    if (!appdatabase) return;
    try {
      const [tallySnap, mineSnap] = await Promise.all([
        get(ref(appdatabase, 'mod_votes_tally')),
        user?.id ? get(ref(appdatabase, `mod_votes_by_user/${user.id}`)) : Promise.resolve(null),
      ]);
      setTally(tallySnap?.exists() ? tallySnap.val() : {});
      setMyVotes(mineSnap?.exists() ? mineSnap.val() : {});
    } catch (e) {
      console.warn('[ModsScreen] votes fetch error:', e?.message);
    }
  }, [appdatabase, user?.id]);

  const fetchMods = useCallback(async (isRefresh = false) => {
    if (!appdatabase) return;
    if (isRefresh) setRefreshing(true);

    try {
      if (isRefresh) fetchVotes();
      const snap = await get(ref(appdatabase, 'mods'));
      const list = snap.exists()
        ? Object.entries(snap.val()).map(([uid, data]) => ({
            uid,
            displayName: data.displayName || 'Unknown',
            avatar: data.avatar || '',
            role: data.role || 'mod',
          }))
        : [];

      setRoster(list);
      updateLocalState('modsRoster', { data: list, timestamp: Date.now() });
    } catch (e) {
      console.warn('[ModsScreen] fetch error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appdatabase, updateLocalState, fetchVotes]);

  // Roster: fetch only when cache is missing or stale (MODS_CACHE_MS).
  useEffect(() => {
    if (initialFromCache) return; // fresh cache already in state
    fetchMods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchVotes();
  }, [fetchVotes]);

  // Mods first, then jmods; best score first within each group, then name.
  const mods = useMemo(() => {
    const list = roster.map((m) => {
      const s = tally[m.uid] || {};
      const ups = s.ups > 0 ? s.ups : 0;
      const downs = s.downs > 0 ? s.downs : 0;
      return { ...m, ups, downs, score: ups - downs };
    });
    list.sort((a, b) => {
      if (a.role !== b.role) return a.role === 'mod' ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return (a.displayName || '').localeCompare(b.displayName || '');
    });
    return list;
  }, [roster, tally]);

  const handleVote = useCallback(async (modUid, vote) => {
    if (!appdatabase || !user?.id) {
      Alert.alert(t('signin.title_signin'), t('mods.vote_sign_in', { defaultValue: 'Sign in to rate moderators.' }));
      return;
    }
    if (modUid === user.id) {
      Alert.alert(t('mods.vote_self_title', { defaultValue: 'Oops' }), t('mods.vote_self', { defaultValue: "You can't rate yourself!" }));
      return;
    }
    // Votes from banned/muted or new accounts don't count on the server, so
    // say so up front instead of showing a vote that won't stick.
    if (isUserBlocked) {
      Alert.alert(t('mods.vote_blocked_title', { defaultValue: 'Not right now' }), t('mods.vote_blocked', { defaultValue: "You can't rate moderators while you are banned or muted." }));
      return;
    }
    const age = accountAgeMs(getAuth().currentUser);
    if (age !== null && age < MIN_ACCOUNT_AGE_MS) {
      const days = Math.max(1, Math.ceil((MIN_ACCOUNT_AGE_MS - age) / DAY_MS));
      Alert.alert(
        t('mods.vote_new_title', { defaultValue: 'Almost there' }),
        t('mods.vote_new_account', { count: days, defaultValue: 'New accounts can rate moderators after 7 days. Try again in {{count}} day(s).' }),
      );
      return;
    }

    const oldVote = myVotes[modUid] || 0;
    const newVote = oldVote === vote ? 0 : vote; // tap again to undo, or switch
    const before = tally[modUid] || { ups: 0, downs: 0 };
    const next = { ups: before.ups || 0, downs: before.downs || 0 };
    if (oldVote === 1) next.ups = Math.max(0, next.ups - 1);
    if (oldVote === -1) next.downs = Math.max(0, next.downs - 1);
    if (newVote === 1) next.ups += 1;
    if (newVote === -1) next.downs += 1;

    const applyVote = (v, counts) => {
      setMyVotes((prev) => {
        const out = { ...prev };
        if (v === 0) delete out[modUid];
        else out[modUid] = v;
        return out;
      });
      setTally((prev) => ({ ...prev, [modUid]: counts }));
    };

    applyVote(newVote, next); // optimistic
    try {
      // Only the vote itself; the server moves the tally (countModVote).
      await set(ref(appdatabase, `mod_votes_by_user/${user.id}/${modUid}`), newVote === 0 ? null : newVote);
    } catch (e) {
      applyVote(oldVote, before);
      console.warn('[ModsScreen] vote error:', e?.message);
    }
  }, [appdatabase, user?.id, myVotes, tally, isUserBlocked, t]);

  // Bottom drawer state
  const [drawerUser, setDrawerUser] = useState(null);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);

  const handleModPress = useCallback((mod) => {
    if (!user?.id) {
      Alert.alert(t('signin.title_signin'), t('mods.sign_in_to_view'));
      return;
    }
    setDrawerUser({
      senderId: mod.uid,
      sender: mod.displayName,
      avatar: mod.avatar,
    });
    setIsDrawerVisible(true);
  }, [user?.id, t]);

  const handleStartChatFromDrawer = useCallback(() => {
    if (!drawerUser) return;
    setIsDrawerVisible(false);
    setTimeout(() => {
      try {
        navigation.navigate('PrivateChatRoot', {
          selectedUser: {
            senderId: drawerUser.senderId,
            sender: drawerUser.sender,
            avatar: drawerUser.avatar,
          },
        });
      } catch (e) {
        console.warn('[ModsScreen] Chat navigation failed:', e?.message);
      }
    }, 300);
  }, [drawerUser, navigation]);

  const stats = useMemo(() => {
    const modCount = mods.filter(m => m.role === 'mod').length;
    const jmodCount = mods.filter(m => m.role === 'jmod').length;
    return { modCount, jmodCount };
  }, [mods]);

  const renderItem = useCallback(({ item }) => (
    <ModCard
      mod={item}
      myVote={myVotes[item.uid] || 0}
      onVote={handleVote}
      onChat={handleModPress}
      isDarkMode={isDarkMode}
    />
  ), [isDarkMode, handleModPress, handleVote, myVotes]);

  return (
    <View style={[styles.container, { backgroundColor: bgColor, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={22} color={textColor} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: textColor }]}>
          {t('mods.title', { defaultValue: 'Moderators' })}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Stats bar */}
      <View style={[styles.statsBar, { borderBottomColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}>
        <View style={styles.statItem}>
          <FontAwesome name="shield-halved" size={12} color="#3B82F6" solid />
          <Text style={[styles.statNum, { color: textColor }]}>{stats.modCount}</Text>
          <Text style={[styles.statLabel, { color: subColor }]}>{t('mods.stat_mods')}</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: isDarkMode ? '#334155' : '#e2e8f0' }]} />
        <View style={styles.statItem}>
          <FontAwesome name="shield" size={12} color="#8B5CF6" solid />
          <Text style={[styles.statNum, { color: textColor }]}>{stats.jmodCount}</Text>
          <Text style={[styles.statLabel, { color: subColor }]}>{t('mods.stat_jmods')}</Text>
        </View>
      </View>

      {/* Staff are elected (supabase/038_staff_elections.sql), once the
          backend switch /elections_enabled is on. */}
      {electionsEnabled && (
      <TouchableOpacity
        style={[styles.electionBanner, { backgroundColor: isDarkMode ? 'rgba(124,58,237,0.18)' : '#F5F3FF' }]}
        onPress={() => navigation.navigate('Elections')}
        activeOpacity={0.85}
      >
        <Text style={styles.electionEmoji}>🗳️</Text>
        <Text style={[styles.electionText, { color: textColor }]}>{t('elections.mods_banner')}</Text>
        <Icon name="chevron-forward" size={16} color="#7C3AED" />
      </TouchableOpacity>
      )}

      {loading ? (
        <ActivityIndicator size="large" color={config.colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          removeClippedSubviews={false}
          data={mods}
          keyExtractor={item => item.uid}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 30 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => fetchMods(true)}
              tintColor={config.colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={[styles.emptyTitle, { color: textColor }]}>
                {t('mods.empty', { defaultValue: 'No moderators yet' })}
              </Text>
            </View>
          }
        />
      )}

      {/* Profile BottomDrawer */}
      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={handleStartChatFromDrawer}
        selectedUser={drawerUser}
        bannedUsers={[]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700' },

  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    gap: 16,
  },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statNum: { fontSize: 14, fontWeight: '700' },
  statLabel: { fontSize: 11, fontWeight: '500' },
  statDivider: { width: 1, height: 16 },
  electionBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12 },
  electionEmoji: { fontSize: 18 },
  electionText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 18 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  avatarWrap: { position: 'relative' },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  roleDot: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  info: { flex: 1, gap: 4 },
  name: { fontSize: 14, fontWeight: '700' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rolePill: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  roleText: { fontSize: 10, fontWeight: '700' },
  rankPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  rankText: { fontSize: 10, fontWeight: '700' },

  voteCol: { alignItems: 'center', gap: 2 },
  voteBtn: { width: 32, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  scoreNum: { fontSize: 14, fontWeight: '800' },

  chatBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.08)',
  },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
});

export default React.memo(ModsScreen);
