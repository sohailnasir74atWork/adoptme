/**
 * RunwayEventsScreen.jsx — Pet Runway events for staff (Phase 2a, 2026-10-31).
 * Opened from the "Manage events" button on the Pet Runway home (MODs and admins only).
 *
 * MODs and admins plan events from a safe toolkit: a theme from the library (already translated),
 * dates (1–14 days, start within 90 days), up to 3 featured scenes and 8 featured items, a stamp
 * style, a banner colour, a prize size and a note for admins. A MOD's event stays a draft until an
 * admin approves it; admins can cancel any event. The server (supabase/061) checks every rule and
 * logs every action; this screen only hides what the caller may not do.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, Alert, RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/Ionicons';
import { useThemeColors } from '../Helper/themeColors';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { RUNWAY_CATALOG } from './runwayCatalog';
import { approveEvent, cancelEvent, daysBetween, errorKey, isoDay, saveEvent, staffEvents } from './runwayApi';

const ROSE = '#FF4F9A';
const MAX_SCENES = 3;
const MAX_ITEMS = 8;
const ITEM_CATS = ['hats', 'hair', 'face', 'neck', 'outfit', 'wings', 'hold', 'decor'];
const STAMP_COLORS = { classic: '#3A1238', gold: '#B7791F', night: '#1C1F5A', candy: '#FF4F9A', snow: '#3F7BE0', holo: '#B58CFF' };

const blankForm = () => ({ id: null, theme: RUNWAY_CATALOG.themes[0].id, startIn: 7, days: 3, scenes: [], items: [], stamp: 'classic', banner: RUNWAY_CATALOG.banners[0], prize_tier: 'normal', note: '' });

const Chip = ({ c, on, label, onPress, color, disabled }) => (
  <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.8}
    style={[styles.chip, { backgroundColor: on ? (color || ROSE) : c.bgAlt, borderColor: on ? (color || ROSE) : c.border }, disabled && !on && styles.dim]}>
    <Text style={[styles.chipText, { color: on ? '#fff' : c.text }]}>{label}</Text>
  </TouchableOpacity>
);
const Stepper = ({ c, label, value, onMinus, onPlus }) => (
  <View style={[styles.stepper, { backgroundColor: c.bgAlt, borderColor: c.border }]}>
    <TouchableOpacity onPress={onMinus} style={styles.stepBtn} accessibilityLabel="-"><Icon name="remove" size={20} color={c.text} /></TouchableOpacity>
    <Text style={[styles.stepText, { color: c.text }]}>{label} {value}</Text>
    <TouchableOpacity onPress={onPlus} style={styles.stepBtn} accessibilityLabel="+"><Icon name="add" size={20} color={c.text} /></TouchableOpacity>
  </View>
);

const RunwayEventsScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const c = useThemeColors();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null);
  const [itemCat, setItemCat] = useState('hats');

  const tr = (k, o) => t(`pet_runway_events.${k}`, o);
  const themeName = (id) => t(`pet_runway.theme_${id}`);
  const fmt = useCallback((iso) => {
    try { return new Date(`${iso}T00:00:00Z`).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', timeZone: 'UTC' }); } catch (e) { return iso; }
  }, [i18n.language]);
  const fail = useCallback((e) => showErrorMessage(t('pet_runway_events.title'), t(`pet_runway_events.${errorKey(e)}`)), [t]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await staffEvents()); } catch (e) { setData(null); fail(e); }
    setLoading(false);
  }, [fail]);
  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const ev = data?.events || [];
    return [
      ['section_live', ev.filter((e) => e.status === 'approved')],
      ['section_drafts', ev.filter((e) => e.status === 'draft')],
      ['section_cancelled', ev.filter((e) => e.status === 'cancelled')],
    ];
  }, [data]);

  const edit = (e) => setForm({
    id: e.id, theme: e.theme, startIn: Math.max(0, daysBetween(isoDay(0), e.starts_on)), days: daysBetween(e.starts_on, e.ends_on) + 1,
    scenes: e.featured?.scenes || [], items: e.featured?.items || [], stamp: e.style?.stamp || 'classic',
    banner: e.style?.banner || RUNWAY_CATALOG.banners[0], prize_tier: e.prize_tier || 'normal', note: e.note || '',
  });

  const act = async (fn, okKey) => {
    setBusy(true);
    try { await fn(); showSuccessMessage(tr('title'), tr(okKey)); await load(); } catch (e) { fail(e); }
    setBusy(false);
  };
  const save = () => act(async () => {
    await saveEvent({
      id: form.id, theme: form.theme, starts_on: isoDay(form.startIn), ends_on: isoDay(form.startIn + form.days - 1),
      scenes: form.scenes, items: form.items, stamp: form.stamp, banner: form.banner, prize_tier: form.prize_tier, note: form.note.trim(),
    });
    setForm(null);
  }, 'saved');
  const confirm = (msgKey, run) => Alert.alert(tr('title'), tr(msgKey), [{ text: tr('no'), style: 'cancel' }, { text: tr('yes'), style: 'destructive', onPress: run }]);

  const toggle = (list, id, max) => (list.includes(id) ? list.filter((x) => x !== id) : list.length < max ? [...list, id] : list);

  const renderForm = () => {
    const start = isoDay(form.startIn), end = isoDay(form.startIn + form.days - 1);
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    return (
      <View style={[styles.card, { backgroundColor: c.cardBg, borderColor: c.cardBorder }]}>
        <Text style={[styles.h2, { color: c.text }]}>{form.id ? tr('edit_event') : tr('new_event')}</Text>
        <Text style={[styles.label, { color: c.textSecondary }]}>{tr('f_theme')}</Text>
        <View style={styles.wrap}>
          {RUNWAY_CATALOG.themes.map((th) => (
            <Chip c={c} key={th.id} on={form.theme === th.id} onPress={() => set({ theme: th.id })}
              label={`${themeName(th.id)} · ${th.tags.map((g) => t(`pet_runway.tag_${g}`)).join(' + ')}`} />
          ))}
        </View>
        <Text style={[styles.label, { color: c.textSecondary }]}>{tr('dates', { start: fmt(start), end: fmt(end) })}</Text>
        <View style={styles.row}>
          <Stepper c={c} label={tr('f_start')} value={fmt(start)} onMinus={() => set({ startIn: Math.max(0, form.startIn - 1) })} onPlus={() => set({ startIn: Math.min(90, form.startIn + 1) })} />
          <Stepper c={c} label={tr('f_length')} value={form.days} onMinus={() => set({ days: Math.max(1, form.days - 1) })} onPlus={() => set({ days: Math.min(14, form.days + 1) })} />
        </View>
        <Text style={[styles.label, { color: c.textSecondary }]}>{tr('f_featured_scenes', { count: MAX_SCENES })}</Text>
        <View style={styles.wrap}>
          {RUNWAY_CATALOG.scenes.map((k) => (
            <Chip c={c} key={k} on={form.scenes.includes(k)} disabled={form.scenes.length >= MAX_SCENES} onPress={() => set({ scenes: toggle(form.scenes, k, MAX_SCENES) })} label={t(`pet_runway.scene_${k}`)} />
          ))}
        </View>
        <Text style={[styles.label, { color: c.textSecondary }]}>{tr('f_featured_items', { count: MAX_ITEMS })} · {form.items.length}/{MAX_ITEMS}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
          {ITEM_CATS.map((k) => <Chip c={c} key={k} on={itemCat === k} color="#3A1238" onPress={() => setItemCat(k)} label={t(`pet_runway.cat_${k}`)} />)}
        </ScrollView>
        <View style={styles.wrap}>
          {RUNWAY_CATALOG.items.filter((i) => i.cat === itemCat).map((i) => (
            <Chip c={c} key={i.id} on={form.items.includes(i.id)} disabled={form.items.length >= MAX_ITEMS} onPress={() => set({ items: toggle(form.items, i.id, MAX_ITEMS) })} label={t(`pet_runway.item_${i.id}`)} />
          ))}
        </View>
        <Text style={[styles.label, { color: c.textSecondary }]}>{tr('f_stamp')}</Text>
        <View style={styles.wrap}>
          {RUNWAY_CATALOG.stamps.map((k) => <Chip c={c} key={k} on={form.stamp === k} color={STAMP_COLORS[k]} onPress={() => set({ stamp: k })} label={tr(`stamp_${k}`)} />)}
        </View>
        <Text style={[styles.label, { color: c.textSecondary }]}>{tr('f_banner')}</Text>
        <View style={styles.wrap}>
          {RUNWAY_CATALOG.banners.map((hex) => (
            <TouchableOpacity key={hex} onPress={() => set({ banner: hex })} accessibilityLabel={hex}
              style={[styles.swatch, { backgroundColor: hex }, form.banner === hex && { borderColor: c.text }]} />
          ))}
        </View>
        <Text style={[styles.label, { color: c.textSecondary }]}>{tr('f_prize')}</Text>
        <View style={styles.wrap}>
          <Chip c={c} on={form.prize_tier === 'normal'} onPress={() => set({ prize_tier: 'normal' })} label={tr('prize_normal')} />
          <Chip c={c} on={form.prize_tier === 'big'} onPress={() => set({ prize_tier: 'big' })} label={tr('prize_big')} />
        </View>
        <Text style={[styles.label, { color: c.textSecondary }]}>{tr('f_note')}</Text>
        <TextInput value={form.note} onChangeText={(v) => set({ note: v.slice(0, 300) })} placeholder={tr('note_ph')} placeholderTextColor={c.placeholder}
          multiline maxLength={300} style={[styles.input, { backgroundColor: c.inputBg, borderColor: c.inputBorder, color: c.inputText }]} />
        <Text style={[styles.rules, { color: c.textSecondary }]}>{tr('rules')}</Text>
        <View style={styles.row}>
          <TouchableOpacity style={[styles.btn, { backgroundColor: c.bgAlt }]} onPress={() => setForm(null)} disabled={busy}><Text style={[styles.btnText, { color: c.text }]}>{tr('btn_close')}</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.btn, { backgroundColor: ROSE }]} onPress={save} disabled={busy}><Text style={[styles.btnText, styles.white]}>{tr('btn_save')}</Text></TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEvent = (e) => {
    const canEdit = e.status === 'draft' && (e.mine || data?.is_admin);
    const statusColor = e.status === 'approved' ? '#16A34A' : e.status === 'draft' ? '#D97706' : '#9CA3AF';
    return (
      <View key={e.id} style={[styles.card, { backgroundColor: c.cardBg, borderColor: c.cardBorder }, e.status === 'cancelled' && styles.faded]}>
        <View style={styles.rowBetween}>
          <Text style={[styles.h3, { color: c.text }]} numberOfLines={1}>{themeName(e.theme)}</Text>
          <View style={[styles.pill, { backgroundColor: statusColor }]}><Text style={styles.pillText}>{tr(`status_${e.status}`)}</Text></View>
        </View>
        <Text style={[styles.meta, { color: c.textSecondary }]}>
          {tr('dates', { start: fmt(e.starts_on), end: fmt(e.ends_on) })}{e.prize_tier === 'big' ? ` · ${tr('prize_big')}` : ''}
        </Text>
        <Text style={[styles.meta, { color: c.textSecondary }]}>
          {tr('by', { name: e.created_by_name || '?' })}{e.approved_by_name ? ` · ${tr('approved_by', { name: e.approved_by_name })}` : ''}
        </Text>
        {!!e.note && <Text style={[styles.note, { color: c.text, backgroundColor: c.bgAlt }]}>{e.note}</Text>}
        {(e.featured?.scenes?.length || e.featured?.items?.length) ? (
          <Text style={[styles.meta, { color: c.textSecondary }]} numberOfLines={2}>
            {[...(e.featured.scenes || []).map((k) => t(`pet_runway.scene_${k}`)), ...(e.featured.items || []).map((k) => t(`pet_runway.item_${k}`))].join(', ')}
          </Text>
        ) : null}
        {e.status !== 'cancelled' && (
          <View style={styles.actions}>
            {canEdit && <TouchableOpacity style={[styles.small, { backgroundColor: c.bgAlt }]} onPress={() => edit(e)} disabled={busy}><Text style={[styles.smallText, { color: c.text }]}>{tr('btn_edit')}</Text></TouchableOpacity>}
            {data?.is_admin && e.status === 'draft' && (
              <TouchableOpacity style={[styles.small, styles.approve]} onPress={() => act(() => approveEvent(e.id), 'approved_msg')} disabled={busy}><Text style={[styles.smallText, styles.white]}>{tr('btn_approve')}</Text></TouchableOpacity>
            )}
            {data?.is_admin ? (
              <TouchableOpacity style={[styles.small, styles.danger]} onPress={() => confirm('confirm_cancel', () => act(() => cancelEvent(e.id), 'cancelled_msg'))} disabled={busy}><Text style={[styles.smallText, styles.white]}>{tr('btn_cancel')}</Text></TouchableOpacity>
            ) : canEdit ? (
              <TouchableOpacity style={[styles.small, styles.danger]} onPress={() => confirm('confirm_delete', () => act(() => cancelEvent(e.id), 'cancelled_msg'))} disabled={busy}><Text style={[styles.smallText, styles.white]}>{tr('btn_delete')}</Text></TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.flex1, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} accessibilityLabel={t('pet_runway.back')}><Icon name="chevron-back" size={24} color={c.text} /></TouchableOpacity>
        <Text style={[styles.h1, { color: c.text }]}>{tr('title')}</Text>
        {busy ? <ActivityIndicator color={ROSE} /> : <View style={styles.back} />}
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]} refreshControl={<RefreshControl refreshing={loading && !!data} onRefresh={load} />}>
        <Text style={[styles.intro, { color: c.textSecondary }]}>{tr('intro')}</Text>
        {form ? renderForm() : (
          <TouchableOpacity style={[styles.btn, styles.newBtn]} onPress={() => setForm(blankForm())} disabled={!data}>
            <Icon name="add-circle" size={20} color="#fff" /><Text style={[styles.btnText, styles.white]}>{tr('new_event')}</Text>
          </TouchableOpacity>
        )}
        {loading && !data ? <ActivityIndicator style={styles.loader} color={ROSE} /> : null}
        {data && !form && (data.events || []).length === 0 ? <Text style={[styles.intro, { color: c.textSecondary }]}>{tr('empty')}</Text> : null}
        {data && !form && groups.map(([key, list]) => (list.length ? (
          <View key={key}>
            <Text style={[styles.section, { color: c.text }]}>{tr(key)}</Text>
            {list.map(renderEvent)}
          </View>
        ) : null))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  back: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  h1: { flex: 1, fontSize: 20, fontWeight: '800' },
  h2: { fontSize: 18, fontWeight: '800', marginBottom: 6 },
  h3: { flex: 1, fontSize: 16, fontWeight: '800' },
  body: { paddingHorizontal: 16, gap: 12 },
  intro: { fontSize: 13, lineHeight: 19 },
  section: { fontSize: 15, fontWeight: '800', marginTop: 8, marginBottom: 6 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 6, marginBottom: 10 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catRow: { gap: 6, paddingVertical: 2 },
  label: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  chip: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12, paddingHorizontal: 4 },
  stepBtn: { padding: 8 },
  stepText: { fontSize: 13, fontWeight: '700', minWidth: 90, textAlign: 'center' },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 3, borderColor: 'transparent' },
  dim: { opacity: 0.4 },
  faded: { opacity: 0.6 },
  approve: { backgroundColor: '#16A34A' },
  danger: { backgroundColor: '#C21E56' },
  input: { borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 64, fontSize: 14, textAlignVertical: 'top' },
  rules: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  btn: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 14 },
  newBtn: { backgroundColor: ROSE, flex: 0 },
  btnText: { fontSize: 15, fontWeight: '800' },
  white: { color: '#fff' },
  meta: { fontSize: 12, fontWeight: '600' },
  note: { fontSize: 13, padding: 8, borderRadius: 10 },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999 },
  pillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  small: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  smallText: { fontSize: 13, fontWeight: '800' },
  loader: { marginTop: 24 },
});

export default RunwayEventsScreen;
