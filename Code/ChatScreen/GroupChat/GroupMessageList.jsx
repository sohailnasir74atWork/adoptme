import React, { memo, useMemo, useState, useCallback, useEffect } from 'react';
import { getSafeTextColor, RainbowText, isMultiColorText, getMultiColorPalette } from '../../Helper/contrastHelper';
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
import { getThemeColors } from '../../Helper/themeColors';
import UserBadgePill, { getFirstBadgeType } from '../../Helper/UserBadgePill';
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
import { resolveProfile, seedFromMessage, warmProfileCache, getCachedProfile } from '../../Helper/profileCache';
import FramedAvatar from './FramedAvatar';

// Above this many pets a message switches to the compact two-column grid.
const COMPACT_FRUITS_THRESHOLD = 9;

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
  const { theme, isAdmin, appdatabase } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  const isAdminOrMod = isAdmin || !!user?.isModerator;
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { triggerHapticFeedback } = useHaptic();

  const [selectedMessage, setSelectedMessage] = useState(null);
  const [actionDrawerVisible, setActionDrawerVisible] = useState(false);

  // Frame border color cycling removed — was causing full-list re-renders every 1.5s.
  // Frames now render with a static primary color (borderColors[0]).

  const fruitColors = useMemo(
    () => ({
      wrapperBg: isDarkMode ? '#0f172a55' : '#e5e7eb55',
      name: isDarkMode ? '#f9fafb' : '#111827',
      value: c.textSecondary,
      divider: isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel: c.textSecondary,
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

  // Filtered messages (sorted descending for inverted FlatList).
  // Dedup-by-id guards against duplicate keys reaching the FlatList — can
  // happen briefly when realtime onInsert races with pagination, or if the
  // channel resubscribes and replays its buffer.
  const filteredMessages = useMemo(() => {
    if (!Array.isArray(messages)) return [];
    const seen = new Set();
    const unique = [];
    for (const m of messages) {
      const id = m?.id != null ? String(m.id) : null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      unique.push(m);
    }
    return unique.sort((a, b) => (b?.timestamp || 0) - (a?.timestamp || 0));
  }, [messages]);

  // ✅ PERF FIX: Use ref for filteredMessages inside renderMessage
  // This avoids adding filteredMessages to renderMessage's deps,
  // which would cause all messages to re-render on every new message.
  const filteredMessagesRef = React.useRef(filteredMessages);
  filteredMessagesRef.current = filteredMessages;

  // Warm the profile cache for the UNIQUE senders in view so avatar frames
  // render. Group messages are slim (no frame in the payload), so
  // resolveProfile has nothing to show unless the cache is populated — this
  // is why frames weren't appearing in public chat. Unique senders +
  // uncached-only + 30-min TTL keep it cheap even in the busiest chat; bump
  // the version once it lands so the (memoised) rows re-render via extraData.
  const [profileCacheVersion, setProfileCacheVersion] = useState(0);
  useEffect(() => {
    if (!appdatabase) return;
    const senders = [...new Set(filteredMessages.map(m => m?.senderId).filter(Boolean))]
      .filter(id => id !== userId && !getCachedProfile(id));
    if (senders.length === 0) return;
    let cancelled = false;
    warmProfileCache(appdatabase, senders)
      .then(() => { if (!cancelled) setProfileCacheVersion(v => v + 1); })
      .catch(() => { });
    return () => { cancelled = true; };
  }, [filteredMessages, appdatabase, userId]);

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

      // ✅ PHASE 0A: Resolve profile from message → cache → defaults
      const profile = resolveProfile(item);
      seedFromMessage(item); // Free cache population from old-format messages

      const senderName = profile.displayName;
      const senderAvatar =
        profile.avatar ||
        groupData?.members?.[item.senderId]?.avatar ||
        'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';

      const fruits = Array.isArray(item.fruits) ? item.fruits : [];
      const hasFruits = fruits.length > 0;
    // Past 9 pets the single-column list grows taller than the screen, so
    // switch to two columns — 18 pets then occupy the same 9 rows.
    const isCompactFruits = fruits.length > COMPACT_FRUITS_THRESHOLD;
      const totalFruitValue = hasFruits
        ? fruits.reduce((sum, f) => sum + (Number(f?.value) || 0), 0)
        : 0;

      // Check for recent win — from resolved profile
      const hasRecentWin = profile.hasRecentGameWin;

      const msgBubble = (
        <View
          style={{
            flexDirection: 'row',
            alignSelf: isMyMessage ? 'flex-end' : 'flex-start',
            alignItems: 'flex-start',
            maxWidth: '82%',
            marginBottom: 6,
            marginHorizontal: 8,
            ...(item.id === highlightedMessageId ? {
              borderWidth: 2,
              borderColor: '#F59E0B',
              borderRadius: 18,
            } : {}),
          }}
        >
          {/* Avatar — left side for others */}
          {!isMyMessage && (
            <TouchableOpacity
              onPress={() => {
                if (onUserPress && item.senderId) {
                  onUserPress({ senderId: item.senderId, sender: senderName, avatar: senderAvatar });
                }
              }}
              disabled={!onUserPress}
              style={{ marginRight: 6, marginBottom: 2 }}
            >
              <FramedAvatar
                avatarUri={senderAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                frame={profile.profileFrame || null}
                isDarkMode={isDarkMode}
                avatarSize={28}
                forceDetail
              />
            </TouchableOpacity>
          )}

          {/* Message Content Container */}
          <View style={styles.messageTextBox}>
            {/* Reply Preview */}
            {item.replyTo && (
              <TouchableOpacity
                style={[
                  styles.replyContainer,
                  { backgroundColor: c.border },
                ]}
                activeOpacity={0.7}
                onPress={() => scrollToMessage && scrollToMessage(item.replyTo.id)}
              >
                <Text style={[styles.replyText, { color: c.textSecondary }]} numberOfLines={2}>
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
                    : profile.chatBubbleBg
                      ? { backgroundColor: isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color }
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
                  <View style={styles.nameRow}>
                    <Text
                      style={[styles.userNameText, { flexShrink: 1 }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {senderName}
                    </Text>

                    {profile.isPro && (
                      <Image source={require('../../../assets/pro.png')} style={styles.icon} />
                    )}
                    {profile.robloxUsernameVerified && (
                      <Image source={require('../../../assets/verification.png')} style={styles.icon} />
                    )}
                    {hasRecentWin && (
                      <Image source={require('../../../assets/trophy.webp')} style={styles.icon} />
                    )}

                    {item?.isCreator && (
                      <View style={[styles.roleBadge, { backgroundColor: '#8B5CF6' }]}>
                        <Text style={styles.roleBadgeText}>Creator</Text>
                      </View>
                    )}
                    {(() => {
                      const firstBadge = getFirstBadgeType(
                        { isBabyMod: item.isBabyMod, isTrusted: profile.isTrusted, isCMSR: profile.isCMSR, isHelper: profile.isHelper },
                        ['jmd', 'trusted', 'cmsr', 'helper'],
                      );
                      return (
                        <>
                          {!item.isAdmin && !item.isModerator && item.isBabyMod && (
                            <UserBadgePill type="jmd" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'jmd'} />
                          )}
                          {profile.isTrusted && (
                            <UserBadgePill type="trusted" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'trusted'} />
                          )}
                          {profile.isCMSR && (
                            <UserBadgePill type="cmsr" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'cmsr'} />
                          )}
                          {profile.isHelper && (
                            <UserBadgePill type="helper" size="sm" isDarkMode={isDarkMode} glow={firstBadge === 'helper'} />
                          )}
                        </>
                      );
                    })()}
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
                      fruitStyles.fruitsWrapper,
                      isCompactFruits && fruitStyles.fruitsWrapperCompact,]}
                  >
                    {fruits.map((fruit, index) => {
                      const { name: nameColor, value: valueColor } = fruitColors;
                      const valueType = (fruit.valueType || 'd').toLowerCase();
                      const NON_PET_TYPES = ['EGGS', 'VEHICLES', 'PET WEAR', 'OTHER', 'TOYS', 'FOOD', 'STROLLERS', 'GIFTS', 'STICKERS'];
                      const isPet = !NON_PET_TYPES.includes((fruit.category || '').toUpperCase());

                      let valueBadgeStyle = fruitStyles.badgeDefault;
                      if (valueType === 'n') valueBadgeStyle = fruitStyles.badgeNeon;
                      if (valueType === 'm') valueBadgeStyle = fruitStyles.badgeMega;

                      return (
                        <View
                          key={`${fruit.id || fruit.name}-${index}`}
                          style={[fruitStyles.fruitCard, isCompactFruits && fruitStyles.fruitCardCompact]}
                        >
                          <Image
                            source={{ uri: fruit.imageUrl }}
                            style={[fruitStyles.fruitImage, isCompactFruits && fruitStyles.fruitImageCompact]}
                          />

                          <View style={[fruitStyles.fruitInfo, isCompactFruits && fruitStyles.fruitInfoCompact]}>
                            <Text
                              style={[fruitStyles.fruitName, isCompactFruits && fruitStyles.fruitNameCompact, { color: nameColor }]}
                              numberOfLines={1}
                            >
                              {`${fruit.name || fruit.Name}  `}
                            </Text>

                            <Text
                              style={[fruitStyles.fruitValue, isCompactFruits && fruitStyles.fruitValueCompact, { color: valueColor }]}
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
                  isMultiColorText(profile.chatTextColor)
                    ? <RainbowText
                        colors={getMultiColorPalette(profile.chatTextColor)}
                        style={[isMyMessage ? styles.myMessageTextOnly : styles.otherMessageTextOnly]}
                      >{typeof parseMessageText === 'function' ? item.text : item.text}</RainbowText>
                    : <Text style={[
                        isMyMessage ? styles.myMessageTextOnly : styles.otherMessageTextOnly,
                        profile.chatTextColor ? { color: getSafeTextColor(profile.chatTextColor, profile.chatBubbleBg ? (isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color) : null) } : null,
                      ]}>
                        {parseMessageText(item.text)}
                      </Text>
                )}

                {/* Timestamp inside bubble — WhatsApp style */}
                <Text style={{
                  fontSize: 9,
                  color: isMyMessage
                    ? (isDarkMode ? '#ffffffaa' : '#00000066')
                    : (isDarkMode ? '#ffffff77' : '#00000055'),
                  alignSelf: 'flex-end',
                  marginTop: 2,
                }}>
                  {item.timestamp
                    ? new Date(item.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                    : ''}
                </Text>
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
                        backgroundColor: c.bgAlt,
                        gap: 3,
                        borderWidth: 1,
                        borderColor: c.border,
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
                          : (c.textSecondary),
                      }}>{count}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
          </View>

          {/* Avatar — right side for own messages */}
          {isMyMessage && (
            <TouchableOpacity
              onPress={() => {
                if (onUserPress && item.senderId) {
                  onUserPress({ senderId: item.senderId, sender: senderName, avatar: senderAvatar });
                }
              }}
              disabled={!onUserPress}
              style={{ marginLeft: 6, marginBottom: 2 }}
            >
              <FramedAvatar
                avatarUri={senderAvatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                frame={profile.profileFrame || null}
                isDarkMode={isDarkMode}
                avatarSize={28}
                forceDetail
              />
            </TouchableOpacity>
          )}
        </View>
      );

      // Date separator: in inverted list, next item in array is older
      // ✅ PERF FIX: Use ref to avoid filteredMessages in deps
      const currentMessages = filteredMessagesRef.current;
      const nextMsg = currentMessages[index + 1];
      const showDateSep = !nextMsg || getDateLabel(item.timestamp) !== getDateLabel(nextMsg.timestamp);

      return (
        <>
          {msgBubble}
          {showDateSep && (
            <View style={{ alignItems: 'center', marginVertical: 10 }}>
              <View style={{ backgroundColor: c.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 4 }}>
                <Text style={{ fontSize: 11, color: c.textSecondary, fontWeight: '600' }}>
                  {getDateLabel(item.timestamp)}
                </Text>
              </View>
            </View>
          )}
        </>
      );
    },
    // ✅ PERF FIX: Reduced from 24 deps to 14.
    // Removed: filteredMessages (uses ref), user, handleCopy, t, isAdmin (unused directly or stable).
    // frameBorderColorIndex removed — was re-rendering whole list every 1.5s; frames now static.
    [userId, groupData, styles, fruitColors, navigation, triggerHapticFeedback, onUserPress, isDarkMode, scrollToMessage, highlightedMessageId, getReplyPreview, isAdminOrMod, onReaction, getDateLabel]
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
        extraData={`${highlightedMessageId}-${profileCacheVersion}`} // re-render on highlight or cache warm
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
        onCopy={handleCopy}
        onReply={onReply || null}
        onTranslate={onTranslate || null}
        onReport={onReport || null}
        onDelete={onDeleteMessage || null}
        onDeleteAll={onDeleteAllMessages || null}
        onPinMessage={onPinMessage || null}
        isAdminOrMod={isAdminOrMod}
        userId={userId}
        isDarkMode={isDarkMode}
      />
    </>
  );
};

export default memo(GroupMessageList);
