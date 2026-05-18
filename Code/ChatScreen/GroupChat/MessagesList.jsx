import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { getSafeTextColor, RainbowText, isMultiColorText, getMultiColorPalette } from '../../Helper/contrastHelper';
import {
  FlatList,
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  Image,
  Alert,
  Keyboard,
  StyleSheet,
  Animated,
} from 'react-native';
import { getStyles } from './../Style';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import ReportPopup from './../ReportPopUp';
import { parseMessageText } from '../ChatHelper';
import { useHaptic } from '../../Helper/HepticFeedBack';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import UserBadgePill, { getFirstBadgeType } from '../../Helper/UserBadgePill';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import Clipboard from '@react-native-clipboard/clipboard';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import axios from 'axios';
import { useLocalState } from '../../LocalGlobelStats';
import { getDeviceLanguage } from '../../../i18n';
import { mixpanel } from '../../AppHelper/MixPenel';
import { FRUIT_KEYWORDS } from '../../Helper/filter';
import MessageActionDrawer from './MessageActionDrawer';
import { resolveProfile, seedFromMessage } from '../../Helper/profileCache';

import FramedAvatar from './FramedAvatar';
import { BADGE_IMAGES, BADGE_DEFINITIONS } from './badgeUtils';


const MessagesList = ({
  messages,
  isAtBottom, setIsAtBottom,
  handleLoadMore,
  user,
  isDarkMode,
  onPinMessage,
  onDeleteMessage,
  onReply,
  // isAdmin,
  refreshing,
  flatListRef,
  onRefresh,
  banUser,
  makeadmin,
  removeAdmin,
  unbanUser,
  onUnpinMessage,
  // isOwner,
  toggleDrawer,
  setMessages,
  onDeleteAllMessage,
  handlePinMessage,
  onReaction, // Callback to react to a message
  supabaseRoomId, // set when messages live in Supabase (public chat)
  pendingCount = 0,

}) => {
  const c = getThemeColors(isDarkMode);
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [actionDrawerVisible, setActionDrawerVisible] = useState(false);
  // frameBorderColorIndex removed — was causing unnecessary FlatList re-renders
  const { triggerHapticFeedback } = useHaptic();
  const scrollButtonOpacity = useMemo(() => new Animated.Value(0), []);

  // Dedup-by-id before render. Realtime INSERT can race with pagination
  // backfill (same row arrives via both paths), and the Supabase channel
  // can replay its buffer on resubscribe — both produce the duplicate-key
  // FlatList crash. Same guard PrivateMessageList and GroupMessageList
  // already have.
  const dedupedMessages = useMemo(() => {
    if (!Array.isArray(messages)) return [];
    const seen = new Set();
    const out = [];
    for (const m of messages) {
      const id = m?.id != null ? String(m.id) : null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(m);
    }
    return out;
  }, [messages]);

  // ✅ PERF: Store messages in a ref so renderMessage doesn't depend on the array
  const messagesRef = useRef(dedupedMessages);
  messagesRef.current = dedupedMessages;

  const { t } = useTranslation();
  const { isAdmin, api, freeTranslation } = useGlobalState();
  const isAdminOrMod = isAdmin || !!user?.isModerator;
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState } = useLocalState();
  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);

  // ✅ Memoize handleCopy
  const handleCopy = useCallback((message) => {
    if (!message || !message.text) return;
    Clipboard.setString(message.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage(t('chat.success'), t('chat.message_copied'));
  }, [triggerHapticFeedback]);
  // useEffect(() => {
  //   if (!messages || messages.length === 0) return;
  //   if (!isAtBottom) return; // only when user is at bottom

  //   const newest = messages[0]; // because FlatList is inverted
  //   if (!newest?.id) return;

  //   setHighlightedMessageId(newest.id);

  //   const timer = setTimeout(() => {
  //     setHighlightedMessageId((current) =>
  //       current === newest.id ? null : current,
  //     );
  //   }, 1500);

  //   return () => clearTimeout(timer);
  // }, [messages, isAtBottom]);



  const scrollToMessageTimerRef = useRef(null);
  const scrollToMessage = useCallback(
    (targetId) => {
      if (!flatListRef?.current || !targetId) return;

      const index = messagesRef.current.findIndex((m) => m.id === targetId);
      if (index === -1) return;

      try {
        flatListRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });

        // highlight only the scrolled-to message
        setHighlightedMessageId(targetId);

        if (scrollToMessageTimerRef.current) clearTimeout(scrollToMessageTimerRef.current);
        scrollToMessageTimerRef.current = setTimeout(() => {
          setHighlightedMessageId((current) =>
            current === targetId ? null : current,
          );
        }, 1500);
      } catch (e) {
        console.log('scrollToIndex error:', e);
      }
    },
    [flatListRef],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (scrollToMessageTimerRef.current) clearTimeout(scrollToMessageTimerRef.current);
    };
  }, []);

  // ✅ Scroll to bottom handler
  const handleScrollToBottom = useCallback(() => {
    if (!flatListRef?.current) return;

    triggerHapticFeedback('impactLight');

    try {
      // Since FlatList is inverted, index 0 is the bottom (newest message)
      flatListRef.current.scrollToIndex({
        index: 0,
        animated: true,
        viewPosition: 0,
      });
      setIsAtBottom(true);
    } catch (error) {
      // Fallback: scroll to offset 0
      flatListRef.current.scrollToOffset({ offset: 0, animated: true });
      setIsAtBottom(true);
    }
  }, [flatListRef, triggerHapticFeedback, setIsAtBottom]);

  // ✅ Animate scroll button visibility
  useEffect(() => {
    Animated.timing(scrollButtonOpacity, {
      toValue: isAtBottom ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isAtBottom, scrollButtonOpacity]);





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
  // ✅ Pre-compile regex patterns for FRUIT_KEYWORDS
  const fruitRegexPatterns = useMemo(() => {
    return FRUIT_KEYWORDS.map((word, index) => ({
      regex: new RegExp(`\\b${word}\\b`, 'gi'),
      placeholder: `__FRUIT_${index}__`,
      word,
    }));
  }, []);

  // ✅ Memoize translateText
  const translateText = useCallback(async (text, targetLang = deviceLanguage) => {
    if (!text || typeof text !== 'string') return null;

    const placeholders = {};
    let maskedText = text;

    // Step 1: Replace fruit names with placeholders using pre-compiled regex
    fruitRegexPatterns.forEach(({ regex, placeholder, word }) => {
      maskedText = maskedText.replace(regex, placeholder);
      placeholders[placeholder] = word;
    });

    try {
      // Step 2: Send masked text for translation
      const response = await axios.post(
        `https://translation.googleapis.com/language/translate/v2`,
        {},
        {
          params: {
            q: maskedText,
            target: targetLang,
            key: api,
          },
        }
      );

      let translated = response.data.data.translations[0].translatedText;

      // Step 3: Replace placeholders back with original fruit names
      Object.entries(placeholders).forEach(([placeholder, word]) => {
        translated = translated.replace(new RegExp(placeholder, 'g'), word);
      });
      mixpanel.track("Translation", { lang: targetLang });


      return translated;
    } catch (err) {
      console.error('Translation Error:', err);
      return null;
    }
  }, [fruitRegexPatterns, deviceLanguage, api]);

  // ✅ Memoize handleTranslate
  const handleTranslate = useCallback(async (item) => {
    if (!item || !item.text) {
      Alert.alert(t('chat.error'), t('chat.invalid_translation'));
      return;
    }
    const isUnlimited = freeTranslation || localState.isPro;

    if (!isUnlimited && !canTranslate()) {
      Alert.alert(t('chat.translation_limit_title'), t('chat.translation_limit_message'));
      return;
    }

    const translated = await translateText(item.text, deviceLanguage);

    if (translated) {
      if (!isUnlimited) incrementTranslationCount();

      const remaining = isUnlimited ? t('chat.unlimited') : `${getRemainingTranslationTries()} remaining`;

      Alert.alert(
        t('chat.translated_message_title'),
        `${translated}\n\n${t('chat.daily_limit_label', { remaining })}${isUnlimited
          ? ''
          : t('chat.upgrade_pro_translation')
        }`
      );
    } else {
      Alert.alert(t('chat.error'), t('chat.translation_failed'));
    }
  }, [canTranslate, freeTranslation, localState?.isPro, incrementTranslationCount, getRemainingTranslationTries, translateText, deviceLanguage]);

  // ✅ Memoize handleLongPress
  const handleLongPress = useCallback((item) => {
    if (!user?.id || !item) return;
    triggerHapticFeedback('impactMedium');
    setSelectedMessage(item);
    setActionDrawerVisible(true);
  }, [user?.id, triggerHapticFeedback]);

  // ✅ Memoize handleReport
  const handleReport = useCallback((message) => {
    if (!message) return;
    triggerHapticFeedback('impactLight');
    setSelectedMessage(message);
    setShowReportPopup(true);
  }, [triggerHapticFeedback]);

  // ✅ Memoize handleReportSuccess
  const handleReportSuccess = useCallback((reportedMessageId) => {
    if (!reportedMessageId) return;
    triggerHapticFeedback('impactLight');
    if (setMessages && typeof setMessages === 'function') {
      setMessages(prevMessages => {
        if (!Array.isArray(prevMessages)) return prevMessages;
        return prevMessages.map(msg =>
          msg?.id === reportedMessageId
            ? { ...msg, isReportedByUser: true }
            : msg
        );
      });
    }
  }, [triggerHapticFeedback, setMessages]);

  // ✅ Memoize handleProfileClick
  const handleProfileClick = useCallback((item) => {
    if (!item || !user?.id) return;
    if (toggleDrawer && typeof toggleDrawer === 'function') {
      toggleDrawer(item);
      triggerHapticFeedback('impactLight');
    }
  }, [user?.id, toggleDrawer, triggerHapticFeedback]);
  // ✅ Move getReplyPreview outside and memoize
  const getReplyPreview = useCallback((replyTo) => {
    if (!replyTo || typeof replyTo !== 'object') return t('chat.deleted_message_placeholder');

    if (replyTo.text && typeof replyTo.text === 'string' && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }

    if (replyTo.gif) {
      return t('chat.emoji_placeholder');
    }

    if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
      const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
      return count > 0
        ? t('chat.pets_message_count', { count })
        : t('chat.pets_message_placeholder');
    }

    return t('chat.deleted_message_placeholder');
  }, [t]);

  const renderMessage = useCallback(({ item, index }) => {
    // ✅ Safety checks
    if (!item || typeof item !== 'object') return null;

    const previousMessage = messagesRef.current[index + 1];
    const currentDate = item.timestamp ? new Date(item.timestamp).toDateString() : null;
    const previousDate = previousMessage?.timestamp
      ? new Date(previousMessage.timestamp).toDateString()
      : null;
    const shouldShowDateHeader = currentDate !== previousDate;

    const fruits = Array.isArray(item.fruits) ? item.fruits : [];
    const hasFruits = fruits.length > 0;
    const totalFruitValue = hasFruits
      ? fruits.reduce((sum, f) => sum + (Number(f?.value) || 0), 0)
      : 0;

    // ✅ PHASE 0A: Resolve profile from message → cache → defaults
    // Old messages have avatar/sender/isPro embedded → used first
    // New slim messages miss these → cache fills in
    // If cache misses too → sensible defaults (no crash)
    const profile = resolveProfile(item);
    seedFromMessage(item); // Free cache population from old-format messages

    const hasRecentWin = profile.hasRecentGameWin;

    return (
      <View>
        {/* Display the date header if it's a new day */}
        {shouldShowDateHeader && currentDate && (
          <View>
            <Text style={styles.dateSeparator}>{currentDate}</Text>
          </View>
        )}

        {/* Render the message */}
        {!item.isReportedByUser && (
          <View
            style={{
              flexDirection: 'row',
              alignSelf: item.senderId === user?.id ? 'flex-end' : 'flex-start',
              alignItems: 'flex-start',
              maxWidth: '82%',
              marginBottom: 6,
              marginHorizontal: 8,
              ...(item.id === highlightedMessageId ? { borderWidth: 2, borderColor: '#F59E0B', borderRadius: 18 } : {}),
            }}
          >
            {/* Avatar — left side for others */}
            {item.senderId !== user?.id && (
              <TouchableOpacity onPress={() => handleProfileClick(item)} style={{ marginRight: 6, marginBottom: 2 }}>
                <FramedAvatar
                  avatarUri={profile.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                  frame={profile.profileFrame}
                  isDarkMode={isDarkMode}
                  avatarSize={28}
                />
              </TouchableOpacity>
            )}

            <View style={styles.messageTextBox}>
              {/* Render reply context if present */}
              {item.replyTo && (
                <TouchableOpacity
                  style={styles.replyContainer}
                  activeOpacity={0.7}
                  onPress={() => scrollToMessage(item.replyTo.id)}
                >
                  <Text style={styles.replyText} numberOfLines={2}>
                    {t('chat.replying_to')} {'\n'}
                    {getReplyPreview(item.replyTo)}
                  </Text>
                </TouchableOpacity>
              )}


              {/* Render main message */}

              <TouchableOpacity
                activeOpacity={1}
                onLongPress={() => handleLongPress(item)}
              >

                <View style={[item.senderId === user?.id ? styles.myMessageText : styles.otherMessageText, isAdminOrMod && item.strikeCount === 1
                  ? { backgroundColor: 'pink' }
                  : isAdminOrMod && item.strikeCount >= 2
                    ? { backgroundColor: 'red' }
                    : profile.chatBubbleBg
                      ? { backgroundColor: isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color }
                      : null,]}>
                  <View style={styles.nameRow}>
                    <TouchableOpacity onPress={() => handleProfileClick(item)} activeOpacity={0.7}>
                      <Text style={styles.userNameText}>{profile.displayName}</Text>
                    </TouchableOpacity>

                    {profile.isPro && (
                      <Image source={require('../../../assets/pro.png')} style={styles.icon} />
                    )}
                    {profile.robloxUsernameVerified && (
                      <Image source={require('../../../assets/verification.png')} style={styles.icon} />
                    )}
                    {hasRecentWin && (
                      <Image source={require('../../../assets/trophy.webp')} style={styles.icon} />
                    )}

                    {(() => {
                      const firstBadge = getFirstBadgeType({
                        isAdmin: item.isAdmin, isModerator: item.isModerator, isBabyMod: item.isBabyMod,
                        isTrusted: profile.isTrusted, isCMSR: profile.isCMSR, isHelper: profile.isHelper,
                      });
                      return (
                        <>
                          {!!item.isAdmin && (
                            <UserBadgePill type="admin" size="sm" isDarkMode={isDarkMode} labelOverride={t("chat.admin")} glow={firstBadge === 'admin'} />
                          )}
                          {!item.isAdmin && item.isModerator && (
                            <UserBadgePill type="mod" size="sm" isDarkMode={isDarkMode} labelOverride={t("chat.mod")} glow={firstBadge === 'mod'} />
                          )}
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

                    {isAdmin && item.OS && (
                      <View style={styles.platformBadge}>
                        <Icon
                          name={item.OS === 'ios' ? 'logo-apple' : 'logo-android'}
                          size={12}
                          color={item.OS === 'ios' ? '#007AFF' : '#34C759'}
                        />
                      </View>
                    )}
                  </View>



                  {item.gif && !/\.gif(\?|$)/i.test(item.gif) && (
                    <View>
                      <Image
                        source={{ uri: item.gif }}
                        style={{ height: 50, width: 50, resizeMode: 'contain' }}
                      />
                    </View>
                  )}
                  {/* {'\n'} */}
                  {item?.text && (
                    isMultiColorText(profile.chatTextColor)
                      ? <RainbowText
                          colors={getMultiColorPalette(profile.chatTextColor)}
                          style={[item.senderId === user?.id ? styles.myMessageTextOnly : styles.otherMessageTextOnly]}
                        >{item.text}</RainbowText>
                      : <Text style={[
                          item.senderId === user?.id ? styles.myMessageTextOnly : styles.otherMessageTextOnly,
                          profile.chatTextColor ? { color: getSafeTextColor(profile.chatTextColor, profile.chatBubbleBg ? (isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color) : null) } : null,
                        ]}>
                          {parseMessageText(item.text)}
                        </Text>
                  )}

                  {/* Timestamp inside bubble — WhatsApp style */}
                  <Text style={{
                    fontSize: 9,
                    color: item.senderId === user?.id
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
                {hasFruits && (
                  <View
                    style={[
                      fruitStyles.fruitsWrapper,
                      { backgroundColor: fruitColors.wrapperBg },
                    ]}
                  >
                    {fruits.map((fruit, index) => {
                      const { name: nameColor, value: valueColor } = fruitColors;
                      const valueType = (fruit.valueType || 'd').toLowerCase(); // 'd' | 'n' | 'm'
                      const NON_PET_TYPES = ['EGGS', 'VEHICLES', 'PET WEAR', 'OTHER', 'TOYS', 'FOOD', 'STROLLERS', 'GIFTS', 'STICKERS'];
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
                              {t('chat.value_label')}{Number(fruit.value || 0).toLocaleString()}
                              {/* {fruit.category
                ? `  ·  ${String(fruit.category).toUpperCase()}  `
                : ''} */}{' '}
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
                          {t('chat.total_label')}
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
              </TouchableOpacity>

              {/* ✅ Reaction badges */}
              {item.reactions && Object.keys(item.reactions).length > 0 && (() => {
                const counts = {};
                Object.values(item.reactions).forEach(emoji => {
                  counts[emoji] = (counts[emoji] || 0) + 1;
                });
                const myReaction = item.reactions[user?.id] || null;
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
            {item.senderId === user?.id && (
              <TouchableOpacity onPress={() => handleProfileClick(item)} style={{ marginLeft: 6, marginBottom: 2 }}>
                <FramedAvatar
                  avatarUri={profile.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'}
                  frame={profile.profileFrame}
                  isDarkMode={isDarkMode}
                  avatarSize={28}
                />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  }, [highlightedMessageId, user?.id, styles, getReplyPreview, handleCopy, handleTranslate, handleReport, handleLongPress, handleProfileClick, scrollToMessage, isAdmin, isAdminOrMod, t, fruitColors, onReply, onDeleteMessage, onDeleteAllMessage, onReaction, isDarkMode]);

  return (
    <>
      <FlatList
        data={dedupedMessages}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderMessage}
        contentContainerStyle={styles.chatList}
        inverted
        extraData={highlightedMessageId}
        ref={flatListRef}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          const { contentOffset } = nativeEvent;
          // Threshold is generous on purpose: a small overshoot while reading
          // the newest message shouldn't flip us into "queue pending" mode,
          // or new messages stop appearing live and users think chat broke.
          const atBottom = contentOffset.y <= 200;
          setIsAtBottom(atBottom);
        }}
        onEndReachedThreshold={0.1}
        onEndReached={handleLoadMore}
        initialNumToRender={20}
        maxToRenderPerBatch={10}
        windowSize={21}
        // Detach off-screen rows from the native view tree to keep memory
        // bounded as the user scrolls back through long histories.
        // PrivateMessageList already enables this; group chat was missing it.
        removeClippedSubviews={true}

        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={c.text}
          />
        }
        // onScroll={() => Keyboard.dismiss()}
        onTouchStart={() => Keyboard.dismiss()}
        keyboardShouldPersistTaps="handled" // Ensures taps o
      />
      {/* ✅ Scroll to Bottom Button */}
      {!isAtBottom && (
        <Animated.View
          style={[
            styles.scrollToBottomButton,
            {
              opacity: scrollButtonOpacity,
              transform: [
                {
                  scale: scrollButtonOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <TouchableOpacity
            onPress={handleScrollToBottom}
            activeOpacity={0.8}
            style={styles.scrollToBottomTouchable}
          >
            <Icon
              name="chevron-down-circle"
              size={48}
              color={'#3b82f6'}
            />
            {pendingCount > 0 && (
              <View style={pendingBadgeStyles.badge} pointerEvents="none">
                <Text style={pendingBadgeStyles.text} numberOfLines={1}>
                  {pendingCount > 99 ? '99+' : pendingCount}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>
      )}
      <ReportPopup
        visible={showReportPopup}
        message={selectedMessage}
        supabaseRoomId={supabaseRoomId}
        onClose={(success) => {
          if (success) {
            handleReportSuccess(selectedMessage.id);
          }
          setSelectedMessage(null);
          setShowReportPopup(false);
        }}
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
        onTranslate={(msg) => handleTranslate(msg)}
        onReport={(msg) => handleReport(msg)}
        onDelete={onDeleteMessage ? (msgId) => onDeleteMessage(msgId) : null}
        onDeleteAll={onDeleteAllMessage ? (senderId) => onDeleteAllMessage(senderId) : null}
        onPinMessage={onPinMessage ? (msg) => onPinMessage(msg) : null}
        isAdminOrMod={isAdminOrMod}
        userId={user?.id}
        isDarkMode={isDarkMode}
      />
    </>
  );
};
export const fruitStyles = StyleSheet.create({
  fruitsWrapper: {
    marginTop: 1,
    // gap: 1,
    backgroundColor: '#1E293B15', // subtle blue-ish bg
    padding: 4,
    borderRadius: 8,

  },
  fruitCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  fruitImage: {
    width: 20,
    height: 20,
    borderRadius: 2,
    marginRight: 2,
    backgroundColor: '#0002',
  },
  fruitInfo: {
    // flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-start',
    // backgroundColor:'red',
    alignItems: 'center'
  },
  fruitName: {
    fontSize: 12,
    fontWeight: '500',
    // color: '#fff',
  },
  fruitValue: {
    fontSize: 11,
    // color: '#e5e5e5',
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    // marginTop: 4,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    // minWidth: 16,
    // justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#fff',
  },
  badgeDefault: {
    backgroundColor: '#FF6666', // D
  },
  badgeNeon: {
    backgroundColor: '#2ecc71', // N
  },
  badgeMega: {
    backgroundColor: '#9b59b6', // M
  },
  badgeFly: {
    backgroundColor: '#3498db', // F
  },
  badgeRide: {
    backgroundColor: '#e74c3c', // R
  },
  totalRow: {
    flexDirection: 'row',
    // justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#ffffff22',
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#888',
  },
  totalValue: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FF6666',
  },
});
const pendingBadgeStyles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  text: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});

export default React.memo(MessagesList);