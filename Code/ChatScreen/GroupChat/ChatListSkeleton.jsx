// Skeleton placeholder rows for chat / group lists while the Supabase
// realtime channel is establishing its initial state. Replaces the
// generic centered ActivityIndicator with rows shaped like real list
// items, so the screen looks populated immediately and the ~1–3s
// cold-start lag on the mirror Cloud Function reads as "loading content"
// rather than "empty inbox."
//
// `SyncBanner` is the matching reconnecting pill — shown when the
// realtime channel drops back to a non-SUBSCRIBED state mid-session, so
// the user can tell stale data is in the process of being refreshed
// rather than wondering if the app is broken.

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Text, ActivityIndicator } from 'react-native';

export const ChatListSkeleton = ({ count = 6, isDarkMode = false }) => {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  const block = isDarkMode ? '#334155' : '#e5e7eb';
  const border = isDarkMode ? '#1f2937' : '#f1f5f9';

  return (
    <View>
      {Array.from({ length: count }).map((_, i) => (
        <View
          key={i}
          style={[styles.row, { borderBottomColor: border }]}
        >
          <Animated.View style={[styles.avatar, { backgroundColor: block, opacity }]} />
          <View style={styles.text}>
            <Animated.View
              style={[styles.line, { backgroundColor: block, opacity, width: '40%' }]}
            />
            <Animated.View
              style={[
                styles.line,
                { backgroundColor: block, opacity, width: '75%', marginTop: 8 },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
};

export const SyncBanner = ({ visible, isDarkMode }) => {
  if (!visible) return null;
  const fg = isDarkMode ? '#fbbf24' : '#92400e';
  const bg = isDarkMode ? '#1e293b' : '#fef3c7';
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <ActivityIndicator size="small" color={fg} />
      <Text style={[styles.bannerText, { color: fg }]}>Reconnecting…</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginRight: 10,
  },
  text: {
    flex: 1,
  },
  line: {
    height: 12,
    borderRadius: 6,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    gap: 8,
  },
  bannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

export default ChatListSkeleton;
