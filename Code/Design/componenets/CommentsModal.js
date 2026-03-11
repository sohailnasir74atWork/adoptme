import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Image,
  Alert,
  Pressable,
} from 'react-native';
import {
  collection,
  doc,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  serverTimestamp,
  increment,
} from '@react-native-firebase/firestore';
import { useGlobalState } from '../../GlobelStats';
import { useLocalState } from '../../LocalGlobelStats';
import { useNavigation } from '@react-navigation/native';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { validateContent } from '../../Helper/ContentModeration';
import ConditionalKeyboardWrapper from '../../Helper/keyboardAvoidingContainer';
import { useTranslation } from 'react-i18next';
import { useBanStatus } from '../../ChatScreen/utils';

dayjs.extend(relativeTime);

const CommentModal = ({ visible, onClose, postId }) => {
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const inputRef = useRef(null);
  const { user, theme, firestoreDB } = useGlobalState();
  const { localState } = useLocalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';

  // ✅ Check if current user is banned
  const { isBanned: isMeBanned, banDetails: myBanDetails } = useBanStatus(user?.email);
  // console.log('[CommentModal] firestoreDB:', !!firestoreDB);

  useEffect(() => {
    if (!postId || !firestoreDB) return;

    const commentsRef = collection(firestoreDB, 'designPosts', postId, 'comments');
    const q = query(commentsRef, orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, snapshot => {
      const commentsData = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data(),
      }));
      setComments(commentsData);
    });

    return () => unsubscribe();
  }, [postId, firestoreDB]);

  const handleChatNavigation = useCallback((comment) => {
    const callback = () => {
      if (!user?.id) {
        Alert.alert(t('chat.sign_in_required_title'), t('feed.signin_message'));
        return;
      }

      navigation.navigate('PrivateChatDesign', {
        selectedUser: {
          senderId: comment.userId,
          sender: comment.displayName,
          avatar: comment.avatar,
        },
      });
    };

    // ✅ Removed navigation ad - exit ads are shown when leaving chat instead
    callback();
  }, [user?.id, navigation]);

  const handleAddComment = useCallback(async () => {
    const text = commentText.trim();
    if (!text || !firestoreDB) return;
    if (!firestoreDB || !postId) {
      console.error('Missing firestoreDB or postId', { firestoreDB, postId });
      Alert.alert(t('chat.error'), t('feed.cannot_post_comment'));
      Alert.alert(t('chat.error'), t('feed.cannot_post_comment'));
      return;
    }

    // ✅ Ban check
    if (isMeBanned) {
      const reason = myBanDetails?.reason || 'Access Denied';
      Alert.alert(t("chat.access_denied", { defaultValue: 'Access Denied' }), t("chat.banned_message", { defaultValue: `You are banned: ${reason}` }));
      return;
    }

    // ✅ Content moderation: Check comment for inappropriate content
    const contentValidation = validateContent(text);
    if (!contentValidation.isValid) {
      Alert.alert(t('feed.content_not_allowed'), contentValidation.reason || t('feed.inappropriate_comment'));
      return;
    }
    const comment = {
      userId: user.id,
      displayName: user.displayName || t('feed.guest_user'),
      avatar: user.avatar,
      text,
      createdAt: serverTimestamp(),
    };

    try {
      const commentsRef = collection(firestoreDB, 'designPosts', postId, 'comments');
      const postRef = doc(firestoreDB, 'designPosts', postId);


      await addDoc(commentsRef, comment);
      await updateDoc(postRef, {
        commentCount: increment(1),
      });

      setCommentText('');
      inputRef.current?.focus();
    } catch (error) {
      console.error('Add Comment Error:', error);
      Alert.alert(t('chat.error'), t('feed.failed_post_comment'));
    }
  }, [commentText, user, postId, firestoreDB]);

  const renderItem = ({ item }) => (
    <TouchableOpacity onPress={() => handleChatNavigation(item)} style={styles.comment}>
      <Image source={{ uri: item.avatar }} style={styles.avatar} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, isDarkMode && styles.textDark]}>{item.displayName}</Text>
        {item.createdAt?.seconds && (
          <Text style={[styles.timestamp, isDarkMode && styles.textDark]}>
            {dayjs(item.createdAt.seconds * 1000).fromNow()}
          </Text>
        )}
        <Text style={[styles.text, isDarkMode && styles.textDark]}>{item.text}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide">
      <ConditionalKeyboardWrapper style={styles.keyboardAvoidingView}>
        <View style={styles.modalBackground}>
          {/* Backdrop */}
          <Pressable style={styles.backdrop} onPress={onClose} />

          {/* Bottom sheet */}
          <View style={[styles.modalContent, isDarkMode && styles.darkContent]}>
            <View style={styles.sheetHandle} />

            <FlatList
              data={comments}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              keyboardShouldPersistTaps="handled"
            />

            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                placeholder={t('feed.write_comment')}
                placeholderTextColor={isDarkMode ? '#ccc' : '#888'}
                value={commentText}
                onChangeText={setCommentText}
                style={[styles.input, isDarkMode && styles.inputDark]}
                returnKeyType="send"
                onSubmitEditing={handleAddComment}
              />
              <TouchableOpacity onPress={handleAddComment} style={styles.sendBtn}>
                <Text style={styles.sendText}>{t('feed.send')}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.sendText}>{t('feed.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ConditionalKeyboardWrapper>
    </Modal>
  );
};

const styles = StyleSheet.create({
  keyboardAvoidingView: {
    flex: 1,
  },
  modalBackground: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalContent: {
    backgroundColor: 'white',
    padding: 12,
    paddingTop: 8,
    maxHeight: '85%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  darkContent: {
    backgroundColor: '#1e293b',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#bbb',
    marginBottom: 10,
  },
  comment: {
    flexDirection: 'row',
    marginBottom: 10,

  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    marginRight: 10,
  },
  name: {
    fontWeight: 'bold',
    fontSize: 14,
    color: '#000',
  },
  text: {

    fontSize: 13,
    color: '#333',
    flex: 1,
    flexWrap: 'wrap'
  },
  timestamp: {
    fontSize: 10,
    color: 'gray',

  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 8,
    borderRadius: 5,
    color: '#000',

  },
  inputDark: {
    borderColor: '#555',
    color: '#fff',
    backgroundColor: '#333',
  },
  sendBtn: {
    backgroundColor: '#007AFF',
    padding: 10,
    marginLeft: 5,
    borderRadius: 5,
  },
  closeBtn: {
    marginTop: 10,
    backgroundColor: '#FF3B30',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  sendText: {
    color: '#fff',
    fontWeight: '600',
    fontWeight: 'bold',
  },
  textDark: {
    color: '#fff',
  },
});

export default CommentModal;
