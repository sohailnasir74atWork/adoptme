/**
 * ModEvidencePicker.jsx — the "attach proof" row inside a ban/mute dialog.
 *
 * 📅 2026-09-19. Shows up to three thumbnails with a remove badge, plus an
 * add tile while there is room. It holds LOCAL uris only; uploading is the
 * caller's job at confirm time (uploadEvidence in modEvidenceUpload.js).
 *
 * That split is deliberate. Uploading on pick would leave orphans in the
 * Bunny zone every time a mod opens the picker and then backs out of the
 * ban — and nothing ever cleans those up, because the retention job in 029
 * can only reach the Postgres rows, not the images. Uploading at confirm
 * means bytes are spent only on bans that actually happen.
 *
 * Controlled component: the parent owns `uris`. It needs them at confirm
 * time anyway, and a ban dialog that resets its own state on a re-render
 * would silently drop a mod's screenshots.
 */

import React, { useCallback } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { pickEvidenceImages, MAX_EVIDENCE_IMAGES } from '../Helper/modEvidenceUpload';

const ModEvidencePicker = ({
  uris = [],
  onChange,
  isDark = false,
  disabled = false,
  label = 'Proof (optional)',
}) => {
  const C = {
    text: isDark ? '#e5e7eb' : '#111827',
    muted: isDark ? '#9ca3af' : '#6b7280',
    border: isDark ? '#374151' : '#d1d5db',
    tileBg: isDark ? '#1f2937' : '#f3f4f6',
  };

  const add = useCallback(async () => {
    try {
      const picked = await pickEvidenceImages(uris.length);
      if (picked.length === 0) return;
      onChange([...uris, ...picked].slice(0, MAX_EVIDENCE_IMAGES));
    } catch (e) {
      // A picker that fails to open is worth saying out loud — the mod is
      // mid-ban and would otherwise think they had attached something.
      Alert.alert('Could not open photos', e?.message || 'Please try again.');
    }
  }, [uris, onChange]);

  const removeAt = useCallback((i) => {
    onChange(uris.filter((_, idx) => idx !== i));
  }, [uris, onChange]);

  const room = MAX_EVIDENCE_IMAGES - uris.length;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: C.text }]}>{label}</Text>
        <Text style={[styles.count, { color: C.muted }]}>
          {uris.length}/{MAX_EVIDENCE_IMAGES}
        </Text>
      </View>

      <Text style={[styles.hint, { color: C.muted }]}>
        Screenshots are attached to this action and stay visible to staff in the
        moderation record.
      </Text>

      <View style={styles.row}>
        {uris.map((uri, i) => (
          <View key={`${uri}-${i}`} style={styles.thumbWrap}>
            <Image source={{ uri }} style={[styles.thumb, { borderColor: C.border }]} />
            {!disabled && (
              <TouchableOpacity
                onPress={() => removeAt(i)}
                style={styles.remove}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="close" size={13} color="#fff" />
              </TouchableOpacity>
            )}
          </View>
        ))}

        {room > 0 && (
          <TouchableOpacity
            onPress={add}
            disabled={disabled}
            style={[
              styles.addTile,
              { borderColor: C.border, backgroundColor: C.tileBg },
              disabled && styles.addTileOff,
            ]}
          >
            <Icon name="camera-outline" size={20} color={C.muted} />
            <Text style={[styles.addText, { color: C.muted }]}>Add</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 13, fontWeight: '700' },
  count: { fontSize: 12, fontWeight: '600' },
  hint: { fontSize: 11, marginTop: 3, lineHeight: 15 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 66, height: 66, borderRadius: 8, borderWidth: 1 },
  remove: {
    position: 'absolute', top: -6, right: -6,
    width: 21, height: 21, borderRadius: 11,
    backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center',
  },
  addTile: {
    width: 66, height: 66, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  addTileOff: { opacity: 0.5 },
  addText: { fontSize: 10, fontWeight: '600' },
});

export default ModEvidencePicker;
