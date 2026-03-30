import React, { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { getSafeTextColor, RainbowText, isMultiColorText, getMultiColorPalette } from '../../Helper/contrastHelper';
import {
  FlatList,
  View,
  Text,
  RefreshControl,
  Image,
  ActivityIndicator,
  Vibration,
  Keyboard,
  Alert,
  StyleSheet,
  TouchableOpacity,          // 👈 add this
} from 'react-native';
import { Menu, MenuOptions, MenuOption, MenuTrigger } from 'react-native-popup-menu';
import { useGlobalState } from '../../GlobelStats';
import { getThemeColors } from '../../Helper/themeColors';
import { getStyles } from '../Style';
import ReportPopup from '../ReportPopUp';
import { useTranslation } from 'react-i18next';
import Clipboard from '@react-native-clipboard/clipboard';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { showSuccessMessage } from '../../Helper/MessageHelper';
import { useLocalState } from '../../LocalGlobelStats';
import axios from 'axios';
import { getDeviceLanguage } from '../../../i18n';
import { mixpanel } from '../../AppHelper/MixPenel';
import { FRUIT_KEYWORDS } from '../../Helper/filter';
import ScamSafetyBox from './Scamwarning';
import { useNavigation } from '@react-navigation/native';
import config from '../../Helper/Environment';
import { getCachedProfile } from '../../Helper/profileCache';



const PrivateMessageList = ({
  messages,
  userId,
  user,
  selectedUser,
  handleLoadMore,
  refreshing,
  onRefresh,
  isBanned,
  onReply,
  onDeleteMessage,
  onReportSubmit,
  loading,
  canRate,
  hasRated,
  setShowRatingModal,
  isPaginating,
  chatKey, // 👈 Add chatKey to construct messagePath for private messages
  otherLastRead, // 👈 Other user's lastRead timestamp for read receipts
}) => {
  const { theme, isAdmin, api, freeTranslation } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const c = getThemeColors(isDarkMode);
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);

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
  const { t } = useTranslation();
  const deviceLanguage = useMemo(() => getDeviceLanguage(), []);

  // ✅ Pre-compile regex patterns for FRUIT_KEYWORDS
  const fruitRegexPatterns = useMemo(() => {
    return FRUIT_KEYWORDS.map((word, index) => ({
      regex: new RegExp(`\\b${word}\\b`, 'gi'),
      placeholder: `__FRUIT_${index}__`,
      word,
    }));
  }, []);


  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showReportPopup, setShowReportPopup] = useState(false);
  const { triggerHapticFeedback } = useHaptic();

  // Get reply preview text (matching group chat)
  const getReplyPreview = useCallback((replyTo) => {
    if (!replyTo || typeof replyTo !== 'object') return '[Deleted message]';
    if (replyTo.text && typeof replyTo.text === 'string' && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }
    if (replyTo.imageUrl || (Array.isArray(replyTo.imageUrls) && replyTo.imageUrls.length > 0)) {
      return '[Image]';
    }
    if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
      const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
      return count > 0 ? `[${count} pet(s) message]` : '[Pets message]';
    }
    return '[Deleted message]';
  }, []);
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState } = useLocalState();
  const navigation = useNavigation()


  // ✅ Memoize handleCopy
  const handleCopy = useCallback((message) => {
    if (!message || !message.text) return;
    Clipboard.setString(message.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage(t('chat.success'), t('chat.message_copied'));
  }, [triggerHapticFeedback]);

  // ✅ Memoize filteredMessages
  const filteredMessages = useMemo(() => {
    if (!Array.isArray(messages)) return [];
    if (isBanned && userId) {
      return messages.filter((message) => message?.senderId === userId);
    }
    return messages;
  }, [messages, isBanned, userId]);

  // ✅ PERF: Store filteredMessages in a ref so renderMessage doesn't depend on the array
  const filteredMessagesRef = useRef(filteredMessages);
  filteredMessagesRef.current = filteredMessages;

  // ✅ Memoize handleReport
  const handleReport = useCallback((message) => {
    if (!message) return;
    triggerHapticFeedback('impactLight');
    setSelectedMessage(message);
    setShowReportPopup(true);
  }, [triggerHapticFeedback]);

  // ✅ Memoize handleReportSuccess - called when report succeeds
  const handleReportSuccess = useCallback((reportedMessageId) => {
    if (!reportedMessageId) return;
    triggerHapticFeedback('impactLight');
    // Call parent's onReportSubmit if provided
    if (onReportSubmit && typeof onReportSubmit === 'function' && selectedMessage) {
      onReportSubmit(selectedMessage, 'reported');
    }
  }, [onReportSubmit, selectedMessage, triggerHapticFeedback]);
  // console.log(selectedUserId === userId)



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

    const isUnlimited = freeTranslation || localState?.isPro;

    if (!isUnlimited && canTranslate && typeof canTranslate === 'function' && !canTranslate()) {
      Alert.alert(t('chat.translation_limit_title'), t('chat.translation_limit_message'));
      return;
    }

    const translated = await translateText(item.text, deviceLanguage);

    if (translated) {
      if (!isUnlimited && incrementTranslationCount && typeof incrementTranslationCount === 'function') {
        incrementTranslationCount();
      }

      const remaining = isUnlimited ? t('chat.unlimited') : `${getRemainingTranslationTries ? getRemainingTranslationTries() : 0} remaining`;

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
  }, [freeTranslation, localState?.isPro, canTranslate, incrementTranslationCount, getRemainingTranslationTries, translateText, deviceLanguage]);

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

  // ✅ PERF: Store scrollToMessage and highlightedMessageId in refs so renderMessage stays stable
  const scrollToMessageRef = useRef(null);
  const highlightedMessageIdRef = useRef(null);

  // ✅ Memoize renderMessage
  const renderMessage = useCallback(({ item, index }) => {
    const scrollToMessage = scrollToMessageRef.current;
    const highlightedMessageId = highlightedMessageIdRef.current;
    // ✅ Safety checks
    if (!item || typeof item !== 'object') return null;

    const isMyMessage = item.senderId === userId;
    const isHighlighted = highlightedMessageId === item.id;

    // fruits helpers
    const fruits = Array.isArray(item.fruits) ? item.fruits : [];
    const hasFruits = fruits.length > 0;
    const totalFruitValue = hasFruits
      ? fruits.reduce((sum, f) => sum + (Number(f?.value) || 0), 0)
      : 0;

    const profile = getCachedProfile(item.senderId);
    const bubbleBg = profile?.chatBubbleBg;

    const msgBubble = (
      <View
        style={{
          alignSelf: isMyMessage ? 'flex-end' : 'flex-start',
          maxWidth: '80%',
          marginBottom: 6,
          marginHorizontal: 8,
        }}
      >
        {/* WhatsApp-style bubble — no avatar */}
        <View style={{
          backgroundColor: isHighlighted
            ? (isDarkMode ? '#ffffff30' : '#00000015')
            : bubbleBg
              ? (isDarkMode ? bubbleBg.darkColor : bubbleBg.color)
              : isMyMessage
                ? (isDarkMode ? '#0B5E3F' : '#DCF8C6')
                : (isDarkMode ? '#1E293B' : '#FFFFFF'),
          borderRadius: 14,
          borderTopLeftRadius: isMyMessage ? 14 : 3,
          borderTopRightRadius: isMyMessage ? 3 : 14,
          paddingHorizontal: 8,
          paddingVertical: 5,
          shadowColor: '#000',
          shadowOpacity: 0.04,
          shadowRadius: 1.5,
          shadowOffset: { width: 0, height: 1 },
          elevation: 1,
        }}>

          {/* Reply Preview */}
          {item.replyTo && (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => scrollToMessage && scrollToMessage(item.replyTo.id)}
              style={{
                backgroundColor: isDarkMode ? '#ffffff15' : '#00000008',
                borderLeftWidth: 2,
                borderLeftColor: '#1E88E5',
                borderRadius: 4,
                paddingHorizontal: 6,
                paddingVertical: 3,
                marginBottom: 3,
              }}
            >
              <Text style={{ fontSize: 12, color: c.textSecondary }} numberOfLines={1}>
                {t('chat.replying_to')}: {getReplyPreview(item.replyTo)}
              </Text>
            </TouchableOpacity>
          )}

        {/* Message Content */}

        <Menu>
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
          <MenuTrigger
            onLongPress={() => triggerHapticFeedback('impactMedium')}
            customStyles={{ triggerTouchable: { activeOpacity: 1 } }}
          >
            {/* Optional image message */}


            {/* 🐾 Fruits list (your selected pets) */}
            {/* 🐾 Fruits list (your selected pets) */}
            {hasFruits && (
              <View
                style={[
                  fruitStyles.fruitsWrapper,
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


            {/* Normal text (can be empty if only fruits) */}
            {!!item.text && (
              isMultiColorText(profile?.chatTextColor)
                ? <RainbowText
                    colors={getMultiColorPalette(profile.chatTextColor)}
                    style={[{ fontSize: 12, color: c.text, lineHeight: 20 }]}
                  >{item.text}</RainbowText>
                : <Text
                    style={[
                      { fontSize: 12, color: c.text, lineHeight: 20 },
                      profile?.chatTextColor ? { color: getSafeTextColor(profile.chatTextColor, profile?.chatBubbleBg ? (isDarkMode ? profile.chatBubbleBg.darkColor : profile.chatBubbleBg.color) : null) } : null,
                    ]}
                  >
                    {item.text}
                  </Text>
            )}
          </MenuTrigger>

          {/* existing menu options stay the same */}
          <MenuOptions
            customStyles={{
              optionsContainer: styles.menuoptions,
              optionWrapper: styles.menuOption,
              optionText: styles.menuOptionText,
            }}
          >
            <MenuOption onSelect={() => handleCopy(item)}>
              <Text style={styles.menuOptionText}>{t('chat.copy')}</Text>
            </MenuOption>
            <MenuOption onSelect={() => handleTranslate(item)}>
              <Text style={styles.menuOptionText}>{t('chat.translate')}</Text>
            </MenuOption>
            <MenuOption onSelect={() => {
              if (onReply) {
                triggerHapticFeedback('impactLight');
                onReply(item);
              }
            }}>
              <Text style={styles.menuOptionText}>{t('chat.reply', { defaultValue: 'Reply' })}</Text>
            </MenuOption>
            {isMyMessage && onDeleteMessage && (
              <MenuOption onSelect={() => {
                Alert.alert(
                  t('chat.delete_message', { defaultValue: 'Delete Message' }),
                  t('chat.delete_message_confirm', { defaultValue: 'Are you sure you want to delete this message?' }),
                  [
                    { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                    { text: t('common.delete', { defaultValue: 'Delete' }), style: 'destructive', onPress: () => onDeleteMessage(item.id) },
                  ]
                );
              }}>
                <Text style={[styles.menuOptionText, { color: '#EF4444' }]}>{t('chat.delete', { defaultValue: 'Delete' })}</Text>
              </MenuOption>
            )}
            {!isMyMessage && (
              <MenuOption onSelect={() => handleReport(item)}>
                <Text style={styles.menuOptionText}>{t('chat.report')}</Text>
              </MenuOption>
            )}
          </MenuOptions>
        </Menu>

          {/* Timestamp + Read receipts inside bubble — WhatsApp style */}
          <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 2, gap: 3 }}>
            <Text style={{
              fontSize: 9,
              color: isMyMessage
                ? (isDarkMode ? '#ffffffaa' : '#00000066')
                : (isDarkMode ? '#ffffff77' : '#00000055'),
            }}>
              {item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }) : ''}
            </Text>
            {/* ✅ Read receipt ticks for own messages (respects settings toggle) */}
            {isMyMessage && (localState?.showReadReceipts ?? true) && (
              <Text style={{
                fontSize: 12,
                fontWeight: '700',
                color: (otherLastRead && item.timestamp && item.timestamp <= otherLastRead)
                  ? '#53BDEB'  // Blue ticks = read
                  : (isDarkMode ? '#ffffff77' : '#00000044'), // Grey ticks = delivered
                marginLeft: 1,
              }}>
                ✓✓
              </Text>
            )}
          </View>
        </View>
      </View>
    );

    // Date separator: in inverted list, next item in array is older
    const nextMsg = filteredMessagesRef.current[index + 1];
    const showDateSep = !nextMsg || getDateLabel(item.timestamp) !== getDateLabel(nextMsg.timestamp);

    return (
      <>
        {msgBubble}
        {showDateSep && (
          <View style={{ alignItems: 'center', marginVertical: 6 }}>
            <View style={{ backgroundColor: c.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontSize: 11, color: c.textSecondary, fontWeight: '600' }}>
                {getDateLabel(item.timestamp)}
              </Text>
            </View>
          </View>
        )}
      </>
    );
  }, [userId, selectedUser, user, styles, fruitColors, handleCopy, handleTranslate, handleReport, onReply, onDeleteMessage, navigation, t, getDateLabel, isDarkMode, otherLastRead, localState?.showReadReceipts]);

  // ✅ Add FlatList reference and scrollToMessage functionality
  const flatListRef = useRef(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);

  const scrollToMessageTimerRef = useRef(null);
  const scrollToMessage = useCallback((messageId) => {
    if (!flatListRef.current || !filteredMessagesRef.current || filteredMessagesRef.current.length === 0) return;

    // Find the index of the message in the reversed list
    const index = filteredMessagesRef.current.findIndex(msg => String(msg?.id) === String(messageId));

    if (index !== -1) {
      setHighlightedMessageId(messageId);

      flatListRef.current.scrollToIndex({
        index,
        animated: true,
        viewPosition: 0.5,
      });

      if (scrollToMessageTimerRef.current) clearTimeout(scrollToMessageTimerRef.current);
      scrollToMessageTimerRef.current = setTimeout(() => {
        setHighlightedMessageId(null);
      }, 2000);
    } else {
      Alert.alert(t('chat.message_not_found', { defaultValue: 'Message not found or too old.' }));
    }
  }, [t]);

  // Keep refs in sync for renderMessage
  scrollToMessageRef.current = scrollToMessage;
  highlightedMessageIdRef.current = highlightedMessageId;

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (scrollToMessageTimerRef.current) clearTimeout(scrollToMessageTimerRef.current);
    };
  }, []);

  // ✅ Memoize keyExtractor
  const keyExtractor = useCallback((item, index) => {
    return item?.id || `msg-${index}`;
  }, []);

  return (
    <View style={[styles.container]}>
      {loading && messages.length === 0 ? (
        <ActivityIndicator size="large" color="#1E88E5" style={styles.loader} />
      ) : (
        <View style={{ flex: 1 }}>
          <>
            <ScamSafetyBox setShowRatingModal={setShowRatingModal} canRate={canRate} hasRated={hasRated} />

            <FlatList
              ref={flatListRef}
              data={filteredMessages}
              removeClippedSubviews={true}
              keyExtractor={keyExtractor}
              renderItem={renderMessage}
              inverted
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.3}
              onScroll={() => Keyboard.dismiss()}
              onTouchStart={() => Keyboard.dismiss()}
              keyboardShouldPersistTaps="handled"
              maxToRenderPerBatch={10}
              windowSize={10}
              initialNumToRender={15}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
              }
            />
          </>
        </View>

      )}
      <ReportPopup
        visible={showReportPopup}
        message={selectedMessage}
        messagePath={chatKey ? `private_messages/${chatKey}/messages` : null}
        onClose={(success) => {
          if (success) {
            handleReportSuccess(selectedMessage?.id);
          }
          setSelectedMessage(null);
          setShowReportPopup(false);
        }}
      />
    </View>
  );
};
export const fruitStyles = StyleSheet.create({
  fruitsWrapper: {
    marginTop: 1,
    padding: 2,
  },
  fruitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginBottom: 2,
  },
  fruitImage: {
    width: 18,
    height: 18,
    borderRadius: 2,
    marginRight: 2,
  },
  fruitInfo: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  fruitName: {
    fontSize: 11,
    fontWeight: '500',
  },
  fruitValue: {
    fontSize: 10,
    marginTop: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  badge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 8,
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
    alignItems: 'center',
    marginTop: 2,
    paddingTop: 2,
    borderTopWidth: 0.5,
    borderTopColor: '#ffffff22',
  },
  totalLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#888',
  },
  totalValue: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FF6666',
  },
});

export default memo(PrivateMessageList);
