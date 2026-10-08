/**
 * tradingServer.js — the admin's "Trading Zone" private-server link, behind
 * the Join chip of the chat's "Trade in game" line
 * (Code/ChatScreen/PrivateChat/Scamwarning.js).
 *
 * The links live in RTDB /server (the More tab's Private Servers list). The
 * Trading Zone is picked by name, else the first server. Read only when
 * someone taps Join, then kept for 3 hours.
 */

import { Linking } from 'react-native';
import { getDatabase, ref, get } from '@react-native-firebase/database';

const TTL_MS = 3 * 60 * 60 * 1000;
let cached = null; // { at, link }

export async function getTradingServerLink() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.link;
  const snap = await get(ref(getDatabase(), 'server'));
  const list = snap.exists() ? Object.values(snap.val() || {}) : [];
  const pick = list.find((s) => /trad/i.test(String(s?.name || ''))) || list[0];
  const link = String(pick?.link || '').trim() || null;
  cached = { at: Date.now(), link };
  return link;
}

/** Opens the Trading Zone in Roblox. Resolves false when there is no link. */
export async function openTradingServer() {
  const link = await getTradingServerLink();
  if (!link) return false;
  await Linking.openURL(link);
  return true;
}
