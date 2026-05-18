import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { doc, getDoc } from '@react-native-firebase/firestore';
import { ref, get } from '@react-native-firebase/database';
import { getTrustedRoster, getCmsrRoster, getHelperRoster } from '../../Supabase/userBackend';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../../LocalGlobelStats';
import { mixpanel } from '../../AppHelper/MixPenel';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import ProfileBottomDrawer from './BottomDrawer';

const CACHE_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days — Top Picks
const ROSTER_CACHE_MS = 4 * 60 * 60 * 1000;        // 4 hours — Trusted / CMSR
const DEFAULT_AVATAR = 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
const ROSTER_PAGE_SIZE = 25;

const TABS = [
  { key: 'topRated', label: 'Top Picks', icon: 'medal',             color: '#F59E0B' },
  { key: 'trusted',  label: 'Trusted',   icon: 'shield-checkmark',  color: '#10B981' },
  { key: 'cmsr',     label: 'CMSR',      icon: 'ribbon',            color: '#0EA5E9' },
  { key: 'helper',   label: 'Helper',    icon: 'hand-left',         color: '#14B8A6' },
];

const LeaderboardScreen = () => {
  const { theme, user, appdatabase, firestoreDB } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState('topRated');
  const [topRatedData, setTopRatedData] = useState([]);
  const [trustedData, setTrustedData] = useState([]);
  const [cmsrData, setCmsrData] = useState([]);
  const [helperData, setHelperData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState({}); // lazy-load tracker

  // Per-roster pagination state. hasMore = result of last page filled the page.
  const [trustedHasMore, setTrustedHasMore] = useState(true);
  const [cmsrHasMore, setCmsrHasMore] = useState(true);
  const [helperHasMore, setHelperHasMore] = useState(true);
  const [trustedLoadingMore, setTrustedLoadingMore] = useState(false);
  const [cmsrLoadingMore, setCmsrLoadingMore] = useState(false);
  const [helperLoadingMore, setHelperLoadingMore] = useState(false);

  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [bannedUsers] = useState(Array.isArray(localState.bannedUsers) ? localState.bannedUsers : []);

  const styles = useMemo(() => getStyles(isDarkMode, c), [isDarkMode]);

  // ── Generic cache validity check ──
  const isCacheValid = useCallback((cachedData, ttlMs) => {
    if (!cachedData || !cachedData.timestamp) return false;
    const timestamp = typeof cachedData.timestamp === 'number'
      ? cachedData.timestamp
      : typeof cachedData.timestamp === 'string'
        ? parseInt(cachedData.timestamp, 10)
        : null;
    if (!timestamp || isNaN(timestamp)) return false;
    const cacheAge = Date.now() - timestamp;
    return cacheAge >= 0 && cacheAge < ttlMs;
  }, []);

  // ── Fetch Top Rated (Firestore pre-computed cache) ──
  const fetchTopRated = useCallback(async () => {
    if (!firestoreDB || !user?.id) return;
    try {
      const cacheDocRef = doc(firestoreDB, 'leaderboard_cache', 'top50');
      const cacheDocSnap = await getDoc(cacheDocRef);

      if (!cacheDocSnap.exists()) {
        setTopRatedData([]);
        return;
      }

      const cacheData = cacheDocSnap.data();
      const cachedUsers = cacheData?.users || [];
      if (cachedUsers.length === 0) {
        setTopRatedData([]);
        return;
      }

      const list = cachedUsers.map((u, i) => ({
        userId: u.userId,
        ratingCount: u.ratingCount || 0,
        averageRating: u.averageRating || 0,
        displayName: u.displayName || 'Anonymous',
        avatar: u.avatar || DEFAULT_AVATAR,
        rank: i + 1,
        updatedAt: u.updatedAt || Date.now(),
      }));

      const cacheTimestamp = cacheData.lastUpdated?.toMillis?.() || cacheData.lastUpdated || Date.now();
      updateLocalState('leaderboardTop50', {
        data: list,
        timestamp: cacheTimestamp,
        lastFetched: cacheData.lastUpdated?.toDate?.()?.toISOString() || new Date().toISOString(),
      });

      setTopRatedData(list);
    } catch (error) {
      console.warn('[Leaderboard] topRated fetch error:', error?.message);
      setTopRatedData([]);
    }
  }, [firestoreDB, user?.id, updateLocalState]);

  // Fetch first page of a role roster from Supabase. Backs the initial
  // tab open + pull-to-refresh. The local MMKV cache only stores page 1.
  const fetchRoster = useCallback(async (node, cacheKey) => {
    try {
      const raw = node === 'trusted'
        ? await getTrustedRoster({ limit: ROSTER_PAGE_SIZE, offset: 0 })
        : node === 'cmsr'
          ? await getCmsrRoster({ limit: ROSTER_PAGE_SIZE, offset: 0 })
          : node === 'helper'
            ? await getHelperRoster({ limit: ROSTER_PAGE_SIZE, offset: 0 })
            : [];
      const list = raw.map((r) => ({ ...r, avatar: r.avatar || DEFAULT_AVATAR }));
      updateLocalState(cacheKey, { data: list, timestamp: Date.now() });
      if (node === 'trusted') setTrustedHasMore(list.length === ROSTER_PAGE_SIZE);
      else if (node === 'cmsr') setCmsrHasMore(list.length === ROSTER_PAGE_SIZE);
      else if (node === 'helper') setHelperHasMore(list.length === ROSTER_PAGE_SIZE);
      return list;
    } catch (e) {
      console.warn(`[Leaderboard] ${node} fetch error:`, e?.message);
      return [];
    }
  }, [updateLocalState]);

  // Append the next page on scroll. Bails out if already loading or no more
  // rows. Not cached — only the first page persists in MMKV.
  const loadMoreRoster = useCallback(async (node) => {
    if (node === 'trusted') {
      if (trustedLoadingMore || !trustedHasMore) return;
      setTrustedLoadingMore(true);
      try {
        const raw = await getTrustedRoster({
          limit: ROSTER_PAGE_SIZE,
          offset: trustedData.length,
        });
        const page = raw.map((r) => ({ ...r, avatar: r.avatar || DEFAULT_AVATAR }));
        setTrustedData((prev) => [...prev, ...page]);
        setTrustedHasMore(page.length === ROSTER_PAGE_SIZE);
      } catch (e) {
        console.warn('[Leaderboard] trusted loadMore error:', e?.message);
        setTrustedHasMore(false);
      } finally {
        setTrustedLoadingMore(false);
      }
    } else if (node === 'cmsr') {
      if (cmsrLoadingMore || !cmsrHasMore) return;
      setCmsrLoadingMore(true);
      try {
        const raw = await getCmsrRoster({
          limit: ROSTER_PAGE_SIZE,
          offset: cmsrData.length,
        });
        const page = raw.map((r) => ({ ...r, avatar: r.avatar || DEFAULT_AVATAR }));
        setCmsrData((prev) => [...prev, ...page]);
        setCmsrHasMore(page.length === ROSTER_PAGE_SIZE);
      } catch (e) {
        console.warn('[Leaderboard] cmsr loadMore error:', e?.message);
        setCmsrHasMore(false);
      } finally {
        setCmsrLoadingMore(false);
      }
    } else if (node === 'helper') {
      if (helperLoadingMore || !helperHasMore) return;
      setHelperLoadingMore(true);
      try {
        const raw = await getHelperRoster({
          limit: ROSTER_PAGE_SIZE,
          offset: helperData.length,
        });
        const page = raw.map((r) => ({ ...r, avatar: r.avatar || DEFAULT_AVATAR }));
        setHelperData((prev) => [...prev, ...page]);
        setHelperHasMore(page.length === ROSTER_PAGE_SIZE);
      } catch (e) {
        console.warn('[Leaderboard] helper loadMore error:', e?.message);
        setHelperHasMore(false);
      } finally {
        setHelperLoadingMore(false);
      }
    }
  }, [trustedLoadingMore, trustedHasMore, trustedData.length, cmsrLoadingMore, cmsrHasMore, cmsrData.length, helperLoadingMore, helperHasMore, helperData.length]);

  // ── Switch tab + lazy fetch (cache-first for rosters) ──
  const switchTab = useCallback(async (tabKey) => {
    triggerHapticFeedback('impactLight');
    setActiveTab(tabKey);
    if (loadedTabs[tabKey]) return;

    // Try local cache first for rosters (4h TTL). Cache holds only page 1,
    // so hasMore is true iff the cached page filled. The scroll handler then
    // calls loadMoreRoster with offset=cached.data.length for fresh pages.
    if (tabKey === 'trusted') {
      const cached = localState.trustedRoster;
      if (cached?.data?.length > 0 && isCacheValid(cached, ROSTER_CACHE_MS)) {
        setTrustedData(cached.data);
        setTrustedHasMore(cached.data.length >= ROSTER_PAGE_SIZE);
        setLoadedTabs(prev => ({ ...prev, trusted: true }));
        return;
      }
    } else if (tabKey === 'cmsr') {
      const cached = localState.cmsrRoster;
      if (cached?.data?.length > 0 && isCacheValid(cached, ROSTER_CACHE_MS)) {
        setCmsrData(cached.data);
        setCmsrHasMore(cached.data.length >= ROSTER_PAGE_SIZE);
        setLoadedTabs(prev => ({ ...prev, cmsr: true }));
        return;
      }
    } else if (tabKey === 'helper') {
      const cached = localState.helperRoster;
      if (cached?.data?.length > 0 && isCacheValid(cached, ROSTER_CACHE_MS)) {
        setHelperData(cached.data);
        setHelperHasMore(cached.data.length >= ROSTER_PAGE_SIZE);
        setLoadedTabs(prev => ({ ...prev, helper: true }));
        return;
      }
    }

    setLoading(true);
    if (tabKey === 'topRated') {
      await fetchTopRated();
    } else if (tabKey === 'trusted') {
      const list = await fetchRoster('trusted', 'trustedRoster');
      setTrustedData(list);
    } else if (tabKey === 'cmsr') {
      const list = await fetchRoster('cmsr', 'cmsrRoster');
      setCmsrData(list);
    } else if (tabKey === 'helper') {
      const list = await fetchRoster('helper', 'helperRoster');
      setHelperData(list);
    }
    setLoadedTabs(prev => ({ ...prev, [tabKey]: true }));
    setLoading(false);
  }, [fetchTopRated, fetchRoster, loadedTabs, triggerHapticFeedback, localState.trustedRoster, localState.cmsrRoster, localState.helperRoster, isCacheValid]);

  // ── Pull-to-refresh: bypass cache and re-fetch the active tab ──
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    if (activeTab === 'topRated') {
      await fetchTopRated();
    } else if (activeTab === 'trusted') {
      const list = await fetchRoster('trusted', 'trustedRoster');
      setTrustedData(list);
    } else if (activeTab === 'cmsr') {
      const list = await fetchRoster('cmsr', 'cmsrRoster');
      setCmsrData(list);
    } else if (activeTab === 'helper') {
      const list = await fetchRoster('helper', 'helperRoster');
      setHelperData(list);
    }
    setRefreshing(false);
  }, [activeTab, fetchTopRated, fetchRoster]);

  // ── Initial load: prefer local cache for Top Rated, else fetch ──
  useFocusEffect(
    useCallback(() => {
      const cached = localState.leaderboardTop50;
      if (cached?.data?.length > 0 && isCacheValid(cached, CACHE_DURATION_MS)) {
        setTopRatedData(cached.data);
        setLoadedTabs(prev => ({ ...prev, topRated: true }));
        return;
      }
      if (!loadedTabs.topRated) {
        setLoading(true);
        fetchTopRated().finally(() => {
          setLoadedTabs(prev => ({ ...prev, topRated: true }));
          setLoading(false);
        });
      }
    }, [localState.leaderboardTop50, isCacheValid, fetchTopRated, loadedTabs.topRated])
  );

  // ── User row click → open BottomDrawer ──
  const handleUserClick = useCallback((item) => {
    triggerHapticFeedback('impactLight');
    setSelectedUser({
      senderId: item.userId,
      sender: item.displayName,
      avatar: item.avatar,
    });
    setIsDrawerVisible(true);
    mixpanel.track('Leaderboard User Click', { tab: activeTab });
  }, [triggerHapticFeedback, activeTab]);

  const handleStartChat = useCallback(() => {
    if (!selectedUser) return;
    setIsDrawerVisible(false);
    setTimeout(() => {
      if (navigation && typeof navigation.navigate === 'function') {
        navigation.navigate('PrivateChatRoot', {
          selectedUser: {
            senderId: selectedUser.senderId,
            sender: selectedUser.sender,
            avatar: selectedUser.avatar,
          },
        });
      }
      mixpanel.track('Leaderboard Start Chat');
    }, 300);
  }, [selectedUser, navigation]);

  // ── Renderers ──
  const renderTopRatedItem = useCallback(({ item, index }) => {
    const rank = index + 1;
    const rankColor =
      rank === 1 ? '#ffb700be' :
      rank === 2 ? '#C0C0C0' :
      rank === 3 ? '#CD7F32' :
      config.colors.primary;

    return (
      <TouchableOpacity style={styles.userItem} onPress={() => handleUserClick(item)} activeOpacity={0.7}>
        <View style={[styles.rankBadge, { backgroundColor: rankColor }]}>
          <Text style={styles.rankText}>{rank}</Text>
        </View>
        <Image source={{ uri: item.avatar || DEFAULT_AVATAR }} style={styles.avatar} />
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>{item.displayName || 'Anonymous'}</Text>
          <View style={styles.ratingInfo}>
            <Icon name="star" size={12} color="#FFD700" />
            <Text style={styles.ratingText}>
              {item.averageRating.toFixed(1)} ({item.ratingCount} {item.ratingCount === 1 ? 'rating' : 'ratings'})
            </Text>
          </View>
        </View>
        <Icon name="chatbubble-outline" size={20} color={config.colors.primary} />
      </TouchableOpacity>
    );
  }, [styles, handleUserClick]);

  const renderRosterItem = useCallback(({ item }) => {
    const tabMeta = TABS.find(tab => tab.key === activeTab);
    return (
      <TouchableOpacity style={styles.userItem} onPress={() => handleUserClick(item)} activeOpacity={0.7}>
        <Image source={{ uri: item.avatar || DEFAULT_AVATAR }} style={styles.avatar} />
        <View style={styles.userInfo}>
          <Text style={styles.userName} numberOfLines={1}>{item.displayName || 'Unknown'}</Text>
          <View style={[styles.rolePill, { backgroundColor: tabMeta.color + '18' }]}>
            <Icon name={tabMeta.icon} size={10} color={tabMeta.color} />
            <Text style={[styles.rolePillText, { color: tabMeta.color }]}>{tabMeta.label}</Text>
          </View>
        </View>
        <Icon name="chatbubble-outline" size={20} color={config.colors.primary} />
      </TouchableOpacity>
    );
  }, [styles, handleUserClick, activeTab]);

  // ── Active state ──
  const activeData =
    activeTab === 'topRated' ? topRatedData :
    activeTab === 'trusted'  ? trustedData  :
    activeTab === 'cmsr'     ? cmsrData     :
    helperData;

  const activeRenderer = activeTab === 'topRated' ? renderTopRatedItem : renderRosterItem;
  const activeMeta = TABS.find(tab => tab.key === activeTab);

  const isLoggedOut = !user?.id;

  // RLS on user_identity / user_roles requires an authenticated request, so
  // logged-out users get zero rows back (no error). Show a clear sign-in CTA
  // rather than the generic "no users yet" message in that case.
  const emptyText = isLoggedOut
    ? 'Sign in to see the leaderboard'
    : activeTab === 'topRated' ? 'No users found with 3.7+ rating'
    : activeTab === 'trusted'  ? 'No trusted users yet'
    : activeTab === 'cmsr'     ? 'No CMSR users yet'
    : 'No helpers yet';

  const emptySubtext = isLoggedOut
    ? `Log in to view the ${activeMeta?.label || 'leaderboard'} list.`
    : activeTab === 'topRated' ? 'Leaderboard is updated daily'
    : null;

  return (
    <>
      <View style={styles.container}>
        {/* Tab bar */}
        <View style={[styles.tabBar, { borderBottomColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, isActive && { borderBottomColor: tab.color }]}
                onPress={() => switchTab(tab.key)}
                activeOpacity={0.7}
              >
                <Icon name={tab.icon} size={18} color={isActive ? tab.color : c.textMuted} />
                <Text style={[styles.tabLabel, { color: isActive ? tab.color : c.textMuted, fontWeight: isActive ? '700' : '500' }]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* List / loading / empty */}
        {loading && activeData.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={config.colors.primary} />
            <Text style={styles.loadingText}>Loading {activeMeta.label}...</Text>
          </View>
        ) : activeData.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Icon
              name={isLoggedOut ? 'log-in-outline' : activeMeta.icon}
              size={48}
              color={config.colors.primary}
            />
            <Text style={styles.emptyText}>{emptyText}</Text>
            {emptySubtext && (
              <Text style={styles.emptySubtext}>{emptySubtext}</Text>
            )}
          </View>
        ) : (
          <FlatList
            data={activeData}
            renderItem={activeRenderer}
            keyExtractor={(item) => item.userId}
            contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 16 }]}
            showsVerticalScrollIndicator={false}
            onEndReachedThreshold={0.5}
            onEndReached={() => {
              // Top Picks is a single Firestore doc (50 entries), not paginated.
              if (activeTab === 'trusted' || activeTab === 'cmsr' || activeTab === 'helper') loadMoreRoster(activeTab);
            }}
            ListFooterComponent={
              (activeTab === 'trusted' && trustedLoadingMore) ||
              (activeTab === 'cmsr' && cmsrLoadingMore) ||
              (activeTab === 'helper' && helperLoadingMore) ? (
                <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={config.colors.primary} />
                </View>
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={config.colors.primary}
              />
            }
          />
        )}

        {/* Cache info — Top Rated only */}
        {activeTab === 'topRated' && localState.leaderboardTop50?.lastFetched && !loading && (
          <Text style={styles.cacheInfo}>
            Last updated: {new Date(localState.leaderboardTop50.lastFetched).toLocaleDateString()}
          </Text>
        )}
      </View>

      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={() => setIsDrawerVisible(false)}
        startChat={handleStartChat}
        selectedUser={selectedUser}
        isOnline={false}
        bannedUsers={bannedUsers}
      />
    </>
  );
};

const getStyles = (isDarkMode, c) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: isDarkMode ? '#0f172a' : '#f2f2f7',
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    backgroundColor: isDarkMode ? '#0f172a' : '#fff',
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 13,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: c.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    marginTop: 12,
    fontSize: 16,
    color: c.textSecondary,
  },
  emptySubtext: {
    marginTop: 6,
    fontSize: 12,
    color: c.textMuted,
  },
  listContent: {
    padding: 8,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginVertical: 4,
    backgroundColor: isDarkMode ? '#2a2a2a' : '#f5f5f5',
    borderRadius: 12,
    marginHorizontal: 8,
  },
  rankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  rankText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 12,
    backgroundColor: isDarkMode ? '#333' : '#e0e0e0',
  },
  userInfo: {
    flex: 1,
    marginRight: 8,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: c.text,
    marginBottom: 4,
  },
  ratingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    fontSize: 12,
    color: c.textSecondary,
    marginLeft: 4,
  },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cacheInfo: {
    fontSize: 10,
    color: c.textMuted,
    textAlign: 'center',
    padding: 8,
  },
});

export default LeaderboardScreen;
