import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Switch } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { showErrorMessage, showSuccessMessage } from '../Helper/MessageHelper';
import { trackGrowthEvent } from '../Helper/growthAnalytics';
import { getThemeColors } from '../Helper/themeColors';
import { useGlobalState } from '../GlobelStats';
import { setBirthdayUser, getMyBirthday, peekMyBirthday, setBirthdayVisibility, onBirthdaysChange, isBirthdayMockActive } from './birthdayApi';
import { isMinorDob } from '../Helper/ageGate';
import EditBirthdaySheet from './EditBirthdaySheet';

// Settings rows, same style as EmailUpdatesRow:
//   "Show my birthday" (month and day only; on by default, 050) — hidden for
//   under-13s, whose birthday is never public;
//   "Change my birthday" — the one-time month/day correction, while unused.
const BirthdayVisibilityRow = ({ uid, knownDob, styles, onHaptic, iconStyle, iconColor, iconSize }) => {
  const { t } = useTranslation();
  const { theme, setUser } = useGlobalState();
  const c = getThemeColors(theme === 'dark');
  const [show, setShow] = useState(peekMyBirthday()?.show ?? true);
  const [canEdit, setCanEdit] = useState(!!peekMyBirthday()?.canEdit);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!uid) return undefined;
    let alive = true;
    setBirthdayUser(uid);
    const apply = (m) => { if (alive && m) { setShow(!!m.show); setCanEdit(!!m.canEdit); } };
    getMyBirthday().then(apply).catch(() => {});
    const off = onBirthdaysChange(() => apply(peekMyBirthday()));
    return () => { alive = false; off(); };
  }, [uid]);

  const onToggle = useCallback(async (next) => {
    if (busy) return;
    if (onHaptic) onHaptic();
    setBusy(true);
    setShow(next);
    try {
      await setBirthdayVisibility(next);
      trackGrowthEvent('birthday_visibility', { show: next ? 1 : 0, where: 'settings' });
    } catch (_) {
      setShow(!next);
      showErrorMessage(t('home.alert.error'), t('birthdays.err.generic'));
    } finally {
      setBusy(false);
    }
  }, [busy, onHaptic, t]);

  const onSaved = useCallback((dob) => {
    setEditing(false);
    setCanEdit(false);
    if (dob && setUser && !isBirthdayMockActive()) setUser((prev) => ({ ...prev, dateOfBirth: dob }));
    trackGrowthEvent('birthday_edit', { where: 'settings' });
    showSuccessMessage(t('birthdays.edit_saved'), '');
    getMyBirthday({ force: true }).catch(() => {});
  }, [setUser, t]);

  if (!uid) return null;
  const minor = isMinorDob(knownDob);

  return (
    <>
      {!minor && (
        <View style={styles.option}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: '100%' }}>
            <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => onToggle(!show)}>
              <Icon name="gift-outline" size={iconSize || 18} color={iconColor || 'white'} style={iconStyle || { backgroundColor: '#EC4899', padding: 5, borderRadius: 5 }} />
              <Text style={styles.optionText}>{t('birthdays.settings_row')}</Text>
            </TouchableOpacity>
            <Switch value={show} disabled={busy} onValueChange={onToggle} />
          </View>
        </View>
      )}
      {canEdit && knownDob ? (
        <View style={styles.option}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
            onPress={() => { if (onHaptic) onHaptic(); setEditing(true); }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Icon name="calendar-outline" size={iconSize || 18} color={iconColor || 'white'} style={iconStyle || { backgroundColor: '#DB2777', padding: 5, borderRadius: 5 }} />
              <Text style={styles.optionText}>{t('birthdays.edit_row')}</Text>
            </View>
            <Icon name="chevron-forward" size={18} color={c.textMuted} />
          </TouchableOpacity>
        </View>
      ) : null}
      <EditBirthdaySheet visible={editing} dob={knownDob} c={c} onClose={() => setEditing(false)} onSaved={onSaved} />
    </>
  );
};

export default React.memo(BirthdayVisibilityRow);
