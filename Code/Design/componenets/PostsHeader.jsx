import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import FontAwesome6 from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import config from '../../Helper/Environment';
import { useGlobalState } from '../../GlobelStats';

const TAG_CONFIG = {
  'Scam Alert': { icon: 'shield-halved', color: '#EF4444' },
  'Looking for Trade': { icon: 'handshake', color: '#10B981' },
  'Discussion': { icon: 'comments', color: '#3B82F6' },
  'Real or Fake': { icon: 'magnifying-glass', color: '#8B5CF6' },
  'Need Help': { icon: 'circle-question', color: '#F59E0B' },
  'Misc': { icon: 'ellipsis', color: '#6B7280' },
};

const PostsHeader = ({
  selectedTag,
  filterMyPosts,
  setFilterMyPosts,
  setSelectedTag,
  fetchInitialPosts,
  fetchMyPosts,
  fetchPostsByTag,
}) => {
  const { theme } = useGlobalState();
  const isDark = theme === 'dark';
  const { t } = useTranslation();

  const availableTags = [
    { label: t('feed.tags.scam_alert'), value: 'Scam Alert' },
    { label: t('feed.tags.looking_for_trade'), value: 'Looking for Trade' },
    { label: t('feed.tags.discussion'), value: 'Discussion' },
    { label: t('feed.tags.real_or_fake'), value: 'Real or Fake' },
    { label: t('feed.tags.need_help'), value: 'Need Help' },
    { label: t('feed.tags.misc'), value: 'Misc' },
  ];

  const handleSelectTag = (value) => {
    if (selectedTag === value) {
      setFilterMyPosts(false);
      setSelectedTag(null);
      fetchInitialPosts();
    } else {
      setFilterMyPosts(false);
      setSelectedTag(value);
      fetchPostsByTag(value);
    }
  };

  const handleMyPosts = () => {
    if (filterMyPosts) {
      setFilterMyPosts(false);
      setSelectedTag(null);
      fetchInitialPosts();
    } else {
      setFilterMyPosts(true);
      setSelectedTag(null);
      fetchMyPosts();
    }
  };

  const handleAll = () => {
    setFilterMyPosts(false);
    setSelectedTag(null);
    fetchInitialPosts();
  };

  const isAll = !filterMyPosts && !selectedTag;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[
        styles.tabBarScroll,
        { backgroundColor: isDark ? '#0f172a' : '#fff', borderBottomColor: isDark ? '#1e293b' : '#e8e8f0' }
      ]}
      contentContainerStyle={styles.tabBar}
    >
      {/* All */}
      <TouchableOpacity
        style={[styles.tab, isAll && { backgroundColor: config.colors.primary + '20' }]}
        onPress={handleAll}
        activeOpacity={0.8}
      >
        <FontAwesome6 name="border-all" size={11} color={isAll ? config.colors.primary : isDark ? '#888' : '#999'} solid />
        <Text style={[styles.tabText, { color: isDark ? '#888' : '#999' }, isAll && { color: config.colors.primary }]}>
          All Posts
        </Text>
      </TouchableOpacity>

      {/* My Posts */}
      <TouchableOpacity
        style={[styles.tab, filterMyPosts && { backgroundColor: config.colors.primary + '20' }]}
        onPress={handleMyPosts}
        activeOpacity={0.8}
      >
        <FontAwesome6 name="user" size={11} color={filterMyPosts ? config.colors.primary : isDark ? '#888' : '#999'} solid />
        <Text style={[styles.tabText, { color: isDark ? '#888' : '#999' }, filterMyPosts && { color: config.colors.primary }]}>
          {t('feed.my_posts')}
        </Text>
      </TouchableOpacity>

      {/* Separator */}
      <View style={[styles.separator, { backgroundColor: isDark ? '#334155' : '#e2e8f0' }]} />

      {/* Tag pills */}
      {availableTags.map(({ label, value }) => {
        const cfg = TAG_CONFIG[value] || { icon: 'tag', color: config.colors.primary };
        const isActive = selectedTag === value;
        return (
          <TouchableOpacity
            key={value}
            style={[styles.tab, isActive && { backgroundColor: cfg.color + '20' }]}
            onPress={() => handleSelectTag(value)}
            activeOpacity={0.8}
          >
            <FontAwesome6
              name={cfg.icon}
              size={11}
              color={isActive ? cfg.color : isDark ? '#888' : '#999'}
              solid
            />
            <Text style={[
              styles.tabText,
              { color: isDark ? '#888' : '#999' },
              isActive && { color: cfg.color, fontWeight: '800' },
            ]}>
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  tabBarScroll: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 1,
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 4,
    alignItems: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  separator: {
    width: 1,
    height: 20,
    borderRadius: 999,
    marginHorizontal: 4,
  },
});

export default PostsHeader;
