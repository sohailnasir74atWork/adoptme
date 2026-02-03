import React, { useState, useCallback, useMemo } from 'react';
import { View, TextInput, TouchableOpacity, Text, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStyles } from '../Style';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useTranslation } from 'react-i18next';
import InterstitialAdManager from '../../Ads/IntAd';
import { useLocalState } from '../../LocalGlobelStats';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

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

const GroupMessageInput = ({
  onSend,
  isBanned,
  petModalVisible,
  setPetModalVisible,
  selectedFruits,
  setSelectedFruits,
  replyTo, // Message being replied to
  onCancelReply, // Callback to cancel reply
}) => {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const [imageUris, setImageUris] = useState([]); // Array to hold up to 3 images

  const { localState } = useLocalState();
  const { theme, user } = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();

  const styles = useMemo(() => getStyles(isDark), [isDark]);

  const uploadToBunny = useCallback(async (imagePath) => {
    try {
      const base64 = await RNFS.readFile(imagePath, 'base64');
      const bytes = base64ToBytes(base64);
      const fileName = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
      const filePath = `chat/${fileName}`;

      const response = await fetch(`https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${filePath}`, {
        method: 'PUT',
        headers: {
          AccessKey: BUNNY_ACCESS_KEY,
          'Content-Type': 'image/jpeg',
        },
        body: bytes,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      return `${BUNNY_CDN_BASE}/${filePath}`;
    } catch (error) {
      console.error('Error uploading to BunnyCDN:', error);
      throw error;
    }
  }, []);

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
          console.warn('ImagePicker error:', response.errorMessage);
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
      }
    );
  }, [isBanned, imageUris.length]);

  const handleSend = useCallback(async () => {
    if (isSending) return;

    const textToSend = input.trim();
    const imagesToSend = Array.isArray(imageUris) && imageUris.length > 0 ? [...imageUris] : [];
    const fruitsToSend = Array.isArray(selectedFruits) ? selectedFruits : [];

    if (!textToSend && imagesToSend.length === 0 && fruitsToSend.length === 0) {
      return;
    }

    setIsSending(true);
    setInput('');
    setImageUris([]);
    if (setSelectedFruits && typeof setSelectedFruits === 'function') {
      setSelectedFruits([]);
    }

    setMessageCount((prevCount) => {
      const newCount = prevCount + 1;
      if (!localState?.isPro && newCount % 15 === 0) {
        // Show A/B test interstitial ad every 15th message for non-pro users
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

      await onSend(textToSend, imageUrlToSend, fruitsToSend, replyTo);
      
      // Clear reply after successful send
      if (onCancelReply) {
        onCancelReply();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message.');
    } finally {
      setIsSending(false);
    }
  }, [
    input,
    imageUris,
    selectedFruits,
    isSending,
    onSend,
    setSelectedFruits,
    localState?.isPro,
    uploadToBunny,
    replyTo,
    onCancelReply,
  ]);

  const hasFruits = useMemo(
    () => Array.isArray(selectedFruits) && selectedFruits.length > 0,
    [selectedFruits]
  );

  const hasContent = useMemo(
    () => (input || '').trim().length > 0 || (Array.isArray(imageUris) && imageUris.length > 0) || hasFruits,
    [input, imageUris, hasFruits]
  );

  // Get reply preview text
  const getReplyPreview = (replyTo) => {
    if (!replyTo) return '[Deleted message]';
    if (replyTo.text && replyTo.text.trim().length > 0) {
      return replyTo.text;
    }
    if (replyTo.imageUrl) {
      return '[Image]';
    }
    if (replyTo.hasFruits || (Array.isArray(replyTo.fruits) && replyTo.fruits.length > 0)) {
      const count = replyTo.fruitsCount || (Array.isArray(replyTo.fruits) ? replyTo.fruits.length : 0);
      return count > 0 ? `[${count} pet(s) message]` : '[Pets message]';
    }
    return '[Deleted message]';
  };

  return (
    <View style={styles.inputWrapper}>
      {/* Reply context UI */}
      {replyTo && (
        <View style={[styles.replyContainer, { 
          backgroundColor: isDark ? '#374151' : '#E5E7EB',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }]}>
          <Text style={[styles.replyText, { color: isDark ? '#9CA3AF' : '#6B7280', flex: 1 }]} numberOfLines={1}>
            {t('chat.replying_to')}: {getReplyPreview(replyTo)}
          </Text>
          <TouchableOpacity
            onPress={onCancelReply}
            style={styles.cancelReplyButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="close" size={18} color={isDark ? '#9CA3AF' : '#6B7280'} />
          </TouchableOpacity>
        </View>
      )}
      <View style={styles.inputContainer}>
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
          <Icon name="logo-octocat" size={20} color={isDark ? '#FFF' : '#000'} />
        </TouchableOpacity>

        {/* Attach image */}
        <TouchableOpacity
          style={[styles.sendButton, { marginRight: 3, paddingHorizontal: 3 }]}
          onPress={handlePickImage}
          disabled={isSending || isBanned}
        >
          <Icon name="attach" size={20} color={isDark ? '#FFF' : '#000'} />
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
              backgroundColor: hasContent && !isSending ? '#1E88E5' : config.colors.primary,
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
              <Icon name="close-circle" size={18} color={isDark ? '#ccc' : '#555'} />
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
            <Icon name="close-circle" size={18} color={isDark ? '#ccc' : '#555'} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

export default GroupMessageInput;

