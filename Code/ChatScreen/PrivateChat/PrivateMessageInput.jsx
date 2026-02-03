import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  Alert,
  Modal,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../Style';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import { validateContent } from '../../Helper/ContentModeration';

import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY   = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE     = 'https://pull-gag.b-cdn.net';

// ✅ Move base64ToBytes outside component (pure function)
const base64ToBytes = (base64) => {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('Invalid base64 input');
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = base64.replace(/[\r\n]+/g, '');
  let output = [];

  let i = 0;
  while (i < str.length) {
    const enc1 = chars.indexOf(str.charAt(i++));
    const enc2 = chars.indexOf(str.charAt(i++));
    const enc3 = chars.indexOf(str.charAt(i++));
    const enc4 = chars.indexOf(str.charAt(i++));

    // ✅ Safety check for invalid characters
    if (enc1 === -1 || enc2 === -1 || enc3 === -1 || enc4 === -1) {
      throw new Error('Invalid base64 character');
    }

    const chr1 = (enc1 << 2) | (enc2 >> 4);
    const chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    const chr3 = ((enc3 & 3) << 6) | enc4;

    if (enc3 !== 64) {
      output.push(chr1, chr2);
    } else {
      output.push(chr1);
    }
    if (enc4 !== 64 && enc3 !== 64) {
      output.push(chr3);
    }
  }

  return Uint8Array.from(output);
};

const PrivateMessageInput = ({
  onSend,
  replyTo,
  onCancelReply,
  isBanned,
  petModalVisible,
  setPetModalVisible,
  selectedFruits,
  setSelectedFruits,
}) => {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const [imageUris, setImageUris] = useState([]); // Array to hold up to 3 images
  const [showTemplateDrawer, setShowTemplateDrawer] = useState(false);

  const { localState } = useLocalState();
  const { theme, user } = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDark), [isDark]);

  // ✅ Memoize handlePickImage
  const handlePickImage = useCallback(async () => {
    if (isBanned) return;

    // Calculate how many more images can be selected
    const currentCount = imageUris.length;
    const maxImages = 3;
    const remainingSlots = maxImages - currentCount;

    if (remainingSlots <= 0) {
      Alert.alert('Limit Reached', 'You can only select up to 3 images per message.');
      return;
    }

    launchImageLibrary(
      {
        mediaType: 'photo',
        selectionLimit: remainingSlots, // Allow selecting up to remaining slots
      },
      async (response) => {
        if (!response || response.didCancel) return;

        if (response.errorCode) {
          console.warn(
            'ImagePicker Error:',
            response.errorCode,
            response.errorMessage,
          );

          if (response.errorCode !== 'activity') {
            Alert.alert('Error', 'Could not open gallery.');
          }
          return;
        }

        const assets = response.assets || [];
        if (assets.length > 0) {
          const MAX_SIZE_BYTES = 1024 * 1024; // 1 MB
          const validUris = [];
          const rejectedCount = [];

          // Check file size for each image
          for (const asset of assets) {
            if (!asset?.uri || typeof asset.uri !== 'string') continue;

            try {
              const filePath = asset.uri.replace('file://', '');
              const fileInfo = await RNFS.stat(filePath);
              const fileSize = fileInfo.size || 0;

              if (fileSize > MAX_SIZE_BYTES) {
                rejectedCount.push(asset.fileName || 'image');
                continue;
              }

              validUris.push(asset.uri);
            } catch (error) {
              console.warn('Error checking file size:', error);
              // If we can't check size, allow it (better UX than blocking)
              validUris.push(asset.uri);
            }
          }

          // Show alert if any images were rejected
          if (rejectedCount.length > 0) {
            Alert.alert(
              'Image Too Large',
              `${rejectedCount.length} image(s) exceed 1 MB limit and were not added. Please select smaller images.`
            );
          }

          // Add valid images to existing ones, but cap at 3 total
          if (validUris.length > 0) {
            setImageUris(prev => {
              const combined = [...prev, ...validUris];
              return combined.slice(0, maxImages); // Ensure we never exceed 3
            });
          }
        }
      },
    );
  }, [isBanned, imageUris.length]);

  // 🐰 Upload ONE image to Bunny (no atob)
  const uploadToBunny = useCallback(
    async uri => {
      if (!uri) return null;

      const userId = user?.id ?? 'anon';

      try {
        const filename   = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
        const remotePath = `uploads/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
        const uploadUrl  = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`;

        // read file as base64
        const base64 = await RNFS.readFile(uri.replace('file://', ''), 'base64');

        // convert to bytes without atob
        let binary;
        try {
          binary = base64ToBytes(base64);
        } catch (error) {
          console.error('Error converting base64 to bytes:', error);
          Alert.alert('Error', 'Image processing failed.');
          return null;
        }

        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            AccessKey: BUNNY_ACCESS_KEY,
            'Content-Type': 'application/octet-stream',
          },
          body: binary,
        });

        const txt = await res.text().catch(() => '');
        if (!res.ok) {
          console.warn('Bunny upload failed', res.status, txt);
          Alert.alert('Error', 'Image upload failed, sending message without image.');
          return null;
        }

        return `${BUNNY_CDN_BASE}/${decodeURIComponent(remotePath)}`;
      } catch (e) {
        console.warn('[Bunny ERROR]', e?.message || e);
        Alert.alert('Error', 'Image upload failed, sending message without image.');
        return null;
      }
    },
    [user?.id],
  );

  // ✅ Memoize handleSend
  const handleSend = useCallback(async () => {
    const trimmedInput = (input || '').trim();
    const hasImages = Array.isArray(imageUris) && imageUris.length > 0;
    const hasFruits = Array.isArray(selectedFruits) && selectedFruits.length > 0;

    // nothing to send
    if (!trimmedInput && !hasImages && !hasFruits) return;
    if (isSending) return;

    // ✅ Comprehensive content moderation check
    if (trimmedInput) {
      const validation = validateContent(trimmedInput);
      if (!validation.isValid) {
        Alert.alert('Error', validation.reason || 'Inappropriate content detected.');
        return;
      }
    }

    // ✅ Validate onSend callback
    if (!onSend || typeof onSend !== 'function') {
      console.error('❌ onSend callback is not a function');
      return;
    }

    setIsSending(true);

    // snapshot current data
    const textToSend = trimmedInput;
    const imagesToSend = Array.isArray(imageUris) && imageUris.length > 0 ? [...imageUris] : [];
    const fruitsToSend = Array.isArray(selectedFruits) ? [...selectedFruits] : [];

    // clear UI
    setInput('');
    setImageUris([]);
    if (setSelectedFruits && typeof setSelectedFruits === 'function') {
      setSelectedFruits([]);
    }

    setMessageCount(prevCount => {
      const newCount = prevCount + 1;
      if (!localState?.isPro && newCount % 15 === 0) {
        InterstitialAdManager.showAd(() => {});
      }
      return newCount;
    });

    try {
      let imageUrls = [];

      // Upload all images in parallel
      if (imagesToSend.length > 0) {
        const uploadPromises = imagesToSend.map(uri => uploadToBunny(uri));
        imageUrls = await Promise.all(uploadPromises);
        // Filter out any failed uploads (null values)
        imageUrls = imageUrls.filter(url => url !== null);
      }

      // Send single image URL if only one, or array if multiple
      const imageUrlToSend = imageUrls.length === 1 ? imageUrls[0] : (imageUrls.length > 1 ? imageUrls : null);

      // 🔺 onSend: text, imageUrl (single or array), fruits
      await onSend(textToSend, imageUrlToSend, fruitsToSend);

      if (onCancelReply && typeof onCancelReply === 'function') {
        onCancelReply();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message.');
    } finally {
      setIsSending(false); // ✅ always reset
    }
  }, [input, imageUris, selectedFruits, isSending, onSend, onCancelReply, setSelectedFruits, localState?.isPro, uploadToBunny]);

  // ✅ Memoize hasFruits and hasContent
  const hasFruits = useMemo(() =>
    Array.isArray(selectedFruits) && selectedFruits.length > 0,
    [selectedFruits]
  );

  const hasContent = useMemo(() =>
    (input || '').trim().length > 0 || (Array.isArray(imageUris) && imageUris.length > 0) || hasFruits,
    [input, imageUris, hasFruits]
  );

  // ✅ Quick message templates for Adopt Me trading (matching blox style)
  const messageTemplates = useMemo(() => [
    "Interested in your trade!",
    "Can we negotiate?",
    "What's your best offer?",
    "I'm ready to trade!",
    "Let me check my inventory",
    "Deal accepted!",
    "Can you add more?",
    "Meet me at the trading hub",
    "What pets do you have?",
    "Is this still available?",
    "I'll add more pets",
    "Fair trade, let's do it!",
    "Can you change something?",
    "I'm interested, let's discuss",
    "Thanks for the trade!",
    "Are you online?",
    "When can you trade?",
    "I have what you need",
    "Let's make a deal!",
    "Can we do this trade?",
  ], []);

  // Handle template selection
  const handleTemplateSelect = useCallback(async (template) => {
    setShowTemplateDrawer(false);
    if (onSend && typeof onSend === 'function') {
      await onSend(template, null, []);
    }
  }, [onSend]);

  return (
    <View style={styles.inputWrapper}>
      {/* Reply Context */}
      {replyTo && (
        <View style={styles.replyContainer}>
          <Text style={styles.replyText}>
            Replying to: {replyTo?.text || '[Message]'}
          </Text>
          <TouchableOpacity
            onPress={() => {
              if (onCancelReply && typeof onCancelReply === 'function') {
                onCancelReply();
              }
            }}
            style={styles.cancelReplyButton}
          >
            <Icon name="close-circle" size={24} color="#e74c3c" />
          </TouchableOpacity>
        </View>
      )}

      {/* Input + Actions */}
      <View style={styles.inputContainer}>
        {/* Message Templates Drawer Icon */}
        <TouchableOpacity
          style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
          onPress={() => setShowTemplateDrawer(true)}
          disabled={isSending || isBanned}
        >
          <Icon
            name="chatbubbles-outline"
            size={20}
            color={isDark ? '#FFF' : '#000'}
          />
        </TouchableOpacity>

        {/* Pets drawer icon */}
        <TouchableOpacity
          style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
          onPress={() => {
            if (setPetModalVisible && typeof setPetModalVisible === 'function') {
              setPetModalVisible(true);
            }
          }}
          disabled={isSending || isBanned}
        >
          <Icon
            name="logo-octocat"
            size={20}
            color={isDark ? '#FFF' : '#000'}
          />
        </TouchableOpacity>

        {/* Attach image */}
        <TouchableOpacity
          style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
          onPress={handlePickImage}
          disabled={isSending || isBanned}
        >
          <Icon
            name="attach"
            size={20}
            color={isDark ? '#FFF' : '#000'}
          />
        </TouchableOpacity>

        <TextInput
          style={[styles.input, { color: isDark ? '#FFF' : '#000' }]}
          placeholder={t('chat.type_message')}
          placeholderTextColor="#888"
          value={input}
          onChangeText={setInput}
          multiline
          editable={!isBanned}
        />

        {/* Send */}
        <TouchableOpacity
          style={[
            styles.sendButton,
            {
              backgroundColor:
                hasContent && !isSending ? '#1E88E5' : config.colors.primary,
            },
          ]}
          onPress={handleSend}
          disabled={!hasContent || isSending || isBanned}
        >
          <Text style={styles.sendButtonText}>
            {isSending ? t('chat.sending') : t('chat.send')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Attached images indicator */}
      {Array.isArray(imageUris) && imageUris.length > 0 && (
        <View
          style={{
            paddingHorizontal: 10,
            paddingTop: 4,
            flexDirection: 'row',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Text style={{ color: isDark ? '#ccc' : '#555', fontSize: 12, marginRight: 8 }}>
            {imageUris.length} image{imageUris.length > 1 ? 's' : ''} attached
          </Text>
          {imageUris.map((uri, index) => (
            <TouchableOpacity
              key={`${uri}-${index}`}
              onPress={() => {
                setImageUris(prev => prev.filter((_, i) => i !== index));
              }}
              style={{ marginLeft: 4 }}
            >
              <Icon
                name="close-circle"
                size={18}
                color={isDark ? '#ccc' : '#555'}
              />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Selected fruits indicator */}
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
            onPress={() => {
              if (setSelectedFruits && typeof setSelectedFruits === 'function') {
                setSelectedFruits([]);
              }
            }}
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

      {/* Message Templates Drawer Modal */}
      <Modal
        visible={showTemplateDrawer}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowTemplateDrawer(false)}
      >
        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            justifyContent: 'flex-end',
          }}
          activeOpacity={1}
          onPress={() => setShowTemplateDrawer(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={(e) => e.stopPropagation()}
            style={{
              backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              maxHeight: '60%',
              paddingBottom: 20,
            }}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 20,
                borderBottomWidth: 1,
                borderBottomColor: isDark ? '#374151' : '#E5E7EB',
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: '600',
                  color: isDark ? '#FFF' : '#000',
                }}
              >
                Quick Messages
              </Text>
              <TouchableOpacity onPress={() => setShowTemplateDrawer(false)}>
                <Icon name="close" size={24} color={isDark ? '#FFF' : '#000'} />
              </TouchableOpacity>
            </View>

            {/* Templates List */}
            <ScrollView
              style={{ padding: 16 }}
              showsVerticalScrollIndicator={false}
            >
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  gap: 10,
                }}
              >
                {messageTemplates.map((template, index) => (
                  <TouchableOpacity
                    key={index}
                    onPress={() => handleTemplateSelect(template)}
                    disabled={isSending || isBanned}
                    style={{
                      paddingHorizontal: 16,
                      paddingVertical: 12,
                      borderRadius: 20,
                      backgroundColor: isDark ? '#374151' : '#E5E7EB',
                      borderWidth: 1,
                      borderColor: isDark ? '#4B5563' : '#D1D5DB',
                      minWidth: '45%',
                    }}
                  >
                    <Text
                      style={{
                        color: isDark ? '#F9FAFB' : '#111827',
                        fontSize: 14,
                        fontWeight: '500',
                        textAlign: 'center',
                      }}
                    >
                      {template}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

export default PrivateMessageInput;
