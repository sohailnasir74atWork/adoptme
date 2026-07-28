/**
 * FeatureFeedback — "About this feature" + public comments for the Pet Tracker.
 *
 * Cost rules (Firestore is billed per document read):
 *  - ZERO reads until the user expands the section (collapsed by default).
 *  - One-shot getDocs pages of 5 (+1 probe doc to detect "load more") — never
 *    an onSnapshot listener.
 *  - A posted comment is prepended locally instead of re-querying.
 * Collection: tracker_feedback  { userId, userName, avatar, text, createdAt }
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Image, ActivityIndicator,
} from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import {
  collection, doc, query, orderBy, startAfter, limit, getDocs, setDoc, serverTimestamp,
} from '@react-native-firebase/firestore';
import { useGlobalState } from '../GlobelStats';
import config from '../Helper/Environment';

const PAGE_SIZE = 5;
const MAX_LEN = 300;

const timeAgo = (ts) => {
  const ms = ts?.toMillis ? ts.toMillis() : (typeof ts === 'number' ? ts : Date.now());
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return 'now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
};

const FeatureFeedback = ({ c }) => {
  const { t } = useTranslation();
  const { user, firestoreDB } = useGlobalState();
  const styles = useMemo(() => getStyles(c), [c]);

  const [expanded, setExpanded] = useState(false);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastDoc, setLastDoc] = useState(null);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const loadPage = useCallback(async (after) => {
    if (!firestoreDB || loading) return;
    setLoading(true);
    try {
      const constraints = [orderBy('createdAt', 'desc')];
      if (after) constraints.push(startAfter(after));
      constraints.push(limit(PAGE_SIZE + 1)); // probe doc detects another page
      const snap = await getDocs(query(collection(firestoreDB, 'tracker_feedback'), ...constraints));
      const docs = snap.docs.slice(0, PAGE_SIZE);
      setHasMore(snap.docs.length > PAGE_SIZE);
      setLastDoc(docs[docs.length - 1] || after || null);
      const rows = docs.map((d) => ({ id: d.id, ...d.data() }));
      setComments((prev) => (after ? [...prev, ...rows] : rows));
      setLoadedOnce(true);
    } catch (e) {
      console.warn('[FeatureFeedback] load failed:', e.message);
    } finally {
      setLoading(false);
    }
  }, [firestoreDB, loading]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loadedOnce) loadPage(null); // first (and only automatic) read
  };

  const post = async () => {
    const body = text.trim();
    if (!body || !user?.id || !firestoreDB || posting) return;
    setPosting(true);
    try {
      const ref = doc(collection(firestoreDB, 'tracker_feedback'));
      const payload = {
        userId: user.id,
        // user.userName doesn't exist on this app's user object — every
        // comment posted so far fell through to 'Player'. displayName is what
        // the rest of the codebase uses (see PollCard.jsx).
        userName: user.displayName || user.userName || 'Player',
        avatar: user.avatar || '',
        text: body.slice(0, MAX_LEN),
        createdAt: serverTimestamp(),
      };
      await setDoc(ref, payload);
      // Prepend locally — no re-read needed.
      setComments((prev) => [{ id: ref.id, ...payload, createdAt: Date.now() }, ...prev]);
      setText('');
    } catch (e) {
      console.warn('[FeatureFeedback] post failed:', e.message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.headerRow} activeOpacity={0.7} onPress={toggle}>
        <FontAwesome name="comments" size={14} color={config.colors.primary} solid />
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text style={styles.title}>{t('tracker.fb_title', { defaultValue: 'About this feature' })}</Text>
          <Text style={styles.sub} numberOfLines={2}>
            {t('tracker.fb_sub', { defaultValue: 'Is it helpful? What can we improve? What are we missing? Tell us — comments are public.' })}
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={c.textSecondary} />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          {/* Composer */}
          {user?.id ? (
            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                placeholder={t('tracker.fb_placeholder', { defaultValue: 'Share your idea or feedback…' })}
                placeholderTextColor={c.placeholder}
                value={text}
                onChangeText={(v) => setText(v.slice(0, MAX_LEN))}
                multiline
                maxLength={MAX_LEN}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!text.trim() || posting) && { opacity: 0.4 }]}
                disabled={!text.trim() || posting}
                onPress={post}
                activeOpacity={0.8}
              >
                {posting
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="send" size={15} color="#fff" />}
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.signinHint}>
              {t('tracker.fb_signin', { defaultValue: 'Sign in to leave a comment.' })}
            </Text>
          )}

          {/* Comments */}
          {comments.map((cm) => (
            <View key={cm.id} style={styles.commentRow}>
              {cm.avatar ? (
                <Image source={{ uri: cm.avatar }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <FontAwesome name="user" size={10} color={c.textMuted} solid />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.commentName} numberOfLines={1}>{cm.userName}</Text>
                  <Text style={styles.commentTime}>{timeAgo(cm.createdAt)}</Text>
                </View>
                <Text style={styles.commentText}>{cm.text}</Text>
              </View>
            </View>
          ))}

          {loading && <ActivityIndicator style={{ marginVertical: 10 }} color={config.colors.primary} />}

          {!loading && loadedOnce && comments.length === 0 && (
            <Text style={styles.emptyText}>
              {t('tracker.fb_empty', { defaultValue: 'No comments yet — be the first!' })}
            </Text>
          )}

          {!loading && hasMore && (
            <TouchableOpacity style={styles.moreBtn} onPress={() => loadPage(lastDoc)} activeOpacity={0.7}>
              <Text style={styles.moreBtnText}>
                {t('tracker.fb_load_more', { defaultValue: 'Load 5 more' })}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const getStyles = (c) => StyleSheet.create({
  card: {
    marginTop: 4,
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: c.bgAlt,
    overflow: 'hidden',
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  title: { fontSize: 13, fontWeight: '700', color: c.text },
  sub: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  body: { paddingHorizontal: 12, paddingBottom: 12 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 10 },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 90,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: c.inputBg,
    borderWidth: 1,
    borderColor: c.inputBorder,
    color: c.inputText,
    fontSize: 13,
  },
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: config.colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  signinHint: { fontSize: 12, color: c.textMuted, marginBottom: 10, fontStyle: 'italic' },
  commentRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  avatar: { width: 24, height: 24, borderRadius: 12 },
  avatarFallback: { backgroundColor: c.cardBg, alignItems: 'center', justifyContent: 'center' },
  commentName: { fontSize: 12, fontWeight: '700', color: c.text, flexShrink: 1 },
  commentTime: { fontSize: 10, color: c.textMuted },
  commentText: { fontSize: 12, color: c.textSecondary, marginTop: 1, lineHeight: 17 },
  emptyText: { fontSize: 12, color: c.textMuted, textAlign: 'center', marginVertical: 8 },
  moreBtn: {
    alignSelf: 'center',
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: config.colors.primary,
    marginTop: 2,
  },
  moreBtnText: { fontSize: 12, fontWeight: '700', color: config.colors.primary },
});

export default FeatureFeedback;
