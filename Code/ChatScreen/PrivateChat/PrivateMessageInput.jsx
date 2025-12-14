import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  Alert,
} from 'react-native';
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
  const [imageUri, setImageUri] = useState(null); // single image only

  const { localState } = useLocalState();
  const { theme, user } = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();

  // ✅ Memoize styles
  const styles = useMemo(() => getStyles(isDark), [isDark]);

  // ✅ Memoize handlePickImage
  const handlePickImage = useCallback(() => {
    if (isBanned) return;

    launchImageLibrary(
      {
        mediaType: 'photo',
        selectionLimit: 1,
      },
      response => {
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

        const asset = Array.isArray(response.assets) ? response.assets[0] : null;
        if (asset?.uri && typeof asset.uri === 'string') {
          setImageUri(asset.uri);
        }
      },
    );
  }, [isBanned]);

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
    const hasImage = !!imageUri;
    const hasFruits = Array.isArray(selectedFruits) && selectedFruits.length > 0;

    // nothing to send
    if (!trimmedInput && !hasImage && !hasFruits) return;
    if (isSending) return;

    // ✅ Validate onSend callback
    if (!onSend || typeof onSend !== 'function') {
      console.error('❌ onSend callback is not a function');
      return;
    }

    setIsSending(true);

    // snapshot current data
    const textToSend = trimmedInput;
    const imageToSend = imageUri;
    const fruitsToSend = Array.isArray(selectedFruits) ? [...selectedFruits] : [];

    // clear UI
    setInput('');
    setImageUri(null);
    if (setSelectedFruits && typeof setSelectedFruits === 'function') {
      setSelectedFruits([]);
    }

    setMessageCount(prevCount => {
      const newCount = prevCount + 1;
      if (!localState?.isPro && newCount % 5 === 0) {
        InterstitialAdManager.showAd(() => {});
      }
      return newCount;
    });

    try {
      let imageUrl = null;

      if (imageToSend) {
        imageUrl = await uploadToBunny(imageToSend);
      }

      // 🔺 onSend: text, imageUrl, fruits
      await onSend(textToSend, imageUrl, fruitsToSend);

      if (onCancelReply && typeof onCancelReply === 'function') {
        onCancelReply();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      Alert.alert('Error', 'Failed to send message.');
    } finally {
      setIsSending(false); // ✅ always reset
    }
  }, [input, imageUri, selectedFruits, isSending, onSend, onCancelReply, setSelectedFruits, localState?.isPro, uploadToBunny]);

  // ✅ Memoize hasFruits and hasContent
  const hasFruits = useMemo(() =>
    Array.isArray(selectedFruits) && selectedFruits.length > 0,
    [selectedFruits]
  );

  const hasContent = useMemo(() =>
    (input || '').trim().length > 0 || !!imageUri || hasFruits,
    [input, imageUri, hasFruits]
  );

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

      {/* Attached image indicator */}
      {imageUri && (
        <View
          style={{
            paddingHorizontal: 10,
            paddingTop: 4,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Text style={{ color: isDark ? '#ccc' : '#555', fontSize: 12 }}>
            1 image attached
          </Text>

          <TouchableOpacity
            onPress={() => setImageUri(null)}
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
    </View>
  );
};

export default PrivateMessageInput;
