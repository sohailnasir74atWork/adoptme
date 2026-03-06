import React, { useState, useCallback, memo, useEffect } from 'react';
import {
  View, Text, Image, StyleSheet, TouchableOpacity, Alert, useColorScheme,
} from 'react-native';
import Icon from 'react-native-vector-icons/FontAwesome';
import { mixpanel } from '../../AppHelper/MixPenel';
import { useNavigation } from '@react-navigation/native';
import CommentModal from './CommentsModal';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { Menu, MenuOption, MenuOptions, MenuTrigger } from 'react-native-popup-menu';
import { showMessage } from 'react-native-flash-message';
import ReportModal from './ReportModal';
import dayjs from 'dayjs';
import { get, getDatabase, ref, set } from '@react-native-firebase/database';
import ProfileBottomDrawer from '../../ChatScreen/GroupChat/BottomDrawer';
import { banUserwithEmail as banUtils } from '../../ChatScreen/utils';
import { useTranslation } from 'react-i18next';

const PostCard = ({ item, userId, onLike, localState, appdatabase, onDelete, onDeleteAll }) => {
  const navigation = useNavigation();
  const liked = !!item.likes?.[userId];
  const likeCount = item.likes ? Object.keys(item.likes).length : 0;
  const [showComments, setShowComments] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const { t } = useTranslation();
  const [bannedUsers, setBannedUsers] = useState([]);
  // const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    // if (!user?.id) return;
    setBannedUsers(localState.bannedUsers)

  }, [localState.bannedUsers]);
  // const report = !!item.likes?.[userId];

  // console.log(item)

  const { theme, isAdmin, user } = useGlobalState();
  const isDark = theme === 'dark';
  const getTagColor = (tag) => {
    switch (tag.toLowerCase()) {
      case 'scam alert':
        return '#FF3B30'; // Bright red
      case 'looking for trade':
        return '#34C759'; // Vibrant green
      case 'discussion':
        return '#5AC8FA'; // Sky blue
      case 'real or fake':
        return '#AF52DE'; // Purple
      case 'need help':
        return '#FF9500'; // Orange
      case 'misc':
      case 'misc.':
        return '#8E8E93'; // Neutral gray
      default:
        return config.colors.primary; // Fallback
    }
  };

  const getTranslatedTag = (tag) => {
    const tagKey = tag.toLowerCase().replace(/\s+/g, '_').replace(/\.+/g, '');
    return t(`feed.tags.${tagKey}`, { defaultValue: tag });
  };

  // ✅ Wrapper to match signature and use shared util
  const banUserwithEmail = async (email, targetUserId) => {
    if (!isAdmin && !user?.isModerator) return;
    // ✅ Enhanced: Pass user info and banner info
    await banUtils(email, true, targetUserId, {
      id: targetUserId,
      displayName: item.displayName || 'Unknown User',
      avatar: item.avatar,
    }, {
      id: user?.id,
      displayName: user?.displayName || user?.userName || 'Moderator',
      avatar: user?.avatar,
    });
  };
  const closeProfileDrawer = () => {
    setIsDrawerVisible(false);
  };
  const openProfileDrawer = async () => {
    if (!userId) {
      showMessage({
        message: t('feed.signin_message'),
        type: 'warning',
      });
      return;
    }
    // setSelectedUser(item)
    setIsDrawerVisible(true);
  };

  const selectedUser = {
    senderId: item.userId,
    sender: item.displayName,
    avatar: item.avatar,
    flage: item.flage ? item.flage : null,
    robloxUsername: item?.robloxUsername || null,
    robloxUsernameVerified: item?.robloxUsernameVerified || false,
  }

  const handleChatNavigation = useCallback(() => {
    const callback = () => {
      if (!userId) {
        showMessage({
          message: t('feed.signin_message'),
          type: 'warning',
        });
        return;
      }



      mixpanel.track('Design Screen');
      navigation.navigate('PrivateChatDesign', {
        selectedUser: selectedUser,
        item,
      });
    };





    // ✅ Removed navigation ad - exit ads are shown when leaving chat instead
    callback();
  }, [userId, item, navigation]);

  const themedStyles = getStyles(isDark);
  // console.log(item.createdAt)
  const formattedTime = item.createdAt ? dayjs(item.createdAt.toDate()).fromNow() : t('chat.anonymous');



  return (
    <View style={themedStyles.card}>
      <View style={themedStyles.header}>
        <TouchableOpacity onPress={openProfileDrawer}>
          <Image source={{ uri: item.avatar }} style={themedStyles.avatar} />
        </TouchableOpacity>
        <TouchableOpacity style={{ marginLeft: 12, flex: 1 }} onPress={openProfileDrawer}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={themedStyles.name} numberOfLines={1}>{item.displayName}</Text>
            {item.isPro && (
              <Image
                source={require('../../../assets/pro.png')}
                style={{ width: 14, height: 14 }}
              />
            )}
            {item.robloxUsernameVerified && (
              <Image
                source={require('../../../assets/verification.png')}
                style={{ width: 14, height: 14 }}
              />
            )}
            {(() => {
              const hasRecentWin =
                !!item?.hasRecentGameWin ||
                (typeof item?.lastGameWinAt === 'number' &&
                  Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);
              return hasRecentWin ? (
                <Image
                  source={require('../../../assets/trophy.webp')}
                  style={{ width: 13, height: 13 }}
                />
              ) : null;
            })()}
          </View>
          <Text style={themedStyles.time}>
            {formattedTime}
          </Text>
        </TouchableOpacity>

        <Menu>
          <MenuTrigger>
            <Icon name="ellipsis-v" size={18} color={isDark ? 'lightgrey' : 'grey'} style={{ marginRight: 5 }} />
          </MenuTrigger>
          <MenuOptions>
            <View>
              <MenuOption onSelect={() => setShowReportModal(true)} text={t('feed.report_post')} style={{ marginVertical: 5, }} /></View>
            {/* {console.log(isAdmin)} */}
            {(userId === item.userId || isAdmin || user?.isModerator) && (
              <MenuOption
                onSelect={() => {
                  Alert.alert(
                    t('feed.delete_post'),
                    t('feed.delete_confirmation'),
                    [
                      { text: t('feed.cancel'), style: 'cancel' },
                      { text: t('feed.submit'), onPress: () => onDelete(item.id), style: 'destructive' },
                    ]
                  );
                }}
              >
                <View style={[{ borderTopWidth: 1 }]}>
                  <Text style={[themedStyles.tagText, { marginVertical: 15, }]}>{t('feed.submit', { defaultValue: 'Delete' })}</Text>
                </View>
              </MenuOption>


            )}

            {(isAdmin || user?.isModerator) && <MenuOption
              onSelect={() => {
                Alert.alert(
                  t('feed.delete_post'),
                  t('feed.delete_confirmation'),
                  [
                    { text: t('feed.cancel'), style: 'cancel' },
                    { text: t('feed.submit'), onPress: () => onDeleteAll(item.userId), style: 'destructive' },
                  ]
                );
              }}
            >
              <View style={[{ borderTopWidth: 1 }]}>
                <Text style={[themedStyles.tagText, { marginVertical: 15, }]}>{t('feed.delete_all')}</Text>
              </View>
            </MenuOption>}
          </MenuOptions>

        </Menu>
      </View>


      <Text style={themedStyles.desc}>{item?.desc}</Text>
      {Array.isArray(item.imageUrl) && item.imageUrl.length < 1 && <ReportModal visible={showReportModal} onClose={() => setShowReportModal(false)} item={item} banUserwithEmail={banUserwithEmail} />}

      {/* {(item.selectedTags?.length > 0 || item.budget) && (
        <View style={themedStyles.metaInfoRow}>
          <View style={themedStyles.tagsRow}>
            {item.selectedTags?.map((tag, idx) => (
              <View key={idx} style={themedStyles.tagBadge}>
                <Text style={themedStyles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
          {item.budget && <Text style={themedStyles.budgetText}>Budget: {item.budget}</Text>}
        </View>
      )} */}

      {Array.isArray(item.imageUrl) && item.imageUrl.length > 0 && (
        <View style={themedStyles.imageWrapper}>
          {/* Tags positioned above the image container */}
          <View style={themedStyles.tagOverlayAbove}>
            {item.selectedTags?.map((tag, idx) => (
              <View key={idx} style={[themedStyles.overlayTag, { backgroundColor: getTagColor(tag) }]}>
                <Text style={themedStyles.overlayTagText}>{getTranslatedTag(tag)}</Text>
              </View>

            ))}
          </View>

          {/* Image block as-is */}
          <View style={themedStyles.shadowWrapper}>
            <View style={themedStyles.imageContainer}>
              {item?.imageUrl.length === 1 ? (
                <TouchableOpacity
                  onPress={() =>
                    navigation.navigate('ImageViewerScreen', {
                      images: item.imageUrl,
                      initialIndex: 0,
                    })
                  }
                >
                  <Image source={{ uri: item?.imageUrl[0] }} style={themedStyles.singleImage} />
                </TouchableOpacity>
              ) : (
                <View style={themedStyles.multiImageGrid}>
                  {item?.imageUrl.slice(0, 4).map((url, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={themedStyles.gridImage}
                      onPress={() =>
                        navigation.navigate('ImageViewerScreen', {
                          images: item?.imageUrl,
                          initialIndex: idx,
                        })
                      }
                    >
                      <Image source={{ uri: url }} style={themedStyles.gridImageInner} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>
          <ReportModal visible={showReportModal} onClose={() => setShowReportModal(false)} item={item} banUserwithEmail={banUserwithEmail} />

        </View>
      )}

      <View style={themedStyles.actionsRow}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity onPress={() => onLike(item)} style={themedStyles.actionBtn}>
            <Icon name={liked ? 'heart' : 'heart-o'} size={18} color={liked ? '#EF4444' : isDark ? '#64748b' : '#94a3b8'} />
            <Text style={[themedStyles.likeCount, liked && { color: '#EF4444' }]}>{t('feed.likes_count', { count: likeCount })}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowComments(true)} style={themedStyles.actionBtn}>
            <Icon name="comment" size={16} color={config.colors.primary} />
            <Text style={themedStyles.sendText}>
              {item.commentCount ? t('feed.comments_count', { count: item.commentCount }) : t('feed.no_comments')}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={openProfileDrawer} style={themedStyles.chatBtn}>
          <Icon name="paper-plane" size={13} color="#fff" />
          <Text style={themedStyles.chatBtnText}>{t('feed.chat')}</Text>
        </TouchableOpacity>
      </View>

      <CommentModal
        visible={showComments}
        onClose={() => setShowComments(false)}
        postId={item.id}
        appdatabase={appdatabase}
      />

      <ProfileBottomDrawer
        isVisible={isDrawerVisible}
        toggleModal={closeProfileDrawer}
        startChat={handleChatNavigation}
        selectedUser={selectedUser}
        isOnline={false}
        bannedUsers={bannedUsers}
      />
    </View>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    card: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginHorizontal: 12,
      marginVertical: 6,
      borderRadius: 18,
      backgroundColor: isDark ? '#1e293b' : '#ffffff',
      shadowColor: isDark ? '#000' : '#94a3b8',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: isDark ? 0.3 : 0.08,
      shadowRadius: 8,
      elevation: isDark ? 4 : 3,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 2,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },
    name: {
      fontWeight: '700',
      fontSize: 14,
      color: isDark ? '#f1f5f9' : '#0f172a',
      flexShrink: 1,
    },
    time: {
      fontSize: 11,
      color: isDark ? '#64748b' : '#94a3b8',
      marginTop: 1,
    },
    desc: {
      marginBottom: 10,
      fontSize: 14,
      color: isDark ? '#cbd5e1' : '#334155',
      lineHeight: 20,
    },

    shadowWrapper: {
      borderRadius: 14,
    },

    imageContainer: {
      borderRadius: 14,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: isDark ? '#334155' : '#e2e8f0',
    },

    singleImage: {
      width: '100%',
      height: 220,
      borderRadius: 14,
    },

    multiImageGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: 4,
      width: '100%',
      borderRadius: 14,
    },

    gridImage: {
      width: '49%',
      height: 130,
      marginBottom: 2,
      borderRadius: 12,
      overflow: 'hidden',
    },
    gridImageInner: {
      width: '100%',
      height: '100%',
      borderRadius: 12,
    },

    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 12,
      justifyContent: 'space-between',
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: isDark ? '#1e293b40' : '#f1f5f9',
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: isDark ? '#0f172a' : '#f8fafc',
      gap: 5,
    },
    likeCount: {
      fontSize: 12,
      color: isDark ? '#94a3b8' : '#64748b',
      fontWeight: '600',
    },

    chatBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: config.colors.primary,
      gap: 6,
      shadowColor: config.colors.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.3,
      shadowRadius: 4,
      elevation: 3,
    },
    chatBtnText: {
      color: '#ffffff',
      fontWeight: '700',
      fontSize: 12,
    },
    sendText: {
      fontSize: 12,
      color: config.colors.primary,
      fontWeight: '600',
    },

    metaInfoRow: {
      marginVertical: 6,
      flexDirection: 'column',
      gap: 4,
    },
    tagsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    tagBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: isDark ? '#334155' : '#f1f5f9',
    },
    tagText: {
      fontSize: 12,
      color: isDark ? '#e2e8f0' : '#475569',
      textTransform: 'capitalize',
    },
    budgetText: {
      fontSize: 13,
      fontStyle: 'italic',
      color: isDark ? '#64748b' : '#94a3b8',
      marginTop: 4,
    },
    imageWrapper: {
      marginBottom: 4,
      position: 'relative',
    },

    tagOverlayAbove: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      position: 'absolute',
      top: 8,
      right: 8,
      zIndex: 1000,
    },

    overlayTag: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
    },
    overlayTagText: {
      fontSize: 11,
      color: '#fff',
      fontWeight: '700',
    },
  });

export default memo(PostCard, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.likes === nextProps.item.likes &&
    prevProps.userId === nextProps.userId &&
    prevProps.localState?.isPro === nextProps.localState?.isPro &&
    prevProps.appdatabase === nextProps.appdatabase
  );
});
