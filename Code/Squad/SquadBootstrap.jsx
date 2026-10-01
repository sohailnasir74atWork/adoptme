/**
 * SquadBootstrap — invisible, always mounted (AppEntry).
 *   - reads the squad code from the Play install link (first launch, Android)
 *   - joins that squad once the new player signs in
 *   - pings once a day for squad participants (qualifies friends, brings
 *     earned Pro to the phone) and on return to the foreground; a friend who
 *     just counted hears about their welcome Pro pass
 *   - tells squad.js whose Pro counts, and re-merges isPro when it expires
 */
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useGlobalState } from '../GlobelStats';
import { showSuccessMessage } from '../Helper/MessageHelper';
import {
  captureInstallReferrer, applyPendingCode, squadPing, setSquadUser,
  getSquadProUntil, onSquadProChange, refreshSquadPro, FRIEND_PRO_DAYS,
} from '../Helper/squad';

const MAX_TIMEOUT = 2 ** 31 - 1;

export default function SquadBootstrap() {
  const { user } = useGlobalState();
  const { t } = useTranslation();
  const uid = user?.id || null;

  useEffect(() => { captureInstallReferrer(); }, []);

  useEffect(() => {
    // Only a known user is set here. A null uid also means "login still
    // loading" at launch; the real sign-out clears it in GlobelStats, so the
    // remembered player's Squad Pro holds until then (squad.js).
    if (!uid) return undefined;
    setSquadUser(uid);
    let cancelled = false;
    // The ping that makes a friend count also pays their welcome pass; it is
    // not started for them (036), so say where it is.
    const ping = async () => {
      const r = await squadPing(uid);
      if (!cancelled && r?.qualified) {
        showSuccessMessage(
          t('squad.qualified_toast_title'),
          t('squad.qualified_toast_body', { pass: t('squad.pass_short', { count: FRIEND_PRO_DAYS }) }),
        );
      }
    };
    (async () => {
      await captureInstallReferrer();
      const res = await applyPendingCode(uid);
      if (!cancelled && res?.ok) {
        showSuccessMessage(
          t('squad.joined_toast_title'),
          t('squad.joined_toast_body', { name: res.inviterName || t('chat.anonymous'), pro: t('squad.pass_name', { count: FRIEND_PRO_DAYS }) }),
        );
      }
      if (!cancelled) await ping();
    })();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') ping();
    });
    return () => { cancelled = true; sub.remove(); };
  }, [uid, t]);

  // Earned Squad Pro can run out while the app is open.
  useEffect(() => {
    if (!uid) return undefined;
    let timer = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      const left = getSquadProUntil(uid) - Date.now();
      if (left > 0 && left < MAX_TIMEOUT) timer = setTimeout(refreshSquadPro, left + 1000);
    };
    arm();
    const off = onSquadProChange(arm);
    return () => { if (timer) clearTimeout(timer); off(); };
  }, [uid]);

  return null;
}
