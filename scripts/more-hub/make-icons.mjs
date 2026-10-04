/**
 * make-icons.mjs — the More tab card icons as tiny PNGs (same approach as
 * scripts/mini-games/make-icons.mjs).
 *
 *   node scripts/more-hub/make-icons.mjs
 *
 *   more       the More hub header (four app tiles)
 *   wallpaper  HD Wallpapers   (a phone showing a sunny pet scene)
 *   servers    Private Servers (a server stack with a green join button)
 *   scammer    Scammer DB      (a red warning shield under a magnifier)
 *   news       News            (a megaphone)
 *   admin      Admin reports   (a clipboard with a bar chart)
 *
 * Glossy toy style to sit next to the assets/home-actions art: soft gradients,
 * a white gloss, a soft dark outline so they read on light and dark cards.
 * Writes assets/more-hub/<name>.png, @2x and @3x at a 64 pt base.
 * Deterministic: re-running gives identical files.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// MORE_HUB_ICONS_OUT lets a draft go to a scratch folder before it replaces the assets.
const OUT = process.env.MORE_HUB_ICONS_OUT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/more-hub');
const BASE = 64;
const OUTLINE = 'rgba(28,16,48,0.40)';

const grad = (id, stops, vertical = true) => `<linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1">${
  stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`;
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${body}</svg>`;

/** A four-point sparkle centred on (x, y). */
const sparkle = (x, y, r, fill = '#FFFFFF') =>
  `<path d="M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z" fill="${fill}"/>`;

/** A paw print centred on (x, y) at scale s. */
const paw = (x, y, s, fill) => `
  <g transform="translate(${x} ${y}) scale(${s})" fill="${fill}">
    <ellipse cx="0" cy="4" rx="7" ry="6"/>
    <ellipse cx="-8" cy="-4" rx="3" ry="3.8"/>
    <ellipse cx="-3" cy="-9" rx="3" ry="3.8"/>
    <ellipse cx="3" cy="-9" rx="3" ry="3.8"/>
    <ellipse cx="8" cy="-4" rx="3" ry="3.8"/>
  </g>`;

/** A glossy rounded tile for the hub icon. */
const appTile = (x, y, id) => `
  <rect x="${x}" y="${y + 1.5}" width="23" height="23" rx="7" fill="rgba(28,16,48,0.25)"/>
  <rect x="${x}" y="${y}" width="23" height="23" rx="7" fill="url(#${id})" stroke="${OUTLINE}" stroke-width="1.3"/>
  <path d="M${x + 4} ${y + 3} H${x + 19} C${x + 21} ${y + 3} ${x + 21} ${y + 7} ${x + 19} ${y + 7.5} C${x + 14} ${y + 6} ${x + 9} ${y + 6} ${x + 4} ${y + 7.5} C${x + 2} ${y + 7} ${x + 2} ${y + 3} ${x + 4} ${y + 3} Z" fill="rgba(255,255,255,0.45)"/>`;

/** One server unit: a glossy slab with vent lines and two status lights. */
const serverUnit = (y) => `
  <rect x="6" y="${y + 2}" width="44" height="15" rx="5" fill="#1E3A8A"/>
  <rect x="6" y="${y}" width="44" height="15" rx="5" fill="url(#slab)" stroke="${OUTLINE}" stroke-width="1.4"/>
  <rect x="9" y="${y + 2}" width="38" height="3.6" rx="1.8" fill="rgba(255,255,255,0.4)"/>
  <g stroke="rgba(15,23,42,0.45)" stroke-width="1.8" stroke-linecap="round">
    <path d="M12 ${y + 9.5} H24"/>
  </g>
  <circle cx="38" cy="${y + 9.5}" r="2.6" fill="#4ADE80" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/>
  <circle cx="44.5" cy="${y + 9.5}" r="2.6" fill="#FDE047" stroke="rgba(0,0,0,0.25)" stroke-width="0.6"/>`;

const ICONS = {
  // Four candy app tiles: the "everything else lives here" mark.
  more: svg(
    grad('tPink', [[0, '#FBCFE8'], [1, '#DB2777']]) + grad('tBlue', [[0, '#BAE6FD'], [1, '#2563EB']])
      + grad('tAmber', [[0, '#FEF3C7'], [1, '#F59E0B']]) + grad('tGreen', [[0, '#BBF7D0'], [1, '#16A34A']]),
    `${appTile(6, 6, 'tPink')}${appTile(35, 6, 'tBlue')}${appTile(6, 34, 'tAmber')}${appTile(35, 34, 'tGreen')}
     ${paw(17.5, 18.5, 0.55, '#FFFFFF')}
     <path d="M41 22 L46.5 12 L52 22 Z" fill="#FFFFFF" stroke="none" opacity="0.95"/>
     <circle cx="17.5" cy="45.5" r="5" fill="#FFFFFF"/>
     <path d="M41 45.5 H52 M46.5 40 V51" stroke="#FFFFFF" stroke-width="3.4" stroke-linecap="round"/>
     ${sparkle(58, 5.5, 4.5, '#FDE68A')}`),

  // A phone whose screen is a sunny hill with a pet paw: wallpapers.
  wallpaper: svg(
    grad('frame', [[0, '#C4B5FD'], [0.45, '#7C3AED'], [1, '#4C1D95']])
      + grad('sky', [[0, '#7DD3FC'], [1, '#F9A8D4']])
      + grad('hill', [[0, '#86EFAC'], [1, '#16A34A']])
      + grad('sun', [[0, '#FEF9C3'], [1, '#FBBF24']]),
    `<rect x="15" y="5" width="34" height="56" rx="9" fill="#2E1065"/>
     <rect x="14" y="3" width="34" height="56" rx="9" fill="url(#frame)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <rect x="18" y="9" width="26" height="44" rx="4.5" fill="url(#sky)"/>
     <circle cx="37" cy="18" r="5" fill="url(#sun)"/>
     <path d="M18 40 C23 33 29 33 33 37 C36 34 41 33 44 36 V48.5 C44 51 42.5 53 40 53 H22 C19.5 53 18 51 18 48.5 Z" fill="url(#hill)"/>
     ${paw(27, 45.5, 0.42, '#FFFFFF')}
     <rect x="27" y="5.6" width="8" height="1.8" rx="0.9" fill="rgba(255,255,255,0.55)"/>
     <path d="M19 10.5 L26 10.5 L19 24 Z" fill="rgba(255,255,255,0.28)"/>
     ${sparkle(54, 13, 6, '#FDE68A')}${sparkle(9, 46, 3.8, '#FFFFFF')}`),

  // Two server slabs and a green round "join" button with a play arrow.
  servers: svg(
    grad('slab', [[0, '#BFDBFE'], [0.5, '#3B82F6'], [1, '#1D4ED8']])
      + grad('join', [[0, '#BBF7D0'], [0.5, '#22C55E'], [1, '#15803D']]),
    `${serverUnit(10)}${serverUnit(29)}
     <circle cx="47" cy="47" r="12" fill="#14532D"/>
     <circle cx="47" cy="45.5" r="12" fill="url(#join)" stroke="${OUTLINE}" stroke-width="1.5"/>
     <path d="M39.5 41 C42 36.5 52 36.5 54.5 41 C50 39.6 44 39.6 39.5 41 Z" fill="rgba(255,255,255,0.45)"/>
     <path d="M44 39.8 L53 45.5 L44 51.2 Z" fill="#FFFFFF" stroke="rgba(0,0,0,0.12)" stroke-width="0.6" stroke-linejoin="round"/>
     ${sparkle(55, 7, 5, '#FDE68A')}`),

  // A red warning shield with "!" and a magnifying glass over its corner.
  scammer: svg(
    grad('shield', [[0, '#FECACA'], [0.45, '#EF4444'], [1, '#991B1B']])
      + grad('rim', [[0, '#FDE68A'], [1, '#D97706']])
      + grad('lens', [[0, 'rgba(224,242,254,0.95)'], [1, 'rgba(125,211,252,0.85)']]),
    `<path d="M29 5 L50 12.5 V29 C50 42 41 51.5 29 57 C17 51.5 8 42 8 29 V12.5 Z"
           fill="url(#shield)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M29 9 L46 15 V21 C36 17 22 17 12 21 V15 Z" fill="rgba(255,255,255,0.35)"/>
     <path d="M29 20 V35" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"/>
     <circle cx="29" cy="43.5" r="3.4" fill="#FFFFFF"/>
     <path d="M50 50 L59 59" stroke="#78350F" stroke-width="7.5" stroke-linecap="round"/>
     <path d="M50 50 L59 59" stroke="url(#rim)" stroke-width="5" stroke-linecap="round"/>
     <circle cx="44" cy="44" r="10.5" fill="url(#lens)" stroke="url(#rim)" stroke-width="3.4"/>
     <circle cx="44" cy="44" r="12.2" fill="none" stroke="${OUTLINE}" stroke-width="1"/>
     <path d="M38 41.5 C39 38.5 41.5 37 44 37" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" fill="none"/>
     ${sparkle(56, 9, 4.5, '#FDE68A')}`),

  // An orange megaphone with sound waves.
  news: svg(
    grad('horn', [[0, '#FED7AA'], [0.45, '#F97316'], [1, '#C2410C']])
      + grad('grip', [[0, '#93C5FD'], [1, '#1D4ED8']]),
    `<path d="M13 35 L18.5 53 C19.1 54.9 21 55.9 22.9 55.3 L24.6 54.8 C26.5 54.2 27.4 52.2 26.8 50.4 L22 35 Z"
           fill="url(#grip)" stroke="${OUTLINE}" stroke-width="1.4" stroke-linejoin="round"/>
     <path d="M8 27 C8 25 9.5 24 11.5 24 H20 L42 11 C44 10 46 11 46 13.5 V48.5 C46 51 44 52 42 51 L20 38 H11.5 C9.5 38 8 37 8 35 Z"
           fill="url(#horn)" stroke="${OUTLINE}" stroke-width="1.6" stroke-linejoin="round"/>
     <path d="M21 26 L43 13.6 C43.8 13.2 44 14 43.6 14.8 C36 19 28 23.6 21 28 Z" fill="rgba(255,255,255,0.5)"/>
     <rect x="17" y="24" width="4" height="14" rx="1" fill="rgba(124,45,18,0.35)"/>
     <g fill="none" stroke="#FBBF24" stroke-width="3.2" stroke-linecap="round">
       <path d="M51 23 C54 27 54 35 51 39"/>
       <path d="M56 18 C61 25 61 37 56 44"/>
     </g>
     ${sparkle(11, 12, 5.5, '#FDE68A')}`),

  // A clipboard holding a three-bar chart: staff reports.
  admin: svg(
    grad('board', [[0, '#99F6E4'], [0.45, '#14B8A6'], [1, '#0F766E']])
      + grad('clip', [[0, '#E2E8F0'], [1, '#64748B']]),
    `<rect x="10" y="9" width="44" height="52" rx="8" fill="#134E4A"/>
     <rect x="10" y="7" width="44" height="52" rx="8" fill="url(#board)" stroke="${OUTLINE}" stroke-width="1.6"/>
     <rect x="15" y="14" width="34" height="40" rx="4" fill="#FFFFFF"/>
     <rect x="22" y="3" width="20" height="9" rx="3.5" fill="url(#clip)" stroke="${OUTLINE}" stroke-width="1.2"/>
     <rect x="20" y="36" width="6" height="13" rx="1.8" fill="#F472B6"/>
     <rect x="29" y="28" width="6" height="21" rx="1.8" fill="#60A5FA"/>
     <rect x="38" y="21" width="6" height="28" rx="1.8" fill="#FBBF24"/>
     <path d="M19 49.5 H45" stroke="#CBD5E1" stroke-width="1.4" stroke-linecap="round"/>
     ${sparkle(56, 12, 5, '#FDE68A')}`),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, body] of Object.entries(ICONS)) {
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
