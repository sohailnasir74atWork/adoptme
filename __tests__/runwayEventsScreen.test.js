/**
 * RunwayEventsScreen (Pet Runway events for staff): what a MOD and an admin can see and do,
 * and what a saved draft sends to the server (supabase/061 runway_event_save).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../Code/Supabase/client', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('react-native-vector-icons/Ionicons', () => 'Icon');
// Stable like the real i18next: a new t on every render would re-run the screen's load effect.
jest.mock('react-i18next', () => {
  const value = { t: (k, o) => (o ? `${k}|${JSON.stringify(o)}` : k), i18n: { language: 'en' } };
  return { useTranslation: () => value };
});
jest.mock('../Code/Helper/themeColors', () => {
  const palette = new Proxy({}, { get: () => '#000000' });
  return { useThemeColors: () => palette };
});
jest.mock('../Code/Helper/MessageHelper', () => ({ showErrorMessage: jest.fn(), showSuccessMessage: jest.fn() }));

const { supabase } = require('../Code/Supabase/client');
const RunwayEventsScreen = require('../Code/PetRunway/RunwayEventsScreen').default;

const draft = { id: 7, theme: 'cozy_winter', starts_on: '2030-12-20', ends_on: '2030-12-22', featured: { scenes: ['snow'], items: ['beanie'] }, style: { stamp: 'snow', banner: '#6EC6FF' }, prize_tier: 'big', status: 'draft', note: 'first snow', mine: true, created_by_name: 'Mod One' };
const live = { ...draft, id: 8, theme: 'snow_day', status: 'approved', mine: false, created_by_name: 'Mod Two', approved_by_name: 'Boss' };

const texts = (r) => r.root.findAll((n) => typeof n.type === 'string' && n.type === 'Text').map((n) => [].concat(n.props.children).join(''));
const press = (r, label) => {
  const btn = r.root.findAll((n) => n.props && n.props.onPress && n.findAll((m) => m.type === 'Text' && [].concat(m.props.children).join('') === label).length).pop();
  if (!btn) throw new Error(`no button ${label}`);
  return act(async () => { await btn.props.onPress(); });
};
const render = async (isAdmin) => {
  supabase.rpc.mockImplementation(async (fn) => (fn === 'runway_events_staff' ? { data: { is_admin: isAdmin, events: [draft, live] }, error: null } : { data: 1, error: null }));
  let r;
  await act(async () => { r = TestRenderer.create(<RunwayEventsScreen />); });
  return r;
};

describe('RunwayEventsScreen', () => {
  beforeEach(() => supabase.rpc.mockReset());

  it('a MOD can edit and delete their own draft, but not approve or cancel', async () => {
    const r = await render(false);
    const t = texts(r);
    expect(t).toContain('pet_runway_events.section_drafts');
    expect(t).toContain('pet_runway_events.section_live');
    expect(t).toContain('pet_runway_events.btn_edit');
    expect(t).toContain('pet_runway_events.btn_delete');
    expect(t).not.toContain('pet_runway_events.btn_approve');
    expect(t).not.toContain('pet_runway_events.btn_cancel');
    expect(t).toContain('first snow');
  });

  it('an admin also sees Approve and Cancel, and Approve calls the server', async () => {
    const r = await render(true);
    const t = texts(r);
    expect(t).toContain('pet_runway_events.btn_approve');
    expect(t.filter((x) => x === 'pet_runway_events.btn_cancel')).toHaveLength(2);
    await press(r, 'pet_runway_events.btn_approve');
    expect(supabase.rpc).toHaveBeenCalledWith('runway_event_approve', { p_id: 7 });
  });

  it('editing a draft sends its values back as a draft save', async () => {
    const r = await render(false);
    await press(r, 'pet_runway_events.btn_edit');
    expect(texts(r)).toContain('pet_runway_events.edit_event');
    await press(r, 'pet_runway_events.btn_save');
    const call = supabase.rpc.mock.calls.find(([fn]) => fn === 'runway_event_save');
    expect(call[1]).toMatchObject({ p_id: 7, p_theme: 'cozy_winter', p_featured: { scenes: ['snow'], items: ['beanie'] }, p_style: { stamp: 'snow', banner: '#6EC6FF' }, p_prize: 'big', p_note: 'first snow' });
    expect(call[1].p_start <= call[1].p_end).toBe(true);
  });
});
