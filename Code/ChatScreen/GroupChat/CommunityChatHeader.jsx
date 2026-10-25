import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import { useNavigation } from '@react-navigation/native';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot } from '@react-native-firebase/firestore';
import { useChatBadges, acknowledgeDmBadge, acknowledgeGroupBadge } from '../chatBadgeStore';

// Red/green count bubble on a header button, pulsing while it shows.
const PulsingBadge = ({ label, color }) => {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={[styles.badge, { backgroundColor: color, transform: [{ scale: pulse }] }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </Animated.View>
  );
};

const countLabel = (n) => (n > 9 ? '9+' : n);

// The two unread badges read chatBadgeStore themselves, so a new message
// re-renders only the badge, not this header (and not ChatStack, which used
// to hold these counts in state).
const InboxBadge = () => {
  const { dm } = useChatBadges();
  if (dm <= 0) return null;
  return <PulsingBadge label={countLabel(dm)} color="#EF4444" />;
};

// "!" for pending invitations or join requests (prioritized), else the unread count.
const GroupsBadge = ({ hasPending }) => {
  const { group } = useChatBadges();
  if (!hasPending && group <= 0) return null;
  return <PulsingBadge label={hasPending ? '!' : countLabel(group)} color="#10B981" />;
};

const CommunityChatHeader = ({
  selectedTheme,
  triggerHapticFeedback,
  onOnlineUsersPress,
}) => {
  const { user, firestoreDB, theme, isAdmin } = useGlobalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [pendingGroupInvitationsCount, setPendingGroupInvitationsCount] = useState(0);
  const [pendingJoinRequestsCount, setPendingJoinRequestsCount] = useState(0);
  const isDarkMode = theme === 'dark';

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

  const hasPendingGroupItems = pendingGroupInvitationsCount > 0 || pendingJoinRequestsCount > 0;

  // ── Reusable Icon Button ──
  // `badge` is a static count; `badgeElement` a self-updating badge component.
  const Btn = ({ icon, bg, color, onPress, badge, badgeColor = '#EF4444', badgeElement, emoji }) => (
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
      {badgeElement || (badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: badgeColor }]}>
          <Text style={styles.badgeText}>{countLabel(badge)}</Text>
        </View>
      ) : null)}
    </TouchableOpacity>
  );

  if (!user?.id) return null;

  return (
    <View style={styles.container}>
      {/* 💬 Inbox */}
      <Btn
        icon="mail"
        bg="#8B5CF620"
        color="#8B5CF6"
        badgeElement={<InboxBadge />}
        onPress={() => {
          navigation.navigate('Inbox');
          // The badge now shows only what arrives after this tap.
          acknowledgeDmBadge();
        }}
      />

      {/* 👥 Groups */}
      <Btn
        icon="people"
        bg="#10B98118"
        color="#10B981"
        badgeElement={<GroupsBadge hasPending={hasPendingGroupItems} />}
        onPress={() => {
          navigation.navigate('Groups');
          acknowledgeGroupBadge();
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
