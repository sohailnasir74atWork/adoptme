import React, { memo, useMemo, useState, useCallback } from 'react';
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
  onReportSubmit,
  loading,
  canRate,
  hasRated,
  setShowRatingModal,
  isPaginating,
  chatKey, // 👈 Add chatKey to construct messagePath for private messages
}) => {
  const { theme, isAdmin, api, freeTranslation } = useGlobalState();
  const isDarkMode = theme === 'dark';
  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  
  const fruitColors = useMemo(
    () => ({
      wrapperBg: isDarkMode ? '#0f172a55' : '#e5e7eb55',
      name:      isDarkMode ? '#f9fafb' : '#111827',
      value:     isDarkMode ? '#e5e7eb' : '#4b5563',
      divider:   isDarkMode ? '#ffffff22' : '#00000011',
      totalLabel:isDarkMode ? '#e5e7eb' : '#4b5563',
      totalValue:isDarkMode ? '#f97373' : '#b91c1c',
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
  const { canTranslate, incrementTranslationCount, getRemainingTranslationTries, localState } = useLocalState();
  const navigation = useNavigation()


  // ✅ Memoize handleCopy
  const handleCopy = useCallback((message) => {
    if (!message || !message.text) return;
    Clipboard.setString(message.text);
    triggerHapticFeedback('impactLight');
    showSuccessMessage('Success', 'Message Copied');
  }, [triggerHapticFeedback]);

  // ✅ Memoize filteredMessages
  const filteredMessages = useMemo(() => {
    if (!Array.isArray(messages)) return [];
    if (isBanned && userId) {
      return messages.filter((message) => message?.senderId === userId);
    }
    return messages;
  }, [messages, isBanned, userId]);

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
      mixpanel.track("Translation", {lang:targetLang});

      return translated;
    } catch (err) {
      console.error('Translation Error:', err);
      return null;
    }
  }, [fruitRegexPatterns, deviceLanguage, api]);

  // ✅ Memoize handleTranslate
  const handleTranslate = useCallback(async (item) => {
    if (!item || !item.text) {
      Alert.alert('Error', 'Invalid message to translate.');
      return;
    }

    const isUnlimited = freeTranslation || localState?.isPro;
  
    if (!isUnlimited && canTranslate && typeof canTranslate === 'function' && !canTranslate()) {
      Alert.alert('Limit Reached', 'You can only translate 20 messages per day.');
      return;
    }
  
    const translated = await translateText(item.text, deviceLanguage);
  
    if (translated) {
      if (!isUnlimited && incrementTranslationCount && typeof incrementTranslationCount === 'function') {
        incrementTranslationCount();
      }
  
      const remaining = isUnlimited ? 'Unlimited' : `${getRemainingTranslationTries ? getRemainingTranslationTries() : 0} remaining`;
  
      Alert.alert(
        'Translated Message',
        `${translated}\n\n🧠 Daily Limit: ${remaining}${isUnlimited
          ? ''
          : '\n\n🔓 Want more? Upgrade to Pro for unlimited translations.'
        }`
      );
    } else {
      Alert.alert('Error', 'Translation failed. Please try again later.');
    }
  }, [freeTranslation, localState?.isPro, canTranslate, incrementTranslationCount, getRemainingTranslationTries, translateText, deviceLanguage]);
  
  // ✅ Memoize renderMessage
  const renderMessage = useCallback(({ item }) => {
    // ✅ Safety checks
    if (!item || typeof item !== 'object') return null;

    const isMyMessage = item.senderId === userId;
  
    const avatarUri = item.senderId !== userId
      ? selectedUser?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png'
      : user?.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png';
  
    // fruits helpers
    const fruits = Array.isArray(item.fruits) ? item.fruits : [];
    const hasFruits = fruits.length > 0;
    const totalFruitValue = hasFruits
      ? fruits.reduce((sum, f) => sum + (Number(f?.value) || 0), 0)
      : 0;
  
    return (
      <View
        style={
          isMyMessage
            ? [styles.mymessageBubble, styles.myMessage, { width: '80%' }]
            : [styles.othermessageBubble, styles.otherMessage, { width: '80%' }]
        }
      >
        {/* Avatar */}
        <Image
          source={{ uri: avatarUri }}
          style={styles.profileImagePvtChat}
        />
  
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
    {fruits.map((fruit, index )=> {
      const valueType = (fruit.valueType || 'd').toLowerCase(); // 'd' | 'n' | 'm'

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
              style={[fruitStyles.fruitName, { color: fruitColors.name }]}
              numberOfLines={1}
            >
              {`${fruit.name || fruit.Name}  `}
            </Text>

            <Text
              style={[fruitStyles.fruitValue, { color: fruitColors.value }]}
            >
              · Value: {Number(fruit.value || 0).toLocaleString()}
              {/* {fruit.category
                ? `  ·  ${String(fruit.category).toUpperCase()}  `
                : ''} */}{' '}
            </Text>

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

  
            {/* Normal text (can be empty if only fruits) */}
            {!!item.text && (
              <Text
                style={isMyMessage ? styles.myMessageText : styles.otherMessageText}
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
              <Text style={styles.menuOptionText}>Copy</Text>
            </MenuOption>
            <MenuOption onSelect={() => handleTranslate(item)}>
              <Text style={styles.menuOptionText}>Translate</Text>
            </MenuOption>
            {!isMyMessage && (
              <MenuOption onSelect={() => handleReport(item)}>
                <Text style={styles.menuOptionText}>{t('chat.report')}</Text>
              </MenuOption>
            )}
          </MenuOptions>
        </Menu>
  
        <Text style={styles.timestamp}>
          {item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }) : ''}
        </Text>
      </View>
    );
  }, [userId, selectedUser, user, styles, fruitColors, handleCopy, handleTranslate, handleReport, onReply, navigation, t]);

  // ✅ Memoize keyExtractor
  const keyExtractor = useCallback((item, index) => {
    return item?.id || `msg-${index}`;
  }, []);

  return (
    <View style={[styles.container]}>
      {loading && messages.length === 0 ? (
        <ActivityIndicator size="large" color="#1E88E5" style={styles.loader} />
      ) : (
        <View style={{paddingBottom:140}}>  
        <>   
        <ScamSafetyBox setShowRatingModal={setShowRatingModal} canRate={canRate} hasRated={hasRated} />
     
        <FlatList
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
    // gap: 1,
    padding: 4,
    // borderRadius: 8,

  },
  fruitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent:'flex-start',
    marginBottom:3,

    flex:1,


  },
  fruitImage: {
    width: 20,
    height: 20,
    borderRadius: 2,
    marginRight: 2,
  },
  fruitInfo: {
    // flex: 1,
    flexDirection:'row',
    justifyContent:'flex-start',
    // backgroundColor:'red',
    alignItems:'center',
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

export default memo(PrivateMessageList);
