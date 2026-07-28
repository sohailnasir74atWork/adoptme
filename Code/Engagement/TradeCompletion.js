/**
 * TradeCompletion.js
 * Modal for logging completed trades after calculating them.
 *
 * Flow:
 * 1. User finishes calculating a trade in HomeScreen
 * 2. Taps "📓 I Traded!" button
 * 3. Modal asks: Rate trade (Win/Fair/Loss) + optional notes
 * 4. Trade saved to RTDB tradeJournal → XP awarded
 * 5. Auto-updates owned pets: removes gave items, adds got items
 */

import React, { useState, useCallback } from 'react';
import {
  Modal, View, Text, TouchableOpacity, TextInput,
  StyleSheet, Dimensions, Alert, ActivityIndicator,
} from 'react-native';
import { ref, get, set, push, serverTimestamp } from '@react-native-firebase/database';
import { doc, getDoc, setDoc } from '@react-native-firebase/firestore';
import FontAwesome from 'react-native-vector-icons/FontAwesome6';
import SwipeableBottomDrawer from '../Helper/SwipeableBottomDrawer';
import { getThemeColors } from '../Helper/themeColors';
import { useLocalState } from '../LocalGlobelStats';
import { addXP, XP_ACTIONS } from './xpUtils';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const TRADE_RATINGS = [
  { key: 'win', label: 'Win', emoji: '🏆', color: '#10B981', desc: 'I got more value' },
  { key: 'fair', label: 'Fair', emoji: '🤝', color: '#F59E0B', desc: 'Equal trade' },
  { key: 'loss', label: 'Loss', emoji: '📉', color: '#EF4444', desc: 'I gave more value' },
];

const TradeCompletion = ({
  visible,
  onClose,
  db,
  uid,
  isDarkMode,
  hasItems = [],
  wantsItems = [],
  tradeResult = 'fair',
  partnerName = '',
  firestoreDB,
}) => {
  const { updateLocalState } = useLocalState();
  const [selectedRating, setSelectedRating] = useState(tradeResult);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [didScam, setDidScam] = useState(false);
  const [saved, setSaved] = useState(false);
  const [inventoryMsg, setInventoryMsg] = useState('');

  const handleSave = useCallback(async () => {
    if (!db || !uid) return;
    const gave = hasItems.filter(i => i);
    const got = wantsItems.filter(i => i);
    if (gave.length === 0 || got.length === 0) {
      Alert.alert('Add items on both sides!', 'You need items in both "I Gave" and "I Got" to save a trade.');
      return;
    }
    setSaving(true);

    try {
      // Save to journal
      const journalRef = ref(db, `tradeJournal/${uid}`);
      await push(journalRef, {
        gave: gave.map(i => ({ name: i.name || i.Name || 'Unknown', image: i.image || i.Image || null, value: Number(i.value || i.Value) || 0 })),
        got: got.map(i => ({ name: i.name || i.Name || 'Unknown', image: i.image || i.Image || null, value: Number(i.value || i.Value) || 0 })),
        result: selectedRating,
        gaveValue: gave.reduce((s, p) => s + (Number(p.value || p.Value) || 0), 0),
        gotValue: got.reduce((s, p) => s + (Number(p.value || p.Value) || 0), 0),
        partnerName: partnerName || 'Unknown',
        notes: notes.trim() || '',
        didScam,
        completedAt: serverTimestamp(),
      });

      // Award XP
      addXP(db, uid, XP_ACTIONS.COMPLETE_TRADE);

      // Update running trade stats
      try {
        const gv = gave.reduce((s, p) => s + (Number(p.value || p.Value) || 0), 0);
        const gtv = got.reduce((s, p) => s + (Number(p.value || p.Value) || 0), 0);
        const statsSnap = await get(ref(db, `tradeStats/${uid}`));
        const cur = statsSnap.exists() ? statsSnap.val() : { total: 0, wins: 0, fairs: 0, losses: 0, totalGave: 0, totalGot: 0 };
        await set(ref(db, `tradeStats/${uid}`), {
          total: (cur.total || 0) + 1,
          wins: (cur.wins || 0) + (selectedRating === 'win' ? 1 : 0),
          fairs: (cur.fairs || 0) + (selectedRating === 'fair' ? 1 : 0),
          losses: (cur.losses || 0) + (selectedRating === 'loss' ? 1 : 0),
          totalGave: (cur.totalGave || 0) + gv,
          totalGot: (cur.totalGot || 0) + gtv,
        });
      } catch (e) { console.warn('[TradeCompletion] stats update error:', e?.message); }

      // Auto-update owned pets inventory
      let addedNames = [];
      let removedNames = [];
      let notOwnedNames = [];

      if (firestoreDB) {
        try {
          // 📅 2026-03-13: Reads user_profiles first, falls back to reviews for backward compat.
          //    🔮 FUTURE CLEANUP: Once all users updated, remove the reviews fallback read below.
          let snap = await getDoc(doc(firestoreDB, 'user_profiles', uid));
          // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this fallback once all users updated
          if (!snap.exists()) {
            snap = await getDoc(doc(firestoreDB, 'reviews', uid));
          }
          let ownedPets = [];
          if (snap.exists()) {
            const data = snap.data();
            ownedPets = Array.isArray(data?.ownedPets) ? [...data.ownedPets] : [];
          }

          // Remove gave items from owned
          gave.forEach(g => {
            const gName = (g.name || g.Name || '').toLowerCase();
            const gType = g.valueType || 'd';
            const gFly = !!g.isFly;
            const gRide = !!g.isRide;
            // Match exact variant: same name + valueType + fly + ride.
            // Falls back to name-only only when no variant exists, so a neon
            // trade can never silently remove a mega of the same pet.
            let idx = ownedPets.findIndex(p =>
              (p.name || '').toLowerCase() === gName &&
              (p.valueType || 'd') === gType &&
              !!p.isFly === gFly &&
              !!p.isRide === gRide
            );
            if (idx === -1) {
              const sameName = ownedPets.filter(p => (p.name || '').toLowerCase() === gName);
              if (sameName.length === 1) {
                idx = ownedPets.indexOf(sameName[0]);
              }
            }
            if (idx !== -1) {
              ownedPets.splice(idx, 1);
              removedNames.push(g.name || g.Name);
            } else {
              notOwnedNames.push(g.name || g.Name);
            }
          });

          // Add got items to owned
          got.forEach(g => {
            const name = g.name || g.Name || 'Unknown';
            ownedPets.push({
              name,
              image: g.image || g.Image || null,
              imageUrl: g.image || g.Image || null,
              value: Number(g.value) || 0,
              valueType: g.valueType || 'd',
              isFly: g.isFly || false,
              isRide: g.isRide || false,
              category: g.type || g.category || 'pets',
              addedAt: new Date().toISOString(),
              addedVia: 'trade',
            });
            addedNames.push(name);
          });

          // 📅 2026-03-13: Dual-write to user_profiles (new primary) + reviews (backward compat).
          //    🔮 FUTURE CLEANUP: Once all users updated, remove the setDoc to 'reviews' below.
          await Promise.all([
            setDoc(doc(firestoreDB, 'user_profiles', uid), { ownedPets }, { merge: true }),
            // ⬇️ BACKWARD COMPAT (2026-03-13): Remove this line once all users updated
            setDoc(doc(firestoreDB, 'reviews', uid), { ownedPets }, { merge: true }),
          ]);

          // Mirror to MMKV so the screens that read localState.ownedPets — the
          // calculator's "MY STUFF" picker, the chat pet picker, My Stuff — show
          // the post-trade inventory immediately instead of after an app restart.
          updateLocalState('ownedPets', ownedPets);
        } catch (e) {
          console.warn('[TradeCompletion] inventory update error:', e?.message);
        }
      }

      // Build success message
      let msg = `+${XP_ACTIONS.COMPLETE_TRADE} XP earned\n`;
      if (addedNames.length > 0) msg += `✅ Added: ${addedNames.join(', ')}\n`;
      if (removedNames.length > 0) msg += `🔄 Removed: ${removedNames.join(', ')}\n`;
      if (notOwnedNames.length > 0) msg += `⚠️ Not in your list: ${notOwnedNames.join(', ')}`;
      setInventoryMsg(msg.trim());

      // Warn if items weren't in owned list
      if (notOwnedNames.length > 0) {
        Alert.alert(
          'Heads up! 🐾',
          `You sold ${notOwnedNames.join(', ')}, but ${notOwnedNames.length > 1 ? 'they were' : 'it was'} not in your My Stuff list, so we couldn't remove ${notOwnedNames.length > 1 ? 'them' : 'it'} from the list.\n\nHowever, your trade was saved successfully! ✅`
        );
      }

      setSaved(true);
    } catch (err) {
      console.warn('[TradeCompletion] save error:', err?.message);
      Alert.alert('Error', 'Could not save trade. Try again.');
    }
    setSaving(false);
  }, [db, uid, hasItems, wantsItems, selectedRating, notes, partnerName, didScam, firestoreDB, updateLocalState]);

  const handleClose = useCallback(() => {
    setSelectedRating(tradeResult);
    setNotes('');
    setDidScam(false);
    setSaved(false);
    setInventoryMsg('');
    onClose();
  }, [onClose, tradeResult]);

  if (!visible) return null;

  const c = getThemeColors(isDarkMode);
  const bg = c.bg;
  const cardBg = c.bgAlt;
  const textColor = c.text;
  const subtextColor = c.textSecondary;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <SwipeableBottomDrawer onClose={handleClose} isDarkMode={isDarkMode} style={[styles.container, { backgroundColor: bg }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.title, { color: textColor }]}>📓 I Traded!</Text>
              <TouchableOpacity
                onPress={() => Alert.alert(
                  '📓 I Traded!',
                  'Record a trade you just did in Adopt Me!\n\n🐾 Add the pets you gave & got\n⭐ Rate how the trade went (Win/Fair/Loss)\n✅ Save it to your My Stuff history\n\n🎒 Your pet inventory updates automatically — items you traded away are removed and items you got are added!'
                )}
              >
                <FontAwesome name="circle-info" size={16} color="#3B82F6" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={handleClose} style={{ padding: 4 }}>
              <Text style={{ fontSize: 20, color: subtextColor }}>✕</Text>
            </TouchableOpacity>
          </View>

          {saved ? (
            /* Success state */
            <View style={styles.successWrap}>
              <Text style={{ fontSize: 48 }}>🎉</Text>
              <Text style={[styles.successTitle, { color: textColor }]}>Trade Saved!</Text>
              <Text style={[styles.successSub, { color: subtextColor, textAlign: 'center' }]}>
                {inventoryMsg || `+${XP_ACTIONS.COMPLETE_TRADE} XP earned • Added to My Stuff`}
              </Text>
              <TouchableOpacity style={styles.doneBtn} onPress={handleClose}>
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Trade summary */}
              <View style={[styles.summaryCard, { backgroundColor: cardBg }]}>
                <View style={styles.summaryRow}>
                  <View style={styles.summaryCol}>
                    <Text style={[styles.summaryLabel, { color: subtextColor }]}>I Gave</Text>
                    <Text style={[styles.summaryCount, { color: textColor }]}>
                      {hasItems.filter(i => i).length} item(s)
                    </Text>
                  </View>
                  <FontAwesome name="arrow-right-arrow-left" size={16} color={subtextColor} />
                  <View style={styles.summaryCol}>
                    <Text style={[styles.summaryLabel, { color: subtextColor }]}>I Got</Text>
                    <Text style={[styles.summaryCount, { color: textColor }]}>
                      {wantsItems.filter(i => i).length} item(s)
                    </Text>
                  </View>
                </View>
              </View>

              {/* Rate trade */}
              <Text style={[styles.sectionTitle, { color: textColor }]}>How did it go?</Text>
              <View style={styles.ratingRow}>
                {TRADE_RATINGS.map((r) => (
                  <TouchableOpacity
                    key={r.key}
                    style={[
                      styles.ratingCard,
                      { backgroundColor: cardBg },
                      selectedRating === r.key && {
                        borderColor: r.color,
                        borderWidth: 2,
                        backgroundColor: r.color + '15',
                      },
                    ]}
                    onPress={() => setSelectedRating(r.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 24 }}>{r.emoji}</Text>
                    <Text style={[styles.ratingLabel, { color: textColor }]}>{r.label}</Text>
                    <Text style={[styles.ratingDesc, { color: subtextColor }]}>{r.desc}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Notes */}
              <TextInput
                style={[styles.notesInput, {
                  color: textColor,
                  backgroundColor: cardBg,
                  borderColor: isDarkMode ? '#334155' : '#e2e8f0',
                }]}
                placeholder="Notes (optional)"
                placeholderTextColor={subtextColor}
                value={notes}
                onChangeText={setNotes}
                maxLength={100}
              />

              {/* Scam flag */}
              <TouchableOpacity
                style={[styles.scamRow, {
                  backgroundColor: didScam ? '#FEE2E2' : cardBg,
                  borderColor: didScam ? '#EF4444' : 'transparent',
                }]}
                onPress={() => setDidScam(!didScam)}
                activeOpacity={0.7}
              >
                <FontAwesome
                  name={didScam ? 'circle-check' : 'circle'}
                  size={18}
                  color={didScam ? '#EF4444' : subtextColor}
                  solid={didScam}
                />
                <Text style={[styles.scamText, { color: didScam ? '#EF4444' : subtextColor }]}>
                  ⚠️ The other person scammed me
                </Text>
              </TouchableOpacity>

              {/* Save button */}
              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.5 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color="#FFF" />
                    <Text style={styles.saveBtnText}>Saving...</Text>
                  </View>
                ) : (
                  <Text style={styles.saveBtnText}>Save in My Stuff ✨</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </SwipeableBottomDrawer>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  container: { padding: 20, maxHeight: '85%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '800' },
  // Summary
  summaryCard: { borderRadius: 12, padding: 14, marginBottom: 16 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  summaryCol: { alignItems: 'center' },
  summaryLabel: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
  summaryCount: { fontSize: 16, fontWeight: '700' },
  // Rating
  sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  ratingRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  ratingCard: {
    flex: 1, alignItems: 'center', padding: 12, borderRadius: 12,
    borderWidth: 1, borderColor: 'transparent',
  },
  ratingLabel: { fontSize: 13, fontWeight: '700', marginTop: 4 },
  ratingDesc: { fontSize: 9, marginTop: 2, textAlign: 'center' },
  // Notes
  notesInput: {
    borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 12,
  },
  // Scam
  scamRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16,
  },
  scamText: { fontSize: 13, fontWeight: '500' },
  // Save
  saveBtn: {
    backgroundColor: '#3B82F6', paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  saveBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  // Success
  successWrap: { alignItems: 'center', paddingVertical: 30 },
  successTitle: { fontSize: 22, fontWeight: '800', marginTop: 8 },
  successSub: { fontSize: 13, marginTop: 4, lineHeight: 20 },
  doneBtn: {
    marginTop: 20, backgroundColor: '#10B981', paddingHorizontal: 30,
    paddingVertical: 12, borderRadius: 12,
  },
  doneBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});

export default React.memo(TradeCompletion);
