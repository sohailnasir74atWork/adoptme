import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useGlobalState } from '../../GlobelStats';
import { useNavigation } from '@react-navigation/native';
import config from '../../Helper/Environment';
import { useTranslation } from 'react-i18next';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { useHaptic } from '../../Helper/HepticFeedBack';
import PetGuessingGameScreen from '../../ValuesScreen/PetGuessingGame/PetGuessingGameScreen';
import { Platform } from 'react-native';

const CommunityChatHeader = ({
  selectedTheme,
  onlineMembersCount,
  unreadcount,
  setunreadcount,
  triggerHapticFeedback,
  onOnlineUsersPress,
}) => {
  const { user } = useGlobalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [gameModalVisible, setGameModalVisible] = useState(false);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 , }}>
      {user?.id && (
        <>
          {/* Online Users Button */}
          <TouchableOpacity
            onPress={() => {
              if (onOnlineUsersPress) {
                onOnlineUsersPress();
              }
              triggerHapticFeedback('impactLight');
            }}
            style={{ position: 'relative', padding: 8, marginRight: 4 }}
          >
            <Icon
              name="people-outline"
              size={24}
              color={config.colors.primary}
            />
            {onlineMembersCount > 0 && (
              <View style={{ position: 'absolute', top: 4, right: 4, backgroundColor: '#10B981', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#fff', fontSize: 8, fontFamily: 'Lato-Bold' }}>
                  {onlineMembersCount > 999 ? '1k+' : onlineMembersCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Pet Guessing Game Button */}
          <TouchableOpacity
            onPress={() => {
              setGameModalVisible(true);
              triggerHapticFeedback?.('impactLight');
            }}
            style={{ position: 'relative', padding: 8, marginRight: 4 }}
          >
            <Icon
              name="game-controller-outline"
              size={24}
              color={config.colors.primary}
            />
          </TouchableOpacity>

          {/* Inbox Button */}
          <TouchableOpacity
            onPress={() => {
              navigation.navigate('Inbox');
              triggerHapticFeedback('impactLight');
              setunreadcount(0);
            }}
            style={{ position: 'relative', padding: 8, marginRight: 4 }}
          >
            <Icon
              name="chatbox-outline"
              size={24}
              color={selectedTheme.colors.text}
            />
            {unreadcount > 0 && (
              <View style={{ position: 'absolute', top: 4, right: 4, backgroundColor: 'red', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}>
                <Text style={{ color: '#fff', fontSize: 8, fontFamily: 'Lato-Bold' }}>
                  {unreadcount > 9 ? '9+' : unreadcount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </>
      )}
      {user?.id && (
        <Menu>
          <MenuTrigger>
            <View style={{ padding: 8 }}>
              <Icon name="ellipsis-vertical-outline" size={24} color={config.colors.primary} />
            </View>
          </MenuTrigger>
          <MenuOptions
            customStyles={{
              optionsContainer: {
                marginTop: 8,
                borderRadius: 8,
                width: 220,
                padding: 5,
                backgroundColor: config.colors.background || '#fff',
              },
            }}
          >
            <MenuOption onSelect={() => navigation?.navigate('BlockedUsers')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', padding: 10 }}>
                <Icon name="ban-outline" size={20} color={config.colors.primary} style={{ marginRight: 10 }} />
                <Text style={{ fontSize: 16, color: config.colors.text || '#000' }}>
                  {t("chat.blocked_users")}
                </Text>
              </View>
            </MenuOption>
          </MenuOptions>
        </Menu>
      )}

      {/* Full-screen Pet Guessing Game Modal */}
      <Modal
        animationType="slide"
        transparent={false}
        visible={gameModalVisible}
        onRequestClose={() => setGameModalVisible(false)}
      >
        <View style={{ flex: 1, paddingTop: Platform.OS === 'android' ? 0 : 60, }}>
          {/* Absolute-positioned close icon in top-right corner */}
          <TouchableOpacity
            onPress={() => setGameModalVisible(false)}
            style={{
              position: 'absolute',
              top: Platform.OS === 'android' ? 0 : 60,
              left: 5,
              zIndex: 10,
              padding: 8,
            }}
          >
            <Icon name="close" size={24} color={config.colors.primary} />
          </TouchableOpacity>

          <PetGuessingGameScreen />
        </View>
      </Modal>
    </View>
  );
};

export default CommunityChatHeader;

