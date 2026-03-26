/**
 * MyCosmeticsScreen.js — Standalone screen to view & manage won cosmetics
 * Extracted from MysteryEgg.js InventorySection
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  StatusBar, Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGlobalState } from '../GlobelStats';
import { getMyCosmetics, syncMyCosmetics, getCachedEggData, setCachedEggInventory } from '../Helper/cosmeticsCache';
import { getInventory, activateItem, deactivateItem, formatTimeRemaining } from './shopUtils';
import { RARITY_CONFIG, ALL_ITEMS, COSMETIC_TYPE } from './shopItems';
import FramedAvatar from '../ChatScreen/GroupChat/FramedAvatar';
import config from '../Helper/Environment';

const TYPE_LABELS = {
  profileFrame: { emoji: '🖼️', label: 'Profile Frames' },
  chatTextColor: { emoji: '🔤', label: 'Text Colors' },
  tradeCardBg: { emoji: '🃏', label: 'Trade Backgrounds' },
  profileBanner: { emoji: '🌈', label: 'Profile Banners' },
  chatBubbleBg: { emoji: '💬', label: 'Chat Bubbles' },
};

const MyCosmeticsScreen = ({ navigation }) => {
  const { theme, user, appdatabase } = useGlobalState();
  const isDark = theme === 'dark';
  const insets = useSafeAreaInsets();

  const [cosmetics, setCosmetics] = useState(() => getMyCosmetics());
  const [inventory, setInventory] = useState(() => getCachedEggData().inventory);
  const [loading, setLoading] = useState(true);

  // Sync from DB
  useEffect(() => {
    if (!user?.id || !appdatabase) { setLoading(false); return; }

    const load = async () => {
      const synced = await syncMyCosmetics(appdatabase, user.id, true);
      setCosmetics(synced);
      const inv = await getInventory(appdatabase, user.id);
      setInventory(inv);
      setCachedEggInventory(inv);
      setLoading(false);
    };
    load();
  }, [user?.id, appdatabase]);

  const handleActivate = useCallback(async (type, item) => {
    const ok = await activateItem(appdatabase, user.id, type, item);
    if (ok) setCosmetics(getMyCosmetics());
  }, [appdatabase, user?.id]);

  const handleDeactivate = useCallback(async (type) => {
    const ok = await deactivateItem(appdatabase, user.id, type);
    if (ok) setCosmetics(getMyCosmetics());
  }, [appdatabase, user?.id]);

  const hasAnyItems = useMemo(() => Object.keys(inventory).length > 0, [inventory]);
  const bgColor = isDark ? '#0f172a' : '#F8FAFC';

  return (
    <View style={[s.container, { backgroundColor: bgColor }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* ═══ HEADER ═══ */}
      <View style={[s.header, { paddingTop: insets.top + 8, backgroundColor: isDark ? '#1e1040' : config.colors.primary }]}>
        {/* Decorative bubbles */}
        <View style={[s.bubble, { top: insets.top - 20, right: -10, width: 90, height: 90, backgroundColor: isDark ? 'rgba(168,85,247,0.1)' : 'rgba(255,255,255,0.06)' }]} />
        <View style={[s.bubble, { top: insets.top + 10, left: -15, width: 70, height: 70, backgroundColor: isDark ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.05)' }]} />

        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Icon name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>

        <View style={s.headerCenter}>
          <Text style={{ fontSize: 26 }}>✨</Text>
          <View>
            <Text style={s.headerTitle}>My Cosmetics</Text>
            <Text style={s.headerSub}>Tap to equip • Tap active to remove</Text>
          </View>
        </View>

        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {!hasAnyItems ? (
          /* ── Empty State ── */
          <View style={s.emptyState}>
            <Text style={{ fontSize: 60, marginBottom: 16 }}>🎒</Text>
            <Text style={[s.emptyTitle, { color: isDark ? '#e2e8f0' : '#0f172a' }]}>
              No cosmetics yet!
            </Text>
            <Text style={[s.emptySubtitle, { color: isDark ? '#64748b' : '#94a3b8' }]}>
              Hatch Mystery Eggs to win profile frames, chat colors, trade backgrounds, and more!
            </Text>
            <TouchableOpacity
              style={s.emptyBtn}
              onPress={() => navigation.navigate('MysteryEggScreen')}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: 18 }}>🥚</Text>
              <Text style={s.emptyBtnText}>Hatch Mystery Eggs</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* ── Cosmetics Inventory ── */
          <>
            {Object.entries(inventory).map(([type, items]) => {
              const typeInfo = TYPE_LABELS[type] || { emoji: '🎁', label: type };
              const activeId = cosmetics?.[type]?.id;

              return (
                <View key={type} style={[s.typeSection, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}>
                  <Text style={[s.typeLabel, { color: isDark ? '#e2e8f0' : '#0f172a' }]}>
                    {typeInfo.emoji} {typeInfo.label}
                  </Text>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 8 }}>
                    {items.map((item, idx) => {
                      const isActive = activeId === item.id;
                      const rc = RARITY_CONFIG[item.rarity];
                      const isFrame = type === 'profileFrame';
                      const isTextColor = type === 'chatTextColor';
                      const itemDef = ALL_ITEMS[item.id];

                      return (
                        <TouchableOpacity
                          key={item._key || `${item.id}-${idx}`}
                          activeOpacity={0.7}
                          onPress={() => isActive ? handleDeactivate(type) : handleActivate(type, item)}
                          style={[
                            s.itemCard,
                            {
                              backgroundColor: isDark ? '#0f172a' : '#f8fafc',
                              borderColor: isActive ? '#22c55e' : (rc?.color + '40'),
                              borderWidth: isActive ? 3 : 2,
                              shadowColor: isActive ? '#22c55e' : 'transparent',
                              shadowOpacity: isActive ? 0.3 : 0,
                              shadowRadius: isActive ? 8 : 0,
                              elevation: isActive ? 4 : 0,
                            },
                          ]}
                        >
                          {/* Active badge */}
                          {isActive && (
                            <View style={s.activeBadge}>
                              <Text style={{ fontSize: 7, color: '#fff', fontWeight: '800' }}>✓ ON</Text>
                            </View>
                          )}

                          {/* Preview */}
                          <View style={s.previewWrap}>
                            {isFrame ? (
                              <FramedAvatar
                                avatarUri={null}
                                frame={{
                                  id: item.id,
                                  borderColors: item.borderColors || itemDef?.borderColors,
                                  borderWidth: item.borderWidth || itemDef?.borderWidth,
                                  glowColor: item.glowColor || itemDef?.glowColor,
                                }}
                                isDarkMode={isDark}
                                avatarSize={28}
                                isOnline={false}
                              />
                            ) : isTextColor ? (
                              <View style={{
                                width: 34, height: 34, borderRadius: 17,
                                backgroundColor: (item.color || itemDef?.color) === 'rainbow' ? '#A855F7' : (item.color || itemDef?.color || '#94a3b8'),
                                alignItems: 'center', justifyContent: 'center',
                              }}>
                                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>Aa</Text>
                              </View>
                            ) : type === 'profileBanner' ? (
                              <View style={{
                                width: 44, height: 22, borderRadius: 6,
                                backgroundColor: (item.gradient || itemDef?.gradient)?.[0] || '#7c3aed',
                                overflow: 'hidden',
                              }}>
                                <View style={{
                                  position: 'absolute', right: 0, top: 0, bottom: 0, width: 16,
                                  backgroundColor: (item.gradient || itemDef?.gradient)?.[2] || '#ec4899',
                                  opacity: 0.7,
                                }} />
                              </View>
                            ) : (
                              <View style={{
                                width: 34, height: 22, borderRadius: 10,
                                backgroundColor: isDark
                                  ? (item.darkColor || itemDef?.darkColor || item.color || itemDef?.color || '#94a3b8')
                                  : (item.color || itemDef?.color || '#94a3b8'),
                                borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)',
                              }} />
                            )}
                          </View>

                          {/* Name + Rarity */}
                          <Text style={[s.itemName, { color: isDark ? '#e2e8f0' : '#334155' }]} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={[s.itemRarity, { color: rc?.color }]}>
                            {rc?.emoji} {rc?.label}
                          </Text>
                          <Text style={[s.itemTime, { color: isDark ? '#64748b' : '#94a3b8' }]}>
                            {formatTimeRemaining(item.expiresAt)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              );
            })}

            {/* Link to get more */}
            <TouchableOpacity
              style={[s.getMoreBtn, { backgroundColor: isDark ? '#1e293b' : '#fff' }]}
              onPress={() => navigation.navigate('MysteryEggScreen')}
              activeOpacity={0.85}
            >
              <Text style={{ fontSize: 22 }}>🥚</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.getMoreTitle, { color: isDark ? '#e2e8f0' : '#0f172a' }]}>Want more?</Text>
                <Text style={[s.getMoreSub, { color: isDark ? '#64748b' : '#94a3b8' }]}>Hatch Mystery Eggs to win cosmetics!</Text>
              </View>
              <Icon name="chevron-forward" size={18} color={isDark ? '#64748b' : '#94a3b8'} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
};

const s = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  bubble: { position: 'absolute', borderRadius: 999 },
  backBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    zIndex: 2,
  },
  headerCenter: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    gap: 10, marginLeft: 12, zIndex: 2,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 1 },

  scrollContent: { padding: 16, paddingBottom: 40 },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  emptyTitle: { fontSize: 22, fontWeight: '800', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#EC4899',
    paddingVertical: 14, paddingHorizontal: 28,
    borderRadius: 18,
    shadowColor: '#EC4899', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 5,
  },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Type sections
  typeSection: {
    borderRadius: 18, padding: 14, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  typeLabel: { fontSize: 15, fontWeight: '700' },

  // Item card
  itemCard: {
    width: 90, borderRadius: 14, padding: 10,
    alignItems: 'center', position: 'relative', overflow: 'visible',
  },
  activeBadge: {
    position: 'absolute', top: -6, right: -4,
    backgroundColor: '#22c55e',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
    zIndex: 10,
    shadowColor: '#22c55e', shadowOpacity: 0.4, shadowRadius: 4,
  },
  previewWrap: { marginBottom: 6, height: 38, justifyContent: 'center', alignItems: 'center' },
  itemName: { fontSize: 10, fontWeight: '700', textAlign: 'center' },
  itemRarity: { fontSize: 8, fontWeight: '600', marginTop: 2 },
  itemTime: { fontSize: 8, fontWeight: '500', marginTop: 1 },

  // Get more button
  getMoreBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderRadius: 18, marginTop: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  getMoreTitle: { fontSize: 14, fontWeight: '700' },
  getMoreSub: { fontSize: 11, marginTop: 1 },
});

export default MyCosmeticsScreen;
