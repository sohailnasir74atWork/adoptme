import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import { useNavigation } from '@react-navigation/native';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot } from '@react-native-firebase/firestore';

const CommunityChatHeader = ({
  selectedTheme,
  unreadcount,
  setunreadcount,
  groupUnreadCount = 0,
  setGroupUnreadCount,
  triggerHapticFeedback,
  onOnlineUsersPress,
}) => {
  const { user, firestoreDB, theme, isAdmin, worldCupEnabled } = useGlobalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [pendingGroupInvitationsCount, setPendingGroupInvitationsCount] = useState(0);
  const [pendingJoinRequestsCount, setPendingJoinRequestsCount] = useState(0);
  const isDarkMode = theme === 'dark';
  const badgePulse = useRef(new Animated.Value(1)).current;

  // Badge pulse animation — only react to presence/absence, not exact count
  const hasNotif = unreadcount > 0 || pendingGroupInvitationsCount > 0 || groupUnreadCount > 0;
  useEffect(() => {
    if (hasNotif) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(badgePulse, { toValue: 1.3, duration: 600, useNativeDriver: true }),
          Animated.timing(badgePulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [hasNotif]);

  // Listen to pending group invitations
  useEffect(() => {
    if (!firestoreDB || !user?.id) {
      setPendingGroupInvitationsCount(0);
      return;
    }

    const invitationsQuery = query(
      collection(firestoreDB, 'group_invitations'),
      where('invitedUserId', '==', user.id),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(
      invitationsQuery,
      (snapshot) => {
        const now = Date.now();
        let validCount = 0;
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.expiresAt && now < data.expiresAt) validCount++;
          else if (!data.expiresAt) validCount++;
        });
        setPendingGroupInvitationsCount(validCount);
      },
      () => setPendingGroupInvitationsCount(0)
    );

    return () => unsubscribe();
  }, [firestoreDB, user?.id]);

  // Listen to pending join requests
  useEffect(() => {
    if (!firestoreDB || !user?.id) {
      setPendingJoinRequestsCount(0);
      return;
    }

    const joinRequestsQuery = query(
      collection(firestoreDB, 'group_join_requests'),
      where('creatorId', '==', user.id),
      where('status', '==', 'pending')
    );

    const unsubscribe = onSnapshot(
      joinRequestsQuery,
      (snapshot) => setPendingJoinRequestsCount(snapshot.size),
      () => setPendingJoinRequestsCount(0)
    );

    return () => unsubscribe();
  }, [firestoreDB, user?.id]);

  const groupBadge = (pendingGroupInvitationsCount > 0 || pendingJoinRequestsCount > 0)
    ? '!'
    : (groupUnreadCount > 0 ? groupUnreadCount : 0);

  // ── Reusable Icon Button ──
  const Btn = ({ icon, bg, color, onPress, badge, badgeColor = '#EF4444', animated, emoji }) => (
    <TouchableOpacity
      onPress={() => {
        onPress();
        triggerHapticFeedback?.('impactLight');
      }}
      activeOpacity={0.7}
      style={styles.iconBtn}
    >
      <View style={[styles.iconCircle, { backgroundColor: bg }]}>
        {emoji ? (
          <Text style={{ fontSize: 15 }}>{emoji}</Text>
        ) : (
          <Icon name={icon} size={18} color={color} />
        )}
      </View>
      {badge > 0 || badge === '!' ? (
        <Animated.View
          style={[
            styles.badge,
            { backgroundColor: badgeColor },
            animated ? { transform: [{ scale: badgePulse }] } : {},
          ]}
        >
          <Text style={styles.badgeText}>{typeof badge === 'number' ? (badge > 9 ? '9+' : badge) : badge}</Text>
        </Animated.View>
      ) : null}
    </TouchableOpacity>
  );

  if (!user?.id) return null;

  return (
    <View style={styles.container}>
      {/* ⚽ World Cup — entry point (hidden by the kill switch) */}
      {worldCupEnabled && (
        <Btn
          emoji="⚽"
          bg="#16A34A18"
          color="#16A34A"
          badge={0}
          onPress={() => navigation.navigate('More')}
        />
      )}

      {/* 💬 Inbox */}
      <Btn
        icon="mail"
        bg="#8B5CF620"
        color="#8B5CF6"
        badge={unreadcount}
        badgeColor="#EF4444"
        animated
        onPress={() => {
          navigation.navigate('Inbox');
        }}
      />

      {/* 👥 Groups */}
      <Btn
        icon="people"
        bg="#10B98118"
        color="#10B981"
        badge={groupBadge}
        badgeColor="#10B981"
        animated
        onPress={() => {
          navigation.navigate('Groups');
        }}
      />

      {/* 🟢 Online Users */}
      <Btn
        icon="globe-outline"
        bg="#22C55E15"
        color="#22C55E"
        badge={0}
        onPress={() => {
          if (onOnlineUsersPress) onOnlineUsersPress();
        }}
      />

      {/* 🛡️ Admin (only for admins/mods) */}
      {(isAdmin || user?.isModerator) && (
        <Btn
          icon="shield-checkmark"
          bg="#3B82F618"
          color="#3B82F6"
          badge={0}
          onPress={() => navigation.navigate('AdminDashboard')}
        />
      )}

      {/* 🚫 Blocked Users — subtle, last */}
      <Btn
        icon="ban-outline"
        bg={isDarkMode ? '#37415120' : '#F3F4F6'}
        color={isDarkMode ? '#6B7280' : '#9CA3AF'}
        badge={0}
        onPress={() => navigation.navigate('BlockedUsers')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    // paddingVertical: 5,
    gap: 7,
    marginRight: 2,
    overflow: 'visible',
    // minHeight: 50,
    justifyContent: 'center',
    // flex: 1
  },
  iconBtn: {
    position: 'relative',
    padding: 6,
    overflow: 'visible',
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    borderRadius: 7,
    minWidth: 14,
    height: 14,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
  },
});

export default React.memo(CommunityChatHeader);
