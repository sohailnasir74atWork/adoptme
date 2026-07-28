/**
 * GrindDetailScreen — pet grid + task logging for one goal.
 *
 * Written for ~10-year-olds (see tracker_feedback: most confusion reports).
 * The hero says where the pet IS ("Teen") and how long is left in days; the
 * exact counts, potion maths and pace picker live under Advanced. Logging is
 * one big "I played!" button opening a sheet where each amount is spelled out,
 * replacing a row of five chips reading "+1 +5 +10 +30 Finish stage".
 */

import React, { useState, useMemo, useEffect, useCallback, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Image, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import { useTranslation } from 'react-i18next';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useGlobalState } from '../GlobelStats';
import { getThemeColors } from '../Helper/themeColors';
import config from '../Helper/Environment';
import {
  getGrind, deleteGrind, subscribe, logTasks, logFinishStage, editSlot,
  updateGrindFields, getSessions,
} from './trackerStorage';
import {
  grindTotals, slotDone, slotRemaining, tasksForRarity, potionEquivalent,
  etaDays, measuredPace, recommendNextSlot, stageTasksFor,
  FULL_GROWN_STAGE, DEFAULTS,
} from './agingMath';
import { GOAL_COLORS, STAGE_KEYS, ProgressBar, ProgressRing } from './trackerShared';

const PACE_PRESETS = DEFAULTS.paceOptions || [30, 60, 100];

const GrindDetailScreen = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { t } = useTranslation();
  const { theme } = useGlobalState();
  const isDarkMode = theme === 'dark';
  const c = useMemo(() => getThemeColors(isDarkMode), [isDarkMode]);
  const styles = useMemo(() => getStyles(c), [c]);
  const insets = useSafeAreaInsets();

  const grindId = route.params?.grindId;
  const grind = useSyncExternalStore(
    subscribe,
    useCallback(() => getGrind(grindId), [grindId]),
  );

  // null = "follow the recommendation" until the kid taps a tile themselves.
  const [picked, setPicked] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [advOpen, setAdvOpen] = useState(false);

  const stageName = useCallback((kind, stage) => {
    const keys = STAGE_KEYS[kind] || STAGE_KEYS.pet;
    const key = keys[Math.min(stage, FULL_GROWN_STAGE)];
    return t(`tracker.stage_${key}`, { defaultValue: key });
  }, [t]);

  if (!grind) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: c.textSecondary }}>{t('tracker.not_found', { defaultValue: 'Pet not found' })}</Text>
      </View>
    );
  }

  const totals = grindTotals(grind);
  const goalColor = GOAL_COLORS[grind.goal] || config.colors.primary;
  const pace = measuredPace(getSessions());
  const effectivePace = pace || grind.tasksPerDay;
  const eta = etaDays(totals.remaining, effectivePace);
  const potions = potionEquivalent(totals.remaining);
  const rec = recommendNextSlot(grind);
  // Default to the pet the tracker recommends, so a kid never has to work out
  // which tile to tap first. If the one they picked is already finished, fall
  // back to the recommendation — otherwise the big button would sit there
  // greyed out with nothing explaining why.
  const pickedIdx = picked != null ? Math.min(picked, grind.slots.length - 1) : null;
  const pickedFinished = pickedIdx != null
    && slotRemaining(grind.rarity, grind.slots[pickedIdx]) <= 0;
  const selected = (pickedIdx == null || pickedFinished) ? (rec?.index ?? 0) : pickedIdx;
  const setSelected = setPicked;
  const selSlot = grind.slots[selected];
  const selRemaining = slotRemaining(grind.rarity, selSlot);
  const isMega = grind.goal === 'mega';
  const allDone = totals.remaining === 0;

  const confirmDelete = () => {
    Alert.alert(
      t('tracker.delete_confirm_title', { defaultValue: 'Stop growing this pet?' }),
      t('tracker.delete_confirm_msg', { defaultValue: "You'll lose your progress for this pet." }),
      [
        { text: t('tracker.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        {
          text: t('tracker.delete', { defaultValue: 'Delete' }),
          style: 'destructive',
          onPress: () => { deleteGrind(grind.id); navigation.goBack(); },
        },
      ],
    );
  };

  const slotLabel = (slot, index) => {
    if (slot.kind === 'neon') return t('tracker.slot_neon', { defaultValue: 'Neon' });
    const numInGroup = grind.slots.slice(0, index).filter(s => s.group === slot.group && s.kind === 'pet').length + 1;
    return t('tracker.slot_pet', { num: isMega ? numInGroup : index + 1, defaultValue: 'Pet {{num}}' });
  };

  const renderSlotTile = (slot, index) => {
    const done = slotDone(grind.rarity, slot);
    const total = tasksForRarity(grind.rarity);
    const pct = Math.round((done / total) * 100);
    const finished = slot.stage >= FULL_GROWN_STAGE;
    const active = index === selected;
    const stages = stageTasksFor(grind.rarity);
    return (
      <TouchableOpacity
        key={index}
        style={[
          styles.slotTile,
          slot.kind === 'neon' && styles.slotTileNeon,
          active && { borderColor: goalColor, borderWidth: 2 },
        ]}
        activeOpacity={0.75}
        onPress={() => setSelected(index)}
        onLongPress={() => { setSelected(index); setEditorOpen(true); }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.slotLabel, slot.kind === 'neon' && { color: '#2ecc71' }]} numberOfLines={1}>
            {slotLabel(slot, index)}
          </Text>
          {finished && <Ionicons name="checkmark-circle" size={14} color="#10B981" />}
        </View>
        <ProgressBar
          pct={pct}
          color={finished ? '#10B981' : goalColor}
          trackColor={c.borderLight}
          height={5}
          style={{ marginVertical: 6 }}
        />
        <Text style={styles.slotStage} numberOfLines={1}>
          {stageName(slot.kind, slot.stage)}
          {!finished ? ` · ${slot.tasksDone}/${stages[slot.stage]}` : ''}
        </Text>
      </TouchableOpacity>
    );
  };

  const groups = isMega ? [0, 1, 2, 3] : [0];

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: c.bg }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={22} color={c.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle} numberOfLines={1}>{grind.petName}</Text>
          <TouchableOpacity onPress={confirmDelete} style={styles.headerBtn}>
            <Ionicons name="trash-outline" size={20} color={c.textSecondary} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 + insets.bottom }}>
        {/* Hero */}
        <View style={styles.hero}>
          <ProgressRing size={86} stroke={9} pct={totals.pct} color={goalColor} trackColor={c.borderLight}>
            {grind.imageUrl ? (
              <Image source={{ uri: grind.imageUrl }} style={{ width: 52, height: 52 }} resizeMode="contain" />
            ) : (
              <Text style={[styles.heroPct, { color: goalColor }]}>{totals.pct}%</Text>
            )}
          </ProgressRing>
          <View style={{ flex: 1, marginLeft: 14 }}>
            {/* Big line = where the pet is right now, in words a kid reads at a
                glance. The percentage / task counts moved into Advanced. */}
            <Text style={[styles.heroStage, { color: goalColor }]} numberOfLines={1}>
              {allDone
                ? t('tracker.all_done', { defaultValue: 'All grown up!' })
                : stageName(selSlot.kind, selSlot.stage)}
            </Text>
            <Text style={styles.heroLine}>
              {allDone
                ? '🎉'
                : eta != null
                  ? t('tracker.days_to_go', { count: eta, defaultValue: 'About {{count}} days to go' })
                  : t('tracker.almost_there', { defaultValue: 'Almost there!' })}
            </Text>
            <Text style={styles.heroSub}>
              {t(`tracker.goal_${grind.goal}`, { defaultValue: grind.goal })}
            </Text>
          </View>
        </View>

        {/* Which pet we're on — pointless when the goal only has one pet. */}
        {rec && !allDone && grind.slots.length > 1 && (
          <TouchableOpacity style={styles.recRow} activeOpacity={0.8} onPress={() => setSelected(rec.index)}>
            <FontAwesome name="wand-magic-sparkles" size={12} color={config.colors.primary} solid />
            <Text style={styles.recText} numberOfLines={2}>
              {t('tracker.next_up', {
                name: slotLabel(grind.slots[rec.index], rec.index),
                defaultValue: 'Growing now: {{name}}',
              })}
            </Text>
          </TouchableOpacity>
        )}

        {allDone && (
          <View style={[styles.recRow, { backgroundColor: '#10B98122' }]}>
            <Text style={[styles.recText, { color: '#10B981', fontWeight: '800' }]}>
              🎉 {t('tracker.all_done', { defaultValue: 'All grown up!' })}
            </Text>
          </View>
        )}

        {/* Slots */}
        {groups.map((g) => (
          <View key={g}>
            {isMega && (
              <Text style={styles.groupTitle}>
                {t('tracker.group_neon', { num: g + 1, defaultValue: 'Neon #{{num}}' })}
              </Text>
            )}
            <View style={styles.slotGrid}>
              {grind.slots.map((slot, i) => (slot.group === g ? renderSlotTile(slot, i) : null))}
            </View>
          </View>
        ))}

        {/* Advanced — the exact numbers and the pace picker. Collapsed by
            default: the feedback said the dashboard was the confusing part,
            but the players who do want it shouldn't lose it. */}
        <TouchableOpacity
          style={styles.advToggle}
          activeOpacity={0.7}
          onPress={() => setAdvOpen(v => !v)}
        >
          <Text style={styles.advToggleText}>{t('tracker.advanced', { defaultValue: 'Advanced' })}</Text>
          <Ionicons name={advOpen ? 'chevron-up' : 'chevron-down'} size={15} color={c.textSecondary} />
        </TouchableOpacity>

        {advOpen && (
          <View style={styles.advBody}>
            <Text style={styles.advLine}>
              {totals.pct}%  ·  {t('tracker.tasks_left', { count: totals.remaining, defaultValue: '{{count}} tasks left' })}
              {'  ·  ≈ '}{potions} {t('tracker.potions', { defaultValue: 'potions' })}
            </Text>
            <View style={styles.paceRow}>
              {pace != null ? (
                <Text style={styles.paceMeasured}>
                  {t('tracker.your_pace', { count: pace, defaultValue: 'You do about {{count}} tasks a day' })}
                </Text>
              ) : (
                <>
                  <Text style={styles.paceLabel}>{t('tracker.pace_label', { defaultValue: 'Pace' })}</Text>
                  {PACE_PRESETS.map((p) => (
                    <TouchableOpacity
                      key={p}
                      onPress={() => updateGrindFields(grind.id, { tasksPerDay: p })}
                      style={[styles.paceChip, grind.tasksPerDay === p && { backgroundColor: goalColor, borderColor: goalColor }]}
                    >
                      <Text style={[styles.paceChipText, grind.tasksPerDay === p && { color: '#fff' }]}>{p}/d</Text>
                    </TouchableOpacity>
                  ))}
                </>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* One big button instead of a row of five. Picking the amount moved
          into a sheet where every choice is spelled out in words. */}
      {!allDone && (
        <View style={[styles.actionBar, { borderTopColor: c.border, paddingBottom: 10 + insets.bottom }]}>
          <Text style={styles.actionTarget} numberOfLines={1}>
            {grind.slots.length > 1 ? `${slotLabel(selSlot, selected)} · ` : ''}
            {stageName(selSlot.kind, selSlot.stage)}
          </Text>
          <TouchableOpacity
            style={[styles.playedBtn, { backgroundColor: goalColor }, selRemaining <= 0 && styles.actionBtnDisabled]}
            disabled={selRemaining <= 0}
            onPress={() => setLogOpen(true)}
            activeOpacity={0.85}
          >
            <FontAwesome name="gamepad" size={16} color="#fff" solid />
            <Text style={styles.playedBtnText}>{t('tracker.i_played', { defaultValue: 'I played!' })}</Text>
          </TouchableOpacity>
        </View>
      )}

      <LogTasksModal
        visible={logOpen}
        onClose={() => setLogOpen(false)}
        grind={grind}
        slotIndex={selected}
        goalColor={goalColor}
        c={c}
        t={t}
      />

      <SlotEditorModal
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        grind={grind}
        slotIndex={selected}
        c={c}
        t={t}
        stageName={stageName}
      />
    </View>
  );
};

// ── "I played!" sheet ──────────────────────────────────────────────────
// Every choice is a full-width row labelled in words. The old UI had these
// as five cramped chips reading "+1 +5 +10 +30 Finish stage", which assumed
// you already knew that 30 meant a potion.

const LogTasksModal = ({ visible, onClose, grind, slotIndex, goalColor, c, t }) => {
  const styles = useMemo(() => getStyles(c), [c]);

  const rows = [
    ...[1, 5, 10].map((n) => ({
      key: `n${n}`,
      icon: 'paw',
      color: goalColor,
      label: t('tracker.tasks_total', { count: n, defaultValue: '{{count}} tasks' }),
      run: () => logTasks(grind.id, slotIndex, n),
    })),
    {
      key: 'potion',
      icon: 'flask',
      color: '#9b59b6',
      label: t('tracker.used_potion', { defaultValue: 'I used an Age-Up Potion' }),
      run: () => logTasks(grind.id, slotIndex, DEFAULTS.potionTasks || 30),
    },
    {
      key: 'stage',
      icon: 'circle-check',
      color: '#10B981',
      label: t('tracker.finish_stage', { defaultValue: 'This stage is done!' }),
      run: () => logFinishStage(grind.id, slotIndex),
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.editorModal}>
          <Text style={styles.editorTitle}>
            {t('tracker.how_many', { defaultValue: 'How many tasks did you do?' })}
          </Text>
          {rows.map((r) => (
            <TouchableOpacity
              key={r.key}
              style={[styles.logRow, { borderColor: r.color }]}
              activeOpacity={0.8}
              onPress={() => { r.run(); onClose(); }}
            >
              <FontAwesome name={r.icon} size={15} color={r.color} solid />
              <Text style={[styles.logRowText, { color: r.color }]} numberOfLines={1}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

// ── Slot editor (long-press a tile) ────────────────────────────────────

const SlotEditorModal = ({ visible, onClose, grind, slotIndex, c, t, stageName }) => {
  const styles = useMemo(() => getStyles(c), [c]);
  const slot = grind.slots[slotIndex];
  const [stage, setStage] = useState(slot?.stage ?? 0);
  const [tasks, setTasks] = useState(slot?.tasksDone ?? 0);

  useEffect(() => {
    if (visible && slot) { setStage(slot.stage); setTasks(slot.tasksDone); }
  }, [visible, slotIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!slot) return null;
  const stages = stageTasksFor(grind.rarity);
  const maxTasks = stage >= FULL_GROWN_STAGE ? 0 : Math.max(0, stages[stage] - 1);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.editorModal}>
          <Text style={styles.editorTitle}>{t('tracker.edit_slot', { defaultValue: 'Fix my progress' })}</Text>

          <Text style={styles.editorLabel}>{t('tracker.stage_label', { defaultValue: 'Stage' })}</Text>
          <View style={styles.stageChipWrap}>
            {[0, 1, 2, 3, 4, 5].map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => { setStage(s); setTasks(0); }}
                style={[styles.stageChip, stage === s && { backgroundColor: config.colors.primary, borderColor: config.colors.primary }]}
              >
                <Text style={[styles.stageChipText, stage === s && { color: '#fff' }]}>
                  {stageName(slot.kind, s)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {stage < FULL_GROWN_STAGE && (
            <>
              <Text style={styles.editorLabel}>
                {t('tracker.tasks_in_stage', { defaultValue: 'Tasks finished' })} ({tasks}/{stages[stage]})
              </Text>
              <View style={styles.stepperRow}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => setTasks(v => Math.max(0, v - 1))}>
                  <Ionicons name="remove" size={20} color={c.text} />
                </TouchableOpacity>
                <Text style={styles.stepValue}>{tasks}</Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => setTasks(v => Math.min(maxTasks, v + 1))}>
                  <Ionicons name="add" size={20} color={c.text} />
                </TouchableOpacity>
              </View>
            </>
          )}

          <TouchableOpacity
            style={styles.saveBtn}
            activeOpacity={0.85}
            onPress={() => { editSlot(grind.id, slotIndex, stage, tasks); onClose(); }}
          >
            <Text style={styles.saveBtnText}>{t('tracker.save', { defaultValue: 'Save' })}</Text>
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

  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: c.bgAlt,
    borderRadius: 18,
    padding: 14,
  },
  heroPct: { fontSize: 16, fontWeight: '800' },
  heroStage: { fontSize: 24, fontWeight: '800', textTransform: 'capitalize' },
  heroLine: { fontSize: 14, fontWeight: '600', color: c.text, marginTop: 3 },
  heroSub: { fontSize: 12, color: c.textSecondary, marginTop: 3, textTransform: 'capitalize' },

  paceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  paceLabel: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
  paceMeasured: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
  paceChip: {
    borderWidth: 1.5, borderColor: c.border, borderRadius: 14,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  paceChipText: { fontSize: 12, fontWeight: '700', color: c.textSecondary },

  recRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: `${config.colors.primary}14`,
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  recText: { flex: 1, fontSize: 12, fontWeight: '600', color: c.text },

  groupTitle: { fontSize: 13, fontWeight: '800', color: c.textSecondary, marginTop: 16, marginBottom: 8, textTransform: 'uppercase' },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  slotTile: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: c.bgAlt,
    borderRadius: 12,
    padding: 10,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  slotTileNeon: { backgroundColor: c.bgAccent || c.cardBg },
  slotLabel: { fontSize: 12, fontWeight: '700', color: c.text },
  slotStage: { fontSize: 11, color: c.textSecondary, textTransform: 'capitalize' },

  actionBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    backgroundColor: c.bg,
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  actionTarget: { fontSize: 11, fontWeight: '700', color: c.textSecondary, marginBottom: 6, textTransform: 'capitalize' },
  actionBtnDisabled: { opacity: 0.35 },
  // One big, obvious target instead of five small ones.
  playedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 16,
    paddingVertical: 15,
  },
  playedBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },

  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  logRowText: { fontSize: 14, fontWeight: '800', flex: 1 },

  advToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 22,
    paddingVertical: 8,
  },
  advToggleText: { fontSize: 12, fontWeight: '700', color: c.textSecondary },
  advBody: { backgroundColor: c.bgAlt, borderRadius: 12, padding: 12, marginTop: 2 },
  advLine: { fontSize: 12, fontWeight: '600', color: c.textSecondary },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  editorModal: { width: '100%', maxWidth: 340, borderRadius: 18, backgroundColor: c.bgElevated, padding: 18 },
  editorTitle: { fontSize: 15, fontWeight: '800', color: c.text, textAlign: 'center', marginBottom: 12 },
  editorLabel: { fontSize: 12, fontWeight: '700', color: c.textSecondary, marginTop: 8, marginBottom: 6 },
  stageChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  stageChip: {
    borderWidth: 1.5, borderColor: c.border, borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  stageChipText: { fontSize: 11, fontWeight: '700', color: c.textSecondary, textTransform: 'capitalize' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16, marginVertical: 10 },
  stepBtn: {
    width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center',
    backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.border,
  },
  stepValue: { fontSize: 22, fontWeight: '800', color: c.text, minWidth: 54, textAlign: 'center' },
  saveBtn: {
    marginTop: 14,
    backgroundColor: config.colors.primary,
    borderRadius: 22,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});

export default GrindDetailScreen;
