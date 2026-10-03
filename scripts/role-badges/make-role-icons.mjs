/**
 * make-role-icons.mjs — the role badge icons as tiny PNGs (no
 * emoji, no vector-icon glyphs; same approach as scripts/pet-cards/make-icons.mjs).
 *
 *   node scripts/role-badges/make-role-icons.mjs
 *
 * Inline rails (chat rows, DM header, trade and post cards) draw these as bare
 * icons next to the Pro and Verified seals, so they share one body: a round
 * coin filling the same box the seals fill, a darker rim, a soft gloss, and a
 * white mark drawn here (never a typeable character). Colour and mark tell
 * them apart at 14 px:
 *
 *   trusted     emerald coin, faceted gem
 *   cmsr_house  orange coin, roof over a keyhole   (House CMSR, isCMSR)
 *   cmsr_art    rose coin, brush and paint stroke  (Art CMSR, isArtCMSR)
 *   helper      teal coin, speech bubble with a plus
 *   admin       red coin, crown                    (inside the labelled chip)
 *   mod         violet coin, shield with a star    (inside the labelled chip)
 *   jmd         amber coin, star over two chevrons (inside the labelled chip)
 *
 * The coin colours are the pill colours in Code/Helper/UserBadgePill.jsx.
 * Writes assets/role-badges/<name>.png, @2x and @3x at a 40 pt base (the
 * biggest draw is 40 pt in Code/Elections/RoleCharter.jsx), palette-quantised
 * to keep each file a few KB. Deterministic: re-running gives identical files.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ROLE_ICONS_OUT lets a draft go to a scratch folder before it replaces the assets.
const OUT = process.env.ROLE_ICONS_OUT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/role-badges');
const BASE = 40;

const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`;

/** The coin every community badge shares; `mark` is drawn twice (shadow, then white). */
const coin = ({ light, base, deep, rim }, mark) => svg(`
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${light}"/><stop offset="0.55" stop-color="${base}"/><stop offset="1" stop-color="${deep}"/>
    </linearGradient>
  </defs>
  <circle cx="32" cy="32" r="31" fill="${rim}"/>
  <circle cx="32" cy="32" r="27.5" fill="url(#g)"/>
  <circle cx="32" cy="32" r="27.5" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1.2"/>
  <path d="M10 27 A22.5 22.5 0 0 1 54 27 C46 22 18 22 10 27 Z" fill="rgba(255,255,255,0.20)"/>
  <g transform="translate(0 1.6)" fill="rgba(0,0,0,0.28)" stroke="rgba(0,0,0,0.28)">${mark(deep)}</g>
  <g fill="#FFFFFF" stroke="#FFFFFF">${mark(base)}</g>`);

// Each mark gets the coin colour so it can cut details back out of the white.
const MARKS = {
  // A cut gem: table, girdle, and one bold facet V (more lines blur at 14 px).
  trusted: (cut) => `
    <path d="M21.5 18 H42.5 L51 29 L32 50.5 L13 29 Z" stroke-width="1.5" stroke-linejoin="round"/>
    <g fill="none" stroke="${cut}" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round">
      <path d="M15 29 H49"/>
      <path d="M25 29 L32 46 L39 29"/>
      <path d="M25 29 L29 19 M39 29 L35 19"/>
    </g>`,
  // A roof with a chimney over a keyhole: the house a commissioner looks
  // after. The chimney and the gap under the roof keep it from reading as an
  // upload arrow at 14 px.
  cmsr_house: () => `
    <path d="M40.5 21 V15.5 H45.5 V25.5" stroke-width="1" stroke-linejoin="round"/>
    <path d="M13.5 31 L32 15.5 L50.5 31" fill="none" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="32" cy="35.5" r="6.8" stroke="none"/>
    <path d="M28.2 39 H35.8 L38.5 50 H25.5 Z" stroke-width="1.5" stroke-linejoin="round"/>`,
  // A loaded brush laying down a curved stroke.
  cmsr_art: () => `
    <path d="M47.5 14.5 L36.5 27.5" fill="none" stroke-width="5.5" stroke-linecap="round"/>
    <path d="M33.2 25.6 L38.6 30.2 L36.8 32.4 L31.4 27.8 Z" stroke-width="1" stroke-linejoin="round"/>
    <path d="M31 28.5 C36 31.5 36.5 38.5 29.5 42 C26.5 43.5 22.5 43.5 20 42.5 C23 40 22.5 36 24.5 33 C26 30.5 28.5 28.5 31 28.5 Z" stroke-width="1" stroke-linejoin="round"/>
    <path d="M15 49 C22 45.5 30 50.5 38 47.5 C42 46 45 43.5 48 43.5" fill="none" stroke-width="4" stroke-linecap="round"/>`,
  // Authority coins, drawn inside the labelled Admin / Mod / JMD chip.
  // A crown with three cut jewels.
  admin: (cut) => `
    <path d="M15.5 41 L13.5 22.5 L23.5 31 L32 17 L40.5 31 L50.5 22.5 L48.5 41 Z" stroke-width="1.5" stroke-linejoin="round"/>
    <rect x="15.5" y="43.5" width="33" height="5.5" rx="1.8" stroke="none"/>
    <g fill="${cut}" stroke="none"><circle cx="24" cy="37" r="2.4"/><circle cx="32" cy="35.5" r="2.8"/><circle cx="40" cy="37" r="2.4"/></g>`,
  // A shield with a star cut out of it.
  mod: (cut) => `
    <path d="M32 14 L48.5 20 V31 C48.5 41 41.5 47.5 32 51.5 C22.5 47.5 15.5 41 15.5 31 V20 Z" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M32 23.2 L34.6 29 L40.8 29.6 L36.1 33.7 L37.5 39.8 L32 36.6 L26.5 39.8 L27.9 33.7 L23.2 29.6 L29.4 29 Z" fill="${cut}" stroke="none"/>`,
  // Two rank chevrons under a small star: the junior seat.
  jmd: () => `
    <path d="M32 13.5 L33.9 17.6 L38.4 18 L35 21 L36 25.4 L32 23.1 L28 25.4 L29 21 L25.6 18 L30.1 17.6 Z" stroke="none"/>
    <path d="M17.5 36 L32 27.5 L46.5 36" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M17.5 47 L32 38.5 L46.5 47" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  // A speech bubble with a plus: the player who answers questions.
  helper: (cut) => `
    <path d="M24 16.5 H40 A10 10 0 0 1 50 26.5 V31 A10 10 0 0 1 40 41 H31 L21.5 49 L23.5 40.5 A10 10 0 0 1 14 31 V26.5 A10 10 0 0 1 24 16.5 Z" stroke-width="1" stroke-linejoin="round"/>
    <g fill="${cut}" stroke="none">
      <rect x="29.25" y="21" width="5.5" height="15.5" rx="1.6"/>
      <rect x="24.25" y="26" width="15.5" height="5.5" rx="1.6"/>
    </g>`,
};

const TONES = {
  admin:      { light: '#F87171', base: '#DC2626', deep: '#991B1B', rim: '#7F1D1D' },
  mod:        { light: '#A78BFA', base: '#7C3AED', deep: '#5B21B6', rim: '#4C1D95' },
  jmd:        { light: '#FCD34D', base: '#D97706', deep: '#92400E', rim: '#78350F' },
  trusted:    { light: '#34D399', base: '#059669', deep: '#065F46', rim: '#064E3B' },
  cmsr_house: { light: '#FDBA74', base: '#EA580C', deep: '#9A3412', rim: '#7C2D12' },
  cmsr_art:   { light: '#FDA4AF', base: '#E11D48', deep: '#9F1239', rim: '#881337' },
  helper:     { light: '#5EEAD4', base: '#0D9488', deep: '#115E59', rim: '#134E4A' },
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, mark] of Object.entries(MARKS)) {
  const body = coin(TONES[name], mark);
  for (const scale of [1, 2, 3]) {
    const px = BASE * scale;
    const file = path.join(OUT, `${name}${scale > 1 ? `@${scale}x` : ''}.png`);
    // density: librsvg rasterises at 72 dpi for the viewBox; scale it so the 64-unit art fills px.
    await sharp(Buffer.from(body), { density: 72 * (px / 64) * 2 })
      .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 })
      .toFile(file);
    console.log(`${path.basename(file).padEnd(18)} ${px}px ${fs.statSync(file).size} B`);
  }
}
