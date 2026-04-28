/**
 * ModsScreen.js — Moderator & Junior Mod roster
 *
 * RTDB:
 *   mods/{uid} — synced by cloud fn (~60 bytes per mod)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, FlatList, StyleSheet, Image, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ref, get } from '@react-native-firebase/database';
import Icon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import config from '../Helper/Environment';
import ProfileBottomDrawer from '../ChatScreen/GroupChat/BottomDrawer';

const MODS_CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours

const ROLE_META = {
  mod:  { label: 'Moderator',  color: '#3B82F6', icon: 'shield-halved' },
  jmod: { label: 'Junior Mod', color: '#8B5CF6', icon: 'shield' },
};

// ─── Mod Card ───
const ModCard = React.memo(({ mod, onChat, isDarkMode }) => {
  const roleMeta = ROLE_META[mod.role] || ROLE_META.mod;
  const cardBg = isDarkMode ? '#1e293b' : '#ffffff';
  const textColor = isDarkMode ? '#f1f5f9' : '#1a1a2e';

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
        <View style={[styles.rolePill, { backgroundColor: roleMeta.color + '18' }]}>
          <Text style={[styles.roleText, { color: roleMeta.color }]}>{roleMeta.label}</Text>
        </View>
      </View>

      {/* Chat button */}
      <TouchableOpacity onPress={() => onChat(mod)} style={styles.chatBtn} activeOpacity={0.6}>
        <FontAwesome name="comment" size={16} color={roleMeta.color} solid />
      </TouchableOpacity>
    </View>
  );
});

// ─── Main Screen ───
const ModsScreen = () => {
  const { theme, appdatabase, user } = useGlobalState();
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

  const [mods, setMods] = useState(initialFromCache || []);
  const [loading, setLoading] = useState(!initialFromCache);
  const [refreshing, setRefreshing] = useState(false);

  const bgColor = isDarkMode ? '#0f172a' : '#f8fafc';
  const textColor = isDarkMode ? '#f1f5f9' : '#1a1a2e';
  const subColor = isDarkMode ? '#94a3b8' : '#64748b';

  const fetchMods = useCallback(async (isRefresh = false) => {
    if (!appdatabase) return;
    if (isRefresh) setRefreshing(true);

    try {
      const snap = await get(ref(appdatabase, 'mods'));
      const list = snap.exists()
        ? Object.entries(snap.val()).map(([uid, data]) => ({
            uid,
            displayName: data.displayName || 'Unknown',
            avatar: data.avatar || '',
            role: data.role || 'mod',
          }))
        : [];

      // Sort: mods first, then jmods, alphabetical within each group
      list.sort((a, b) => {
        if (a.role !== b.role) return a.role === 'mod' ? -1 : 1;
        return (a.displayName || '').localeCompare(b.displayName || '');
      });

      setMods(list);
      updateLocalState('modsRoster', { data: list, timestamp: Date.now() });
    } catch (e) {
      console.warn('[ModsScreen] fetch error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appdatabase, updateLocalState]);

  // Fetch only when cache is missing or stale (6h TTL).
  useEffect(() => {
    if (initialFromCache) return; // fresh cache already in state
    fetchMods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bottom drawer state
  const [drawerUser, setDrawerUser] = useState(null);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);

  const handleModPress = useCallback((mod) => {
    if (!user?.id) {
      Alert.alert('Sign In', 'Sign in to view moderator profiles.');
      return;
    }
    setDrawerUser({
      senderId: mod.uid,
      sender: mod.displayName,
      avatar: mod.avatar,
    });
    setIsDrawerVisible(true);
  }, [user?.id]);

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
    <ModCard mod={item} onChat={handleModPress} isDarkMode={isDarkMode} />
  ), [isDarkMode, handleModPress]);

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
          <Text style={[styles.statLabel, { color: subColor }]}>Mods</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: isDarkMode ? '#334155' : '#e2e8f0' }]} />
        <View style={styles.statItem}>
          <FontAwesome name="shield" size={12} color="#8B5CF6" solid />
          <Text style={[styles.statNum, { color: textColor }]}>{stats.jmodCount}</Text>
          <Text style={[styles.statLabel, { color: subColor }]}>JMods</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={config.colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
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
  rolePill: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  roleText: { fontSize: 10, fontWeight: '700' },

  chatBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.08)',
  },

  emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
});

export default React.memo(ModsScreen);
