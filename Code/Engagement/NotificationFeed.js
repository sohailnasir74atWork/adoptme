import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, Image, RefreshControl, Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useGlobalState } from '../GlobelStats';
import { useTranslation } from 'react-i18next';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import config from '../Helper/Environment';
import {
  collection, query, where, orderBy, limit, getDocs,
  doc, updateDoc, writeBatch, startAfter, Timestamp, deleteDoc,
} from '@react-native-firebase/firestore';
import { ref, get, set } from '@react-native-firebase/database';

dayjs.extend(relativeTime);

const NOTIF_ICONS = {
  trade_accepted: { icon: 'checkmark-circle', color: '#10B981', emoji: '🤝' },
  trade_ping: { icon: 'notifications', color: '#3B82F6', emoji: '📢' },
};

const PAGE_SIZE = 20;

const NotificationFeed = () => {
  const { user, theme, firestoreDB, appdatabase } = useGlobalState();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const isDarkMode = theme === 'dark';

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [muted, setMuted] = useState(false);
  const hasMarkedRead = useRef(false);

  const textColor = isDarkMode ? '#f1f5f9' : '#1a1a2e';
  const subtextColor = isDarkMode ? '#94a3b8' : '#64748b';
  const cardBg = isDarkMode ? '#1e293b' : '#ffffff';
  const bgColor = isDarkMode ? '#0f172a' : '#f8fafc';

  const fetchNotifications = useCallback(async (isRefresh = false) => {
    if (!user?.id || !firestoreDB) return;

    try {
      if (isRefresh) {
        setRefreshing(true);
        setLastDoc(null);
      } else if (!isRefresh && !loading) {
        setLoading(true);
      }

      let q = query(
        collection(firestoreDB, 'notifications'),
        where('toUid', '==', user.id),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      );

      if (!isRefresh && lastDoc) {
        q = query(
          collection(firestoreDB, 'notifications'),
          where('toUid', '==', user.id),
          orderBy('createdAt', 'desc'),
          startAfter(lastDoc),
          limit(PAGE_SIZE),
        );
      }

      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

      if (isRefresh) {
        setNotifications(items);
      } else {
        setNotifications(prev => [...prev, ...items]);
      }

      setLastDoc(snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null);
      setHasMore(snap.docs.length >= PAGE_SIZE);
    } catch (e) {
      console.warn('[NotificationFeed] Error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id, firestoreDB, lastDoc, loading]);

  // Load on focus
  useFocusEffect(
    useCallback(() => {
      hasMarkedRead.current = false; // allow re-mark on next focus
      fetchNotifications(true);
      // Load mute preference
      if (user?.id && appdatabase) {
        get(ref(appdatabase, `users/${user.id}/muteTradeNotifs`)).then(snap => {
          setMuted(snap.exists() ? !!snap.val() : false);
        }).catch(() => {});
      }
    }, [user?.id, firestoreDB, appdatabase])
  );

  // Mark as read ONCE after notifications load (avoids extra Firestore query)
  useEffect(() => {
    if (hasMarkedRead.current || !user?.id || !firestoreDB) return;
    const unreadItems = notifications.filter(n => !n.read);
    if (unreadItems.length === 0) return;
    hasMarkedRead.current = true;
    // Fire-and-forget: mark only the unread items we already fetched
    (async () => {
      try {
        const batch = writeBatch(firestoreDB);
        unreadItems.forEach(n => batch.update(doc(firestoreDB, 'notifications', n.id), { read: true }));
        await batch.commit();
      } catch (e) {
        console.warn('[NotificationFeed] Mark read error:', e?.message);
      }
    })();
  }, [notifications, user?.id, firestoreDB]);

  const handleEndReached = useCallback(() => {
    if (hasMore && !loading && !refreshing) {
      fetchNotifications(false);
    }
  }, [hasMore, loading, refreshing, fetchNotifications]);

  const handleNotifPress = useCallback((item) => {
    if (item.type === 'trade_accepted' || item.type === 'trade_ping') {
      navigation.navigate('MyStuffScreen', { initialTab: 'active' });
    }
  }, [navigation]);

  // Delete single notification
  const handleDelete = useCallback(async (notifId) => {
    try {
      await deleteDoc(doc(firestoreDB, 'notifications', notifId));
      setNotifications(prev => prev.filter(n => n.id !== notifId));
    } catch (e) {
      console.warn('[NotificationFeed] Delete error:', e?.message);
    }
  }, [firestoreDB]);

  // Clear all notifications
  const handleClearAll = useCallback(() => {
    if (notifications.length === 0) return;
    Alert.alert(
      t('notifications.clear_title', { defaultValue: 'Clear All' }),
      t('notifications.clear_confirm', { defaultValue: 'Delete all notifications? This cannot be undone.' }),
      [
        { text: t('notifications.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('notifications.clear', { defaultValue: 'Clear' }),
          style: 'destructive',
          onPress: async () => {
            setClearing(true);
            try {
              // Delete in batches of 500 (Firestore batch limit)
              const q = query(
                collection(firestoreDB, 'notifications'),
                where('toUid', '==', user.id),
                limit(500),
              );
              const snap = await getDocs(q);
              if (snap.docs.length > 0) {
                const batch = writeBatch(firestoreDB);
                snap.docs.forEach(d => batch.delete(d.ref));
                await batch.commit();
              }
              setNotifications([]);
              setLastDoc(null);
              setHasMore(false);
            } catch (e) {
              console.warn('[NotificationFeed] Clear all error:', e?.message);
            } finally {
              setClearing(false);
            }
          },
        },
      ],
    );
  }, [notifications.length, firestoreDB, user?.id, t]);

  const renderNotification = useCallback(({ item }) => {
    const meta = NOTIF_ICONS[item.type] || NOTIF_ICONS.trade_accepted;
    const timeAgo = item.createdAt?.toDate ? dayjs(item.createdAt.toDate()).fromNow() : '';
    const isUnread = !item.read;

    return (
      <TouchableOpacity
        style={[
          styles.notifCard,
          { backgroundColor: cardBg },
          isUnread && { borderLeftWidth: 3, borderLeftColor: meta.color },
        ]}
        onPress={() => handleNotifPress(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.notifIcon, { backgroundColor: meta.color + '18' }]}>
          <Text style={{ fontSize: 20 }}>{meta.emoji}</Text>
        </View>
        <View style={styles.notifContent}>
          <Text style={[styles.notifMessage, { color: textColor }]} numberOfLines={2}>
            {item.message}
          </Text>
          <Text style={[styles.notifTime, { color: subtextColor }]}>{timeAgo}</Text>
        </View>
        <TouchableOpacity
          onPress={() => handleDelete(item.id)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.deleteBtn}
        >
          <Icon name="trash-outline" size={16} color={subtextColor} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }, [cardBg, textColor, subtextColor, handleNotifPress, handleDelete]);

  if (!user?.id) {
    return (
      <View style={[styles.emptyWrap, { backgroundColor: bgColor }]}>
        <Text style={{ fontSize: 40 }}>🔔</Text>
        <Text style={[styles.emptyTitle, { color: textColor }]}>
          {t('notifications.sign_in', { defaultValue: 'Sign in to see notifications' })}
        </Text>
      </View>
    );
  }

   return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Mute toggle + Clear All header bar */}
      <View style={[styles.clearBar, { borderBottomColor: isDarkMode ? '#1e293b' : '#e2e8f0' }]}>
        <TouchableOpacity
          onPress={async () => {
            const newVal = !muted;
            setMuted(newVal);
            try {
              await set(ref(appdatabase, `users/${user.id}/muteTradeNotifs`), newVal);
            } catch (e) {
              setMuted(!newVal);
            }
          }}
          style={styles.muteBtn}
          activeOpacity={0.7}
        >
          <Icon name={muted ? 'notifications-off' : 'notifications'} size={14} color={muted ? '#EF4444' : '#10B981'} />
          <Text style={{ fontSize: 12, fontWeight: '600', color: muted ? '#EF4444' : '#10B981' }}>
            {muted
              ? t('notifications.muted', { defaultValue: 'Push Muted' })
              : t('notifications.push_on', { defaultValue: 'Push On' })}
          </Text>
        </TouchableOpacity>
        {notifications.length > 0 && (
          <TouchableOpacity
            onPress={handleClearAll}
            disabled={clearing}
            style={styles.clearAllBtn}
            activeOpacity={0.7}
          >
            {clearing ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <>
                <Icon name="trash-outline" size={14} color="#EF4444" />
                <Text style={styles.clearAllText}>{t('notifications.clear_all', { defaultValue: 'Clear All' })}</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
      <FlatList
        data={notifications}
        keyExtractor={item => item.id}
        renderItem={renderNotification}
        contentContainerStyle={{ paddingBottom: 20, paddingHorizontal: 12, paddingTop: 8 }}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchNotifications(true)}
            tintColor={config.colors.primary}
          />
        }
        ListEmptyComponent={
          !loading && (
            <View style={styles.emptyWrap}>
              <Text style={{ fontSize: 40 }}>🔔</Text>
              <Text style={[styles.emptyTitle, { color: textColor }]}>
                {t('notifications.empty_title', { defaultValue: 'No notifications yet' })}
              </Text>
              <Text style={[styles.emptySub, { color: subtextColor }]}>
                {t('notifications.empty_sub', { defaultValue: 'When someone accepts your trade or pings you, it will show up here.' })}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loading && notifications.length > 0 ? (
            <ActivityIndicator size="small" color={config.colors.primary} style={{ padding: 16 }} />
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  notifCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 6,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  clearBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  clearBarCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  clearAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  muteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearAllText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#EF4444',
  },
  deleteBtn: {
    padding: 6,
  },
  notifIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifContent: {
    flex: 1,
    gap: 2,
  },
  notifMessage: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  notifTime: {
    fontSize: 11,
    fontWeight: '500',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 32,
  },
});

export default React.memo(NotificationFeed);
