import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  FlatList,
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  Vibration,
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
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../../GlobelStats';
import Clipboard from '@react-native-clipboard/clipboard';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import axios from 'axios';
import { useLocalState } from '../../LocalGlobelStats';
import { getDeviceLanguage } from '../../../i18n';
import { mixpanel } from '../../AppHelper/MixPenel';
import { FRUIT_KEYWORDS } from '../../Helper/filter';
import MessageActionDrawer from './MessageActionDrawer';


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

}) => {
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [actionDrawerVisible, setActionDrawerVisible] = useState(false);
  const { triggerHapticFeedback } = useHaptic();
  const scrollButtonOpacity = useMemo(() => new Animated.Value(0), []);

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



  const scrollToMessage = useCallback(
    (targetId) => {
      if (!flatListRef?.current || !targetId) return;

      const index = messages.findIndex((m) => m.id === targetId);
      if (index === -1) return;

      try {
        flatListRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.5,
        });

        // highlight only the scrolled-to message
        setHighlightedMessageId(targetId);

        setTimeout(() => {
          setHighlightedMessageId((current) =>
            current === targetId ? null : current,
          );
        }, 1500);
      } catch (e) {
        console.log('scrollToIndex error:', e);
      }
    },
    [flatListRef, messages],
  );

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
      value: isDarkMode ? '#e5e7eb' : '#4b5563',
      divider: isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel: isDarkMode ? '#e5e7eb' : '#4b5563',
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

    const previousMessage = messages[index + 1];
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
    // console.log(user.id)

    // Winner badge info comes directly from message payload, similar to isPro / robloxUsernameVerified
    const hasRecentWin =
      !!item?.hasRecentGameWin ||
      (typeof item?.lastGameWinAt === 'number' &&
        Date.now() - item.lastGameWinAt <= 24 * 60 * 60 * 1000);

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
            style={[
              item.senderId === user?.id ? styles.mymessageBubble : styles.othermessageBubble,
              item.senderId === user?.id ? styles.myMessage : styles.otherMessage, item.isReportedByUser && styles.reportedMessage,
              item.id === highlightedMessageId && styles.highlightedMessage, // 👈 NEW
            ]}
          >
            <View
              style={[
                styles.senderName,
              ]}
            >

              <TouchableOpacity onPress={() => handleProfileClick(item)} style={styles.profileImagecontainer}>
                <Image
                  source={{
                    uri: item.avatar
                      ? item.avatar
                      : 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png',
                  }}
                  style={styles.profileImage}
                />
              </TouchableOpacity>

            </View>

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

                <View style={[
                  item.senderId === user?.id ? styles.mymessageBubble : styles.othermessageBubble,
                  item.senderId === user?.id ? styles.myMessage : styles.otherMessage,
                  item.isReportedByUser && styles.reportedMessage,
                ]}>

                  <View style={[item.senderId === user?.id ? styles.myMessageText : styles.otherMessageText, isAdminOrMod && item.strikeCount === 1
                    ? { backgroundColor: 'pink' }
                    : isAdminOrMod && item.strikeCount >= 2
                      ? { backgroundColor: 'red' }
                      : null,]}>
                    <View style={styles.nameRow}>
                      <Text style={styles.userNameText}>{item.sender}</Text>

                      {item?.isPro && (
                        <Image
                          source={require('../../../assets/pro.png')}
                          style={styles.icon}
                        />
                      )}

                      {!!item.isAdmin && (
                        <View style={styles.adminContainer}>
                          <Icon name="shield" size={10} color="#fff" />
                          <Text style={styles.adminBadgeText}>{t("chat.admin")}</Text>
                        </View>
                      )}

                      {!item.isAdmin && item.isModerator && (
                        <View style={styles.modContainer}>
                          <Icon name="shield-checkmark" size={10} color="#fff" />
                          <Text style={styles.modBadgeText}>{t("chat.mod")}</Text>
                        </View>
                      )}

                      {item?.robloxUsernameVerified && (
                        <Image
                          source={require('../../../assets/verification.png')}
                          style={styles.icon}
                        />
                      )}

                      {hasRecentWin && (
                        <Image
                          source={require('../../../assets/trophy.webp')}
                          style={{
                            width: 10,
                            height: 10,
                            marginLeft: 4,
                          }}
                        />
                      )}

                      {isAdmin && item.OS && (
                        <View
                          style={[
                            styles.platformBadge,
                          ]}
                        >
                          <Icon
                            name={item.OS === 'ios' ? 'logo-apple' : 'logo-android'}
                            size={14}
                            color={item.OS === 'ios' ? '#007AFF' : '#34C759'}
                          />
                        </View>
                      )}
                    </View>



                    {item.gif && (
                      <View>
                        <Image
                          source={{ uri: item.gif }}
                          style={{ height: 50, width: 50, resizeMode: 'contain' }}
                        />
                      </View>
                    )}
                    {/* {'\n'} */}
                    {item?.text && (
                      <Text style={item.senderId === user?.id ? styles.myMessageTextOnly : styles.otherMessageTextOnly}>
                        {parseMessageText(item.text)}
                      </Text>
                    )}




                  </View>
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

              {/* {(item.reportCount > 0 || item.isReportedByUser) && (
              <Text style={styles.reportIcon}>Reported</Text>
            )} */}


            </View>


            {/* Admin Actions or Timestamp */}


            <View style={{ flex: 1, justifyContent: 'flex-end' }}>
              <Text style={styles.timestamp}>
                {new Date(item.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>

            </View>
            {(!isAdminOrMod && item.senderId === user?.id) && (
              <Menu>
                <MenuTrigger>
                  <Icon
                    name="ellipsis-vertical-outline"
                    size={16}
                    color={config.colors.hasBlockGreen}
                  />
                </MenuTrigger>
                <MenuOptions >
                  {/* <MenuOption onSelect={() => onPinMessage(item)} style={styles.pinButton}>
                    <Text style={styles.adminTextAction}>Pin</Text>
                  </MenuOption> */}
                  <MenuOption onSelect={() => onDeleteMessage(item.id)} >
                    <Text style={[{ backgroundColor: 'red', padding: 10, color: 'white' }]}>{t('chat.delete')}</Text>
                  </MenuOption>





                  {/* {isAdmin && (
                    <MenuOption onSelect={() => makeadmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Make Admin</Text>
                    </MenuOption>
                  )}
                  {isAdmin && (
                    <MenuOption onSelect={() => removeAdmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Remove Admin</Text>
                    </MenuOption>
                  )} */}
                </MenuOptions>
              </Menu>
            )}
            {(isAdminOrMod) && (
              <Menu>
                <MenuTrigger>
                  <Icon
                    name="ellipsis-vertical-outline"
                    size={16}
                    color={config.colors.hasBlockGreen}
                  />
                </MenuTrigger>
                <MenuOptions>
                  <View style={styles.adminActions}>
                    {/* <MenuOption onSelect={() => onPinMessage(item)} style={styles.pinButton}>
                    <Text style={styles.adminTextAction}>Pin</Text>
                  </MenuOption> */}
                    <MenuOption onSelect={() => onDeleteMessage(item.id)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>{t('chat.delete')}</Text>
                    </MenuOption>
                    <MenuOption onSelect={() => onDeleteAllMessage(item?.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>{t('chat.delete_all')}</Text>
                    </MenuOption>
                    <MenuOption onSelect={() => onPinMessage(item)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>{t('chat.pin_message')}</Text>
                    </MenuOption>

                    {/* {isAdmin && (
                    <MenuOption onSelect={() => makeadmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Make Admin</Text>
                    </MenuOption>
                  )}
                  {isAdmin && (
                    <MenuOption onSelect={() => removeAdmin(item.senderId)} style={styles.deleteButton}>
                      <Text style={styles.adminTextAction}>Remove Admin</Text>
                    </MenuOption>
                  )} */}
                  </View>
                </MenuOptions>
              </Menu>
            )}
          </View>
        )}
      </View>
    );
  }, [messages, highlightedMessageId, user?.id, styles, getReplyPreview, handleCopy, handleTranslate, handleReport, handleLongPress, handleProfileClick, scrollToMessage, isAdmin, isAdminOrMod, t, fruitColors, onReply, onDeleteMessage, onDeleteAllMessage, onReaction, isDarkMode]);

  return (
    <>
      <FlatList
        data={messages}
        keyExtractor={(item, index) => `${item.id}-${index}`}
        renderItem={({ item, index }) => renderMessage({ item, index })}
        contentContainerStyle={styles.chatList}
        inverted
        extraData={highlightedMessageId}
        ref={flatListRef}
        scrollEventThrottle={16}
        removeClippedSubviews={false}
        onScroll={({ nativeEvent }) => {
          const { contentOffset } = nativeEvent;
          const atBottom = contentOffset.y <= 60;
          // console.log("✅ isAtBottom (detected):", atBottom);
          setIsAtBottom(atBottom);
        }}
        onEndReachedThreshold={0.1}
        onEndReached={handleLoadMore}
        initialNumToRender={20} // Render the first 20 messages upfront
        maxToRenderPerBatch={10} // Render 10 items per batch for smoother performance
        windowSize={5} // Adjust the window size for rendering nearby items

        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={isDarkMode ? '#FFF' : '#000'}
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
          </TouchableOpacity>
        </Animated.View>
      )}
      <ReportPopup
        visible={showReportPopup}
        message={selectedMessage}
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

    flex: 1,

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
export default MessagesList;