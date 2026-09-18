import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import SwipeableBottomDrawer from '../../Helper/SwipeableBottomDrawer';
import {
  SAFE_TEMPLATES,
  TEMPLATE_CATEGORIES,
  GAME_ID_TEMPLATE_ID,
  isValidGameId,
} from '../safeTemplates';


import { safeCompressImage } from '../../Helper/safeCompressImage';
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
  chatBlockedBy,
  chatType,
  petModalVisible,
  setPetModalVisible,
  selectedFruits,
  setSelectedFruits,
  chatKey,
  userId,
  // Safe chat: set when either participant is under 13 (see Helper/ageGate.js).
  // 'me' | 'them' | 'both' | null. Swaps the free-text box for the vetted
  // template picker and hides image attachment. UX only — the authority is the
  // Postgres trigger in supabase/028_safe_chat_minors.sql.
  safeChatMode = null,
}) => {
  const insets = useSafeAreaInsets();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messageCount, setMessageCount] = useState(0);
  const [imageUris, setImageUris] = useState([]); // Array to hold up to 3 images
  const [showTemplateDrawer, setShowTemplateDrawer] = useState(false);

  const { localState } = useLocalState();
  const { theme, user, isAdmin } = useGlobalState();
  const isSafeChat = !!safeChatMode;
  // The one non-fixed string safe chat allows, and only if it is already saved
  // on the sender's profile — Settings round-trips it through the real Roblox
  // API, so it is a genuine moderated account name rather than free text.
  const myGameId = user?.robloxUsername || null;
  const canShareGameId = isValidGameId(myGameId);
  // Admins and full moderators (not baby mods) bypass content moderation.
  const canBypassModeration = !!isAdmin || (!!user?.isModerator && !user?.isBabyMod);
  const isDark = theme === 'dark';
  const { t } = useTranslation();

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDark), [isDark]);

  // Handle text change
  const handleTextChange = useCallback((text) => {
    setInput(text);
  }, []);

  // ✅ Memoize handlePickImage
  const handlePickImage = useCallback(async () => {
    if (isBanned) return;
    // Belt-and-braces: the button is not rendered in safe chat, but any other
    // route into this handler must not be able to attach a photo to a thread
    // that involves a child.
    if (isSafeChat) return;

    // Calculate how many more images can be selected
    const currentCount = imageUris.length;
    const maxImages = 3;
    const remainingSlots = maxImages - currentCount;

    if (remainingSlots <= 0) {
      Alert.alert(t('chat.limit_reached'), t('chat.image_limit_reached'));
      return;
    }

    let response;
    try {
      response = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: remainingSlots,
        quality: 0.8,
        maxWidth: 1920,
        maxHeight: 1920,
      });
    } catch (launchError) {
      console.warn('Image picker launch error:', launchError);
      return;
    }

    try {
      if (!response || response.didCancel) return;

      if (response.errorCode) {
        console.warn('ImagePicker Error:', response.errorCode, response.errorMessage);
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

        for (const asset of assets) {
          if (!asset?.uri || typeof asset.uri !== 'string') continue;

          try {
            let fileSize = asset.fileSize || 0;

            if (!fileSize && asset.uri.startsWith('file://')) {
              try {
                const filePath = asset.uri.replace('file://', '');
                const fileInfo = await RNFS.stat(filePath);
                fileSize = fileInfo.size || 0;
              } catch (statError) {
                console.warn('RNFS.stat failed, will compress as fallback:', statError?.message);
                fileSize = MAX_SIZE_BYTES + 1;
              }
            } else if (!fileSize) {
              fileSize = MAX_SIZE_BYTES + 1;
            }

            if (fileSize > MAX_SIZE_BYTES) {
              const { uri: compressedUri } = await safeCompressImage(asset.uri, {
                maxWidth: 1024,
                quality: 0.7,
                returnableOutputType: 'uri',
              });
              validUris.push(compressedUri);
            } else {
              validUris.push(asset.uri);
            }
          } catch (error) {
            console.warn('Error processing image:', error);
            const { uri: compressedUri } = await safeCompressImage(asset.uri, {
              maxWidth: 1024,
              quality: 0.7,
              returnableOutputType: 'uri',
            });
            if (compressedUri) {
              validUris.push(compressedUri);
            } else {
              rejectedCount.push(asset.fileName || 'image');
            }
          }
        }

        if (rejectedCount.length > 0) {
          Alert.alert(
            t('chat.image_too_large'),
            t('chat.image_too_large_desc', { count: rejectedCount.length })
          );
        }

        if (validUris.length > 0) {
          setImageUris(prev => {
            const combined = [...prev, ...validUris];
            return combined.slice(0, maxImages);
          });
        }
      }
    } catch (callbackError) {
      console.warn('Image picker callback error:', callbackError);
    }
  }, [isBanned, isSafeChat, imageUris.length, t]);

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

    // Safe chat sends go through handleTemplateSelect / handleSendGameId,
    // which stamp a template id. Free text and photos can only arrive here
    // from a stale render, so drop them rather than letting them through.
    if (isSafeChat && (trimmedInput || hasImages)) {
      Alert.alert(
        t('chat.safe_mode_title', { defaultValue: 'Safe Chat' }),
        t('chat.safe_mode_blocked', {
          defaultValue: 'In this chat you can only send ready-made messages. Tap the messages button to pick one.',
        }),
      );
      return;
    }

    // ✅ Comprehensive content moderation check
    if (trimmedInput) {
      const validation = validateContent(trimmedInput, { skipAll: canBypassModeration });
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

      // 🔺 onSend: text, imageUrl (single or array), fruits, replyTo
      await onSend(textToSend, imageUrlToSend, fruitsToSend, replyTo);

      if (onCancelReply && typeof onCancelReply === 'function') {
        onCancelReply();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert(t('chat.error'), t('chat.send_error'));
    } finally {
      setIsSending(false); // ✅ always reset
    }
  }, [input, imageUris, selectedFruits, isSending, isSafeChat, t, onSend, onCancelReply, setSelectedFruits, localState?.isPro, uploadToBunny]);

  // ✅ Memoize hasFruits and hasContent
  const hasFruits = useMemo(() =>
    Array.isArray(selectedFruits) && selectedFruits.length > 0,
    [selectedFruits]
  );

  const hasContent = useMemo(() =>
    (input || '').trim().length > 0 || (Array.isArray(imageUris) && imageUris.length > 0) || hasFruits,
    [input, imageUris, hasFruits]
  );

  // Vetted phrases, grouped for the drawer. Source of truth is
  // ChatScreen/safeTemplates.js — the same list the server validates against.
  // `label` is localised for display; `en` is what actually ships in `text`.
  const templateSections = useMemo(() => {
    const byCategory = new Map(TEMPLATE_CATEGORIES.map((c) => [c, []]));
    SAFE_TEMPLATES.forEach((tpl) => {
      byCategory.get(tpl.category)?.push({
        ...tpl,
        label: t(tpl.key, { defaultValue: tpl.en }),
      });
    });
    return TEMPLATE_CATEGORIES
      .map((category) => ({
        category,
        title: t(`chat.tpl_section_${category}`, {
          defaultValue: category === 'trade' ? 'Trading'
            : category === 'friendly' ? 'Chat'
              : 'Stay safe',
        }),
        items: byCategory.get(category) || [],
      }))
      .filter((section) => section.items.length > 0);
  }, [t]);

  // Handle template selection. Sends the CANONICAL ENGLISH as `text` plus the
  // template id — the reader's app renders it in their own language from the
  // id, while old builds, push previews and moderator review still read the
  // English. See safeTemplates.js.
  const handleTemplateSelect = useCallback(async (template) => {
    setShowTemplateDrawer(false);
    if (onSend && typeof onSend === 'function') {
      await onSend(template.en, null, [], replyTo, template.id);
      if (onCancelReply && typeof onCancelReply === 'function') onCancelReply();
    }
  }, [onSend, replyTo, onCancelReply]);

  // Share the Roblox username saved on this user's own profile — the only way
  // to exchange an in-game name inside a safe chat, and never free-typed.
  const handleSendGameId = useCallback(async () => {
    setShowTemplateDrawer(false);
    if (!canShareGameId) {
      Alert.alert(
        t('chat.game_id_missing_title', { defaultValue: 'No game name saved' }),
        t('chat.game_id_missing_body', {
          defaultValue: 'Add your Roblox username in Settings first, then you can share it here with one tap.',
        }),
      );
      return;
    }
    if (onSend && typeof onSend === 'function') {
      await onSend(myGameId, null, [], replyTo, GAME_ID_TEMPLATE_ID);
      if (onCancelReply && typeof onCancelReply === 'function') onCancelReply();
    }
  }, [onSend, onCancelReply, replyTo, canShareGameId, myGameId, t]);

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

      {/* Safe chat notice — explains why the keyboard is gone, without naming
          anyone's age to the other person. */}
      {isSafeChat && (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 10,
            paddingTop: 6,
            paddingBottom: 2,
          }}
        >
          <Icon name="shield-checkmark" size={14} color="#10B981" />
          <Text style={{ flex: 1, fontSize: 11, color: isDark ? '#9CA3AF' : '#6B7280' }}>
            {t('chat.safe_mode_notice', {
              defaultValue: 'Safe Chat is on. Pick a ready-made message to send.',
            })}
          </Text>
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

        {/* Pets drawer icon — allowed in safe chat: the picker only emits
            items from the fixed value catalogue, never typed text. */}
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

        {/* Attach image — hidden entirely in safe chat */}
        {!isSafeChat && (
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
        )}

        {isSafeChat ? (
          <>
            {/* Tapping anywhere on the bar opens the picker — there is no
                keyboard to reach in this mode. */}
            <TouchableOpacity
              style={[
                styles.input,
                {
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: isDark ? '#374151' : '#E5E7EB',
                },
              ]}
              onPress={() => setShowTemplateDrawer(true)}
              disabled={isSending || isBanned}
              activeOpacity={0.7}
            >
              <Text style={{ color: '#888', fontSize: 15 }} numberOfLines={1}>
                {t('chat.safe_mode_placeholder', {
                  defaultValue: 'Tap to choose a message…',
                })}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sendButton, { backgroundColor: '#1E88E5' }]}
              onPress={() => setShowTemplateDrawer(true)}
              disabled={isSending || isBanned}
            >
              <Text style={styles.sendButtonText}>
                {isSending ? t('chat.sending') : t('chat.choose')}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              style={[styles.input, { color: isDark ? '#FFF' : '#000' }]}
              placeholder={
                chatBlockedBy === 'them'
                  ? t(`chat.unavailable_them_${chatType}`, {
                    defaultValue: chatType === 'trade'
                      ? "This user isn't accepting trade chats right now."
                      : "This user isn't accepting messages right now.",
                  })
                  : chatBlockedBy === 'me'
                    ? t(`chat.unavailable_me_${chatType}`, {
                      defaultValue: chatType === 'trade'
                        ? "You've turned off trade chat. Turn it back on in Settings."
                        : "You've turned off general chat. Turn it back on in Settings.",
                    })
                    : t('chat.type_message')
              }
              placeholderTextColor="#888"
              value={input}
              onChangeText={handleTextChange}
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
          </>
        )}
      </View>

      {/* Pets attached in safe chat still need a send action, since the normal
          send button is replaced by the picker above. */}
      {isSafeChat && hasFruits && (
        <TouchableOpacity
          style={{
            marginHorizontal: 10,
            marginTop: 6,
            paddingVertical: 10,
            borderRadius: 16,
            alignItems: 'center',
            backgroundColor: isSending ? config.colors.primary : '#1E88E5',
          }}
          onPress={handleSend}
          disabled={isSending || isBanned}
        >
          <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 14 }}>
            {isSending
              ? t('chat.sending')
              : t('chat.send_pets', {
                count: selectedFruits.length,
                defaultValue: 'Send {{count}} pets',
              })}
          </Text>
        </TouchableOpacity>
      )}

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
          <SwipeableBottomDrawer
            onClose={() => setShowTemplateDrawer(false)}
            isDarkMode={isDark}
            style={{
              backgroundColor: isDark ? '#1F2937' : '#FFFFFF',
              maxHeight: isSafeChat ? '80%' : '60%',
              paddingBottom: 20 + insets.bottom,
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
              style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Share game ID — the only in-game name exchange a safe chat
                  allows. Always offered, because it saves everyone typing. */}
              <TouchableOpacity
                onPress={handleSendGameId}
                disabled={isSending || isBanned}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  borderRadius: 14,
                  marginBottom: 14,
                  backgroundColor: canShareGameId
                    ? (isDark ? '#1E3A8A' : '#DBEAFE')
                    : (isDark ? '#374151' : '#F3F4F6'),
                  borderWidth: 1,
                  borderColor: canShareGameId
                    ? (isDark ? '#3B82F6' : '#93C5FD')
                    : (isDark ? '#4B5563' : '#D1D5DB'),
                }}
              >
                <Icon
                  name="game-controller-outline"
                  size={18}
                  color={canShareGameId ? (isDark ? '#BFDBFE' : '#1D4ED8') : '#9CA3AF'}
                />
                <Text
                  style={{
                    flex: 1,
                    fontSize: 13,
                    fontWeight: '600',
                    color: canShareGameId
                      ? (isDark ? '#EFF6FF' : '#1E3A8A')
                      : '#9CA3AF',
                  }}
                  numberOfLines={1}
                >
                  {canShareGameId
                    ? t('chat.share_game_id', {
                      name: myGameId,
                      defaultValue: 'Share my game ID: {{name}}',
                    })
                    : t('chat.share_game_id_empty', {
                      defaultValue: 'Add your Roblox username in Settings to share it',
                    })}
                </Text>
              </TouchableOpacity>

              {templateSections.map((section) => (
                <View key={section.category} style={{ marginBottom: 14 }}>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '700',
                      letterSpacing: 0.6,
                      textTransform: 'uppercase',
                      marginBottom: 8,
                      color: isDark ? '#9CA3AF' : '#6B7280',
                    }}
                  >
                    {section.title}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {section.items.map((template) => (
                      <TouchableOpacity
                        key={template.id}
                        onPress={() => handleTemplateSelect(template)}
                        disabled={isSending || isBanned}
                        style={{
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 20,
                          backgroundColor: isDark ? '#374151' : '#F3F4F6',
                          borderWidth: 1,
                          borderColor: isDark ? '#4B5563' : '#D1D5DB',
                        }}
                      >
                        <Text
                          style={{
                            color: isDark ? '#F9FAFB' : '#111827',
                            fontSize: 13,
                            fontWeight: '500',
                          }}
                        >
                          {template.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </SwipeableBottomDrawer>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

export default React.memo(PrivateMessageInput);
