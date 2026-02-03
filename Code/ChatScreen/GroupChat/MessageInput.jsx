import React, { useState, useMemo, useCallback } from 'react';
import { View, TextInput, TouchableOpacity, Text, Modal, StyleSheet, Image, ScrollView } from 'react-native';
import { getStyles } from './../Style';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';
import { useGlobalState } from '../../GlobelStats';
import { validateContent } from '../../Helper/ContentModeration';
import { showMessage } from 'react-native-flash-message';

// ✅ Move Emojies array outside component to prevent recreation
const Emojies = [
  'pic_1.png',
  'pic_2.png',
  'pic_3.png',
  'pic_4.png',
  'pic_5.png',
  'pic_6.png',
  'pic_7.png',
  'pic_8.png',
  'pic_9.png',
  'pic_10.png',
  'pic_11.png',
  'pic_12.png',
  'pic_13.png',
  'pic_14.png',
  'pic_15.png',
  'pic_16.png',
  'pic_17.png',
  'pic_18.png',
  'pic_19.png',
  'pic_20.png',
  'pic_21.png',
  'pic_22.png',
  'pic_23.png',
  'pic_24.png',
  'pic_25.png',
  'pic_26.png',
  'pic_27.png',
  'pic_28.png',
  'pic_29.png',
  'pic_30.png',
  'pic_31.png',
];

const MessageInput = ({
  input,
  setInput,
  handleSendMessage,
  selectedTheme,
  replyTo,
  selectedEmoji, 
  onCancelReply,
  setPetModalVisible,
  selectedFruits,
  setSelectedFruits,
  setSelectedEmoji
}) => {
  // ✅ Memoize styles
  const isDarkMode = selectedTheme?.colors?.text === 'white';
  const styles = useMemo(() => getStyles(isDarkMode), [isDarkMode]);
  
  const [isSending, setIsSending] = useState(false);
  const [messageCount, setMessageCount] = useState(0);

  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const { localState } = useLocalState();
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const [showEmojiPopup, setShowEmojiPopup] = useState(false);

  // ✅ Memoize computed values
  const hasFruits = useMemo(() => Array.isArray(selectedFruits) && selectedFruits.length > 0, [selectedFruits]);
  const hasContent = useMemo(() => {
    return (input || '').trim().length > 0 || hasFruits || !!selectedEmoji;
  }, [input, hasFruits, selectedEmoji]);

  // ✅ Memoize handleSend
  const handleSend = useCallback(async (emojiArg) => {
    triggerHapticFeedback('impactLight');

    const trimmedInput = (input || '').trim();
  
    const emojiFromArg = typeof emojiArg === 'string' ? emojiArg : undefined;
    const emojiToSend  = emojiFromArg || selectedEmoji || null;
    const hasEmoji     = !!emojiToSend;
    const fruits = hasFruits ? [...selectedFruits] : [];
    if (!trimmedInput && !hasFruits && !hasEmoji) return;
    if (isSending) return;

    // ✅ Comprehensive content moderation check
    if (trimmedInput) {
      const validation = validateContent(trimmedInput);
      if (!validation.isValid) {
        showMessage({
          message: validation.reason || "Inappropriate content detected.",
          type: "danger",
          duration: 3000,
        });
        return;
      }
    }

    setIsSending(true);

    const adCallback = () => {
      setIsSending(false);
    };

    try {
      await handleSendMessage(replyTo, trimmedInput, fruits, emojiToSend);

      // Clear input + reply UI
      setInput('');
      setSelectedFruits([]);
      setSelectedEmoji(null)
      if (onCancelReply) onCancelReply();

      // Increment message count then maybe show ad
      const newCount = messageCount + 1;
      setMessageCount(newCount);

      if (!localState?.isPro && newCount % 15 === 0) {
        // Show A/B test interstitial ad only if user is NOT pro (every 15th message)
        InterstitialAdManager.showAd(adCallback);
      } else {
        setIsSending(false);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setIsSending(false);
    }
  }, [input, hasFruits, selectedEmoji, replyTo, handleSendMessage, onCancelReply, setInput, setSelectedFruits, setSelectedEmoji, localState?.isPro, messageCount, triggerHapticFeedback]);

  // ✅ Memoize selectEmoji
  const selectEmoji = useCallback((emojiUrl) => {
    if (!emojiUrl || typeof emojiUrl !== 'string') return;
    setSelectedEmoji(emojiUrl);
    handleSend(emojiUrl);
    setShowEmojiPopup(false);
  }, [handleSend]);
  

  // console.log(selectedFruits);

  return (
    <View style={styles.inputWrapper}>
      {/* Reply context UI */}
      {replyTo && (
        <View style={styles.replyContainer}>
          <Text style={styles.replyText}>
            {t('chat.replying_to')}: {replyTo.text}
          </Text>
          <TouchableOpacity
            onPress={onCancelReply}
            style={styles.cancelReplyButton}
          >
            <Icon name="close-circle" size={24} color="#e74c3c" />
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.inputContainer}>
        <TouchableOpacity
          style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
          onPress={() => setPetModalVisible && setPetModalVisible(true)}
          disabled={isSending}
        >
          <Icon
            name="logo-octocat"
            size={20}
            color={isDark ? '#FFF' : '#000'}
          />
        </TouchableOpacity>

        <TextInput
          style={[styles.input, { color: selectedTheme.colors.text }]}
          placeholder={t('chat.type_message')}
          placeholderTextColor="#888"
          value={input}
          onChangeText={setInput}
          multiline
        />

<TouchableOpacity onPress={() => setShowEmojiPopup(true)} style={styles.gifButton}>
          <Text style={{ fontSize: 25 }}>😊</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor:
                hasContent && !isSending ? '#1E88E5' : config.colors.primary,
            },
          ]}
          onPress={handleSend}
          disabled={isSending || !hasContent}
        >
          <Text style={styles.sendButtonText}>
            {isSending ? t('chat.sending') : t('chat.send')}
          </Text>
        </TouchableOpacity>
      </View>

      {hasFruits && (
        <View
          style={{
            paddingHorizontal: 10,
            paddingTop: 4,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: isDark ? '#ccc' : '#555', fontSize: 12 }}>
            {selectedFruits.length} pet(s) selected
          </Text>

          <TouchableOpacity
            onPress={() => setSelectedFruits([])}
            style={{ marginLeft: 8 }}
          >
            <Icon
              name="close-circle"
              size={18}
              color={isDark ? '#ccc' : '#555'}
            />
          </TouchableOpacity>
        </View>
      )}
      <Modal visible={showEmojiPopup} transparent animationType="slide">
        <TouchableOpacity 
          style={modalStyles.backdrop} 
          onPress={() => setShowEmojiPopup(false)}
          activeOpacity={1}
        >
          <View style={[modalStyles.sheet, { backgroundColor: isDark ? '#1e1e1e' : '#fff' }]} onStartShouldSetResponder={() => true}>
            <ScrollView 
              style={modalStyles.emojiScrollContainer}
              showsVerticalScrollIndicator={false}
            >
              <View style={modalStyles.emojiListContainer}>
                {Emojies.map((item) => {
                  if (!item || typeof item !== 'string') return null;
                  const emojiUrl = `https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/${item}`;
                  return (
                    <TouchableOpacity
                      key={item}
                      onPress={() => selectEmoji(emojiUrl)}
                      style={modalStyles.emojiContainer}
                    >
                      <Image
                        source={{ uri: emojiUrl }}
                        style={modalStyles.emojiImage}
                      />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};
const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '50%',
  },
  emojiScrollContainer: {
    maxHeight: 200,
  },
  emojiListContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  emojiContainer: {
    margin: 10,
    width: 25,
    height: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiImage: {
    width: 25,
    height: 25,
    borderRadius: 8,
  },
});
export default MessageInput;
