import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  startAfter,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
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
import SwipeableBottomDrawer from '../../Helper/SwipeableBottomDrawer';
import { useTranslation } from 'react-i18next';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';

dayjs.extend(relativeTime);

const PAGE_SIZE = 15;

// `collectionName` is the PARENT collection holding the commented document —
// 'designPosts' for the design feed, 'statuses' for story comments. Comments
// always live in a `comments` subcollection under that doc, so both feeds share
// this one component (and the same threading, moderation and ban rules).
// `onCountChange(delta)` lets the caller keep its own commentCount in sync
// without re-reading the parent doc.
const CommentModal = ({ visible, onClose, postId, collectionName = 'designPosts', onCountChange, onOpenChat }) => {
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [lastDoc, setLastDoc] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null); // { id, displayName }
  const inputRef = useRef(null);
  const { user, theme, firestoreDB, isUserBlocked, strikeInfo, deviceBanInfo } = useGlobalState();
  const { localState } = useLocalState();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const isDarkMode = theme === 'dark';

  // ✅ Check if current user is banned — global gate covers email + device
  const isMeBanned = isUserBlocked;
  const myBanDetails = strikeInfo || deviceBanInfo;

  // ── Fetch initial comments (paginated) ──
  const fetchComments = useCallback(async () => {
    if (!postId || !firestoreDB) return;
    setLoading(true);
    try {
      const commentsRef = collection(firestoreDB, collectionName, postId, 'comments');
      const q = query(commentsRef, orderBy('createdAt', 'desc'), limit(PAGE_SIZE));
      const snapshot = await getDocs(q);

      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setComments(data);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err) {
      console.warn('[Comments] fetch error:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [postId, firestoreDB, collectionName]);

  // ── Load more comments ──
  const loadMore = useCallback(async () => {
    if (!postId || !firestoreDB || !hasMore || !lastDoc || loadingMore) return;
    setLoadingMore(true);
    try {
      const commentsRef = collection(firestoreDB, collectionName, postId, 'comments');
      const q = query(commentsRef, orderBy('createdAt', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE));
      const snapshot = await getDocs(q);

      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setComments(prev => [...prev, ...data]);
      setLastDoc(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMore(snapshot.docs.length === PAGE_SIZE);
    } catch (err) {
      console.warn('[Comments] loadMore error:', err?.message);
    } finally {
      setLoadingMore(false);
    }
  }, [postId, firestoreDB, collectionName, hasMore, lastDoc, loadingMore]);

  useEffect(() => {
    if (visible && postId) {
      fetchComments();
      setReplyingTo(null);
      setCommentText('');
    }
  }, [visible, postId, collectionName]);

  // ── Group comments into threads ──
  const threadedComments = useMemo(() => {
    const topLevel = [];
    const repliesMap = {}; // parentId -> [replies]

    comments.forEach(c => {
      if (c.parentId) {
        if (!repliesMap[c.parentId]) repliesMap[c.parentId] = [];
        repliesMap[c.parentId].push(c);
      } else {
        topLevel.push(c);
      }
    });

    // Sort replies oldest first (so conversation reads naturally)
    Object.values(repliesMap).forEach(arr =>
      arr.sort((a, b) => {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return aTime - bTime;
      })
    );

    return topLevel.map(c => ({
      ...c,
      replies: repliesMap[c.id] || [],
    }));
  }, [comments]);

  // ── Navigate to DM ──
  const handleChatNavigation = useCallback((comment) => {
    if (!user?.id) {
      Alert.alert(t('chat.sign_in_required_title'), t('feed.signin_message'));
      return;
    }
    // 'PrivateChatDesign' is registered only inside the Design stack, so a
    // caller mounted elsewhere (e.g. the Home-tab status viewer) must hand us
    // its own way to open a DM — otherwise this navigate goes nowhere.
    if (onOpenChat) {
      onOpenChat(comment);
      return;
    }
    navigation.navigate('PrivateChatDesign', {
      selectedUser: {
        senderId: comment.userId,
        sender: comment.displayName,
        avatar: comment.avatar,
      },
    });
  }, [user?.id, navigation, onOpenChat, t]);

  // ── Add comment or reply ──
  const handleAddComment = useCallback(async () => {
    const text = commentText.trim();
    if (!text || !firestoreDB || !postId) return;

    // Ban check
    if (isMeBanned) {
      const reason = myBanDetails?.reason || 'Access Denied';
      Alert.alert(t("chat.access_denied", { defaultValue: 'Access Denied' }), t("chat.banned_message", { defaultValue: `You are banned: ${reason}` }));
      return;
    }

    // Content moderation
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
      likes: {},
      // If replying, store parent info
      ...(replyingTo ? {
        parentId: replyingTo.id,
        replyToName: replyingTo.displayName,
      } : {}),
    };

    try {
      const commentsRef = collection(firestoreDB, collectionName, postId, 'comments');
      const postRef = doc(firestoreDB, collectionName, postId);

      const newDoc = await addDoc(commentsRef, comment);
      // commentCount is a denormalised convenience on the PARENT doc, which the
      // commenter does not own. Never fail a comment that already landed just
      // because the count bump was rejected — that would show "failed to post"
      // over a comment that is actually live.
      updateDoc(postRef, { commentCount: increment(1) })
        .catch(e => console.warn('[Comments] count bump failed:', e?.message));

      // Optimistic local update
      const localComment = {
        ...comment,
        id: newDoc.id,
        createdAt: { seconds: Math.floor(Date.now() / 1000) },
      };
      setComments(prev => [localComment, ...prev]);
      onCountChange?.(1);
      setCommentText('');
      setReplyingTo(null);
      inputRef.current?.focus();
    } catch (error) {
      console.error('Add Comment Error:', error);
      Alert.alert(t('chat.error'), t('feed.failed_post_comment'));
    }
  }, [commentText, user, postId, firestoreDB, collectionName, onCountChange, replyingTo, isMeBanned]);

  // ── Like a comment ──
  const handleLikeComment = useCallback(async (commentId) => {
    if (!user?.id || !firestoreDB || !postId) return;
    // Ban check
    if (isMeBanned) {
      const reason = myBanDetails?.reason || 'Access Denied';
      Alert.alert(t("chat.access_denied", { defaultValue: 'Access Denied' }), t("chat.banned_message", { defaultValue: `You are banned: ${reason}` }));
      return;
    }

    const commentRef = doc(firestoreDB, collectionName, postId, 'comments', commentId);
    const currentComment = comments.find(c => c.id === commentId);
    const isLiked = currentComment?.likes?.[user.id];

    // Optimistic update
    setComments(prev => prev.map(c => {
      if (c.id !== commentId) return c;
      const updatedLikes = { ...(c.likes || {}) };
      if (isLiked) {
        delete updatedLikes[user.id];
      } else {
        updatedLikes[user.id] = true;
      }
      return { ...c, likes: updatedLikes };
    }));

    // Firestore update (fire-and-forget)
    try {
      if (isLiked) {
        await updateDoc(commentRef, { [`likes.${user.id}`]: deleteField() });
      } else {
        await updateDoc(commentRef, { [`likes.${user.id}`]: true });
      }
    } catch (err) {
      console.warn('[Comments] like error:', err?.message);
    }
  }, [user?.id, firestoreDB, postId, collectionName, comments, isMeBanned, myBanDetails]);

  // ── Delete own comment ──
  const handleDeleteComment = useCallback(async (commentId, commentUserId) => {
    if (!user?.id || user.id !== commentUserId) return;

    Alert.alert(
      t('feed.delete_post', { defaultValue: 'Delete' }),
      t('comments.delete_confirm', { defaultValue: 'Delete this comment?' }),
      [
        { text: t('feed.cancel'), style: 'cancel' },
        {
          text: t('feed.submit', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(firestoreDB, collectionName, postId, 'comments', commentId));
              updateDoc(doc(firestoreDB, collectionName, postId), { commentCount: increment(-1) })
                .catch(e => console.warn('[Comments] count bump failed:', e?.message));
              setComments(prev => prev.filter(c => c.id !== commentId));
              onCountChange?.(-1);
            } catch (err) {
              console.warn('[Comments] delete error:', err?.message);
            }
          },
        },
      ]
    );
  }, [user?.id, firestoreDB, postId, collectionName, onCountChange, t]);

  // ── Start reply ──
  const startReply = useCallback((comment) => {
    setReplyingTo({ id: comment.id, displayName: comment.displayName });
    setCommentText('');
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // ── Render a single comment ──
  const renderComment = (item, isReply = false) => {
    const likeCount = item.likes ? Object.keys(item.likes).length : 0;
    const isLiked = item.likes?.[user?.id];
    const isMyComment = item.userId === user?.id;
    const timeAgo = item.createdAt?.seconds
      ? dayjs(item.createdAt.seconds * 1000).fromNow()
      : '';

    return (
      <View
        key={item.id}
        style={[
          styles.comment,
          isReply && styles.replyComment,
          isReply && { borderLeftColor: isDarkMode ? '#334155' : '#e2e8f0' },
        ]}
      >
        <TouchableOpacity onPress={() => handleChatNavigation(item)} activeOpacity={0.7}>
          <Image
            source={{ uri: item.avatar || 'https://bloxfruitscalc.com/wp-content/uploads/2025/display-pic.png' }}
            style={[styles.avatar, isReply && styles.replyAvatar]}
          />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          {/* Name + time */}
          <View style={styles.commentHeader}>
            <TouchableOpacity onPress={() => handleChatNavigation(item)} activeOpacity={0.7}>
              <Text style={[styles.name, isDarkMode && { color: '#e2e8f0' }]}>{item.displayName}</Text>
            </TouchableOpacity>
            {timeAgo ? (
              <Text style={[styles.timestamp, isDarkMode && { color: '#64748b' }]}>{timeAgo}</Text>
            ) : null}
          </View>

          {/* Reply indicator */}
          {item.replyToName && (
            <Text style={[styles.replyIndicator, isDarkMode && { color: '#64748b' }]}>
              ↳ {t('comments.replying_to', { defaultValue: 'replying to' })} {item.replyToName}
            </Text>
          )}

          {/* Comment text */}
          <Text style={[styles.text, isDarkMode && { color: '#cbd5e1' }]}>{item.text}</Text>

          {/* Action row: Like, Reply, Delete */}
          <View style={styles.actionRow}>
            {/* Like */}
            <TouchableOpacity
              onPress={() => handleLikeComment(item.id)}
              style={styles.commentAction}
              activeOpacity={0.7}
            >
              <FontAwesome
                name="heart"
                size={11}
                color={isLiked ? '#EF4444' : (isDarkMode ? '#64748b' : '#94a3b8')}
                solid={!!isLiked}
              />
              {likeCount > 0 && (
                <Text style={[styles.actionText, isLiked && { color: '#EF4444' }]}>{likeCount}</Text>
              )}
            </TouchableOpacity>

            {/* Reply (only on top-level comments) */}
            {!isReply && (
              <TouchableOpacity
                onPress={() => startReply(item)}
                style={styles.commentAction}
                activeOpacity={0.7}
              >
                <FontAwesome
                  name="reply"
                  size={11}
                  color={isDarkMode ? '#64748b' : '#94a3b8'}
                />
                <Text style={styles.actionText}>
                  {t('comments.reply', { defaultValue: 'Reply' })}
                </Text>
              </TouchableOpacity>
            )}

            {/* Delete (own comments only) */}
            {isMyComment && (
              <TouchableOpacity
                onPress={() => handleDeleteComment(item.id, item.userId)}
                style={styles.commentAction}
                activeOpacity={0.7}
              >
                <FontAwesome
                  name="trash"
                  size={10}
                  color={isDarkMode ? '#64748b' : '#94a3b8'}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  // ── Render a thread (top-level + replies) ──
  const renderThread = ({ item }) => (
    <View style={styles.thread}>
      {renderComment(item)}
      {item.replies.length > 0 && (
        <View style={styles.repliesContainer}>
          {item.replies.map(reply => renderComment(reply, true))}
        </View>
      )}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide">
      <ConditionalKeyboardWrapper style={styles.keyboardAvoidingView}>
        <View style={styles.modalBackground}>
          {/* Backdrop */}
          <Pressable style={styles.backdrop} onPress={onClose} />

          {/* Bottom sheet */}
          <SwipeableBottomDrawer
            onClose={onClose}
            isDarkMode={isDarkMode}
            showPill={false}
            style={[styles.modalContent, isDarkMode && styles.darkContent]}
          >
            <View style={styles.sheetHandle} />

            {/* Header */}
            <View style={styles.header}>
              <Text style={[styles.headerTitle, isDarkMode && { color: '#e2e8f0' }]}>
                {t('feed.comments_title', { defaultValue: 'Comments' })}
              </Text>
              <TouchableOpacity onPress={onClose} style={styles.closeIcon} activeOpacity={0.7}>
                <FontAwesome name="xmark" size={16} color={isDarkMode ? '#94a3b8' : '#64748b'} />
              </TouchableOpacity>
            </View>

            {/* Comments list */}
            {loading ? (
              <ActivityIndicator size="small" color={isDarkMode ? '#94a3b8' : '#64748b'} style={{ marginVertical: 30 }} />
            ) : (
              <FlatList
                data={threadedComments}
                keyExtractor={(item) => item.id}
                renderItem={renderThread}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                onEndReached={loadMore}
                onEndReachedThreshold={0.3}
                ListFooterComponent={
                  loadingMore ? (
                    <ActivityIndicator size="small" color={isDarkMode ? '#94a3b8' : '#64748b'} style={{ marginVertical: 12 }} />
                  ) : null
                }
                ListEmptyComponent={
                  <View style={styles.emptyState}>
                    <FontAwesome name="comment" size={28} color={isDarkMode ? '#334155' : '#cbd5e1'} />
                    <Text style={[styles.emptyText, isDarkMode && { color: '#64748b' }]}>
                      {t('comments.no_comments', { defaultValue: 'No comments yet. Be the first!' })}
                    </Text>
                  </View>
                }
              />
            )}

            {/* Reply banner */}
            {replyingTo && (
              <View style={[styles.replyBanner, isDarkMode && { backgroundColor: '#1e3a5f', borderColor: '#3B82F6' }]}>
                <Text style={[styles.replyBannerText, isDarkMode && { color: '#93c5fd' }]}>
                  ↳ {t('comments.replying_to', { defaultValue: 'Replying to' })} <Text style={{ fontWeight: '800' }}>{replyingTo.displayName}</Text>
                </Text>
                <TouchableOpacity onPress={() => setReplyingTo(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <FontAwesome name="xmark" size={12} color={isDarkMode ? '#93c5fd' : '#3B82F6'} />
                </TouchableOpacity>
              </View>
            )}

            {/* Input row */}
            <View style={[styles.inputRow, isDarkMode && { borderTopColor: '#1e293b' }]}>
              <TextInput
                ref={inputRef}
                placeholder={replyingTo
                  ? t('comments.reply_placeholder', { defaultValue: `Reply to ${replyingTo.displayName}...`, name: replyingTo.displayName })
                  : t('feed.write_comment')
                }
                placeholderTextColor={isDarkMode ? '#64748b' : '#94a3b8'}
                value={commentText}
                onChangeText={setCommentText}
                style={[styles.input, isDarkMode && styles.inputDark]}
                returnKeyType="send"
                onSubmitEditing={handleAddComment}
                multiline
                maxLength={300}
              />
              <TouchableOpacity
                onPress={handleAddComment}
                style={[styles.sendBtn, !commentText.trim() && { opacity: 0.4 }]}
                disabled={!commentText.trim()}
                activeOpacity={0.8}
              >
                <FontAwesome name="paper-plane" size={14} color="#fff" solid />
              </TouchableOpacity>
            </View>
          </SwipeableBottomDrawer>
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
    backgroundColor: '#fff',
    padding: 14,
    paddingTop: 8,
    maxHeight: '85%',
  },
  darkContent: {
    backgroundColor: '#0f172a',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    marginBottom: 8,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  closeIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Threads
  thread: {
    marginBottom: 4,
  },
  repliesContainer: {
    marginLeft: 20,
  },

  // Comment
  comment: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 10,
  },
  replyComment: {
    borderLeftWidth: 2,
    paddingLeft: 12,
    marginLeft: 4,
  },
  commentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  replyAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  name: {
    fontWeight: '700',
    fontSize: 13,
    color: '#0f172a',
  },
  timestamp: {
    fontSize: 10,
    color: '#94a3b8',
  },
  text: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 19,
    marginBottom: 4,
  },
  replyIndicator: {
    fontSize: 10,
    color: '#94a3b8',
    marginBottom: 2,
    fontStyle: 'italic',
  },

  // Action row (like, reply, delete)
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 2,
  },
  commentAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  actionText: {
    fontSize: 11,
    color: '#94a3b8',
    fontWeight: '600',
  },

  // Reply banner
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  replyBannerText: {
    fontSize: 12,
    color: '#3B82F6',
    fontWeight: '600',
    flex: 1,
  },

  // Input
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    fontSize: 13,
    color: '#0f172a',
    maxHeight: 80,
  },
  inputDark: {
    borderColor: '#334155',
    color: '#e2e8f0',
    backgroundColor: '#1e293b',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Empty
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '600',
  },
});

export default CommentModal;
