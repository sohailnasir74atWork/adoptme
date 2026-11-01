/**
 * runwayBridge.js — the pure parts of the Pet Runway ↔ app bridge (2026-10-31).
 * No React, no native modules, so __tests__/petRunway.test.js can cover them.
 *
 * The game (Code/PetRunway/game/, packed into runwayGameHtml.js by `npm run runway:build`)
 * carries its own English text; the app sends the player's language as `strings`
 * (Code/Translation/*.json → "pet_runway", keys listed in runwayKeys.js). Placeholders are
 * single-brace {name}: i18next only touches {{double}}, so they reach the game unchanged.
 *
 * Phase 1 has no server: cards, the draft and private pictures live on the phone (MMKV),
 * per account (or "guest"), and are cleaned here every time they are read or written.
 */

export const MAX_CARDS = 30;
export const MAX_PHOTOS = 12;
// A picture is at most 512 px and 120 KB of JPEG (owner decision 2026-10-31); as base64 that is
// 4/3 of the bytes plus the data-URI prefix.
export const PHOTO_MAX_BYTES = 120 * 1024;
const PHOTO_MAX_CHARS = Math.ceil(PHOTO_MAX_BYTES / 3) * 4 + 40;
// A saved card stays small enough to store (and, in Phase 2, to send): drawings are capped in the game.
const MAX_CARD_CHARS = 200 * 1024;

// Ads (owner 2026-10-31): a banner only on the game's home screen (never in the studio, where
// fingers drag and draw, nor over the runway show or Magic), and one interstitial when a player
// leaves the runway show after saving a card (InterstitialAdManager.showAtNaturalBreak: at most
// one per 3 minutes and 5 per session, never for Pro). Nothing around Magic.
export const BANNER_SCREENS = ['home'];
export const showBannerOn = (screen, isPro) => !isPro && BANNER_SCREENS.includes(screen);

/** MMKV key for one kind of saved data ('cards' | 'draft' | 'photos') of one account. */
export const storeKey = (kind, uid) => `${kind}:${uid || 'guest'}`;

const isLook = (l) => !!(l && typeof l === 'object' && l.pet && typeof l.pet.id === 'string' && Array.isArray(l.stickers));
const fits = (v, max) => { try { return JSON.stringify(v).length <= max; } catch (e) { return false; } };

/** A draft look, or null. */
export function cleanDraft(raw) {
  return isLook(raw) && fits(raw, MAX_CARD_CHARS) ? raw : null;
}

/** Saved cards: [{ look, t }], newest first, at most MAX_CARDS. */
export function cleanCards(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && isLook(c.look) && fits(c.look, MAX_CARD_CHARS))
    .map((c) => ({ look: c.look, t: Number(c.t) || 0 }))
    .slice(0, MAX_CARDS);
}

/** True for a JPEG/PNG/WebP data URI no bigger than the picture limit. */
export const photoFits = (data) =>
  typeof data === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data) && data.length <= PHOTO_MAX_CHARS;

/** Private pictures: [{ id, data }], newest first, at most MAX_PHOTOS, every one within the limit. */
export function cleanPhotos(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  return raw
    .filter((p) => p && typeof p.id === 'string' && /^p[a-z0-9]{1,20}$/.test(p.id) && photoFits(p.data) && !seen.has(p.id) && seen.add(p.id))
    .slice(0, MAX_PHOTOS);
}

/** Parse one message from the game; null when it is not ours. */
export function parseMessage(data) {
  let msg;
  try {
    msg = typeof data === 'string' ? JSON.parse(data) : data;
  } catch (e) {
    return null;
  }
  return msg && typeof msg === 'object' && typeof msg.type === 'string' ? msg : null;
}

// Game haptic names → react-native-haptic-feedback types.
export const HAPTIC_TYPES = { light: 'impactLight', medium: 'impactMedium', success: 'notificationSuccess' };

// Analytics events the game may ask for (anything else is ignored).
export const EVENTS = ['runway_show', 'runway_save', 'runway_share', 'runway_magic'];

/** The window.__RW_INIT assignment ('<' escaped, so no string can close the tag). */
export const initScript = (init) => `window.__RW_INIT = ${JSON.stringify(init).replace(/</g, '\\u003c')}; true;`;

/**
 * The game page with its settings written in ahead of the game script.
 * Not injectedJavaScriptBeforeContentLoaded: on Android that ran AFTER the page's inline
 * script in MM2's Lights Out Manor (react-native-webview 16.0.0, 2026-10-30).
 */
export const withInit = (html, init) => html.replace('<head>', `<head><script>${initScript(init)}</script>`);

/** JS that hands pictures to the game a few at a time (each is up to ~160 KB of text). */
export const photoBatches = (photos, size = 3) => {
  const out = [];
  for (let i = 0; i < photos.length; i += size) {
    out.push(`window.__rw && window.__rw.setPhotos(${JSON.stringify(photos.slice(i, i + size)).replace(/</g, '\\u003c')}); true;`);
  }
  return out;
};
