// GlobalInviteToast.jsx — Global banner for game invites with Accept/Decline
// Shows game invites on any screen. Navigates to the correct game screen on accept.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Image, Animated, StyleSheet, ActivityIndicator,
  Platform,
} from 'react-native';
import { useGlobalState } from '../../../GlobelStats';
import {
  listenToUserInvites,
  acceptGameInvite,
  declineGameInvite,
} from '../utils/gameInviteSystem';
import { showSuccessMessage, showErrorMessage } from '../../../Helper/MessageHelper';
import { navigate } from '../../../Helper/navigationService';

const TOAST_DURATION = 20000; // 20 seconds

const GlobalInviteToast = () => {
  const {
    firestoreDB, user, theme, isInActiveGame,
    setAcceptedInviteRoom,
  } = useGlobalState();
  const isDarkMode = theme === 'dark';

  const [invite, setInvite] = useState(null);   // current invite to show
  const [busy, setBusy] = useState(false);       // accepting/declining
  const slideY = useRef(new Animated.Value(-200)).current;
  const lastIdRef = useRef(null);
  const timerRef = useRef(null);

  // ── Listen for pending invites ──
  useEffect(() => {
    if (!firestoreDB || !user?.id || isInActiveGame) {
      hide();
      return;
    }

    const unsub = listenToUserInvites(firestoreDB, user.id, (invites) => {
      if (!invites.length) { hide(); return; }

      const now = Date.now();
      const valid = invites.filter(i => {
        const exp = i.expiresAt || ((i.timestamp || now) + 30000);
        return now < exp && i.status === 'pending';
      });
      if (!valid.length) { hide(); return; }

      const latest = valid[0];
      const key = `${latest.roomId}_${latest.timestamp}`;
      if (key === lastIdRef.current) return; // same invite already showing

      lastIdRef.current = key;
      setInvite(latest);
      show();

      // Auto-dismiss after TOAST_DURATION
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => hide(), TOAST_DURATION);
    });

    return () => {
      unsub();
      clearTimeout(timerRef.current);
    };
  }, [firestoreDB, user?.id, isInActiveGame]);

  // ── Animations ──
  const show = () => {
    Animated.spring(slideY, {
      toValue: 0, useNativeDriver: true, tension: 50, friction: 9,
    }).start();
  };
  const hide = () => {
    Animated.timing(slideY, {
      toValue: -200, duration: 250, useNativeDriver: true,
    }).start(() => {
      setInvite(null);
      lastIdRef.current = null;
    });
  };

  // ── Accept ──
  const handleAccept = useCallback(async () => {
    if (!invite || busy || !firestoreDB || !user?.id) return;
    setBusy(true);
    try {
      const result = await acceptGameInvite(firestoreDB, invite.roomId, user.id, {
        displayName: user.displayName || 'Anonymous',
        avatar: user.avatar || null,
      });
      if (result.success) {
        const gameType = result.gameType || 'petGuessing';
        setAcceptedInviteRoom({ roomId: invite.roomId, gameType });

        // Navigate to the correct game screen
        const screenMap = {
          quiz: 'QuizBattleScreen',
          tradeShowdown: 'TradeShowdownScreen',
          petGuessing: 'GameHub',
        };
        const targetScreen = screenMap[gameType] || 'GameHub';

        hide();
        navigate(targetScreen);
      } else {
        showErrorMessage('Cannot Join', result.error || 'Failed to join');
      }
    } catch (e) {
      showErrorMessage('Error', 'Failed to join game');
    } finally {
      setBusy(false);
    }
  }, [invite, busy, firestoreDB, user]);

  // ── Decline ──
  const handleDecline = useCallback(async () => {
    if (!invite || busy || !firestoreDB || !user?.id) return;
    setBusy(true);
    try {
      await declineGameInvite(firestoreDB, invite.roomId, user.id);
    } catch {}
    setBusy(false);
    hide();
  }, [invite, busy, firestoreDB, user]);

  if (!invite) return null;

  const bg = isDarkMode ? '#1e293b' : '#fff';
  const txt = isDarkMode ? '#f1f5f9' : '#111';
  const sub = isDarkMode ? '#94a3b8' : '#64748b';

  return (
    <Animated.View style={[styles.wrap, { transform: [{ translateY: slideY }] }]}>
      <View style={[styles.card, { backgroundColor: bg }]}>

        {/* Top row: avatar + invite text */}
        <View style={styles.topRow}>
          <Image
            source={{ uri: invite.fromUserAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
            style={styles.avatar}
          />
          <View style={styles.info}>
            <Text style={[styles.title, { color: txt }]}>
              🎮 Game Invite!
            </Text>
            <Text style={[styles.sub, { color: sub }]} numberOfLines={1}>
              {invite.fromUserName || 'Someone'} wants to play with you
            </Text>
          </View>
        </View>

        {/* Bottom row: Accept / Decline buttons */}
        {busy ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#8B5CF6" />
            <Text style={[styles.loadingText, { color: sub }]}>Joining game...</Text>
          </View>
        ) : (
          <View style={styles.btns}>
            <TouchableOpacity style={styles.declineBtn} onPress={handleDecline} activeOpacity={0.7}>
              <Text style={styles.declineBtnText}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} activeOpacity={0.7}>
              <Text style={styles.acceptBtnText}>Accept ✓</Text>
            </TouchableOpacity>
          </View>
        )}

      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 42,
    left: 12,
    right: 12,
    zIndex: 9999,
  },
  card: {
    borderRadius: 18,
    padding: 16,
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(139, 92, 246, 0.25)',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2.5,
    borderColor: '#8B5CF6',
  },
  info: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '800' },
  sub: { fontSize: 13, marginTop: 2, fontWeight: '500' },
  btns: {
    flexDirection: 'row',
    gap: 10,
  },
  acceptBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  acceptBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  declineBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtnText: {
    color: '#EF4444',
    fontSize: 15,
    fontWeight: '700',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

export default GlobalInviteToast;
