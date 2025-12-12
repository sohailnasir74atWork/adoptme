import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, Modal, StyleSheet, Image } from 'react-native';
import { getStyles } from './../Style';
import Icon from 'react-native-vector-icons/Ionicons';
import config from '../../Helper/Environment';
import { useHaptic } from '../../Helper/HepticFeedBack';
import { useTranslation } from 'react-i18next';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';
import { useGlobalState } from '../../GlobelStats';
const Emojies = [
  '1.png',
  '2.png',
  '3.png',
  '4.png',
  '5.png',
  '6.png',
  '7.png',
  '8.png',
  '9.png',
  '10.png',
  '11.png',
  '12.png',
  '13.png',
  '14.png',
  '15.png',
  '16.png'
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
  const styles = getStyles(selectedTheme?.colors?.text === 'white');
  const [isSending, setIsSending] = useState(false);
  const [messageCount, setMessageCount] = useState(0);

  const { triggerHapticFeedback } = useHaptic();
  const { t } = useTranslation();
  const { localState } = useLocalState();
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const [showEmojiPopup, setShowEmojiPopup] = useState(false); // To show the emoji selection popup


  const hasFruits = Array.isArray(selectedFruits) && selectedFruits.length > 0;
  const hasContent = (input || '').trim().length > 0 || hasFruits || selectedEmoji;

  const handleSend = async (emojiArg) => {
    triggerHapticFeedback('impactLight');

    const trimmedInput = (input || '').trim();
  
    const emojiFromArg = typeof emojiArg === 'string' ? emojiArg : undefined;
    const emojiToSend  = emojiFromArg || selectedEmoji || null;
    const hasEmoji     = !!emojiToSend;
    const fruits = hasFruits ? [...selectedFruits] : [];
    if (!trimmedInput && !hasFruits && !hasEmoji) return;
    if (isSending) return;

    setIsSending(true);

    const adCallback = () => {
      setIsSending(false);
    };

    try {
      await handleSendMessage(replyTo, trimmedInput, fruits, emojiToSend);

      // Clear input + reply UI
      setInput('');
      setSelectedFruits([]);
      if (onCancelReply) onCancelReply();

      // Increment message count then maybe show ad
      const newCount = messageCount + 1;
      setMessageCount(newCount);

      if (!localState?.isPro && newCount % 5 === 0) {
        // Show ad only if user is NOT pro
        InterstitialAdManager.showAd(adCallback);
      } else {
        setIsSending(false);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      setIsSending(false);
    }
  };
  const selectEmoji = (emojiUrl) => {
    // if (gifAllowed) {
      setSelectedEmoji(emojiUrl);
      handleSend(emojiUrl);
       setShowEmojiPopup(false);   // close picker
  };
  

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
  <TouchableOpacity style={modalStyles.backdrop} onPress={() => setShowEmojiPopup(false)}>
    <View style={modalStyles.sheet} onPress={(e) => e.stopPropagation()}>
      <View style={modalStyles.emojiListContainer}>
        {Emojies.map((item) => (
          <TouchableOpacity
            key={item}
            onPress={() => selectEmoji(`https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/${item}`)}
            style={modalStyles.emojiContainer}
          >
            <Image
              source={{ uri: `https://bloxfruitscalc.com/wp-content/uploads/2025/Emojies/${item}` }}
              style={modalStyles.emojiImage}
            />
          </TouchableOpacity>
        ))}
      </View>
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
    backgroundColor: '#fff',
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  emojiListContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap', // Allows emojis to wrap when they overflow
    justifyContent: 'space-between', // Aligns items to the start
    marginTop: 10,
  },
  emojiContainer: {
    margin: 10,
    width: 50, // emoji width
    height: 50, // emoji height
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiImage: {
    width: 50,
    height: 50,
    borderRadius: 8,
  },
});
export default MessageInput;
