import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,

} from 'react-native';
import { get, ref, set } from '@react-native-firebase/database';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useLocalState } from '../../LocalGlobelStats';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import { useTranslation } from 'react-i18next';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import FramedAvatar from '../GroupChat/FramedAvatar';


const BlockedUsersScreen = () => {
  const { user, theme, appdatabase } = useGlobalState();
  const { localState, updateLocalState } = useLocalState();
  const { t } = useTranslation();


  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode, c), [isDarkMode]);

  const [blockedUsers, setBlockedUsers] = useState([]);

  useEffect(() => {
    let isMounted = true;

    const fetchBlockedUsers = async () => {
      if (!user?.id || !appdatabase) {
        console.warn('⚠️ Missing required data: user ID or database instance');
        return;
      }

      try {
        const bannedUserIds = Array.isArray(localState?.bannedUsers)
          ? localState.bannedUsers
          : [];

        if (bannedUserIds.length === 0) {
          if (isMounted) {
            setBlockedUsers([]);
          }
          return;
        }

        // ✅ OPTIMIZED: Fetch only displayName and avatar instead of full user objects
        const userDetailsPromises = bannedUserIds.map(async (id) => {
          if (!id) return null;

          try {
            // ✅ Fetch only the fields we need (parallel requests to specific child paths)
            const [displayNameSnap, avatarSnap, profileFrameSnap] = await Promise.all([
              get(ref(appdatabase, `users/${id}/displayName`)).catch(() => null),
              get(ref(appdatabase, `users/${id}/avatar`)).catch(() => null),
              get(ref(appdatabase, `users/${id}/profileFrame`)).catch(() => null),
            ]);

            // ✅ Check if user exists (if no displayName and no avatar, user likely doesn't exist)
            if (!displayNameSnap?.exists() && !avatarSnap?.exists()) {
              return null;
            }

            return {
              id,
              displayName: displayNameSnap?.exists() ? (displayNameSnap.val()?.trim() || t('chat.anonymous')) : t('chat.anonymous'),
              avatar: avatarSnap?.exists() ? (avatarSnap.val()?.trim() || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png')
                : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
              profileFrame: profileFrameSnap?.exists() ? profileFrameSnap.val() : null,
            };
          } catch (error) {
            console.error(`❌ Error fetching user ${id}:`, error);
            return null;
          }
        });

        const resolvedUsers = await Promise.all(userDetailsPromises);
        const validUsers = resolvedUsers.filter(user => user !== null);

        if (isMounted) {
          setBlockedUsers(validUsers);
        }
      } catch (error) {
        console.error("❌ Error in fetchBlockedUsers:", error);
        if (isMounted) {
          setBlockedUsers([]);
        }
      }
    };

    fetchBlockedUsers();

    return () => {
      isMounted = false;
    };
  }, [user?.id, localState?.bannedUsers, appdatabase]);
  // ✅ Memoize handleUnblockUser
  const handleUnblockUser = useCallback(async (selectedUserId) => {
    // ✅ Safety check
    if (!selectedUserId) {
      console.error('❌ Invalid user ID for unblock');
      return;
    }

    try {
      const currentBanned = Array.isArray(localState?.bannedUsers) ? localState.bannedUsers : [];
      const updatedBannedUsers = currentBanned.filter(id => id !== selectedUserId);

      // ✅ Update Local Storage
      if (updateLocalState && typeof updateLocalState === 'function') {
        await updateLocalState('bannedUsers', updatedBannedUsers);
      }

      // ✅ Sync unblock to RTDB (remove from blocked_users)
      if (user?.id && appdatabase) {
        const blockedRef = ref(appdatabase, `users/${user.id}/blocked_users/${selectedUserId}`);
        await set(blockedRef, null);
      }

      // ✅ Update UI immediately
      setBlockedUsers(prevBlockedUsers => {
        if (!Array.isArray(prevBlockedUsers)) return [];
        return prevBlockedUsers.filter((blockedUser) => blockedUser?.id !== selectedUserId);
      });

      // ✅ Show Alert
      showSuccessMessage(t("home.alert.success"), t("chat.user_unblocked"));
    } catch (error) {
      console.error('❌ Error unblocking user:', error);
    }
  }, [localState?.bannedUsers, updateLocalState, t]);

  // ✅ Memoize renderBlockedUser
  const renderBlockedUser = useCallback(({ item }) => {
    // ✅ Safety checks
    if (!item || typeof item !== 'object') return null;

    const avatar = item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
    const displayName = item.displayName || t('chat.anonymous');
    const userId = item.id;

    if (!userId) return null;

    return (
      <View style={styles.userContainer}>
        <View style={{ marginRight: 10 }}>
          <FramedAvatar
            avatarUri={avatar}
            frame={item.profileFrame || null}
            isDarkMode={isDarkMode}
            avatarSize={50}
          />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.userName}>{displayName}</Text>
          <TouchableOpacity
            style={styles.unblockButton}
            onPress={() => handleUnblockUser(userId)}
          >
            <Icon name="person-remove-outline" size={20} color={c.text} />
            <Text style={styles.unblockText}>{t("chat.unblock")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }, [styles, isDarkMode, handleUnblockUser, t]);

  return (
    <View style={styles.container}>
      {blockedUsers.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>{t("chat.no_user_blocked")}</Text>
        </View>
      ) : (
        <FlatList
          data={blockedUsers}
          keyExtractor={(item, index) => item?.id || `blocked-${index}`}
          renderItem={renderBlockedUser}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={true}
          maxToRenderPerBatch={10}
          windowSize={10}
        />
      )}
    </View>
  );
};

export const getStyles = (isDarkMode, c) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#0f172a' : '#f2f2f7',
      padding: 10,
    },
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 16,
      color: c.text,
      textAlign: 'center',
    },
    userContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 15,
      padding: 10,
      backgroundColor: config.colors.card,
      borderRadius: 10,
      borderBottomWidth: 1,
      borderColor: c.text,
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      marginRight: 10,
      backgroundColor: 'white',
    },
    textContainer: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    userName: {
      fontSize: 16,
      color: c.text,
    },
    unblockButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: config.colors.danger,
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 5,
    },
    unblockText: {
      marginLeft: 5,
      color: c.text,
      fontSize: 14,
    },
  });

export default BlockedUsersScreen;
