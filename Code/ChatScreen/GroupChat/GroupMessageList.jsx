import React, { memo, useMemo, useState, useCallback } from 'react';
import {
  FlatList,
  View,
  Text,
  RefreshControl,
  Image,
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useGlobalState } from '../../GlobelStats';
import { getStyles } from '../Style';
import { useTranslation } from 'react-i18next';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { useNavigation } from '@react-navigation/native';
import { FRUIT_KEYWORDS } from '../../Helper/filter';
import { fruitStyles } from '../PrivateChat/PrivateMessageList';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { parseMessageText } from '../ChatHelper';
import MessageActionDrawer from './MessageActionDrawer';

const GroupMessageList = ({
  messages,
  userId,
  user,
  groupData,
  handleLoadMore,
  refreshing,
  onRefresh,
  loading,
  isPaginating,
  onUserPress, // Callback to open profile drawer
  onReply, // Callback to reply to a message
  scrollToMessage, // Function to scroll to a message
  highlightedMessageId, // ID of highlighted message
  flatListRef, // Ref for FlatList
  onDeleteMessage, // Admin/mod: delete single message
  onDeleteAllMessages, // Admin/mod: delete all messages from sender
  onReaction, // Callback to react to a message
  onTranslate, // Callback to translate a message
  onReport, // Callback to report a message
  onPinMessage, // Callback to pin a message
}) => {
  const { theme, isAdmin } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const isAdminOrMod = isAdmin || !!user?.isModerator;
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { triggerHapticFeedback } = useHaptic();

  const [selectedMessage, setSelectedMessage] = useState(null);
  const [actionDrawerVisible, setActionDrawerVisible] = useState(false);

  const fruitColors = useMemo(
    () => ({
      wrapperBg: isDarkMode ? '#0f172a55' : '#e5e7eb55',
      name: isDarkMode ? '#f9fafb' : '#111827',
      value: isDarkMode ? '#e5e7eb' : '#4b5563',
      divider: isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel: isDarkMode ? '#e5e7eb' : '#4b5563',
      totalValue: isDarkMode ? '#f97373' : '#b91c1c',
    }),
    [isDarkMode],
  );

  // Pre-compile regex patterns for FRUIT_KEYWORDS
  const fruitRegexPatterns = useMemo(() => {
    return FRUIT_KEYWORDS.map((word, index) => ({
      regex: new RegExp(`\\b${word}\\b`, 'gi'),
      placeholder: `__FRUIT_${index}__`,
      word,
    }));
  }, []);

  const handleCopy = useCallback((message) => {
    if (!message || !message.text) return;
    Clipboard.setString(message.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage('Success', 'Message Copied');
  }, [triggerHapticFeedback]);

  // Get reply preview text
  const getReplyPreview = useCallback((replyTo) => {
    if (!replyTo || typeof replyTo !== 'object') return '[Deleted message]';

    if (replyTo.text && typeof replyTo.text === 'string' && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }

    if (replyTo.imageUrl || (Array.isArray(replyTo.imageUrls) && replyTo.imageUrls.length > 0)) {
      const imageCount = Array.isArray(replyTo.imageUrls) ? replyTo.imageUrls.length : (replyTo.imageUrl ? 1 : 0);
      return imageCount > 1 ? `[${imageCount} Images]` : '[Image]';
    }

    if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
      const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
      return count > 0
        ? `[${count} pet(s) message]`
        : '[Pets message]';
    }

    return '[Deleted message]';
  }, []);

  // Filtered messages (sorted descending for inverted FlatList)
  const filteredMessages = useMemo(() => {
    if (!Array.isArray(messages)) return [];
    return [...messages].sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
  }, [messages]);

  // ✅ Date separator helper
  const getDateLabel = useCallback((timestamp) => {
    if (!timestamp) return '';
    const msgDate = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (msgDate.toDateString() === today.toDateString()) return t('chat.today', { defaultValue: 'Today' });
    if (msgDate.toDateString() === yesterday.toDateString()) return t('chat.yesterday', { defaultValue: 'Yesterday' });
    return msgDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }, [t]);

  const renderMessage = useCallback(
    ({ item, index }) => {
      if (!item || typeof item !== 'object') return null;

      const isMyMessage = item.senderId === userId;
      const senderName = item.sender || 'Anonymous';
      const senderAvatar =
        item.avatar ||
        groupData?.members?.[item.senderId]?.avatar ||
        'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

      const fruits = Array.isArray(item.fruits) ? item.fruits : [];
      const hasFruits = fruits.length > 0;
      const totalFruitValue = hasFruits
        ? fruits.reduce((sum, f) => sum + (Number(f?.value) || 0), 0)
        : 0;

      // Check for recent win
      const hasRecentWin =
        item?.hasRecentGameWin ||
        (typeof item?.lastGameWinAt === 'number' &&
          Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);

      const msgBubble = (
        <View
          style={[
            isMyMessage ? styles.mymessageBubble : styles.othermessageBubble,
            isMyMessage ? styles.myMessage : styles.otherMessage,
            item.id === highlightedMessageId && {
              backgroundColor: isDarkMode ? '#3a2a10' : '#fef3c7',
              borderWidth: 2,
              borderColor: '#F59E0B',
            },
          ]}
        >
          {/* Avatar Container - matching main chat structure */}
          <View style={styles.senderName}>
            <TouchableOpacity
              onPress={() => {
                if (onUserPress && item.senderId) {
                  onUserPress({
                    senderId: item.senderId,
                    sender: senderName,
                    avatar: senderAvatar,
                  });
                }
              }}
              disabled={!onUserPress}
              activeOpacity={0.7}
              style={{ alignItems: 'center', justifyContent: 'center' }}
            >
              <Image
                source={{
                  uri: senderAvatar ||
                    'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                }}
                style={styles.profileImage}
              />
            </TouchableOpacity>
          </View>

          {/* Message Content Container */}
          <View style={styles.messageTextBox}>
            {/* Reply Preview */}
            {item.replyTo && (
              <TouchableOpacity
                style={[
                  styles.replyContainer,
                  { backgroundColor: isDarkMode ? '#374151' : '#E5E7EB' },
                ]}
                activeOpacity={0.7}
                onPress={() => scrollToMessage && scrollToMessage(item.replyTo.id)}
              >
                <Text style={[styles.replyText, { color: isDarkMode ? '#9CA3AF' : '#6B7280' }]} numberOfLines={2}>
                  Replying to: {'\n'}
                  {getReplyPreview(item.replyTo)}
                </Text>
              </TouchableOpacity>
            )}

            {/* Username with badges - shown for ALL messages (including current user) */}


            <TouchableOpacity
              activeOpacity={1}
              onLongPress={() => {
                triggerHapticFeedback('impactMedium');
                setSelectedMessage(item);
                setActionDrawerVisible(true);
              }}
            >
              {/* Message Content Wrapper - matching main chat structure */}
              <View style={[
                isMyMessage ? styles.myMessageText : styles.otherMessageText,
                isAdminOrMod && item.strikeCount === 1
                  ? { backgroundColor: 'pink' }
                  : isAdminOrMod && item.strikeCount >= 2
                    ? { backgroundColor: 'red' }
                    : null,
              ]}>
                <TouchableOpacity
                  onPress={() => {
                    if (onUserPress && item.senderId) {
                      onUserPress({
                        senderId: item.senderId,
                        sender: senderName,
                        avatar: senderAvatar,
                      });
                    }
                  }}
                  disabled={!onUserPress}
                  activeOpacity={0.7}
                  style={{ alignSelf: 'flex-start' }}
                >
                  <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    flexWrap: 'nowrap',
                  }}>
                    <Text
                      style={[styles.userNameText, {
                        flexShrink: 1,
                      }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {senderName}
                    </Text>

                    {/* Pro badge */}
                    {item?.isPro && (
                      <Image
                        source={require('../../../assets/pro.png')}
                        style={{ width: 16, height: 16, marginLeft: 4 }}
                      />
                    )}

                    {/* Verified badge */}
                    {item?.robloxUsernameVerified && (
                      <Image
                        source={require('../../../assets/verification.png')}
                        style={{ width: 16, height: 16, marginLeft: 4 }}
                      />
                    )}

                    {/* Trophy badge (recent win) */}
                    {hasRecentWin && (
                      <Image
                        source={require('../../../assets/trophy.webp')}
                        style={{ width: 10, height: 10, marginLeft: 4 }}
                      />
                    )}

                    {/* Creator badge */}
                    {item?.isCreator && (
                      <View style={{
                        backgroundColor: '#8B5CF6',
                        paddingHorizontal: 4,
                        paddingVertical: 1,
                        borderRadius: 3,
                        marginLeft: 4,
                      }}>
                        <Text style={{
                          color: '#FFF',
                          fontSize: 9,
                          fontWeight: '600',
                        }}>Creator</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
                {/* Images - Support multiple images */}
                {(item.imageUrls || item.imageUrl) && (() => {
                  // Support both array (imageUrls) and single (imageUrl) for backward compatibility
                  const imageArray = Array.isArray(item.imageUrls) && item.imageUrls.length > 0
                    ? item.imageUrls
                    : (item.imageUrl ? [item.imageUrl] : []);

                  if (imageArray.length === 0) return null;

                  return (
                    <View style={{ marginBottom: 4, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                      {imageArray.map((imageUri, imgIndex) => {
                        // Fixed size approach: larger for single, smaller for multiple
                        const imageSize = imageArray.length === 1 ? 250 : imageArray.length === 2 ? 150 : 110;

                        return (
                          <TouchableOpacity
                            key={`img-${imgIndex}`}
                            activeOpacity={0.8}
                            onPress={() =>
                              navigation.navigate('ImageViewerScreenChat', {
                                images: imageArray,
                                initialIndex: imgIndex,
                              })
                            }
                          >
                            <Image
                              source={{ uri: imageUri }}
                              style={{
                                width: imageSize,
                                height: imageSize,
                                borderRadius: 8,
                                resizeMode: 'cover',
                              }}
                            />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })()}

                {/* 🐾 Fruits list (matching main chat style) */}
                {hasFruits && (
                  <View
                    style={[
                      fruitStyles.fruitsWrapper,]}
                  >
                    {fruits.map((fruit, index) => {
                      const { name: nameColor, value: valueColor } = fruitColors;
                      const valueType = (fruit.valueType || 'd').toLowerCase();
                      const NON_PET_TYPES = ['EGGS', 'VEHICLES', 'PET WEAR', 'OTHER', 'TOYS', 'FOOD', 'STROLLERS', 'GIFTS'];
                      const isPet = !NON_PET_TYPES.includes((fruit.category || '').toUpperCase());

                      let valueBadgeStyle = fruitStyles.badgeDefault;
                      if (valueType === 'n') valueBadgeStyle = fruitStyles.badgeNeon;
                      if (valueType === 'm') valueBadgeStyle = fruitStyles.badgeMega;

                      return (
                        <View
                          key={`${fruit.id || fruit.name}-${index}`}
                          style={fruitStyles.fruitCard}
                        >
                          <Image
                            source={{ uri: fruit.imageUrl }}
                            style={fruitStyles.fruitImage}
                          />

                          <View style={fruitStyles.fruitInfo}>
                            <Text
                              style={[fruitStyles.fruitName, { color: nameColor }]}
                              numberOfLines={1}
                            >
                              {`${fruit.name || fruit.Name}  `}
                            </Text>

                            <Text
                              style={[fruitStyles.fruitValue, { color: valueColor }]}
                            >
                              · Value: {Number(fruit.value || 0).toLocaleString()}
                            </Text>

                            {isPet && (
                              <View style={fruitStyles.badgeRow}>
                                {/* D / N / M badge */}
                                <View style={[fruitStyles.badge, valueBadgeStyle]}>
                                  <Text style={fruitStyles.badgeText}>
                                    {valueType.toUpperCase()}
                                  </Text>
                                </View>

                                {/* Fly badge */}
                                {fruit.isFly && (
                                  <View style={[fruitStyles.badge, fruitStyles.badgeFly]}>
                                    <Text style={fruitStyles.badgeText}>F</Text>
                                  </View>
                                )}

                                {/* Ride badge */}
                                {fruit.isRide && (
                                  <View style={[fruitStyles.badge, fruitStyles.badgeRide]}>
                                    <Text style={fruitStyles.badgeText}>R</Text>
                                  </View>
                                )}
                              </View>
                            )}
                          </View>
                        </View>
                      );
                    })}

                    {/* ✅ Total row – only if more than one fruit */}
                    {fruits.length > 1 && (
                      <View
                        style={[
                          fruitStyles.totalRow,
                          { borderTopColor: fruitColors.divider },
                        ]}
                      >
                        <Text
                          style={[fruitStyles.totalLabel, { color: fruitColors.totalLabel }]}
                        >
                          Total:
                        </Text>
                        <Text
                          style={[fruitStyles.totalValue, { color: fruitColors.totalValue }]}
                        >
                          {totalFruitValue.toLocaleString()}
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* Normal text (can be empty if only fruits) - matching main chat */}
                {!!item.text && (
                  <Text style={isMyMessage ? styles.myMessageTextOnly : styles.otherMessageTextOnly}>
                    {parseMessageText(item.text)}
                  </Text>
                )}
              </View>
            </TouchableOpacity>

            {/* ✅ Reaction badges */}
            {item.reactions && Object.keys(item.reactions).length > 0 && (() => {
              const counts = {};
              Object.values(item.reactions).forEach(emoji => {
                counts[emoji] = (counts[emoji] || 0) + 1;
              });
              const myReaction = item.reactions[userId] || null;
              return (
                <View style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 4,
                  marginTop: -8,
                  marginBottom: 4,
                  marginLeft: 8,
                  zIndex: 1,
                }}>
                  {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([emoji, count]) => (
                    <TouchableOpacity
                      key={emoji}
                      onPress={() => onReaction && onReaction(item.id, emoji)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 999,
                        backgroundColor: isDarkMode ? '#1e293b' : '#ffffff',
                        gap: 3,
                        borderWidth: 1,
                        borderColor: isDarkMode ? '#334155' : '#e2e8f0',
                        ...(myReaction === emoji ? {
                          backgroundColor: isDarkMode ? '#1e3a5f' : '#dbeafe',
                          borderColor: isDarkMode ? '#3b82f6' : '#60a5fa',
                        } : {}),
                      }}
                    >
                      <Text style={{ fontSize: 12 }}>{emoji}</Text>
                      <Text style={{
                        fontSize: 10,
                        fontWeight: '600',
                        color: myReaction === emoji
                          ? (isDarkMode ? '#93c5fd' : '#2563eb')
                          : (isDarkMode ? '#94a3b8' : '#64748b'),
                      }}>{count}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
          </View>

          <Text style={styles.timestamp}>
            {item.timestamp
              ? new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
              : ''}
          </Text>
        </View>
      );

      // Date separator: in inverted list, next item in array is older
      const nextMsg = filteredMessages[index + 1];
      const showDateSep = !nextMsg || getDateLabel(item.timestamp) !== getDateLabel(nextMsg.timestamp);

      return (
        <>
          {msgBubble}
          {showDateSep && (
            <View style={{ alignItems: 'center', marginVertical: 10 }}>
              <View style={{ backgroundColor: isDarkMode ? '#334155' : '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4 }}>
                <Text style={{ fontSize: 11, color: isDarkMode ? '#94a3b8' : '#64748b', fontWeight: '600' }}>
                  {getDateLabel(item.timestamp)}
                </Text>
              </View>
            </View>
          )}
        </>
      );
    },
    [userId, user, groupData, styles, fruitColors, handleCopy, navigation, triggerHapticFeedback, onUserPress, isDarkMode, onReply, scrollToMessage, highlightedMessageId, getReplyPreview, t, isAdmin, isAdminOrMod, onDeleteMessage, onDeleteAllMessages, onReaction, filteredMessages, getDateLabel]
  );

  const keyExtractor = useCallback((item, index) => {
    return item?.id || `msg-${index}`;
  }, []);

  const messageListStyles = useMemo(
    () => ({
      flex: 1,
    }),
    []
  );

  const messageListContentStyles = useMemo(
    () => ({
      flexGrow: 1,
      paddingHorizontal: 10,
      paddingVertical: 5,
      ...(filteredMessages.length === 0 && { justifyContent: 'flex-end' }),
    }),
    [filteredMessages.length]
  );


  return (
    <>
      <FlatList
        ref={flatListRef}
        data={filteredMessages}
        renderItem={renderMessage}
        keyExtractor={keyExtractor}
        inverted={true} // ✅ Latest messages at bottom
        style={messageListStyles}
        contentContainerStyle={messageListContentStyles}
        extraData={highlightedMessageId} // Re-render when highlight changes
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#8B5CF6" />
        }
        onEndReached={handleLoadMore} // ✅ Fires when scrolling to top (for inverted list)
        onEndReachedThreshold={0.3} // ✅ Trigger earlier for smoother loading
        initialNumToRender={15} // ✅ Render 15 messages initially
        maxToRenderPerBatch={10} // ✅ Render 10 per batch
        windowSize={5} // ✅ Optimize memory usage
        removeClippedSubviews={true} // ✅ Improve performance
        ListFooterComponent={
          isPaginating ? (
            <View style={{ padding: 16, alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#8B5CF6" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={{ padding: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.emptyText}>No messages yet</Text>
            </View>
          ) : null
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
      <MessageActionDrawer
        visible={actionDrawerVisible}
        message={selectedMessage}
        onClose={() => {
          setActionDrawerVisible(false);
          setSelectedMessage(null);
        }}
        onReaction={onReaction}
        onCopy={(msg) => handleCopy(msg)}
        onReply={onReply ? (msg) => onReply(msg) : null}
        onTranslate={onTranslate ? (msg) => onTranslate(msg) : null}
        onReport={onReport ? (msg) => onReport(msg) : null}
        onDelete={onDeleteMessage ? (msgId) => onDeleteMessage(msgId) : null}
        onDeleteAll={onDeleteAllMessages ? (senderId) => onDeleteAllMessages(senderId) : null}
        onPinMessage={onPinMessage ? (msg) => onPinMessage(msg) : null}
        isAdminOrMod={isAdminOrMod}
        userId={userId}
        isDarkMode={isDarkMode}
      />
    </>
  );
};

export default memo(GroupMessageList);
