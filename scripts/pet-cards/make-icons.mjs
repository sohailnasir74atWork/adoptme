/**
 * make-icons.mjs — the tiny Pet Cards UI icons (no emoji; PET_CARDS_PLAN.md).
 *
 *   node scripts/pet-cards/make-icons.mjs
 *
 * Draws each icon as vector art and rasterises it with sharp at 1x/2x/3x into
 * assets/pet-cards/icons/<name>.png, <name>@2x.png, <name>@3x.png (20 pt base).
 * Deterministic: re-running produces identical files. Code/PetCards/cardIcons.jsx
 * maps the names.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/pet-cards/icons');
const BASE = 20;
const OUTLINE = 'rgba(28,16,48,0.42)';

const grad = (id, stops, v = false) => `<linearGradient id="${id}" x1="0" y1="0" x2="${v ? 0 : 1}" y2="1">${
  stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${body}</svg>`;

const GOLD = grad('gold', [[0, '#FFF1B8'], [0.42, '#F5B301'], [1, '#B45F06']]);
const GOLD_DEEP = grad('goldDeep', [[0, '#F5B301'], [1, '#8A4B00']], true);
const STEEL = grad('steel', [[0, '#F8FAFC'], [0.5, '#94A3B8'], [1, '#475569']]);
const SLATE = grad('slate', [[0, '#E2E8F0'], [0.45, '#94A3B8'], [1, '#475569']]);
const SLATE_DEEP = grad('slateDeep', [[0, '#94A3B8'], [1, '#334155']], true);
const RED = grad('red', [[0, '#FB7185'], [1, '#BE123C']]);
const BLUE = grad('blue', [[0, '#9BE2FF'], [0.5, '#2E9BF0'], [1, '#1E3A8A']], true);
const VIOLET = grad('violet', [[0, '#D8B4FE'], [0.5, '#8B5CF6'], [1, '#4C1D95']]);
const ROSE = grad('rose', [[0, '#FFC2D1'], [0.5, '#F43F5E'], [1, '#9F1239']]);

/** A push pin: cap, tapered body, collar, needle. Rotated so it reads as "pinned". */
const pin = (cap, body, collar, needle) => `
  <g transform="rotate(38 32 32)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round">
    <path d="M30 37 h4 l-2 22 z" fill="url(#${needle})"/>
    <path d="M23.5 15 h17 l-2.5 17 h-12 z" fill="url(#${body})"/>
    <rect x="19.5" y="31" width="25" height="7" rx="3.5" fill="url(#${collar})"/>
    <rect x="18" y="6" width="28" height="10" rx="4" fill="url(#${cap})"/>
    <rect x="22" y="8" width="9" height="3" rx="1.5" fill="rgba(255,255,255,0.85)" stroke="none"/>
  </g>`;

const ICONS = {
  // Show on profile
  pin: svg(GOLD + GOLD_DEEP + STEEL, pin('gold', 'gold', 'goldDeep', 'steel')),
  // Remove from profile: the same pin, greyed, with a red "minus" badge
  pin_off: svg(SLATE + SLATE_DEEP + STEEL + RED, pin('slate', 'slate', 'slateDeep', 'steel') + `
    <circle cx="47" cy="47" r="11.5" fill="url(#red)" stroke="#FFFFFF" stroke-width="2.4"/>
    <rect x="41" y="45.4" width="12" height="3.4" rx="1.7" fill="#FFFFFF"/>`),
  // Share: a tray with an arrow rising out of it
  share: svg(BLUE, `
    <path d="M14 26 h10 a2 2 0 0 1 0 4 h-6 v22 h28 v-22 h-6 a2 2 0 0 1 0 -4 h10 a4 4 0 0 1 4 4 v26 a4 4 0 0 1 -4 4 h-36 a4 4 0 0 1 -4 -4 v-26 a4 4 0 0 1 4 -4 z"
          fill="url(#blue)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M32 6 l12 13 h-7.5 v20 h-9 v-20 h-7.5 z" fill="#FFFFFF" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M32 9.5 l8 8.5 h-5 v18 h-2.5 v-18 z" fill="url(#blue)" opacity="0.18"/>`),
  // Collector score: a card with a gold star
  score: svg(VIOLET + GOLD, `
    <g transform="rotate(-8 32 32)">
      <rect x="15" y="7" width="34" height="48" rx="6" fill="url(#violet)" stroke="${OUTLINE}" stroke-width="1.6"/>
      <rect x="18.5" y="10.5" width="27" height="41" rx="4" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.4"/>
      <path d="M32 18.5 l3.9 8.1 8.9 1.2 -6.5 6.2 1.6 8.8 -7.9 -4.3 -7.9 4.3 1.6 -8.8 -6.5 -6.2 8.9 -1.2 z"
            fill="url(#gold)" stroke="rgba(90,50,0,0.55)" stroke-width="1.4" stroke-linejoin="round"/>
      <circle cx="22.5" cy="46" r="1.6" fill="rgba(255,255,255,0.8)"/>
      <circle cx="41.5" cy="46" r="1.6" fill="rgba(255,255,255,0.8)"/>
    </g>`),
  // Pet Cards: three fanned cards (violet, rose, gold)
  cards: svg(VIOLET + ROSE + GOLD, ['violet', 'rose', 'gold'].map((g, i) => `
    <g transform="rotate(${(i - 1) * 20} 32 58)">
      <rect x="21" y="12" width="22" height="33" rx="4" fill="url(#${g})" stroke="${OUTLINE}" stroke-width="1.6"/>
      <rect x="23.5" y="14.5" width="17" height="28" rx="2.5" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.2"/>
      ${i === 2 ? '<path d="M32 21 l2.2 4.6 5 .7 -3.6 3.5 .9 5 -4.5 -2.4 -4.5 2.4 .9 -5 -3.6 -3.5 5 -.7 z" fill="#FFF7D6" stroke="rgba(90,50,0,0.5)" stroke-width="1" stroke-linejoin="round"/>' : ''}
    </g>`).join('')),
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
    console.log(`${path.basename(file).padEnd(14)} ${px}px ${fs.statSync(file).size} B`);
  }
}
