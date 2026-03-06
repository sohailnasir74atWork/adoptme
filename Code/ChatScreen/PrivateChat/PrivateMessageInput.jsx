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

import { Image as CompressorImage } from 'react-native-compressor';
import { launchImageLibrary } from 'react-native-image-picker';
import RNFS from 'react-native-fs';

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2';
const BUNNY_CDN_BASE = 'https://pull-gag.b-cdn.net';

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
      Alert.alert(t('chat.limit_reached'), t('chat.image_limit_reached'));
      return;
    }

    try {
      launchImageLibrary(
        {
          mediaType: 'photo',
          selectionLimit: remainingSlots, // Allow selecting up to remaining slots
          quality: 0.8,
          maxWidth: 1920,
          maxHeight: 1920,
        },
        async (response) => {
          try {
            if (!response || response.didCancel) return;

            if (response.errorCode) {
              console.warn(
                'ImagePicker Error:',
                response.errorCode,
                response.errorMessage,
              );

              if (response.errorCode !== 'activity') {
                Alert.alert(t('chat.error'), t('chat.gallery_error'));
              }
              return;
            }

            const assets = response?.assets || [];
            if (assets.length > 0) {
              const MAX_SIZE_BYTES = 1024 * 1024; // 1 MB
              const validUris = [];
              const rejectedCount = [];

              // Check file size and compress if needed
              for (const asset of assets) {
                if (!asset?.uri || typeof asset.uri !== 'string') continue;

                try {
                  let fileSize = asset.fileSize || 0;

                  // Only use RNFS.stat for file:// URIs (content:// URIs crash stat)
                  if (!fileSize && asset.uri.startsWith('file://')) {
                    try {
                      const filePath = asset.uri.replace('file://', '');
                      const fileInfo = await RNFS.stat(filePath);
                      fileSize = fileInfo.size || 0;
                    } catch (statError) {
                      console.warn('RNFS.stat failed, will compress as fallback:', statError?.message);
                      fileSize = MAX_SIZE_BYTES + 1; // Force compression
                    }
                  } else if (!fileSize) {
                    // content:// or unknown scheme — compress to be safe
                    fileSize = MAX_SIZE_BYTES + 1;
                  }

                  // 🟢 If image > 1MB, compress it
                  if (fileSize > MAX_SIZE_BYTES) {
                    try {
                      const compressedUri = await CompressorImage.compress(asset.uri, {
                        maxWidth: 1024, // Good resolution for chat
                        quality: 0.7,   // Aggressive enough to get under 1MB
                        returnableOutputType: 'uri',
                      });
                      validUris.push(compressedUri);
                    } catch (compError) {
                      console.error('Compression failed:', compError);
                      // Fallback: If compression fails, warn user (or skip)
                      rejectedCount.push(asset.fileName || 'image');
                    }
                  } else {
                    // Image is small enough, use as is
                    validUris.push(asset.uri);
                  }
                } catch (error) {
                  console.warn('Error processing image:', error);
                  // Best effort: try compressing original if processing fails
                  try {
                    const compressedUri = await CompressorImage.compress(asset.uri, {
                      maxWidth: 1024,
                      quality: 0.7,
                      returnableOutputType: 'uri',
                    });
                    validUris.push(compressedUri);
                  } catch (fallbackError) {
                    console.warn('Fallback compression also failed:', fallbackError);
                    rejectedCount.push(asset.fileName || 'image');
                  }
                }
              }

              // Show alert if any images failed compression/check
              if (rejectedCount.length > 0) {
                Alert.alert(
                  t('chat.image_too_large'),
                  t('chat.image_too_large_desc', { count: rejectedCount.length }) // You might want to update this string to 'Failed to process X images'
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
          } catch (callbackError) {
            console.warn('Image picker callback error:', callbackError);
          }
        },
      );
    } catch (launchError) {
      console.warn('Image picker launch error:', launchError);
    }
  }, [isBanned, imageUris.length, t]);

  // 🐰 Upload ONE image to Bunny (no atob)
  const uploadToBunny = useCallback(
    async uri => {
      if (!uri) return null;

      const userId = user?.id ?? 'anon';

      try {
        const filename = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
        const remotePath = `uploads/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
        const uploadUrl = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`;

        // read file as base64 (handle both file:// and content:// URIs)
        const filePath = uri.startsWith('file://') ? uri.replace('file://', '') : uri;
        const base64 = await RNFS.readFile(filePath, 'base64');

        // convert to bytes without atob
        let binary;
        try {
          binary = base64ToBytes(base64);
        } catch (error) {
          console.error('Error converting base64 to bytes:', error);
          Alert.alert(t('chat.error'), t('chat.image_processing_failed'));
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
          Alert.alert(t('chat.error'), t('chat.image_upload_failed'));
          return null;
        }

        return `${BUNNY_CDN_BASE}/${decodeURIComponent(remotePath)}`;
      } catch (e) {
        console.warn('[Bunny ERROR]', e?.message || e);
        Alert.alert(t('chat.error'), t('chat.image_upload_failed'));
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
        Alert.alert(t('chat.error'), t('chat.inappropriate_content'));
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
      if (!localState?.isPro && newCount % 12 === 0) {
        InterstitialAdManager.showAd(() => { });
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
      Alert.alert(t('chat.error'), t('chat.send_error'));
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
    t("chat.quick_msg_interest"),
    t("chat.quick_msg_negotiate"),
    t("chat.quick_msg_best_offer"),
    t("chat.quick_msg_ready"),
    t("chat.quick_msg_check_inv"),
    t("chat.quick_msg_deal_accepted"),
    t("chat.quick_msg_add_more"),
    t("chat.quick_msg_meet_hub"),
    t("chat.quick_msg_what_pets"),
    t("chat.quick_msg_available"),
    t("chat.quick_msg_add_pets"),
    t("chat.quick_msg_fair_trade"),
    t("chat.quick_msg_change_item"),
    t("chat.quick_msg_discuss"),
    t("chat.quick_msg_thanks"),
    t("chat.quick_msg_online"),
    t("chat.quick_msg_when"),
    t("chat.quick_msg_have_item"),
    t("chat.quick_msg_make_deal"),
    t("chat.quick_msg_can_do"),
  ], [t]);

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
            {t('chat.replying_to')} {replyTo?.text || t('chat.message_placeholder')}
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
            {t('chat.attached_images', { count: imageUris.length, suffix: imageUris.length > 1 ? 's' : '' })}
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
            {t('chat.pets_selected', { count: selectedFruits.length })}
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
                {t('chat.quick_messages')}
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
