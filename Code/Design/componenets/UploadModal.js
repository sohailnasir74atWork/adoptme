import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { Image as CompressorImage } from 'react-native-compressor';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import InterstitialAdManager from '../../Ads/IntAd';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { onValue, ref } from '@react-native-firebase/database';
import { showMessage } from 'react-native-flash-message';
import RNFS from 'react-native-fs';
import { validateContent } from '../../Helper/ContentModeration';


const CLOUD_NAME = 'djtqw0jb5';
const UPLOAD_PRESET = 'my_upload';
const MAX_IMAGES = 4;

const BUNNY_STORAGE_HOST = 'storage.bunnycdn.com';     // or your regional host
const BUNNY_STORAGE_ZONE = 'post-gag';
const BUNNY_ACCESS_KEY   = '1b7e1a85-dff7-4a98-ba701fc7f9b9-6542-46e2'; // ← rotate this later
const BUNNY_CDN_BASE     = 'https://pull-gag.b-cdn.net';


const UploadModal = ({ visible, onClose, onUpload, user }) => {
  const [desc, setDesc] = useState('');
  const [imageUris, setImageUris] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedTags, setSelectedTags] = useState(['Discussion']);
  const {currentUserEmail, appdatabase} = useGlobalState();
  const [strikeInfo, setStrikeInfo] = useState(null)
  // const [budget, setBudget] = useState('');
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const {localState} = useLocalState()
  
  // ✅ Session-based last post time (resets on app close/reopen - simple state, no storage)
  const [lastPostTime, setLastPostTime] = useState(null);

  const toggleTag = useCallback((tag) => {
    setSelectedTags([tag]);
  }, []);

  useEffect(() => {
    if (!currentUserEmail) return;

    const encodedEmail = currentUserEmail.replace(/\./g, '(dot)');
    const banRef = ref(appdatabase, `banned_users_by_email_post/${encodedEmail}`);

    const unsubscribe = onValue(banRef, (snapshot) => {
      const banData = snapshot.val();
      setStrikeInfo(banData || null);
    });

    return () => unsubscribe();
  }, [currentUserEmail]);

  // ✅ Reset loading state when modal closes
  useEffect(() => {
    if (!visible) {
      setLoading(false);
    }
  }, [visible]);

  // console.log(currentUserEmail)show
  

const pickAndCompress = useCallback(async () => {
  const result = await launchImageLibrary({
    mediaType: 'photo',
    selectionLimit: MAX_IMAGES,
  });

  if (result.assets?.length > 0) {
    const MAX_SIZE_BYTES = 1024 * 1024; // 1 MB
    const compressed = [];
    const rejectedCount = [];

    for (const asset of result.assets) {
      try {
        // Check file size before compression
        if (asset?.uri) {
          const filePath = asset.uri.replace('file://', '');
          const fileInfo = await RNFS.stat(filePath);
          const fileSize = fileInfo.size || 0;

          if (fileSize > MAX_SIZE_BYTES) {
            rejectedCount.push(asset.fileName || 'image');
            continue;
          }
        }

        // Compress the image
        const uri = await CompressorImage.compress(asset.uri, {
          maxWidth: 400,
          quality: 1,
        });
        compressed.push(uri);
      } catch (error) {
        console.error('Compression failed:', error);
        // If compression fails, still try to check if we can use original
        // But skip if we can't determine size
        if (asset?.uri) {
          try {
            const filePath = asset.uri.replace('file://', '');
            const fileInfo = await RNFS.stat(filePath);
            const fileSize = fileInfo.size || 0;
            if (fileSize <= MAX_SIZE_BYTES) {
              compressed.push(asset.uri);
            } else {
              rejectedCount.push(asset.fileName || 'image');
            }
          } catch (statError) {
            console.warn('Could not check file size:', statError);
            // If we can't check, skip it to be safe
          }
        }
      }
    }

    // Show alert if any images were rejected
    if (rejectedCount.length > 0) {
      Alert.alert(
        'Image Too Large',
        `${rejectedCount.length} image(s) exceed 1 MB limit and were not added. Please select smaller images.`
      );
    }

    // Only update state if we have valid compressed images
    if (compressed.length > 0) {
      setImageUris((prev) => {
        if (prev.length + compressed.length > MAX_IMAGES) {
          // Replace all if over limit
          return compressed.slice(0, MAX_IMAGES);
        }
        return [...prev, ...compressed];
      });
    }
  }
}, []);

  

  // const uploadToCloudinary = useCallback(async () => {
  //   const urls = [];

  //   for (const uri of imageUris) {
  //     try {
  //       const data = new FormData();
  //       data.append('file', {
  //         uri,
  //         type: 'image/jpeg',
  //         name: 'upload.jpg',
  //       });
  //       data.append('upload_preset', UPLOAD_PRESET);

  //       const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
  //         method: 'POST',
  //         body: data,
  //       });

  //       const json = await res.json();
  //       if (json?.secure_url) {
  //         urls.push(json.secure_url);
  //       }
  //     } catch (e) {
  //       console.error('Cloudinary upload error:', e);
  //     }
  //   }

  //   return urls;
  // }, [imageUris]);
  const uploadToBunny = useCallback(async () => {
    const urls = [];
    const userId = user?.id ?? 'anon';
  
    for (const uri of imageUris) {
      try {
        const filename   = `${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
        const remotePath = `uploads/${encodeURIComponent(userId)}/${encodeURIComponent(filename)}`;
        const uploadUrl  = `https://${BUNNY_STORAGE_HOST}/${BUNNY_STORAGE_ZONE}/${remotePath}`;
  
        // Read file as base64 then convert to raw bytes
        const base64 = await RNFS.readFile(uri.replace('file://', ''), 'base64');
  
        // base64 -> Uint8Array (works reliably on RN 0.77)
        const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  
        // PUT raw bytes
        const res = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'AccessKey': BUNNY_ACCESS_KEY,
            'Content-Type': 'application/octet-stream',
            // Content-Length is optional; let fetch set it
          },
          body: binary,
        });
  
        const txt = await res.text().catch(() => '');
        // console.log('[Bunny PUT]', res.status, txt?.slice(0, 200));
  
        if (!res.ok) {
          throw new Error(`Bunny upload failed ${res.status}: ${txt}`);
        }
  
        // Public CDN URL to display
        urls.push(`${BUNNY_CDN_BASE}/${decodeURIComponent(remotePath)}`);
      } catch (e) {
        console.warn('[Bunny ERROR]', e?.message || e);
        throw e; // bubble up so your Alert shows
      }
    }
  
    return urls;
  }, [imageUris, user?.id]);
  

  const handleSubmit = useCallback(() => {
    // ✅ Guard: Prevent multiple simultaneous submissions
    if (loading) return;
    
    if (!user?.id) return;
    if (!currentUserEmail) {
      Alert.alert('Missing Email', 'Could not detect your account email. Please re-login.');
      return;
    }
  
    if (!desc && imageUris.length === 0) {
      return Alert.alert('Missing Info', 'Please add a description or at least one image.');
    }
    
    // ✅ Content moderation: Check description for inappropriate content
    const trimmedDesc = (desc || '').trim();
    if (trimmedDesc) {
      const contentValidation = validateContent(trimmedDesc);
      if (!contentValidation.isValid) {
        Alert.alert('Content Not Allowed', contentValidation.reason || 'Your post contains inappropriate content.');
        return;
      }
    }
    
    // ✅ Check 1-minute cooldown (session-based, resets on app restart)
    const now = Date.now();
    if (lastPostTime && (now - lastPostTime) < 60000) {
      const secondsLeft = Math.ceil((60000 - (now - lastPostTime)) / 1000);
      showMessage({
        message: '⏱️ Cooldown Active',
        description: `Please wait ${secondsLeft} second${secondsLeft === 1 ? '' : 's'} before posting again.`,
        type: 'warning',
        duration: 3000,
      });
      return;
    }
    
    if (strikeInfo) {
      const { strikeCount, bannedUntil } = strikeInfo;
      // console.log('strick')
      const now = Date.now();

      if (bannedUntil === 'permanent') {
        showMessage({
          message: '⛔ Permanently Banned',
          description: 'You are permanently banned from sending messages.',
          type: 'danger',
        });
        return;
      }

      if (typeof bannedUntil === 'number' && now < bannedUntil) {
        const totalMinutes = Math.ceil((bannedUntil - now) / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const timeLeftText = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

        showMessage({
          message: `⚠️ Strike ${strikeCount}`,
          description: `You are banned from chatting for ${timeLeftText} more minute(s).`,
          type: 'warning',
          duration: 5000,

        });
        return;
      }
    }
    
    // ✅ Set loading immediately to prevent duplicate submissions
    setLoading(true);
    
    // Extract core logic into a callback
    const callbackfunction = async () => {
      try {
        const uploadedUrls = await uploadToBunny();
        // console.log('[UploadModal] submitting with email:', currentUserEmail);
        await onUpload(desc, uploadedUrls, selectedTags, currentUserEmail);
        
        // ✅ Clear all inputs after successful upload
        setDesc('');
        setImageUris([]);
        setSelectedTags(['Discussion']);
        // setBudget('');
        
        // ✅ Update last post time (session-based, not persisted - resets on app restart)
        const postTime = Date.now();
        setLastPostTime(postTime);
        
        // ✅ Reset loading before closing modal
        setLoading(false);
        
        onClose();
        showMessage({
          message: 'Success',
          description: 'Post created successfully',
          type: 'success',
        });
      } catch (err) {
        Alert.alert('Upload Failed', 'Something went wrong. Try again.', err);
        console.log(err);
        // ✅ Reset loading on error so user can retry
        setLoading(false);
      }
    };
  
    // Show ad if not Pro, then execute
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (!localState.isPro) {
          requestAnimationFrame(() => {
            setTimeout(() => {
              try {
                InterstitialAdManager.showAd(callbackfunction);
              } catch (err) {
                console.warn('[AdManager] Failed to show ad:', err);
                callbackfunction();
              }
            }, 400);
          });
        } else {
          callbackfunction();
        }
      }, 500);
    });
  
  }, [loading, user?.id, desc, imageUris, selectedTags, uploadToBunny, onUpload, onClose, localState.isPro, currentUserEmail, lastPostTime, strikeInfo]);
  

  const themedStyles = getStyles(isDark);

  return (
    <Modal visible={visible} transparent animationType="slide">
            <View style={{ flexDirection: 'row', flex: 1 }}>

      <ConditionalKeyboardWrapper>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={themedStyles.modalBackground}>
        <TouchableOpacity
          activeOpacity={1}
          style={themedStyles.modalContent}
          onPress={(e) => e.stopPropagation()}
        >
          <TextInput
            style={themedStyles.input}
            placeholder="Write a description..."
            placeholderTextColor={isDark ? '#999' : '#666'}
            value={desc}
            onChangeText={setDesc}
            multiline
          />

          <View style={themedStyles.tagSelector}>
          {['Scam Alert', 'Looking for Trade', 'Discussion', 'Real or Fake', 'Need Help', 'Misc'].map((tag) => (
  <TouchableOpacity
    key={tag}
    style={[
      themedStyles.tagButton,
      selectedTags.includes(tag) && themedStyles.tagButtonSelected,
    ]}
    onPress={() => toggleTag(tag)}
  >
    <Text
      style={{
        color: selectedTags.includes(tag) ? '#fff' : isDark ? '#eee' : '#333',
        fontSize: 12,
        fontFamily: 'Lato-Bold',
      }}
    >
      {tag}
    </Text>
  </TouchableOpacity>
))}

          </View>

          {/* <TextInput
            style={themedStyles.input}
            placeholder="Optional: Budget (e.g. 500 Bucks)"
            placeholderTextColor={isDark ? '#999' : '#666'}
            value={budget}
            onChangeText={setBudget}
          /> */}

          <TouchableOpacity style={themedStyles.imagePicker} onPress={pickAndCompress}>
            {imageUris.length > 0 ? (
              <View style={themedStyles.imageGrid}>
                {imageUris.map((uri, idx) => (
                  <Image key={idx} source={{ uri }} style={themedStyles.previewImage} />
                ))}
              </View>
            ) : (
              <Text style={{ color: isDark ? '#aaa' : '#333' }}>Upload up to 4 images</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={themedStyles.uploadBtn} onPress={handleSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={themedStyles.btnText}>Submit</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={themedStyles.cancelBtn}>
            <Text style={themedStyles.btnText}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
      </ConditionalKeyboardWrapper>
      </View>

      
    </Modal>
  );
};

const getStyles = (isDark) =>
  StyleSheet.create({
    modalBackground: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      backgroundColor: isDark ? '#222' : '#fff',
      padding: 20,
      borderRadius: 10,
      // width: '90%',
      marginHorizontal:10
    },
    input: {
      borderWidth: 1,
      borderColor: isDark ? '#555' : '#ccc',
      padding: 10,
      borderRadius: 6,
      marginBottom: 10,
      color: isDark ? '#eee' : '#000',
      fontFamily: 'Lato-Regular',
    },
    tagSelector: {
      flexDirection: 'row',
      marginBottom: 10,
      flexWrap: 'wrap',
      gap: 8,
    },
    tagButton: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: '#ccc',
      backgroundColor: isDark ? '#333' : '#f0f0f0',
      marginRight: 10,
    },
    tagButtonSelected: {
      backgroundColor: config.colors.primary,
      borderColor: config.colors.primary,
    },
    imagePicker: {
      alignItems: 'center',
      justifyContent: 'center',
      height: 100,
      borderWidth: 1,
      borderColor: isDark ? '#555' : '#ccc',
      borderRadius: 6,
      marginBottom: 10,
      padding: 10,
    },
    imageGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    previewImage: {
      width: 50,
      height: 50,
      borderRadius: 3,
      marginRight: 3,
      marginBottom: 3,
    },
    uploadBtn: {
      backgroundColor: config.colors.secondary,
      padding: 12,
      alignItems: 'center',
      borderRadius: 6,
    },
    cancelBtn: {
      marginTop: 10,
      padding: 10,
      backgroundColor: '#FF3B30',
      borderRadius: 6,
      alignItems: 'center',
    },
    btnText: {
      color: '#fff',
      fontWeight: '600',
      fontFamily: 'Lato-Bold',
    },
  });

export default UploadModal;
