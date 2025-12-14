import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useLocalState } from '../../LocalGlobelStats';
import { useTranslation } from 'react-i18next';
import { isUserOnline } from '../utils';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { mixpanel } from '../../AppHelper/MixPenel';

const PrivateChatHeader = React.memo(({ selectedUser, selectedTheme, bannedUsers, isDrawerVisible, setIsDrawerVisible }) => {
  const { updateLocalState } = useLocalState();
  const { t } = useTranslation();
  const [isOnline, setIsOnline] = useState(false); // ✅ Add state to store online status
  const { triggerHapticFeedback } = useHaptic();

  // ✅ Memoize copyToClipboard
  const copyToClipboard = useCallback((code) => {
    if (!code || typeof code !== 'string') return;
    triggerHapticFeedback('impactLight');
    Clipboard.setString(code);
    showSuccessMessage(t("value.copy"), "Copied to Clipboard");
    mixpanel.track("Code UserName", { UserName: code });
  }, [triggerHapticFeedback, t]);

  // ✅ Memoize avatarUri and userName
  const avatarUri = useMemo(() => 
    selectedUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
    [selectedUser?.avatar]
  );
  
  const userName = useMemo(() => 
    selectedUser?.sender || 'User',
    [selectedUser?.sender]
  );

  useEffect(() => {
    if (selectedUser?.senderId) {
      isUserOnline(selectedUser.senderId)
        .then(setIsOnline)
        .catch(() => setIsOnline(false));
    } else {
      setIsOnline(false);
    }
  }, [selectedUser?.senderId]); // ✅ Fixed: use senderId instead of id

  // ✅ Check if user is banned with array validation
  const isBanned = useMemo(() => {
    if (!selectedUser?.senderId) return false;
    const banned = Array.isArray(bannedUsers) ? bannedUsers : [];
    return banned.includes(selectedUser.senderId);
  }, [bannedUsers, selectedUser?.senderId]);

  // ✅ Memoize handleBanToggle
  const handleBanToggle = useCallback(async () => {
    if (!selectedUser?.senderId) {
      console.warn('⚠️ Invalid user ID for ban toggle');
      return;
    }

    const action = !isBanned ? 'Block' : 'Unblock';
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
                // 🔹 Unban: Remove from bannedUsers
                updatedBannedUsers = currentBanned.filter(id => id !== selectedUser.senderId);
              } else {
                // 🔹 Ban: Add to bannedUsers
                updatedBannedUsers = [...currentBanned, selectedUser.senderId];
              }

              // ✅ Update local storage & state
              if (updateLocalState && typeof updateLocalState === 'function') {
                await updateLocalState('bannedUsers', updatedBannedUsers);
              }
            } catch (error) {
              console.error('❌ Error toggling ban status:', error);
            }
          },
        },
      ]
    );
  }, [isBanned, bannedUsers, selectedUser?.senderId, userName, t, updateLocalState]);

  // ✅ Memoize drawer open handler
  const handleOpenDrawer = useCallback(() => {
    if (setIsDrawerVisible && typeof setIsDrawerVisible === 'function') {
      setIsDrawerVisible(true);
    }
  }, [setIsDrawerVisible]);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={handleOpenDrawer}>
        <Image source={{ uri: avatarUri }} style={styles.avatar} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.infoContainer} onPress={handleOpenDrawer}>
        <Text style={[styles.userName, { color: selectedTheme?.colors?.text || '#000' }]}>
          {userName} 
          {selectedUser?.isPro && (
            <Image
              source={require('../../../assets/pro.png')} 
              style={{ width: 14, height: 14 }} 
            />
          )}
          {'  '}
          <Icon 
            name="copy-outline" 
            size={16} 
            color="#007BFF" 
            onPress={() => copyToClipboard(userName)}
          />
        </Text>
        <Text style={[
                    styles.drawerSubtitleUser,
                    {
                      color: !isOnline
                        ? config.colors.hasBlockGreen
                        : config.colors.wantBlockRed,
                      fontSize: 10,
                      marginTop: 2,
                    },
                  ]}
                >
          {isOnline ? 'Online' : 'Offline'}
        </Text>
        
      </TouchableOpacity>
      <TouchableOpacity onPress={handleBanToggle}>
        <Icon
          name={isBanned ? 'shield-checkmark-outline' : 'ban-outline'}
          size={24}
          color={isBanned ? config.colors.hasBlockGreen : config.colors.wantBlockRed}
          style={styles.banIcon}
        />
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    // backgroundColor:'red'
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: 'white',
  },
  infoContainer: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontFamily: 'Lato-Bold',
  },
  banIcon: {
    marginLeft: 10,
  },
});

export default PrivateChatHeader;
