import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useLocalState } from '../../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { useOnlineStatus } from '../utils';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { mixpanel } from '../../AppHelper/MixPenel';
import { useGlobalState } from '../../GlobelStats';
import { ref, get, set } from '@react-native-firebase/database';
import { getRoblox, getRoles, getCosmetics } from '../../Supabase/userBackend';
import { getThemeColors } from '../../Helper/themeColors';
import UserBadgePill, { getFirstBadgeType } from '../../Helper/UserBadgePill';
import FramedAvatar from '../GroupChat/FramedAvatar';
import { getActiveCosmetics } from '../../Engagement/shopUtils';

const Badge = ({ icon, label, color }) => (
  <View style={[styles.badge, { backgroundColor: color }]}>
    <Icon name={icon} size={9} color="#fff" />
    <Text style={styles.badgeText}>{label}</Text>
  </View>
);

const PrivateChatHeader = React.memo(({ selectedUser, selectedTheme, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { updateLocalState } = useLocalState();
  const { t } = useTranslation();
  const { triggerHapticFeedback } = useHaptic();
  const { appdatabase, user, theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);

  const selectedUserId = selectedUser?.senderId || selectedUser?.id || null;

  // ✅ State for fetched user data (roblox username, etc.)
  const [userData, setUserData] = useState(null);
  const [activeCosmetics, setActiveCosmetics] = useState(null);

  // ✅ Memoize copyToClipboard
  const copyToClipboard = useCallback((code) => {
    if (!code || typeof code !== 'string') return;
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t("value.copy"), t('chat.copied_clipboard'));
    mixpanel.track("Code UserName", { UserName: code });
  }, [triggerHapticFeedback, t]);

  // ✅ Fetch user data from Firebase if roblox data is missing
  useEffect(() => {
    const selectedUserId = selectedUser?.senderId || selectedUser?.id;
    if (!selectedUserId || !appdatabase) return;

    // Only fetch if robloxUsername is not already in selectedUser
    if (selectedUser?.robloxUsername || selectedUser?.robloxUserId) {
      setUserData(null); // Clear fetched data if already in selectedUser
      return;
    }

    let isMounted = true;

    const fetchUserData = async () => {
      try {
        // Identity-like fields (roles, cosmetics, roblox) → Supabase.
        // Game state (lastGameWinAt) + profileFrame stay on RTDB.
        const [rolesRow, cosmeticsRow, robloxRow, lastGameWinAtSnap, profileFrameSnap] =
          await Promise.all([
            getRoles(selectedUserId).catch(() => null),
            getCosmetics(selectedUserId).catch(() => null),
            getRoblox(selectedUserId).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/lastGameWinAt`)).catch(() => null),
            get(ref(appdatabase, `users/${selectedUserId}/profileFrame`)).catch(() => null),
          ]);

        if (!isMounted) return;

        // Selective RTDB fallback — only fields whose Supabase table came back null.
        const missing = [];
        // RTDB stores admin under `admin` (legacy name); Supabase exposes it
        // as `isAdmin` via fromRolesRow. Use the correct RTDB leaf name in
        // the fallback so admin pills don't silently miss when the mirror
        // row is stale.
        if (!rolesRow)     missing.push('admin', 'isModerator', 'isTrusted', 'isCMSR', 'isHelper');
        if (!cosmeticsRow) missing.push('isPro');
        if (!robloxRow)    missing.push('robloxUsername', 'robloxUserId', 'robloxUsernameVerified');
        let fb = null;
        if (missing.length > 0) {
          const snaps = await Promise.all(
            missing.map((p) => get(ref(appdatabase, `users/${selectedUserId}/${p}`)).catch(() => null))
          );
          if (!isMounted) return;
          fb = {};
          missing.forEach((p, i) => { if (snaps[i] && snaps[i].exists()) fb[p] = snaps[i].val(); });
        }

        setUserData({
          robloxUsername:         robloxRow?.robloxUsername         ?? fb?.robloxUsername         ?? null,
          robloxUserId:           robloxRow?.robloxUserId           ?? fb?.robloxUserId           ?? null,
          robloxUsernameVerified: !!(robloxRow?.robloxUsernameVerified ?? fb?.robloxUsernameVerified),
          isPro:                  !!(cosmeticsRow?.isPro            ?? fb?.isPro),
          lastGameWinAt:          lastGameWinAtSnap?.exists() ? lastGameWinAtSnap.val() : null,
          isAdmin:                !!(rolesRow?.isAdmin              ?? fb?.admin),
          isModerator:            !!(rolesRow?.isModerator          ?? fb?.isModerator),
          isTrusted:              !!(rolesRow?.isTrusted            ?? fb?.isTrusted),
          isCMSR:                 !!(rolesRow?.isCMSR               ?? fb?.isCMSR),
          isHelper:               !!(rolesRow?.isHelper             ?? fb?.isHelper),
          profileFrame:           profileFrameSnap?.exists() ? profileFrameSnap.val() : null,
        });
      } catch (error) {
        console.error('Error fetching user data in PrivateChatHeader:', error);
        if (isMounted) setUserData(null);
      }
    };

    fetchUserData();

    // ✅ Fetch active cosmetics (full frame object with borderColors etc.)
    const fetchCosmetics = async () => {
      try {
        const cosmetics = await getActiveCosmetics(appdatabase, selectedUserId);
        if (isMounted) setActiveCosmetics(cosmetics);
      } catch { /* graceful fallback */ }
    };
    fetchCosmetics();

    return () => {
      isMounted = false;
    };
  }, [selectedUser?.senderId, selectedUser?.id, selectedUser?.robloxUsername, selectedUser?.robloxUserId, appdatabase]);

  // ✅ Merge selectedUser with fetched userData
  const mergedUser = useMemo(() => {
    if (!userData) return selectedUser;
    return {
      ...selectedUser,
      robloxUsername: selectedUser?.robloxUsername || userData.robloxUsername,
      robloxUserId: selectedUser?.robloxUserId || userData.robloxUserId,
      robloxUsernameVerified: selectedUser?.robloxUsernameVerified !== undefined
        ? selectedUser.robloxUsernameVerified
        : userData.robloxUsernameVerified,
      isPro: selectedUser?.isPro !== undefined ? selectedUser.isPro : userData.isPro,
      lastGameWinAt: selectedUser?.lastGameWinAt !== undefined
        ? selectedUser.lastGameWinAt
        : userData.lastGameWinAt,
      isAdmin: selectedUser?.isAdmin !== undefined ? selectedUser.isAdmin : userData.isAdmin,
      isModerator: selectedUser?.isModerator !== undefined ? selectedUser.isModerator : userData.isModerator,
      isTrusted: userData.isTrusted ?? selectedUser?.isTrusted ?? false,
      isCMSR: userData.isCMSR ?? selectedUser?.isCMSR ?? false,
      isHelper: userData.isHelper ?? selectedUser?.isHelper ?? false,
      profileFrame: selectedUser?.profileFrame || userData.profileFrame || null,
    };
  }, [selectedUser, userData]);

  // ✅ Memoize avatarUri and userName
  const avatarUri = useMemo(() =>
    mergedUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
    [mergedUser?.avatar]
  );

  const userName = useMemo(() =>
    mergedUser?.sender || t('chat.user'),
    [mergedUser?.sender]
  );

  const isOnline = useOnlineStatus(selectedUserId);

  const hasRecentWin = useMemo(() =>
    !!mergedUser?.hasRecentGameWin ||
    (typeof mergedUser?.lastGameWinAt === 'number' &&
      Date.now() - mergedUser.lastGameWinAt <= 24 * 60 * 60 * 1000),
    [mergedUser?.hasRecentGameWin, mergedUser?.lastGameWinAt]
  );

  // ✅ Check if user is banned with array validation
  const isBanned = useMemo(() => {
    const selectedUserId = mergedUser?.senderId || mergedUser?.id;
    if (!selectedUserId) return false;
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    return banned.includes(selectedUserId);
  }, [bannedUsers, mergedUser?.senderId, mergedUser?.id]);

  // ✅ Memoize handleBanToggle
  const handleBanToggle = useCallback(async () => {
    const selectedUserId = mergedUser?.senderId || mergedUser?.id;
    if (!selectedUserId) {
      console.warn('Invalid user ID for ban toggle');
      return;
    }

    const action = !isBanned ? t('chat.block_action') : t('chat.unblock_action');
    Alert.alert(
      `${action}`,
      `${t("chat.are_you_sure")} ${action.toLowerCase()} ${userName}?`,
      [
        { text: t("chat.cancel"), style: 'cancel' },
        {
          text: action,
          style: 'destructive',
          onPress: async () => {
            try {
              const currentBanned = Array.isArray(bannedUsers) ? bannedUsers : [];
              let updatedBannedUsers;

              if (isBanned) {
                updatedBannedUsers = currentBanned.filter(id => id !== selectedUserId);
              } else {
                updatedBannedUsers = [...currentBanned, selectedUserId];
              }

              if (updateLocalState && typeof updateLocalState === 'function') {
                await updateLocalState('bannedUsers', updatedBannedUsers);
              }

              if (user?.id && appdatabase) {
                const blockedRef = ref(appdatabase, `users/${user.id}/blocked_users/${selectedUserId}`);
                if (isBanned) {
                  await set(blockedRef, null);
                } else {
                  await set(blockedRef, true);
                }
              }
            } catch (error) {
              console.error('Error toggling ban status:', error);
            }
          },
        },
      ]
    );
  }, [isBanned, bannedUsers, mergedUser?.senderId, mergedUser?.id, userName, t, updateLocalState]);

  // ✅ Memoize drawer open handler
  const handleOpenDrawer = useCallback(() => {
    if (setIsDrawerVisible && typeof setIsDrawerVisible === 'function') {
      setIsDrawerVisible(true);
    }
  }, [setIsDrawerVisible]);

  return (
    <View style={styles.container}>
      {/* Avatar with online indicator */}
      <TouchableOpacity onPress={handleOpenDrawer} activeOpacity={0.7}>
        <FramedAvatar
          avatarUri={avatarUri}
          frame={activeCosmetics?.profileFrame || null}
          isDarkMode={isDarkMode}
          avatarSize={32}
          isOnline={isOnline}
        />
      </TouchableOpacity>

      {/* Name + badges + status */}
      <TouchableOpacity style={styles.infoContainer} onPress={handleOpenDrawer} activeOpacity={0.7}>
        {/* Top row: name + inline icons */}
        <View style={styles.nameRow}>
          <Text style={[styles.userName, { color: c.text }]} numberOfLines={1}>
            {userName}
          </Text>

          {mergedUser?.isPro && (
            <Image source={require('../../../assets/pro.png')} style={styles.inlineIcon} />
          )}
          {mergedUser?.robloxUsernameVerified && (
            <Image source={require('../../../assets/verification.png')} style={styles.inlineIcon} />
          )}
          {hasRecentWin && (
            <Image source={require('../../../assets/trophy.webp')} style={styles.inlineIcon} />
          )}

          <TouchableOpacity
            onPress={() => copyToClipboard(userName)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.copyBtn}
          >
            <Icon name="copy-outline" size={13} color={c.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Bottom row: status + role badges */}
        <View style={styles.metaRow}>
          <Text style={[styles.statusText, { color: isOnline ? '#22c55e' : c.textMuted }]}>
            {isOnline ? t('chat.online') : t('chat.offline')}
          </Text>

          {(() => {
            const firstBadge = getFirstBadgeType(mergedUser, ['admin', 'mod', 'trusted', 'cmsr', 'helper']);
            return (
              <>
                {mergedUser?.isAdmin && (
                  <UserBadgePill type="admin" size="sm" isDarkMode={isDarkMode} labelOverride={t('chat.admin')} glow={firstBadge === 'admin'} />
                )}
                {!mergedUser?.isAdmin && mergedUser?.isModerator && (
                  <UserBadgePill type="mod" size="sm" isDarkMode={isDarkMode} labelOverride={t('chat.mod')} glow={firstBadge === 'mod'} />
                )}
                {mergedUser?.isTrusted && (
                  <UserBadgePill type="trusted" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'trusted'} />
                )}
                {mergedUser?.isCMSR && (
                  <UserBadgePill type="cmsr" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'cmsr'} />
                )}
                {mergedUser?.isHelper && (
                  <UserBadgePill type="helper" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'helper'} />
                )}
              </>
            );
          })()}
        </View>
      </TouchableOpacity>

      {/* Block/Unblock button */}
      <TouchableOpacity
        onPress={handleBanToggle}
        activeOpacity={0.6}
        style={[
          styles.actionBtn,
          { backgroundColor: isBanned ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.08)' },
        ]}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        <Icon
          name={isBanned ? 'shield-checkmark-outline' : 'ban-outline'}
          size={18}
          color={isBanned ? '#22c55e' : '#ef4444'}
        />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    gap: 8,
  },
  avatarWrapper: {
    position: 'relative',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#0f172a',
  },
  onlineDotGlow: {
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 3,
    elevation: 3,
  },
  infoContainer: {
    flex: 1,
    justifyContent: 'center',
    gap: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  userName: {
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
    letterSpacing: -0.2,
  },
  inlineIcon: {
    width: 11,
    height: 11,
  },
  copyBtn: {
    padding: 2,
    marginLeft: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 5,
    gap: 2,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  actionBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default PrivateChatHeader;
