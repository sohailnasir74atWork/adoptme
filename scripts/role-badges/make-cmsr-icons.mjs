/**
 * make-cmsr-icons.mjs — the two CMSR badge icons as tiny PNGs (no emoji, no
 * vector-icon glyphs; same approach as scripts/pet-cards/make-icons.mjs).
 *
 *   node scripts/role-badges/make-cmsr-icons.mjs
 *
 * CMSR is two badges with one name: House CMSR (users/{uid}/isCMSR, the
 * original flag) and Art CMSR (users/{uid}/isArtCMSR). Both wear the gold rim
 * of the other role badges; the disc colour and the glyph tell them apart at
 * 14 px: an orange disc with a white house, a rose disc with a white palette.
 *
 * Writes assets/role-badges/<name>.png, @2x and @3x at a 40 pt base (the
 * biggest draw is 40 pt in Code/Elections/RoleCharter.jsx; chat rows use 14).
 * Deterministic: re-running produces identical files.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/role-badges');
const BASE = 40;
const OUTLINE = 'rgba(28,16,48,0.42)';

const grad = (id, stops, v = false) => `<linearGradient id="${id}" x1="0" y1="0" x2="${v ? 0 : 1}" y2="1">${
  stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${body}</svg>`;

const GOLD = grad('gold', [[0, '#FFF1B8'], [0.42, '#F5B301'], [1, '#B45F06']]);
const ORANGE = grad('orange', [[0, '#FDBA74'], [0.5, '#EA580C'], [1, '#9A3412']], true);
const ROSE = grad('rose', [[0, '#FDA4AF'], [0.5, '#E11D48'], [1, '#881337']], true);

/** The body every role badge shares: gold rim, coloured disc, a gloss on top. */
const disc = (fill, ink) => `
  <circle cx="32" cy="32" r="29.5" fill="url(#gold)" stroke="${OUTLINE}" stroke-width="1.6"/>
  <circle cx="32" cy="32" r="24.5" fill="url(#${fill})" stroke="${ink}" stroke-width="1"/>
  <ellipse cx="32" cy="20" rx="15" ry="6.5" fill="rgba(255,255,255,0.22)"/>`;

const INK_O = 'rgba(60,20,0,0.35)';
const INK_R = 'rgba(80,10,40,0.35)';

const ICONS = {
  // House CMSR: a white house (chimney, body, roof) with the door cut out of it
  cmsr_house: svg(GOLD + ORANGE, disc('orange', INK_O) + `
    <rect x="38.5" y="19" width="4.5" height="9" rx="1" fill="#FFFFFF" stroke="${INK_O}" stroke-width="1"/>
    <rect x="21" y="30" width="22" height="17" rx="2" fill="#FFFFFF" stroke="${INK_O}" stroke-width="1"/>
    <path d="M14 32.5 L32 16 L50 32.5 Z" fill="#FFFFFF" stroke="${INK_O}" stroke-width="1" stroke-linejoin="round"/>
    <rect x="28.75" y="37" width="6.5" height="10" rx="1.5" fill="url(#orange)"/>`),
  // Art CMSR: a white painter's palette, five paint dabs, a thumb hole
  cmsr_art: svg(GOLD + ROSE, disc('rose', INK_R) + `
    <path d="M32 14.5 C21 14.5 13 22 13 31 C13 40.5 21.5 48.5 32 48.5 C36 48.5 38.2 46 37.6 43 C37.1 40 39 38 42 38 L45 38 C48.5 38 51 35 51 31.5 C51 22 42.5 14.5 32 14.5 Z"
          fill="#FFFFFF" stroke="${INK_R}" stroke-width="1" stroke-linejoin="round"/>
    <circle cx="23.5" cy="26" r="3.6" fill="#EF4444"/>
    <circle cx="31.5" cy="21.5" r="3.6" fill="#F59E0B"/>
    <circle cx="40" cy="24.5" r="3.6" fill="#22C55E"/>
    <circle cx="22" cy="35" r="3.6" fill="#3B82F6"/>
    <circle cx="29.5" cy="40.5" r="3.6" fill="#8B5CF6"/>
    <circle cx="43.5" cy="30.5" r="2.8" fill="url(#rose)" stroke="${INK_R}" stroke-width="1"/>`),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, body] of Object.entries(ICONS)) {
  for (const scale of [1, 2, 3]) {
    const px = BASE * scale;
    const file = path.join(OUT, `${name}${scale > 1 ? `@${scale}x` : ''}.png`);
    // density: librsvg rasterises at 72 dpi for the viewBox; scale it so the 64-unit art fills px.
    await sharp(Buffer.from(body), { density: 72 * (px / 64) * 2 })
      .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(file);
    console.log(`${path.basename(file).padEnd(18)} ${px}px ${fs.statSync(file).size} B`);
  }
}
