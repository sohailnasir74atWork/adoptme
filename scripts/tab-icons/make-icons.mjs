/**
 * make-icons.mjs — the six bottom-tab icons as tiny PNGs (same approach as
 * scripts/more-hub/make-icons.mjs).
 *
 *   node scripts/tab-icons/make-icons.mjs
 *
 *   home        Home        (a candy house with a heart window)
 *   calculator  Calculator  (a calculator with colourful keys)
 *   trade       Trade       (two swap arrows)
 *   feed        Feed        (a photo card with a heart)
 *   chat        Chat        (a speech bubble with a small heart bubble)
 *   more        More        (four candy tiles)
 *
 * Glossy toy style to match assets/home-actions and assets/more-hub, kept bold
 * and simple so each reads at tab size. Every icon also gets a "-off" twin
 * (soft grey) for the unselected tab.
 * Writes assets/tab-icons/<name>[-off].png, @2x and @3x at a 26 pt base.
 * Deterministic: re-running gives identical files.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const OUT = process.env.TAB_ICONS_OUT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/tab-icons');
const BASE = 26;
const OUTLINE = 'rgba(28,16,48,0.42)';

const grad = (id, stops, vertical = true) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1">${
  stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${body}</svg>`;

/** A four-point sparkle centred on (x, y). */
const sparkle = (x, y, r, fill = '#FDE68A') =>
  `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}"/>`;

/** A heart centred on (x, y) with half-width r. */
const heart = (x, y, r, fill) =>
  `<path d="M${x} ${y + r * 0.95} C${x - r * 1.5} ${y - r * 0.05} ${x - r * 0.95} ${y - r * 1.2} ${x} ${y - r * 0.45} C${x + r * 0.95} ${y - r * 1.2} ${x + r * 1.5} ${y - r * 0.05} ${x} ${y + r * 0.95} Z" fill="${fill}"/>`;

/** One glossy calculator key. */
const key = (x, y, id) => `
  <rect x="${x}" y="${y + 1.2}" width="10" height="8.5" rx="3" fill="rgba(28,16,48,0.28)"/>
  <rect x="${x}" y="${y}" width="10" height="8.5" rx="3" fill="url(#${id})"/>
  <rect x="${x + 2}" y="${y + 1.2}" width="6" height="2" rx="1" fill="rgba(255,255,255,0.55)"/>`;

/** One glossy tile of the More mark. */
const tile = (x, y, id) => `
  <rect x="${x}" y="${y + 2}" width="25" height="25" rx="8" fill="rgba(28,16,48,0.25)"/>
  <rect x="${x}" y="${y}" width="25" height="25" rx="8" fill="url(#${id})" stroke="${OUTLINE}" stroke-width="1.4"/>
  <path d="M${x + 4.5} ${y + 3.2} H${x + 20.5} C${x + 22.5} ${y + 3.2} ${x + 22.5} ${y + 7.5} ${x + 20.5} ${y + 8} C${x + 15} ${y + 6.5} ${x + 10} ${y + 6.5} ${x + 4.5} ${y + 8} C${x + 2.5} ${y + 7.5} ${x + 2.5} ${y + 3.2} ${x + 4.5} ${y + 3.2} Z" fill="rgba(255,255,255,0.5)"/>`;

const ICONS = {
  // A candy house: red roof, cream walls, blue door and a heart window.
  home: svg(
    grad('roof', [[0, '#FCA5A5'], [0.5, '#EF4444'], [1, '#B91C1C']])
      + grad('wall', [[0, '#FFF7ED'], [1, '#FDBA74']])
      + grad('door', [[0, '#93C5FD'], [1, '#2563EB']]),
    `<path d="M13 30 V53 C13 56 15 58 18 58 H46 C49 58 51 56 51 53 V30 Z" fill="#9A3412" opacity="0.35" transform="translate(0 2)"/>
     <path d="M13 30 V53 C13 56 15 58 18 58 H46 C49 58 51 56 51 53 V30 Z" fill="url(#wall)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <path d="M5.5 31 L29.5 9.5 C31 8.2 33 8.2 34.5 9.5 L58.5 31 C60.2 32.6 59 35 56.8 35 H7.2 C5 35 3.8 32.6 5.5 31 Z"
           fill="url(#roof)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M15 28 L31 13.6 C31.6 13 32.4 13 33 13.6 L36 16.3 C29 19 21 24 15 30 Z" fill="rgba(255,255,255,0.45)"/>
     <rect x="35" y="40" width="10" height="18" rx="4" fill="url(#door)" stroke="${OUTLINE}" stroke-width="1.3"/>
     <circle cx="42.6" cy="49.5" r="1.3" fill="#FDE68A"/>
     ${heart(23, 45, 6, '#F472B6')}
     ${sparkle(55, 11, 5.5)}`),

  // A violet calculator with a mint screen and candy keys.
  calculator: svg(
    grad('body', [[0, '#C4B5FD'], [0.45, '#8B5CF6'], [1, '#5B21B6']])
      + grad('screen', [[0, '#D1FAE5'], [1, '#6EE7B7']])
      + grad('kPink', [[0, '#FBCFE8'], [1, '#EC4899']]) + grad('kYellow', [[0, '#FEF3C7'], [1, '#F59E0B']])
      + grad('kBlue', [[0, '#BAE6FD'], [1, '#0EA5E9']]) + grad('kGreen', [[0, '#BBF7D0'], [1, '#22C55E']]),
    `<rect x="12" y="6" width="40" height="55" rx="10" fill="#3B0764"/>
     <rect x="12" y="4" width="40" height="55" rx="10" fill="url(#body)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <path d="M17 8 H47 C49 8 49.5 11 47.5 11.6 C37 10 27 10 16.5 11.6 C14.5 11 15 8 17 8 Z" fill="rgba(255,255,255,0.45)"/>
     <rect x="17" y="13" width="30" height="13" rx="4" fill="url(#screen)" stroke="rgba(6,78,59,0.35)" stroke-width="1"/>
     <path d="M30 17.3 H41 M30 21.7 H41" stroke="#047857" stroke-width="2.4" stroke-linecap="round"/>
     ${key(17, 31, 'kPink')}${key(27, 31, 'kYellow')}${key(37, 31, 'kBlue')}
     ${key(17, 43, 'kGreen')}${key(27, 43, 'kPink')}${key(37, 43, 'kYellow')}
     ${sparkle(56, 8, 5)}`),

  // Two fat swap arrows: orange goes right, green comes back.
  trade: svg(
    grad('aTop', [[0, '#FED7AA'], [0.5, '#F97316'], [1, '#C2410C']])
      + grad('aBot', [[0, '#BBF7D0'], [0.5, '#22C55E'], [1, '#15803D']]),
    `<path d="M8 22 C8 19.8 9.8 18 12 18 H40 V10.5 C40 8.6 42.2 7.6 43.7 8.8 L57.3 19.8 C58.5 20.8 58.5 22.6 57.3 23.6 L43.7 34.6 C42.2 35.8 40 34.8 40 32.9 V26 H12 C9.8 26 8 24.2 8 22 Z"
           fill="url(#aTop)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M12 20.6 H41.2 V12.6 L44.3 15.1 C43 16.5 43 19 43 21.6 L12 22.8 C10.6 22.8 10.6 20.6 12 20.6 Z" fill="rgba(255,255,255,0.45)"/>
     <path d="M56 44 C56 46.2 54.2 48 52 48 H24 V55.5 C24 57.4 21.8 58.4 20.3 57.2 L6.7 46.2 C5.5 45.2 5.5 43.4 6.7 42.4 L20.3 31.4 C21.8 30.2 24 31.2 24 33.1 V40 H52 C54.2 40 56 41.8 56 44 Z"
           fill="url(#aBot)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M24 42.2 H52 C53.4 42.2 53.4 44.3 52 44.3 L25.4 44.6 C24.6 41.8 22.6 38.2 21.6 36.6 L22.6 35.8 V42.2 Z" fill="rgba(255,255,255,0.4)"/>
     ${sparkle(55, 54, 5)}`),

  // A tilted photo card with a sunny hill, a pet paw and a pink heart badge.
  feed: svg(
    grad('sky', [[0, '#7DD3FC'], [1, '#C4B5FD']])
      + grad('hill', [[0, '#86EFAC'], [1, '#16A34A']])
      + grad('sun', [[0, '#FEF9C3'], [1, '#FBBF24']])
      + grad('badge', [[0, '#FBCFE8'], [0.5, '#EC4899'], [1, '#BE185D']]),
    `<g transform="rotate(-8 30 32)">
       <rect x="9" y="11" width="42" height="46" rx="7" fill="rgba(28,16,48,0.3)"/>
       <rect x="9" y="9" width="42" height="46" rx="7" fill="#FFFFFF" stroke="${OUTLINE}" stroke-width="1.6"/>
       <rect x="13.5" y="13.5" width="33" height="29" rx="4" fill="url(#sky)"/>
       <circle cx="38" cy="21" r="4.5" fill="url(#sun)"/>
       <path d="M13.5 36 C19 30 25 30 29 34 C33 30.5 40 30 46.5 34 V38.5 C46.5 40.9 44.6 42.5 42.5 42.5 H17.5 C15.3 42.5 13.5 40.9 13.5 38.5 Z" fill="url(#hill)"/>
       <rect x="16" y="47" width="20" height="3" rx="1.5" fill="#E2E8F0"/>
     </g>
     <circle cx="48" cy="47" r="11" fill="#831843" transform="translate(0 1.5)"/>
     <circle cx="48" cy="47" r="11" fill="url(#badge)" stroke="${OUTLINE}" stroke-width="1.4"/>
     ${heart(48, 47.5, 5.6, '#FFFFFF')}
     ${sparkle(56, 9, 5)}`),

  // A sky-blue speech bubble with three dots, plus a small pink heart bubble.
  chat: svg(
    grad('bubble', [[0, '#BAE6FD'], [0.5, '#38BDF8'], [1, '#0369A1']])
      + grad('mini', [[0, '#FBCFE8'], [1, '#EC4899']]),
    `<path d="M10 14 C10 9.6 13.6 6 18 6 H44 C48.4 6 52 9.6 52 14 V33 C52 37.4 48.4 41 44 41 H25 L14.5 50 C13.2 51.1 11.3 50.1 11.6 48.4 L13 41 C11.3 39.6 10 37.4 10 35 Z"
           fill="#0C4A6E" opacity="0.35" transform="translate(0 2)"/>
     <path d="M10 14 C10 9.6 13.6 6 18 6 H44 C48.4 6 52 9.6 52 14 V33 C52 37.4 48.4 41 44 41 H25 L14.5 50 C13.2 51.1 11.3 50.1 11.6 48.4 L13 41 C11.3 39.6 10 37.4 10 35 Z"
           fill="url(#bubble)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M17 10 H45 C47.5 10 47.6 13.6 45.4 14 C36 12.4 26 12.4 16.6 14 C14.4 13.6 14.5 10 17 10 Z" fill="rgba(255,255,255,0.45)"/>
     <circle cx="21" cy="25" r="3.6" fill="#FFFFFF"/><circle cx="31" cy="25" r="3.6" fill="#FFFFFF"/><circle cx="41" cy="25" r="3.6" fill="#FFFFFF"/>
     <path d="M36 40 C36 37.2 38.2 35 41 35 H53 C55.8 35 58 37.2 58 40 V49 C58 51.6 56.2 53.6 53.8 53.9 L55 59 L48.5 54 H41 C38.2 54 36 51.8 36 49 Z"
           fill="url(#mini)" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>
     ${heart(47, 44.5, 4.6, '#FFFFFF')}
     ${sparkle(57, 10, 4.5)}`),

  // Four candy tiles: everything else lives here.
  more: svg(
    grad('tPink', [[0, '#FBCFE8'], [1, '#DB2777']]) + grad('tBlue', [[0, '#BAE6FD'], [1, '#2563EB']])
      + grad('tAmber', [[0, '#FEF3C7'], [1, '#F59E0B']]) + grad('tGreen', [[0, '#BBF7D0'], [1, '#16A34A']]),
    `${tile(5, 5, 'tPink')}${tile(34, 5, 'tBlue')}${tile(5, 34, 'tAmber')}${tile(34, 34, 'tGreen')}`),
};

/** The unselected twin: soft grey, keeping the shape and gloss. */
async function offVariant(png) {
  return sharp(png).modulate({ saturation: 0.08, brightness: 1.12 }).linear(0.68, 62).png().toBuffer();
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, body] of Object.entries(ICONS)) {
  for (const scale of [1, 2, 3]) {
    const px = BASE * scale;
    const suffix = scale > 1 ? `@${scale}x` : '';
    // density: librsvg rasterises at 72 dpi for the viewBox; scale it so the 64-unit art fills px.
    const raster = await sharp(Buffer.from(body), { density: 72 * (px / 64) * 2 })
      .resize(px, px, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    for (const [variant, buf] of [['', raster], ['-off', await offVariant(raster)]]) {
      const file = path.join(OUT, `${name}${variant}${suffix}.png`);
      await sharp(buf).png({ palette: true, quality: 90, effort: 10, compressionLevel: 9 }).toFile(file);
      console.log(`${path.basename(file).padEnd(22)} ${px}px ${fs.statSync(file).size} B`);
    }
  }
}
