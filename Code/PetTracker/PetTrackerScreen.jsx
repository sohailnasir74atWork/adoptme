/**
 * PetTrackerScreen — "My Grinds" list + daily goal ring + New Grind flow.
 * Local-first: all state lives in trackerStorage (MMKV). No server calls.
 */

import React, { useState, useMemo, useEffect, useCallback, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Modal, ScrollView,
  TextInput, Image, Alert, KeyboardAvoidingView, Platform,
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
  getGrinds, createGrind, deleteGrind, subscribe, editSlot,
  todayCount, getDailyGoal, setDailyGoal,
} from './trackerStorage';
import {
  grindTotals, etaDays, measuredPace, tasksForRarity, petEquivalents,
  RARITIES, normalizeRarity, recommendNextSlot, FULL_GROWN_STAGE,
} from './agingMath';
import { getSessions } from './trackerStorage';
import { RARITY_COLORS, GOAL_COLORS, STAGE_KEYS, ProgressBar, ProgressRing, getPetImageUrl } from './trackerShared';
import FeatureFeedback from './FeatureFeedback';

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
      t('tracker.delete_confirm_title', { defaultValue: 'Stop growing this pet?' }),
      t('tracker.delete_confirm_msg', { defaultValue: "You'll lose your progress for this pet." }),
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
    const finished = totals.remaining === 0;
    // Show where the pet actually is ("Teen") rather than an abstract "34%".
    const rec = recommendNextSlot(item);
    const activeSlot = item.slots[rec?.index ?? 0];
    const stageKeys = STAGE_KEYS[activeSlot?.kind] || STAGE_KEYS.pet;
    const stageLabel = finished
      ? t('tracker.all_done', { defaultValue: 'All grown up!' })
      : t(`tracker.stage_${stageKeys[Math.min(activeSlot?.stage ?? 0, FULL_GROWN_STAGE)]}`, {
          defaultValue: stageKeys[Math.min(activeSlot?.stage ?? 0, FULL_GROWN_STAGE)],
        });
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
          <Text style={styles.grindMeta} numberOfLines={1}>
            {finished
              ? '🎉'
              : eta != null
                ? t('tracker.days_to_go', { count: eta, defaultValue: 'About {{count}} days to go' })
                : t('tracker.almost_there', { defaultValue: 'Almost there!' })}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={[styles.grindStage, { color: goalColor }]} numberOfLines={1}>{stageLabel}</Text>
          {/* Delete was long-press only, with no affordance — a commenter
              asked for a delete option that already existed. */}
          <TouchableOpacity
            onPress={() => confirmDelete(item)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="trash-outline" size={16} color={c.textMuted} />
          </TouchableOpacity>
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
          <Text style={styles.headerTitle}>{t('tracker.title', { defaultValue: 'My Pets' })}</Text>
          <TouchableOpacity onPress={() => setShowNew(true)} style={styles.headerBtn}>
            <Ionicons name="add" size={26} color={config.colors.primary} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* KAV iOS-only: Android handles the keyboard via adjustResize (see the
          reason-modal fix in BottomDrawer — stacking both causes flicker). */}
      <KeyboardAvoidingView behavior="padding" enabled={Platform.OS === 'ios'} style={{ flex: 1 }}>
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
          <Text style={styles.todayTitle}>{t('tracker.today_grind', { defaultValue: 'You played today!' })}</Text>
          <Text style={styles.todayCount}>
            {today} / {dailyGoal} {t('tracker.tasks', { defaultValue: 'tasks' })}
          </Text>
        </View>
        <TouchableOpacity style={styles.goalEditBtn} onPress={() => setShowGoalEdit(true)}>
          <Ionicons name="options-outline" size={18} color={c.textSecondary} />
        </TouchableOpacity>
      </View>

      {grinds.length === 0 ? (
        // Must scroll: the feedback section below grows as comment pages load,
        // and in a plain View the extra pages were cropped off-screen with no
        // way to reach them.
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* flex:1 would fight the growing sibling below inside a scroll
              container — size to content and let the ScrollView do the work. */}
          <View style={[styles.empty, { flex: 0, paddingVertical: 44 }]}>
            <FontAwesome name="dragon" size={42} color={c.textMuted} />
            <Text style={styles.emptyTitle}>{t('tracker.empty_title', { defaultValue: 'No pets yet!' })}</Text>
            <Text style={styles.emptySub}>
              {t('tracker.empty_sub', { defaultValue: "Pick your pet and we'll show you how long until it's all grown up." })}
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowNew(true)} activeOpacity={0.85}>
              <Text style={styles.emptyBtnText}>{t('tracker.start_grind', { defaultValue: 'Grow a pet' })}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ paddingHorizontal: 16 }}>
            <FeatureFeedback c={c} />
          </View>
        </ScrollView>
      ) : (
        <FlatList
          data={grinds}
          keyExtractor={(g) => g.id}
          renderItem={renderGrind}
          keyboardShouldPersistTaps="handled"
          // Without flex:1 the list isn't height-bounded, so the footer (which
          // grows with each loaded comment page) overflowed instead of scrolling.
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 24 }}
          ListFooterComponent={<FeatureFeedback c={c} />}
        />
      )}
      </KeyboardAvoidingView>

      {!localState.isPro && <BannerAdComponent collapsible />}
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
  const [startStage, setStartStage] = useState(0);
  // Neon/Mega planning and the rarity override are opt-in. A new user answers
  // one question — what stage is the pet at — and nothing else.
  const [plannerOpen, setPlannerOpen] = useState(false);

  useEffect(() => {
    if (!visible) {
      setSearch(''); setPet(null); setRarity(null);
      setGoal('fullgrown'); setStartStage(0); setPlannerOpen(false);
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list = q ? pets.filter(p => p.name.toLowerCase().includes(q)) : pets;
    return list.slice(0, 60);
  }, [pets, search]);

  const pickPet = (p) => {
    setPet(p);
    const r = normalizeRarity(p.rarity);
    setRarity(r);
    // normalizeRarity returns null for event/premium/missing rarities. The
    // create button needs one, and the picker now lives behind the toggle —
    // so open it, otherwise those pets are an unexplained dead end.
    if (!r) setPlannerOpen(true);
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
    // Most pets aren't newborns when you start tracking them, so seed the
    // first slot at the stage the kid told us.
    if (startStage > 0) editSlot(grind.id, 0, startStage, 0);
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
                : t('tracker.choose_pet', { defaultValue: 'Pick your pet' })}
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
                placeholder={t('tracker.search_pets', { defaultValue: 'Find a pet…' })}
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
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 16 + insets.bottom }}
            keyboardShouldPersistTaps="handled"
          >
            {/* The one question a new user answers. */}
            <Text style={styles.sectionLabel}>
              {t('tracker.which_stage', { defaultValue: 'What stage is your pet now?' })}
            </Text>
            <View style={styles.chipRow}>
              {STAGE_KEYS.pet.slice(0, FULL_GROWN_STAGE).map((key, i) => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setStartStage(i)}
                  style={[
                    styles.chip,
                    { borderColor: config.colors.primary },
                    startStage === i && { backgroundColor: config.colors.primary },
                  ]}
                >
                  <Text style={[styles.chipText, { color: startStage === i ? '#fff' : config.colors.primary }]}>
                    {t(`tracker.stage_${key}`, { defaultValue: key })}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Neon / Mega planning + rarity override. Collapsed: the goal
                picker sent new users straight into a 20-slot Mega grid, which
                is the most complex thing in the feature. */}
            <TouchableOpacity
              style={styles.plannerToggle}
              activeOpacity={0.7}
              onPress={() => setPlannerOpen(v => !v)}
            >
              <FontAwesome name="sliders" size={12} color={c.textSecondary} solid />
              <Text style={styles.plannerToggleText}>
                {t('tracker.planner', { defaultValue: 'Planning a Neon or Mega?' })}
              </Text>
              <Ionicons name={plannerOpen ? 'chevron-up' : 'chevron-down'} size={15} color={c.textSecondary} />
            </TouchableOpacity>

            {plannerOpen && (
              <>
                {/* Rarity — auto-filled from the pet, shown only to correct it. */}
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

                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>{t('tracker.goal_label', { defaultValue: 'What are you making?' })}</Text>
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
              </>
            )}

            <TouchableOpacity
              style={[styles.createBtn, !rarity && { opacity: 0.4 }]}
              disabled={!rarity}
              onPress={create}
              activeOpacity={0.85}
            >
              <Text style={styles.createBtnText}>{t('tracker.create_grind', { defaultValue: "Let's go!" })}</Text>
            </TouchableOpacity>
          </ScrollView>
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
          <Text style={styles.goalModalTitle}>{t('tracker.daily_goal', { defaultValue: 'Tasks per day' })}</Text>
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
  grindStage: { fontSize: 12, fontWeight: '800', textTransform: 'capitalize', maxWidth: 92, textAlign: 'right' },
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
  plannerToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 22,
    marginBottom: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: c.bgAlt,
  },
  plannerToggleText: { flex: 1, fontSize: 12, fontWeight: '700', color: c.textSecondary },

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
