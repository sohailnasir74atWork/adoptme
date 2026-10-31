/**
 * BadgeManager — the Badges block of Mod Tools on a player's profile drawer
 * (rendered by ProfileAdminActions; 2026-10-31).
 *
 * One place for everything a MOD or admin does to a player's badges:
 *   - the badges the player wears now (role badges from users/{uid} flags +
 *     custom badges from worn_badges/{uid}), each with a colour swatch,
 *   - recolour any of them (BADGE_COLORS; "Default" clears a role override),
 *   - remove one,
 *   - add one — a role badge (Trusted / House CMSR / Art CMSR / Helper) or a
 *     custom badge from the registry, or create a new custom badge first —
 *     while the player wears fewer than MAX_WORN_BADGES.
 *
 * Writes: role flags go to users/{uid} exactly as the old Make/Remove chips
 * did (flag + rolesUpdatedAt in one update, so the Supabase mirror runs);
 * colours and custom badges go to worn_badges/{uid} (customBadges.js). After
 * every write the local caches are refreshed (invalidateFullProfile +
 * setRoleOverride) so the MOD's own screens show the change at once.
 *
 * Grant eligibility (`canGrant`) is the same 3-squad bar the role badges
 * already had (Code/Helper/staffElections.js canGrantBadge); removing and
 * recolouring never need it.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { ref, update } from '@react-native-firebase/database';
import UserBadgePill from './UserBadgePill';
import CustomBadgeEditor, { ColorPalette } from './CustomBadgeEditor';
import { getThemeColors } from './themeColors';
import { invalidateFullProfile, setRoleOverride } from './profileCache';
import { useLocalState } from '../LocalGlobelStats';
import {
  MAX_WORN_BADGES, ROLE_BADGE_KEYS, ROLE_FLAG, ROLE_LABEL, ROLE_DEFAULT_COLOR,
  CUSTOM_ICONS, customIdsOf, fetchWornBadges, setRoleBadgeColor,
  grantCustomBadge, revokeCustomBadge, useCustomBadges, getCustomBadge,
} from './customBadges';

const ROSTER_CACHE = { trusted: 'trustedRoster', cmsr_house: 'cmsrRoster', cmsr_art: 'cmsrRoster', helper: 'helperRoster' };

const confirm = (title, message, okText = 'Confirm', destructive = false) => new Promise((resolve) => {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
    { text: okText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ]);
});

const BadgeManager = ({
  appdatabase, targetUid, userName = 'this player', target, viewerUid,
  canGrant = true, targetSquad = 0, badgeMinSquad = 3,
  onTargetChange, isDarkMode = false,
}) => {
  const c = getThemeColors(isDarkMode);
  const { updateLocalState } = useLocalState();
  const allCustom = useCustomBadges();

  // Flags come from the drawer's merged user; worn colours / customs start
  // from it too and are refreshed once from RTDB (the mirror can lag).
  const [worn, setWorn] = useState({ styles: target?.badgeStyles || {}, custom: target?.customBadges || {} });
  const [busy, setBusy] = useState(false);
  const [editingKey, setEditingKey] = useState(null); // badge whose palette is open
  const [addOpen, setAddOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!appdatabase || !targetUid) return undefined;
    fetchWornBadges(appdatabase, targetUid).then((w) => { if (alive) setWorn(w); });
    return () => { alive = false; };
  }, [appdatabase, targetUid]);

  const items = useMemo(() => {
    const out = [];
    for (const k of ROLE_BADGE_KEYS) {
      if (target?.[ROLE_FLAG[k]]) out.push({ key: k, kind: 'role', label: ROLE_LABEL[k], color: worn.styles[k] || null });
    }
    for (const id of customIdsOf(worn.custom)) {
      const def = getCustomBadge(id);
      out.push({ key: `custom:${id}`, kind: 'custom', id, label: def?.name || 'Custom badge', def, color: worn.custom[id]?.color || null });
    }
    return out;
  }, [target, worn, allCustom]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = items.length;
  const full = count >= MAX_WORN_BADGES;

  // After a worn_badges write: local caches + the drawer's merged user.
  const commitWorn = useCallback((w) => {
    setWorn(w);
    invalidateFullProfile(targetUid);
    setRoleOverride(targetUid, { badgeStyles: w.styles, customBadges: w.custom });
    updateLocalState('customBadgeRoster', null);
    onTargetChange && onTargetChange({ badgeStyles: w.styles, customBadges: w.custom });
  }, [targetUid, updateLocalState, onTargetChange]);

  const setRoleFlag = useCallback(async (k, value) => {
    const flag = ROLE_FLAG[k];
    await update(ref(appdatabase, `users/${targetUid}`), { [flag]: value ? true : null, rolesUpdatedAt: Date.now() });
    invalidateFullProfile(targetUid);
    setRoleOverride(targetUid, { [flag]: !!value });
    updateLocalState(ROSTER_CACHE[k], null);
    onTargetChange && onTargetChange({ [flag]: !!value });
  }, [appdatabase, targetUid, updateLocalState, onTargetChange]);

  const run = async (fn, failText) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { Alert.alert('Error', e?.message || failText); } finally { setBusy(false); }
  };

  const handleColor = (item, hex) => run(async () => {
    if (item.kind === 'role') {
      commitWorn(await setRoleBadgeColor(appdatabase, targetUid, item.key, hex));
    } else {
      commitWorn(await grantCustomBadge(appdatabase, targetUid, item.id, hex, viewerUid));
    }
  }, 'Could not change the colour');

  const handleRemove = async (item) => {
    const ok = await confirm(`Remove ${item.label}`, `Remove the ${item.label} badge from ${userName}?`, 'Remove', true);
    if (!ok) return;
    run(async () => {
      if (item.kind === 'role') {
        await setRoleFlag(item.key, false);
        if (worn.styles[item.key]) commitWorn(await setRoleBadgeColor(appdatabase, targetUid, item.key, null));
      } else {
        commitWorn(await revokeCustomBadge(appdatabase, targetUid, item.id));
      }
      setEditingKey(null);
    }, 'Could not remove the badge');
  };

  const handleAddRole = async (k) => {
    setAddOpen(false);
    const ok = await confirm(`Give ${ROLE_LABEL[k]}`, `Give ${userName} the ${ROLE_LABEL[k]} badge?`);
    if (!ok) return;
    run(() => setRoleFlag(k, true), 'Could not give the badge');
  };

  const handleAddCustom = async (def) => {
    setAddOpen(false);
    const ok = await confirm(`Give ${def.name}`, `Give ${userName} the "${def.name}" badge?`);
    if (!ok) return;
    run(async () => { commitWorn(await grantCustomBadge(appdatabase, targetUid, def.id, null, viewerUid)); }, 'Could not give the badge');
  };

  const availableRoles = ROLE_BADGE_KEYS.filter((k) => !target?.[ROLE_FLAG[k]]);
  const availableCustom = allCustom.filter((d) => !worn.custom[d.id]);

  const Chip = ({ label, color = '#6366f1', onPress, icon, disabled }) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} disabled={disabled}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6,
        backgroundColor: color + '18', borderWidth: 1, borderColor: color + '40', opacity: disabled ? 0.45 : 1 }}>
      {icon ? <Icon name={icon} size={12} color={color} /> : null}
      <Text style={{ fontSize: 11, fontWeight: '600', color }}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontSize: 10, color: c.textMuted, fontWeight: '600' }}>Badges · {count}/{MAX_WORN_BADGES}</Text>
        {busy ? <ActivityIndicator size="small" color={c.textMuted} /> : null}
      </View>

      {items.length === 0 && (
        <Text style={{ fontSize: 11, color: c.textMuted, marginBottom: 8 }}>No badges yet.</Text>
      )}

      {items.map((item) => {
        const open = editingKey === item.key;
        const swatch = item.color || (item.kind === 'role' ? ROLE_DEFAULT_COLOR[item.key] : item.def?.color) || '#64748B';
        return (
          <View key={item.key} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 8, marginBottom: 6, backgroundColor: c.bgAlt }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
                {item.kind === 'role'
                  ? <UserBadgePill type={item.key} color={item.color || undefined} size="md" isDarkMode={isDarkMode} />
                  : <UserBadgePill custom={{ name: item.label, image: CUSTOM_ICONS[item.def?.icon], color: swatch }} size="md" isDarkMode={isDarkMode} />}
              </View>
              <TouchableOpacity onPress={() => setEditingKey(open ? null : item.key)} activeOpacity={0.7}
                accessibilityLabel={`Colour of ${item.label}`}
                style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: swatch, borderWidth: 2, borderColor: open ? c.text : c.border }} />
              <Chip label="Remove" color="#f59e0b" onPress={() => handleRemove(item)} disabled={busy} />
            </View>
            {open && (
              <View style={{ marginTop: 8 }}>
                <Text style={{ fontSize: 10, color: c.textMuted, marginBottom: 6 }}>
                  {item.kind === 'role' ? 'Badge colour (icon stays the same)' : 'Colour for this player (Default = the badge’s own colour)'}
                </Text>
                <ColorPalette
                  value={item.color}
                  onChange={(hex) => handleColor(item, hex)}
                  allowDefault
                  isDarkMode={isDarkMode}
                />
              </View>
            )}
          </View>
        );
      })}

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
        <Chip label={full ? `Limit ${MAX_WORN_BADGES} reached` : 'Add badge'} icon="add" color="#10b981" onPress={() => setAddOpen(true)} disabled={busy || full} />
        <Chip label="New custom badge" icon="color-wand-outline" color="#6366f1" onPress={() => setEditorOpen(true)} disabled={busy} />
      </View>

      {!canGrant && !full && (
        <Text style={{ fontSize: 11, color: c.textMuted, marginTop: 8, lineHeight: 16 }}>
          New badges need {badgeMinSquad} squad friends. This player has {targetSquad}.
        </Text>
      )}

      {/* Add-badge picker */}
      <Modal visible={addOpen} transparent animationType="fade" onRequestClose={() => setAddOpen(false)}>
        <Pressable onPress={() => setAddOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', paddingHorizontal: 20 }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: c.bg, borderRadius: 16, borderWidth: 1, borderColor: c.border, maxHeight: '80%' }}>
            <ScrollView contentContainerStyle={{ padding: 18 }}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: c.text }}>Add a badge</Text>
              <Text style={{ fontSize: 12, color: c.textMuted, marginTop: 4, marginBottom: 12 }}>
                {userName} wears {count} of {MAX_WORN_BADGES}. You can change the colour after adding.
              </Text>
              {!canGrant && (
                <Text style={{ fontSize: 12, color: '#f59e0b', marginBottom: 12, lineHeight: 17 }}>
                  Not eligible yet: {userName} has {targetSquad} squad friend{targetSquad === 1 ? '' : 's'}; badges need at least {badgeMinSquad}.
                </Text>
              )}
              {availableRoles.length > 0 && (
                <>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Role badges</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                    {availableRoles.map((k) => (
                      <TouchableOpacity key={k} onPress={() => handleAddRole(k)} disabled={!canGrant} activeOpacity={0.7} style={{ opacity: canGrant ? 1 : 0.4 }}>
                        <UserBadgePill type={k} size="lg" isDarkMode={isDarkMode} />
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <Text style={{ fontSize: 11, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>Custom badges</Text>
              {availableCustom.length === 0 ? (
                <Text style={{ fontSize: 12, color: c.textMuted, marginBottom: 10 }}>No custom badges yet. Create one below.</Text>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {availableCustom.map((d) => (
                    <TouchableOpacity key={d.id} onPress={() => handleAddCustom(d)} disabled={!canGrant} activeOpacity={0.7} style={{ opacity: canGrant ? 1 : 0.4 }}>
                      <UserBadgePill custom={{ name: d.name, image: CUSTOM_ICONS[d.icon], color: d.color }} size="lg" isDarkMode={isDarkMode} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <TouchableOpacity onPress={() => { setAddOpen(false); setEditorOpen(true); }} activeOpacity={0.7}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: c.border, marginTop: 4 }}>
                <Icon name="color-wand-outline" size={14} color={c.textSecondary} />
                <Text style={{ fontSize: 12, fontWeight: '700', color: c.textSecondary }}>Create a new custom badge</Text>
              </TouchableOpacity>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <CustomBadgeEditor
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        appdatabase={appdatabase}
        byUid={viewerUid}
        isDarkMode={isDarkMode}
        onSaved={(def) => {
          // Offer to put the new badge on this player straight away.
          if (full || !canGrant) return;
          setTimeout(() => {
            Alert.alert('Badge created', `Give "${def.name}" to ${userName} now?`, [
              { text: 'Not now', style: 'cancel' },
              { text: 'Give it', onPress: () => run(async () => { commitWorn(await grantCustomBadge(appdatabase, targetUid, def.id, null, viewerUid)); }, 'Could not give the badge') },
            ]);
          }, 350);
        }}
      />
    </View>
  );
};

export default React.memo(BadgeManager);
