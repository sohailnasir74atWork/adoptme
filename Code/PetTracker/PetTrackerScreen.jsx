/**
 * PetTrackerScreen — "My Grinds" list + daily goal ring + New Grind flow.
 * Local-first: all state lives in trackerStorage (MMKV). No server calls.
 */

import React, { useState, useMemo, useEffect, useCallback, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal,
  TextInput, Image, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useGlobalState } from '../GlobelStats';
import { useLocalState } from '../LocalGlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import config from '../Helper/Environment';
import BannerAdComponent from '../Ads/bannerAds';
import {
  getGrinds, createGrind, deleteGrind, subscribe,
  todayCount, getDailyGoal, setDailyGoal,
} from './trackerStorage';
import { grindTotals, etaDays, measuredPace, tasksForRarity, petEquivalents, RARITIES, normalizeRarity } from './agingMath';
import { getSessions } from './trackerStorage';
import { RARITY_COLORS, GOAL_COLORS, ProgressBar, ProgressRing, getPetImageUrl } from './trackerShared';

const PET_TYPES = ['PETS', 'PET'];
const isPetType = (type) => PET_TYPES.includes(String(type || '').toUpperCase());

const GOALS_META = [
  { key: 'fullgrown', icon: 'paw' },
  { key: 'neon', icon: 'bolt' },
  { key: 'mega', icon: 'star' },
];

const PetTrackerScreen = () => {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { theme } = useGlobalState();
  const { localState } = useLocalState();
  const isDarkMode = theme === 'dark';
  const c = useMemo(() => getThemeColors(isDarkMode), [isDarkMode]);
  const styles = useMemo(() => getStyles(c), [c]);

  const grinds = useSyncExternalStore(subscribe, getGrinds);
  const today = todayCount();
  const dailyGoal = getDailyGoal();
  const pace = measuredPace(getSessions());

  const [showNew, setShowNew] = useState(false);
  const [showGoalEdit, setShowGoalEdit] = useState(false);

  // ── Pet list for the picker ──
  const allPets = useMemo(() => {
    try {
      const raw = localState.data;
      if (!raw) return [];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const items = typeof parsed === 'object' && parsed !== null ? Object.values(parsed) : [];
      return items.filter(i => i?.name && isPetType(i.type));
    } catch { return []; }
  }, [localState.data]);

  const confirmDelete = useCallback((grind) => {
    Alert.alert(
      t('tracker.delete_confirm_title', { defaultValue: 'Delete this grind?' }),
      t('tracker.delete_confirm_msg', { defaultValue: 'Your progress for this grind will be removed.' }),
      [
        { text: t('tracker.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        { text: t('tracker.delete', { defaultValue: 'Delete' }), style: 'destructive', onPress: () => deleteGrind(grind.id) },
      ],
    );
  }, [t]);

  const renderGrind = useCallback(({ item }) => {
    const totals = grindTotals(item);
    const eta = etaDays(totals.remaining, pace || item.tasksPerDay);
    const goalColor = GOAL_COLORS[item.goal] || config.colors.primary;
    return (
      <TouchableOpacity
        style={styles.grindCard}
        activeOpacity={0.75}
        onPress={() => navigation.navigate('GrindDetail', { grindId: item.id })}
        onLongPress={() => confirmDelete(item)}
      >
        {item.imageUrl ? (
          <Image source={{ uri: item.imageUrl }} style={styles.grindImage} resizeMode="contain" />
        ) : (
          <View style={[styles.grindImage, styles.grindImageFallback]}>
            <FontAwesome name="paw" size={18} color={c.textMuted} />
          </View>
        )}
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.grindName} numberOfLines={1}>{item.petName}</Text>
            <View style={[styles.goalBadge, { backgroundColor: `${goalColor}22` }]}>
              <Text style={[styles.goalBadgeText, { color: goalColor }]}>
                {t(`tracker.goal_${item.goal}`, { defaultValue: item.goal })}
              </Text>
            </View>
          </View>
          <ProgressBar
            pct={totals.pct}
            color={goalColor}
            trackColor={c.borderLight}
            style={{ marginTop: 7, marginBottom: 5 }}
          />
          <Text style={styles.grindMeta}>
            {t('tracker.tasks_left', { count: totals.remaining, defaultValue: '{{count}} tasks left' })}
            {eta != null && totals.remaining > 0 ? `  ·  ≈${eta}d` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={[styles.grindPct, { color: goalColor }]}>{totals.pct}%</Text>
          <FontAwesome name="chevron-right" size={11} color={c.textMuted} />
        </View>
      </TouchableOpacity>
    );
  }, [styles, c, t, navigation, pace, confirmDelete]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={22} color={c.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('tracker.title', { defaultValue: 'Pet Tracker' })}</Text>
          <TouchableOpacity onPress={() => setShowNew(true)} style={styles.headerBtn}>
            <Ionicons name="add" size={26} color={config.colors.primary} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Today's grind */}
      <View style={styles.todayCard}>
        <ProgressRing
          size={64}
          stroke={7}
          pct={dailyGoal > 0 ? (today / dailyGoal) * 100 : 0}
          color={config.colors.primary}
          trackColor={c.borderLight}
        >
          <Text style={styles.todayPct}>{dailyGoal > 0 ? Math.min(999, Math.round((today / dailyGoal) * 100)) : 0}%</Text>
        </ProgressRing>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.todayTitle}>{t('tracker.today_grind', { defaultValue: "Today's Grind" })}</Text>
          <Text style={styles.todayCount}>
            {today} / {dailyGoal} {t('tracker.tasks', { defaultValue: 'tasks' })}
          </Text>
          {pace != null && (
            <Text style={styles.todayPace}>
              {t('tracker.your_pace', { count: pace, defaultValue: 'Your pace: {{count}}/day' })}
            </Text>
          )}
        </View>
        <TouchableOpacity style={styles.goalEditBtn} onPress={() => setShowGoalEdit(true)}>
          <Ionicons name="options-outline" size={18} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      {grinds.length === 0 ? (
        <View style={styles.empty}>
          <FontAwesome name="dragon" size={42} color={c.textMuted} />
          <Text style={styles.emptyTitle}>{t('tracker.empty_title', { defaultValue: 'No grinds yet' })}</Text>
          <Text style={styles.emptySub}>
            {t('tracker.empty_sub', { defaultValue: 'Pick a pet and a goal — we count every task to Full Grown, Neon or Mega.' })}
          </Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowNew(true)} activeOpacity={0.85}>
            <Text style={styles.emptyBtnText}>{t('tracker.start_grind', { defaultValue: 'Start a grind' })}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={grinds}
          keyExtractor={(g) => g.id}
          renderItem={renderGrind}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 24 }}
        />
      )}

      {!localState.isPro && <BannerAdComponent />}
      <SafeAreaView edges={['bottom']} style={{ backgroundColor: c.bg }} />

      <NewGrindModal
        visible={showNew}
        onClose={() => setShowNew(false)}
        pets={allPets}
        imgurl={localState.imgurl}
        c={c}
        t={t}
        onCreated={(grind) => {
          setShowNew(false);
          navigation.navigate('GrindDetail', { grindId: grind.id });
        }}
      />

      <DailyGoalModal
        visible={showGoalEdit}
        onClose={() => setShowGoalEdit(false)}
        c={c}
        t={t}
        current={dailyGoal}
      />
    </View>
  );
};

// ── New Grind modal ────────────────────────────────────────────────────

const NewGrindModal = ({ visible, onClose, pets, imgurl, c, t, onCreated }) => {
  const styles = useMemo(() => getStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [pet, setPet] = useState(null);
  const [rarity, setRarity] = useState(null);
  const [goal, setGoal] = useState('fullgrown');

  useEffect(() => {
    if (!visible) { setSearch(''); setPet(null); setRarity(null); setGoal('fullgrown'); }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = q ? pets.filter(p => p.name.toLowerCase().includes(q)) : pets;
    return list.slice(0, 60);
  }, [pets, search]);

  const pickPet = (p) => {
    setPet(p);
    setRarity(normalizeRarity(p.rarity));
  };

  const create = () => {
    if (!pet || !rarity) return;
    const grind = createGrind({
      petKey: pet.name.toLowerCase().trim(),
      petName: pet.name,
      imageUrl: getPetImageUrl(pet, imgurl),
      rarity,
      goal,
    });
    onCreated(grind);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }}>
          <View style={styles.header}>
            <TouchableOpacity onPress={pet ? () => setPet(null) : onClose} style={styles.headerBtn}>
              <Ionicons name={pet ? 'arrow-back' : 'close'} size={22} color={c.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              {pet
                ? pet.name
                : t('tracker.choose_pet', { defaultValue: 'Choose a pet' })}
            </Text>
            <View style={styles.headerBtn} />
          </View>
        </SafeAreaView>

        {!pet ? (
          <>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={c.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('tracker.search_pets', { defaultValue: 'Search pets…' })}
                placeholderTextColor={c.placeholder}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
              />
            </View>
            <FlatList
              data={filtered}
              keyExtractor={(p, i) => `${p.name}-${i}`}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: insets.bottom + 12 }}
              renderItem={({ item }) => {
                const rKey = normalizeRarity(item.rarity);
                return (
                  <TouchableOpacity style={styles.petRow} onPress={() => pickPet(item)} activeOpacity={0.7}>
                    <Image source={{ uri: getPetImageUrl(item, imgurl) }} style={styles.petRowImage} resizeMode="contain" />
                    <Text style={styles.petRowName} numberOfLines={1}>{item.name}</Text>
                    {rKey && (
                      <Text style={[styles.petRowRarity, { color: RARITY_COLORS[rKey] }]}>
                        {t(`rarities.${rKey.toUpperCase()}`, { defaultValue: rKey })}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </>
        ) : (
          <View style={{ padding: 16, flex: 1, paddingBottom: 16 + insets.bottom }}>
            {/* Rarity */}
            <Text style={styles.sectionLabel}>{t('tracker.rarity_label', { defaultValue: 'Rarity' })}</Text>
            <View style={styles.chipRow}>
              {RARITIES.map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setRarity(r)}
                  style={[
                    styles.chip,
                    { borderColor: RARITY_COLORS[r] },
                    rarity === r && { backgroundColor: RARITY_COLORS[r] },
                  ]}
                >
                  <Text style={[styles.chipText, { color: rarity === r ? '#fff' : RARITY_COLORS[r] }]}>
                    {t(`rarities.${r.toUpperCase()}`, { defaultValue: r })}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Goal */}
            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{t('tracker.goal_label', { defaultValue: 'Goal' })}</Text>
            {GOALS_META.map(({ key, icon }) => {
              const total = rarity ? tasksForRarity(rarity) * petEquivalents(key) : 0;
              const active = goal === key;
              const color = GOAL_COLORS[key];
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => setGoal(key)}
                  activeOpacity={0.8}
                  style={[styles.goalCard, active && { borderColor: color, backgroundColor: `${color}14` }]}
                >
                  <FontAwesome name={icon} size={16} color={color} solid />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.goalTitle}>{t(`tracker.goal_${key}`, { defaultValue: key })}</Text>
                    <Text style={styles.goalDesc}>
                      {t(`tracker.goal_desc_${key}`, { defaultValue: '' })}
                    </Text>
                  </View>
                  {rarity && (
                    <Text style={[styles.goalTotal, { color }]}>
                      {t('tracker.tasks_total', { count: total, defaultValue: '{{count}} tasks' })}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[styles.createBtn, !rarity && { opacity: 0.4 }]}
              disabled={!rarity}
              onPress={create}
              activeOpacity={0.85}
            >
              <Text style={styles.createBtnText}>{t('tracker.create_grind', { defaultValue: 'Start tracking' })}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
};

// ── Daily goal modal ───────────────────────────────────────────────────

const DailyGoalModal = ({ visible, onClose, c, t, current }) => {
  const styles = useMemo(() => getStyles(c), [c]);
  const [value, setValue] = useState(current);
  useEffect(() => { if (visible) setValue(current); }, [visible, current]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.goalModal}>
          <Text style={styles.goalModalTitle}>{t('tracker.daily_goal', { defaultValue: 'Daily goal' })}</Text>
          <View style={styles.stepperRow}>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setValue(v => Math.max(5, v - 5))}>
              <Ionicons name="remove" size={22} color={c.text} />
            </TouchableOpacity>
            <Text style={styles.stepValue}>{value}</Text>
            <TouchableOpacity style={styles.stepBtn} onPress={() => setValue(v => Math.min(500, v + 5))}>
              <Ionicons name="add" size={22} color={c.text} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => { setDailyGoal(value); onClose(); }}
            activeOpacity={0.85}
          >
            <Text style={styles.createBtnText}>{t('tracker.save', { defaultValue: 'Save' })}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// ── Styles ─────────────────────────────────────────────────────────────

const getStyles = (c) => StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 44,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: c.text, flex: 1, textAlign: 'center' },

  todayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 16,
    backgroundColor: c.bgAlt,
  },
  todayPct: { fontSize: 13, fontWeight: '800', color: c.text },
  todayTitle: { fontSize: 14, fontWeight: '700', color: c.text },
  todayCount: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  todayPace: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  goalEditBtn: { padding: 8 },

  grindCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 16,
    backgroundColor: c.bgAlt,
    marginBottom: 10,
  },
  grindImage: { width: 44, height: 44, borderRadius: 10 },
  grindImageFallback: { backgroundColor: c.cardBg, alignItems: 'center', justifyContent: 'center' },
  grindName: { fontSize: 15, fontWeight: '700', color: c.text, flexShrink: 1 },
  grindMeta: { fontSize: 11, color: c.textSecondary },
  grindPct: { fontSize: 15, fontWeight: '800', marginBottom: 4 },
  goalBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  goalBadgeText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: c.text, marginTop: 14 },
  emptySub: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  emptyBtn: {
    marginTop: 18,
    backgroundColor: config.colors.primary,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 22,
  },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: c.inputBg,
    borderWidth: 1,
    borderColor: c.inputBorder,
  },
  searchInput: { flex: 1, height: 42, color: c.inputText, fontSize: 14 },
  petRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  petRowImage: { width: 36, height: 36, borderRadius: 8, marginRight: 10 },
  petRowName: { flex: 1, fontSize: 14, fontWeight: '600', color: c.text },
  petRowRarity: { fontSize: 11, fontWeight: '700' },

  sectionLabel: { fontSize: 13, fontWeight: '700', color: c.textSecondary, marginBottom: 8, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 12, fontWeight: '700' },

  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: c.border,
    marginBottom: 10,
  },
  goalTitle: { fontSize: 14, fontWeight: '700', color: c.text },
  goalDesc: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  goalTotal: { fontSize: 12, fontWeight: '800' },

  createBtn: {
    marginTop: 'auto',
    backgroundColor: config.colors.primary,
    borderRadius: 24,
    paddingVertical: 13,
    alignItems: 'center',
  },
  createBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  goalModal: { width: 260, borderRadius: 18, backgroundColor: c.bgElevated, padding: 18 },
  goalModalTitle: { fontSize: 15, fontWeight: '700', color: c.text, textAlign: 'center' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginVertical: 16 },
  stepBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.border,
  },
  stepValue: { fontSize: 24, fontWeight: '800', color: c.text, minWidth: 60, textAlign: 'center' },
});

export default PetTrackerScreen;
